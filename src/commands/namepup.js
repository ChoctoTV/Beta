'use strict';
// !namepup <name>              — name your current fav pup
// !namepup <MintAddress> <name> — name any pup by mint (pre-name your whole collection)
// Names are stored in mint_names keyed by mint address so they persist across
// every !setfav switch and restart.

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

module.exports = {
  name: 'namepup',
  requirePrefix: true,
  aliases: ['setfavname'],
  permissions: 'viewer',
  cooldown: false,

  async execute(ctx) {
    const { userId, user, args, say, PupCore, db } = ctx;
    if (!args.length) {
      say(`❌ @${user} usage: !namepup <name>  OR  !namepup <MintAddress> <name>`);
      return { ok: false };
    }

    let mint, name;

    // If first arg looks like a Solana mint address, use it explicitly
    if (MINT_RE.test(args[0])) {
      mint = args[0];
      name = args.slice(1).join(' ').trim().slice(0, 24);
      if (!name) {
        say(`❌ @${user} usage: !namepup <MintAddress> <name>`);
        return { ok: false };
      }
    } else {
      // No mint provided — use their current fav pup
      const state = PupCore.getCachedState(userId);
      mint = state?.favPupMint || null;
      if (!mint) {
        say(`❌ @${user} no fav pup equipped — use !setfav <MintAddress> first, or provide the mint: !namepup <MintAddress> <name>`);
        return { ok: false };
      }
      name = args.join(' ').trim().slice(0, 24);
    }

    // Save name to mint_names table (persists across restarts and NFT switches)
    try {
      db.prepare(`INSERT INTO mint_names (mint, game_name, named_by)
        VALUES (?,?,?)
        ON CONFLICT(mint) DO UPDATE
          SET game_name=excluded.game_name,
              named_by=excluded.named_by,
              named_at=datetime('now')`)
        .run(mint, name, userId);
    } catch (e) {
      say(`❌ @${user} failed to save name: ${e.message}`);
      return { ok: false };
    }

    // If naming the currently-equipped pup, also update the live session
    const state = PupCore.getCachedState(userId);
    if (state?.favPupMint === mint) {
      await PupCore.equip(userId, { displayName: name }).catch(() => {});
    }

    const shortMint = mint.slice(0, 6) + '...' + mint.slice(-4);
    say(`✅ @${user} pup [${shortMint}] named: ${name} 🐾`);
    return { ok: true };
  },
};
