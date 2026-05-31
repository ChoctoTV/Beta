'use strict';
module.exports = {
  name:'lastannounce',
  requirePrefix: true, aliases:['lastann'], permissions:'mod', cooldown:false,
  execute({ say, db }) {
    try {
      const row = db.prepare(
        "SELECT text, created_at FROM announcements ORDER BY id DESC LIMIT 1"
      ).get();
      if (!row) { say('📢 No announcements yet.'); return { ok:true }; }
      say(`📢 Last announcement: "${row.text}" (${row.created_at})`);
    } catch (e) {
      say('📢 Could not retrieve last announcement.');
    }
    return { ok:true };
  },
};
