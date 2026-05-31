'use strict';
module.exports = {
  name: 'help',
  permissions: 'viewer',
  cooldown: 30,

  execute(ctx) {
    const { say } = ctx;
    say(
      '🐾 Games: !toss !throw !dig !fish/cast !walk !lick !lurk !battle !gauntlet'
      + ' · 💰 Balance: !balance !inv !cashout'
      + ' · 🏪 Vend: !vend sticks/balls/moons/all'
      + ' · ⚗️ Forge: !forgeballs !forgemoons'
      + ' · 🐕 NFT: !setwallet <SOL> → !setfav <mint> · !namepup <name> · !pupstats · !checkfav'
      + ' · 📖 !lore !tradition !top'
    );
    return { ok: true };
  },
};
