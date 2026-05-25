'use strict';
module.exports = {
  name:'scrollsites', permissions:'streamer', cooldown:false,
  execute(ctx) {
    const { say, db } = ctx;
    const sites = db.prepare('SELECT url FROM scroll_sites').all().map(r=>r.url);
    say(sites.length ? `📺 ${sites.map(u=>new URL(u).hostname).join(' | ')}` : `📺 No scroll sites`);
    return { ok:true };
  },
};
