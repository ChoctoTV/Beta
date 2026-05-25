'use strict';
const metrics = require('../observability/metrics');
const HOUR_MS = 3600000;
// userId → { until, timer, display }
const _map = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, e] of _map) if (now > e.until) { clearTimeout(e.timer); _map.delete(id); }
  metrics.set('lurk_active', _map.size);
}, 900000);

// ── Global 5s serialized queue — ONE lurker action every 5s so animations
//    never crowd each other out. Each user cycles through all actions in a
//    shuffled order (every action once before repeating).
const _globalQueue = [];  // [{ id }]  — ordered list of users waiting for their turn

setInterval(() => {
  // Purge expired entries
  let idx = 0;
  while (idx < _globalQueue.length) {
    const { id } = _globalQueue[idx];
    if (!_map.has(id) || Date.now() > _map.get(id).until) _globalQueue.splice(idx, 1);
    else idx++;
  }
  if (!_globalQueue.length) return;
  const { id } = _globalQueue.shift();
  const entry = _map.get(id);
  if (!entry || Date.now() > entry.until) return;
  // Fire action, then re-add to back of queue so it cycles
  Promise.resolve()
    .then(() => entry.onTick(id))
    .catch(() => {})
    .finally(() => {
      if (_map.has(id) && Date.now() <= _map.get(id).until) _globalQueue.push({ id });
    });
}, 5000);  // one lurker action every 5 seconds

function add(id, display, durationHr, onTick) {
  if (_map.has(id)) {
    const e = _map.get(id);
    e.until   = Date.now() + durationHr * HOUR_MS;
    e.display = display || id;
    return { existing: true };
  }
  const until = Date.now() + durationHr * HOUR_MS;
  const entry = { until, display: display || id, onTick, timer: null };
  // Stagger initial entry: join at back of queue with a short random delay
  entry.timer = setTimeout(() => { if (_map.has(id)) _globalQueue.push({ id }); },
                           500 + Math.random() * 2000);
  _map.set(id, entry);
  metrics.set('lurk_active', _map.size);
  return { existing: false };
}

function remove(id)   { const e = _map.get(id); if (!e) return false; clearTimeout(e.timer); _map.delete(id); return true; }
function isActive(id) { return _map.has(id) && Date.now() <= _map.get(id).until; }
function getLurkers() { return Array.from(_map.entries()).map(([id, e]) => ({ userId: id, display: e.display, until: e.until })); }

function save() {
  try {
    const db  = require('../db');
    const now = Date.now();
    db.prepare('DELETE FROM lurk_sessions').run();
    const ins = db.prepare('INSERT OR REPLACE INTO lurk_sessions (user_id, display, until_ms) VALUES (?,?,?)');
    db.transaction(() => { for (const [id,e] of _map) if (e.until > now) ins.run(id, e.display, e.until); })();
    console.log(`[Lurk] Saved ${_map.size} session(s)`);
  } catch (e) { console.warn('[Lurk] Save failed:', e.message); }
}

function restore(makeOnTick) {
  try {
    const db  = require('../db');
    const now = Date.now();
    const rows = db.prepare('SELECT user_id, display, until_ms FROM lurk_sessions WHERE until_ms > ?').all(now);
    let n = 0;
    for (const row of rows) {
      const remainHr = (row.until_ms - now) / 3600000;
      if (remainHr <= 0) continue;
      add(row.user_id, row.display, remainHr, makeOnTick(row.user_id, row.display));
      n++;
    }
    if (n) console.log(`[Lurk] Restored ${n} session(s)`);
    db.prepare('DELETE FROM lurk_sessions').run();
  } catch (e) { console.warn('[Lurk] Restore failed:', e.message); }
}

module.exports = { add, remove, isActive, getLurkers, save, restore };
