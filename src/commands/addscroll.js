'use strict';
module.exports = {
  name:'addscroll',
  requirePrefix: true, permissions:'streamer', cooldown:false,
  execute(ctx) {
    const { args, say, db, broadcast } = ctx;
    const url = args[0]||'';
    try { new URL(url); } catch { say(`❌ Invalid URL`); return { ok:false }; }
    db.prepare('INSERT OR IGNORE INTO scroll_sites(url) VALUES(?)').run(url);
    const sites = db.prepare('SELECT url FROM scroll_sites ORDER BY added_at').all().map(r=>r.url);
    broadcast({ type:'scrollsites', sites });
    say(`✅ Added: ${new URL(url).hostname} (${sites.length} total)`);
    return { ok:true };
  },
};
