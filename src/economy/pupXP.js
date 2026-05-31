'use strict';
/**
 * PupXP — two separate XP ladders
 *
 * NFT LADDER  (K=268,000)   keyed by mint address
 *   Target: level 99 after 1 year × 8hr/day active grinding
 *   Rate: ~60 actions/hr, avg 1.5 XP/action = 90 XP/hr = 720 XP/day = 262,800/yr
 *
 * USER LADDER (K=1,006,000) keyed by userId
 *   Target: level 99 after 5 years × 6hr/day active grinding
 *   Rate: ~60 actions/hr, avg 1.5 XP/action = 90 XP/hr = 540 XP/day = 985,500/5yr
 *
 * XP per game action:
 *   fav pup equipped  → 2 XP
 *   base pup          → 1 XP
 *   subscriber bonus  → +ceil(base × 0.25) extra
 *   lurk              → 1 XP per 10 min (user ladder only)
 *
 * Hourly passive:  userLevel + nftLevel  Choctobits paid to each user
 * XP per action:    1 XP (active play, any game, any pup)
 *                 + 1 bonus XP every 5th action for subscribers (caller tracks)
 * Lurk XP:         1 XP per 30 minutes (33% of casual active rate)
 *
 * Trade penalty (on !setfav with new owner):
 *   Level 99 → 0% XP loss (keeps everything — max level is permanent)
 *   Level 98 → 1% XP loss  (1 level below 99)
 *   Level 97 → 2% XP loss  (2 levels below 99)
 *   Level  N → (99-N)% XP loss
 *   Level  1 → 98% XP loss
 *   Formula: xpKept = floor(xp × (level + 1) / 100)
 */

const K_NFT  = 180000;  // 1 year × 8hr/day active grinding @ 1 XP/action, 60 actions/hr
const K_USER = 670000;  // 5 years × 6hr/day active grinding @ 1 XP/action, 60 actions/hr
const MAX    = 99;

// ── XP math ──────────────────────────────────────────────────────────────────
function xpToNext(level, K) {
  if (level >= MAX) return Infinity;
  return Math.max(1, Math.floor(K * (2 * level - 1) / (MAX * MAX)));
}
function totalXpForLevel(level, K) {
  let t = 0; for (let i = 1; i < level; i++) t += xpToNext(i, K); return t;
}
function levelFromXp(xp, K) {
  let level = 1, spent = 0;
  while (level < MAX) {
    const need = xpToNext(level, K);
    if (spent + need > xp) break;
    spent += need; level++;
  }
  return level;
}
function xpInLevel(xp, K) { return xp - totalXpForLevel(levelFromXp(xp, K), K); }

// ── Convenience wrappers ──────────────────────────────────────────────────────
const nftLevel  = xp => levelFromXp(xp, K_NFT);
const userLevel = xp => levelFromXp(xp, K_USER);

// ── XP amount helpers ─────────────────────────────────────────────────────────
/**
 * XP per active game action.
 * Always 1 XP — fav pup and sub bonuses apply to Choctobits, not XP.
 * Subscribers get +1 bonus XP every 5th game (tracked by caller via subXpCounter).
 * Lurk XP is awarded separately via a 30-minute timer (not through this function).
 */
function calcXP(_usesFavPup, _isSub) {
  return 1;  // 1 XP per game action, always
}

// ── DB helpers — NFT ─────────────────────────────────────────────────────────
function _ensureNft(db, mint) {
  db.prepare('INSERT OR IGNORE INTO pup_xp (mint) VALUES (?)').run(mint);
  return db.prepare('SELECT xp, last_owner FROM pup_xp WHERE mint=?').get(mint);
}

function addXP(db, mint, amount) {
  if (!mint || amount <= 0) return null;
  const row    = _ensureNft(db, mint);
  const prevXp = row.xp || 0;
  const newXp  = prevXp + amount;
  const prev   = nftLevel(prevXp);
  const curr   = nftLevel(newXp);
  db.prepare('UPDATE pup_xp SET xp=?, stored_level=?, updated_at=datetime(\'now\') WHERE mint=?').run(newXp, curr, mint);
  return { xp: newXp, prevLevel: prev, level: curr, levelUp: curr > prev };
}

function transferXP(db, mint, newOwner) {
  if (!mint) return null;
  const row = _ensureNft(db, mint);
  if (row.last_owner === newOwner) {
    db.prepare('UPDATE pup_xp SET last_owner=? WHERE mint=?').run(newOwner, mint);
    return null;  // same owner re-equipping — no penalty
  }

  const oldXp    = row.xp || 0;
  const oldLevel = nftLevel(oldXp);

  // ── Trade penalty: 1% XP loss per level below 99 ─────────────────────────
  // Level 99 → 0% loss (keeps all XP — max level is earned and kept)
  // Level 98 → 1% loss
  // Level 97 → 2% loss
  // Level  1 → 98% loss
  // Formula: xpKept = floor(xp × (level + 1) / 100)
  const levelsBelow = MAX - oldLevel;            // 0 at level 99, 98 at level 1
  const keepPct     = (100 - levelsBelow) / 100; // 1.00 at lvl99, 0.02 at lvl1
  const newXp       = Math.floor(oldXp * keepPct);
  const newLevel    = nftLevel(newXp);

  db.prepare("UPDATE pup_xp SET xp=?, stored_level=?, last_owner=?, updated_at=datetime('now') WHERE mint=?")
    .run(newXp, newLevel, newOwner, mint);

  return {
    oldLevel,
    newLevel,
    oldXp,
    newXp,
    xpLost:   oldXp - newXp,
    pctLost:  Math.round(levelsBelow),  // % XP lost = levels below 99
  };
}

function getStats(db, mint) {
  if (!mint) return null;
  const row = _ensureNft(db, mint);
  const xp  = row.xp || 0;
  const lvl = nftLevel(xp);
  const inL = xpInLevel(xp, K_NFT);
  const toN = xpToNext(lvl, K_NFT);
  return { xp, level: lvl, maxLevel: MAX, xpInLevel: inL, xpToNext: toN,
           pct: lvl >= MAX ? 100 : Math.floor((inL / toN) * 100) };
}

// ── DB helpers — User ─────────────────────────────────────────────────────────
function _ensureUser(db, userId) {
  db.prepare('INSERT OR IGNORE INTO user_xp (user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT xp FROM user_xp WHERE user_id=?').get(userId);
}

function addUserXP(db, userId, amount) {
  if (!userId || amount <= 0) return null;
  const row    = _ensureUser(db, userId);
  const prevXp = row.xp || 0;
  const newXp  = prevXp + amount;
  const prev   = userLevel(prevXp);
  const curr   = userLevel(newXp);
  db.prepare('UPDATE user_xp SET xp=?, updated_at=datetime(\'now\') WHERE user_id=?').run(newXp, userId);
  return { xp: newXp, prevLevel: prev, level: curr, levelUp: curr > prev };
}

function getUserStats(db, userId) {
  if (!userId) return null;
  const row = _ensureUser(db, userId);
  const xp  = row.xp || 0;
  const lvl = userLevel(xp);
  const inL = xpInLevel(xp, K_USER);
  const toN = xpToNext(lvl, K_USER);
  return { xp, level: lvl, maxLevel: MAX, xpInLevel: inL, xpToNext: toN,
           pct: lvl >= MAX ? 100 : Math.floor((inL / toN) * 100) };
}


// ── Dynamic rarity — based on how many NFTs share the same level ─────────────
// Fewer NFTs at a given level = rarer. Thresholds:
//   1-2  at this level → legendary
//   3-5               → epic
//   6-15              → rare
//   16+               → common
function getDynamicRarity(db, level) {
  try {
    const row = db.prepare('SELECT COUNT(*) AS cnt FROM pup_xp WHERE stored_level=?').get(level);
    const cnt = row?.cnt || 0;
    if (cnt <= 2)  return 'legendary';
    if (cnt <= 5)  return 'epic';
    if (cnt <= 15) return 'rare';
    return 'common';
  } catch { return 'common'; }
}

/** Returns dynamic rarity if user has fav pup equipped, otherwise falls back to sprite rarity */
function getEffectiveRarity(db, userId, PupCore, fallbackRarity) {
  try {
    const state = PupCore.getCachedState(userId);
    if (!state?.favPupMint) return fallbackRarity;
    const row   = db.prepare('SELECT stored_level FROM pup_xp WHERE mint=?').get(state.favPupMint);
    const level = row?.stored_level || nftLevel(db.prepare('SELECT xp FROM pup_xp WHERE mint=?').get(state.favPupMint)?.xp || 0);
    return getDynamicRarity(db, level);
  } catch { return fallbackRarity; }
}

module.exports = {
  addXP, transferXP, getStats,
  addUserXP, getUserStats, calcXP,
  getDynamicRarity, getEffectiveRarity,
  levelFromXp, xpToNext, totalXpForLevel, MAX, K_NFT, K_USER,
};
