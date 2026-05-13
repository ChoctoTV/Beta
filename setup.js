#!/usr/bin/env node
'use strict';
// setup.js — ChoctoTV first-run wizard
// Run: node setup.js
// Asks for credentials, opens Twitch in Brave to get OAuth token,
// encrypts sensitive values with your master key, writes .env

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const http   = require('http');
const rl     = require('readline');

const ENV_FILE  = path.join(__dirname, '.env');
const C = {
  gr:'\x1b[32m', rd:'\x1b[31m', yl:'\x1b[33m',
  cy:'\x1b[36m', wt:'\x1b[1;37m', dm:'\x1b[2m', nc:'\x1b[0m'
};
const ok   = s => console.log(`${C.gr}  ✓${C.nc} ${s}`);
const warn = s => console.log(`${C.yl}  ⚠${C.nc} ${s}`);
const info = s => console.log(`${C.cy}  →${C.nc} ${s}`);
const hdr  = s => console.log(`\n${C.wt}${s}${C.nc}`);
const fail = (s) => { console.error(`${C.rd}  ✗${C.nc} ${s}`); process.exit(1); };

// ── Encryption ────────────────────────────────────────────────────────────────
const SALT   = 'ChoctoTV-v2';
const PREFIX = 'enc:';

function deriveKey(streamKey, clientId) {
  const sk = Buffer.from(streamKey, 'utf8');
  const ci = Buffer.from(clientId, 'utf8');
  const maxLen = Math.max(sk.length, ci.length) * 2 + 16;
  const mixed  = Buffer.alloc(maxLen, 0);
  let si = 0, cii = 0, mi = 0;
  while (si < sk.length || cii < ci.length) {
    if (si < sk.length) {
      mixed[mi % maxLen] ^= sk[si];
      const step = cii < ci.length ? (ci[cii % ci.length] % 3) + 1 : 1;
      mi += step; si++;
    }
    if (cii < ci.length) {
      mixed[mi % maxLen] ^= ci[cii];
      const step = si < sk.length ? (sk[si % sk.length] % 3) + 1 : 1;
      mi += step; cii++;
    }
  }
  const rev = Buffer.from(clientId.split('').reverse().join(''), 'utf8');
  for (let i = 0; i < maxLen; i++) {
    mixed[i] ^= rev[i % rev.length];
    mixed[i] ^= sk[(i * 7 + 3) % sk.length];
  }
  const half = Math.floor(maxLen / 2);
  const seed = Buffer.alloc(half);
  for (let i = 0; i < half; i++) seed[i] = mixed[i] ^ mixed[i + half] ^ (i & 0xff);
  return crypto.pbkdf2Sync(seed, SALT, 100000, 32, 'sha256');
}

function encryptValue(plain, streamKey, clientId) {
  const key    = deriveKey(streamKey, clientId);
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc    = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}


// ── Readline helper ───────────────────────────────────────────────────────────
function ask(iface, question, { secret = false, optional = false } = {}) {
  return new Promise(resolve => {
    if (secret) {
      process.stdout.write(`${C.cy}  ${question}${C.nc} `);
      let val = '';
      const term = process.stdin.isTTY;
      if (term) process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      const onData = ch => {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          if (term) process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onData);
          console.log('');
          resolve(val.trim());
        } else if (ch === '\u0003') {
          process.exit(0);
        } else if (ch === '\u007f') {
          val = val.slice(0, -1);
        } else {
          val += ch;
          process.stdout.write('*');
        }
      };
      process.stdin.on('data', onData);
    } else {
      iface.question(`${C.cy}  ${question}${optional ? C.dm + ' (optional, Enter to skip)' + C.nc : ''}${C.nc} `, a => resolve(a.trim()));
    }
  });
}

// ── Browser OAuth flow ────────────────────────────────────────────────────────
async function getOAuthToken(clientId) {
  const SCOPES   = 'chat:read chat:edit';
  const PORTS    = [3456, 6969, 7777];
  let   PORT     = null;
  let   server   = null;

  const PAGE = `<!DOCTYPE html><html><body style="font-family:monospace;padding:30px;background:#0e0e10;color:#efeff1">
<h2 style="color:#9147ff">ChoctoTV</h2><p id="s">Capturing token...</p>
<script>
const t=new URLSearchParams(location.hash.slice(1)).get('access_token');
if(t){fetch('/save',{method:'POST',body:t}).then(()=>{document.getElementById('s').innerHTML='<span style="color:#00ff7f;font-size:1.3em">✓ Authorized! Close this tab.</span>';});}
else{document.getElementById('s').innerHTML='<span style="color:red">No token found — try again.</span>';}
</script></body></html>`;

  const token = await new Promise((resolve, reject) => {
    const tryPort = (i) => {
      if (i >= PORTS.length) { reject(new Error('All ports busy. Free up 3456, 6969, or 7777 and retry.')); return; }
      PORT   = PORTS[i];
      server = http.createServer((req, res) => {
        if (req.method === 'GET')  { res.writeHead(200, {'Content-Type':'text/html'}); res.end(PAGE); return; }
        if (req.method === 'POST' && req.url === '/save') {
          let b = '';
          req.on('data', d => b += d);
          req.on('end', () => { res.writeHead(200); res.end('ok'); server.close(); resolve(b.trim()); });
          return;
        }
        res.writeHead(404); res.end();
      });
      server.on('error', e => { if (e.code === 'EADDRINUSE') tryPort(i + 1); else reject(e); });
      server.listen(PORT, () => {
        const REDIRECT = `http://localhost:${PORT}`;
        const URL      = `https://id.twitch.tv/oauth2/authorize?response_type=token&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent(SCOPES)}`;
        info(`Local server ready on port ${PORT}`);
        const { spawn, execSync } = require('child_process');
        const browsers = ['xdg-open','brave-browser','brave','/usr/bin/brave-browser','firefox','chromium-browser','chromium','google-chrome','google-chrome-stable'];
        let opened = false;
        for (const b of browsers) {
          try {
            execSync(`which ${b} 2>/dev/null || test -x "${b}"`, { stdio:'ignore' });
            spawn(b, [URL], { detached:true, stdio:'ignore', env:{...process.env, DISPLAY:process.env.DISPLAY||':0'} }).unref();
            ok(`Opened in ${b}`); opened = true; break;
          } catch {}
        }
        if (!opened) { warn('Could not open browser. Copy this URL into Brave:'); console.log(`\n  ${C.cy}${URL}${C.nc}\n`); }
        info('Waiting for authorization...');
      });
    };
    tryPort(0);
  });

  return `oauth:${token}`;
}

// ── Validate token ────────────────────────────────────────────────────────────
async function validateToken(token) {
  try {
    const r = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': `OAuth ${token.replace(/^oauth:/i, '')}` }
    });
    if (r.ok) { const j = await r.json(); return { ok:true, login:j.login, expires:j.expires_in }; }
    return { ok:false, status:r.status };
  } catch(e) { return { ok:false, error:e.message }; }
}

// ── .env helpers ──────────────────────────────────────────────────────────────
function readEnv()          { return fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : ''; }
function setEnvKey(s, k, v) {
  return new RegExp(`^${k}=`, 'm').test(s) ? s.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : s + `\n${k}=${v}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  hdr('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  hdr('  ChoctoTV Setup');
  hdr('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const iface = rl.createInterface({ input: process.stdin, output: process.stdout });

  // ── Read SECRET.txt (pre-filled values skip the prompt) ──────────────────
  const secretFile = path.join(__dirname, 'SECRET.txt');
  const S = {};
  if (fs.existsSync(secretFile)) {
    for (const line of fs.readFileSync(secretFile, 'utf8').split('\n')) {
      const clean = line.split('#')[0].trim();
      const eq    = clean.indexOf('=');
      if (eq < 0) continue;
      const k = clean.slice(0, eq).trim().toUpperCase();
      const v = clean.slice(eq + 1).trim();
      if (k && v && !k.startsWith('═')) S[k] = v;
    }
    hdr('  Reading SECRET.txt...');
    const found = Object.keys(S).filter(k => S[k]);
    if (found.length) info(`Pre-filled: ${found.join(', ')}`);
  } else {
    hdr('  SECRET.txt not found — prompting for all values');
    info('Tip: fill in SECRET.txt to skip prompts on future runs');
  }

  // ── Helper: use pre-filled value or ask ───────────────────────────────────
  const getOrAsk = async (key, question, opts = {}) => {
    if (S[key]) {
      const display = opts.secret ? '****' : S[key];
      ok(`${question.replace(':','').trim()}: ${display} ${C.dm}(from SECRET.txt)${C.nc}`);
      return S[key];
    }
    return ask(iface, question, opts);
  };

  // ── Required: Twitch ──────────────────────────────────────────────────────
  hdr('  Twitch (Required)');
  let channel = (await getOrAsk('CHANNEL', 'Your Twitch channel name:')).toLowerCase();
  if (!channel) fail('Channel name is required');

  let bot = (await getOrAsk('BOT', `Bot username (Enter = same as channel):`, { optional:true })).toLowerCase() || channel;

  let clientId = await getOrAsk('CLIENT_ID', 'Twitch Client ID (dev.twitch.tv/console/apps — Public app):');
  if (!clientId) fail('Client ID is required. Create a Public app at dev.twitch.tv/console/apps');

  let streamKey = await getOrAsk('STREAM_KEY', 'Twitch Stream Key (dashboard.twitch.tv):', { secret:true });
  if (!streamKey) fail('Stream key is required');

  let token = S['OAUTH_TOKEN'] || '';

  // ── Optional: GitHub ──────────────────────────────────────────────────────
  hdr('  GitHub (Optional — skip with Enter)');
  let ghRepo   = await getOrAsk('GITHUB_REPO',   'GitHub SSH repo URL (e.g. git@github.com:You/repo.git):', { optional:true });
  let ghBranch = ghRepo ? await getOrAsk('GITHUB_BRANCH', 'Branch (Enter = main):', { optional:true }) || 'main' : '';

  // ── Optional: Oracle Cloud ────────────────────────────────────────────────
  hdr('  Oracle Cloud (Optional — skip with Enter)');
  let cloudIp   = await getOrAsk('CLOUD_IP',      'Oracle Cloud VM public IP:', { optional:true });
  let cloudUser = cloudIp ? await getOrAsk('CLOUD_USER',    'SSH user (Enter = opc):',                         { optional:true }) || 'opc'                   : 'opc';
  let cloudKey  = cloudIp ? await getOrAsk('CLOUD_SSH_KEY', 'SSH key path (Enter = ~/.ssh/choctotv-oracle.key):', { optional:true }) || '~/.ssh/choctotv-oracle.key' : '';
  let cloudPath = cloudIp ? await getOrAsk('CLOUD_PATH',    'App path on cloud (Enter = /home/opc/choctotv):',   { optional:true }) || '/home/opc/choctotv'    : '/home/opc/choctotv';

  // ── Optional: Stream settings ─────────────────────────────────────────────
  const streamRes  = S['STREAM_RESOLUTION'] || '1280x720';
  const streamFps  = S['STREAM_FPS']        || '60';
  const streamBr   = S['STREAM_BITRATE']    || '4500k';
  const overlay1   = S['OVERLAY_1'] || '';
  const overlay2   = S['OVERLAY_2'] || '';
  const overlay3   = S['OVERLAY_3'] || '';

  info('Getting OAuth token from Twitch...');
  iface.pause();
  try {
    token = await getOAuthToken(clientId);
  } catch(e) { fail(e.message); }
  iface.resume();

  info('Validating token...');
  const valid = await validateToken(token);
  if (!valid.ok) fail(`Token invalid (${valid.status || valid.error}). Try running setup again.`);
  ok(`Token valid — logged in as: ${C.wt}${valid.login}${C.nc}`);

  iface.close();

  hdr('  Writing encrypted .env...');
  let env = readEnv();

  // Write all answers back to SECRET.txt so future runs can skip prompts
  const secretOut = path.join(__dirname, 'SECRET.txt');
  const lines = [
    '════════════════════════════════════════════════════════════════',
    '  ChoctoTV — SECRET',
    '  Fill in any field and run: node setup.js',
    '  Filled fields skip their prompt. Empty fields are asked.',
    '  This file stays on YOUR machine — never committed to GitHub.',
    '  Without it the .env cannot be decrypted.',
    '════════════════════════════════════════════════════════════════',
    '',
    '',
    '# ── TWITCH ────────────────────────────────────────────────────',
    '# Your channel name (lowercase)',
    `CHANNEL=${channel}`,
    '',
    '# Your bot account name (can be same as channel)',
    `BOT=${bot}`,
    '',
    '# Twitch stream key — dashboard.twitch.tv/u/YOUR-CHANNEL/settings/stream',
    `STREAM_KEY=${streamKey}`,
    '',
    '# Twitch Client ID — create a PUBLIC app at dev.twitch.tv/console/apps',
    '#   OAuth Redirect URLs: http://localhost:3456  AND  http://localhost:6969',
    '#   Category: Chat Bot  |  Client Type: Public',
    `CLIENT_ID=${clientId}`,
    '',
    '# OAuth token — setup.js fills this in automatically via Twitch login',
    `OAUTH_TOKEN=${token}`,
    '',
    '',
    '# ── GITHUB ────────────────────────────────────────────────────',
    '# SSH remote URL — format: git@github.com:YOU/REPO.git',
    `GITHUB_REPO=${ghRepo}`,
    '',
    '# Branch to use (usually main)',
    `GITHUB_BRANCH=${ghBranch || 'main'}`,
    '',
    '',
    '# ── ORACLE CLOUD ──────────────────────────────────────────────',
    '# Public IP of your Oracle Cloud VM (Oracle Console → Compute → Instances)',
    `CLOUD_IP=${cloudIp}`,
    '',
    '# SSH user (Oracle Linux default is always opc)',
    `CLOUD_USER=${cloudUser}`,
    '',
    '# Path to your SSH private key (downloaded when creating the Oracle instance)',
    `CLOUD_SSH_KEY=${cloudKey}`,
    '',
    '# App folder path on the cloud VM',
    `CLOUD_PATH=${cloudPath}`,
    '',
    '',
    '# ── STREAM SETTINGS ───────────────────────────────────────────',
    '# Stream resolution (must match your Twitch stream settings)',
    `STREAM_RESOLUTION=${streamRes}`,
    '',
    '# Frames per second',
    `STREAM_FPS=${streamFps}`,
    '',
    '# Video bitrate (Twitch recommends 4500k-6000k for 1080p30)',
    `STREAM_BITRATE=${streamBr}`,
    '',
    '',
    '════════════════════════════════════════════════════════════════',
  ];
  fs.writeFileSync(secretOut, lines.join('\n') + '\n');
  try { fs.chmodSync(secretOut, 0o600); } catch {}
  ok('SECRET.txt updated with all values (chmod 600)');

  // Plain (not sensitive — public anyway)
  env = setEnvKey(env, 'TWITCH_CHANNEL',      channel);
  env = setEnvKey(env, 'TWITCH_BOT_USERNAME',  bot);
  ok(`TWITCH_CHANNEL=${channel} (plain)`);

  // Encrypted using STREAM_KEY + CLIENT_ID as combined password
  env = setEnvKey(env, 'TWITCH_OAUTH_TOKEN',   encryptValue(token,     streamKey, clientId));
  env = setEnvKey(env, 'TWITCH_CLIENT_ID',      encryptValue(clientId,  streamKey, clientId));
  env = setEnvKey(env, 'TWITCH_STREAM_KEY',     encryptValue(streamKey, streamKey, clientId));
  ok('TWITCH_OAUTH_TOKEN  → encrypted');
  ok('TWITCH_CLIENT_ID    → encrypted');
  ok('TWITCH_STREAM_KEY   → encrypted');

  // Optional GitHub
  if (ghRepo)   { env = setEnvKey(env, 'GITHUB_REPO',   encryptValue(ghRepo,   streamKey, clientId)); ok('GITHUB_REPO → encrypted'); }
  if (ghBranch) { env = setEnvKey(env, 'GITHUB_BRANCH', ghBranch); }

  // Optional Cloud
  if (cloudIp)   { env = setEnvKey(env, 'CLOUD_IP',   encryptValue(cloudIp,   streamKey, clientId)); ok('CLOUD_IP → encrypted'); }
  if (cloudKey)  { env = setEnvKey(env, 'CLOUD_KEY',  encryptValue(cloudKey,  streamKey, clientId)); }
  if (cloudUser) { env = setEnvKey(env, 'CLOUD_USER', cloudUser); }
  if (cloudPath) { env = setEnvKey(env, 'CLOUD_PATH', cloudPath); }

  // Defaults
  const D = {
    TWITCH_RTMP_BASE:'rtmp://live.twitch.tv/app',
    API_PORT:'3000', WS_PORT:'3001', OVERLAY_PORT:'8080',
    STREAM_RESOLUTION:streamRes, STREAM_FPS:streamFps,
    STREAM_BITRATE:streamBr, STREAM_AUDIO_BITRATE:'128k',
    DISPLAY_NUM:'99', OVERLAY_URL:'http://localhost:8080',
    XVFB_WAIT:'2000', CHROME_WAIT:'6000',
    COMMAND_COOLDOWN_MS:'8000',
    CHOCTOPUS_CONTRACT:'EVrGfAj99Xr1NjqqZv6E2msVKZVmhGaThHhcZXzrpump',
  };
  for (const [k, v] of Object.entries(D)) {
    if (!new RegExp(`^${k}=`, 'm').test(env)) env = setEnvKey(env, k, v);
  }

  // Write overlays as plain (URLs are not sensitive)
  if (overlay1)  env = setEnvKey(env, 'OVERLAY_1', overlay1);
  if (overlay2)  env = setEnvKey(env, 'OVERLAY_2', overlay2);
  if (overlay3)  env = setEnvKey(env, 'OVERLAY_3', overlay3);

  // Write non-sensitive cloud/github settings as plain
  if (ghRepo)    env = setEnvKey(env, 'GITHUB_REPO',   ghRepo);
  if (ghBranch)  env = setEnvKey(env, 'GITHUB_BRANCH', ghBranch);
  if (cloudUser) env = setEnvKey(env, 'CLOUD_USER',    cloudUser);
  if (cloudPath) env = setEnvKey(env, 'CLOUD_PATH',    cloudPath);

  fs.writeFileSync(ENV_FILE, env.trim() + '\n');
  try { fs.chmodSync(ENV_FILE, 0o600); } catch {}

  // Save derived key to ~/.choctotv.key so the app never needs SECRET.txt at runtime
  const keyFile    = require('path').join(require('os').homedir(), '.choctotv.key');
  const derivedKey = deriveKey(streamKey, clientId);
  fs.writeFileSync(keyFile, derivedKey.toString('hex'), { mode: 0o600 });
  ok(`Derived key saved to ${keyFile} (chmod 600)`);
  warn('SECRET.txt can now be stored safely off this machine');
  warn('The app will decrypt .env using ~/.choctotv.key without needing SECRET.txt');

  hdr(`${C.gr}━━━  Setup Complete!  ━━━${C.nc}`);
  console.log(`\n  Run: ${C.cy}./start.sh${C.nc}\n`);
}

main().catch(e => { console.error('\n  Setup failed:', e.message); process.exit(1); });
