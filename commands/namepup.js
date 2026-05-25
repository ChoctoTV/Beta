'use strict';
module.exports = {
  name:'namepup', aliases:['setfavname'], permissions:'viewer', cooldown:false,
  async execute(ctx) {
    const { userId, user, args, say, PupCore, db } = ctx;
    const name = args.join(' ').trim().slice(0, 24);
    if (!name) { say(`❌ @${user} usage: !namepup <name>`); return { ok:false }; }
    // Get the user's current fav pup mint address
    const state = PupCore.getCachedState(userId);
    const mint  = state?.favPupMint || null;
    if (!mint) { say(`❌ @${user} set a fav pup first: !setfav <mintAddress>`); return { ok:false }; }
    // Save name to pupcore (active session)
    const r = await PupCore.equip(userId, { displayName: name });
    if (!r?.ok) { say(`❌ @${user} ${r?.error || 'failed'}`); return { ok:false }; }
    // Also save to mint_names table — persists across all restarts and NFT changes
    try {
      db.prepare('INSERT INTO mint_names (mint, game_name, named_by) VALUES (?,?,?) ON CONFLICT(mint) DO UPDATE SET game_name=excluded.game_name, named_by=excluded.named_by, named_at=datetime(\'now\')').run(mint, name, userId);
    } catch {}
    say(`✅ @${user} fav pup named: ${name} 🐾`);
    return { ok:true };
  },
};
