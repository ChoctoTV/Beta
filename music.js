'use strict';
// music.js — Standalone music service
// Scans ./music/ for .mp3/.wav, shuffles, plays via ffplay → PulseAudio
// Controlled via /tmp/choctotv_music_ctrl.json (written by app.js)
// Writes state to /tmp/choctotv_music_state.json (read by app.js for !song)

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MUSIC_DIR  = path.join(__dirname, 'music');
const CTRL_FILE  = '/tmp/choctotv_music_ctrl.json';
const STATE_FILE = '/tmp/choctotv_music_state.json';

let volume   = 50;
let enabled  = false; // starts OFF — turned on by !music on or vote
let stopping = false;
let _proc    = null;
let _current = null;
let _queue   = [];

function scan() {
  try {
    return fs.readdirSync(MUSIC_DIR)
      .filter(f => /\.mp3$/i.test(f))
      .map(f => ({ name:path.basename(f, path.extname(f)), file:path.join(MUSIC_DIR,f) }));
  } catch { return []; }
}

function shuffle(arr) {
  for (let i=arr.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  return arr;
}

function next() {
  if (!_queue.length) { const t=scan(); if(!t.length) return null; _queue=shuffle(t); }
  return _queue.shift();
}

function writeState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify({ enabled, volume, track:_current, trackCount:scan().length })); } catch {}
}

let _paReady = false;
let _paCheckTimer = null;

function waitForSink(cb, attempts=0) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('pactl', ['get-sink-volume', 'choctotv_music'],
    { timeout:2000, stdio:'pipe', encoding:'utf8' });
  if (r.status === 0) {
    _paReady = true;
    console.log('[Music] PulseAudio sink ready');
    cb();
  } else if (attempts < 20) {
    setTimeout(() => waitForSink(cb, attempts + 1), 1000);
  } else {
    console.warn('[Music] PA sink not available after 20s — playing anyway');
    _paReady = true;
    cb();
  }
}

function playNext() {
  if (stopping || !enabled) return;
  if (!_paReady) { waitForSink(() => playNext()); return; }

  const track = next();
  if (!track) { console.log('[Music] No tracks in ./music/ — add .mp3 files'); writeState(); return; }

  _current = { name:track.name, startedAt:Date.now() };
  console.log(`[Music] ♪ ${track.name}  (vol ${volume}%)`);
  writeState();

  // mpv — native PulseAudio output, built-in buffering, no pipe chain
  _proc = spawn('mpv', [
    '--no-video',
    '--no-terminal',
    '--really-quiet',
    `--volume=${volume}`,
    '--ao=pulse',
    `--audio-device=pulse/choctotv_music`,
    track.file,
  ], { stdio:'ignore' });

  const startedAt = Date.now();
  _proc.on('exit', code => {
    _proc = null;
    const duration = Date.now() - startedAt;
    _current = null; writeState();
    if (!stopping && enabled) {
      const delay = duration < 2000 ? 3000 : 300;
      if (duration < 2000) {
        console.warn(`[Music] Track ended too fast (${duration}ms) — PA sink issue, retrying in ${delay}ms`);
        _paReady = false;
      }
      setTimeout(playNext, delay);
    }
  });
}

function pollCtrl() {
  try {
    if (!fs.existsSync(CTRL_FILE)) return;
    const ctrl = JSON.parse(fs.readFileSync(CTRL_FILE, 'utf8'));
    fs.unlinkSync(CTRL_FILE);
    switch (ctrl.cmd) {
      case 'skip':
        if (_proc) { _proc.kill('SIGTERM'); }
        else if (enabled) playNext();
        break;
      case 'volume':
        volume = Math.max(0, Math.min(100, Math.round(ctrl.val)));
        if (_proc && _current) { const t={..._current}; _proc.kill('SIGTERM'); setTimeout(()=>{ if(!stopping&&enabled){ _current=t; playNext(); } },300); }
        break;
      case 'on':
        enabled = true;
        if (!_proc) playNext();
        break;
      case 'off':
        enabled = false;
        if (_proc) { _proc.kill('SIGTERM'); _proc=null; _current=null; }
        writeState();
        break;
    }
  } catch {}
}

function shutdown() {
  stopping = true;
  if (_proc) _proc.kill('SIGTERM');
  try { fs.unlinkSync(STATE_FILE); } catch {}
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

// Start
const tracks = scan();
if (tracks.length) { console.log(`[Music] Found ${tracks.length} track(s) — music is OFF by default, use !music on to start`); _queue = shuffle([...tracks]); }
else console.log('[Music] No tracks found — add .mp3/.wav to ./music/');
writeState();
setInterval(pollCtrl, 1000);
console.log('[Music] Ready');
