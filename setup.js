#!/usr/bin/env node
// setup.js — copies SECRET.txt values into .env (plain text, no encryption)
'use strict';

const fs   = require('fs');
const path = require('path');
const rl   = require('readline').createInterface({ input: process.stdin, output: process.stdout });
const ask  = q => new Promise(r => rl.question(q, r));

const ENV_FILE    = path.join(__dirname, '.env');
const SECRET_FILE_LIVE = path.join(__dirname, 'Secret(live).txt');
const SECRET_FILE_BETA = path.join(__dirname, 'Secret(beta).txt');
const SECRET_FILE = fs.existsSync(SECRET_FILE_LIVE) ? SECRET_FILE_LIVE
                  : fs.existsSync(SECRET_FILE_BETA)  ? SECRET_FILE_BETA
                  : SECRET_FILE_LIVE; // default to live when creating new

function parseSecrets(text) {
  const sections = {};
  const flat     = {};
  let cur = 'GENERAL';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();

    // Section header: # ── HELIUS ──── or ## HELIUS or # HELIUS
    const secMatch = line.match(/^#+\s*[-─═]{0,6}\s*([A-Za-z][A-Za-z0-9 _\-]{1,30}?)\s*[-─═]*\s*$/);
    if (secMatch) {
      cur = secMatch[1].trim().toUpperCase();
      if (!sections[cur]) sections[cur] = {};
      continue;
    }

    if (line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const k = line.slice(0, eq).trim();
    let   v = line.slice(eq + 1).trim();
    // Strip inline trailing comment (2+ spaces before #)
    const ic = v.match(/^(.*?)\s{2,}#.*/);
    if (ic) v = ic[1].trim();
    if (!k || !v) continue;

    if (!sections[cur]) sections[cur] = {};
    sections[cur][k] = v;
    flat[k] = v;
  }

  flat._sections = sections;
  return flat;
}

function writeEnv(obj) {
  const lines = Object.entries(obj).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n');
}

async function main() {
  console.log('\nChoctoTV Setup\n');

  // Load existing .env if present
  let env = {};
  if (fs.existsSync(ENV_FILE)) {
    env = parseSecrets(fs.readFileSync(ENV_FILE, 'utf8'));
  }

  // Load SECRET.txt if present — it overrides .env
  if (fs.existsSync(SECRET_FILE)) {
    const secrets = parseSecrets(fs.readFileSync(SECRET_FILE, 'utf8'));
    Object.assign(env, secrets);
    console.log('✓ Loaded', Object.keys(secrets).length, 'values from SECRET.txt');
  } else {
    console.log('No SECRET.txt found — prompting for required values\n');

    const required = [
      ['TWITCH_CHANNEL',        'Twitch channel name'],
      ['TWITCH_BOT_USERNAME',   'Bot username'],
      ['TWITCH_OAUTH_TOKEN',    'OAuth token (oauth:xxxx)'],
      ['TWITCH_CLIENT_ID',      'Client ID'],
      ['STREAM_KEY',            'Twitch stream key'],
      ['HELIUS_API_KEY',        'Helius API key (free at helius.dev)'],
    ];

    for (const [key, label] of required) {
      if (!env[key]) {
        const val = await ask(`${label}: `);
        if (val.trim()) env[key] = val.trim();
      } else {
        console.log(`  ${key} already set`);
      }
    }
  }

  // Set defaults for non-secret config
  if (!env.STREAM_RESOLUTION) env.STREAM_RESOLUTION = '1280x720';
  if (!env.STREAM_BITRATE)    env.STREAM_BITRATE    = '4500k';
  if (!env.PUPCORE_PORT)      env.PUPCORE_PORT      = '3002';

  writeEnv(env);
  console.log('\n✓ Secret(live).txt written with', Object.keys(env).length, 'values');
  console.log('  On next startup it will rewrite .env and move itself to vault/\n');
  console.log('  You can now run: ./start.sh\n');
  rl.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
