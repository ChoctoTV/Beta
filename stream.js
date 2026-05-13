'use strict';
// stream.js — Xvfb → Chromium → FFmpeg → Twitch RTMP pipeline
require('dotenv').config();

const { spawn, spawnSync, execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');
const os   = require('os');

// ── Crypto: reads ~/.choctotv.key (written by setup.js) ─────────────────────
// After running setup.js once, SECRET.txt is no longer needed by the app.
(function decryptEnv() {
  const PREFIX  = 'enc:';
  const SALT    = 'ChoctoTV-v2';
  const keyFile = path.join(os.homedir(), '.choctotv.key');

  if (fs.existsSync(keyFile)) {
    try {
      const key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
      for (const [k, v] of Object.entries(process.env)) {
        if (!v || !v.startsWith(PREFIX)) continue;
        try {
          const buf = Buffer.from(v.slice(PREFIX.length), 'base64');
          const d   = crypto.createDecipheriv('aes-256-gcm', key, buf.slice(0,12));
          d.setAuthTag(buf.slice(12,28));
          process.env[k] = Buffer.concat([d.update(buf.slice(28)), d.final()]).toString('utf8');
        } catch {}
      }
      return;
    } catch(e) { console.warn('[crypto] ~/.choctotv.key error:', e.message); }
  }

  // Fallback: derive from SECRET.txt (first run / missing keyfile)
  const secretFile = path.join(__dirname, 'SECRET.txt');
  if (!fs.existsSync(secretFile)) {
    console.warn('[crypto] No ~/.choctotv.key — run: node setup.js');
    return;
  }
  const S = {};
  for (const line of fs.readFileSync(secretFile, 'utf8').split('\n')) {
    const clean = line.split('#')[0].trim();
    const eq = clean.indexOf('=');
    if (eq < 0) continue;
    const k = clean.slice(0, eq).trim().toUpperCase();
    const v = clean.slice(eq + 1).trim();
    if (k && v && !k.startsWith('\u2550')) S[k] = v;
  }
  const sk = S['STREAM_KEY'] || '', ci = S['CLIENT_ID'] || '';
  if (!sk || !ci) { console.warn('[crypto] SECRET.txt missing keys — run: node setup.js'); return; }

  function deriveKey(sk_, ci_) {
    const skb = Buffer.from(sk_,'utf8'), cib = Buffer.from(ci_,'utf8');
    const ml = Math.max(skb.length,cib.length)*2+16;
    const mx = Buffer.alloc(ml,0);
    let si=0,ci_i=0,mi=0;
    while(si<skb.length||ci_i<cib.length){
      if(si<skb.length){mx[mi%ml]^=skb[si];const s=ci_i<cib.length?(cib[ci_i%cib.length]%3)+1:1;mi+=s;si++;}
      if(ci_i<cib.length){mx[mi%ml]^=cib[ci_i];const s=si<skb.length?(skb[si%skb.length]%3)+1:1;mi+=s;ci_i++;}
    }
    const rev=Buffer.from(ci_.split('').reverse().join(''));
    for(let i=0;i<ml;i++){mx[i]^=rev[i%rev.length];mx[i]^=skb[(i*7+3)%skb.length];}
    const h=Math.floor(ml/2),sd=Buffer.alloc(h);
    for(let i=0;i<h;i++)sd[i]=mx[i]^mx[i+h]^(i&0xff);
    return crypto.pbkdf2Sync(sd,SALT,100000,32,'sha256');
  }
  const key = deriveKey(sk, ci);
  for(const[k,v]of Object.entries(process.env)){
    if(!v||!v.startsWith(PREFIX))continue;
    try{const buf=Buffer.from(v.slice(PREFIX.length),'base64');const d=crypto.createDecipheriv('aes-256-gcm',key,buf.slice(0,12));d.setAuthTag(buf.slice(12,28));process.env[k]=Buffer.concat([d.update(buf.slice(28)),d.final()]).toString('utf8');}catch{}
  }
})();

// ── Crypto: derives AES key by scattering STREAM_KEY + CLIENT_ID bits ────────
// Both keys are required. Key derivation interleaves bytes from each at
// positions driven by the other key's char codes, then folds + PBKDF2.
// Without SECRET.txt (which holds both keys) the .env is unreadable.
(function decryptEnv() {
  const PREFIX = 'enc:';
  const SALT   = 'ChoctoTV-v2';

  // Parse SECRET.txt
  const secretFile = path.join(__dirname, 'SECRET.txt');
  if (!fs.existsSync(secretFile)) {
    console.warn('[crypto] SECRET.txt not found — env values not decrypted');
    return;
  }
  const S = {};
  for (const line of fs.readFileSync(secretFile, 'utf8').split('\n')) {
    const clean = line.split('#')[0].trim();
    const eq = clean.indexOf('=');
    if (eq < 0) continue;
    const k = clean.slice(0, eq).trim().toUpperCase();
    const v = clean.slice(eq + 1).trim();
    if (k && v && !k.startsWith('\u2550')) S[k] = v;
  }

  const streamKey = S['STREAM_KEY'] || '';
  const clientId  = S['CLIENT_ID']  || '';
  if (!streamKey || !clientId) {
    console.warn('[crypto] SECRET.txt missing STREAM_KEY or CLIENT_ID');
    return;
  }

  function deriveKey(sk_, ci_) {
    const sk = Buffer.from(sk_, 'utf8');
    const ci = Buffer.from(ci_, 'utf8');
    const maxLen = Math.max(sk.length, ci.length) * 2 + 16;
    const mixed  = Buffer.alloc(maxLen, 0);
    let si = 0, cii = 0, mi = 0;
    while (si < sk.length || cii < ci.length) {
      if (si < sk.length) {
        mixed[mi % maxLen] ^= sk[si];
        const step = cii < ci.length ? (ci[cii % ci.length] % 3) + 1 : 1;
        mi += step; si++;
      }
      if (cii < ci.length) {
        mixed[mi % maxLen] ^= ci[cii];
        const step = si < sk.length ? (sk[si % sk.length] % 3) + 1 : 1;
        mi += step; cii++;
      }
    }
    const rev = Buffer.from(ci_.split('').reverse().join(''), 'utf8');
    for (let i = 0; i < maxLen; i++) {
      mixed[i] ^= rev[i % rev.length];
      mixed[i] ^= sk[(i * 7 + 3) % sk.length];
    }
    const half = Math.floor(maxLen / 2);
    const seed = Buffer.alloc(half);
    for (let i = 0; i < half; i++) seed[i] = mixed[i] ^ mixed[i + half] ^ (i & 0xff);
    return crypto.pbkdf2Sync(seed, SALT, 100000, 32, 'sha256');
  }

  const key = deriveKey(streamKey, clientId);
  let decrypted = 0;
  for (const [k, v] of Object.entries(process.env)) {
    if (!v || !v.startsWith(PREFIX)) continue;
    try {
      const buf = Buffer.from(v.slice(PREFIX.length), 'base64');
      const d   = crypto.createDecipheriv('aes-256-gcm', key, buf.slice(0, 12));
      d.setAuthTag(buf.slice(12, 28));
      process.env[k] = Buffer.concat([d.update(buf.slice(28)), d.final()]).toString('utf8');
      decrypted++;
    } catch(e) {
      console.error(`[crypto] Cannot decrypt ${k} — check SECRET.txt keys`);
    }
  }
  if (decrypted) console.log(`[crypto] ${decrypted} value(s) decrypted`);
})();

const STREAM_KEY  = process.env.TWITCH_STREAM_KEY   || '';
const RTMP_BASE   = process.env.TWITCH_RTMP_BASE     || 'rtmp://live.twitch.tv/app';
const RTMP_URL    = STREAM_KEY ? `${RTMP_BASE}/${STREAM_KEY}` : null;
const RES         = process.env.STREAM_RESOLUTION    || '1280x720';
const FPS         = parseInt(process.env.STREAM_FPS  || '60');
const BITRATE     = process.env.STREAM_BITRATE       || '4500k';
const AUDIO_BR    = process.env.STREAM_AUDIO_BITRATE || '128k';
const DISPLAY_NUM = process.env.DISPLAY_NUM          || '99';
const DISPLAY     = `:${DISPLAY_NUM}`;
const OVL_PORT    = process.env.OVERLAY_PORT         || '8080';
const EXT_OVERLAYS = [
  process.env.OVERLAY_1 || '',
  process.env.OVERLAY_2 || '',
  process.env.OVERLAY_3 || '',
].filter(Boolean);
const OVL_URL     = process.env.OVERLAY_URL          || `http://localhost:${OVL_PORT}`;
const XVFB_WAIT   = parseInt(process.env.XVFB_WAIT   || '1200');
const CHROME_WAIT = parseInt(process.env.CHROME_WAIT || '4000');
const [W, H]      = RES.split('x').map(Number);

let xvfbProc=null, chromeProc=null, ffmpegProc=null, compProc=null;
let stopping = false;
let _pipelineGen = 0; // increments each startPipeline() call — stale timeouts abort



const log  = (tag, msg) => console.log(`[${tag}] ${msg}`);
const warn = (tag, msg) => console.warn(`[${tag}] ${msg}`);

// ── Find Chromium ─────────────────────────────────────────────────────────────
function findChrome() {
  const custom = process.env.CHROME_BIN;
  if (custom) { try { execSync(`test -x "${custom}"`, {stdio:'ignore'}); return custom; } catch {} }
  for (const b of ['chromium-browser','chromium','google-chrome-stable','google-chrome']) {
    try { return execSync(`which ${b} 2>/dev/null`, {encoding:'utf8'}).trim(); } catch {}
  }
  return null;
}

// ── NVENC detection ───────────────────────────────────────────────────────────
function hasNvenc() {
  try {
    const r = spawnSync('ffmpeg', ['-encoders'], { encoding:'utf8', timeout:5000 });
    return (r.stdout + r.stderr).includes('h264_nvenc');
  } catch { return false; }
}

// ── Start pipeline ────────────────────────────────────────────────────────────


async function startPipeline() {
  if (stopping) return;
  const myGen = ++_pipelineGen;

  // 1. Xvfb — kill any zombie on this display, clean locks, ensure socket dir
  const lockFile = `/tmp/.X${DISPLAY_NUM}-lock`;
  const sockFile = `/tmp/.X11-unix/X${DISPLAY_NUM}`;
  const sockDir  = '/tmp/.X11-unix';

  // Kill any existing Xvfb holding display :99
  try { spawnSync('pkill', ['-9', '-f', `Xvfb ${DISPLAY}`], { timeout:2000, stdio:'ignore' }); } catch {}
  try { spawnSync('pkill', ['-9', '-f', `Xvfb.*${DISPLAY_NUM}`], { timeout:2000, stdio:'ignore' }); } catch {}
  await new Promise(r => setTimeout(r, 500)); // let it die

  try { if (fs.existsSync(lockFile)) { fs.unlinkSync(lockFile); log('Xvfb', `Removed stale lock`); } } catch {}
  try { if (fs.existsSync(sockFile)) { fs.unlinkSync(sockFile); } } catch {}
  try { if (!fs.existsSync(sockDir)) { fs.mkdirSync(sockDir, { mode:0o1777 }); } } catch {}

  log('Xvfb', `Starting on ${DISPLAY} @ ${RES}`);
  xvfbProc = spawn('Xvfb', [
    DISPLAY,
    '-screen', '0', `${RES}x24`,
    '-ac',
    '-nolisten', 'tcp',
  ], { stdio:['ignore','ignore','pipe'] });

  xvfbProc.stderr && xvfbProc.stderr.on('data', d => {
    const m = d.toString().trim();
    if (m) warn('Xvfb', m);
  });
  xvfbProc.on('exit', c => {
    if (!stopping) {
      warn('Xvfb', `Exited (${c}) — full restart in 10s`);
      // Kill Chrome and FFmpeg before restarting everything
      if (ffmpegProc) { try { ffmpegProc.kill('SIGTERM'); } catch {} ffmpegProc = null; }
      if (chromeProc) { try { chromeProc.kill('SIGTERM'); } catch {} chromeProc = null; }
      if (compProc)   { try { compProc.kill('SIGTERM');   } catch {} compProc   = null; }
      setTimeout(startPipeline, 5000);
    }
  });

  setTimeout(() => {
    if (stopping || _pipelineGen !== myGen) return; // stale — newer pipeline started

    // Verify Xvfb actually started — if it crashed, abort and let the exit handler retry
    if (!xvfbProc || xvfbProc.exitCode !== null || xvfbProc.killed) {
      warn('Xvfb', 'Not running after wait — aborting pipeline start, will retry');
      return;
    }

    const X11_ENV = { ...process.env, DISPLAY: `${DISPLAY}.0` };

    // 2. Disable screensaver/blanking
    try { spawnSync('xset', ['-display', `${DISPLAY}.0`, 's', 'off', '-dpms'], { env:X11_ENV, stdio:'ignore', timeout:3000 }); log('Display','DPMS/blanking disabled'); } catch {}

    // ── PulseAudio setup for headless/cloud stream audio ────────────────────────
    // Start PA if not running (cloud has no audio device — needs null output)
    try {
      spawnSync('pulseaudio', ['--start', '--exit-idle-time=-1', '--log-level=error'],
        { timeout:4000, stdio:'ignore' });
    } catch {}

    // Unload ALL existing choctotv_music sinks (accumulate on every restart)
    try {
      const list = spawnSync('pactl', ['list', 'short', 'modules'],
        { encoding:'utf8', timeout:3000, stdio:'pipe' });
      const ids = (list.stdout||'').split('\n')
        .filter(l => l.includes('module-null-sink') && l.includes('choctotv_music'))
        .map(l => l.split('\t')[0].trim())
        .filter(Boolean);
      for (const id of ids) {
        spawnSync('pactl', ['unload-module', id], { timeout:2000, stdio:'ignore' });
        log('Audio', `Unloaded stale sink module ${id}`);
      }
    } catch {}

    // Load ONE clean null sink
    const paLoad = spawnSync('pactl', [
      'load-module', 'module-null-sink',
      'sink_name=choctotv_music',
      'sink_properties=device.description=ChoctoTV_Music',
    ], { encoding:'utf8', timeout:3000, stdio:'pipe' });

    if (paLoad.status === 0) {
      spawnSync('pactl', ['set-default-sink', 'choctotv_music'],
        { timeout:2000, stdio:'ignore' });
      log('Audio', 'Stream-only audio sink ready (choctotv_music)');
    } else {
      warn('Audio', 'PulseAudio setup failed: ' + (paLoad.stderr||'').trim().slice(0,80));
    }

    // Move cursor to 0,0 — DISPLAY must be in env, not a flag
    const warpEnv = { ...process.env, DISPLAY: `${DISPLAY}.0` };
    const doWarp  = () => { try { spawnSync('xdotool', ['mousemove', '0', '0'], { env:warpEnv, stdio:'ignore', timeout:2000 }); } catch {} };
    doWarp();
    setInterval(doWarp, 5000);

    // Compile a tiny C cursor-warp binary (gcc + libX11 always on Nobara)
    // then run it immediately and every 10 seconds to keep cursor at 0,0
    const WARP_SRC = '/tmp/choctotv_warp.c';
    const WARP_BIN = '/tmp/choctotv_warp';
    const cSrc = [
      '#include <X11/Xlib.h>',
      '#include <stdlib.h>',
      'int main(int argc,char**argv){',
      '  const char*disp=argc>1?argv[1]:":0.0";',
      '  Display*d=XOpenDisplay(disp);',
      '  if(!d)return 1;',
      '  Window r=DefaultRootWindow(d);',
      '  XWarpPointer(d,None,r,0,0,0,0,0,0);',
      '  XFlush(d);XCloseDisplay(d);return 0;}',
    ].join('\n');
    try {
      fs.writeFileSync(WARP_SRC, cSrc);
      const comp = spawnSync('gcc', [WARP_SRC, '-o', WARP_BIN, '-lX11'],
        { timeout:10000, stdio:'pipe', encoding:'utf8' });
      if (comp.status === 0) {
        log('Display', 'Cursor warp binary compiled');
        const doWarp = () => {
          if (stopping) return;
          spawnSync(WARP_BIN, [`${DISPLAY}.0`], { timeout:2000, stdio:'ignore' });
        };
        doWarp();
        setInterval(doWarp, 10000);
      } else {
        warn('Display', 'gcc compile failed: ' + (comp.stderr||'').trim().slice(0,100));
      }
    } catch(e) { warn('Display', 'Cursor warp setup failed: ' + e.message); }




    // 3. Compositor
    try {
      compProc = spawn('xcompmgr', ['-display', `${DISPLAY}.0`], { env:X11_ENV, stdio:'ignore' });
      log('Compositor', 'Ready');
    } catch {}

    // 5. Chrome
    const chromeBin = findChrome();
    if (!chromeBin) { warn('Chrome', 'Chromium not found — install with: sudo dnf install chromium'); return; }
    log('Chrome', `Launching ${OVL_URL}`);
    // Force DISPLAY to virtual screen — keep full env so Chrome can render fonts/libs
    const CHROME_ENV = { ...process.env, DISPLAY: `${DISPLAY}.0` };
    // Remove Wayland vars so Chrome uses X11 only
    delete CHROME_ENV.WAYLAND_DISPLAY;
    delete CHROME_ENV.XDG_SESSION_TYPE;

    chromeProc = spawn(chromeBin, [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--no-first-run',
      '--noerrdialogs',
      '--disable-infobars',
      '--test-type',
      '--force-device-scale-factor=1',
      `--window-size=${W},${H}`,
      '--window-position=0,0',
      `--app=${OVL_URL}`,
    ], { env:CHROME_ENV, stdio:['ignore','ignore','pipe'] });
    chromeProc.stderr.on('data', d => {
      const l = d.toString().trim();
      if (l && !l.includes('Gtk-Message') && !l.includes('ALSA') && !l.includes('dconf') && !l.includes('KWallet') && !l.includes('gcm')) console.log(`[Chrome] ${l.slice(0,200)}`);
    });
    chromeProc.on('exit', (c, sig) => {
      chromeProc = null;
      if (stopping) return;
      if (sig === 'SIGTERM' || sig === 'SIGKILL') return;
      warn('Chrome', `Exited (code=${c}) — will not auto-restart`);
    });

    // Launch external overlay URLs as transparent Chrome windows on top of the yard
    if (EXT_OVERLAYS.length) {
      setTimeout(() => {
        EXT_OVERLAYS.forEach((url, i) => {
          if (stopping) return;
          const chromeBinO = findChrome();
          if (!chromeBinO) return;
          log('Overlay', `Loading external overlay ${i+1}: ${url.slice(0,60)}`);
          const oc = spawn(chromeBinO, [
            '--disable-gpu', '--disable-dev-shm-usage',
            '--disable-software-rasterizer', '--disable-extensions',
            '--no-first-run', '--noerrdialogs', '--disable-infobars', '--test-type',
            '--force-device-scale-factor=1',
            '--enable-transparent-visuals', '--disable-background-color',
            `--window-size=${W},${H}`, '--window-position=0,0',
            `--app=${url}`,
          ], { env:CHROME_ENV, stdio:['ignore','ignore','pipe'] });
          oc.on('exit', () => log('Overlay', `External overlay ${i+1} closed`));
        });
      }, CHROME_WAIT + 500);
    }



    // 6. FFmpeg
    setTimeout(() => {
      if (stopping) return;
      if (!RTMP_URL) { warn('FFmpeg', 'No TWITCH_STREAM_KEY — overlay running but not streaming to Twitch'); return; }

      const useNvenc = hasNvenc();
      log('FFmpeg', `Encoder: ${useNvenc ? 'h264_nvenc (GPU)' : 'libx264 (CPU)'}`);
      log('FFmpeg', `${DISPLAY} → Twitch (${RES} ${FPS}fps ${BITRATE})`);

      startFFmpeg();
      log('StreamCapture', 'Pipeline running');
    }, CHROME_WAIT);
  }, XVFB_WAIT);
}

function startFFmpeg() {
  if (stopping || !RTMP_URL) return;
  const useNvenc = hasNvenc();
  const videoArgs = useNvenc
    ? ['-c:v','h264_nvenc','-preset','p4','-rc','cbr','-b:v',BITRATE,'-maxrate',BITRATE,'-bufsize',`${Math.round(parseInt(BITRATE)*1.5)}k`]
    : ['-c:v','libx264','-preset','veryfast','-tune','zerolatency','-b:v',BITRATE,'-maxrate',BITRATE,'-bufsize',`${Math.round(parseInt(BITRATE)*1.5)}k`];

  log('FFmpeg', `Starting ${RES} ${FPS}fps ${BITRATE} via ${useNvenc?'NVENC':'x264'}`);

  ffmpegProc = spawn('ffmpeg', [
    '-f','x11grab','-video_size',RES,'-framerate',String(FPS),'-i',`${DISPLAY}.0`,
    '-f','pulse','-i','choctotv_music.monitor',
    ...videoArgs,
    '-g',String(FPS*2),'-keyint_min',String(FPS),
    '-c:a','aac','-b:a',AUDIO_BR,'-ar','48000',
    '-f','flv', RTMP_URL,
  ], { stdio:['ignore','ignore','pipe'] });

  ffmpegProc.stderr.on('data', d => {
    const lines = d.toString().split('\n');
    for (const l of lines) {
      const t = l.trim();
      if (t && !t.includes('frame=') && !t.includes('fps=')) console.log(`[FFmpeg] ${t.slice(0,200)}`);
    }
  });

  ffmpegProc.on('exit', (c, sig) => {
    if (stopping || sig === 'SIGTERM' || sig === 'SIGKILL') return;
    warn('FFmpeg', `Exited (${c}) — restarting in 3s`);
    setTimeout(() => { if(!stopping) startFFmpeg(); }, 3000);
  });
}

function shutdown(sig) {
  stopping = true;
  log('StreamCapture', `${sig} — shutting down...`);
  for (const [n, p] of [['ffmpeg',ffmpegProc],['chrome',chromeProc],['compositor',compProc],['Xvfb',xvfbProc]]) {
    if (p) { try { p.kill('SIGTERM'); log('',`  SIGTERM → ${n}`); } catch {} }
  }
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

startPipeline();
