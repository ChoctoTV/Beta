/**
 * OAuthManager — Twitch Device Code OAuth flow with automatic token refresh.
 *
 * On startup:
 *  1. Loads stored tokens from vault/data/oauth.json
 *  2. Validates the access_token via /oauth2/validate
 *  3. If expired → tries refresh_token
 *  4. If no token / refresh fails → initiates Device Code flow (one-time user action)
 *     Prints a short URL + code to the terminal, polls until user approves.
 *  5. Saves new tokens to vault/data/oauth.json
 *  6. Sets process.env.TWITCH_OAUTH_TOKEN for the rest of the app
 *
 * Client ID still lives in Secret file. The token file is auto-managed.
 */
'use strict';
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const VAULT = path.join(process.cwd(), 'vault', 'data', 'oauth.json');

// All scopes ChoctoTV needs — add here when new features require more
const SCOPES = [
  'chat:read',
  'chat:edit',
  'channel:read:redemptions',
  'channel:manage:redemptions',
  'channel:read:subscriptions',
  'channel:read:vips',
  'channel:read:ads',
  'moderation:read',
  'moderator:read:chatters',
  'moderator:read:followers',
  'moderator:manage:announcements',
].join(' ');

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function post(hostname, path, params) {
  const body = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
                            catch { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function get(hostname, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
                            catch { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Token storage ─────────────────────────────────────────────────────────────
function loadStored() {
  try { return JSON.parse(fs.readFileSync(VAULT, 'utf8')); }
  catch { return null; }
}

function saveTokens(data) {
  fs.mkdirSync(path.dirname(VAULT), { recursive: true });
  fs.writeFileSync(VAULT, JSON.stringify({
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    scope:         data.scope,
    saved_at:      new Date().toISOString(),
  }, null, 2));
}

// ── Validate access_token ─────────────────────────────────────────────────────
async function validate(token) {
  const r = await get('id.twitch.tv', '/oauth2/validate',
    { Authorization: `OAuth ${token}` }).catch(() => null);
  if (!r || r.status !== 200) return null;
  return r.body; // { client_id, login, scopes, user_id, expires_in }
}

// ── Check if stored scopes cover what we need ─────────────────────────────────
function scopesSufficient(grantedScopes) {
  if (!Array.isArray(grantedScopes)) return false;
  const needed = SCOPES.split(' ');
  return needed.every(s => grantedScopes.includes(s));
}

// ── Refresh token ─────────────────────────────────────────────────────────────
async function refresh(clientId, refreshToken) {
  const r = await post('id.twitch.tv', '/oauth2/token', {
    client_id:     clientId,
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
  }).catch(() => null);
  if (!r || r.status !== 200 || !r.body.access_token) return null;
  return r.body;
}

// ── Device Code flow ──────────────────────────────────────────────────────────
async function deviceCodeFlow(clientId) {
  const init = await post('id.twitch.tv', '/oauth2/device', {
    client_id: clientId,
    scopes:    SCOPES,
  });

  if (init.status !== 200) {
    throw new Error(`Device code request failed: ${init.status} ${JSON.stringify(init.body)}`);
  }

  const { device_code, user_code, verification_uri, expires_in, interval = 5 } = init.body;

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          TWITCH AUTHORIZATION REQUIRED                   ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  1. Go to:  ${verification_uri.padEnd(46)}║`);
  console.log(`║  2. Enter:  ${user_code.padEnd(46)}║`);
  console.log('║  3. Log in as your BROADCASTER account and approve.      ║');
  console.log(`║  (expires in ${Math.floor(expires_in/60)} minutes)${' '.repeat(39 - Math.floor(expires_in/60).toString().length)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // Poll until user approves or code expires
  const deadline = Date.now() + expires_in * 1000;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (Date.now() > deadline) { reject(new Error('Device code expired')); return; }
      const r = await post('id.twitch.tv', '/oauth2/token', {
        client_id:   clientId,
        device_code,
        grant_type:  'urn:ietf:params:oauth:grant-type:device_code',
      }).catch(() => null);

      if (!r) { setTimeout(poll, interval * 1000); return; }

      if (r.status === 200 && r.body.access_token) {
        console.log('[OAuth] Authorization approved ✓');
        resolve(r.body);
        return;
      }

      const err = r.body?.message || r.body?.error || '';
      if (err.includes('authorization_pending') || err.includes('slow_down')) {
        setTimeout(poll, interval * 1000);
      } else {
        reject(new Error(`Auth failed: ${err}`));
      }
    };
    setTimeout(poll, interval * 1000);
  });
}

// ── Main entry point ──────────────────────────────────────────────────────────
// Synchronously set process.env.TWITCH_OAUTH_TOKEN from the best available source
// so chat can connect immediately without waiting for async validation.
function primeToken() {
  const stored = loadStored();
  const envRaw = (process.env.TWITCH_OAUTH_TOKEN || '').replace(/^oauth:/,'');
  const token  = envRaw || stored?.access_token || '';
  if (token) { process.env.TWITCH_OAUTH_TOKEN = `oauth:${token}`; return token; }
  return null;
}

async function ensureToken(clientId, allowDeviceFlow = false) {
  if (!clientId) {
    // No client ID — fall back to env token directly so chat still works
    const raw = (process.env.TWITCH_OAUTH_TOKEN || '').replace(/^oauth:/,'');
    if (raw) { process.env.TWITCH_OAUTH_TOKEN = `oauth:${raw}`; return raw; }
    throw new Error('TWITCH_CLIENT_ID not set in Secret file');
  }

  // 0. Try TWITCH_OAUTH_TOKEN from Secret file first (before any stored/device flow)
  //    This ensures existing setups keep working without re-authorization.
  const envRaw = (process.env.TWITCH_OAUTH_TOKEN || '').replace(/^oauth:/,'');
  if (envRaw) {
    const envInfo = await validate(envRaw).catch(() => null);
    if (envInfo && envInfo.expires_in > 300) {
      // If scopes are sufficient, use it and save it
      if (scopesSufficient(envInfo.scopes)) {
        saveTokens({ access_token: envRaw, refresh_token: null, scope: envInfo.scopes });
        process.env.TWITCH_OAUTH_TOKEN = `oauth:${envRaw}`;
        console.log(`[OAuth] Using TWITCH_OAUTH_TOKEN from Secret file (${envInfo.login}) ✓`);
        return envRaw;
      }
      // Token works but missing scopes — will upgrade via device flow below
      console.log(`[OAuth] Secret token valid but missing scopes — upgrading authorization`);
    }
  }

  const stored = loadStored();

  // 1. Try stored access_token
  if (stored?.access_token) {
    const info = await validate(stored.access_token);
    if (info && info.expires_in > 300 && scopesSufficient(info.scopes)) {
      console.log(`[OAuth] Token valid (${info.login}, expires in ${Math.round(info.expires_in/60)}min)`);
      process.env.TWITCH_OAUTH_TOKEN = `oauth:${stored.access_token}`;
      return stored.access_token;
    }

    // 2. Try refresh
    if (stored.refresh_token) {
      console.log('[OAuth] Token expired — refreshing...');
      const refreshed = await refresh(clientId, stored.refresh_token);
      if (refreshed) {
        // Check scopes cover what we need now
        const newInfo = await validate(refreshed.access_token);
        if (newInfo && scopesSufficient(newInfo.scopes)) {
          saveTokens(refreshed);
          process.env.TWITCH_OAUTH_TOKEN = `oauth:${refreshed.access_token}`;
          console.log('[OAuth] Token refreshed ✓');
          return refreshed.access_token;
        }
        console.log('[OAuth] Refreshed token missing required scopes — re-authorizing');
      }
    }
  }

  // 3. Device code flow — ONLY when explicitly requested (./start.sh updatescopes)
  //    Never blocks normal startup. On boot we just use whatever token exists.
  if (!allowDeviceFlow) {
    const fallback = (process.env.TWITCH_OAUTH_TOKEN || '').replace(/^oauth:/,'')
                   || stored?.access_token || '';
    if (fallback) {
      process.env.TWITCH_OAUTH_TOKEN = `oauth:${fallback}`;
      console.log('[OAuth] Using existing token. Run "./start.sh updatescopes" if commands fail or to add scopes.');
      return fallback;
    }
    throw new Error('No valid Twitch token — run ./start.sh updatescopes to authorize');
  }

  console.log('[OAuth] Starting device code authorization...');
  const tokenData = await deviceCodeFlow(clientId);
  saveTokens(tokenData);
  process.env.TWITCH_OAUTH_TOKEN = `oauth:${tokenData.access_token}`;
  return tokenData.access_token;
}

// Schedule proactive refresh 10 minutes before expiry
let _refreshTimer = null;
async function scheduleRefresh(clientId) {
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
  const stored = loadStored();
  if (!stored?.access_token) return;
  // No refresh_token (e.g. token came from Secret file) → can't auto-refresh, don't loop
  if (!stored.refresh_token) {
    console.log('[OAuth] No refresh_token — token is managed manually (Secret file). Auto-refresh disabled.');
    return;
  }
  const info = await validate(stored.access_token).catch(() => null);
  if (!info) return;
  // Refresh 10 min before expiry, but NEVER less than 60s from now (prevents tight loop)
  const refreshIn = Math.max(60000, (info.expires_in - 600) * 1000);
  _refreshTimer = setTimeout(async () => {
    console.log('[OAuth] Proactive token refresh...');
    try {
      const s = loadStored();
      if (!s?.refresh_token) return;
      const r = await refresh(clientId, s.refresh_token);
      if (r) { saveTokens(r); process.env.TWITCH_OAUTH_TOKEN = `oauth:${r.access_token}`; console.log('[OAuth] Token refreshed ✓'); }
    } catch (e) { console.warn('[OAuth] Refresh failed:', e.message); }
    scheduleRefresh(clientId);  // reschedule after refresh
  }, refreshIn);
}

module.exports = { ensureToken, scheduleRefresh, primeToken };
