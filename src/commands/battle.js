'use strict';
module.exports = {
  name:'battle', permissions:'viewer', cooldown:false, strictCooldown:true,
  execute(ctx) {
    const { userId, user, say, broadcast } = ctx;
    broadcast({ type:'battle', user, userId, pupId:Math.floor(Math.random()*1e6) });
    say(`⚔️ @${user} joined Puppy Wars!`);
    return { ok:true };
  },
};
