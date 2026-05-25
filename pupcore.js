// pupcore.js — PupCore Bot
// Microservice handling ALL blockchain, NFT, staking, and payout logic.
// Game engine (app.js) communicates via HTTP REST + WebSocket push.
// This service is the single source of truth for:
//   staking state · wallet links · NFT metadata · bonuses · payouts · reminders
'use strict';

// ── Dependencies ──────────────────────────────────────────────────────────────
const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const http    = require('http');
const crypto  = require('crypto');
const os      = require('os');
require('dotenv').config();

// Decrypt any enc: values from old encrypted .env setup
function parseSecrets(text) {
  const sections = {};
  const flat     = {};
  let cur = 'GENERAL';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();

    // Section header: # ── HELIUS ──── or ## HELIUS or # HELIUS
    const secMatch = line.match(/^#+\s*[-─═]{0,6}\s*([A-Za-z][A-Za-z0-9 _\-]{1,30}?)\s*[-─═]*\s*$/);
    if (secMatch) {
      cur = secMatch[1].trim().toUpperCase();
      if (!sections[cur]) sections[cur] = {};
      continue;
    }

    if (line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const k = line.slice(0, eq).trim();
    let   v = line.slice(eq + 1).trim();
    // Strip inline trailing comment (2+ spaces before #)
    const ic = v.match(/^(.*?)\s{2,}#.*/);
    if (ic) v = ic[1].trim();
    if (!k || !v) continue;

    if (!sections[cur]) sections[cur] = {};
    sections[cur][k] = v;
    flat[k] = v;
  }

  flat._sections = sections;
  return flat;
}

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
  const secrets = parseSecrets(fs.readFileSync(sf, 'utf8'));
  const pairs   = Object.entries(secrets).filter(([k]) => k !== '_sections');
  if (!pairs.length) return;

  // .env already rewritten by app.js at this point if they share the same dir.
  // Apply values directly to process.env for PupCore's own startup.
  for (const [k, v] of pairs) process.env[k] = v;
})();


const PORT_PUPCORE = parseInt(process.env.PUPCORE_PORT || '3002');
const HELIUS_KEY   = process.env.HELIUS_API_KEY || '';
const DATA_DIR     = path.join(__dirname, 'vault', 'data');
const MPL_CORE     = process.env.MPL_CORE_PROGRAM || 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'; // Metaplex Core — public, same for everyone
// Choctobits → Choctopus conversion rate
const CHOCT_RATE      = 1000;   // 1000 Choctobits = 1 Choctopus token
const PAYOUT_MIN_USD  = 5;
const PAYOUT_MAX_HOLD = 20;     // $20 USD max holdings
const PAYOUT_BONUS_THRESH = 10; // $10 USD = 1% bonus on payout
const PAYOUT_WINDOW_DAYS  = 7;
const PAYOUT_MAX_PER_WINDOW = 2;
const VERIFY_INTERVAL_MS  = 60 * 60 * 1000; // hourly

fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Persistence ───────────────────────────────────────────────────────────────
function makePersist(file, def) {
  const fp = path.join(DATA_DIR, file);
  let data = def;
  try { data = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch {}
  let _t;
  return {
    data,
    save() { clearTimeout(_t); _t = setTimeout(() => fs.writeFileSync(fp, JSON.stringify(this.data, null, 2)), 400); }
  };
}

const walletStore  = makePersist('wallets.json',  {});
const favPupStore  = makePersist('favpups.json',   {});
const payoutStore  = makePersist('payouts.json',   {});   // userId → { history:[], lastReminder }
const holdingStore    = makePersist('holdings.json',     {});   // userId → { choctopus, usdValue, frozen }
const collectionStore = makePersist('collections.json',  { addresses: ['Fex3HFPohjTUvQaN3uj64tDU5D3iPwVwfPMi612TUPue'] }); // Choctonaut Army on-chain collection

// ── RPC helpers ───────────────────────────────────────────────────────────────
function rpc(method, params, retries = 3) {
  const url     = HELIUS_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
    : 'https://api.mainnet-beta.solana.com';
  const payload = JSON.stringify({ jsonrpc:'2.0', id:1, method, params });
  return new Promise((res, rej) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { const j = JSON.parse(d); if (j.error) rej(new Error(j.error.message)); else res(j.result); }
        catch(e) { rej(e); }
      });
    });
    req.on('error', async e => {
      if (retries > 0) { await new Promise(r => setTimeout(r, 700)); rpc(method, params, retries-1).then(res).catch(rej); }
      else rej(e);
    });
    req.write(payload); req.end();
  });
}

async function dasGetAsset(mintAddress) {
  if (!HELIUS_KEY) return null;
  const url     = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
  const payload = JSON.stringify({ jsonrpc:'2.0', id:1, method:'getAsset', params:{ id:mintAddress } });
  return new Promise((res, rej) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { const j = JSON.parse(d); res(j.result || null); } catch { res(null); }
      });
    });
    req.on('error', () => res(null));
    req.write(payload); req.end();
  });
}

// ── NFT staking verification ──────────────────────────────────────────────────
// Returns { ok, reason, detail }
// Verifies the NFT is owned by walletAddress. Optionally checks it belongs to
// the configured COLLECTION_ADDRESS (set in Secret file) for Choctonaut Army.
async function verifyOwnership(walletAddress, mintAddress) {
  console.log(`[PupCore] verifyOwnership wallet=${walletAddress} mint=${mintAddress}`);

  if (HELIUS_KEY) {
    const result = await dasGetAsset(mintAddress);
    if (!result) return { ok:false, reason:'Could not look up NFT — Helius unreachable or invalid mint' };

    const owner = result.ownership?.owner;
    const approved   = collectionStore.data.addresses || [];
    const grouping   = result.grouping || [];
    const collection = grouping.find(g => g.group_key === 'collection')?.group_value || null;

    const detail = { mintAddress, walletAddress, owner, collection, approvedCount: approved.length };
    console.log('[PupCore] DAS detail:', JSON.stringify(detail));

    if (owner !== walletAddress) {
      const ownerShort  = owner ? owner.slice(0,6)+'...'+owner.slice(-4) : 'unknown';
      const walletShort = walletAddress.slice(0,6)+'...'+walletAddress.slice(-4);
      return { ok:false, reason:`NFT owned by ${ownerShort}, not your wallet ${walletShort}`, detail };
    }

    // Collection check — must be in approved list (empty list = allow any)
    if (approved.length && !approved.includes(collection)) {
      return { ok:false, reason:`Not an approved collection NFT`, detail };
    }

    return { ok:true, reason: approved.length ? 'owned (approved collection)' : 'owned', detail };
  }

  // ── Fallback: raw RPC account read when no Helius key ────────────────────────
  const result = await rpc('getAccountInfo', [mintAddress, { encoding:'base64', commitment:'confirmed' }]).catch(() => null);
  if (!result?.value) return { ok:false, reason:'asset not found on chain' };
  if (result.value.owner !== MPL_CORE) return { ok:false, reason:'not an mpl-core asset (cannot verify without Helius)' };
  const data = Buffer.from(result.value.data[0], 'base64');
  const ownerBytes  = data.slice(1, 33);
  const ownerBase58 = encodeBase58(ownerBytes);
  if (ownerBase58 !== walletAddress) return { ok:false, reason:'owner mismatch' };
  return { ok:true, reason:'owned (mpl-core)' };
}

// Back-compat wrappers
async function verifyStaking(w, m)     { return verifyOwnership(w, m); }
async function verifyStakingBool(w, m) { return (await verifyOwnership(w, m)).ok; }

// ── NFT metadata extraction ────────────────────────────────────────────────────
async function fetchNFTMeta(mintAddress) {
  const result = await dasGetAsset(mintAddress);
  if (!result) return null;
  const attrs = result.content?.metadata?.attributes || [];
  const get   = t => attrs.find(a => a.trait_type?.toLowerCase() === t.toLowerCase())?.value || null;

  const background = get('Background');
  const diamonds   = get('Diamonds');
  const body       = get('Body');
  const head       = get('Head');
  const accessory  = get('Accessory');

  // Derive visual config from traits — keeps game engine blockchain-agnostic
  const skyConfig   = buildSkyConfig(background);
  const sparkleColor = buildDiamondColor(diamonds);
  const bonusMultiplier = calcNFTBonus(result);

  return {
    imageUrl:        result.content?.links?.image || result.content?.files?.[0]?.uri || null,
    name:            result.content?.metadata?.name || null,
    background, diamonds, body, head, accessory,
    skyConfig,       // { top, bot } — pre-computed, game engine just applies
    sparkleColor,    // hex or null
    bonusMultiplier, // e.g. 1.25 for base fav pup bonus
    attributes:      attrs,
  };
}

// ── Visual config builders (NFT-aware, game-engine-agnostic output) ───────────
const BG_SKY = {
  'Brandblue':       {top:'#020818',bot:'#1a4db8'},
  'Skyblue':         {top:'#4a9fd4',bot:'#c8e8f5'},
  'Brandpink':       {top:'#1a0520',bot:'#E91E8C'},
  'Purplebrand':     {top:'#0d0020',bot:'#7B2FBE'},
  'Red':             {top:'#1a0000',bot:'#CC2200'},
  'Brandgold':       {top:'#0f0800',bot:'#FFD700'},
  'Luckygreen':      {top:'#001005',bot:'#00CC44'},
  'Purplemunch':     {top:'#100020',bot:'#9400D3'},
  'Orange':          {top:'#1a0800',bot:'#FF8C00'},
  'Purplepurple':    {top:'#0a0015',bot:'#6600CC'},
  'Stars':           {top:'#000005',bot:'#0a0a2a'},
  'Galaxy':          {top:'#000010',bot:'#0a0535'},
  'Purplecamo':      {top:'#0f0f15',bot:'#2d2d45'},
  'Waterbubbles':    {top:'#001a2e',bot:'#0077CC'},
  'Darkpurplecamo':  {top:'#050005',bot:'#1a001a'},
  'Waterfloor':      {top:'#001520',bot:'#004080'},
  'Choctomoon':      {top:'#020210',bot:'#0a0a25'},
  'Camo':            {top:'#0a1a05',bot:'#2d4a1a'},
  'Secretnftpurplebg':{top:'#0d0020',bot:'#2d0070'},
  'Secretgold Bg':   {top:'#1a1200',bot:'#7a5c00'},
};
const DIAMOND_COL = {
  'Diamondsorange':'#FF6B00','Diamondsred':'#FF2222','Diamondsyellow':'#FFD700',
  'Diamondsteal':'#00CED1','Diamondsblue':'#1E90FF','Diamondspink':'#FF69B4',
};

function buildSkyConfig(bg) { return bg ? (BG_SKY[bg] || null) : null; }
function buildDiamondColor(d) { return d ? (DIAMOND_COL[d] || null) : null; }
function calcNFTBonus(dasResult) {
  // Base fav pup bonus = 25%. Rarity modifiers could extend this.
  return 1.25;
}

// ── Payout logic ───────────────────────────────────────────────────────────────
function getChoctopusPrice() {
  // TODO: fetch live price from Jupiter/Birdeye
  // Using a stub; replace with real price feed
  return parseFloat(process.env.CHOCTOPUS_USD_PRICE || '0.01');
}

function getUserHoldings(userId) {
  return holdingStore.data[userId] || { choctopus: 0, usdValue: 0, frozen: false };
}

function getPayoutHistory(userId) {
  return payoutStore.data[userId] || { history: [], lastReminder: null, lastDailyReminder: null };
}

function payoutsInWindow(userId) {
  const h = getPayoutHistory(userId).history;
  const cutoff = Date.now() - PAYOUT_WINDOW_DAYS * 86400000;
  return h.filter(p => p.ts > cutoff).length;
}

function isPayoutEligible(userId, choctobits) {
  const price    = getChoctopusPrice();
  const tokens   = Math.floor(choctobits / CHOCT_RATE);
  const usdValue = tokens * price;
  if (usdValue < PAYOUT_MIN_USD)          return { eligible: false, reason: `Below $${PAYOUT_MIN_USD} threshold` };
  if (payoutsInWindow(userId) >= PAYOUT_MAX_PER_WINDOW)
    return { eligible: false, reason: `Max ${PAYOUT_MAX_PER_WINDOW} payouts per ${PAYOUT_WINDOW_DAYS} days reached` };
  const wallet = walletStore.data[userId];
  if (!wallet) return { eligible: false, reason: 'No wallet linked — use !setwallet' };
  return { eligible: true, tokens, usdValue, wallet,
    bonus: usdValue >= PAYOUT_BONUS_THRESH ? 0.01 : 0 };
}

// ── Holdings limit enforcement ─────────────────────────────────────────────────
function checkHoldingsLimit(userId, choctobits) {
  const price    = getChoctopusPrice();
  const tokens   = choctobits / CHOCT_RATE;
  const usdValue = tokens * price;
  const wallet   = walletStore.data[userId];
  const h        = getUserHoldings(userId);

  if (usdValue <= PAYOUT_MAX_HOLD) {
    h.frozen  = false;
    holdingStore.data[userId] = h;
    holdingStore.save();
    return { frozen: false };
  }

  // Over $20
  if (wallet) {
    // Has wallet: auto-cashout trigger
    h.frozen = false;
    holdingStore.data[userId] = h;
    holdingStore.save();
    return { frozen: false, autoCashout: true, wallet };
  } else {
    // No wallet: freeze earnings
    h.frozen = true;
    holdingStore.data[userId] = h;
    holdingStore.save();
    return { frozen: true, reason: 'Holdings exceed $20 — link a wallet to auto-cashout' };
  }
}

// ── Reminder logic ─────────────────────────────────────────────────────────────
function today() { return new Date().toISOString().slice(0,10); }

function checkReminders(userId, choctobits) {
  const reminders = [];
  const ph        = getPayoutHistory(userId);
  const elig      = isPayoutEligible(userId, choctobits);
  const price     = getChoctopusPrice();
  const usd       = Math.floor(choctobits / CHOCT_RATE) * price;

  // Daily reminder: first action of day, eligible for cashout
  if (elig.eligible && ph.lastDailyReminder !== today()) {
    ph.lastDailyReminder = today();
    payoutStore.data[userId] = ph;
    payoutStore.save();
    reminders.push({ type:'daily', message:`💰 You have ${elig.tokens} Choctopus (~$${usd.toFixed(2)}) ready to cashout!` });
  }

  // Threshold reminder: just crossed $5
  if (elig.eligible && !ph.lastThresholdReminder) {
    ph.lastThresholdReminder = Date.now();
    payoutStore.data[userId] = ph;
    payoutStore.save();
    reminders.push({ type:'threshold', message:`🎉 You just hit the $${PAYOUT_MIN_USD} cashout threshold!` });
  }

  return reminders;
}

// ── User state builder (what game engine consumes) ────────────────────────────
async function buildUserState(userId) {
  const fav     = favPupStore.data[userId] || null;
  const wallet  = walletStore.data[userId] || null;
  const elig    = { eligible: false };

  // Display name: user's custom name (from !setfavname/!namepup) overrides NFT name.
  // If neither set, extract the # number from the NFT name as fallback.
  let displayName = fav?.displayName || null;
  if (!displayName && fav?.nftName) {
    const numMatch = fav.nftName.match(/#\s*(\d+)/);
    displayName = numMatch ? `#${numMatch[1]}` : fav.nftName;
  }
  // Absolute fallback: use last 6 chars of mint address as unique identifier
  if (!displayName && fav?.mintAddress) {
    displayName = `#${fav.mintAddress.slice(-6)}`;
  }
  // Stable NFT number for cached _nobg.png filenames (number from name, else mint suffix)
  let favPupNum = null;
  if (fav?.nftName) { const m = fav.nftName.match(/#\s*(\d+)/); if (m) favPupNum = m[1]; }
  if (!favPupNum && fav?.mintAddress) favPupNum = fav.mintAddress.slice(-8);

  return {
    userId,
    walletAddress:     wallet,
    favPupMint:        fav?.mintAddress     || null,
    favPupImageURL:    fav?.imageUrl        || null,
    favPupName:        displayName,
    favPupNum:         favPupNum,
    favPupAttributes:  fav?.attributes      || null,
    favPupSkyConfig:   fav?.skyConfig       || null,
    favPupSparkle:     fav?.sparkleColor    || null,
    favPupBonuses: {
      multiplier:  fav ? 1.25 : 1.0,
      favGame:     fav?.favGame     || null,
      favWeather:  fav?.favWeather  || null,
    },
    ownerState:        fav?.ownerVerified   || false,
    payoutEligibility: elig,
  };
}

// ── Hourly NFT verification ───────────────────────────────────────────────────
async function dailyNFTVerification() {
  const entries = Object.entries(favPupStore.data);
  if (!entries.length) return;
  console.log(`[PupCore] Hourly verify — checking ${entries.length} fav pups`);

  for (const [userId, fav] of entries) {
    if (!fav.mintAddress) continue;
    const wallet = walletStore.data[userId];
    if (!wallet) continue;

    try {
      const staked = (await verifyOwnership(wallet, fav.mintAddress)).ok;
      const changed = fav.ownerVerified !== staked;
      fav.ownerVerified = staked;
      fav.lastVerified  = new Date().toISOString();

      if (changed) {
        favPupStore.save();
        // Re-fetch metadata if still staked
        if (staked) {
          const meta = await fetchNFTMeta(fav.mintAddress);
          if (meta) {
            Object.assign(fav, { imageUrl: meta.imageUrl, skyConfig: meta.skyConfig,
              sparkleColor: meta.sparkleColor, attributes: meta.attributes });
            favPupStore.save();
          }
        }
        // Push state update to game engine
        pushStateUpdate(userId);
        console.log(`[PupCore] ${userId} stake state changed → ${staked}`);
      }
    } catch(e) {
      console.error(`[PupCore] verify error for ${userId}:`, e.message);
    }

    // Small delay between checks to avoid hammering RPC
    await new Promise(r => setTimeout(r, 500));
  }
}

setInterval(dailyNFTVerification, VERIFY_INTERVAL_MS);
setTimeout(dailyNFTVerification, 60000); // first daily check after 60s startup

// ── WebSocket push to game engine ──────────────────────────────────────────────
let _gameEngineWS = null;

function pushStateUpdate(userId) {
  buildUserState(userId).then(state => {
    if (_gameEngineWS && _gameEngineWS.readyState === 1) {
      _gameEngineWS.send(JSON.stringify({ type:'pupcore:state', userId, state }));
    }
  }).catch(() => {});
}

function pushReminder(userId, reminders) {
  if (!reminders.length) return;
  if (_gameEngineWS && _gameEngineWS.readyState === 1) {
    _gameEngineWS.send(JSON.stringify({ type:'pupcore:reminder', userId, reminders }));
  }
}

// ── HTTP API ────────────────────────────────────────────────────────────────────
const routes = {
  // GET /user/state/:userId
  'GET /user/state': async (params, body, res) => {
    const userId = params[0];
    if (!userId) return send(res, 400, { error: 'userId required' });
    const state = await buildUserState(userId);
    send(res, 200, state);
  },

  // GET /collections/list
  'GET /collections/list': async (params, body, res) => {
    send(res, 200, { ok:true, addresses: collectionStore.data.addresses || [] });
  },

  // POST /collections/add  { address }
  'POST /collections/add': async (params, body, res) => {
    const addr = (body.address || '').trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return send(res, 400, { ok:false, error:'invalid Solana address' });
    const list = collectionStore.data.addresses || [];
    if (list.includes(addr)) return send(res, 409, { ok:false, error:'already in approved list' });
    list.push(addr);
    collectionStore.data.addresses = list;
    collectionStore.save();
    console.log(`[PupCore] Collection added: ${addr} (total: ${list.length})`);
    send(res, 200, { ok:true, addresses: list });
  },

  // POST /collections/remove  { address }
  'POST /collections/remove': async (params, body, res) => {
    const addr = (body.address || '').trim();
    const list = collectionStore.data.addresses || [];
    const idx  = list.indexOf(addr);
    if (idx < 0) return send(res, 404, { ok:false, error:'not in approved list' });
    list.splice(idx, 1);
    collectionStore.data.addresses = list;
    collectionStore.save();
    console.log(`[PupCore] Collection removed: ${addr} (total: ${list.length})`);
    send(res, 200, { ok:true, addresses: list });
  },

  // GET /debug/verify?wallet=X&mint=Y — dump full DAS response + verification result
  'GET /debug/verify': async (params, body, res) => {
    const wallet = params.wallet || '';
    const mint   = params.mint   || '';
    if (!wallet || !mint) return res({ error:'usage: /debug/verify?wallet=...&mint=...' });
    const result = await verifyOwnership(wallet, mint);
    const raw    = await dasGetAsset(mint);
    send(res, 200, { verification: result, dasRaw: raw });
  },

  // POST /user/equip  { userId, wallet?, mintAddress?, favGame?, favWeather?, displayName? }
  'POST /user/equip': async (params, body, res) => {
    const { userId, wallet, mintAddress, favGame, favWeather, displayName } = body;
    if (!userId) return send(res, 400, { error: 'userId required' });

    // Wallet link
    if (wallet) {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet))
        return send(res, 400, { error: 'Invalid Solana address' });
      walletStore.data[userId] = wallet;
      walletStore.save();
    }

    // Fav pup equip
    if (mintAddress) {
      const linkedWallet = walletStore.data[userId];
      if (!linkedWallet) return send(res, 400, { error: 'Link a wallet first with !setwallet' });

      const verifyResult = await verifyOwnership(linkedWallet, mintAddress);
      if (!verifyResult.ok) return send(res, 403, { error: verifyResult.reason || 'NFT verification failed', detail: verifyResult.detail });

      const meta = await fetchNFTMeta(mintAddress);
      favPupStore.data[userId] = {
        ...(favPupStore.data[userId] || {}),
        mintAddress,
        wallet:         linkedWallet,
        imageUrl:       meta?.imageUrl      || null,
        nftName:        meta?.name          || null,   // raw NFT name e.g. "Choctonaut #1234"
        skyConfig:      meta?.skyConfig     || null,
        sparkleColor:   meta?.sparkleColor  || null,
        attributes:     meta?.attributes    || null,
        background:     meta?.background    || null,
        diamonds:       meta?.diamonds      || null,
        ownerVerified:  true,
        verifiedAt:     new Date().toISOString(),
      };
      favPupStore.save();
    }

    // Optional fields
    const fav = favPupStore.data[userId];
    if (fav) {
      if (favGame)     { fav.favGame     = favGame;     favPupStore.save(); }
      if (favWeather)  { fav.favWeather  = favWeather;  favPupStore.save(); }
      if (displayName) { fav.displayName = displayName; favPupStore.save(); }
    }

    pushStateUpdate(userId);
    const state = await buildUserState(userId);
    send(res, 200, { ok: true, state });
  },

  // POST /action/complete  { userId, game, choctobits }
  'POST /action/complete': async (params, body, res) => {
    const { userId, game, choctobits } = body;
    if (!userId) return send(res, 400, { error: 'userId required' });

    const limitResult = checkHoldingsLimit(userId, choctobits || 0);
    const reminders   = checkReminders(userId, choctobits || 0);

    if (reminders.length) pushReminder(userId, reminders);
    if (limitResult.autoCashout) {
      // Trigger auto-cashout in background — non-blocking
      handleAutoCashout(userId, choctobits).catch(e => console.error('[PupCore] auto-cashout error:', e.message));
    }

    send(res, 200, { ok: true, frozen: limitResult.frozen || false, reminders });
  },

  // POST /payout/request  { userId, choctobits }
  'POST /payout/request': async (params, body, res) => {
    const { userId, choctobits } = body;
    if (!userId) return send(res, 400, { error: 'userId required' });
    const elig = isPayoutEligible(userId, choctobits || 0);
    if (!elig.eligible) return send(res, 403, { error: elig.reason });

    // Record payout request (actual SPL send handled externally / by treasury bot)
    const ph = getPayoutHistory(userId);
    const record = { ts: Date.now(), tokens: elig.tokens, usdValue: elig.usdValue,
      bonus: elig.bonus, wallet: elig.wallet };
    ph.history.push(record);
    payoutStore.data[userId] = ph;
    payoutStore.save();

    console.log(`[PupCore] Payout recorded: ${userId} → ${elig.tokens} Choctopus to ${elig.wallet}`);
    send(res, 200, { ok: true, ...record });
  },

  // GET /user/reminder/:userId?choctobits=N
  'GET /user/reminder': async (params, body, res) => {
    const userId     = params[0];
    const choctobits = parseInt(params[1] || '0');
    if (!userId) return send(res, 400, { error: 'userId required' });
    const reminders = checkReminders(userId, choctobits);
    send(res, 200, { reminders });
  },

  // GET /health
  'GET /health': async (params, body, res) => {
    send(res, 200, { ok: true, service: 'pupcore', uptime: Math.floor(process.uptime()) });
  },
};

async function handleAutoCashout(userId, choctobits) {
  console.log(`[PupCore] Auto-cashout triggered for ${userId}`);
  // Record auto-cashout — actual on-chain send handled by treasury service
  const elig = isPayoutEligible(userId, choctobits);
  if (!elig.eligible) return;
  const ph = getPayoutHistory(userId);
  ph.history.push({ ts: Date.now(), tokens: elig.tokens, usdValue: elig.usdValue,
    bonus: 0, wallet: elig.wallet, auto: true });
  payoutStore.data[userId] = ph;
  payoutStore.save();
  pushStateUpdate(userId);
}

// ── HTTP server ────────────────────────────────────────────────────────────────
function send(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    const url     = req.url.replace(/\?.*/, '');
    const parts   = url.split('/').filter(Boolean); // ['user','state','userId']
    const key     = `${req.method} /${parts.slice(0,2).join('/')}`;
    const params  = parts.slice(2);
    let parsed = {};
    try { parsed = body ? JSON.parse(body) : {}; } catch {}

    // Query string params
    const qs = req.url.includes('?') ? Object.fromEntries(new URLSearchParams(req.url.split('?')[1])) : {};
    Object.assign(parsed, qs);

    const handler = routes[key];
    if (!handler) { send(res, 404, { error: `No route: ${key}` }); return; }
    try { await handler(params, parsed, res); }
    catch(e) { console.error('[PupCore] Handler error:', e.message); send(res, 500, { error: e.message }); }
  });
});

// ── WebSocket server (game engine connects here for push updates) ──────────────
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  // Push all cached fav pup states to newly connected overlay
  setTimeout(() => {
    for (const userId of Object.keys(favPupStore.data)) {
      try { pushStateUpdate(userId); } catch {}
    }
  }, 500);
  console.log('[PupCore] Game engine connected via WS');
  _gameEngineWS = ws;
  ws.on('close', () => { if (_gameEngineWS === ws) _gameEngineWS = null; });
  ws.on('error', () => {});
  // Send all current states on connect
  for (const userId of Object.keys(favPupStore.data)) pushStateUpdate(userId);
});

server.listen(PORT_PUPCORE, () => {
  console.log(`[PupCore] Running on :${PORT_PUPCORE}`);
  console.log(`[PupCore] Helius: ${HELIUS_KEY ? 'configured' : 'NOT SET — fallback RPC only'}`);
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[PupCore] Port ${PORT_PUPCORE} in use — killing stale instance and retrying in 2s`);
    const { execSync } = require('child_process');
    try { execSync(`fuser -k ${PORT_PUPCORE}/tcp 2>/dev/null || true`); } catch {}
    setTimeout(() => server.listen(PORT_PUPCORE), 2000);
  } else {
    console.error('[PupCore] Fatal:', e.message);
    process.exit(1);
  }
});

// ── Base58 encode (zero-dependency) ───────────────────────────────────────────
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function encodeBase58(buf) {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex')), r = '';
  const b = BigInt(58);
  while (n > 0n) { r = B58[Number(n % b)] + r; n /= b; }
  for (const byte of buf) { if (byte === 0) r = '1' + r; else break; }
  return r;
}
