'use strict';
module.exports = {
  name:'addcoin', aliases:['removecoin','coins'], permissions:'streamer', cooldown:false,
  execute(ctx) {
    const { cmd, args, say, db, broadcast } = ctx;
    const getCoins = () => db.prepare('SELECT sym,id,color FROM coins ORDER BY added_at').all();
    if (cmd==='coins') {
      const list = getCoins();
      say(list.length ? `💰 Ticker: ${list.map(c=>c.sym).join(', ')}` : `💰 No coins — !addcoin SYM id`);
      return { ok:true };
    }
    if (cmd==='removecoin') {
      const sym=(args[0]||'').toUpperCase();
      if (!sym) { say(`❌ !removecoin <SYM>`); return { ok:false }; }
      if (!db.prepare('DELETE FROM coins WHERE sym=?').run(sym).changes) { say(`❌ ${sym} not found`); return { ok:false }; }
      broadcast({ type:'coins_update', coins:getCoins() });
      say(`✅ Removed ${sym}`);
      return { ok:true };
    }
    const sym=(args[0]||'').toUpperCase(), id=args[1]||'';
    if (!sym||!id) { say(`❌ !addcoin <SYM> <id>`); return { ok:false }; }
    try { db.prepare('INSERT INTO coins(sym,id) VALUES(?,?)').run(sym,id); }
    catch { say(`❌ ${sym} already in ticker`); return { ok:false }; }
    broadcast({ type:'coins_update', coins:getCoins() });
    say(`✅ Added ${sym} to ticker`);
    return { ok:true };
  },
};
