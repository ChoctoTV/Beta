/**
 * Migration 002 — Persistent in-memory state.
 * Allows app.js to save/restore state across restarts cleanly.
 */
'use strict';
module.exports = {
  version: 2,
  up(db) {
    db.exec(`
      -- Lurk sessions: survive restart, users remain lurking
      CREATE TABLE IF NOT EXISTS lurk_sessions (
        user_id  TEXT PRIMARY KEY REFERENCES users(id),
        display  TEXT NOT NULL,
        until_ms INTEGER NOT NULL,
        saved_at TEXT DEFAULT (datetime('now'))
      );

      -- Daily sprite bonus assignments: same favGame/favWeather all day
      -- Keyed by sprite name + date so midnight reset is automatic
      CREATE TABLE IF NOT EXISTS sprite_bonuses (
        sprite_name TEXT NOT NULL,
        date        TEXT NOT NULL,
        fav_game    TEXT NOT NULL,
        fav_weather TEXT NOT NULL,
        PRIMARY KEY (sprite_name, date)
      );

      -- App state: weather, any simple key-value runtime values
      CREATE TABLE IF NOT EXISTS app_state (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      -- Per-mint game name: persists across NFT changes so the same pup keeps its name
      CREATE TABLE IF NOT EXISTS mint_names (
        mint      TEXT PRIMARY KEY,
        game_name TEXT NOT NULL,
        named_by  TEXT NOT NULL,
        named_at  TEXT DEFAULT (datetime('now'))
      );
    `);
  }
};
