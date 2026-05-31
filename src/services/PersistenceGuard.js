'use strict';
/**
 * PersistenceGuard — protects all player data across app updates and rebuilds.
 *
 * What is backed up (to vault/persistence/):
 *   choctotv.db    — every balance, inventory, XP, wallet, NFT link, role
 *   cashouts.json  — cashout history
 *
 * When backups happen:
 *   • Every 10 minutes while the app is running
 *   • Immediately before any shutdown (SIGTERM, SIGINT, uncaught exception)
 *   • After each backup, vault.zip is regenerated so the backup travels with the vault
 *
 * On startup:
 *   If data/db/choctotv.db is missing (fresh install or disk wipe) but
 *   vault/persistence/choctotv.db exists → auto-restore before the DB opens.
 *
 * vault.zip is regenerated after every backup so a single file contains
 * the latest secrets, assets, AND player data. Re-deploying this zip
 * restores the server to its last known good state.
 */

const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const P    = require('../core/Paths');

const PERSIST_DIR  = path.join(P.vault, 'persistence');
const DB_BACKUP    = path.join(PERSIST_DIR, 'choctotv.db');
const CASH_SRC     = path.join(P.root, 'data', 'db', 'cashouts.json');
const CASH_BACKUP  = path.join(PERSIST_DIR, 'cashouts.json');
const STAMP_FILE   = path.join(PERSIST_DIR, 'last_backup.txt');
const VAULT_ZIP    = path.join(P.root, 'vault.zip');
const INTERVAL_MS  = 10 * 60 * 1000; // 10 minutes

let _db       = null;
let _timer    = null;
let _busy     = false;
let _shutdown = false;

// ── Restore: call BEFORE require('./db') if db file is missing ────────────────
function restore() {
  const dbFile = P.db;
  if (fs.existsSync(dbFile)) return false; // already exists — nothing to do

  if (!fs.existsSync(DB_BACKUP)) {
    console.log('[PersistenceGuard] No backup found — starting fresh');
    return false;
  }

  console.log('[PersistenceGuard] DB missing — restoring from vault/persistence/...');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  fs.copyFileSync(DB_BACKUP, dbFile);

  // Restore cashouts if present
  if (fs.existsSync(CASH_BACKUP) && !fs.existsSync(CASH_SRC)) {
    fs.mkdirSync(path.dirname(CASH_SRC), { recursive: true });
    fs.copyFileSync(CASH_BACKUP, CASH_SRC);
  }

  console.log('[PersistenceGuard] ✓ Player data restored from vault backup');
  return true;
}

// ── Backup: safe online DB copy + regenerate vault.zip ───────────────────────
async function backup(reason = 'scheduled') {
  if (_busy) return;
  _busy = true;
  const t0 = Date.now();

  try {
    fs.mkdirSync(PERSIST_DIR, { recursive: true });

    // Better-sqlite3 online backup (safe while DB is in use)
    if (_db) {
      await _db.backup(DB_BACKUP);
    } else if (fs.existsSync(P.db)) {
      fs.copyFileSync(P.db, DB_BACKUP);
    }

    // Cashout log
    if (fs.existsSync(CASH_SRC)) {
      fs.copyFileSync(CASH_SRC, CASH_BACKUP);
    }

    // Timestamp
    const stamp = new Date().toISOString();
    fs.writeFileSync(STAMP_FILE, `${stamp}  reason=${reason}\n`);

    // Regenerate vault.zip — includes persistence/ so data travels with vault
    await _regenVaultZip();

    const ms = Date.now() - t0;
    console.log(`[PersistenceGuard] Backup complete (${reason}) in ${ms}ms → vault.zip updated`);
  } catch (e) {
    console.error('[PersistenceGuard] Backup error:', e.message);
  } finally {
    _busy = false;
  }
}

// ── Regenerate vault.zip ──────────────────────────────────────────────────────
function _regenVaultZip() {
  return new Promise((resolve) => {
    // Write a temp zip, then rename over the existing one (atomic-ish)
    const tmp = VAULT_ZIP + '.tmp';
    execFile('zip', ['-r', '-q', tmp, 'vault'], { cwd: P.root }, (err) => {
      if (err) {
        console.warn('[PersistenceGuard] vault.zip regen failed:', err.message);
        try { fs.unlinkSync(tmp); } catch {}
      } else {
        try { fs.renameSync(tmp, VAULT_ZIP); } catch (e2) {
          // rename may fail cross-device; fall back to copy+delete
          try { fs.copyFileSync(tmp, VAULT_ZIP); fs.unlinkSync(tmp); } catch {}
        }
      }
      resolve();
    });
  });
}

// ── Init: attach to running app ───────────────────────────────────────────────
function init(db) {
  _db = db;

  // Periodic backup every 10 minutes
  _timer = setInterval(() => backup('10min'), INTERVAL_MS);
  if (_timer.unref) _timer.unref(); // don't keep process alive

  // Shutdown hooks — backup before exit
  const _shutdown = async (sig) => {
    if (_shutdown) return;
    _shutdown = true;
    clearInterval(_timer);
    console.log(`[PersistenceGuard] ${sig} — saving player data before shutdown...`);
    await backup(`shutdown:${sig}`);
  };

  process.once('SIGTERM', () => _shutdown('SIGTERM').then(() => process.exit(0)));
  process.once('SIGINT',  () => _shutdown('SIGINT') .then(() => process.exit(0)));
  process.once('beforeExit', () => backup('beforeExit'));

  console.log(`[PersistenceGuard] Active — backup every 10min, on shutdown, vault.zip auto-updated`);
  // Run an immediate backup so vault.zip is current on startup
  backup('startup');
}

// ── Status ────────────────────────────────────────────────────────────────────
function status() {
  try {
    const stamp = fs.existsSync(STAMP_FILE) ? fs.readFileSync(STAMP_FILE, 'utf8').trim() : 'never';
    const size  = fs.existsSync(DB_BACKUP)  ? fs.statSync(DB_BACKUP).size : 0;
    return { ok: true, lastBackup: stamp, dbSizeBytes: size, vaultZip: fs.existsSync(VAULT_ZIP) };
  } catch { return { ok: false }; }
}

module.exports = { restore, init, backup, status };
