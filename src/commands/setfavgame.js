'use strict';
const GAMES = ['walk','toss','throw','dig','fish'];
module.exports = {
  name:'setfavgame', permissions:'viewer', cooldown:false,
  async execute(ctx) {
    const { userId, user, args, say, PupCore } = ctx;
    const g = (args[0]||'').toLowerCase();
    if (!GAMES.includes(g)) { say(`❌ @${user} choose: ${GAMES.join(', ')}`); return { ok:false }; }
    const r = await PupCore.equip(userId, { favGame:g });
    if (!r?.ok) { say(`❌ @${user} ${r?.error||'failed'}`); return { ok:false }; }
    say(`✅ @${user} fav game: ${g} (+10% bonus when played)`);
    return { ok:true };
  },
};
