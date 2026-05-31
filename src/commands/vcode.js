'use strict';
// !vcode <code> — sends the verification code to the tipbot via Teller.

const Teller = require('../services/Teller');

module.exports = {
  name: 'vcode',
  permissions: 'viewer',
  cooldown: false,

  async execute(ctx) {
    const { userId, twitchId, user, args, say } = ctx;

    const code = (args[0] || '').trim();
    if (!code) {
      say(`❌ @${user} usage: !vcode <code>  (get your code from /twitch_verify in Discord)`);
      return { ok: false };
    }

    let resp;
    try {
      resp = await Teller.sendVcode({
        code,
        user,
        user_id: twitchId || userId,
      });
    } catch (e) {
      say(`❌ @${user} verification failed — ${e.message}`);
      return { ok: false };
    }

    if (resp.status !== 200 && resp.body?.ok !== true && resp.body?.success !== true) {
      const err = resp.body?.error || resp.body?.message || `HTTP ${resp.status}`;
      say(`❌ @${user} ${err}`);
      return { ok: false };
    }

    say(`✅ @${user} Twitch linked! You can now use !cashout 🎉`);
    return { ok: true };
  },
};
