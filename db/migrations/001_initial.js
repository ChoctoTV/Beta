'use strict';
module.exports = {
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id         TEXT PRIMARY KEY,
        display    TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS balances (
        user_id    TEXT PRIMARY KEY REFERENCES users(id),
        amount     REAL NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS inventory (
        user_id    TEXT PRIMARY KEY REFERENCES users(id),
        sticks     INTEGER NOT NULL DEFAULT 0,
        balls      INTEGER NOT NULL DEFAULT 0,
        moons      INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS roles (
        user_id    TEXT NOT NULL REFERENCES users(id),
        role       TEXT NOT NULL CHECK (role IN ('mod','dev')),
        granted_at TEXT DEFAULT (datetime('now')),
        granted_by TEXT,
        PRIMARY KEY (user_id, role)
      );
      CREATE TABLE IF NOT EXISTS lottery_tickets (
        user_id TEXT PRIMARY KEY REFERENCES users(id),
        numbers TEXT NOT NULL,
        set_at  TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS gbm_picks (
        user_id TEXT PRIMARY KEY REFERENCES users(id),
        pick    TEXT NOT NULL,
        set_at  TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS wallets (
        user_id   TEXT PRIMARY KEY REFERENCES users(id),
        address   TEXT NOT NULL,
        linked_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS cashouts (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id          TEXT NOT NULL,
        choctopus        REAL NOT NULL,
        choctobits_spent REAL NOT NULL,
        remainder        REAL NOT NULL,
        created_at       TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS verified_accounts (
        user_id   TEXT PRIMARY KEY REFERENCES users(id),
        linked_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS config (
        key        TEXT PRIMARY KEY,
        value      REAL NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS scroll_sites (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        url      TEXT NOT NULL UNIQUE,
        added_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS collections (
        address  TEXT PRIMARY KEY,
        added_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS coins (
        sym      TEXT PRIMARY KEY,
        id       TEXT NOT NULL,
        color    TEXT DEFAULT '#ffffff',
        added_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS gauntlet_daily (
        user_id TEXT NOT NULL REFERENCES users(id),
        date    TEXT NOT NULL,
        PRIMARY KEY (user_id)
      );
      CREATE TABLE IF NOT EXISTS gauntlet_scores (
        user_id  TEXT PRIMARY KEY REFERENCES users(id),
        wins     INTEGER NOT NULL DEFAULT 0,
        runs     INTEGER NOT NULL DEFAULT 0,
        last_run TEXT
      );
      CREATE TABLE IF NOT EXISTS airdrop_budgets (
        user_id   TEXT NOT NULL REFERENCES users(id),
        date      TEXT NOT NULL,
        used_free REAL NOT NULL DEFAULT 0,
        used_paid REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id)
      );

      -- Default data
      INSERT OR IGNORE INTO scroll_sites (url) VALUES
        ('https://choctopus.io'),
        ('https://magiceden.us/marketplace/choctonaut_army');
      INSERT OR IGNORE INTO collections (address)
        VALUES ('Fex3HFPohjTUvQaN3uj64tDU5D3iPwVwfPMi612TUPue');
      INSERT OR IGNORE INTO coins (sym, id, color)
        VALUES ('CHOCT', 'EVrGfAj99Xr1NjqqZv6E2msVKZVmhGaThHhcZXzrpump', '#7B2FBE');
    `);
  }
};
