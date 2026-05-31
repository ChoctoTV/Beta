'use strict';

// ── 1. Secret file loader — runs before anything else ─────────────────────────
(function loadSecrets() {
  const fs = require('fs'), path = require('path');
  const dir    = __dirname;
  const vaultD = path.join(dir, '..', 'vault');

  function findSecret(searchDir) {
    try {
      const files = fs.readdirSync(searchDir);
      // Explicitly exclude template files and any file with a double extension like .template.txt
      const isExcluded = f => /\.template\./i.test(f) || /template/i.test(f);
      for (const test of [
        f => /^secret\(live\)\.txt$/i.test(f),
        f => /^secret\(beta\)\.txt$/i.test(f),
        f => /^secret.*\.txt$/i.test(f) && !isExcluded(f),
      ]) { const m = files.find(test); if (m) return m; }
    } catch {}
    return null;
  }

  function parseFile(fullPath) {
    const vars = {};
    for (const line of fs.readFileSync(fullPath,'utf8').split('\n')) {
      const clean = line.replace(/\r/,'').trim();
      if (!clean || clean.startsWith('#')) continue;
      const eq = clean.indexOf('=');
      if (eq < 1) continue;
      const k = clean.slice(0,eq).trim();
      const v = clean.slice(eq+1).trim().replace(/(\s{2,}|\t)#.*$/,'');
      if (k) vars[k] = v;
    }
    return vars;
  }

  function writeEnv(vars) {
    // Only write the vars explicitly from the Secret file — never dump all process.env
    // which contains system vars (DEBUGINFOD_URLS, XDG_*, DBUS_*, etc.) that break bash source
    fs.mkdirSync(vaultD, { recursive:true });
    const lines = Object.entries(vars)
      .filter(([k,v]) => k && v !== undefined && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
      .map(([k,v]) => `${k}=${v}`)
      .join('\n');
    fs.writeFileSync(path.join(dir,'.env'), lines+'\n');
  }

  let sf = findSecret(dir), sfDir = dir, archived = false;
  if (!sf) { sf = findSecret(vaultD); sfDir = vaultD; archived = !!sf; }

  if (sf) {
    const vars = parseFile(path.join(sfDir, sf));
    for (const [k,v] of Object.entries(vars)) process.env[k] = v;
    const isLive = sf.toLowerCase().includes('live');
    process.env.IS_LIVE_MODE = isLive ? '1' : '0';
    vars.IS_LIVE_MODE = process.env.IS_LIVE_MODE;
    writeEnv(vars);
    if (!archived) { fs.mkdirSync(vaultD,{recursive:true}); fs.renameSync(path.join(dir,sf), path.join(vaultD,sf)); }
    console.log(`[Config] ${sf} (${isLive?'LIVE':'BETA'}): ${Object.keys(vars).length} values → ${archived?'vault (cached)':'archived to vault/'}`);
  } else if (fs.existsSync(path.join(dir,'..','vault','.env'))) {
    require('dotenv').config({ path: path.join(dir,'..','vault','.env') });
    console.log('[Config] Using existing .env');
  } else {
    require('dotenv').config({ path: path.join(dir,'..','vault','.env') });
    console.log('[Config] WARNING: No Secret file found — using process env');
  }
})();

// ── 2. Imports ─────────────────────────────────────────────────────────────────
const path       = require('path');
const P          = require('./core/Paths');
// Restore player data from vault backup BEFORE opening the DB
require('./services/PersistenceGuard').restore();
const fs         = require('fs');
const http       = require('http');
const log        = require('./observability/logger');
require('fs').mkdirSync(require('path').join(__dirname,'..','data','pids'), { recursive:true });
const metrics    = require('./observability/metrics');
const Broadcast  = require('./core/Broadcast');
const Chat       = require('./core/Chat');
const Config     = require('./core/Config');
const CmdLoader  = require('./core/CommandLoader');
const db         = require('./db');
const Balance    = require('./db/models/Balance');
const Inventory  = require('./db/models/Inventory');
const Roles      = require('./db/models/Roles');
const PupCore       = require('./services/PupCoreClient');
const SpriteManager       = require('./core/SpriteManager');
const ClassifiedsManager  = require('./core/ClassifiedsManager');
const ChannelPoints       = require('./services/ChannelPoints');
const OAuthManager        = require('./services/OAuthManager');
const TwitchAPI           = require('./services/TwitchAPI');
const Teller     = require('./services/Teller');
const Lurk       = require('./economy/lurk');
const GBM        = require('./economy/gbm');
const Lottery    = require('./economy/lottery');
const Duty       = require('./economy/duty');
const Activity   = require('./economy/activity');
const AnnCmd     = require('./commands/announcements');

// ── Runtime state flags ───────────────────────────────────────────────────────
let _adBreakActive = false;   // true while an ad break is running

const CHANNEL = (process.env.TWITCH_CHANNEL || process.env.CHANNEL || '').toLowerCase();
const API_PORT = parseInt(process.env.API_PORT || '3000');
const WS_PORT  = parseInt(process.env.WS_PORT  || '3001');

// Last lottery draw — served at GET /lottery/today
let _lastLotteryDraw = null;

// ── 3. Command context factory ─────────────────────────────────────────────────
function makeCtx(base) {
  // Detect current howliday via calendar helper (shared logic)
  let isHowliday = false;
  try {
    const { getChoctoDay } = require('./services/ChoctoCalendarHelper');
    isHowliday = getChoctoDay().isHowliday;
  } catch {}

  return {
    ...base,
    say:            msg => chat.say(msg),
    broadcast:      Broadcast.broadcast,
    db,
    cfg:            key => Config.get(key),
    CHANNEL,
    Balance, Inventory, Roles,
    PupCore, Teller,
    SpriteManager,
    Lurk, GBM, Lottery, Duty, Activity,
    isHowliday,
    adBreakActive:  _adBreakActive,
    loader,
  };
}

// ── 4. Load commands ───────────────────────────────────────────────────────────
const loader = new CmdLoader();
loader.load(path.join(__dirname, 'commands'));
PupCore.setEventBroadcast(Broadcast.broadcast);

// ── 5. Chat ────────────────────────────────────────────────────────────────────
const chat = new Chat(loader, makeCtx);

// ── 6. HTTP server ─────────────────────────────────────────────────────────────
// ── Rolling reward history — module scope so HTTP handler can access it ──────
const _rewardHistory = []; // [{ts, amount, userId, user}]
// ── Subscriber XP action counter — every 5th active game gives +1 bonus XP ──
const _subXpCounters = new Map(); // userId → count (1-5)
const EIGHT_HOURS = 8 * 60 * 60 * 1000;
function _pruneRewards() {
  const cutoff = Date.now() - EIGHT_HOURS;
  while (_rewardHistory.length && _rewardHistory[0].ts < cutoff) _rewardHistory.shift();
}

const server = http.createServer(async (req, res) => {
  let url = req.url.split('?')[0];
  try { url = decodeURIComponent(url); } catch {}  // "The%20OG.png" → "The OG.png" 

  // ── Cached background-removed NFT images: vault/data/nobg/<num>_nobg.png ──────
  if (url.startsWith('/nobg/')) {
    const fsM = require('fs'), pathM = require('path');
    const fname = pathM.basename(url);  // prevent traversal
    const fp = require('path').join(P.nobg, fname);
    try {
      const data = fsM.readFileSync(fp);
      res.writeHead(200, { 'Content-Type':'image/png', 'Access-Control-Allow-Origin':'*', 'Cache-Control':'public,max-age=604800' });
      return res.end(data);
    } catch { res.writeHead(404); return res.end('not found'); }
  }
  if (url === '/savenobg' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 8e6) req.destroy(); }); // 8MB cap
    req.on('end', () => {
      try {
        const { num, dataUrl } = JSON.parse(body);
        const clean = String(num||'').replace(/[^A-Za-z0-9_-]/g, '');  // safe filename
        if (!clean || !dataUrl) { res.writeHead(400); return res.end('bad'); }
        const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        const fsM = require('fs'), pathM = require('path');
        const dir = P.nobg;
        fsM.mkdirSync(dir, { recursive:true });
        fsM.writeFileSync(pathM.join(dir, `${clean}_nobg.png`), Buffer.from(b64, 'base64'));
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:true, file:`${clean}_nobg.png` }));
      } catch (e) { res.writeHead(500); res.end('err'); }
    });
    return;
  }

  // ── GET /ticker — serve ticker.txt with config variable substitution ─────
  if (url === '/ticker') {
    try {
      const fsM = require('fs'), pathM = require('path');
      // Use vault/ticker.txt if present, fall back to config/ticker.txt
      const tickerPath = fsM.existsSync(P.ticker) ? P.ticker : P.tickerDef;
      let txt = fsM.readFileSync(tickerPath, 'utf8');
      // Substitute {config_key} tokens with live config values
      txt = txt.replace(/\{(\w+)\}/g, (_, key) => {
        const val = Config.get(key);
        return (val != null) ? String(val) : `{${key}}`;
      });
      // Parse into [{label, desc}] — skip comments and blanks
      const items = txt.split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'))
        .map(l => {
          const pipe = l.indexOf('|');
          if (pipe === -1) return null;
          return { label: l.slice(0, pipe).trim(), desc: l.slice(pipe + 1).trim() };
        })
        .filter(Boolean);
      res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-cache',
        'Access-Control-Allow-Origin':'*' });
      return res.end(JSON.stringify(items));
    } catch (e) {
      res.writeHead(500); return res.end('ticker error: ' + e.message);
    }
  }

  // ── GET /nftimg?url=<encoded> — proxy NFT images (fixes CORS for bg removal) ──
  if (url === '/nftimg') {
    const q = require('url').parse(req.url, true).query;
    let target = q.url || '';
    if (!target) { res.writeHead(400); return res.end('missing url'); }
    // Normalize IPFS/Arweave URIs to a gateway
    if (target.startsWith('ipfs://')) target = 'https://ipfs.io/ipfs/' + target.slice(7);
    if (target.startsWith('ar://'))   target = 'https://arweave.net/' + target.slice(5);
    if (!/^https?:\/\//.test(target)) { res.writeHead(400); return res.end('bad url'); }
    try {
      const lib = target.startsWith('https') ? require('https') : require('http');
      const doFetch = (u, depth=0) => {
        if (depth > 4) { res.writeHead(508); return res.end('too many redirects'); }
        lib.get(u, { headers:{ 'User-Agent':'ChoctoTV/1.0' }, timeout:8000 }, upstream => {
          // Follow redirects
          if ([301,302,307,308].includes(upstream.statusCode) && upstream.headers.location) {
            upstream.resume(); return doFetch(upstream.headers.location, depth+1);
          }
          if (upstream.statusCode !== 200) { res.writeHead(upstream.statusCode); return res.end('upstream '+upstream.statusCode); }
          res.writeHead(200, {
            'Content-Type': upstream.headers['content-type'] || 'image/png',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public,max-age=86400',
          });
          upstream.pipe(res);
        }).on('error', () => { try { res.writeHead(502); res.end('fetch error'); } catch {} })
          .on('timeout', function(){ this.destroy(); try { res.writeHead(504); res.end('timeout'); } catch {} });
      };
      doFetch(target);
    } catch (e) { res.writeHead(500); res.end('proxy error'); }
    return;
  }

  if (url === '/health' || url === '/status') {
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({ ok:true, ...metrics.status(), wsClients:Broadcast.clientCount() }));
  }

  // ── Admin: hot-reload endpoints (localhost only) ──────────────────────────
  if (url.startsWith('/admin/')) {
    const isLocal = ['::1','127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    if (!isLocal) { res.writeHead(403); return res.end('Forbidden'); }
    if (url === '/admin/reload' && req.method === 'POST') {
      const n = loader.reload();
      chat.say(`🔄 Commands hot-reloaded — ${n} active.`);
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ ok:true, commands:n }));
    }
    if (url === '/admin/status') {
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ ok:true, commands:loader.size(), uptime:Math.round(process.uptime()) }));
    }
    res.writeHead(404); return res.end('Not found');
  }

  // ── GET /sol-price — server-side SOL price fetch (avoids browser CORS) ─────
  // ── GET /reward-stats — rolling reward stats for ticker ─────────────────────
  if (url === '/reward-stats') {
    _pruneRewards();
    const now     = Date.now();
    const ONE_HR  = 3600000;
    const lastHr  = _rewardHistory.filter(r => now - r.ts < ONE_HR);
    const totalAll = _rewardHistory.reduce((s, r) => s + r.amount, 0);
    const hrs     = Math.max(1, Math.min(8, _rewardHistory.length ? (now - _rewardHistory[0].ts) / ONE_HR : 1));
    const avgHr   = Math.round(totalAll / hrs);
    let topUser = null, topAmt = 0;
    for (const r of lastHr) {
      if (r.amount > topAmt) { topAmt = r.amount; topUser = r.user; }
    }
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({ avgHr, topUser, topAmt }));
  }

  if (url === '/sol-price') {
    try {
      const _https = require('https');
      const _data  = await new Promise((resolve, reject) => {
        const req = _https.get('https://api.binance.com/api/v3/ticker/24hr?symbol=SOLUSDT', res => {
          let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
        });
        req.on('error', reject);
        req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      const j = JSON.parse(_data);
      const price = parseFloat(j.lastPrice), ch = parseFloat(j.priceChangePercent);
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ price: isNaN(price)?null:price, ch: isNaN(ch)?null:ch }));
    } catch(e) {
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ price:null, ch:null, error:e.message }));
    }
  }

  if (url === '/metrics') {
    res.writeHead(200, {'Content-Type':'text/plain'});
    return res.end(metrics.prometheus());
  }
  if (url === '/announcements') {
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify(AnnCmd.getAll()));
  }
  if (url === '/coins') {
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify(db.prepare('SELECT sym,id,color FROM coins ORDER BY added_at').all()));
  }
  if (url === '/lottery/today') {
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify(_lastLotteryDraw || null));
  }
  if (url === '/scrollsites') {
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify(db.prepare('SELECT url FROM scroll_sites ORDER BY added_at').all().map(r=>r.url)));
  }
  // ── GET /classifieds — hourly cached Magic Eden listings ──────────────────
  if (url === '/classifieds') {
    res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'public,max-age=60' });
    return res.end(JSON.stringify(ClassifiedsManager.getCachedNFTs()));
  }


  if (url === '/gauntlet/leaderboard') {
    const rows = db.prepare('SELECT u.display,g.wins,g.runs FROM gauntlet_scores g JOIN users u ON u.id=g.user_id ORDER BY g.wins DESC LIMIT 20').all();
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify(rows));
  }
  // Overlay posts back which announcement was last shown (drives !lastannounce)
    // POST /command — chat.js sends commands programmatically as the streamer
  if (url === '/command' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { command, user, args = [] } = JSON.parse(body);
        const mod = loader.get(command);
        if (!mod) { res.writeHead(404,{'Content-Type':'application/json'}); return res.end(JSON.stringify({ok:false,error:`Unknown: ${command}`})); }
        const ctx = makeCtx({ userId:CHANNEL, user:user||CHANNEL, args, cmd:command,
          isSub:false, isMod:true, isDev:true, isStreamer:true, tags:{} });
        const result = await Promise.resolve(mod.execute(ctx));
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify(result||{ok:true}));
      } catch(e) {
        res.writeHead(500,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false,error:e.message}));
      }
    });
    return;
  }

  if (url === '/api/lastannounce' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { const { text } = JSON.parse(body); if (text) AnnCmd.setLastShown(text); } catch {}
      res.writeHead(204); res.end();
    });
    return;
  }

  // Serve overlay static files (index.html, renderer.js, modules/, etc.)
  const staticDir = P.overlay;

  // Serve assets/ directory under /assets/ URL
  // Covers: /assets/pups/{rarity}/{name}.png
  //         /assets/sprites_meta.json
  //         /assets/itemsApi.js
  //         /assets/billboard/{...}
  //         /assets/other assets/{...}
  if (url.startsWith('/assets/')) {
    const sub       = decodeURIComponent(url.slice('/assets/'.length));
    const assetsDir = path.join(__dirname, '..', 'assets');
    const assetPath = path.normalize(path.join(assetsDir, sub));
    if (!assetPath.startsWith(assetsDir)) { res.writeHead(403); return res.end('Forbidden'); }
    try {
      const data = require('fs').readFileSync(assetPath);
      const ext  = assetPath.split('.').pop().toLowerCase();
      const mime = { html:'text/html', js:'application/javascript', css:'text/css',
                     json:'application/json', png:'image/png', jpg:'image/jpeg',
                     svg:'image/svg+xml', mp3:'audio/mpeg', wav:'audio/wav',
                     ogg:'audio/ogg', flac:'audio/flac', m4a:'audio/mp4' }[ext] || 'application/octet-stream';
      res.writeHead(200, {'Content-Type':mime, 'Cache-Control':'public,max-age=3600'});
      return res.end(data);
    } catch { res.writeHead(404); return res.end('Not found'); }
  }
  const filePath  = url === '/' ? '/index.html' : url;
  try {
    const resolved = path.normalize(path.join(staticDir, filePath));
    if (!resolved.startsWith(staticDir)) { res.writeHead(403); res.end('Forbidden'); return; }
    const data = require('fs').readFileSync(resolved);
    const ext  = filePath.split('.').pop().toLowerCase();
    const mime = {
      html:'text/html', js:'application/javascript', css:'text/css',
      json:'application/json', png:'image/png', svg:'image/svg+xml',
      jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp',
      gif:'image/gif',  bmp:'image/bmp',   tiff:'image/tiff',
      avif:'image/avif',heic:'image/heic', ico:'image/x-icon',
      woff2:'font/woff2', woff:'font/woff', ttf:'font/ttf',
    }[ext] || (filePath.startsWith('/assets/') ? 'image/png' : 'application/octet-stream');
    res.writeHead(200, {'Content-Type': mime});
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});

// ── 7. Schedulers ──────────────────────────────────────────────────────────────
// Announcement expiry — run on boot, then each midnight UTC
AnnCmd.expire(null);
(function scheduleAnnExpiry() {
  const now  = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()+1));
  setTimeout(() => { AnnCmd.expire(Broadcast.broadcast); scheduleAnnExpiry(); }, next - now);
})();

// Lottery draw — each midnight UTC
(function scheduleLottery() {
  const now  = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()+1));
  setTimeout(async () => {
    const result = Lottery.draw(Config.get.bind(Config));
    _lastLotteryDraw = { ...result, drawnAt: new Date().toISOString() };
    if (result.results.length) {
      result.results.forEach(r => {
        Balance.add(r.userId, r.prize, r.userId);
        chat.say(`🎰 ${r.emoji} @${r.userId} matched ${r.matches}/4! +${r.prize.toLocaleString()}🍫 (${r.tier})`);
      });
      chat.say(`🎰 Lottery drawn: ${result.drawn}. ${result.results.length} winner(s)!`);
    } else {
      chat.say(`🎰 Lottery drawn: ${result.drawn}. No winners — set ticket with !lottoupdate XXXX`);
    }
    // overlay listens for event:lottery:draw
    Broadcast.broadcast({ type:'lottery:draw', ...result });
    scheduleLottery();
  }, next - now);
})();

// ── 8. Boot ────────────────────────────────────────────────────────────────────
Broadcast.init(WS_PORT);
SpriteManager.setEventBroadcast(Broadcast.broadcast);
ClassifiedsManager.setEventBroadcast(Broadcast.broadcast);
ClassifiedsManager.init();
SpriteManager.changeWeather(Config.get.bind(Config)); // start weather cycle
server.listen(API_PORT, () => log.info({ port:API_PORT }, 'HTTP listening'));

// Prime the chat token synchronously from vault/env so chat connects immediately
OAuthManager.primeToken();

// Connect chat FIRST — never blocked by OAuth scope upgrades or device flow
chat.connect()
  .then(() => {
  log.info({ channel:CHANNEL }, 'ChoctoTV v3 ready');

  // ── PersistenceGuard: backup player data every 10min + on shutdown ─────────
  require('./services/PersistenceGuard').init(db);
  // ── NEW: Ensure the streamer always has Dev role on startup ─────────────────
  // This means the channel owner never needs to manually !dev themselves.
  try {
    if (CHANNEL && !Roles.isDev(CHANNEL)) {
      Roles.setRole(CHANNEL, 'dev');
      log.info({ channel: CHANNEL }, '[Startup] Streamer auto-set as Dev by default');
    }
  } catch (_devErr) {
    log.warn({ err: _devErr.message }, '[Startup] Could not auto-set streamer Dev role');
  }

  // OAuth maintenance runs in BACKGROUND — refreshes token, never blocks chat.
  // Device flow only happens via ./start.sh updatescopes (allowDeviceFlow stays false here).
  OAuthManager.ensureToken(process.env.TWITCH_CLIENT_ID, false)
    .then(() => OAuthManager.scheduleRefresh(process.env.TWITCH_CLIENT_ID))
    .catch(e => log.warn({ err:e.message }, 'OAuth maintenance skipped'));

  // ── TwitchAPI init ────────────────────────────────────────────────────────
  const _apiToken  = process.env.TWITCH_OAUTH_TOKEN;
  const _apiClient = process.env.TWITCH_CLIENT_ID;
  if (_apiToken && _apiClient) {
    TwitchAPI.init(_apiToken, _apiClient);

    // Mod sync: pull Twitch mod list → auto-grant in-game mod roles every 10 min
    const CalHelper = require('./services/ChoctoCalendarHelper');
    async function syncTwitchMods() {
      try {
        const mods = await TwitchAPI.fetchMods(CHANNEL);
        for (const login of mods) {
          if (!Roles.isMod(login)) {
            Roles.setRole(login, 'mod');
            log.info({ user: login }, '[ModSync] Twitch mod auto-granted game mod role');
          }
        }
      } catch (e) { log.warn({ err: e.message }, '[ModSync] Failed'); }
    }
    syncTwitchMods();
    setInterval(syncTwitchMods, 10 * 60 * 1000);

    // Follow cache: userId → { follows, ts }
    const _followCache = new Map();
    const FOLLOW_CACHE_MS = 10 * 60 * 1000;
    global._choctoFollowCheck = async function(userId) {
      const cached = _followCache.get(userId);
      if (cached && Date.now() - cached.ts < FOLLOW_CACHE_MS) return cached.follows;
      const follows = await TwitchAPI.isFollower(userId).catch(() => true);
      _followCache.set(userId, { follows, ts: Date.now() });
      return follows;
    };

    // ── Billboard ad subscriber check ────────────────────────────────────────
    // Files in ads/ named <twitchusername>.<ext> are subscriber-verified.
    // Non-subs and lapsed subs move to review/. Manifest is rewritten so the
    // overlay picks up changes on its next 15-min refresh (or via !loadboard).
    // Runs at startup and every hour so lapsed subs are caught automatically.
    const BILLBOARD_BASE = P.billboard;
    async function checkBillboardAds() {
      try {
        const adsDir  = path.join(BILLBOARD_BASE, 'ads');
        const revDir  = path.join(BILLBOARD_BASE, 'review');
        const mainDir = path.join(BILLBOARD_BASE, 'main');
        [adsDir, revDir, mainDir].forEach(d => fs.mkdirSync(d, { recursive:true }));
        const isImg = f => !/\.(txt|md|json|js|sh|log)$/i.test(f) && !f.startsWith('.');
        const adsRaw = fs.readdirSync(adsDir).filter(isImg).sort();
        const approvedAds = [];
        for (const f of adsRaw) {
          const username = f.replace(/\.[^.]+$/, '').toLowerCase();
          try {
            const uid   = await TwitchAPI.getUserIdByLogin(username).catch(() => null);
            const isSub = uid ? await TwitchAPI.isSubscriber(uid).catch(() => false) : false;
            if (isSub) {
              approvedAds.push('./assets/billboard/ads/' + encodeURIComponent(f));
            } else {
              fs.renameSync(path.join(adsDir, f), path.join(revDir, f));
              log.info({ file:f }, '[Billboard] moved to review — not subscribed');
            }
          } catch (e) {
            try { fs.renameSync(path.join(adsDir, f), path.join(revDir, f)); } catch {}
            log.warn({ file:f, err:e.message }, '[Billboard] ad check failed — moved to review');
          }
        }
        const mainFiles = fs.readdirSync(mainDir).filter(isImg).sort()
          .map(f => './assets/billboard/main/' + encodeURIComponent(f));
        fs.writeFileSync(
          path.join(BILLBOARD_BASE, 'manifest.json'),
          JSON.stringify({ main: mainFiles, ads: approvedAds }, null, 2)
        );
        log.info({ main: mainFiles.length, ads: approvedAds.length }, '[Billboard] manifest updated');
      } catch (e) { log.warn({ err: e.message }, '[Billboard] ad check error'); }
    }
    checkBillboardAds();
    setInterval(checkBillboardAds, 7 * 24 * 60 * 60 * 1000);

    // ── Hourly passive XP payout — userLevel + nftLevel Choctobits ────────────
    setInterval(() => {
      try {
        const PupXP = require('./economy/pupXP');
        const _db   = require('./db');
        const rows  = _db.prepare('SELECT user_id FROM user_xp WHERE xp > 0').all();
        let total = 0;
        for (const { user_id } of rows) {
          const uStats  = PupXP.getUserStats(_db, user_id);
          const _state  = PupCore.getCachedState(user_id);
          const _mint   = _state?.favPupMint;
          const nStats  = _mint ? PupXP.getStats(_db, _mint) : null;
          const payout  = uStats.level + (nStats?.level || 0);
          if (payout > 0) { Balance.add(user_id, payout, user_id); total++; }
        }
        if (total > 0) log.info({ users: total }, '[XP] Hourly passive payout sent');
      } catch (e) { log.warn({ err: e.message }, '[XP] Hourly payout error'); }
    }, 60 * 60 * 1000); // re-check weekly (7-day grace period)

    // Howliday pre-announcements: once per real day when within 1 dog-week
    let _lastHowlidayAnnDate = '';
    async function checkHowlidayAnnouncement() {
      const upcoming = CalHelper.getUpcomingHowliday(7);
      if (!upcoming) return;
      const todayKey = new Date().toISOString().slice(0, 10);
      if (_lastHowlidayAnnDate === todayKey) return;
      _lastHowlidayAnnDate = todayKey;
      const { howliday, dogDaysAway } = upcoming;
      const msg = dogDaysAway === 1
        ? `🎉 TOMORROW is ${howliday.name}! Get ready Choctonauts! ${howliday.tradition}`
        : `🗓️ ${howliday.name} is coming in ${dogDaysAway} dog-days! ${howliday.lore}`;
      await TwitchAPI.sendAnnouncement(msg, 'purple').catch(() => {});
      log.info({ howliday: howliday.name, dogDaysAway }, '[HowlidayAnn] Announcement sent');
    }
    checkHowlidayAnnouncement();
    setInterval(checkHowlidayAnnouncement, 60 * 60 * 1000);

    // ── Snuggleday noon greeting: fires exactly at dog 12:00 on Snuggleday ─
    // 7 dog-days = exactly 1 real day, so this recurs every 24 real hours.
    // Guarded so it can never tight-loop or double-fire on the same day.
    if (!global._snuggledaySchedulerStarted) {
      global._snuggledaySchedulerStarted = true;
      let _lastSnuggledayKey = '';

      function msUntilNextSnuggleNoon() {
        const day = CalHelper.getChoctoDay();
        const weekday = day.dogWeekday;  // 0=Mucusday, 6=Snuggleday
        const curSec  = day.dogHour * 3600 + day.dogMin * 60 + day.dogSec;
        const noonSec = 12 * 3600;
        let daysToGo = (6 - weekday + 7) % 7;
        // If today IS Snuggleday but we're at or past noon, wait until next week
        if (daysToGo === 0 && curSec >= noonSec) daysToGo = 7;
        const totalDogSec = daysToGo * 86400 + (noonSec - curSec);
        // Dog runs 7× faster, so real ms = (dog seconds / 7) × 1000
        // Floor at 60_000 ms (1 minute) as a hard safety against tight loops.
        return Math.max(60000, (totalDogSec / 7) * 1000);
      }

      function scheduleSnuggleday() {
        const ms = msUntilNextSnuggleNoon();
        log.info({ realMs: ms, realHours: (ms/3600000).toFixed(2) },
                 '[Snuggleday] next noon scheduled');
        setTimeout(() => {
          try {
            const d   = CalHelper.getChoctoDay();
            // Sanity gate: only fire if actually Snuggleday at-or-past noon AND
            // we haven't already fired for this dog-day. Without this, any
            // timing edge case would spam chat.
            const key = `${d.dogYear}-${d.dogMonthIdx}-${d.dogDay}`;
            const isSnuggleNoon = d.dogWeekdayName === 'Snuggleday' && d.dogHour === 12;
            if (isSnuggleNoon && _lastSnuggledayKey !== key) {
              _lastSnuggledayKey = key;
              chat.say(`${CalHelper.formatTimeDate(d)} — Have you snuggled your Choctonauts today?`);
              log.info({ key }, '[Snuggleday] noon greeting sent');
            } else {
              log.info({ key, isSnuggleNoon, weekday: d.dogWeekdayName, hour: d.dogHour },
                       '[Snuggleday] timer fired early — skipping');
            }
          } catch (e) {
            log.warn({ err: e.message }, '[Snuggleday] error in handler');
          }
          scheduleSnuggleday();
        }, ms);
      }
      scheduleSnuggleday();
    }
  }

  // Channel Points — EventSub WebSocket (needs channel:read:redemptions scope)
  const CP_TOKEN    = process.env.TWITCH_OAUTH_TOKEN;
  const CP_CLIENT   = process.env.TWITCH_CLIENT_ID;
  if (CP_TOKEN && CP_CLIENT) {
    ChannelPoints.connect(CP_TOKEN, CP_CLIENT, Config.get.bind(Config), async (userId, displayName, cmd, rewardId, redemptionId, userInput) => {
      // Route through chat.redeemChannelPoint — shares the SAME cooldown as typed commands.
      // If a user typed !toss 30s ago, the channel point reward is also on cooldown.
      const args = userInput ? userInput.trim().split(/\s+/).filter(Boolean) : [];
      const ran  = chat.redeemChannelPoint(cmd, userId.toLowerCase(), userId, displayName, args);

      // Fulfill if command ran; cancel (refund points) if on cooldown or blocked
      const bId = ChannelPoints.getBroadcasterId();
      if (bId) {
        if (ran) await ChannelPoints.fulfill(bId, rewardId, redemptionId, CP_TOKEN, CP_CLIENT);
        else     await ChannelPoints.cancel(bId, rewardId, redemptionId, CP_TOKEN, CP_CLIENT);
      }
    },
    // Ad break callback: set flag for +10% reward bonus, then tiered airdrop after ads
    (durationSeconds) => {
      _adBreakActive = true;
      Broadcast.broadcast({ type: 'ad_break_start', durationSeconds });
      setTimeout(() => {
        _adBreakActive = false;
        Broadcast.broadcast({ type: 'ad_break_end' });
      }, durationSeconds * 1000);

      const base     = Config.get('ad_airdrop_amount') || 1;
      const lurkPct  = Config.get('ad_airdrop_lurker_pct') / 100 || 0.33;
      const subBonus = 1 + (Config.get('ad_airdrop_sub_bonus_pct') / 100 || 0.25);
      const windowMs = (Config.get('airdrop_window_min') || 10) * 60000;

      setTimeout(() => {
        try {
          const active  = Activity.getActiveDetailed(windowMs, null);  // [{userId,isSub}]
          const lurkers = Lurk.getLurkers();                            // [{userId,display}]
          const lurkerIds = new Set(lurkers.map(l => l.userId.toLowerCase()));

          // Build award map — lurkers get 33%, active (non-lurking) get full, subs +25%
          const awards = new Map();  // userId → choctobits

          // Active viewers who are NOT lurking → full base (+sub bonus)
          for (const a of active) {
            if (lurkerIds.has(a.userId.toLowerCase())) continue; // handled as lurker below
            const amt = base * (a.isSub ? subBonus : 1);
            awards.set(a.userId, Math.round(amt * 100) / 100);
          }
          // Lurkers → 33% of base (+sub bonus if sub)
          for (const l of lurkers) {
            const sub = Activity.isSub(l.userId);
            const amt = base * lurkPct * (sub ? subBonus : 1);
            awards.set(l.userId, Math.round(amt * 100) / 100);
          }

          if (!awards.size) {
            chat.say(`📺 Ads done — thanks for sticking around!`);
            return;
          }

          let total = 0;
          for (const [uid, amt] of awards) { Balance.add(uid, amt); total += amt; }
          total = Math.round(total * 100) / 100;

          const nActive = [...awards.keys()].filter(u => !lurkerIds.has(u.toLowerCase())).length;
          const nLurk   = lurkers.length;
          chat.say(`📺🪂 Thanks for watching the ads! Dropped ${total}🍫 — ${nActive} active viewer(s) + ${nLurk} lurker(s) (subs +25%)! 🎉`);
          Broadcast.broadcast({ type:'airdrop', dropper:'ChoctoTV', amount:total, share:base, recipients:awards.size });
        } catch(e) { log.warn({ err:e.message }, 'Post-ad airdrop failed'); }
      }, durationSeconds * 1000 + 2000);
    });
  }

  // ── Restore persistent state from previous session ──────────────────────────
  // On-duty state
  try {
    const dutyDb = db;
    const modRow = dutyDb.prepare("SELECT value FROM app_state WHERE key='onduty_mods'").get();
    const devRow = dutyDb.prepare("SELECT value FROM app_state WHERE key='onduty_devs'").get();
    if (modRow) JSON.parse(modRow.value).forEach(id => Duty.goOnDuty(id));
    if (devRow) JSON.parse(devRow.value).forEach(id => Duty.goOnDuty(id));
  } catch {}
  // Lurk sessions: re-add with a real earning tick so users stay lurking

  // ── Morale system ────────────────────────────────────────────────────────────
  const MoraleState = require('./core/MoraleState');

  // Reward history moved to module scope — see top of file

  // Track active players: intercept game broadcasts
  const _origBc = Broadcast.broadcast.bind(Broadcast);
  Broadcast.broadcast = (msg) => {
    // ── _origBc(msg) ALWAYS fires — wrap all side-effects in try/catch ────────
    try {
      // Morale: each lick feeds the pups (+1% food)
      if (msg.type === 'chest_lick') {
        MoraleState.foodBowl = Math.min(100, MoraleState.foodBowl + 1);
        Broadcast.broadcast({ type:'bowl_update', food:MoraleState.foodBowl, water:MoraleState.waterBowl });
      }

      // Game events: track active players, reward history, award XP
      if (msg.type === 'game' && msg.userId) {
        try {
          MoraleState.actionCount++;
          if (!Lurk.isActive(msg.userId)) {
            MoraleState.recordPlay(msg.userId, msg.user || msg.userId);
            try { _origBc({ type:'active_players', players:_buildActiveList() }); } catch {}
          }
          if (msg.reward > 0) {
            _rewardHistory.push({ ts:Date.now(), amount:msg.reward, userId:msg.userId, user:msg.user||msg.userId });
          }
        } catch {}

        // XP awards — active play only, NOT lurk ticks (lurk XP is a separate 30-min timer)
        // Subs get +1 bonus XP every 5th action
        if (!msg.isLurkTick) { try {
          const PupXP  = require('./economy/pupXP');
          const _db    = require('./db');
          const _state = PupCore.getCachedState(msg.userId);
          const _mint  = _state?.favPupMint;
          // Sub bonus: +1 XP every 5th game action
          const _subKey = `subXp:${msg.userId}`;
          if (!_subXpCounters) {} // declared below
          const _count = (_subXpCounters.get(_subKey) || 0) + 1;
          _subXpCounters.set(_subKey, _count > 5 ? 1 : _count);
          const _xp = 1 + (msg.isSub && _count >= 5 ? 1 : 0);

          if (_mint) {
            const nftRes = PupXP.addXP(_db, _mint, _xp);
            if (nftRes?.levelUp) {
              const name   = (_db.prepare('SELECT game_name FROM mint_names WHERE mint=?').get(_mint)||{}).game_name || 'Pup';
              const reward = nftRes.level * (PupXP.getUserStats(_db, msg.userId)?.level || 1);
              Balance.add(msg.userId, reward, msg.userId);
              chat.say(`🎉 @${msg.user||msg.userId}'s ${name} reached Level ${nftRes.level}! +${reward}🍫`);
            }
          }
          const uRes = PupXP.addUserXP(_db, msg.userId, _xp);
          if (uRes?.levelUp) {
            const reward = 100 * uRes.level;
            Balance.add(msg.userId, reward, msg.userId);
            chat.say(`⬆️ @${msg.user||msg.userId} reached Player Level ${uRes.level}! +${reward}🍫`);
          }
        } catch {} }
      }

      // Lurk updates: sync active players panel
      if (msg.type === 'lurk_update') {
        try { _origBc({ type:'active_players', players:_buildActiveList() }); } catch {}
      }
    } catch {}

    // Always forward to WebSocket clients — guaranteed
    _origBc(msg);
  };

  // Periodic lurk+active sync — registered ONCE, catches any missed events.
  let _lastLurkHash = '', _lastActiveHash = '';
  setInterval(() => {
    const lurkers = Lurk.getLurkers();
    const active  = _buildActiveList();
    const lHash   = lurkers.map(l=>l.userId).join(',');
    const aHash   = active.map(a=>a.userId).join(',');
    if (lHash !== _lastLurkHash) { _lastLurkHash = lHash; _origBc({ type:'lurk_update', lurkers }); }
    if (aHash !== _lastActiveHash) { _lastActiveHash = aHash; _origBc({ type:'active_players', players:active }); }
  }, 5000);

  function _moraleSnapshot() {
    const activePlayers = MoraleState.getActivePlayers();
    const lurkers       = Lurk.getLurkers();
    const score  = MoraleState.calcScore(activePlayers.length, lurkers.length);
    const bonus  = MoraleState.calcBowlBonus(score);
    return { activePlayers, lurkers, score, bonus };
  }

  function _buildActiveList() {
    const PupXP = (() => { try { return require('./economy/pupXP'); } catch { return null; } })();
    const _db   = (() => { try { return require('./db'); } catch { return null; } })();
    return MoraleState.getActivePlayers().map(uid => {
      let hasFav = false, nftLevel = 0, userLevel = 0;
      try {
        const s = PupCore.getCachedState(uid);
        hasFav = !!(s?.favPupName);
        if (PupXP && _db) {
          const uStats = PupXP.getUserStats(_db, uid);
          userLevel = uStats?.level || 0;
          if (s?.favPupMint) {
            const nStats = PupXP.getStats(_db, s.favPupMint);
            nftLevel = nStats?.level || 0;
          }
        }
      } catch {}
      return { userId: uid, display: MoraleState.getDisplay(uid), hasFav, userLevel, nftLevel };
    });
  }
  function _broadcastMorale() {
    const { activePlayers, lurkers, score } = _moraleSnapshot();
    const bonus = MoraleState.calcBowlBonus(score);  // bowl-adjusted
    Broadcast.broadcast({ type:'morale_update', score, bonus,
      activePlayers: activePlayers.length, lurkers: lurkers.length,
      foodBowl: MoraleState.foodBowl, waterBowl: MoraleState.waterBowl });
    Broadcast.broadcast({ type:'active_players', players: _buildActiveList() });
  }

  // Minute tick: refresh morale meter display
  setInterval(_broadcastMorale, 60000);

  // ── NEW: Food bowl auto-refill every 3 in-game dog-days ───────────────────────
  // 1 dog-day = (24h / 7) ≈ 3.43 real hours.  3 dog-days ≈ 10.3 real hours.
  // When the timer fires the food bowl resets to 100% and a chat message fires.
  const _MS_PER_DOG_DAY = Math.floor((24 * 3600 * 1000) / 7);  // ≈ 12,342,857
  const _BOWL_REFILL_MS = _MS_PER_DOG_DAY * 3;                  // ≈ 37,028,571

  setInterval(() => {
    MoraleState.foodBowl = 100;
    const _rfWeather = SpriteManager.getWeather ? SpriteManager.getWeather() : 'sunny';
    log.info('[FoodBowl] 3 dog-days elapsed → food bowl auto-refilled to 100%');
    Broadcast.broadcast({
      type: 'bowl_update',
      food: MoraleState.foodBowl, water: MoraleState.waterBowl,
      weather: _rfWeather, foodDrain: 0, refill: true,
    });
    chat.say('🍖 The Choctonauts have restocked the food bowl! Full to the brim 🐕🎉');
  }, _BOWL_REFILL_MS);

  // Bowl drain every 5 min: water drops by activePlayers%, food drops by lurkerCount%
  // Runs at 2.5min and 7.5min within each 10-min morale round (2 × 300000ms = 600000ms)
  setInterval(() => {
    const { activePlayers, lurkers } = _moraleSnapshot();
    const weather  = SpriteManager.getWeather();

    // ── Water: weather-dependent fill rules ────────────────────────────────
    let waterNote = '';
    if (weather === 'rainy' || weather === 'stormy') {
      MoraleState.waterBowl = 100;   // rain/storm fills to full, no drain
      waterNote = '🌧 Rain — water full, no drain';
    } else if (weather === 'snowy') {
      MoraleState.waterBowl = Math.max(MoraleState.waterBowl, 75); // snow: min 75%, no drain
      waterNote = `🌨 Snow — water held at 75%+`;
    } else {
      const waterDrain = activePlayers.length;
      MoraleState.waterBowl = Math.max(0, MoraleState.waterBowl - waterDrain);
      waterNote = `Water -${waterDrain}% → ${MoraleState.waterBowl}%`;
    }

    // ── Food: lurkers% + 1 per game action taken since last tick ───────────
    const actionsSinceLastTick = MoraleState.actionCount;
    MoraleState.actionCount = 0;   // reset window counter
    const foodDrain = lurkers.length + actionsSinceLastTick;
    MoraleState.foodBowl = Math.max(0, MoraleState.foodBowl - foodDrain);

    console.log(`[Bowl] ${waterNote} | Food -${foodDrain}% (${lurkers.length} lurkers + ${actionsSinceLastTick} actions) → ${MoraleState.foodBowl}%`);
    Broadcast.broadcast({ type:'bowl_update', food:MoraleState.foodBowl, water:MoraleState.waterBowl,
      weather, foodDrain });
  }, 300000);

  // 10-minute morale bonus drop
  setInterval(() => {
    const { activePlayers, lurkers, score, bonus } = _moraleSnapshot();
    const all = [...new Set([...activePlayers, ...lurkers.map(l=>l.userId)])];
    if (all.length === 0) return;
    if (bonus === 0) {
      chat.say('📉 Morale bonus: ZERO — ' + lurkers.length + ' lurkers vs ' + activePlayers.length + ' active players. Get playing! 🐾');
      _broadcastMorale(); return;
    }
    all.forEach(uid => Balance.add(uid, bonus, 'morale_bonus'));
    chat.say('🎉 Morale Bonus! Score ' + (score >= 0 ? '+' : '') + score + '/10 → +' + bonus + '🍫 each for ' + all.length + ' folks! (!feed or !water the pups to help the meter)');
    _broadcastMorale();
  }, 600000);

  const _lurkGameQueues = {};  // per-user shuffled action queues (each game once per loop)
  const _lurkXpTimes = {};  // userId → timestamp of last XP award
  const LURK_XP_INTERVAL = 30 * 60 * 1000; // 30 minutes = ~33% of casual active (1 game/10min) rate

  Lurk.restore(function makeLurkTick(tickUserId, tickDisplay) {
    const { calcReward, calcDrops } = require('./economy/calcReward');
    const GAMES = ['toss','throw','dig','walk','fish'];
    return async (id) => {
      const _gate = require('./core/CommandGate');
      if (_gate.isPaused()) return;
      if (!_lurkGameQueues[id] || !_lurkGameQueues[id].length)
        _lurkGameQueues[id] = [...GAMES].sort(() => Math.random() - 0.5);
      const game = _lurkGameQueues[id].shift();
      const mult    = Config.get('lurk_reward_mult');
      const { amount } = calcReward(game, Config.get.bind(Config), { lurkMult: mult });
      const drops   = calcDrops(Config.get.bind(Config));
      Balance.add(id, amount, tickDisplay || id);
      Inventory.add(id, drops, id);
      Broadcast.broadcast({ type:'lurk_earn', userId:id, reward:amount });
      Broadcast.broadcast({ type:'lurk_update', lurkers:Lurk.getLurkers() });

      // Award 1 XP to fav pup + user every 30 minutes while lurking
      // (33% of casual active rate: active player gets 1 XP per game, ~1/10min casual)
      const now = Date.now();
      if (!_lurkXpTimes[id] || now - _lurkXpTimes[id] >= LURK_XP_INTERVAL) {
        try {
          const PupXP  = require('./economy/pupXP');
          const _db    = require('./db');
          const _state = PupCore.getCachedState(id);
          const _mint  = _state?.favPupMint;
          if (_mint) {
            const nftRes = PupXP.addXP(_db, _mint, 1);
            if (nftRes?.levelUp) {
              const nameRow = _db.prepare('SELECT game_name FROM mint_names WHERE mint=?').get(_mint);
              chat.say(`🎉 @${tickDisplay || id}'s ${nameRow?.game_name || 'Pup'} reached Level ${nftRes.level} (lurk)! 🐾`);
            }
          }
          const userRes = PupXP.addUserXP(_db, id, 1);
          if (userRes?.levelUp) {
            chat.say(`⬆️ @${tickDisplay || id} reached Player Level ${userRes.level}!`);
          }
          _lurkXpTimes[id] = now;
        } catch {}
      }
    };
  });

  // ── Startup command gate: hold for 5s so all services fully initialise ────
  const CommandGate = require('./core/CommandGate');
  CommandGate.pause('Stream starting up — commands ready in 5 seconds');
  setTimeout(() => {
    CommandGate.resume();
    chat.say('✅ ChoctoTV online — commands active! Type !help to get started.');
  }, 5000);

  // Push initial state to overlay after 5s (lets overlay WS connect first)
  setTimeout(() => {
    const sites = db.prepare('SELECT url FROM scroll_sites ORDER BY added_at').all().map(r=>r.url);
    const coins = db.prepare('SELECT sym,id,color FROM coins ORDER BY added_at').all();
    Broadcast.broadcast({ type:'scrollsites',   sites });
    Broadcast.broadcast({ type:'announcements', announcements:AnnCmd.getAll() });
    Broadcast.broadcast({ type:'coins_update',  coins });
    Broadcast.broadcast({ type:'lurk_update',   lurkers:Lurk.getLurkers() });
    // Push current chest state so overlay shows correct jar on reconnect/reboot
    try {
      const chest = db.prepare('SELECT lock_target, clicks FROM chest WHERE id=1').get();
      if (chest) {
        Broadcast.broadcast({ type:'chest_new', lock: chest.lock_target - chest.clicks });
      }
    } catch {}
  }, 5000);

  // ── Auto-run test suite when stream is ready (15s after startup) ─────────
  // Writes testall.log — run "!testfeatures all" manually to re-run
  setTimeout(async () => {
    try {
      const testMod = require('./commands/testfeatures');
      const fakeCtx = makeCtx({
        userId: CHANNEL, user: CHANNEL, args: ['all'], cmd: 'testfeatures',
        isMod: true, isDev: true, isSub: false, isStreamer: true,
      });
      fakeCtx.say = (msg) => {
        log.info({ msg }, '[TestSuite]');
        // Don't spam chat on auto-run — log only
      };
      await testMod.execute(fakeCtx);
      log.info('[TestSuite] Auto-run complete — check data/logs/testall.log');
    } catch(e) {
      log.warn({ err: e.message }, '[TestSuite] Auto-run failed');
    }
  }, 15000);

}).catch(err => {
  log.error({ err:err.message }, 'Chat connect failed — overlay stays up, but commands are DEAD until fixed');
  console.error('\n[CHAT] Commands will not work until the token is fixed.');
  console.error('[CHAT] See the boxed message above. App stays running so the overlay still renders.\n');
  // Do NOT exit — keep overlay/HTTP alive. Retry chat connection every 30s.
  const retryChat = () => {
    chat.connect()
      .then(() => log.info('Chat reconnected successfully'))
      .catch(() => setTimeout(retryChat, 30000));
  };
  setTimeout(retryChat, 30000);
});

// ── 9. Graceful shutdown ───────────────────────────────────────────────────────
function saveAllState() {
  try { Lurk.save(); } catch {}
  try { SpriteManager.saveState(); } catch {}
  try {
    const db2 = require('./db');
    // Persist lick counts via the chest table (resets counts, chest state already in DB)
    // Any other in-memory state can be added here
  } catch {}
  log.info('State saved');
}

function shutdown(sig) {
  log.info({ sig }, 'Shutting down');
  saveAllState();
  server.close();
  setTimeout(() => process.exit(0), 500); // give saves a moment
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => {});
process.on('uncaughtException', err => {
  log.fatal({ err:err.message, stack:err.stack }, 'Uncaught exception');
  metrics.recordError('process', err.message);
});
