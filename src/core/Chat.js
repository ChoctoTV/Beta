'use strict';
const Duty = require('../economy/duty');
const tmi     = require('tmi.js');
const https   = require('https');
const log     = require('../observability/logger').child({ service:'chat' });
const metrics = require('../observability/metrics');
const Roles   = require('../db/models/Roles');
const Config  = require('./Config');

const CHANNEL = (process.env.TWITCH_CHANNEL || process.env.CHANNEL || '').toLowerCase();
const BOT     = (process.env.TWITCH_BOT_USERNAME || process.env.BOT_USERNAME || CHANNEL).toLowerCase();
// Token read fresh at connect() time so OAuthManager.primeToken() updates apply

// Natural-language rules — checked on every non-! message
// Must match v2's NL_RULES exactly so existing viewer habits work
const NL_RULES = [
  { cmd:'toss',          re:/\b(toss(?:es|ing|ed)?)\b/i },
  { cmd:'throw',         re:/\b(throw(?:s|ing)?|threw|thrown)\b/i },
  { cmd:'dig',           re:/\b(dig(?:s|ging)?|dug)\b/i },
  { cmd:'walk',          re:/\b(walk(?:s|ing|ed)?)\b/i },
  { cmd:'fish',          re:/\b(fish(?:es|ing|ed)?|fishin)\b/i },
  { cmd:'battle',        re:/\b(battle(?:s|d)?|fight(?:s|ing)?|fought)\b/i },
  { cmd:'lurk',          re:/\b(lurk(?:ing)?)\b/i },
  { cmd:'lick',          re:/\b(lick(?:s|ing|ed)?)\b/i },
  { cmd:'balance',       re:/\b(balance|my\s+balance|how\s+many\s+chocto(?:bits)?)\b/i },
  { cmd:'lastannounce',  re:/\b(what(?:'s| is| was) that (?:ticker|announce)|last ann(?:ounce(?:ment)?)?)\b/i },
  { cmd:'gauntlet',      re:/\bi\s+(want|wanna|wish)\s+to\s+run\s+(the\s+)?gauntlet\b/i },
];

// Music community vote (3 unique viewers in 10 min toggles music)
const VOTE_NEEDED = 3;
const _musicVotes = { on: new Map(), off: new Map() };
function recordMusicVote(user, dir) {
  const now = Date.now();
  const m   = _musicVotes[dir];
  m.set(user, now);
  // Prune votes older than 10 minutes
  for (const [u, ts] of m) if (now - ts > 600000) m.delete(u);
  return m.size >= VOTE_NEEDED;
}

// Per-user cooldown
const _cd = new Map();
setInterval(() => {
  const now = Date.now(), limit = Config.get('cooldown_ms') * 10;
  for (const [id, ts] of _cd) if (now - ts > limit) _cd.delete(id);
}, 10 * 60000);

// Validate token against Twitch and return its account login + scopes.
// tmi.js REQUIRES username to match the token's account, so we derive it here.
function validateToken(token) {
  return new Promise(resolve => {
    const raw = (token || '').replace(/^oauth:/, '');
    if (!raw) { resolve(null); return; }
    const req = https.request({
      hostname: 'id.twitch.tv', path: '/oauth2/validate',
      headers: { Authorization: `OAuth ${raw}` },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode !== 200) { resolve(null); return; }
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

class Chat {
  constructor(loader, makeCtx) {
    this._loader  = loader;
    this._makeCtx = makeCtx;
    this._client  = null;
  }

  async connect() {
    const rawToken = (process.env.TWITCH_OAUTH_TOKEN || process.env.OAUTH_TOKEN || '').replace(/^oauth:/, '');

    if (!rawToken) {
      console.error('\n╔════════════════════════════════════════════════════════════╗');
      console.error('║  CHAT CANNOT CONNECT — no Twitch OAuth token found.        ║');
      console.error('║  Run: ./start.sh updatescopes   (or set TWITCH_OAUTH_TOKEN)║');
      console.error('╚════════════════════════════════════════════════════════════╝\n');
      throw new Error('No OAuth token');
    }

    // Validate token → get the account it belongs to. tmi.js needs username to match.
    const info = await validateToken(rawToken);
    let username = BOT;

    if (!info) {
      console.error('\n╔════════════════════════════════════════════════════════════╗');
      console.error('║  CHAT TOKEN INVALID OR EXPIRED.                            ║');
      console.error('║  The token failed Twitch validation.                       ║');
      console.error('║  Fix: regenerate at twitchtokengenerator.com (all scopes)  ║');
      console.error('║       and set TWITCH_OAUTH_TOKEN in your Secret file,       ║');
      console.error('║       OR run: ./start.sh updatescopes                      ║');
      console.error('╚════════════════════════════════════════════════════════════╝\n');
      throw new Error('Token validation failed');
    }

    // Use the token's actual account as the chat username (prevents mismatch auth failures)
    username = (info.login || BOT).toLowerCase();
    if (BOT && username !== BOT) {
      log.warn({ configured: BOT, actual: username },
        `Bot username "${BOT}" doesn't match token account "${username}" — using token account`);
    }
    log.info({ account: username, channel: CHANNEL, scopes: (info.scopes||[]).length },
      `Chat token valid — connecting as ${username}`);

    this._client = new tmi.Client({
      options:    { debug: false },
      connection: { reconnect: true, secure: true, maxReconnectAttempts: Infinity },
      identity:   { username, password: `oauth:${rawToken}` },
      channels:   [CHANNEL],
    });
    this._client.on('message',              this._onMessage.bind(this));
    this._client.on('connected',    addr => log.info({ addr }, `✓ Chat CONNECTED as ${username} in #${CHANNEL}`));
    this._client.on('disconnected', reason => log.warn({ reason }, 'Chat disconnected (will auto-reconnect)'));
    this._client.on('authentication_failed', () => {
      console.error('\n[CHAT] AUTHENTICATION FAILED — token rejected by Twitch IRC.');
      console.error('[CHAT] The token account does not match, or token lacks chat:read/chat:edit.');
      console.error('[CHAT] Regenerate token with chat:read + chat:edit scopes.\n');
      metrics.recordError('chat', 'auth_failed');
    });
    await this._client.connect();
  }

  say(msg) { if (this._client) this._client.say(CHANNEL, msg).catch(() => {}); }

  _onMessage(channel, tags, rawMsg, self) {
    if (self) return;
    const text    = rawMsg.trim();
    if (!text)    return;
    const userId   = tags.username.toLowerCase();
    const twitchId = tags['user-id'] || userId;  // numeric Twitch user ID
    const display  = tags['display-name'] || tags.username;
    const isSub    = !!(tags.subscriber || tags['badge-info']?.subscriber);
    const isMod    = Roles.isMod(userId);
    const isDev    = Roles.isDev(userId);
    const isStr    = userId === CHANNEL;

    // Mark active for airdrop eligibility on every message
    try { require('../economy/activity').markActive(userId, isSub); } catch {}

    // ── Music community vote (non-mods only) ──────────────────────────────────
    if (!isMod && !isDev && !isStr) {
      const lower   = text.toLowerCase();
      const voteOff = /\bmusic\s+off\b|\bturn\s+off\s+(?:the\s+)?music\b|\bstop\s+(?:the\s+)?music\b/.test(lower);
      const voteOn  = /\bmusic\s+on\b|\bturn\s+(?:the\s+)?music\s+on\b|\bstart\s+(?:the\s+)?music\b/.test(lower);
      if (voteOff || voteOn) {
        const dir       = voteOff ? 'off' : 'on';
        const triggered = recordMusicVote(userId, dir);
        const count     = _musicVotes[dir].size;
        if (triggered) {
          try { require('fs').writeFileSync('/tmp/choctotv_music_ctrl.json', JSON.stringify({ cmd: dir })); } catch {}
          this.say(`🗳️ Vote passed! Music turned ${dir} by community vote (${VOTE_NEEDED}/${VOTE_NEEDED}) 🎵`);
          try { this._makeCtx({ userId, twitchId, user:display, args:[], cmd:'music_vote', isSub, isMod, isDev, isStreamer:isStr })
            .broadcast({ type:'music_vote', direction:dir, passed:true }); } catch {}
        } else {
          this.say(`🗳️ @${display} voted music ${dir} (${count}/${VOTE_NEEDED} — ${VOTE_NEEDED-count} more needed)`);
        }
        return;
      }
    }

    // ── Commands — with or without ! prefix ──────────────────────────────────
    // Economy, mod-tools, and major settings require ! (they set requirePrefix:true)
    // Game and info commands work either way.
    const hasPrefix = text.startsWith('!');
    const parts   = (hasPrefix ? text.slice(1) : text).split(/\s+/);
    const cmdName = parts[0].toLowerCase();
    const args    = parts.slice(1);

    if (hasPrefix) {
      this._dispatch(cmdName, args, userId, twitchId, display, isSub, isMod, isDev, isStr);
      return;
    }

    // No prefix: only dispatch if command exists AND doesn't require the prefix
    const _mod = this._loader.get(cmdName);
    if (_mod) {
      // Check runtime override first, then command default
      let prefixOverride;
      try { prefixOverride = Config.getRuntime(`cmd_require_prefix_${cmdName}`); } catch {}
      const needsPrefix = (prefixOverride !== undefined && prefixOverride !== null)
        ? !!prefixOverride
        : !!_mod.requirePrefix;
      if (!needsPrefix) {
        this._dispatch(cmdName, args, userId, twitchId, display, isSub, isMod, isDev, isStr);
        return;
      }
    }

    // ── Natural language ──────────────────────────────────────────────────────
    for (const rule of NL_RULES) {
      if (!rule.re.test(text)) continue;
      log.debug({ cmd: rule.cmd, user: userId }, 'NL match');
      this._dispatch(rule.cmd, [], userId, twitchId, display, isSub, isMod, isDev, isStr);
      return;
    }
  }

  _dispatch(cmdName, args, userId, twitchId, display, isSub, isMod, isDev, isStr) {
    const mod = this._loader.get(cmdName);
    if (!mod) return;
    if (!this._perm(mod.permissions, userId, isMod, isDev, isStr)) return;

    // Cooldown enforcement
    // strictCooldown=true: applies to EVERYONE including mods and streamers (game commands)
    // Normal cooldown: skipped for mods/devs/streamer (utility/economy commands)
    // Bypass only if: NOT strictCooldown AND (dev OR streamer) AND currently on duty
    // Mods never bypass cooldowns. Off-duty devs/streamers get normal cooldowns.
    // Lurkers are always strict viewers — no role bypass while lurking
    const isLurking = (() => { try { return require('../economy/lurk').isActive(userId); } catch { return false; } })();
    const roleFree  = !mod.strictCooldown && !isLurking && (isDev || isStr) && Duty.isOnDuty(userId);
    if (mod.cooldown && !roleFree) {
      let cdOverride;
      try { cdOverride = Config.getRuntime(`cmd_cooldown_${mod.name}`); } catch {}
      let cdMs;
      if (cdOverride === -1) {
        cdMs = 0;
      } else if (cdOverride > 0) {
        cdMs = cdOverride * 1000;
      } else {
        cdMs = typeof mod.cooldown === 'number' ? mod.cooldown * 1000
                   : (isSub ? Config.get('sub_cooldown_ms') : Config.get('cooldown_ms'));
      }
      if (cdMs > 0) {
        const cdKey  = `${userId}:${mod.name}`;
        const elapsed = Date.now() - (_cd.get(cdKey) || 0);
        if (elapsed < cdMs) {
          const remSec = Math.ceil((cdMs - elapsed) / 1000);
          const remStr = remSec >= 60
            ? `${Math.floor(remSec/60)}m ${remSec%60}s`
            : `${remSec}s`;
          this.say(`⏳ @${display} !${mod.name} cooldown — ${remStr} remaining.`);
          return;
        }
        _cd.set(cdKey, Date.now());
      }
    }

    metrics.inc('choctotv_commands_total', { command: mod.name });

    // A real user action cancels lurk mode (lurk ticks bypass this dispatch path).
    const GAME_CMDS = ['toss','throw','dig','walk','fish','cast','lick','gauntlet','battle'];
    if (GAME_CMDS.includes(mod.name)) {
      try {
        const Lurk = require('../economy/lurk');
        if (Lurk.isActive(userId)) {
          Lurk.remove(userId);
          this.say(`🌙 @${display} woke up from lurk mode!`);
          // Broadcast directly — no _makeCtx needed for a simple state sync
          try { require('../services/Broadcast').broadcast({ type:'lurk_update', lurkers: Lurk.getLurkers() }); } catch {}
        }
      } catch {}
    }

    // Pause gate — block game/economy commands during maintenance / startup warm-up.
    // Streamer commands (quality, deploy, etc.) always pass through.
    const _gate = require('./CommandGate');
    if (_gate.isPaused() && GAME_CMDS.includes(mod.name)) {
      const _say = this.say.bind(this);
      _say(`⏸️ @${display}: ${_gate.reason() || 'Commands paused — hang tight!'}`);
      return;
    }

    // Follow gate — game commands require following the channel.
    // Mods, devs, and the streamer bypass the check.
    if (GAME_CMDS.includes(mod.name) && !isMod && !isDev && !isStr
        && typeof global._choctoFollowCheck === 'function' && twitchId) {
      global._choctoFollowCheck(twitchId).then(follows => {
        if (!follows) {
          this.say(`@${display} you need to follow the channel to play! 🐾 Follow at twitch.tv/${process.env.TWITCH_CHANNEL || 'ChoctoTV'} then try again!`);
          return;
        }
        const ctx = this._makeCtx({ userId, twitchId, user:display, args, cmd:cmdName,
                                     isSub, isMod, isDev, isStreamer:isStr });
        Promise.resolve(mod.execute(ctx)).catch(err => {
          log.error({ command: mod.name, user: userId, err: err.message }, 'Command error');
          metrics.recordError(mod.name, err.message);
        });
      }).catch(() => {
        const ctx = this._makeCtx({ userId, twitchId, user:display, args, cmd:cmdName,
                                     isSub, isMod, isDev, isStreamer:isStr });
        Promise.resolve(mod.execute(ctx)).catch(() => {});
      });
      return;
    }

    const ctx = this._makeCtx({ userId, twitchId, user:display, args, cmd:cmdName,
                                 isSub, isMod, isDev, isStreamer:isStr });
    Promise.resolve(mod.execute(ctx)).catch(err => {
      log.error({ command: mod.name, user: userId, err: err.message }, 'Command error');
      metrics.recordError(mod.name, err.message);
    });
  }

  _perm(level, id, isMod, isDev, isStr) {
    if (level === 'viewer')   return true;
    if (level === 'streamer') return isStr;
    if (level === 'mod')      return isStr || isMod || isDev;
    if (level === 'dev')      return isStr || isDev;
    return false;
  }
  /**
   * redeemChannelPoint — called by ChannelPoints service when a viewer redeems a reward.
   * Goes through the SAME cooldown pipeline as a typed chat command, so both windows
   * are shared: typing !toss and clicking the channel point reward use the same timer.
   *
   * Returns true if command ran, false if on cooldown or blocked.
   */
  redeemChannelPoint(cmdName, userId, twitchId, display, args = []) {
    const mod = this._loader.get(cmdName);
    if (!mod) return false;

    // Channel point redeemers are always treated as plain viewers
    const isSub = false, isMod = false, isDev = false, isStr = false;
    if (!this._perm(mod.permissions, userId, isMod, isDev, isStr)) return false;

    // Shared cooldown — same key as typed command
    if (mod.cooldown) {
      let cdMs = typeof mod.cooldown === 'number'
        ? mod.cooldown * 1000
        : Config.get('cooldown_ms');
      try {
        const cdOverride = Config.getRuntime(`cmd_cooldown_${mod.name}`);
        if (cdOverride === -1) cdMs = 0;
        else if (cdOverride > 0) cdMs = cdOverride * 1000;
      } catch {}

      if (cdMs > 0) {
        const cdKey   = `${userId}:${mod.name}`;
        const elapsed = Date.now() - (_cd.get(cdKey) || 0);
        if (elapsed < cdMs) {
          const remSec = Math.ceil((cdMs - elapsed) / 1000);
          this.say(`⏳ @${display} Channel Points — !${mod.name} cooldown: ${remSec}s remaining.`);
          return false;  // still on cooldown from chat command (or prior redemption)
        }
        _cd.set(cdKey, Date.now());  // lock cooldown immediately
      }
    }

    metrics.inc('choctotv_commands_total', { command: mod.name });

    const ctx = this._makeCtx({ userId, twitchId, user: display, args, cmd: cmdName,
      isSub, isMod, isDev, isStreamer: false, tags: {}, isChannelPoint: true });

    Promise.resolve(mod.execute(ctx))
      .then(r => { if (r?.ok === false) _cd.delete(`${userId}:${mod.name}`); })
      .catch(() => { _cd.delete(`${userId}:${mod.name}`); });  // refund cooldown on crash

    return true;
  }

}
module.exports = Chat;
