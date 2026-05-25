'use strict';
const db = require('../db');
function today() { return new Date().toISOString().slice(0,10); }
module.exports = {
  name:'gauntlet', permissions:'viewer', cooldown:false,
  execute(ctx) {
    const { userId, user, say, broadcast, isStreamer } = ctx;
    if (!isStreamer) {
      const row = db.prepare('SELECT date FROM gauntlet_daily WHERE user_id=?').get(userId);
      if (row?.date === today()) { say(`❌ @${user} one gauntlet per day — back tomorrow! 🏆`); return { ok:false }; }
      db.prepare("INSERT OR REPLACE INTO gauntlet_daily(user_id,date) VALUES(?,?)").run(userId, today());
    }
    say(`⚔️ @${user} called the GAUNTLET! Join with !battle in 60 seconds!`);
    broadcast({ type:'gauntlet_request', user, userId, pupId:Math.floor(Math.random()*1e6) });
    return { ok:true };
  },
};
