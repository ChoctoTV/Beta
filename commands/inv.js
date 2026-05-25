'use strict';
// !inv — show a user's inventory / wallet info
// Triggers on: inv, inventory, wallet (with or without !)
module.exports = {
  name:'inv', aliases:['inventory','wallet'], permissions:'viewer', cooldown:10,
  async execute({ userId, user, say, Balance, PupCore }) {
    // Fav pup info
    let favLine = '';
    try {
      const pc = PupCore.getCachedState(userId);
      if (pc?.favPupName) favLine = ` | 🐾 Fav: ${pc.favPupName}`;
      else if (pc?.walletAddress) favLine = ` | 💼 Wallet linked (no fav set — use !setfav)`;
      else favLine = ` | 💼 No wallet linked — use !setwallet`;
    } catch {}

    const bal = Balance.get(userId) || 0;
    say(`🎒 @${user} — 🍫 ${bal} ChoctoBits${favLine}`);
    return { ok:true };
  },
};
