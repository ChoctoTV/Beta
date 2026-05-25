'use strict';
const Duty = require('../economy/duty');
module.exports = {
  name:'onduty', aliases:['offduty'], permissions:'mod', cooldown:false,
  execute(ctx) {
    const { userId, user, cmd, say, cfg, broadcast } = ctx;
    if (cmd==='offduty') {
      const was = Duty.goOffDuty(userId);
      if (!was) { say(`❌ @${user} not on duty`); return { ok:false }; }
      say(`👋 @${user} went off duty`);
      broadcast({ type:'offduty', user });
      return { ok:true };
    }
    const role = Duty.goOnDuty(userId);
    if (!role) { say(`❌ @${user} needs Mod or Dev role`); return { ok:false }; }
    const budget = Duty.freeLeft(userId, cfg);
    const boost  = Math.round(cfg('mod_onduty_boost')*100);
    if (role==='mod') say(`🛡️ @${user} ON DUTY! +${boost}% rewards! Budget: ${budget.toLocaleString()}🍫`);
    else              say(`🔧 @${user} ON DUTY! Budget: ${budget.toLocaleString()}🍫`);
    broadcast({ type:'onduty', user, role });
    return { ok:true };
  },
};
