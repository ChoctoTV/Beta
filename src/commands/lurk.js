'use strict';
const MoraleState = require('../core/MoraleState');
// Lick is ACTIVE-PLAYER only — not available to lurkers
const GAMES     = ['toss','throw','dig','walk','fish'];
// Same cooldown rules as regular commands (seconds)
const GAME_CD   = { toss:60, throw:60, dig:60, fish:60, walk:180 };
// Per-lurker per-game cooldown tracking (survives across ticks)
const _lurkCDs  = new Map(); // key: 'userId:game' → last-used timestamp ms

module.exports = {
  name:'lurk', permissions:'viewer', cooldown:false,

  execute(ctx) {
    const { userId, user, cfg, Lurk, broadcast, say } = ctx;
    const mult = cfg('lurk_reward_mult');
    const hr   = cfg('lurk_duration_hr');

    // onTick: actually fire game commands in the background so animations play.
    // Say is silenced (no chat spam) — overlay animation + lurk_earn still broadcast.
    async function onTick(tickId) {
      // Respect same per-command cooldowns as active players
      const now       = Date.now();
      const available = GAMES.filter(g => {
        const cd = (GAME_CD[g] || 60) * 1000;
        return now - (_lurkCDs.get(`${tickId}:${g}`) || 0) >= cd;
      });
      if (!available.length) return;  // all on cooldown — skip tick

      const game = available[Math.floor(Math.random() * available.length)];
      _lurkCDs.set(`${tickId}:${game}`, now);

      const silentCtx = { ...ctx, userId:tickId, user:tickId, args:[], cmd:game,
        isSub:false, say:()=>{}, isLurkTick:true };
      try { await require(`./${game}`).execute(silentCtx); } catch {}
      // Push updated lurker list to ticker
      broadcast({ type:'lurk_update', lurkers: Lurk.getLurkers() });
    }

    const res = Lurk.add(userId, user, hr, onTick);
    MoraleState.plays.delete(userId);  // can't be active + lurking at same time

    // Always broadcast lurk_update — the app.js interceptor will sync active_players too
    broadcast({ type:'lurk_update', lurkers: Lurk.getLurkers() });

    if (res.existing) {
      say(`😴 @${user} already lurking! (${Math.round(mult*100)}% earn rate) 🌙`);
    } else {
      say(`😴 @${user} entered lurk mode — auto-playing for up to ${hr}h at ${Math.round(mult*100)}% rate 🌙`);
    }
    return { ok:true };
  },
};
