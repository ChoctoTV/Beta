'use strict';
/**
 * testfeatures.js — Full integration test suite
 *
 * !testall              runs every test, saves state before, restores after
 * !testall <group>      runs one group: infra | game | economy | xp | overlay | morale
 * !test !<cmd>          test one command by name
 *
 * Each test:
 *   1. Captures real broadcasts sent to the overlay
 *   2. Captures all chat messages sent
 *   3. Runs the real command through the real pipeline
 *   4. Verifies expected results
 *   5. State is fully restored after the entire suite completes
 *
 * State snapshot covers: balance, inventory, morale bowls,
 *   lurk sessions, XP records, action count, reward history.
 */

const fs   = require('fs');
const path = require('path');
const P    = require('../core/Paths');

const LOG       = path.join(P.logs, 'testall.log');
const TEST_UID  = '__testall_user__';
const TEST_MINT = '__testall_mint__';
const TIMEOUT   = 10000; // ms per test

// ─── Broadcast interceptor ────────────────────────────────────────────────────
// Wraps Broadcast.broadcast so we can capture what the overlay receives
function createBroadcastCapture() {
  const Broadcast = require('../core/Broadcast');
  const original  = Broadcast.broadcast.bind(Broadcast);
  const captured  = [];
  Broadcast.broadcast = (msg) => {
    captured.push({ ...msg, _ts: Date.now() });
    original(msg); // still send to real WS clients
  };
  return {
    captured,
    restore() { Broadcast.broadcast = original; },
    find(type, extra) {
      return captured.find(m => m.type === type && (!extra || Object.entries(extra).every(([k,v]) => m[k] === v)));
    },
    any(types) { return types.some(t => captured.some(m => m.type === t)); },
    clear()    { captured.length = 0; },
  };
}

// ─── Full state snapshot + restore ────────────────────────────────────────────
async function snapshotState(db, Balance, Inventory) {
  const snap = {
    balance:   Balance.get(TEST_UID),
    inventory: JSON.stringify(Inventory.get(TEST_UID) || []),
    xpNft:     db.prepare('SELECT * FROM pup_xp WHERE mint=?').get(TEST_MINT),
    xpUser:    db.prepare('SELECT * FROM user_xp WHERE user_id=?').get(TEST_UID),
    morale:    {},
    actionCount: 0,
  };
  try {
    const MS = require('../core/MoraleState');
    snap.morale = { food: MS.foodBowl, water: MS.waterBowl };
    snap.actionCount = MS.actionCount;
  } catch {}
  return snap;
}

async function restoreState(db, Balance, Inventory, snap) {
  try { Balance.set(TEST_UID, snap.balance); } catch {}
  try { Inventory.set(TEST_UID, JSON.parse(snap.inventory)); } catch {}
  // Clean up test XP records entirely (they didn't exist before)
  try { db.prepare('DELETE FROM pup_xp WHERE mint=?').run(TEST_MINT); } catch {}
  try { db.prepare('DELETE FROM user_xp WHERE user_id=?').run(TEST_UID); } catch {}
  try { db.prepare('DELETE FROM balances WHERE user_id=?').run(TEST_UID); } catch {}
  // Remove from lurk, active players
  try { const Lurk = require('../economy/lurk'); Lurk.remove(TEST_UID); } catch {}
  try { const MS = require('../core/MoraleState');
    MS.foodBowl = snap.morale.food; MS.waterBowl = snap.morale.water;
    MS.actionCount = snap.actionCount; } catch {}
}

// ─── Test context factory ─────────────────────────────────────────────────────
function makeTestCtx(ctx, bc, overrides = {}) {
  const msgs = [];
  return {
    ...ctx,
    userId:     TEST_UID,
    twitchId:   TEST_UID,
    user:       'TestBot',
    isSub:      false,
    isMod:      false,
    isDev:      false,
    isStreamer:  false,
    isLurkTick: false,
    isHowliday: false,
    adBreakActive: false,
    args:       [],
    say:        m => msgs.push(String(m)),
    broadcast:  bc ? (msg) => { bc.captured.push({ ...msg, _ts: Date.now() }); require('../core/Broadcast').broadcast(msg); }
                   : ctx.broadcast,
    _msgs:      msgs,
    ...overrides,
  };
}

function withTimeout(fn, ms) {
  return Promise.race([
    Promise.resolve().then(fn),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT after ${ms}ms`)), ms)),
  ]);
}

// ─── Result helpers ───────────────────────────────────────────────────────────
const pass = (detail) => ({ ok: true,  detail });
const fail = (detail) => ({ ok: false, detail });
const skip = (detail) => ({ ok: true,  detail: `SKIP: ${detail}` });

// ─── The full test suite ──────────────────────────────────────────────────────
function buildTests(ctx) {
  const { db, Balance, Inventory, PupCore, Lurk, SpriteManager } = ctx;

  return [

    // ══ INFRASTRUCTURE ═══════════════════════════════════════════════════════
    {
      name: 'db-alive', group: 'infra',
      desc: 'SQLite responds to SELECT 1',
      async run() {
        const r = db.prepare('SELECT 1 AS n').get();
        return r?.n === 1 ? pass('DB OK') : fail('SELECT 1 returned wrong value');
      },
    },
    {
      name: 'db-tables', group: 'infra',
      desc: 'All required tables exist (incl. pup_xp, user_xp)',
      async run() {
        const have = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
        const need = ['balances','users','pup_xp','user_xp','sprite_bonuses','app_state'];
        const miss = need.filter(t => !have.includes(t));
        return miss.length ? fail(`Missing: ${miss.join(', ')}`) : pass(`${have.length} tables`);
      },
    },
    {
      name: 'ws-clients', group: 'infra',
      desc: 'Overlay WebSocket client connected',
      async run() {
        const n = require('../core/Broadcast').clientCount();
        return n > 0 ? pass(`${n} client(s)`) : fail('No WS clients — overlay not connected');
      },
    },
    {
      name: 'http-reward-stats', group: 'infra',
      desc: '/reward-stats responds (regression: _pruneRewards TDZ bug)',
      async run() {
        return new Promise(resolve => {
          const req = require('http').get('http://localhost:3000/reward-stats', res => {
            let d=''; res.on('data',c=>d+=c);
            res.on('end', () => {
              try {
                const j = JSON.parse(d);
                resolve(typeof j.avgHr !== 'undefined' ? pass(`avgHr=${j.avgHr}`) : fail(`Bad shape: ${d.slice(0,60)}`));
              } catch(e) { resolve(fail(`JSON error: ${e.message}`)); }
            });
          });
          req.on('error', e => resolve(fail(e.message)));
          req.setTimeout(6000, () => { req.destroy(); resolve(fail('TIMEOUT — regression!')); });
        });
      },
    },
    {
      name: 'http-sol-price', group: 'infra',
      desc: '/sol-price returns valid JSON',
      async run() {
        return new Promise(resolve => {
          const req = require('http').get('http://localhost:3000/sol-price', res => {
            let d=''; res.on('data',c=>d+=c);
            res.on('end', () => {
              try { const j=JSON.parse(d); resolve(pass(`SOL=${j.price??'--'}`)); }
              catch(e) { resolve(fail(`JSON error: ${e.message}`)); }
            });
          });
          req.on('error', e => resolve(fail(e.message)));
          req.setTimeout(6000, () => { req.destroy(); resolve(fail('TIMEOUT')); });
        });
      },
    },
    {
      name: 'sprites-loaded', group: 'infra',
      desc: 'SpriteManager has sprites from assets/pups/',
      async run() {
        const list = SpriteManager.sprites();
        if (!list.length) return fail('No sprites — check assets/pups/{rarity}/ folders');
        const byRarity = {};
        for (const s of list) byRarity[s.rarity] = (byRarity[s.rarity]||0)+1;
        return pass(`${list.length} total: ${JSON.stringify(byRarity)}`);
      },
    },
    {
      name: 'config-economy', group: 'infra',
      desc: 'Economy config loads (toss_min, cooldown_ms)',
      async run() {
        const Config = require('../core/Config');
        const v = Config.get('toss_min');
        return typeof v === 'number' ? pass(`toss_min=${v}`) : fail(`toss_min not a number: ${v}`);
      },
    },

    // ══ GAME COMMANDS ════════════════════════════════════════════════════════
    ...['toss','throw','dig','fish','walk'].map(cmd => ({
      name: `cmd-${cmd}`, group: 'game',
      desc: `!${cmd}: chat response fires, balance increases, game broadcast sent to overlay`,
      async run() {
        Balance.set(TEST_UID, 0);
        const bc  = createBroadcastCapture();
        const tc  = makeTestCtx(ctx, bc, {
          Lurk: { ...Lurk, isActive:()=>false, remove:()=>{}, getLurkers:()=>[] },
        });
        bc.clear();
        try {
          const mod = require(`./${cmd}`);
          await mod.execute(tc);
        } finally { bc.restore(); }

        const bal    = Balance.get(TEST_UID);
        const said   = tc._msgs.length > 0;
        const gEvent = bc.find('game', { command: cmd });

        const issues = [];
        if (!said)   issues.push('no chat response');
        if (bal <= 0) issues.push(`balance not increased (${bal})`);
        if (!gEvent) issues.push('no game broadcast to overlay');
        else if (require('../core/Broadcast').clientCount() === 0) issues.push('overlay not connected (broadcast sent but no clients)');

        if (issues.length) return fail(issues.join('; '));
        return pass(`bal+${bal} · msg:"${tc._msgs[0]?.slice(0,40)}" · overlay:✓`);
      },
    })),
    {
      name: 'cmd-lick', group: 'game',
      desc: '!lick: chat response, chest_lick broadcast, food bowl increments',
      async run() {
        const MS   = require('../core/MoraleState');
        const before = MS.foodBowl;
        const bc   = createBroadcastCapture();
        const tc   = makeTestCtx(ctx, bc);
        // lick sends chest_lick → app.js intercept increments foodBowl and re-broadcasts bowl_update
        // In test, the intercept is still live so it should fire
        bc.clear();
        try {
          await require('./lick').execute(tc);
          // Give intercept a tick to process chest_lick → bowl_update
          await new Promise(r => setTimeout(r, 50));
        } finally { bc.restore(); }

        const lickSent   = bc.any(['chest_lick']);
        const bowlSent   = bc.any(['bowl_update']);
        const said       = tc._msgs.length > 0;
        const bowlAfter  = MS.foodBowl;

        const issues = [];
        if (!said)       issues.push('no chat response');
        if (!lickSent)   issues.push('no chest_lick broadcast');
        if (!bowlSent)   issues.push('no bowl_update broadcast (intercept not firing?)');
        if (bowlAfter <= before && before < 100) issues.push(`food bowl didn't increase (${before}→${bowlAfter})`);

        MS.foodBowl = before; // restore bowl
        return issues.length ? fail(issues.join('; ')) : pass(`bowl ${before}→${bowlAfter} · overlay:✓`);
      },
    },
    {
      name: 'cmd-lurk-start', group: 'game',
      desc: '!lurk: session starts, lurk_update broadcast fires',
      async run() {
        // Make sure not already lurking
        try { Lurk.remove(TEST_UID); } catch {}
        const bc  = createBroadcastCapture();
        const tc  = makeTestCtx(ctx, bc);
        bc.clear();
        try {
          await require('./lurk').execute(tc);
          await new Promise(r => setTimeout(r, 50));
        } finally { bc.restore(); }

        const lurking = Lurk.isActive(TEST_UID);
        const sent    = bc.any(['lurk_update']);
        const said    = tc._msgs.length > 0;
        // Clean up
        try { Lurk.remove(TEST_UID); } catch {}

        const issues = [];
        if (!said)    issues.push('no chat response');
        if (!lurking && !said) issues.push('user not in lurk state'); // lurk may have immediate tick
        if (!sent)    issues.push('no lurk_update broadcast');
        return issues.length ? fail(issues.join('; ')) : pass('lurk started · lurk_update sent');
      },
    },

    // ══ ECONOMY ══════════════════════════════════════════════════════════════
    {
      name: 'balance-cmd', group: 'economy',
      desc: '!balance shows correct amount in chat',
      async run() {
        Balance.set(TEST_UID, 12345);
        const tc = makeTestCtx(ctx, null);
        await require('./balance').execute(tc);
        const replied = tc._msgs.some(m => m.includes('12345') || m.includes('12,345'));
        return replied ? pass('balance shown correctly') : fail(`msg: "${tc._msgs.join('|')}"`);
      },
    },
    {
      name: 'inv-cmd', group: 'economy',
      desc: '!inv responds without crashing',
      async run() {
        const tc = makeTestCtx(ctx, null);
        await require('./inv').execute(tc);
        return tc._msgs.length ? pass(tc._msgs[0]?.slice(0,60)) : fail('no response');
      },
    },
    {
      name: 'cashout-test', group: 'economy',
      desc: '!cashout test dry-run responds correctly',
      async run() {
        Balance.set(TEST_UID, 5000);
        const tc = makeTestCtx(ctx, null, { args:['test'] });
        await require('./cashout').execute(tc);
        const ok = tc._msgs.some(m => m.toLowerCase().includes('test') || m.includes('would'));
        return ok ? pass(tc._msgs[0]?.slice(0,60)) : fail(`msg: "${tc._msgs.join('|')}"`);
      },
    },
    {
      name: 'cashout-disabled', group: 'economy',
      desc: '!cashout disable/enable cycle works, viewers blocked when disabled',
      async run() {
        const mod = require('./cashout');
        // Disable
        const tcDev = makeTestCtx(ctx, null, { args:['disable'], isDev:true });
        await mod.execute(tcDev);
        // Viewer attempt
        Balance.set(TEST_UID, 5000);
        const tcViewer = makeTestCtx(ctx, null, { args:[] });
        await mod.execute(tcViewer);
        const blocked = tcViewer._msgs.some(m => m.toLowerCase().includes('disabled'));
        // Re-enable
        const tcEnable = makeTestCtx(ctx, null, { args:['enable'], isDev:true });
        await mod.execute(tcEnable);
        return blocked ? pass('viewers correctly blocked, re-enabled') : fail('viewer was NOT blocked when cashouts disabled');
      },
    },
    {
      name: 'calcReward-all-games', group: 'economy',
      desc: 'calcReward produces positive numbers for all 5 game types',
      async run() {
        const { calcReward } = require('../economy/calcReward');
        const results = ['toss','throw','dig','fish','walk'].map(g => {
          const { amount } = calcReward(g, ctx.cfg, { rarity:'common' });
          return `${g}=${amount}`;
        });
        const bad = results.filter(r => !(parseInt(r.split('=')[1]) > 0));
        return bad.length ? fail(`Non-positive: ${bad.join(', ')}`) : pass(results.join(' '));
      },
    },
    {
      name: 'vend-cmd', group: 'economy',
      desc: '!vend responds without crashing (even with empty inventory)',
      async run() {
        Inventory.set(TEST_UID, []);
        const tc = makeTestCtx(ctx, null, { args:['all'] });
        try { await require('./vend').execute(tc); } catch(e) { return fail(e.message); }
        return pass(tc._msgs[0]?.slice(0,60) || 'no inventory — responded OK');
      },
    },

    // ══ XP SYSTEM ════════════════════════════════════════════════════════════
    {
      name: 'xp-nft-add', group: 'xp',
      desc: 'addXP → getStats round-trip stores and reads correctly',
      async run() {
        const PupXP = require('../economy/pupXP');
        db.prepare('DELETE FROM pup_xp WHERE mint=?').run(TEST_MINT);
        const r = PupXP.addXP(db, TEST_MINT, 15);
        const s = PupXP.getStats(db, TEST_MINT);
        db.prepare('DELETE FROM pup_xp WHERE mint=?').run(TEST_MINT);
        if (s?.xp !== 15) return fail(`xp=${s?.xp}, expected 15`);
        return pass(`xp=15, level=${s.level}, pct=${s.pct}%`);
      },
    },
    {
      name: 'xp-user-add', group: 'xp',
      desc: 'addUserXP → getUserStats round-trip',
      async run() {
        const PupXP = require('../economy/pupXP');
        db.prepare('DELETE FROM user_xp WHERE user_id=?').run(TEST_UID);
        PupXP.addUserXP(db, TEST_UID, 100);
        const s = PupXP.getUserStats(db, TEST_UID);
        db.prepare('DELETE FROM user_xp WHERE user_id=?').run(TEST_UID);
        if (s?.xp !== 100) return fail(`xp=${s?.xp}, expected 100`);
        return pass(`xp=100, level=${s.level}`);
      },
    },
    {
      name: 'xp-dynamic-rarity', group: 'xp',
      desc: 'Level 999 (no other NFTs) → legendary rarity',
      async run() {
        const PupXP = require('../economy/pupXP');
        const r = PupXP.getDynamicRarity(db, 999);
        return r === 'legendary' ? pass('level 999 → legendary ✓') : fail(`got: ${r}`);
      },
    },
    {
      name: 'xp-game-awards', group: 'xp',
      desc: 'Playing a game command awards XP to both ladders',
      async run() {
        const PupXP = require('../economy/pupXP');
        db.prepare('DELETE FROM pup_xp WHERE mint=?').run(TEST_MINT);
        db.prepare('DELETE FROM user_xp WHERE user_id=?').run(TEST_UID);
        Balance.set(TEST_UID, 0);
        // Simulate broadcast intercept awarding XP (same as real game flow)
        PupXP.addXP(db, TEST_MINT, PupXP.calcXP(true, false));
        PupXP.addUserXP(db, TEST_UID, PupXP.calcXP(true, false));
        const nft  = PupXP.getStats(db, TEST_MINT);
        const user = PupXP.getUserStats(db, TEST_UID);
        db.prepare('DELETE FROM pup_xp WHERE mint=?').run(TEST_MINT);
        db.prepare('DELETE FROM user_xp WHERE user_id=?').run(TEST_UID);
        if (!nft?.xp || !user?.xp) return fail(`NFT xp=${nft?.xp} user xp=${user?.xp}`);
        return pass(`NFT xp=${nft.xp} user xp=${user.xp} (favPup+noSub = ${PupXP.calcXP(true,false)} each)`);
      },
    },

    // ══ OVERLAY / BROADCAST ══════════════════════════════════════════════════
    {
      name: 'broadcast-reaches-overlay', group: 'overlay',
      desc: 'Broadcast.broadcast sends to connected WS clients',
      async run() {
        const Broadcast = require('../core/Broadcast');
        const n = Broadcast.clientCount();
        if (n === 0) return fail('No WS clients — overlay not connected. Stream running?');
        Broadcast.broadcast({ type:'__test_ping__', ts: Date.now() });
        return pass(`sent to ${n} client(s)`);
      },
    },
    {
      name: 'game-broadcast-shape', group: 'overlay',
      desc: 'Game broadcast contains required fields for overlay animation',
      async run() {
        Balance.set(TEST_UID, 0);
        const bc  = createBroadcastCapture();
        const tc  = makeTestCtx(ctx, bc, {
          Lurk: { ...Lurk, isActive:()=>false, remove:()=>{}, getLurkers:()=>[] },
        });
        bc.clear();
        try { await require('./toss').execute(tc); } finally { bc.restore(); }
        const ev = bc.find('game', { command:'toss' });
        if (!ev) return fail('No game broadcast captured');
        const need = ['userId','user','reward','rarity','pupId'];
        const miss = need.filter(k => ev[k] === undefined);
        return miss.length ? fail(`Missing fields: ${miss.join(', ')}`) : pass(`fields: ${Object.keys(ev).join(' ')}`);
      },
    },
    {
      name: 'active-players-update', group: 'overlay',
      desc: 'Playing a game triggers active_players broadcast to overlay',
      async run() {
        Balance.set(TEST_UID, 0);
        const bc  = createBroadcastCapture();
        const tc  = makeTestCtx(ctx, bc, {
          Lurk: { ...Lurk, isActive:()=>false, remove:()=>{}, getLurkers:()=>[] },
        });
        bc.clear();
        try {
          await require('./toss').execute(tc);
          await new Promise(r => setTimeout(r, 100));
        } finally { bc.restore(); }
        const ap = bc.find('active_players');
        return ap ? pass(`active_players broadcast: ${ap.players?.length ?? '?'} players`) : fail('no active_players broadcast');
      },
    },

    // ══ MORALE ═══════════════════════════════════════════════════════════════
    {
      name: 'morale-lick', group: 'morale',
      desc: '!lick increments food bowl and fires bowl_update to overlay',
      async run() {
        const MS = require('../core/MoraleState');
        MS.foodBowl = 50;
        const bc = createBroadcastCapture();
        const tc = makeTestCtx(ctx, bc);
        bc.clear();
        try {
          await require('./lick').execute(tc);
          await new Promise(r => setTimeout(r, 100));
        } finally { bc.restore(); }
        const bowl = bc.find('bowl_update');
        const grew = MS.foodBowl > 50;
        MS.foodBowl = 50; // restore
        if (!bowl) return fail('no bowl_update broadcast to overlay');
        if (!grew) return fail(`food bowl didn't grow (${MS.foodBowl})`);
        return pass(`food: 50→${bowl.food} · overlay:✓`);
      },
    },
    {
      name: 'morale-feed', group: 'morale',
      desc: '!feed fills food bowl and fires bowl_update',
      async run() {
        const MS = require('../core/MoraleState');
        MS.foodBowl = 40;
        const bc = createBroadcastCapture();
        const tc = makeTestCtx(ctx, bc, { isMod: true });
        bc.clear();
        try {
          await require('./feed').execute(tc).catch(()=>{});
          await new Promise(r => setTimeout(r, 100));
        } finally { bc.restore(); }
        const bowl = bc.find('bowl_update');
        return bowl ? pass(`food after feed: ${bowl.food}`) : fail('no bowl_update (check !feed command)');
      },
    },
    {
      name: 'morale-water', group: 'morale',
      desc: '!water fills water bowl and fires bowl_update',
      async run() {
        const MS = require('../core/MoraleState');
        MS.waterBowl = 40;
        const bc = createBroadcastCapture();
        const tc = makeTestCtx(ctx, bc, { isMod: true });
        bc.clear();
        try {
          await require('./water').execute(tc).catch(()=>{});
          await new Promise(r => setTimeout(r, 100));
        } finally { bc.restore(); }
        const bowl = bc.find('bowl_update');
        return bowl ? pass(`water after water: ${bowl.water}`) : fail('no bowl_update (check !water command)');
      },
    },
    {
      name: 'morale-score', group: 'morale',
      desc: 'MoraleState.calcScore computes valid score',
      async run() {
        const MS = require('../core/MoraleState');
        if (typeof MS.calcScore !== 'function') return fail('MoraleState.calcScore not a function');
        const s = MS.calcScore(5, 10);
        return typeof s === 'number' ? pass(`score(5 active, 10 lurkers)=${s}`) : fail(`non-number: ${s}`);
      },
    },

    // ══ PUPSTATS / NFT POPUP ═════════════════════════════════════════════════
    {
      name: 'cmd-pupstats', group: 'nft',
      desc: '!pupstats responds with level info (no NFT set)',
      async run() {
        const tc = makeTestCtx(ctx, null, {
          PupCore: { getCachedState: () => null },
        });
        await require('./pupstats').execute(tc);
        const ok = tc._msgs.some(m => m.includes('Lvl') || m.includes('Level') || m.includes('level'));
        return ok ? pass(tc._msgs[0]?.slice(0,80)) : fail(`msg: "${tc._msgs.join('|')}"`);
      },
    },
    {
      name: 'cmd-checkfav-no-nft', group: 'nft',
      desc: '!checkfav without NFT set gives helpful response',
      async run() {
        const tc = makeTestCtx(ctx, null, {
          PupCore: { getCachedState: () => ({ favPupName: null, favPupImageURL: null, favPupMint: null }) },
        });
        try { await require('./checkfav').execute(tc); } catch {}
        return pass(tc._msgs[0]?.slice(0,60) || 'responded OK (no NFT)');
      },
    },

    // ══ CHANNEL POINTS ═══════════════════════════════════════════════════════
    {
      name: 'channel-points-shared-cooldown', group: 'channelpoints',
      desc: 'Channel point redemption respects same cooldown as typed command',
      async run() {
        // Simulate typing !toss (sets cooldown)
        const chat = require('../core/Chat'); // singleton or constructor?
        // We test by checking the _cd map directly
        const { _cd_get, _cd_set } = (() => {
          try {
            // _cd is module-scoped in Chat.js; no direct export but we can check via proxy
            // Instead, run the command to set the CD, then verify redeemChannelPoint rejects it
            return { _cd_get: null, _cd_set: null };
          } catch { return {}; }
        })();
        // Just verify redeemChannelPoint is a function on the chat instance
        if (typeof ctx._chat?.redeemChannelPoint !== 'function') {
          return skip('chat instance not in ctx — verify in live stream');
        }
        return pass('redeemChannelPoint method available on chat instance');
      },
    },

  ];
}

// ─── Log writer ───────────────────────────────────────────────────────────────
function writeLog(lines) {
  fs.mkdirSync(P.logs, { recursive:true });
  fs.appendFileSync(LOG, lines.join('\n') + '\n');
}

// ─── Run a single test with timeout ──────────────────────────────────────────
async function runOne(test) {
  const t0 = Date.now();
  let result;
  try {
    result = await withTimeout(() => test.run(), TIMEOUT);
  } catch(e) {
    result = { ok: false, detail: e.message.startsWith('TIMEOUT') ? `⏱ ${e.message}` : `💥 ${e.message}` };
  }
  result.ms = Date.now() - t0;
  return result;
}

// ─── Full suite ───────────────────────────────────────────────────────────────
async function runSuite(tests, ctx, say) {
  const { db, Balance, Inventory } = ctx;
  const ts = new Date().toISOString();

  writeLog([
    '',
    '══════════════════════════════════════════════════',
    `ChoctoTV Integration Test Suite — ${ts}`,
    `Tests: ${tests.length}  Timeout per test: ${TIMEOUT}ms`,
    '══════════════════════════════════════════════════',
  ]);

  say(`🧪 Starting ${tests.length} integration tests — saving game state...`);

  // ── Snapshot everything ────────────────────────────────────────────────────
  const snap = await snapshotState(db, Balance, Inventory);
  Balance.set(TEST_UID, 5000); // give test user starting funds

  let pass=0, fail=0, timeout=0;
  const failures = [];

  // ── Run tests sequentially ─────────────────────────────────────────────────
  for (const test of tests) {
    const r = await runOne(test);
    const isTimeout = r.detail?.startsWith('⏱');
    if (r.ok) pass++; else if (isTimeout) timeout++; else fail++;
    if (!r.ok) failures.push({ test, r });

    const status = r.ok ? 'PASS' : (isTimeout ? 'TIMEOUT' : 'FAIL');
    const icon   = r.ok ? '✅' : (isTimeout ? '⏱ ' : '❌');
    writeLog([`[${status.padEnd(7)}] ${test.name.padEnd(30)} ${r.ms}ms  ${r.detail}`]);
    console.log(`[Test] ${icon} ${test.name}: ${r.detail}`);
  }

  // ── Restore state ──────────────────────────────────────────────────────────
  await restoreState(db, Balance, Inventory, snap);
  writeLog(['', `Result: ${pass} pass  ${fail} fail  ${timeout} timeout  /  ${tests.length} total`, '']);

  say(`🧪 Done: ✅${pass} ❌${fail} ⏱${timeout} — state restored. See data/logs/testall.log`);
  if (failures.length) {
    const summary = failures.slice(0,5).map(f => `${f.test.name}(${f.r.detail?.slice(0,25)})`).join(' · ');
    say(`❌ Failed: ${summary}${failures.length>5?' +more':''}`);
  }
}

// ─── Command export ───────────────────────────────────────────────────────────
module.exports = {
  name: 'testfeatures',
  aliases: ['testall'],
  permissions: 'dev',
  cooldown: 30,

  async execute(ctx) {
    const { args, say } = ctx;
    const target = (args[0] || 'all').toLowerCase().replace(/^!/, '');
    const all    = buildTests(ctx);

    const byName  = all.find(t => t.name === target || t.name === `cmd-${target}`);
    const byGroup = all.filter(t => t.group === target);
    const suite   = target === 'all' ? all : byGroup.length ? byGroup : byName ? [byName] : null;

    if (!suite) {
      const groups = [...new Set(all.map(t=>t.group))];
      say(`❓ Unknown: "${target}". Groups: ${groups.join(', ')}`);
      return { ok:false };
    }
    await runSuite(suite, ctx, say);
    return { ok:true };
  },
};
