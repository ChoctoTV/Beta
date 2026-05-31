#!/usr/bin/env node
'use strict';
/**
 * teller.js — cashout audit and admin server on :3003
 *
 * Receives cashout confirmations from the tipbot webhook and logs them.
 * Also provides a payout history endpoint for the dashboard.
 *
 * Real cashouts go through services/Teller.js → TIPBOT_WEBHOOK_URL (env).
 * Use !cashout test in chat for a dry-run without touching the tipbot.
 *
 * teller.json (optional, in vault/) — override webhook target for this service.
 *
 * Endpoints:
 *   GET  /health      { ok, uptime }
 *   GET  /payouts     cashout history (JSON array, newest first)
 *   POST /confirm     tipbot calls this after a successful payout
 */

try { require('dotenv').config({ path: require('path').join(__dirname, 'vault', '.env') }); } catch {}

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT      = parseInt(process.env.TELLER_PORT || '3003', 10);
const VAULT_DIR = path.join(__dirname, 'vault');
const DATA_DIR  = path.join(__dirname, 'data', 'db');
const PAYOUT_LOG = path.join(__dirname, 'data', 'db', 'cashouts.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

// Optional teller.json — can override webhook or add extra fields
let tellerCfg = null;
try {
  tellerCfg = JSON.parse(fs.readFileSync(path.join(VAULT_DIR, 'teller.json'), 'utf8'));
  console.log('[Teller] teller.json loaded');
} catch {
  console.log('[Teller] No teller.json found — cashouts DISABLED');
}

console.log(`[Teller] Mock teller running on :${PORT}`);
console.log(`[Teller] Cashouts recorded to ${PAYOUT_LOG}`);
console.log(`[Teller] View all payouts: GET http://localhost:${PORT}/payouts`);

// ── Payout log helpers ────────────────────────────────────────────────────────
function loadPayouts() {
  try { return JSON.parse(fs.readFileSync(PAYOUT_LOG, 'utf8')); }
  catch { return []; }
}
function recordPayout(entry) {
  const list = loadPayouts();
  list.unshift({ ...entry, ts: new Date().toISOString() });
  if (list.length > 2000) list.length = 2000;
  fs.writeFileSync(PAYOUT_LOG, JSON.stringify(list, null, 2));
}

// ── Parse request body ────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise(resolve => {
    let s = '';
    req.on('data', c => s += c);
    req.on('end', () => {
      try { resolve(JSON.parse(s)); } catch { resolve({}); }
    });
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const json = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  // GET /health
  if (req.method === 'GET' && url === '/health') {
    return json(200, { ok: true, uptime: Math.round(process.uptime()), tellerReady: !!tellerCfg });
  }

  // GET /payouts — cashout history
  if (req.method === 'GET' && url === '/payouts') {
    return json(200, loadPayouts());
  }

  // POST /confirm — tipbot calls this to confirm a payout was delivered
  if (req.method === 'POST' && url === '/confirm') {
    const body = await readBody(req);
    if (!body.user || !body.amount) return json(400, { ok: false, error: 'user and amount required' });
    recordPayout({ type: 'confirm', ...body });
    console.log(`[Teller] Confirmed: @${body.user} +${body.amount} Choctopus`);
    return json(200, { ok: true });
  }

  // POST /cashout — legacy: some tipbots POST back to confirm (same as /confirm)
  if (req.method === 'POST' && url === '/cashout') {
    const body = await readBody(req);
    recordPayout({ type: 'cashout', ...body });
    console.log(`[Teller] Cashout logged: @${body.user || '?'} ${body.amount || '?'}`);
    return json(200, { ok: true });
  }

  json(404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Teller] Ready on :${PORT}`);
});

server.on('error', err => {
  console.error('[Teller] Server error:', err.message);
  process.exit(1);
});
