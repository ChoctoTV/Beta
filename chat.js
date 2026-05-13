#!/usr/bin/env node
'use strict';
// chat.js — Streamer command terminal
// Run: node chat.js   OR   ./start.sh chat
// Type any command exactly as you would in Twitch chat.
// You send as the streamer (your channel name).
// The game receives it identically to a real Twitch chat message.

require('dotenv').config();

const http     = require('http');
const readline = require('readline');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const crypto   = require('crypto');

// ── Decrypt env so we can read TWITCH_CHANNEL and API_PORT ───────────────────
(function decryptEnv() {
  const PREFIX = 'enc:';
  const SALT   = 'ChoctoTV-v2';
  const secretFile = path.join(__dirname, 'SECRET.txt');
  if (!fs.existsSync(secretFile)) return;
  const S = {};
  for (const line of fs.readFileSync(secretFile, 'utf8').split('\n')) {
    const clean = line.split('#')[0].trim();
    const eq = clean.indexOf('=');
    if (eq < 0) continue;
    const k = clean.slice(0, eq).trim().toUpperCase();
    const v = clean.slice(eq + 1).trim();
    if (k && v && !k.startsWith('\u2550')) S[k] = v;
  }
  const streamKey = S['STREAM_KEY'] || '';
  const clientId  = S['CLIENT_ID']  || '';
  if (!streamKey || !clientId) return;

  function deriveKey(sk_, ci_) {
    const sk = Buffer.from(sk_, 'utf8'), ci = Buffer.from(ci_, 'utf8');
    const maxLen = Math.max(sk.length, ci.length) * 2 + 16;
    const mixed  = Buffer.alloc(maxLen, 0);
    let si = 0, cii = 0, mi = 0;
    while (si < sk.length || cii < ci.length) {
      if (si  < sk.length) { mixed[mi%maxLen]^=sk[si];  const s=cii<ci.length?(ci[cii%ci.length]%3)+1:1; mi+=s; si++;  }
      if (cii < ci.length) { mixed[mi%maxLen]^=ci[cii]; const s=si <sk.length?(sk[si %sk.length]%3)+1:1; mi+=s; cii++; }
    }
    const rev = Buffer.from(ci_.split('').reverse().join(''), 'utf8');
    for (let i = 0; i < maxLen; i++) { mixed[i]^=rev[i%rev.length]; mixed[i]^=sk[(i*7+3)%sk.length]; }
    const half = Math.floor(maxLen/2), seed = Buffer.alloc(half);
    for (let i = 0; i < half; i++) seed[i] = mixed[i]^mixed[i+half]^(i&0xff);
    return crypto.pbkdf2Sync(seed, SALT, 100000, 32, 'sha256');
  }

  const key = deriveKey(streamKey, clientId);
  for (const [k, v] of Object.entries(process.env)) {
    if (!v || !v.startsWith(PREFIX)) continue;
    try {
      const buf = Buffer.from(v.slice(PREFIX.length), 'base64');
      const d   = crypto.createDecipheriv('aes-256-gcm', key, buf.slice(0,12));
      d.setAuthTag(buf.slice(12,28));
      process.env[k] = Buffer.concat([d.update(buf.slice(28)), d.final()]).toString('utf8');
    } catch {}
  }
})();

const PORT     = parseInt(process.env.API_PORT || '3000');
const STREAMER = (process.env.TWITCH_CHANNEL  || 'streamer').toLowerCase();

const C = {
  gr:'\x1b[32m', rd:'\x1b[31m', yl:'\x1b[33m',
  cy:'\x1b[36m', wt:'\x1b[1;37m', dm:'\x1b[2m', nc:'\x1b[0m'
};

// ── Check if app is running ───────────────────────────────────────────────────
function checkApp(cb) {
  const req = http.request({ hostname:'127.0.0.1', port:PORT, path:'/health', method:'GET' }, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => { try { cb(null, JSON.parse(d)); } catch { cb(null, {}); } });
  });
  req.on('error', e => cb(e));
  req.end();
}

// ── Send command ──────────────────────────────────────────────────────────────
function sendCommand(command, args, cb) {
  const body = JSON.stringify({ command, user:STREAMER, args });
  const req  = http.request({
    hostname: '127.0.0.1', port: PORT,
    path: '/command', method: 'POST',
    headers: { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
  }, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => { try { cb(null, JSON.parse(d)); } catch { cb(null, { raw:d }); } });
  });
  req.on('error', e => cb(e));
  req.write(body); req.end();
}

// ── Help text ─────────────────────────────────────────────────────────────────
function showHelp() {
  console.log(`
${C.wt}  Available commands:${C.nc}

  ${C.cy}Games${C.nc}
    toss / throw / dig / walk / fish   play a game as @${STREAMER}
    battle                             enter Puppy Wars

  ${C.cy}Economy${C.nc}
    balance                            check balance
    inventory                          check items
    vendsticks <n>  vendballs <n>  vendmoons <n>
    forgeballs  forgemoons
    cashout

  ${C.cy}Roles & Crew${C.nc}
    mod @user   unmod @user   dev @user   undev @user
    confirm     confirm @user
    onduty      offduty       roles
    airdrop <amount>

  ${C.cy}Game Controls${C.nc}
    weather      autopilot     config list
    config <key> <value>       config <key>

  ${C.cy}Music${C.nc}
    song         skip          volume <0-100>
    music on     music off     music list

  ${C.cy}Lottery${C.nc}
    lottoupdate 1342           ticket

  ${C.cy}Other${C.nc}
    lick         gbm Good/Ball/Moon
    addcoin <SYM> <id>         removecoin <SYM>
    hotfix       save

  ${C.dm}Type any command with or without !  |  .help = commands  |  .exit = close  |  .quit = kill stream${C.nc}
`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\n${C.wt}━━━  ChoctoTV Chat Terminal  ━━━${C.nc}`);
console.log(`  Sending as ${C.cy}@${STREAMER}${C.nc} → app on port ${PORT}`);
console.log(`  ${C.dm}.help = commands  |  .exit = close chat  |  .quit = kill stream${C.nc}\n`);

checkApp((err, health) => {
  if (err) {
    console.log(`${C.rd}  ✗ Cannot reach app on port ${PORT}${C.nc}`);
    console.log(`  ${C.dm}Make sure the stream is running: ./start.sh${C.nc}\n`);
    process.exit(1);
  }
  console.log(`${C.gr}  ✓ App connected${C.nc}  ${C.dm}uptime=${health.uptime}s  ws=${health.ws}  active=${health.active}${C.nc}\n`);

  const rl = readline.createInterface({
    input:    process.stdin,
    output:   process.stdout,
    prompt:   `${C.cy}@${STREAMER}>${C.nc} `,
    terminal: true,
  });

  rl.prompt();

  rl.on('line', line => {
    const clean = line.trim().replace(/^!/, '');
    if (!clean) { rl.prompt(); return; }

    if (clean.toLowerCase() === 'help' || clean === '.help') { showHelp(); rl.prompt(); return; }
    if (clean === '.exit') { rl.close(); return; }
    if (clean === '.quit') {
      console.log(`\n${C.yl}  Running killswitch...${C.nc}`);
      rl.close();
      const { execSync } = require('child_process');
      try { execSync(`bash "${__dirname}/killswitch.sh"`, { stdio:'inherit' }); } catch {}
      return;
    }

    const parts   = clean.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args    = parts.slice(1);

    sendCommand(command, args, (err, result) => {
      if (err) {
        console.log(`${C.rd}  ✗ ${err.message}${C.nc}`);
        rl.prompt(); return;
      }
      if (result.ok === false) {
        console.log(`${C.yl}  ✗ ${JSON.stringify(result)}${C.nc}`);
      } else {
        console.log(`${C.gr}  ✓ ${JSON.stringify(result)}${C.nc}`);
      }
      rl.prompt();
    });
  });

  rl.on('close', () => {
    console.log(`\n  ${C.dm}Chat terminal closed${C.nc}\n`);
    process.exit(0);
  });
});
