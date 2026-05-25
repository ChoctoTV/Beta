'use strict';
const MoraleState = require('../core/MoraleState');

module.exports = {
  name:'feed', aliases:['feedpups','feedthepups'], permissions:'viewer', cooldown:180,
  async execute(ctx) {
    const { userId, user, say, Balance, Lurk, broadcast, PupCore } = ctx;
    const isLurking = Lurk.isActive(userId);

    // Fill food bowl
    MoraleState.foodBowl = Math.min(100, MoraleState.foodBowl + 10);
    broadcast({ type:'bowl_update', food: MoraleState.foodBowl, water: MoraleState.waterBowl });
    // Animate AP count → water bowl, lurker count → food bowl
    broadcast({ type:'bowl_filled', bowl:'food',
      activePlayers: MoraleState.getActivePlayers().length,
      lurkers: Lurk.getLurkers().length });

    // Pay 5 bits to the right group
    const lurkers        = Lurk.getLurkers().map(l => l.userId);
    const activePlayers  = MoraleState.getActivePlayers();
    const recipients     = isLurking ? lurkers : activePlayers;
    const groupLabel     = isLurking ? 'lurkers' : 'active players';

    let paid = 0;
    for (const uid of recipients) { Balance.add(uid, 5, 'bowl_feed'); paid++; }

    if (paid > 0) {
      say(`🍗 @${user} filled the food bowl! +5🍫 for ${paid} ${groupLabel}!`);
    } else {
      say(`🍗 @${user} filled the food bowl! (nobody in ${groupLabel} right now)`);
    }
    return { ok:true };
  },
};
