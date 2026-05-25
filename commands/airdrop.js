'use strict';
const Duty     = require('../economy/duty');
const Activity = require('../economy/activity');
module.exports = {
  name:'airdrop', permissions:'mod', cooldown:false,
  execute(ctx) {
    const { userId, user, args, say, cfg, broadcast, Balance, Roles } = ctx;
    if (!Duty.isOnDuty(userId)) { say(`❌ @${user} use !onduty first`); return { ok:false }; }
    const amt = parseInt(args[0]);
    if (isNaN(amt)||amt<cfg('airdrop_min')) { say(`❌ Minimum: ${cfg('airdrop_min').toLocaleString()}🍫`); return { ok:false }; }
    if (amt>cfg('airdrop_max')) { say(`❌ Maximum: ${cfg('airdrop_max').toLocaleString()}🍫`); return { ok:false }; }
    const eligible = Activity.getActive(cfg('airdrop_window_min')*60000, userId);
    if (!eligible.length) { say(`❌ No active viewers in last ${cfg('airdrop_window_min')} min`); return { ok:false }; }
    const share  = Math.floor(amt/eligible.length);
    if (share<1)  { say(`❌ Amount too small for ${eligible.length} viewers`); return { ok:false }; }
    const actual = share*eligible.length;
    const fl     = Duty.freeLeft(userId, cfg);
    if (fl>=actual) {
      Duty.useBudget(userId, actual, 'free');
    } else if (Roles.isDev(userId)) {
      if (Balance.get(userId)<actual) { say(`❌ Not enough Choctobits`); return { ok:false }; }
      Balance.subtract(userId, actual);
      Duty.useBudget(userId, actual, 'paid');
    } else {
      say(`❌ Free budget exhausted (${fl.toLocaleString()}🍫 left). Resets midnight UTC.`); return { ok:false };
    }
    for (const eu of eligible) Balance.add(eu, share);
    const left = Duty.freeLeft(userId, cfg);
    say(`🪂 AIRDROP! @${user} — ${actual.toLocaleString()}🍫 to ${eligible.length} viewers (+${share.toLocaleString()}🍫 each) 🎉`);
    if (left>0) say(`ℹ️ @${user} free budget left: ${left.toLocaleString()}🍫`);
    broadcast({ type:'airdrop', dropper:user, amount:actual, share, recipients:eligible.length });
    return { ok:true };
  },
};
