'use strict';
module.exports = {
  name:'vcode', permissions:'viewer', cooldown:false,
  async execute(ctx) {
    const { userId, user, args, say, Teller } = ctx;
    if (!Teller.configured()) { say(`❌ Teller not configured`); return { ok:false }; }
    const code = args[0]||'';
    if (!code) { say(`❌ @${user} usage: !vcode <code>  (run /twitch_verify in Discord first)`); return { ok:false }; }
    const r = await Teller.vcode(userId, user, code);
    if (!r?.ok) { say(`❌ @${user} ${r?.error||'invalid code — try /twitch_verify again'}`); return { ok:false }; }
    say(`✅ @${user} Twitch linked to Discord! You can now use !cashout 🎉`);
    return { ok:true };
  },
};
