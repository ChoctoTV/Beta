'use strict';
module.exports = {
  name:'top', permissions:'viewer', cooldown:false,
  execute(ctx) {
    const { CHANNEL, say, Balance } = ctx;
    const rows = Balance.top(5, CHANNEL);
    if (!rows.length) { say('No balances yet!'); return { ok:true }; }
    say(`🏆 Top 5: ${rows.map((r,i)=>`${i+1}. @${r.display} ${r.amount.toLocaleString()}🍫`).join(' · ')}`);
    return { ok:true };
  },
};
