'use strict';
module.exports = {
  name:'balance', aliases:['inv','inventory'], permissions:'viewer', cooldown:false,
  execute(ctx) {
    const { userId, user, say, Balance, Inventory } = ctx;
    const bal = Balance.get(userId);
    const inv = Inventory.get(userId);
    say(`🍫 @${user}: ${bal.toLocaleString()}🍫 · ${inv.sticks}🪵 ${inv.balls}🎾 ${inv.moons}🌙`);
    return { ok:true };
  },
};
