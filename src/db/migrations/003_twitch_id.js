/**
 * Migration 003 — Twitch numeric user ID column.
 * Adds twitch_id to users so progress survives username changes.
 * If a user logs in with a known twitch_id, their login is updated
 * automatically; all balances/inventory/roles remain intact.
 */
'use strict';
module.exports = {
  version: 3,
  up(db) {
    db.exec(`
      -- Add twitch_id column (nullable so existing rows keep working)
      ALTER TABLE users ADD COLUMN twitch_id TEXT;
      -- Index for fast lookup by twitch_id
      CREATE INDEX IF NOT EXISTS idx_users_twitch_id ON users(twitch_id);
    `);
  }
};
