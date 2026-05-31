'use strict';
// !setfav <mintAddress>  — set your favourite Choctonaut NFT.
// Once per day per user. Mods/devs/streamer bypass the cooldown.
// Bumped timeout to 30s — Helius DAS verification can be slow.

const MINT_ADDR  = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SKIP       = ['mintaddress', 'mint', 'address', 'addr', 'nft'];
const TIMEOUT_MS = 30000;

// Track last-used timestamp per userId (resets at midnight)
const _lastUsed = new Map();

function todayKey() {
  return new Date().toISOString().slice(0, 10); // "2026-05-30"
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(
      `NFT verification timed out after ${ms / 1000}s — Helius may be slow, please try again`
    )), ms);
    promise.then(v => { clearTimeout(t); resolve(v); },
                 e => { clearTimeout(t); reject(e); });
  });
}

module.exports = {
  name: 'setfav',
  permissions: 'viewer',
  cooldown: false,

  async execute(ctx) {
    const { userId, user, args, say, PupCore, db, isMod, isDev, isStreamer } = ctx;

    // ── One per day (mods/devs/streamer bypass) ─────────────────────────────
    if (!isMod && !isDev && !isStreamer) {
      const key = `${userId}:${todayKey()}`;
      if (_lastUsed.get(userId) === key) {
        say(`⏳ @${user} you can only change your fav pup once per day. Come back tomorrow!`);
        return { ok: false };
      }
    }

    const cleaned = args.filter(a => !SKIP.includes(a.toLowerCase()));
    const mint    = cleaned.find(a => MINT_ADDR.test(a)) || '';

    if (!mint) {
      say(`❌ @${user} usage: !setfav <MintAddress>  — paste the mint address of your Choctonaut`);
      return { ok: false };
    }

    say(`🔍 @${user} verifying ownership... (this can take up to 30s)`);

    let r;
    try {
      // Look up any name already stored for this mint — name follows the NFT, not the user
      const stored = db.prepare('SELECT game_name FROM mint_names WHERE mint=?').get(mint);
      r = await withTimeout(
        PupCore.equip(userId, {
          mintAddress: mint,
          ...(stored ? { displayName: stored.game_name } : {}),
        }),
        TIMEOUT_MS
      );
    } catch (e) {
      // Connection or timeout failure — don't burn their daily use
      say(`❌ @${user} couldn't reach the NFT verification service — please try again in a few minutes.`);
      return { ok: false, error: e.message };
    }

    if (r === null || r === undefined) {
      // PupCore returned nothing — also a connection issue
      say(`❌ @${user} verification service didn't respond — please try again in a few minutes.`);
      return { ok: false };
    }

    if (!r?.ok) {
      // Service responded but ownership check failed — this is a real rejection
      const reason = r?.error || 'could not verify ownership — make sure this NFT is in the wallet you linked with !setwallet';
      say(`❌ @${user} ${reason}`);
      return { ok: false };
    }

    // Record usage for the day-limit
    // Record usage for the day-limit
    _lastUsed.set(userId, `${userId}:${todayKey()}`);

    // Check for ownership transfer — new owner loses half the pup's levels
    let tradeMsg = '';
    try {
      const PupXP    = require('../economy/pupXP');
      const transfer = PupXP.transferXP(db, mint, userId);
      if (transfer) {
        if (transfer.oldLevel >= 99) {
          tradeMsg = ` (Lvl 99 — max level, no XP lost on trade! 🏆)`;
        } else {
          tradeMsg = ` (traded — ${transfer.pctLost}% XP lost, Lvl ${transfer.oldLevel}→${transfer.newLevel})`;
        }
      }
    } catch {}

    const nameRow  = db.prepare('SELECT game_name FROM mint_names WHERE mint=?').get(mint);
    const nameInfo = nameRow ? ` — "${nameRow.game_name}"` : ' (use !namepup to name this pup)';
    say(`✅ @${user} fav pup set!${nameInfo}${tradeMsg} Walk with !walk to show it off 🐾`);
    say(`✅ @${user} fav pup set!${nameInfo} Walk with !walk to show it off 🐾`);
    return { ok: true };
  },
};
