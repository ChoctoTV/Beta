'use strict';
module.exports = {
  name:'setfav', permissions:'viewer', cooldown:false,
  async execute(ctx) {
    const { userId, user, args, say, PupCore, db } = ctx;
    const mint = args[0]||'';
    if (!mint) { say(`❌ @${user} usage: !setfav <mintAddress>`); return { ok:false }; }
    say(`🔍 @${user} verifying ownership...`);
    // Check if this mint already has a game-side name saved from a previous equip
    const mintName = db.prepare('SELECT game_name FROM mint_names WHERE mint=?').get(mint);
    const r = await PupCore.equip(userId, {
      mintAddress: mint,
      // Pass the saved game name if it exists — carries over if this NFT has no on-chain name
      ...(mintName ? { displayName: mintName.game_name } : {}),
    });
    if (!r?.ok) { say(`❌ @${user} ${r?.error || 'verification failed — check you own this NFT'}`); return { ok:false }; }
    const nameInfo = mintName ? ` (${mintName.game_name})` : '';
    say(`✅ @${user} fav pup set!${nameInfo} Walk with !walk 🐾`);
    return { ok:true };
  },
};
