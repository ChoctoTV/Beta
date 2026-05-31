'use strict';
// ── !oldwallet — Firebot wallet import command ────────────────────────────────
// Usage (sent by Firebot): !oldwallet @username #,#,#,#
// The four numbers (left→right): Choctobits, Sticks, Balls, Moons
// Permissions: mod/dev only (Firebot runs as the channel, which has mod/dev rights)
//
// Format: !oldwallet @Rayn 5000,200,15,3
// Also handles: !oldwallet Rayn 5000,200,15,3  (no @ prefix)

module.exports = {
  name: 'oldwallet',
  requirePrefix: true,
  permissions: 'mod',   // mods, devs, and streamer can trigger this
  cooldown: false,

  async execute(ctx) {
    const { args, say, Balance, Inventory, db } = ctx;

    if (!args || args.length < 2) {
      say(`❌ Usage: !oldwallet @username Choctobits,Sticks,Balls,Moons`);
      return { ok: false };
    }

    // ── Parse target username (strip @ prefix) ──────────────────────────────
    const rawUser = args[0].replace(/^@/, '').toLowerCase().trim();
    if (!rawUser) {
      say(`❌ !oldwallet: missing username`);
      return { ok: false };
    }

    // ── Parse the four values (comma-separated) ─────────────────────────────
    const valueStr = args[1] || '';
    const parts = valueStr.split(',').map(v => {
      const n = parseInt(v.trim(), 10);
      return isNaN(n) || n < 0 ? null : n;
    });

    if (parts.length < 4 || parts.some(p => p === null)) {
      say(`❌ !oldwallet: need 4 comma-separated non-negative numbers — got "${valueStr}"`);
      return { ok: false };
    }

    const [choctobits, sticks, balls, moons] = parts;

    // ── Resolve userId from display name via DB (viewers table) ────────────
    // Falls back to using the username as userId if not found (Twitch user IDs
    // are lowercase login names in this system).
    let targetUserId = rawUser;
    try {
      const row = db.prepare(
        `SELECT user_id FROM balances WHERE LOWER(user_id)=? LIMIT 1`
      ).get(rawUser);
      if (row) targetUserId = row.user_id;
    } catch { /* table may not exist yet — use rawUser */ }

    // ── Apply the balances ──────────────────────────────────────────────────
    // CHANGED: Use separate try/catch for each operation so a partial failure
    // doesn't leave the user in an inconsistent state.

    let chocResult = { ok: true };
    let invResult  = { ok: true };

    try {
      if (choctobits > 0) {
        Balance.add(targetUserId, choctobits, 'oldwallet_import');
      }
    } catch (e) {
      chocResult = { ok: false, error: e.message };
    }

    try {
      if (sticks > 0 || balls > 0 || moons > 0) {
        Inventory.add(targetUserId, { sticks, balls, moons }, 'oldwallet_import');
      }
    } catch (e) {
      invResult = { ok: false, error: e.message };
    }

    if (!chocResult.ok || !invResult.ok) {
      const err = chocResult.error || invResult.error;
      say(`❌ !oldwallet: failed for @${rawUser} — ${err}`);
      return { ok: false, error: err };
    }

    // ── Confirm ─────────────────────────────────────────────────────────────
    const parts2 = [];
    if (choctobits > 0) parts2.push(`${choctobits.toLocaleString()}🍫`);
    if (sticks  > 0)    parts2.push(`${sticks.toLocaleString()} sticks`);
    if (balls   > 0)    parts2.push(`${balls.toLocaleString()} balls`);
    if (moons   > 0)    parts2.push(`${moons.toLocaleString()} 🌙`);

    say(`✅ Old wallet imported for @${rawUser}: ${parts2.join(', ')} added`);
    return { ok: true };
  },
};
