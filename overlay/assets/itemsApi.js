'use strict';
require('dotenv').config();

const express = require('express');
const fs      = require('fs');
const path    = require('path');

const PORT      = parseInt(process.env.ITEMS_PORT || '3003');
const DATA_FILE = path.resolve(__dirname, 'items.json');

// items.json format: { "Username": { sticks:0, balls:0, moons:0 } }
const app = express();
app.use(express.json());

// Localhost only
app.use((req, res, next) => {
  const ip = req.socket.remoteAddress || '';
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
  return res.status(403).json({ error: 'Forbidden' });
});

// ─── Data ─────────────────────────────────────────────────────────────────────
const ITEM_TYPES = ['sticks', 'balls', 'moons'];
let   items      = {};
let   saveTimer  = null;

function blank() { return { sticks: 0, balls: 0, moons: 0 }; }

function load() {
  try {
    items = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    console.log(`[ItemsAPI] Loaded ${Object.keys(items).length} inventories from ${DATA_FILE}`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[ItemsAPI] Load error:', e.message);
    items = {};
  }
}

function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2)); }
    catch (e) { console.error('[ItemsAPI] Save error:', e.message); }
  }, 500);
}

function ensure(user) {
  if (!items[user]) items[user] = blank();
  return items[user];
}

load();

// ─── Routes ───────────────────────────────────────────────────────────────────
// GET /items/:user — full inventory
app.get('/items/:user', (req, res) => {
  const u = req.params.user;
  res.json({ user: u, ...ensure(u) });
});

// POST /items/:user/add — add items { sticks, balls, moons }
app.post('/items/:user/add', (req, res) => {
  const u   = req.params.user;
  const inv = ensure(u);
  let   changed = false;

  for (const type of ITEM_TYPES) {
    const amt = parseInt(req.body?.[type]) || 0;
    if (amt > 0) { inv[type] += amt; changed = true; }
  }

  if (!changed) return res.status(400).json({ error: 'No valid item amounts provided' });
  save();
  res.json({ user: u, ...inv });
});

// POST /items/:user/spend — spend items { sticks, balls, moons }
// Returns error if user doesn't have enough of any item
app.post('/items/:user/spend', (req, res) => {
  const u   = req.params.user;
  const inv = ensure(u);

  // Validate first
  for (const type of ITEM_TYPES) {
    const amt = parseInt(req.body?.[type]) || 0;
    if (amt > 0 && inv[type] < amt) {
      return res.status(400).json({
        error: `Not enough ${type}: have ${inv[type]}, need ${amt}`,
        have: { ...inv },
      });
    }
  }

  // Deduct
  const spent = {};
  for (const type of ITEM_TYPES) {
    const amt = parseInt(req.body?.[type]) || 0;
    if (amt > 0) { inv[type] -= amt; spent[type] = amt; }
  }

  save();
  res.json({ user: u, spent, remaining: { ...inv } });
});

// GET /leaderboard/:type — top 10 by item type
app.get('/leaderboard/:type', (req, res) => {
  const type = req.params.type;
  if (!ITEM_TYPES.includes(type)) return res.status(400).json({ error: `Invalid type. Use: ${ITEM_TYPES.join(', ')}` });

  const board = Object.entries(items)
    .map(([user, inv]) => ({ user, amount: inv[type] || 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map((e, i) => ({ rank: i + 1, ...e }));

  res.json(board);
});

// GET /health
app.get('/health', (_req, res) => res.json({ ok: true, users: Object.keys(items).length, port: PORT }));

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => console.log(`[ItemsAPI] :${PORT}`));

process.on('SIGTERM', () => {
  if (saveTimer) { clearTimeout(saveTimer); try { fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2)); } catch {} }
  process.exit(0);
});
