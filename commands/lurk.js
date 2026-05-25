'use strict';
const MoraleState = require('../core/MoraleState');
const GAMES = ['toss','throw','dig','walk','fish'];

module.exports = {
  name:'lurk', permissions:'viewer', cooldown:false,

  execute(ctx) {
    const { userId, user, cfg, Lurk, broadcast, say } = ctx;
    const mult = cfg('lurk_reward_mult');
    const hr   = cfg('lurk_duration_hr');

    // onTick: actually fire game commands in the background so animations play.
    // Say is silenced (no chat spam) — overlay animation + lurk_earn still broadcast.
    async function onTick(tickId) {
      const game = GAMES[Math.floor(Math.random() * GAMES.length)];
      const silentCtx = { ...ctx, userId:tickId, user:tickId, args:[], cmd:game,
        isSub:false, say:()=>{}, isLurkTick:true }; // silent — isLurkTick prevents self-cancellation
      try { await require(`./${game}`).execute(silentCtx); } catch {}
      // Push updated lurker list to ticker
      broadcast({ type:'lurk_update', lurkers: Lurk.getLurkers() });
    }

    const res = Lurk.add(userId, user, hr, onTick);
    MoraleState.plays.delete(userId);  // can't be active + lurking at same time

    if (res.existing) {
      say(`😴 @${user} already lurking! (${Math.round(mult*100)}% earn rate) 🌙`);
    } else {
      say(`😴 @${user} entered lurk mode — auto-playing for up to ${hr}h at ${Math.round(mult*100)}% rate 🌙`);
      // Immediately push updated lurker list
      broadcast({ type:'lurk_update', lurkers: Lurk.getLurkers() });
    }
    return { ok:true };
  },
};
