'use strict';
const MoraleState = require('../core/MoraleState');

module.exports = {
  name:'water', aliases:['waterpups','waterthepups'], permissions:'viewer', cooldown:180,
  async execute(ctx) {
    const { userId, user, say, Balance, Lurk, broadcast } = ctx;
    const isLurking = Lurk.isActive(userId);

    MoraleState.waterBowl = Math.min(100, MoraleState.waterBowl + 10);
    broadcast({ type:'bowl_update', food: MoraleState.foodBowl, water: MoraleState.waterBowl });
    // Animate AP count → water bowl, lurker count → food bowl
    broadcast({ type:'bowl_filled', bowl:'water',
      activePlayers: MoraleState.getActivePlayers().length,
      lurkers: Lurk.getLurkers().length });

    const lurkers       = Lurk.getLurkers().map(l => l.userId);
    const activePlayers = MoraleState.getActivePlayers();
    const recipients    = isLurking ? lurkers : activePlayers;
    const groupLabel    = isLurking ? 'lurkers' : 'active players';

    let paid = 0;
    for (const uid of recipients) { Balance.add(uid, 5, 'bowl_water'); paid++; }

    if (paid > 0) {
      say(`💧 @${user} refilled the water bowl! +5🍫 for ${paid} ${groupLabel}!`);
    } else {
      say(`💧 @${user} refilled the water bowl! (nobody in ${groupLabel} right now)`);
    }
    return { ok:true };
  },
};
