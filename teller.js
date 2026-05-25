// teller.js — Cashout Teller
// Receives cashout requests from app.js, records to vault/data/cashouts.json,
// and forwards to the Discord tipbot using TELLER_ID from the Secret file.
//
// Add to Secret file:
//   # ── TELLER ──────────────────────────────────────────────
//   TELLER_ID=your_tipbot_auth_token_or_webhook_id
//   TELLER_PORT=3003
//   TELLER_BOT_URL=https://your-tipbot-endpoint.com/api/pay
//
// Endpoints:
//   POST /cashout          { username, display, choctopus, choctobits_spent, remainder }
//   GET  /payouts          → full cashouts.json
//   GET  /payouts/:user    → single user record
//   GET  /health           → status + pending queue length
'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
require('dotenv').config();

const PORT         = parseInt(process.env.TELLER_PORT || '3003');
const DATA_DIR  = path.join(__dirname, 'vault', 'data');
const VAULT_DIR = path.join(__dirname, 'vault');
const TJSON     = 'teller.json';

// ── Load teller.json — main folder takes priority, then vault/ ────────────────
// Format: { "cashout":{ "url","method","headers" }, "vcode":{ "url","method","headers" } }
let TELLER_CFG = null;
(function loadTellerJson() {
  const main    = path.join(__dirname, TJSON);
  const vaulted = path.join(VAULT_DIR, TJSON);

  let src = null;
  if (fs.existsSync(main)) {
    try {
      fs.mkdirSync(VAULT_DIR, { recursive:true });
      fs.renameSync(main, vaulted);
      console.log('[Teller] teller.json moved to vault/');
    } catch(e) { console.warn('[Teller] Could not move teller.json:', e.message); }
    src = vaulted;
  } else if (fs.existsSync(vaulted)) {
    src = vaulted;
  }

  if (!src) {
    console.log('[Teller] No teller.json found — cashouts DISABLED');
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(src, 'utf8'));
    if (!data.cashout?.url && !data.vcode?.url) {
      console.warn('[Teller] teller.json needs at least one of: cashout.url or vcode.url');
      return;
    }
    TELLER_CFG = {
      cashout: data.cashout ? {
        url:     data.cashout.url,
        method:  (data.cashout.method || 'POST').toUpperCase(),
        headers: { 'Content-Type':'application/json', ...(data.cashout.headers||{}) },
      } : null,
      vcode: data.vcode ? {
        url:     data.vcode.url,
        method:  (data.vcode.method || 'POST').toUpperCase(),
        headers: { 'Content-Type':'application/json', ...(data.vcode.headers||{}) },
      } : null,
    };
    const parts = [];
    if (TELLER_CFG.cashout) parts.push(`cashout→${new URL(TELLER_CFG.cashout.url).hostname}`);
    if (TELLER_CFG.vcode)   parts.push(`vcode→${new URL(TELLER_CFG.vcode.url).hostname}`);
    console.log(`[Teller] Configured: ${parts.join('  ')}`);
  } catch(e) { console.warn('[Teller] teller.json parse error:', e.message); }
})();

// ── Cashout FIFO queue — one at a time, in order ─────────────────────────────
// Each entry: { username, display, choctopus, choctobits_spent, remainder, resolve }
// The HTTP connection from app.js stays open until the entry is processed,
// so app.js only deducts the balance after receiving the confirmed result.
const cashoutQueue = [];
let queueBusy      = false;

async function processQueue() {
  if (queueBusy || cashoutQueue.length === 0) return;
  queueBusy = true;

  const item = cashoutQueue.shift(); // FIFO
  const { username, display, choctopus, choctobits_spent, remainder, resolve } = item;

  console.log(`[Teller] Processing: ${username} → ${choctopus} $Chocto (${cashoutQueue.length} remaining in queue)`);

  try {
    const tipResult = await forwardCashout({ username, choctopus });

    if (!tipResult.ok && !tipResult.mock) {
      console.error(`[Teller] ✗ BOT SIDE — ${username} → ${choctopus} $Chocto (tipbot ${tipResult.status || 'error'}) — balance NOT deducted`);
      resolve({ ok:false, source:'bot', error:'Tipbot did not confirm — your Choctobits were not deducted. Try again.' });
    } else {
      const data  = load();
      const now   = new Date().toISOString();
      const entry = data[username] || { display:display||username, totalChoctopus:0, lastPayout:null, lastAmount:0, payoutCount:0, currentRemainder:0, history:[] };
      entry.display = display||username; entry.totalChoctopus += choctopus;
      entry.lastPayout = now; entry.lastAmount = choctopus; entry.payoutCount += 1;
      entry.currentRemainder = remainder ?? entry.currentRemainder;
      entry.history.push({ ts:now, choctopus, choctobits_spent, remainder, confirmed:!tipResult.mock });
      data[username] = entry; save(data);

      const mode = tipResult.mock ? '(mock)' : 'confirmed by tipbot';
      console.log(`[Teller] ✓ ${username} → ${choctopus} $Chocto ${mode} | total: ${entry.totalChoctopus}`);
      resolve({ ok:true, username, choctopus, total:entry.totalChoctopus });
    }
  } catch(e) {
    console.error('[Teller] ✗ TELLER SIDE — Queue error:', e.message);
    resolve({ ok:false, source:'teller', error:'Internal teller error — try again.' });
  }

  queueBusy = false;
  setImmediate(processQueue); // process next item
}

// ── Generic HTTP forwarder using a cfg section {url, method, headers} ──────────
function doRequest(cfg, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const url  = new URL(cfg.url);
    const lib  = url.protocol === 'https:' ? https : http;
    const req  = lib.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   cfg.method || 'POST',
      headers:  { ...cfg.headers, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const ok = res.statusCode === 200; // tipbot signals success with 200 OK
        let body = null;
        try { body = JSON.parse(d); } catch {} // body is optional
        if (!ok) console.warn(`[Teller] Tipbot returned ${res.statusCode}: ${d.slice(0,120)}`);
        resolve({ ok, status: res.statusCode, body });
      });
    });
    req.on('error', (e) => { console.error('[Teller] Request error:', e.message); resolve({ ok:false, error:e.message }); });
    req.write(body); req.end();
  });
}

async function forwardCashout(payload) {
  if (!TELLER_CFG?.cashout) { console.log('[Teller] No cashout config — mock mode'); return { ok:true, mock:true }; }
  return doRequest(TELLER_CFG.cashout, payload);
}

async function forwardVcode(payload) {
  if (!TELLER_CFG?.vcode) { console.log('[Teller] No vcode config — mock mode'); return { ok:true, mock:true }; }
  return doRequest(TELLER_CFG.vcode, payload);
}
const CASHOUT_FILE = path.join(DATA_DIR, 'cashouts.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

// Verified Twitch accounts — persisted to vault/data/verified_accounts.json
// Truth is on the Discord bot side; this is the local cache used for !cashout gating.
const VERIFIED_FILE = require('path').join(DATA_DIR, 'verified_accounts.json');
function loadVerified() {
  try { return new Set(JSON.parse(require('fs').readFileSync(VERIFIED_FILE,'utf8'))); }
  catch { return new Set(); }
}
function saveVerified(set) {
  require('fs').mkdirSync(DATA_DIR, { recursive:true });
  require('fs').writeFileSync(VERIFIED_FILE, JSON.stringify([...set]));
}
const verifiedAccounts = loadVerified();

// ── Persistence ───────────────────────────────────────────────────────────────
function load() {
  try { return JSON.parse(fs.readFileSync(CASHOUT_FILE, 'utf8')); } catch { return {}; }
}
function save(data) {
  fs.writeFileSync(CASHOUT_FILE, JSON.stringify(data, null, 2));
}

// ── Request handler ───────────────────────────────────────────────────────────
function send(res, code, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(code, { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise(r => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { r(JSON.parse(d)); } catch { r({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = req.url.split('?')[0];

  // ── POST /cashout ──────────────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/cashout') {
    const body = await readBody(req);
    const { username, display, choctopus, choctobits_spent, remainder } = body;
    if (!username || !choctopus) return send(res, 400, { error: 'username and choctopus required' });
    const pos = cashoutQueue.length + (queueBusy ? 1 : 0);
    console.log(`[Teller] Queued: ${username} → ${choctopus} $Chocto (pos ${pos+1})`);
    cashoutQueue.push({
      username, display, choctopus, choctobits_spent, remainder,
      resolve: result => send(res, result.ok ? 200 : 500, result),
    });
    processQueue();
    return;
  }

  // ── GET /verified/:user — check if Twitch user has linked Discord ────────────
  if (req.method === 'GET' && url.startsWith('/verified/')) {
    const user = decodeURIComponent(url.split('/verified/')[1]);
    return send(res, 200, { verified: verifiedAccounts.has(user) });
  }

  // ── GET /payouts ───────────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/payouts') {
    return send(res, 200, load());
  }

  // ── GET /payouts/:user ─────────────────────────────────────────────────────
  if (req.method === 'GET' && url.startsWith('/payouts/')) {
    const user  = decodeURIComponent(url.split('/payouts/')[1]);
    const data  = load();
    const entry = data[user];
    if (!entry) return send(res, 404, { error: `No record for ${user}` });
    return send(res, 200, entry);
  }

  if (req.method === 'POST' && url === '/vcode') {
    const body = await readBody(req);
    const { username, twitchUsername, twitchDisplay, code } = body;
    const user = username || twitchUsername;
    if (!user || !code) return send(res, 400, { error: 'username and code required' });
    const result = await forwardVcode({
      action: 'twitch_verify', twitchUsername: user,
      twitchDisplay: twitchDisplay || user, code,
    });
    if (!result.ok && !result.mock) return send(res, 400, { ok:false, error:'Code rejected — try /twitch_verify again' });
    verifiedAccounts.add(user);
    saveVerified(verifiedAccounts);
    console.log(`[Teller] ✓ ${user} linked to Discord`);
    return send(res, 200, { ok:true });
  }

  // ── GET /health ────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/health') {
    const data   = load();
    const users  = Object.keys(data).length;
    const total  = Object.values(data).reduce((s, u) => s + (u.totalChoctopus || 0), 0);
    const mode   = TELLER_CFG?.cashout ? 'live' : 'disabled';
    const vcodeMode = TELLER_CFG?.vcode ? 'live' : 'disabled';
    return send(res, 200, { ok:true, service:'teller', cashout:mode, vcode:vcodeMode, users, totalChoctopusPaid:total, queueDepth:cashoutQueue.length + (queueBusy ? 1 : 0) });
  }

  send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[Teller] Mock teller running on :${PORT}`);
  console.log(`[Teller] Cashouts recorded to ${CASHOUT_FILE}`);
  console.log(`[Teller] View all payouts: GET http://localhost:${PORT}/payouts`);
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[Teller] Port ${PORT} in use — killing stale instance and retrying in 2s`);
    const { execSync } = require('child_process');
    try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`); } catch {}
    setTimeout(() => server.listen(PORT), 2000);
  } else {
    console.error('[Teller] Fatal:', e.message);
    process.exit(1);
  }
});
