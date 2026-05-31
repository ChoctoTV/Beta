'use strict';
/**
 * !nft — in-game NFT and player stat adjustments (streamer/dev only)
 *
 * !nft <@user> level <N>        set fav NFT to level N (adjusts XP to match)
 * !nft <@user> reset            set fav NFT back to level 1
 * !nft <@user> wipe             zero out fav NFT XP entirely
 * !nft <@user> xp <N>           set fav NFT raw XP to exact value
 * !nft <@user> userlevel <N>    set player XP ladder to level N
 * !nft <@user> userreset        reset player XP to zero
 * !nft <@user> info             show current stats (no chat spam — logs only)
 *
 * All successful operations respond only with: confirmed
 */
const PupXP = require('../economy/pupXP');

function findUser(db, nameOrId) {
  const clean = nameOrId.replace('@','').toLowerCase();
  // Try by id first, then by display name (case-insensitive)
  return db.prepare("SELECT id, display FROM users WHERE lower(id)=? OR lower(display)=? LIMIT 1")
           .get(clean, clean) || null;
}

function getMint(db, PupCore, userId) {
  // Try live cache first, fall back to DB
  const cached = PupCore?.getCachedState?.(userId);
  if (cached?.favPupMint) return cached.favPupMint;
  const row = db.prepare("SELECT mint FROM user_pups WHERE user_id=? AND is_fav=1 LIMIT 1").get(userId);
  return row?.mint || null;
}

module.exports = {
  name: 'nft',
  requirePrefix: true,
  permissions: 'streamer',
  cooldown: false,

  execute(ctx) {
    const { args, say, db, PupCore } = ctx;
    if (args.length < 2) {
      say('Usage: !nft @user level/reset/wipe/xp/userlevel/userreset/info <value>');
      return { ok:false };
    }

    const target = args[0].replace('@','').toLowerCase();
    const sub    = args[1].toLowerCase();
    const val    = args[2] ? parseInt(args[2]) : null;

    const user = findUser(db, target);
    if (!user) { say(`❌ User "${target}" not found in DB`); return { ok:false }; }
    const userId = user.id;

    // ── NFT operations ────────────────────────────────────────────────────────
    const nftOps = ['level','reset','wipe','xp','info'];
    if (nftOps.includes(sub)) {
      const mint = getMint(db, PupCore, userId);
      if (!mint && sub !== 'info') {
        say(`❌ @${user.display} has no fav NFT set (!setfav required first)`);
        return { ok:false };
      }

      if (sub === 'info') {
        const nft  = mint ? PupXP.getStats(db, mint) : null;
        const uXP  = PupXP.getUserStats(db, userId);
        const line = mint
          ? `NFT Lv${nft?.level} (${nft?.xp} XP, ${nft?.pct}%) | Player Lv${uXP?.level} (${uXP?.xp} XP)`
          : `No fav NFT | Player Lv${uXP?.level} (${uXP?.xp} XP)`;
        say(`[${user.display}] ${line}`);
        return { ok:true };
      }

      if (sub === 'level') {
        if (!val || val < 1 || val > 99) { say('❌ Level must be 1–99'); return { ok:false }; }
        const targetXp = PupXP.totalXpForLevel(val, PupXP.K_NFT);
        db.prepare("UPDATE pup_xp SET xp=?, stored_level=?, updated_at=datetime('now') WHERE mint=?")
          .run(targetXp, val, mint);
        say('confirmed'); return { ok:true };
      }

      if (sub === 'reset') {
        db.prepare("UPDATE pup_xp SET xp=0, stored_level=1, updated_at=datetime('now') WHERE mint=?")
          .run(mint);
        say('confirmed'); return { ok:true };
      }

      if (sub === 'wipe') {
        db.prepare("DELETE FROM pup_xp WHERE mint=?").run(mint);
        say('confirmed'); return { ok:true };
      }

      if (sub === 'xp') {
        if (isNaN(val) || val < 0) { say('❌ XP must be ≥ 0'); return { ok:false }; }
        const level = PupXP.levelFromXp(val, PupXP.K_NFT);
        db.prepare("UPDATE pup_xp SET xp=?, stored_level=?, updated_at=datetime('now') WHERE mint=?")
          .run(val, level, mint);
        say('confirmed'); return { ok:true };
      }
    }

    // ── Player XP operations ──────────────────────────────────────────────────
    if (sub === 'userlevel') {
      if (!val || val < 1 || val > 99) { say('❌ Level must be 1–99'); return { ok:false }; }
      const targetXp = PupXP.totalXpForLevel(val, PupXP.K_USER);
      db.prepare("INSERT OR IGNORE INTO user_xp (user_id) VALUES (?)").run(userId);
      db.prepare("UPDATE user_xp SET xp=?, updated_at=datetime('now') WHERE user_id=?")
        .run(targetXp, userId);
      say('confirmed'); return { ok:true };
    }

    if (sub === 'userreset') {
      db.prepare("DELETE FROM user_xp WHERE user_id=?").run(userId);
      say('confirmed'); return { ok:true };
    }

    say(`❌ Unknown sub-command "${sub}". Try: level reset wipe xp userlevel userreset info`);
    return { ok:false };
  },
};
