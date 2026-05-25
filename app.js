'use strict';

// ── 1. Secret file loader — runs before anything else ─────────────────────────
(function loadSecrets() {
  const fs = require('fs'), path = require('path');
  const dir    = __dirname;
  const vaultD = path.join(dir, 'vault');

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
  } else if (fs.existsSync(path.join(dir,'.env'))) {
    require('dotenv').config();
    console.log('[Config] Using existing .env');
  } else {
    require('dotenv').config();
    console.log('[Config] WARNING: No Secret file found — using process env');
  }
})();

// ── 2. Imports ─────────────────────────────────────────────────────────────────
const path       = require('path');
const http       = require('http');
const log        = require('./observability/logger');
require('fs').mkdirSync(require('path').join(__dirname,'pids'), { recursive:true });
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
const Teller     = require('./services/TellerClient');
const Lurk       = require('./economy/lurk');
const GBM        = require('./economy/gbm');
const Lottery    = require('./economy/lottery');
const Duty       = require('./economy/duty');
const Activity   = require('./economy/activity');
const AnnCmd     = require('./commands/announcements');

const CHANNEL = (process.env.TWITCH_CHANNEL || process.env.CHANNEL || '').toLowerCase();
const API_PORT = parseInt(process.env.API_PORT || '3000');
const WS_PORT  = parseInt(process.env.WS_PORT  || '3001');

// Last lottery draw — served at GET /lottery/today
let _lastLotteryDraw = null;

// ── 3. Command context factory ─────────────────────────────────────────────────
function makeCtx(base) {
  return {
    ...base,
    say:       msg => chat.say(msg),
    broadcast: Broadcast.broadcast,
    db,
    cfg:       key => Config.get(key),
    CHANNEL,
    Balance, Inventory, Roles,
    PupCore, Teller,
    SpriteManager,
    Lurk, GBM, Lottery, Duty, Activity,
  };
}

// ── 4. Load commands ───────────────────────────────────────────────────────────
const loader = new CmdLoader();
loader.load(path.join(__dirname, 'commands'));
PupCore.setEventBroadcast(Broadcast.broadcast);

// ── 5. Chat ────────────────────────────────────────────────────────────────────
const chat = new Chat(loader, makeCtx);

// ── 6. HTTP server ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  let url = req.url.split('?')[0];
  try { url = decodeURIComponent(url); } catch {}  // "The%20OG.png" → "The OG.png" 

  // ── Cached background-removed NFT images: vault/data/nobg/<num>_nobg.png ──────
  if (url.startsWith('/nobg/')) {
    const fsM = require('fs'), pathM = require('path');
    const fname = pathM.basename(url);  // prevent traversal
    const fp = pathM.join(__dirname, 'vault', 'data', 'nobg', fname);
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
        const dir = pathM.join(__dirname, 'vault', 'data', 'nobg');
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
      let txt = fsM.readFileSync(pathM.join(__dirname, 'ticker.txt'), 'utf8');
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

  // Serve overlay static files
  const staticDir = path.join(__dirname, 'yardpets3');
  const filePath  = url === '/' ? '/index.html' : url;
  try {
    const resolved = path.normalize(path.join(staticDir, filePath));
    if (!resolved.startsWith(staticDir)) { res.writeHead(403); res.end('Forbidden'); return; }
    const data = require('fs').readFileSync(resolved);
    const ext  = filePath.split('.').pop();
    const mime = { html:'text/html', js:'application/javascript', css:'text/css',
                   json:'application/json', png:'image/png', svg:'image/svg+xml' }[ext] || 'application/octet-stream';
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

  // OAuth maintenance runs in BACKGROUND — refreshes token, never blocks chat.
  // Device flow only happens via ./start.sh updatescopes (allowDeviceFlow stays false here).
  OAuthManager.ensureToken(process.env.TWITCH_CLIENT_ID, false)
    .then(() => OAuthManager.scheduleRefresh(process.env.TWITCH_CLIENT_ID))
    .catch(e => log.warn({ err:e.message }, 'OAuth maintenance skipped'));

  // Channel Points — EventSub WebSocket (needs channel:read:redemptions scope)
  const CP_TOKEN    = process.env.TWITCH_OAUTH_TOKEN;
  const CP_CLIENT   = process.env.TWITCH_CLIENT_ID;
  if (CP_TOKEN && CP_CLIENT) {
    ChannelPoints.connect(CP_TOKEN, CP_CLIENT, Config.get.bind(Config), async (userId, displayName, cmd) => {
      const mod = loader.get(cmd);
      if (!mod) return;
      const ctx = makeCtx({ userId: displayName.toLowerCase(), user: displayName, args:[], cmd,
        isSub:false, isMod:false, isDev:false, isStreamer:false, tags:{} });
      try { await Promise.resolve(mod.execute(ctx)); } catch {}
    },
    // Ad break callback — tiered system airdrop when ads finish
    //   active viewer:  1 base    lurker: 33% of base    subscriber: +25% bonus
    (durationSeconds) => {
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

  // Track active players: intercept game broadcasts
  const _origBc = Broadcast.broadcast.bind(Broadcast);
  Broadcast.broadcast = (msg) => {
    if (msg.type === 'game' && msg.userId) { MoraleState.recordPlay(msg.userId, msg.user || msg.userId); Broadcast.broadcast({ type:'active_players', players:_buildActiveList() }); }
    _origBc(msg);
  };

  function _moraleSnapshot() {
    const activePlayers = MoraleState.getActivePlayers();
    const lurkers       = Lurk.getLurkers();
    const score  = MoraleState.calcScore(activePlayers.length, lurkers.length);
    const bonus  = MoraleState.calcBowlBonus(score);
    return { activePlayers, lurkers, score, bonus };
  }

  function _buildActiveList() {
    return MoraleState.getActivePlayers().map(uid => {
      let hasFav = false;
      try { const s = PupCore.getCachedState(uid); hasFav = !!(s?.favPupName); } catch {}
      return { userId: uid, display: MoraleState.getDisplay(uid), hasFav };
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

  // Bowl drain every 5 min: water drops by activePlayers%, food drops by lurkerCount%
  // Runs at 2.5min and 7.5min within each 10-min morale round (2 × 300000ms = 600000ms)
  setInterval(() => {
    const { activePlayers, lurkers } = _moraleSnapshot();
    const waterDrain = activePlayers.length;  // AP count = percent water drains
    const foodDrain  = lurkers.length;         // lurker count = percent food drains
    MoraleState.waterBowl = Math.max(0, MoraleState.waterBowl - waterDrain);
    MoraleState.foodBowl  = Math.max(0, MoraleState.foodBowl  - foodDrain);
    Broadcast.broadcast({ type:'bowl_update', food:MoraleState.foodBowl, water:MoraleState.waterBowl,
      waterDrain, foodDrain });
    console.log(`[Bowl] Water -${waterDrain}% → ${MoraleState.waterBowl}% | Food -${foodDrain}% → ${MoraleState.foodBowl}%`);
  }, 300000);

  // 10-minute morale bonus drop
  setInterval(() => {
    const { activePlayers, lurkers, score, bonus } = _moraleSnapshot();
    const all = [...new Set([...activePlayers, ...lurkers.map(l=>l.userId)])];
    if (all.length === 0) return;
    if (bonus === 0) {
      Chat.say('📉 Morale bonus: ZERO — ' + lurkers.length + ' lurkers vs ' + activePlayers.length + ' active players. Get playing! 🐾');
      _broadcastMorale(); return;
    }
    all.forEach(uid => Balance.add(uid, bonus, 'morale_bonus'));
    Chat.say('🎉 Morale Bonus! Score ' + (score >= 0 ? '+' : '') + score + '/10 → +' + bonus + '🍫 each for ' + all.length + ' folks! (!feed or !water the pups to help the meter)');
    _broadcastMorale();
  }, 600000);

  const _lurkGameQueues = {};  // per-user shuffled action queues (each game once per loop)
  Lurk.restore(function makeLurkTick(tickUserId, tickDisplay) {
    const { calcReward, calcDrops } = require('./economy/calcReward');
    const GAMES = ['toss','throw','dig','walk','fish'];
    return async (id) => {
      // Don't fire lurker animations during maintenance pause
      const _gate = require('./core/CommandGate');
      if (_gate.isPaused()) return;
      // Shuffle through all actions before repeating — no action fires twice in a row
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
    };
  });

  // ── Startup command gate: hold for 5s so all services fully initialise ────
  const CommandGate = require('./core/CommandGate');
  CommandGate.pause('Stream starting up — commands ready in 5 seconds');
  setTimeout(() => {
    CommandGate.resume();
    Chat.say('✅ ChoctoTV online — commands active! Type !help to get started.');
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
