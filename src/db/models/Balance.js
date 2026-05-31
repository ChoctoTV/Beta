'use strict';
const db = require('../');

/**
 * ensure() upserts the user row.  When a twitchId is supplied:
 *   - If a row already exists with that twitch_id, its id column is updated
 *     to the current login name (handles username changes transparently).
 *   - Otherwise the row is created / confirmed normally and twitch_id is stored.
 *
 * All subsequent lookups fall back to twitch_id if the login name misses,
 * so progress survives Twitch username changes.
 */
function ensure(id, display, twitchId) {
  if (twitchId && twitchId !== id) {
    // Check if this twitch_id is already stored under a different login
    const existing = db.prepare('SELECT id FROM users WHERE twitch_id=?').get(twitchId);
    if (existing && existing.id !== id) {
      // Username changed — migrate the row to the new login
      db.prepare('UPDATE users SET id=?, display=? WHERE twitch_id=?').run(id, display || id, twitchId);
      db.prepare('UPDATE balances    SET user_id=? WHERE user_id=?').run(id, existing.id);
      db.prepare('UPDATE inventory   SET user_id=? WHERE user_id=?').run(id, existing.id);
      db.prepare('UPDATE roles       SET user_id=? WHERE user_id=?').run(id, existing.id);
      db.prepare('UPDATE lottery_tickets SET user_id=? WHERE user_id=?').run(id, existing.id);
      db.prepare('UPDATE gbm_picks   SET user_id=? WHERE user_id=?').run(id, existing.id);
      db.prepare('UPDATE wallets     SET user_id=? WHERE user_id=?').run(id, existing.id);
      db.prepare('UPDATE cashouts    SET user_id=? WHERE user_id=?').run(id, existing.id);
      db.prepare('UPDATE verified_accounts SET user_id=? WHERE user_id=?').run(id, existing.id);
      db.prepare('UPDATE lurk_sessions SET user_id=? WHERE user_id=?').run(id, existing.id);
      db.prepare('UPDATE gauntlet_daily  SET user_id=? WHERE user_id=?').run(id, existing.id);
      db.prepare('UPDATE gauntlet_scores SET user_id=? WHERE user_id=?').run(id, existing.id);
      db.prepare('UPDATE airdrop_budgets SET user_id=? WHERE user_id=?').run(id, existing.id);
      return; // row already migrated
    }
  }
  db.prepare('INSERT OR IGNORE INTO users (id, display) VALUES (?,?)').run(id, display || id);
  if (twitchId) {
    db.prepare('UPDATE users SET twitch_id=?, display=? WHERE id=? AND (twitch_id IS NULL OR twitch_id=?)').run(twitchId, display || id, id, twitchId);
  }
  db.prepare('INSERT OR IGNORE INTO balances (user_id, amount) VALUES (?,0)').run(id);
}

function get(id) { return db.prepare('SELECT amount FROM balances WHERE user_id=?').get(id)?.amount || 0; }

function add(id, amt, disp, twitchId) {
  ensure(id, disp, twitchId);
  db.prepare("UPDATE balances SET amount=amount+?,updated_at=datetime('now') WHERE user_id=?").run(amt, id);
  return get(id);
}

function subtract(id, amt) {
  const bal = get(id);
  if (bal < amt) throw new Error(`Insufficient: ${bal} < ${amt}`);
  db.prepare("UPDATE balances SET amount=amount-?,updated_at=datetime('now') WHERE user_id=?").run(amt, id);
  return get(id);
}

function top(limit = 5, excludeId = null) {
  return db.prepare('SELECT u.display,b.amount FROM balances b JOIN users u ON u.id=b.user_id WHERE b.user_id!=COALESCE(?,\'\') AND b.amount>0 ORDER BY b.amount DESC LIMIT ?').all(excludeId, limit);
}


function set(id, amt) {
  ensure(id, id);
  db.prepare("UPDATE balances SET amount=?,updated_at=datetime('now') WHERE user_id=?").run(amt, id);
}

module.exports = { ensure, get, add, subtract, top, set };
