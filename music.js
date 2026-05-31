'use strict';
// music.js — Standalone music service
// Single persistent mpv instance with a shuffled playlist:
//   • --gapless-audio=yes      seamless track-to-track transitions
//   • --prefetch-playlist=yes  buffers the NEXT track while the current one plays
//   • --cache=yes + big demuxer buffer  buffers the whole song up front
// Controlled live over mpv's JSON IPC socket (no per-track process spawn = no gaps).
// Control file: /tmp/choctotv_music_ctrl.json (written by app.js)
// State file:   /tmp/choctotv_music_state.json (read by app.js for !song)

const fs   = require('fs');
const path = require('path');
const net  = require('net');
const { spawn, spawnSync } = require('child_process');
const os   = require('os');

// Detect taskset availability (privilege-free CPU pinning)
const HAS_TASKSET = (() => {
  try { return spawnSync('taskset', ['--version'], { stdio:'ignore' }).status === 0; } catch { return false; }
})();
const CPU_CORES = (() => { try { return os.cpus().length; } catch { return 2; } })();
// Reserve the LAST core exclusively for music so renderer/encoder load can't starve audio.
const MUSIC_CORE = CPU_CORES >= 3 ? CPU_CORES - 1 : null;

// Wrap an mpv invocation so it runs pinned to the music core (its own "layer").
function spawnPlayer(mpvArgs) {
  let proc;
  if (MUSIC_CORE !== null && HAS_TASKSET) {
    console.log(`[Music] Pinned to dedicated CPU core ${MUSIC_CORE} (isolated from renderer)`);
    proc = spawn('taskset', ['-c', String(MUSIC_CORE), 'mpv', ...mpvArgs],
      { stdio:['ignore','ignore','pipe'] });
  } else {
    proc = spawn('mpv', mpvArgs, { stdio:['ignore','ignore','pipe'] });
  }
  // Surface mpv errors (sink missing, bad device, decode fail) into the log
  if (proc.stderr) proc.stderr.on('data', d => {
    const s = d.toString().trim();
    if (s) console.error('[Music][mpv] ' + s.slice(0, 200));
  });
  proc.on('error', e => console.error('[Music] Failed to launch mpv: ' + e.message));
  return proc;
}

const MUSIC_DIR  = path.join(__dirname, 'music');
const CTRL_FILE  = '/tmp/choctotv_music_ctrl.json';
const STATE_FILE = '/tmp/choctotv_music_state.json';
const SOCK       = '/tmp/choctotv_mpv.sock';
const PLAYLIST   = '/tmp/choctotv_playlist.txt';

let volume   = 50;
let enabled  = false; // starts OFF — turned on by !music on or vote
let stopping = false;
let _proc    = null;
let _ipc     = null;
let _current = null;

function scan() {
  try {
    return fs.readdirSync(MUSIC_DIR)
      .filter(f => /\.(mp3|wav|flac|ogg|m4a)$/i.test(f))
      .map(f => ({ name:path.basename(f, path.extname(f)), file:path.join(MUSIC_DIR,f) }));
  } catch { return []; }
}

function shuffle(arr) {
  for (let i=arr.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  return arr;
}

function writeState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify({ enabled, volume, track:_current, trackCount:scan().length })); } catch {}
}

// ── PulseAudio sink readiness ─────────────────────────────────────────────────
let _paReady = false;
function waitForSink(cb, attempts=0) {
  const r = spawnSync('pactl', ['get-sink-volume', 'choctotv_music'],
    { timeout:2000, stdio:'pipe', encoding:'utf8' });
  if (r.status === 0) { _paReady = true; console.log('[Music] PulseAudio sink ready'); cb(); }
  else if (attempts < 20) { setTimeout(() => waitForSink(cb, attempts + 1), 1000); }
  else { console.warn('[Music] PA sink not available after 20s — playing anyway'); _paReady = true; cb(); }
}

// ── mpv IPC ───────────────────────────────────────────────────────────────────
function sendIPC(obj) {
  if (_ipc && _ipc.writable) { try { _ipc.write(JSON.stringify(obj) + '\n'); } catch {} }
}

function connectIPC(attempts=0) {
  _ipc = net.connect(SOCK);
  _ipc.on('connect', () => {
    // Observe the current file path so we always know what's playing
    sendIPC({ command:['observe_property', 1, 'path'] });
    sendIPC({ command:['set_property', 'volume', volume] });
  });
  let buf = '';
  _ipc.on('data', d => {
    // Detect track start and broadcast cleaned filename
    try {
      const lines = d.toString().trim().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.event === 'file-loaded') {
          // Request filename from mpv
          if (_ipc && _ipc.writable) {
            _ipc.write(JSON.stringify({command:['get_property','filename/no-ext'],'request_id':999}) + '\n');
          }
        }
        if (msg.request_id === 999 && msg.data) {
          const raw = msg.data.replace(/\.mp3$|\.wav$|\.flac$|\.ogg$/i,'');
          if (_broadcast) _broadcast({ type:'music_track', track: raw });
          console.log('[Music] Now playing:', raw);
        }
      }
    } catch {}

    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.event === 'property-change' && msg.name === 'path' && msg.data) {
          const name = path.basename(msg.data, path.extname(msg.data));
          _current = { name, startedAt: Date.now() };
          console.log(`[Music] ♪ ${name}  (vol ${volume}%)`);
          writeState();
        }
      } catch {}
    }
  });
  _ipc.on('error', () => {});
  _ipc.on('close', () => {
    _ipc = null;
    // Reconnect while mpv should be alive
    if (!stopping && _proc && attempts < 30) setTimeout(() => connectIPC(attempts + 1), 500);
  });
}

// ── Start the persistent mpv player ────────────────────────────────────────────
function startMpv() {
  if (_proc) return;
  if (!_paReady) { waitForSink(() => startMpv()); return; }
  // Confirm the sink exists right before launch
  const sinkCheck = spawnSync('pactl', ['list', 'short', 'sinks'], { encoding:'utf8', timeout:2000, stdio:'pipe' });
  if (sinkCheck.status === 0 && !(sinkCheck.stdout||'').includes('choctotv_music')) {
    console.error('[Music] ⚠ sink "choctotv_music" not found — stream service must create it first. Retrying in 3s.');
    setTimeout(() => { _paReady = false; if (enabled) startMpv(); }, 3000);
    return;
  }

  const tracks = shuffle(scan());
  if (!tracks.length) { console.log('[Music] No tracks in ./music/ — add audio files'); writeState(); return; }

  try { fs.writeFileSync(PLAYLIST, tracks.map(t => t.file).join('\n')); } catch {}
  try { if (fs.existsSync(SOCK)) fs.unlinkSync(SOCK); } catch {}

  _proc = spawnPlayer([
    '--no-video', '--no-terminal', '--msg-level=all=error',  // show errors (not silent) so we can diagnose
    '--ao=pulse', '--audio-device=pulse/choctotv_music',
    `--volume=${volume}`,
    '--idle=yes',                  // stay alive even when idle
    '--loop-playlist=inf',         // loop the shuffled set forever
    '--gapless-audio=yes',         // seamless track transitions
    '--prefetch-playlist=yes',     // BUFFER NEXT TRACK while current plays
    '--cache=yes',
    '--demuxer-max-bytes=64MiB',   // buffer the whole song up front
    '--demuxer-readahead-secs=30',
    '--audio-buffer=1.0',          // 1s output buffer — rides out renderer CPU spikes
    '--audio-pitch-correction=no',
    // ── Lower output quality for smoother playback on constrained CPU ──
    '--audio-samplerate=44100',    // 44.1kHz output — known-working, lighter than 48k float
    '--audio-format=s16',          // 16-bit samples (half the data of float)
    '--audio-channels=stereo',
    `--input-ipc-server=${SOCK}`,
    `--playlist=${PLAYLIST}`,
  ]);

  _proc.on('exit', () => {
    _proc = null; _current = null; writeState();
    if (!stopping && enabled) {
      console.warn('[Music] mpv exited unexpectedly — restarting in 2s');
      _paReady = false;
      setTimeout(() => { if (!stopping && enabled) startMpv(); }, 2000);
    }
  });

  // Connect IPC shortly after spawn (socket needs a moment to appear)
  setTimeout(() => connectIPC(), 600);
  writeState();
}

// ── Control polling ─────────────────────────────────────────────────────────
function pollCtrl() {
  try {
    if (!fs.existsSync(CTRL_FILE)) return;
    const ctrl = JSON.parse(fs.readFileSync(CTRL_FILE, 'utf8'));
    fs.unlinkSync(CTRL_FILE);
    switch (ctrl.cmd) {
      case 'skip':
        // Instant — next track is already prebuffered
        if (_proc) sendIPC({ command:['playlist-next', 'force'] });
        else if (enabled) startMpv();
        break;
      case 'volume':
        volume = Math.max(0, Math.min(100, Math.round(ctrl.val)));
        sendIPC({ command:['set_property', 'volume', volume] }); // live, no restart
        writeState();
        break;
      case 'on':
        enabled = true;
        if (!_proc) startMpv();   // spawn fresh — fully released when off
        writeState();
        break;
      case 'off':
        enabled = false;
        // FULLY stop mpv so it frees its CPU core + audio buffers.
        // Leaving it paused kept it resident and starved the renderer (persistent stutter).
        if (_ipc) { try { _ipc.end(); } catch {} _ipc = null; }
        if (_proc) { try { _proc.kill('SIGTERM'); } catch {} _proc = null; }
        _current = null;
        try { if (fs.existsSync(SOCK)) fs.unlinkSync(SOCK); } catch {}
        writeState();
        break;
    }
  } catch {}
}

function shutdown() {
  stopping = true;
  if (_ipc) { try { _ipc.end(); } catch {} }
  if (_proc) _proc.kill('SIGTERM');
  try { fs.unlinkSync(STATE_FILE); } catch {}
  try { if (fs.existsSync(SOCK)) fs.unlinkSync(SOCK); } catch {}
  setTimeout(() => process.exit(0), 1000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

// ── Start ──────────────────────────────────────────────────────────────────
const tracks = scan();
if (tracks.length) console.log(`[Music] Found ${tracks.length} track(s) — music is OFF by default, use !music on to start`);
else console.log('[Music] No tracks found — add .mp3/.wav/.flac/.ogg/.m4a to ./music/');
writeState();
setInterval(pollCtrl, 1000);
console.log('[Music] Ready');
