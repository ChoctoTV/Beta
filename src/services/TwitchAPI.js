'use strict';
/**
 * TwitchAPI — Helix API helpers used by ChoctoTV features.
 *
 * Covers:
 *   - Mod list sync  (moderation:read)
 *   - Follow check   (moderator:read:followers)
 *   - Announcements  (moderator:manage:announcements)
 *   - Sub check      (channel:read:subscriptions)
 */
const https = require('https');
const log   = require('../observability/logger');

let _token    = null;
let _clientId = null;
let _broadcasterId = null;  // numeric Twitch ID of the channel owner

function init(token, clientId) {
  _token    = token.replace(/^oauth:/, '');
  _clientId = clientId;
}

// ── Core request helper ───────────────────────────────────────────────────────
function helix(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = https.request({
      method,
      hostname: 'api.twitch.tv',
      path:     '/helix' + path,
      headers: {
        'Authorization':  `Bearer ${_token}`,
        'Client-Id':      _clientId,
        'Content-Type':   'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Broadcaster ID (cached) ───────────────────────────────────────────────────
async function getBroadcasterId() {
  if (_broadcasterId) return _broadcasterId;
  const r = await helix('GET', '/users');
  _broadcasterId = r.body?.data?.[0]?.id || null;
  return _broadcasterId;
}

// ── Mod list sync ─────────────────────────────────────────────────────────────
// Fetches current Twitch moderators and returns them as a Set of login names.
async function fetchMods(channel) {
  const bid = await getBroadcasterId().catch(() => null);
  if (!bid) return new Set();
  const r = await helix('GET', `/moderation/moderators?broadcaster_id=${bid}&first=100`);
  if (r.status === 401 || r.status === 403) {
    log.warn('[TwitchAPI] Missing moderation:read scope — mod sync skipped');
    return new Set();
  }
  const logins = (r.body?.data || []).map(m => (m.user_login || '').toLowerCase());
  return new Set(logins);
}

// ── Follow check ──────────────────────────────────────────────────────────────
// Returns true if userId follows the channel.
async function isFollower(userId) {
  const bid = await getBroadcasterId().catch(() => null);
  if (!bid) return true; // fail-open if API unavailable
  const r = await helix('GET',
    `/channels/followers?broadcaster_id=${bid}&user_id=${userId}&first=1`);
  if (r.status === 401 || r.status === 403) return true; // fail-open on scope miss
  return (r.body?.data?.length ?? 0) > 0;
}

// ── Sub check ─────────────────────────────────────────────────────────────────
// Returns true if userId is a subscriber of the channel.
async function isSubscriber(userId) {
  const bid = await getBroadcasterId().catch(() => null);
  if (!bid) return false;
  const r = await helix('GET',
    `/subscriptions/user?broadcaster_id=${bid}&user_id=${userId}`);
  if (r.status === 401 || r.status === 403) return false;
  return (r.body?.data?.length ?? 0) > 0;
}

// ── Announcements ─────────────────────────────────────────────────────────────
// Sends a /announce style message via the Helix API.
// color: 'primary' | 'blue' | 'green' | 'orange' | 'purple'
async function sendAnnouncement(message, color = 'purple') {
  const bid = await getBroadcasterId().catch(() => null);
  if (!bid) return false;
  const r = await helix('POST',
    `/chat/announcements?broadcaster_id=${bid}&moderator_id=${bid}`,
    { message, color }
  );
  if (r.status === 401 || r.status === 403) {
    log.warn('[TwitchAPI] Missing moderator:manage:announcements scope');
    return false;
  }
  return r.status === 204;
}

// ── Resolve login name → numeric user ID ─────────────────────────────────────
const _loginCache = new Map();
async function getUserIdByLogin(login) {
  if (_loginCache.has(login)) return _loginCache.get(login);
  const r = await helix('GET', `/users?login=${encodeURIComponent(login)}`);
  const id = r.body?.data?.[0]?.id || null;
  if (id) _loginCache.set(login, id);
  return id;
}

module.exports = { init, fetchMods, isFollower, isSubscriber, sendAnnouncement, getBroadcasterId, getUserIdByLogin };
