'use strict';
// scripts/genWebhookConfigs.js — run by start.sh after vault/.env is written.
// Generates vault/tipbot-webhook.json from TIPBOT_WEBHOOK_* and DISCORD_GUILD_ID.

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'vault', '.env') });

const config = {
  url:        process.env.TIPBOT_WEBHOOK_URL        || '',
  auth_type:  process.env.TIPBOT_WEBHOOK_AUTH_TYPE   || '',
  auth_token: process.env.TIPBOT_WEBHOOK_AUTH_TOKEN  || '',
  auth_user:  process.env.TIPBOT_WEBHOOK_AUTH_USER   || '',
  auth_pass:  process.env.TIPBOT_WEBHOOK_AUTH_PASS   || '',
  guild_id:   process.env.DISCORD_GUILD_ID           || '',
  payload_formats: {
    cashout: { user:'{user}', user_id:'{user_id}', amount:'{amount}', guild_id:'{guild_id}' },
    vcode:   { verify: { code:'{code}', user:'{user}', user_id:'{user_id}', guild_id:'{guild_id}' } },
  },
};

const out = path.join(__dirname, '..', '..', 'vault', 'tipbot-webhook.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(config, null, 2));
console.log('[start.sh] vault/tipbot-webhook.json generated');
if (!config.url) console.warn('[start.sh] WARNING: TIPBOT_WEBHOOK_URL is empty — set it in secret.txt');
