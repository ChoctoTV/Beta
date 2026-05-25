'use strict';
module.exports = {
  name:'forgeballs', permissions:'viewer', cooldown:false,
  execute(ctx) {
    const { userId, user, say, cfg, args, Inventory } = ctx;
    const inv  = Inventory.get(userId);
    const cost = cfg('forge_balls_cost');
    const isAll = (args[0] || '').toLowerCase() === 'all';

    if (inv.sticks < cost) { say(`❌ @${user} need ${cost}🪵 to forge 1🎾 (have ${inv.sticks})`); return { ok:false }; }

    const qty = isAll ? Math.floor(inv.sticks / cost) : 1;
    const spend = qty * cost;
    Inventory.add(userId, { sticks:-spend, balls:qty });
    if (qty > 1) say(`⚒️ @${user} forged ${qty}🎾 in one go! (-${spend}🪵, ${inv.sticks-spend}🪵 left)`);
    else say(`⚒️ @${user} forged a ball! (${inv.sticks-spend}🪵 left)`);
    return { ok:true };
  },
};
