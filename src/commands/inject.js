'use strict';
module.exports = {
  name: 'inject',
  requirePrefix: true, permissions: 'streamer', cooldown: false,
  execute(ctx) {
    const { args, say, Balance } = ctx;
    const target = (args[0]||'').replace('@','').toLowerCase();
    const amount = parseInt(args[1]);
    if (!target || isNaN(amount) || amount <= 0) { say(`❌ Usage: !inject @user <amount>`); return { ok:false }; }
    Balance.add(target, amount, target);
    say('confirmed');
    return { ok:true };
  },
};
