'use strict';
module.exports = {
  name:'setwallet', permissions:'viewer', cooldown:false,
  async execute(ctx) {
    const { userId, user, args, say, PupCore } = ctx;
    const addr = args[0]||'';
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) { say(`❌ @${user} invalid Solana address`); return { ok:false }; }
    const r = await PupCore.equip(userId, { wallet:addr });
    if (!r?.ok) { say(`❌ @${user} ${r?.error||'failed'}`); return { ok:false }; }
    say(`✅ @${user} wallet linked (${addr.slice(0,6)}...${addr.slice(-4)})`);
    return { ok:true };
  },
};
