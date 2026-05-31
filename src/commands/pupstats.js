'use strict';
module.exports = {
  name: 'pupstats',
  aliases: ['puplevel', 'level'],
  permissions: 'viewer',
  cooldown: 10,

  execute(ctx) {
    const { userId, user, say, PupCore, db } = ctx;
    const PupXP = require('../economy/pupXP');

    const uStats  = PupXP.getUserStats(db, userId);
    const uBar    = bar(uStats.pct);
    const state   = PupCore.getCachedState(userId);
    const mint    = state?.favPupMint;

    if (mint) {
      const nStats  = PupXP.getStats(db, mint);
      const nameRow = db.prepare('SELECT game_name FROM mint_names WHERE mint=?').get(mint);
      const name    = nameRow?.game_name || mint.slice(0,6)+'...'+mint.slice(-4);
      say(`👤 @${user} Player Lvl ${uStats.level} ${uBar} | `
        + `🐾 ${name} NFT Lvl ${nStats.level} ${bar(nStats.pct)} | `
        + `Hourly passive: ${uStats.level + nStats.level}🍫`);
    } else {
      say(`👤 @${user} Player Lvl ${uStats.level} ${uBar} (${uStats.xpInLevel}/${uStats.xpToNext} XP) | `
        + `No NFT set — use !setfav for NFT XP + hourly bonus`);
    }
    return { ok: true };
  },
};

function bar(pct) {
  const f = Math.round(pct / 10);
  return '▓'.repeat(f) + '░'.repeat(10 - f);
}
