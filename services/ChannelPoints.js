/**
 * ChannelPoints — Twitch EventSub WebSocket integration.
 * Listens for channel point redemptions and maps them to game commands.
 *
 * Required OAuth scopes (add to your Twitch app):
 *   channel:read:redemptions   — to receive redemption events
 *   channel:manage:redemptions — to auto-create rewards (optional)
 *
 * If token lacks these scopes, service logs a warning and does nothing.
 * Actions and costs are configurable in rewardsEcon.txt.
 */
'use strict';
const https  = require('https');
const { WebSocket } = require('ws');

const EVENTSUB_WS  = 'wss://eventsub.wss.twitch.tv/ws';
const HELIX        = 'https://api.twitch.tv/helix';

// Default channel point cost per action (overridden by rewardsEcon.txt)
const DEFAULT_COSTS = {
  walk: 5, toss: 2, throw: 2, dig: 2, fish: 3, lurk: 1, lick: 1,
};

// Reward title → command name mapping (case-insensitive contains match)
const TITLE_MAP = {
  'choctotv walk':  'walk',
  'choctotv toss':  'toss',
  'choctotv throw': 'throw',
  'choctotv dig':   'dig',
  'choctotv fish':  'fish',
  'choctotv lurk':  'lurk',
  'choctotv lick':  'lick',
};

let _dispatch = null; // fn(userId, displayName, command)
let _onAdBreak = null; // fn(durationSeconds) — called when an ad break begins
let _eventSubReadyAt = 0;        // timestamp when EventSub connected
let _lastAdAirdropAt = 0;        // timestamp of last ad airdrop (cooldown)
const _seenMsgIds   = new Set(); // dedupe replayed notifications
const AD_STARTUP_GRACE_MS = 20000;   // ignore ad events in first 20s after connect
const AD_AIRDROP_COOLDOWN_MS = 5 * 60000; // min 5 min between ad airdrops
let _ws       = null;
let _retry    = 0;

function api(method, path, token, clientId, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      method, hostname: 'api.twitch.tv',
      path: '/helix' + path,
      headers: {
        'Authorization': `Bearer ${token.replace(/^oauth:/,'')}`,
        'Client-Id':     clientId,
        'Content-Type':  'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, res => {
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

async function getBroadcasterId(token, clientId) {
  const r = await api('GET', '/users', token, clientId);
  return r.body?.data?.[0]?.id || null;
}

async function subscribeTo(type, version, sessionId, broadcasterId, token, clientId) {
  const r = await api('POST', '/eventsub/subscriptions', token, clientId, {
    type, version,
    condition: { broadcaster_user_id: broadcasterId },
    transport: { method: 'websocket', session_id: sessionId },
  });
  if (r.status === 202) { console.log(`[EventSub] Subscribed: ${type}`); return true; }
  if (r.status === 403) { console.warn(`[EventSub] Missing scope for ${type} — skipped`); return false; }
  console.warn(`[EventSub] ${type} failed:`, r.status, JSON.stringify(r.body).slice(0,100));
  return false;
}

async function subscribe(sessionId, broadcasterId, token, clientId) {
  // Channel point redemptions → game commands
  await subscribeTo('channel.channel_points_custom_reward_redemption.add', '1',
    sessionId, broadcasterId, token, clientId);
  // Ad breaks → post-ad airdrop (needs channel:read:ads scope)
  await subscribeTo('channel.ad_break.begin', '1',
    sessionId, broadcasterId, token, clientId);
  return true;
}

async function createRewards(broadcasterId, token, clientId, cfg) {
  for (const [cmd, cost] of Object.entries(DEFAULT_COSTS)) {
    const title = `ChoctoTV ${cmd.charAt(0).toUpperCase()+cmd.slice(1)}`;
    const points = cfg ? (cfg(`cp_cost_${cmd}`) || cost) : cost;
    // Check if already exists
    const existing = await api('GET', `/channel_points/custom_rewards?broadcaster_id=${broadcasterId}`, token, clientId);
    const exists = existing.body?.data?.some(r => r.title.toLowerCase() === title.toLowerCase());
    if (!exists) {
      const r = await api('POST', '/channel_points/custom_rewards', token, clientId, {
        title,
        cost:              points,
        is_enabled:        true,
        should_redemptions_skip_request_queue: true,
      });
      if (r.status === 200) console.log(`[ChannelPoints] Created reward: "${title}" (${points} pts)`);
    }
  }
}

function connect(token, clientId, cfg, dispatch, onAdBreak) {
  _dispatch = dispatch;
  _onAdBreak = onAdBreak || null;
  let broadcasterId = null;

  async function open() {
    broadcasterId = await getBroadcasterId(token, clientId).catch(() => null);
    if (!broadcasterId) { console.warn('[ChannelPoints] Could not get broadcaster ID'); return; }

    // Optionally auto-create rewards
    if (cfg && cfg('cp_auto_create') !== 0) {
      createRewards(broadcasterId, token, clientId, cfg).catch(() => {});
    }

    _ws = new WebSocket(EVENTSUB_WS);

    _ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        const type = msg.metadata?.message_type;
        if (type === 'session_welcome') {
          const sessionId = msg.payload?.session?.id;
          _eventSubReadyAt = Date.now();  // start the startup grace window
          subscribe(sessionId, broadcasterId, token, clientId);
        } else if (type === 'notification') {
          const subType = msg.metadata?.subscription_type;
          const evt = msg.payload?.event;
          if (!evt) return;

          // Dedupe replayed/duplicate notifications by Twitch message id
          const msgId = msg.metadata?.message_id;
          if (msgId) {
            if (_seenMsgIds.has(msgId)) return;
            _seenMsgIds.add(msgId);
            if (_seenMsgIds.size > 500) _seenMsgIds.clear(); // bound memory
          }

          if (subType === 'channel.ad_break.begin') {
            const now = Date.now();
            // Ignore stale/buffered ad events delivered right at connect
            if (now - _eventSubReadyAt < AD_STARTUP_GRACE_MS) {
              console.log('[EventSub] Ad break ignored (startup grace period)');
              return;
            }
            // Cooldown — never fire two ad airdrops back-to-back
            if (now - _lastAdAirdropAt < AD_AIRDROP_COOLDOWN_MS) {
              console.log('[EventSub] Ad break ignored (airdrop cooldown active)');
              return;
            }
            // Only react to ad breaks that are actually starting now
            // (Twitch sends started_at; ignore if it's more than 60s old)
            const startedAt = evt.started_at ? Date.parse(evt.started_at) : now;
            if (now - startedAt > 60000) {
              console.log('[EventSub] Ad break ignored (event too old)');
              return;
            }
            _lastAdAirdropAt = now;
            const dur = parseInt(evt.duration_seconds) || 60;
            console.log(`[EventSub] Ad break (${dur}s) — airdrop scheduled after ads`);
            if (_onAdBreak) _onAdBreak(dur);
          } else if (subType === 'channel.channel_points_custom_reward_redemption.add') {
            const title = (evt.reward?.title || '').toLowerCase();
            const cmd   = Object.entries(TITLE_MAP).find(([k]) => title.includes(k))?.[1];
            if (cmd && _dispatch) _dispatch(evt.user_id, evt.user_name || evt.user_login, cmd);
          }
        } else if (type === 'session_keepalive') { /* noop */ }
      } catch {}
    });

    _ws.on('close', () => {
      _retry++;
      const delay = Math.min(30000, _retry * 5000);
      console.warn(`[ChannelPoints] WS closed — retry in ${delay/1000}s`);
      setTimeout(() => open(), delay);
    });

    _ws.on('error', e => console.warn('[ChannelPoints] WS error:', e.message));
  }

  open().catch(e => console.warn('[ChannelPoints] Init error:', e.message));
}

function disconnect() { if (_ws) { _ws.removeAllListeners(); _ws.close(); } }

module.exports = { connect, disconnect };
