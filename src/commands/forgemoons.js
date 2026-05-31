'use strict';
module.exports = {
  name:'forgemoons',
  requirePrefix: true, permissions:'viewer', cooldown:false,
  execute(ctx) {
    const { userId, user, say, cfg, args, Inventory } = ctx;
    const inv  = Inventory.get(userId);
    const cost = cfg('forge_moons_cost');
    const isAll = (args[0] || '').toLowerCase() === 'all';

    if (inv.balls < cost) { say(`❌ @${user} need ${cost}🎾 to forge 1🌙 (have ${inv.balls})`); return { ok:false }; }

    const qty = isAll ? Math.floor(inv.balls / cost) : 1;
    const spend = qty * cost;
    Inventory.add(userId, { balls:-spend, moons:qty });
    if (qty > 1) say(`⚒️ @${user} forged ${qty}🌙 in one go! (-${spend}🎾, ${inv.balls-spend}🎾 left)`);
    else say(`⚒️ @${user} forged a moon! (${inv.balls-spend}🎾 left)`);
    return { ok:true };
  },
};
