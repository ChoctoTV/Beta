'use strict';
// stream.js — Xvfb → Chromium → FFmpeg → Twitch RTMP pipeline
require('dotenv').config();

// Decrypt any enc: values left in .env from the old encrypted setup
(function decryptLegacy() {
  const fs = require('fs'), path = require('path'), os = require('os');
  const kf = path.join(os.homedir(), '.choctotv.key');
  if (!fs.existsSync(kf)) return;
  try {
    const key = Buffer.from(fs.readFileSync(kf, 'utf8').trim(), 'hex');
    let n = 0;
    for (const [k, v] of Object.entries(process.env)) {
      if (!v?.startsWith('enc:')) continue;
      try {
        const buf = Buffer.from(v.slice(4), 'base64');
        const d   = require('crypto').createDecipheriv('aes-256-gcm', key, buf.slice(0,12));
        d.setAuthTag(buf.slice(12,28));
        process.env[k] = Buffer.concat([d.update(buf.slice(28)), d.final()]).toString('utf8');
        n++;
      } catch {}
    }
    if (n) console.log(`[Stream] ${n} enc: values decrypted`);
  } catch {}
})();

// Load plain values from Secret file if present — overrides .env
(function loadSecrets() {
  const fs   = require('fs'), path = require('path');
  const sf = (function findSecretFile(dir) {
  const fs   = require('fs'), path = require('path');
  // Scan directory for any variant of the secret filename (case-insensitive)
  // Priority: live > beta > plain. Handles SECRET(live).txt, Secret(beta).txt, SECRET.txt etc.
  try {
    const files = fs.readdirSync(dir);
    const lower = f => f.toLowerCase();
    const live  = files.find(f => lower(f) === 'secret(live).txt');
    const beta  = files.find(f => lower(f) === 'secret(beta).txt');
    const plain = files.find(f => lower(f) === 'secret.txt');
    return live ? path.join(dir, live)
         : beta ? path.join(dir, beta)
         : plain ? path.join(dir, plain)
         : null;
  } catch { return null; }
})(__dirname);
  if (!sf) return;
  for (const rawLine of fs.readFileSync(sf, 'utf8').split('\n')) {
    const line = rawLine.split('#')[0].trim();
    const eq   = line.indexOf('=');
    if (eq < 1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k && v) process.env[k] = v;
  }
})();

const { spawn, spawnSync, execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const crypto = require('crypto');
const os   = require('os');

// ── Crypto: reads ~/.choctotv.key (written by setup.js) ─────────────────────
// After running setup.js once, SECRET.txt is no longer needed by the app.

// ── Crypto: derives AES key by scattering STREAM_KEY + CLIENT_ID bits ────────
// Both keys are required. Key derivation interleaves bytes from each at
// positions driven by the other key's char codes, then folds + PBKDF2.
// Without SECRET.txt (which holds both keys) the .env is unreadable.

const STREAM_KEY  = process.env.TWITCH_STREAM_KEY || process.env.STREAM_KEY || '';
const RTMP_BASE   = process.env.TWITCH_RTMP_BASE  || process.env.RTMP_BASE || 'rtmp://live.twitch.tv/app';
const RTMP_URL    = STREAM_KEY ? `${RTMP_BASE}/${STREAM_KEY}` : null;
const RES         = '1280x720';   // Xvfb/capture size (fixed)
// ── Output quality ────────────────────────────────────────────────────────────
// Controlled ONLY by the !480 / !720 / !1080 chat commands (which write
// vault/data/quality.txt and clean-reboot). NOT read from env/Secret. Default 480p.
const QPRESETS = {
  '1080p': { w:1920, h:1080, br:'6000k', fps:30 },
  '720p':  { w:1280, h:720,  br:'3500k', fps:30 },
  '480p':  { w:854,  h:480,  br:'1500k', fps:30 },
};
const QUALITY = (() => {
  const fsM = require('fs'), pathM = require('path');
  const qFile = pathM.join(__dirname, 'vault', 'data', 'quality.txt');
  try {
    const raw = fsM.readFileSync(qFile, 'utf8').trim().toLowerCase();
    if (QPRESETS[raw]) {
      if (raw !== '480p') console.warn(`[Stream] ⚠ quality.txt = "${raw}" — run !480 in chat to switch to 480p, or !${raw.replace('p','')} to keep it`);
      return raw;
    }
    // Unknown value — reset to 480p and warn
    console.warn(`[Stream] ⚠ Unknown quality "${raw}" in quality.txt — resetting to 480p`);
    try { fsM.mkdirSync(pathM.dirname(qFile),{recursive:true}); fsM.writeFileSync(qFile,'480p'); } catch {}
    return '480p';
  } catch {
    // File missing — seed it
    try { fsM.mkdirSync(pathM.dirname(qFile),{recursive:true}); fsM.writeFileSync(qFile,'480p'); } catch {}
    return '480p';
  }
})();
const QP          = QPRESETS[QUALITY] || QPRESETS['480p'];
const FPS         = QP.fps;
// CPU thread budget — auto-detect, leave headroom for Chrome + Node
const CPU_CORES   = (() => {
  try { return require('os').cpus().length; } catch { return 2; }
})();
// Reserve the LAST core for music (mpv pins itself there). FFmpeg + Chrome use the rest.
const MUSIC_CORE     = CPU_CORES >= 3 ? CPU_CORES - 1 : null;
const RENDER_CORES   = MUSIC_CORE !== null
  ? Array.from({ length: CPU_CORES - 1 }, (_, i) => i).join(',')  // cores 0..N-2
  : null;
const HAS_TASKSET    = (() => {
  try { return require('child_process').spawnSync('taskset', ['--version'], { stdio:'ignore' }).status === 0; } catch { return false; }
})();
// Keep FFmpeg threads within the render-core budget (excludes the reserved music core)
const FFMPEG_THREADS = Math.max(1, Math.min((MUSIC_CORE !== null ? CPU_CORES - 1 : CPU_CORES) - 1, 4));
const BITRATE     = QP.br;
const AUDIO_BR    = process.env.STREAM_AUDIO_BITRATE || '96k';   // lighter audio for smoother playback
const DISPLAY_NUM = process.env.DISPLAY_NUM          || '99';
const DISPLAY     = `:${DISPLAY_NUM}`;
const OVL_PORT = parseInt(process.env.API_PORT||'3000');
// Read OVERLAY_URL_1 through OVERLAY_URL_10 — add as many as needed in Secret file
const EXT_OVERLAYS = Array.from({length:10}, (_,i) =>
  process.env[`OVERLAY_URL_${i+1}`] || process.env[`OVERLAY_${i+1}`] || ''
).filter(Boolean);
const _OVL_BASE   = process.env.OVERLAY_URL          || `http://localhost:${OVL_PORT}`;
const _STREAM_BUF = process.env.STREAM_BUFFER_MS || '3000';
const OVL_URL     = `${_OVL_BASE}?streamBuffer=${_STREAM_BUF}`;
const XVFB_WAIT   = parseInt(process.env.XVFB_WAIT   || '1200');
const CHROME_WAIT = parseInt(process.env.CHROME_WAIT || '4000');
const [W, H]      = RES.split('x').map(Number);

let xvfbProc=null, chromeProc=null, ffmpegProc=null, compProc=null;
let overlayProcs=[];  // additional overlay URL Chrome instances
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
    '-screen', '0', `${RES}x24`,  // 24-bit colour — faster than 32-bit on CPU
    '-ac',                          // disable access control for Chrome
    '-nolisten', 'tcp',             // no network connections
    '-dpi', '96',                   // explicit DPI prevents font-size re-layouts
    '-nocursor',                    // no cursor in virtual display
  ], { stdio:['ignore','ignore','pipe'] });

  xvfbProc.stderr && xvfbProc.stderr.on('data', d => {
    const m = d.toString().trim();
    if (m) warn('Xvfb', m);
  });
  xvfbProc.on('exit', c => {
    if (!stopping) {
      if (stopping) return; // controlled shutdown — don't attempt restart
      warn('Xvfb', `Exited (${c}) — full restart in 10s`);
      // Kill Chrome and FFmpeg before restarting everything
      if (ffmpegProc) { try { ffmpegProc.kill('SIGTERM'); } catch {} ffmpegProc = null; }
      if (chromeProc) { try { chromeProc.kill('SIGTERM'); } catch {} chromeProc = null; }
      for (const op of overlayProcs) { try { op.kill('SIGTERM'); } catch {} }
      overlayProcs = [];
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
      'rate=44100', 'channels=2',          // match mpv output — no resampling in the chain
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

    const _crBin = (RENDER_CORES && HAS_TASKSET) ? 'taskset' : chromeBin;
    const _crPre = (RENDER_CORES && HAS_TASKSET) ? ['-c', RENDER_CORES, chromeBin] : [];
    chromeProc = spawn(_crBin, [..._crPre,
      // ── Virtual display: no physical GPU, use SwiftShader software renderer ──
      '--disable-gpu',                               // Xvfb has no physical GPU
      '--use-gl=swiftshader',                        // explicit SW rasterizer for stable rendering
      '--disable-dev-shm-usage',                     // use /tmp for shared memory (VM-safe)
      // REMOVED: --disable-software-rasterizer  ← was preventing SwiftShader, causing poor rendering

      // ── Performance: prevent renderer/timer throttling when "backgrounded" ───
      '--disable-background-timer-throttling',       // JS timers at full speed always
      '--disable-renderer-backgrounding',            // renderer thread never deprioritised
      '--disable-backgrounding-occluded-windows',    // no throttle when behind another window
      '--disable-ipc-flooding-protection',           // allow fast WS message bursts
      '--disable-hang-monitor',                      // no false hang-detect kills

      // ── Memory: stable pressure handling ──────────────────────────────────────
      '--memory-pressure-off',                       // no GC pressure events mid-frame
      '--max-old-space-size=512',                    // cap V8 heap

      // ── Rendering quality ───────────────────────────────────────────────────
      '--force-color-profile=srgb',                  // consistent colours into FFmpeg
      // ── CPU rendering: multi-thread SwiftShader rasterisation ──────────────
      `--num-raster-threads=${Math.max(1, Math.floor(CPU_CORES / 2))}`,
      '--enable-zero-copy',                          // avoid unnecessary buffer copies
      '--disable-partial-raster',                    // full tiles only — more predictable CPU use
      // ── Quality: keep AA and subpixel rendering for crisp overlay text ──────
      '--enable-lcd-text-anti-aliasing',
      '--force-renderer-accessibility=false',        // skip accessibility tree (unused, saves CPU)
      '--font-render-hinting=full',                  // crisp text

      // ── Minimal surface / no noise ──────────────────────────────────────────
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--no-first-run',
      '--noerrdialogs',
      '--disable-infobars',
      '--disable-translate',
      '--disable-features=TranslateUI',
      '--test-type',
      '--force-device-scale-factor=1',
      '--disable-gpu-vsync',                         // no vsync stall — render as fast as possible
      '--disable-frame-rate-limit',                  // remove 60fps cap on requestAnimationFrame
      '--animation-duration-scale=1',                // CSS animations at real-time speed
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
      if (stopping || sig === 'SIGTERM' || sig === 'SIGKILL') return;
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
            '--disable-gpu','--use-gl=swiftshader','--disable-dev-shm-usage',
            '--disable-background-timer-throttling','--disable-renderer-backgrounding',
            '--memory-pressure-off','--disable-extensions','--no-first-run',
            '--noerrdialogs','--disable-infobars','--test-type',
            '--force-device-scale-factor=1','--force-color-profile=srgb',
            '--enable-transparent-visuals','--disable-background-color',
            '--disable-gpu-vsync','--disable-frame-rate-limit',
            `--window-size=${W},${H}`,'--window-position=0,0',
            `--app=${url}`,
          ], { env:CHROME_ENV, stdio:['ignore','ignore','pipe'] });
          overlayProcs.push(oc);
          oc.on('exit', () => {
            overlayProcs = overlayProcs.filter(p => p !== oc);
            log('Overlay', `External overlay ${i+1} closed`);
          });
        });
      }, CHROME_WAIT + 500);
    }



    // 6. FFmpeg
    setTimeout(() => {
      if (stopping) return;
      if (!RTMP_URL) { warn('FFmpeg', 'No stream key found (TWITCH_STREAM_KEY or STREAM_KEY) — overlay running without Twitch stream'); return; }

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
  // CPU-optimised x264 params — reduce encode complexity without visible quality loss:
  //   bframes=0:  no B-frames → halves encoder lookahead work
  //   ref=1:      single reference frame → faster motion search
  //   weightp=0:  no weighted prediction → simpler encode path
  //   sc_threshold=0: no scene-change detection → frees CPU every keyframe
  const x264CPUParams = [
    'nal-hrd=cbr',
    'force-cfr=1',
    'bframes=0',
    'ref=1',
    'weightp=0',
    'rc-lookahead=0',
    'sc_threshold=0',
    `threads=${FFMPEG_THREADS}`,
  ].join(':');

  // Scale down to the chosen preset if it differs from the capture resolution
  const [capW, capH] = RES.split('x').map(Number);
  const needScale = (QP.w !== capW || QP.h !== capH);
  const scaleArgs = needScale ? ['-vf', `scale=${QP.w}:${QP.h}:flags=fast_bilinear`] : [];
  if (needScale) log('FFmpeg', `Scaling ${RES} → ${QP.w}x${QP.h} (${QUALITY})`);

  const videoArgs = useNvenc
    ? ['-c:v','h264_nvenc','-preset','p3','-rc','cbr','-b:v',BITRATE,'-maxrate',BITRATE,'-bufsize',`${Math.round(parseInt(BITRATE)*2)}k`,'-bf','0']
    : ['-c:v','libx264','-preset','veryfast','-tune','zerolatency','-x264-params',x264CPUParams,'-b:v',BITRATE,'-maxrate',BITRATE,'-bufsize',`${Math.round(parseInt(BITRATE)*2)}k`];

  log('FFmpeg', `━━━ STREAM OUTPUT: ${QP.w}x${QP.h} (${QUALITY}) @ ${FPS}fps ${BITRATE} ━━━`);
  log('FFmpeg', `Capture: ${RES} → ${needScale ? 'scaled to '+QP.w+'x'+QP.h : 'native'} | encoder: ${useNvenc?'NVENC':'x264'} | change with !480/!720/!1080`);

  // Pin FFmpeg to render cores only — leaves the music core untouched
  const _ffBin  = (RENDER_CORES && HAS_TASKSET) ? 'taskset' : 'ffmpeg';
  const _ffPre  = (RENDER_CORES && HAS_TASKSET) ? ['-c', RENDER_CORES, 'ffmpeg'] : [];
  if (RENDER_CORES && HAS_TASKSET) log('Stream', `FFmpeg pinned to cores ${RENDER_CORES} (music core ${MUSIC_CORE} reserved)`);
  ffmpegProc = spawn(_ffBin, [..._ffPre,
    // ── Global: multi-threaded decode+filter ──────────────────────────────────
    '-threads', String(FFMPEG_THREADS),
    // ── Capture: large thread queue prevents frame drops on CPU spike ─────────
    '-thread_queue_size','1024',
    '-f','x11grab','-video_size',RES,'-framerate',String(FPS),
    '-draw_mouse','0',                             // skip mouse — saves encode cycles
    '-i',`${DISPLAY}.0`,
    // ── Audio ──────────────────────────────────────────────────────────────────
    '-thread_queue_size','512',
    '-f','pulse','-i','choctotv_music.monitor',
    // ── Scale (only if preset < capture) ───────────────────────────────────────
    ...scaleArgs,
    // ── Video codec ────────────────────────────────────────────────────────────
    ...videoArgs,
    '-pix_fmt','yuv420p',                          // Twitch-compatible chroma
    '-g',String(FPS*2),'-keyint_min',String(FPS),  // 2-second GOP
    // ── Audio codec ────────────────────────────────────────────────────────────
    '-c:a','aac','-b:a',AUDIO_BR,'-ar','44100','-ac','2',  // 44.1kHz matches sink — no resample
    // ── RTMP output ────────────────────────────────────────────────────────────
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
  if (stopping) return; // already shutting down — ignore repeated signals
  stopping = true;
  log('StreamCapture', `${sig} — shutting down...`);
  for (const [n, p] of [['ffmpeg',ffmpegProc],['chrome',chromeProc],['compositor',compProc],['Xvfb',xvfbProc]]) {
    if (p) { try { p.kill('SIGTERM'); log('',`  SIGTERM → ${n}`); } catch {} }
  }
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
// SIGINT comes from Ctrl+C on the terminal process group — start.sh cleanup sends
// an explicit SIGTERM via kill_pid, so we can safely ignore SIGINT here.
process.on('SIGINT',  () => {});

startPipeline();
