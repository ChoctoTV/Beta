'use strict';
// Logger with built-in rotation to keep total log size under 100 MB.
//
// Layout:
//   logs/app.log    — current write target
//   logs/app.log.1  — previous rotation (one backup)
//
// When app.log grows past MAX_BYTES (~48 MB), we rotate by:
//   1. close the current pino stream
//   2. rename app.log → app.log.1 (replacing any old backup)
//   3. open a fresh app.log destination
//
// Two files × 48 MB ≈ 96 MB max, comfortably under the 100 MB cap.
// Rotation is checked every 60s.

const pino = require('pino');
const path = require('path');
const fs   = require('fs');

const LOG_DIR  = path.join(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const ROT_FILE = path.join(LOG_DIR, 'app.log.1');
const MAX_BYTES = 48 * 1024 * 1024;  // 48 MB
const CHECK_MS  = 60 * 1000;          // 1 minute

fs.mkdirSync(LOG_DIR, { recursive: true });

// Trim oversize file once on boot in case the process was killed mid-write
try {
  const st = fs.statSync(LOG_FILE);
  if (st.size > MAX_BYTES) {
    try { fs.renameSync(LOG_FILE, ROT_FILE); } catch {}
  }
} catch {}

let dest = process.env.LOG_PRETTY === '1'
  ? undefined
  : pino.destination({ dest: LOG_FILE, sync: false });

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  name:  'choctotv',
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: { err: pino.stdSerializers.err },
}, dest);

// ── Periodic rotation check ────────────────────────────────────────────────
function checkRotate() {
  if (!dest) return;
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size < MAX_BYTES) return;
    // Rotate: rename current → .1, open fresh destination
    try { fs.renameSync(LOG_FILE, ROT_FILE); } catch {}
    const newDest = pino.destination({ dest: LOG_FILE, sync: false });
    // Swap pino's stream by re-flushing then reusing
    try { dest.reopen(LOG_FILE); } catch {
      // Older pino: replace by ending old and using new
      try { dest.end(); } catch {}
      dest = newDest;
    }
  } catch { /* file may not exist yet */ }
}

if (!process.env.LOG_PRETTY) {
  setInterval(checkRotate, CHECK_MS).unref();
}

module.exports = logger;
