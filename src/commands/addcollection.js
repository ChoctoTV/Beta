'use strict';
module.exports = {
  name:'addcollection',
  requirePrefix: true, aliases:['removecollection','collections'], permissions:'streamer', cooldown:false,
  async execute(ctx) {
    const { cmd, args, say, db, broadcast, PupCore } = ctx;
    if (cmd==='collections') {
      const list = db.prepare('SELECT address FROM collections').all().map(r=>r.address);
      say(list.length ? `📋 ${list.length} approved: ${list.map(a=>a.slice(0,6)+'...').join(', ')}` : `📋 No collections (any NFT works)`);
      return { ok:true };
    }
    const addr = args[0]||'';
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) { say(`❌ Invalid Solana address`); return { ok:false }; }
    if (cmd==='addcollection') {
      db.prepare('INSERT OR IGNORE INTO collections(address) VALUES(?)').run(addr);
      PupCore.addCollection(addr).catch(()=>{});
      say(`✅ Collection added: ${addr.slice(0,6)}...${addr.slice(-4)}`);
    } else {
      db.prepare('DELETE FROM collections WHERE address=?').run(addr);
      PupCore.removeCollection(addr).catch(()=>{});
      say(`✅ Collection removed`);
    }
    return { ok:true };
  },
};
