'use strict';
/**
 * !purge all — streamer only. Waits for the cashout queue to fully clear,
 * then resets all balances, inventory, and game state to zero.
 * Used when moving from test (rydersbnc) to live (choctotv).
 */

let _purgeTimer = null;   // prevents duplicate pending purges

function executePurge(db, say) {
  try {
    // 1. Balances + inventory
    db.prepare('UPDATE balances  SET amount=0').run();
    db.prepare('UPDATE inventory SET sticks=0, balls=0, moons=0').run();
    // 2. Game state
    db.prepare('UPDATE chest     SET clicks=0, reset_at=NULL WHERE id=1').run();
    db.prepare('DELETE FROM lottery_tickets').run();
    db.prepare('DELETE FROM gbm_picks').run();
    db.prepare('DELETE FROM lurk_sessions').run();
    db.prepare('DELETE FROM gauntlet_scores').run();
    db.prepare('DELETE FROM gauntlet_daily').run();
    const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get()?.c || 0;
    say(`🧹 Purge complete — ${userCount} users reset to zero. Wallets, NFTs, config, and roles preserved.`);
  } catch (e) {
    say(`❌ Purge failed: ${e.message}`);
  }
  _purgeTimer = null;
}

module.exports = {
  name:'purge',
  requirePrefix: true, permissions:'streamer', cooldown:false,
  execute({ args, say, db }) {
    const sub = (args[0] || '').toLowerCase();

    if (sub !== 'all') {
      say('⚠️ !purge all — resets ALL balances & inventory once the cashout queue is empty. This cannot be undone.');
      return { ok:true };
    }

    if (_purgeTimer) {
      say('⏳ Purge already queued — waiting for cashouts to clear.');
      return { ok:true };
    }

    const pending = db.prepare('SELECT COUNT(*) as c FROM cashouts').get()?.c || 0;

    if (pending === 0) {
      // Queue already empty — purge immediately
      say('✅ Cashout queue is empty — purging now...');
      executePurge(db, say);
      return { ok:true };
    }

    // Cashouts are pending — wait and auto-purge when done
    say(`⏳ ${pending} cashout${pending > 1 ? 's' : ''} still pending — purge will trigger automatically once the queue is clear.`);

    _purgeTimer = setInterval(() => {
      const remaining = db.prepare('SELECT COUNT(*) as c FROM cashouts').get()?.c || 0;
      if (remaining > 0) return;          // still waiting
      clearInterval(_purgeTimer);
      say('✅ Cashout queue cleared — executing purge now...');
      executePurge(db, say);
    }, 5000);   // poll every 5 seconds

    return { ok:true };
  },
};
