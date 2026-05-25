'use strict';
const RATE = 1000;
module.exports = {
  name:'cashout', permissions:'viewer', cooldown:false,
  async execute(ctx) {
    const { userId, user, say, broadcast, Balance, Teller } = ctx;
    const EMO = process.env.CHOCTOPI_EMOTE||'Choctopus';
    if (!Teller.configured()) { say(`❌ @${user} cashouts disabled — no teller.json`); return { ok:false }; }
    const verified = await Teller.isVerified(userId);
    if (!verified) { say(`❌ @${user} — run /twitch_verify in Discord first, then !vcode <code>`); return { ok:false }; }
    const bal  = Balance.get(userId);
    const choc = Math.floor(bal/RATE);
    if (choc<1) { say(`❌ @${user} need ${RATE.toLocaleString()}🍫 minimum. You have ${bal.toLocaleString()}🍫`); return { ok:false }; }
    const spent = choc*RATE, rem = Math.round((bal-spent)*100)/100;
    const health = await Teller.getHealth();
    const pos    = (health?.queueDepth||0)+1;
    say(pos===1 ? `⏳ @${user} processing cashout...` : `⏳ @${user} #${pos} in cashout queue!`);
    const result = await Teller.cashout(userId, user, choc, spent, rem);
    if (!result?.ok) {
      say(`❌ @${user} cashout failed — ${result?.error||'try again'}`);
      return { ok:false };
    }
    Balance.subtract(userId, spent);
    say(`✅ @${user} ${choc} ${EMO} sent! 💸 ${spent.toLocaleString()}🍫 → ${rem.toLocaleString()}🍫 remains`);
    broadcast({ type:'cashout_confirm', user, choctopus:choc, remainder:rem });
    return { ok:true };
  },
};
