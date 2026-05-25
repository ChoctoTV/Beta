'use strict';
const GBMEcon = require('../economy/gbm');
module.exports = {
  name:'gbm', aliases:['goodballmoon'], permissions:'viewer', cooldown:false,
  execute(ctx) {
    const { userId, user, args, say } = ctx;
    const raw = args[0]||'';
    if (!raw) {
      const cur = GBMEcon.getPick(userId);
      say(cur ? `🎯 @${user} your pick: ${cur} (change: !gbm Good/Ball/Moon)` : `❌ Usage: !gbm Good/Ball/Moon`);
      return { ok:true };
    }
    const r = GBMEcon.setPick(userId, raw);
    if (!r.ok) { say(`❌ @${user} ${r.error}`); return { ok:false }; }
    say(`🎯 @${user} picked ${r.pick}! Stays until changed.`);
    return { ok:true };
  },
};
