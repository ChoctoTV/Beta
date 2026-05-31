'use strict';
const DynRewards  = require('../economy/dynamicRewards');
const MoraleState = require('../core/MoraleState');

module.exports = {
  name:'poolstatus',
  requirePrefix: true, aliases:['poolhealth','rewardpool'], permissions:'mod', cooldown:false,
  execute({ say, cfg }) {
    const ap     = MoraleState.getActivePlayers().length;
    const status = DynRewards.getStatus(cfg, ap);
    say(
      `📊 Pool: ${status.poolPct}% remaining | ${status.mode} | ` +
      `Mult: ${status.effectiveMult}x (health:${status.healthMult} congestion:${status.congestionMult}) | ` +
      `Active: ${ap} players`
    );
    return { ok:true };
  },
};
