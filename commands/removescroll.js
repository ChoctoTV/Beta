'use strict';
module.exports = {
  name:'removescroll', permissions:'streamer', cooldown:false,
  execute(ctx) {
    const { args, say, db, broadcast } = ctx;
    const url = args[0]||'';
    try { new URL(url); } catch { say(`❌ Invalid URL`); return { ok:false }; }
    db.prepare('DELETE FROM scroll_sites WHERE url=?').run(url);
    const sites = db.prepare('SELECT url FROM scroll_sites ORDER BY added_at').all().map(r=>r.url);
    broadcast({ type:'scrollsites', sites });
    say(`✅ Removed. ${sites.length} remaining.`);
    return { ok:true };
  },
};
