'use strict';
// !setwallet <address>  OR  !setwallet SOLaddress <address>
// Strips any literal keyword prefixes users might copy from the example.
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SKIP = ['soladdress','sol','address','wallet','addr'];

module.exports = {
  name:'setwallet', permissions:'viewer', cooldown:false,
  async execute(ctx) {
    const { userId, user, args, say, PupCore } = ctx;

    const cleaned = args.filter(a => !SKIP.includes(a.toLowerCase()));
    const addr = cleaned.find(a => SOL_ADDR.test(a)) || '';

    if (!addr) {
      say(`❌ @${user} invalid Solana address — usage: !setwallet YourAddressHere`);
      return { ok:false };
    }

    const r = await PupCore.equip(userId, { wallet:addr });
    if (!r?.ok) { say(`❌ @${user} ${r?.error||'failed'}`); return { ok:false }; }
    // Include userId in response so mismatches are immediately visible
    say(`✅ @${user} (${userId}) wallet linked: ${addr.slice(0,6)}...${addr.slice(-4)}`);
    return { ok:true };
  },
};
