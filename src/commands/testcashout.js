'use strict';
// !testcashout — dry-run cashout that writes the payload to test.txt.
// Does NOT call the tipbot or deduct balance. Used to verify the payload format.

const fs   = require('fs');
const path = require('path');
const RATE = 1000;
const TEST_FILE = path.join(process.cwd(), 'test.txt');

module.exports = {
  name: 'testcashout',
  requirePrefix: true,
  permissions: 'mod',
  cooldown: false,

  execute(ctx) {
    const { userId, twitchId, user, say, Balance } = ctx;
    const bal   = Balance.get(userId);
    const choc  = Math.floor(bal / RATE);

    const payload = {
      user,
      user_id:  twitchId || userId,
      amount:   choc,
      guild_id: process.env.DISCORD_GUILD_ID || '',
    };

    const entry = [
      `--- !testcashout @ ${new Date().toISOString()} ---`,
      `User:     ${user} (login: ${userId}, twitch_id: ${twitchId || 'unknown'})`,
      `Balance:  ${bal} Choctobits → ${choc} Choctopus`,
      `Target:   ${process.env.CASHOUT_WEBHOOK_URL || '(CASHOUT_WEBHOOK_URL not set)'}`,
      `Payload:  ${JSON.stringify(payload, null, 2)}`,
      '',
    ].join('\n');

    try {
      fs.appendFileSync(TEST_FILE, entry, 'utf8');
      say(`✅ @${user} test cashout logged to test.txt — ${choc} Choctopus payload (no webhook fired, no balance deducted)`);
    } catch (e) {
      say(`❌ @${user} could not write test.txt — ${e.message}`);
      return { ok: false };
    }
    return { ok: true, payload };
  },
};
