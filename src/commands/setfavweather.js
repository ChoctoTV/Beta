'use strict';
const WEATHERS = ['sunny','cloudy','rainy','stormy','snowy','windy'];
module.exports = {
  name:'setfavweather', permissions:'viewer', cooldown:false,
  async execute(ctx) {
    const { userId, user, args, say, PupCore } = ctx;
    const w = (args[0]||'').toLowerCase();
    if (!WEATHERS.includes(w)) { say(`❌ @${user} choose: ${WEATHERS.join(', ')}`); return { ok:false }; }
    const r = await PupCore.equip(userId, { favWeather:w });
    if (!r?.ok) { say(`❌ @${user} ${r?.error||'failed'}`); return { ok:false }; }
    say(`✅ @${user} fav weather: ${w} (+10% bonus when matched)`);
    return { ok:true };
  },
};
