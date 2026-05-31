'use strict';
/**
 * Paths.js — Single source of truth for all file paths.
 *
 * VAULT (gitignored) — drop vault.zip here; firststart.sh extracts it:
 *   vault/secret.txt       → production credentials
 *   vault/testzone.txt     → test channel credentials
 *   vault/Secret.template.txt
 *   vault/ticker.txt       → scrolling ticker content
 *   vault/announcements.txt
 *   vault/.env             → generated from secret/testzone by start.sh
 *   vault/teller.json      → live cashout config (optional)
 *   vault/music/           → audio tracks
 *   vault/sprites/         → pup sprite PNGs + sprites_meta.json
 *   vault/billboard/       → billboard images (main/ ads/ review/)
 *   vault/nobg/            → cached background-removed NFT images
 */
const path = require('path');
const { mkdirSync } = require('fs');

const ROOT  = path.resolve(__dirname, '..', '..'); // src/core → src → root
const VAULT = path.join(ROOT, 'vault');

const P = {
  root:      ROOT,
  src:       path.join(ROOT, 'src'),

  // ── Vault (gitignored — all user-maintained content) ─────────────────────
  vault:     VAULT,
  dotenv:    path.join(VAULT, '.env'),
  secret:    path.join(VAULT, 'secret.txt'),
  testzone:  path.join(VAULT, 'testzone.txt'),
  template:  path.join(VAULT, 'Secret.template.txt'),
  ticker:    path.join(VAULT, 'ticker.txt'),
  announce:  path.join(VAULT, 'announcements.txt'),
  tellerCfg: path.join(VAULT, 'teller.json'),

  // ── Runtime assets inside vault ───────────────────────────────────────────
  music:     path.join(VAULT, 'music'),
  sprites:   path.join(VAULT, 'sprites'),
  billboard: path.join(VAULT, 'billboard'),
  nobg:      path.join(VAULT, 'nobg'),

  // ── Pup assets (inside assets/, which is served under /assets/ URL) ─────
  pups:        path.join(ROOT, 'assets', 'pups'),      // pups/{rarity}/{name}.png
  spriteMeta:  path.join(ROOT, 'assets', 'sprites_meta.json'),
  itemsApi:    path.join(ROOT, 'assets', 'itemsApi.js'),
  cpImages:    path.join(ROOT, 'assets', 'channel point images'),
  otherAssets: path.join(ROOT, 'assets', 'other assets'),

  // ── App config defaults (checked into git, overridable by vault/) ────────
  configDir:   path.join(ROOT, 'config'),
  tickerDef:   path.join(ROOT, 'config', 'ticker.txt'),
  announceDef: path.join(ROOT, 'config', 'announcements.txt'),

  // ── Runtime data (writable, not in git) ───────────────────────────────────
  data:      path.join(ROOT, 'data'),
  db:        path.join(ROOT, 'data', 'db', 'choctotv.db'),
  logs:      path.join(ROOT, 'data', 'logs'),
  sessions:  path.join(ROOT, 'data', 'logs', 'sessions'),

  // ── Overlay (browser, served as static) ───────────────────────────────────
  overlay:   path.join(ROOT, 'overlay'),
};

// Ensure critical directories exist on first require
[
  path.dirname(P.db),
  P.logs, P.sessions,
  VAULT,
  P.nobg,
  path.join(P.billboard, 'main'),
  path.join(P.billboard, 'ads'),
  path.join(P.billboard, 'review'),
].forEach(d => { try { mkdirSync(d, { recursive:true }); } catch {} });

module.exports = P;
