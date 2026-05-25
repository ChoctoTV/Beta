'use strict';
// Chest game — overlay expects: chest_lick (each click), chest_new (after pop)
const _licks = new Map();
const SpriteManager = require('../core/SpriteManager');
// Lick count by rarity (common=1 … legendary=4)
const RARITY_LICKS = { common:1, uncommon:1, rare:2, epic:3, legendary:4 };
module.exports = {
  name:'lick', permissions:'viewer', cooldown:true,
  execute(ctx) {
    const { userId, user, say, db, broadcast, Balance, cfg } = ctx;
    // Ensure chest table exists (no migration needed — self-creating)
    db.prepare(`CREATE TABLE IF NOT EXISTS chest(
      id INTEGER PRIMARY KEY, lock_target INTEGER NOT NULL,
      clicks INTEGER NOT NULL DEFAULT 0, reset_at TEXT
    )`).run();
    let chest = db.prepare('SELECT id,lock_target,clicks FROM chest WHERE id=1').get();
    if (!chest) {
      const t = Math.floor(cfg('chest_min_lock') + Math.random()*(cfg('chest_max_lock')-cfg('chest_min_lock')));
      db.prepare("INSERT OR IGNORE INTO chest(id,lock_target,clicks) VALUES(1,?,0)").run(t);
      chest = db.prepare('SELECT id,lock_target,clicks FROM chest WHERE id=1').get();
      broadcast({ type:'chest_new', lock:chest.lock_target });
    }
    _licks.set(userId, (_licks.get(userId)||0)+1);
// Pick a random pup — rarity determines lick power
    const pup = SpriteManager.pickRandom();
    const lickPow = RARITY_LICKS[pup.rarity] || 1;
    const clicks = Math.min(lickPow, chest.lock_target - chest.clicks);
    const newClicks = chest.clicks + clicks;
    const remaining = chest.lock_target - newClicks;
    // Broadcast with pup info so overlay can animate the right sprite running to jar
    broadcast({ type:'chest_lick', user, clicks:newClicks, lock:remaining,
      sprite:pup.name, rarity:pup.rarity });
    if (remaining <= 0) {
      // Pop — pay lickers by click count
      const sorted = [..._licks.entries()].sort((a,b)=>b[1]-a[1]);
      for (const [uid, cnt] of sorted) Balance.add(uid, cnt, uid);
      const top = sorted.slice(0,5).map(([uid,cc])=>`@${uid}+${cc}`).join(' ');
      say(`🥜 The peanut butter jar popped open! ${top} 🍫`);
      const newTarget = Math.floor(cfg('chest_min_lock') + Math.random()*(cfg('chest_max_lock')-cfg('chest_min_lock')));
      db.prepare("UPDATE chest SET clicks=0,lock_target=?,reset_at=datetime('now') WHERE id=1").run(newTarget);
      _licks.clear();
      // chest_new resets overlay chest display
      broadcast({ type:'chest_new', lock:newTarget });
    } else {
      db.prepare('UPDATE chest SET clicks=? WHERE id=1').run(newClicks);
      say(`👅 @${user} gave the jar ${clicks > 1 ? clicks+' licks' : 'a lick'}!`);
    }
    return { ok:true };
  },
};
