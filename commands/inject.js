'use strict';
module.exports = {
  name:'inject', permissions:'streamer', cooldown:false,
  execute(ctx) {
    const { args, say, Balance } = ctx;
    const target = (args[0]||'').replace('@','').toLowerCase();
    const amount = parseInt(args[1]);
    if (!target||isNaN(amount)||amount<=0) { say(`❌ Usage: !inject @user <amount>`); return { ok:false }; }
    const before = Balance.get(target);
    const after  = Balance.add(target, amount, target);
    say(`💉 @${target}: ${before.toLocaleString()}🍫 → ${after.toLocaleString()}🍫 (+${amount.toLocaleString()})`);
    return { ok:true };
  },
};
