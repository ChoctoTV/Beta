'use strict';
const Lotto = require('../economy/lottery');
module.exports = {
  name:'ticket', aliases:['lottoupdate'], permissions:'viewer', cooldown:false,
  execute(ctx) {
    const { userId, user, args, say, cmd } = ctx;
    if (cmd==='lottoupdate') {
      const r = Lotto.setTicket(userId, args[0]||'');
      if (!r.ok) { say(`❌ @${user} ${r.error}`); return { ok:false }; }
      say(`🎰 @${user} ticket set: ${Lotto.format(r.numbers)} — plays every daily draw!`);
    } else {
      const t = Lotto.getTicket(userId);
      say(t ? `🎰 @${user}: ${Lotto.format(t)} (change: !lottoupdate XXXX)` : `🎰 @${user} no ticket — use !lottoupdate 1234`);
    }
    return { ok:true };
  },
};
