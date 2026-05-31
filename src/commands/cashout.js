'use strict';
/**
 * cashout.js
 *
 * !cashout              → convert Choctobits → Choctopus via tipbot
 * !cashout test         → dry-run: shows what would happen, no real payout
 * !cashout disable      → (dev/streamer) disable all cashouts (tipbot down, investigation, etc.)
 * !cashout nil          → alias for disable
 * !cashout enable       → (dev/streamer) re-enable cashouts
 * !cashout status       → show current cashout status
 */

const Teller = require('../services/Teller');
const RATE   = 1000;   // Choctobits per Choctopus

// Runtime flag — persists for the life of the process only.
// If you restart the app, cashouts re-enable automatically.
// Use !cashout disable before maintenance; !cashout enable when done.
let _disabled = false;
let _disabledBy = null;
let _disabledAt = null;

module.exports = {
  name: 'cashout',
  permissions: 'viewer',
  cooldown: false,

  async execute(ctx) {
    const { userId, twitchId, user, say, broadcast, Balance,
            args, isMod, isDev, isStreamer } = ctx;

    const sub = (args[0] || '').toLowerCase();
    const isPriv = isDev || isStreamer;

    // ── Control commands (dev/streamer only) ──────────────────────────────────
    if (sub === 'disable' || sub === 'nil') {
      if (!isPriv) { say(`❌ @${user} only devs/streamer can disable cashouts.`); return { ok:false }; }
      _disabled   = true;
      _disabledBy = user;
      _disabledAt = new Date().toLocaleTimeString();
      say(`🔒 Cashouts DISABLED by @${user}. Viewers cannot cashout until re-enabled.`);
      say(`  Use !cashout enable when ready to restore.`);
      return { ok: true };
    }

    if (sub === 'enable') {
      if (!isPriv) { say(`❌ @${user} only devs/streamer can re-enable cashouts.`); return { ok:false }; }
      _disabled   = false;
      _disabledBy = null;
      _disabledAt = null;
      say(`✅ Cashouts ENABLED — viewers can cashout again.`);
      return { ok: true };
    }

    if (sub === 'status') {
      if (_disabled) {
        say(`🔒 Cashouts are DISABLED (by @${_disabledBy} at ${_disabledAt}). Use !cashout enable to restore.`);
      } else {
        say(`✅ Cashouts are ENABLED and operational.`);
      }
      return { ok: true };
    }

    // ── Test mode — always available (bypasses disabled flag for devs/streamer) ─
    if (sub === 'test') {
      const bal  = Balance.get(userId);
      const choc = Math.floor(bal / RATE);
      const spent = choc * RATE;
      const rem   = Math.round((bal - spent) * 100) / 100;
      if (choc < 1) {
        say(`🧪 TEST @${user}: would need ${RATE.toLocaleString()}🍫 minimum. You have ${bal.toLocaleString()}🍫`);
        return { ok: true };
      }
      const status = _disabled ? ' [CASHOUTS CURRENTLY DISABLED]' : '';
      say(`🧪 TEST @${user}${status}: would cash out ${choc} Choctopus (${spent.toLocaleString()}🍫 → ${rem.toLocaleString()}🍫 remaining). No payout sent.`);
      return { ok: true };
    }

    // ── Disabled check (applies to all non-privileged users) ─────────────────
    if (_disabled && !isPriv) {
      say(`🔒 @${user} cashouts are temporarily disabled — the team is on it. Check back soon!`);
      return { ok: false };
    }

    // ── Live cashout ──────────────────────────────────────────────────────────
    const bal  = Balance.get(userId);
    const choc = Math.floor(bal / RATE);
    if (choc < 1) {
      say(`❌ @${user} need ${RATE.toLocaleString()}🍫 minimum. You have ${bal.toLocaleString()}🍫`);
      return { ok: false };
    }
    const spent = choc * RATE;
    const rem   = Math.round((bal - spent) * 100) / 100;
    const EMO   = process.env.CHOCTOPI_EMOTE || 'Choctopus';

    say(`⏳ @${user} processing cashout...`);

    let resp;
    try {
      resp = await Teller.sendCashout({ user, user_id: twitchId || userId, amount: choc });
    } catch (e) {
      say(`❌ @${user} cashout failed — ${e.message}`);
      return { ok: false };
    }

    if (resp.status !== 200 && resp.body?.ok !== true && resp.body?.success !== true) {
      const err = resp.body?.error || resp.body?.message || `HTTP ${resp.status}`;
      say(`❌ @${user} cashout rejected — ${err}. Wallet unchanged.`);
      return { ok: false };
    }

    Balance.subtract(userId, spent);
    say(`✅ @${user} ${choc} ${EMO} sent! 💸 ${spent.toLocaleString()}🍫 deducted · ${rem.toLocaleString()}🍫 remains`);
    broadcast({ type:'cashout_confirm', user, choctopus: choc, remainder: rem });
    return { ok: true };
  },
};
