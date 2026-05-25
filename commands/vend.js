'use strict';
/**
 * !vend <item> [n|all]   — sell inventory items for ChoctoBits
 * !vend all              — sell everything (sticks → balls → moons, all at once)
 *
 * Items: sticks (🪵), balls (🎾), moons (🌙)
 * Rates come from config: vend_sticks_rate, vend_balls_rate, vend_moons_rate
 */
module.exports = {
  name:'vend', aliases:['sell'], permissions:'viewer', cooldown:5,
  execute(ctx) {
    const { userId, user, say, cfg, args, Inventory, Balance } = ctx;

    const ITEMS = {
      sticks: { key:'sticks', icon:'🪵', rateKey:'vend_sticks_rate' },
      balls:  { key:'balls',  icon:'🎾', rateKey:'vend_balls_rate'  },
      moons:  { key:'moons',  icon:'🌙', rateKey:'vend_moons_rate'  },
    };

    const inv  = Inventory.get(userId);
    const sub  = (args[0] || '').toLowerCase();
    const qty  = (args[1] || '').toLowerCase();

    // ── Show rates if no args ─────────────────────────────────────────────────
    if (!sub) {
      const rates = Object.values(ITEMS)
        .map(i => `${i.icon}=${cfg(i.rateKey)}🍫`).join(' | ');
      const totals = Object.values(ITEMS)
        .map(i => `${inv[i.key]}${i.icon}`).join(' · ');
      say(`🏪 @${user} Rates: ${rates} | Your stock: ${totals} — !vend <sticks|balls|moons> [n|all]`);
      return { ok:true };
    }

    // ── !vend all — sell everything ───────────────────────────────────────────
    if (sub === 'all' && !qty) {
      const results = [];
      let totalEarned = 0;
      for (const item of Object.values(ITEMS)) {
        const have = inv[item.key];
        if (have <= 0) continue;
        const earned = have * cfg(item.rateKey);
        Inventory.add(userId, { [item.key]: -have }, 'vend');
        Balance.add(userId, earned, 'vend');
        totalEarned += earned;
        results.push(`${have}${item.icon} → +${earned}🍫`);
      }
      if (!results.length) { say(`❌ @${user} nothing to vend!`); return { ok:false }; }
      say(`🏪 @${user} sold everything! ${results.join(', ')} | Total: +${totalEarned}🍫 | Balance: ${Balance.get(userId)}🍫`);
      return { ok:true };
    }

    // ── !vend <item> [n|all] ──────────────────────────────────────────────────
    // Allow "!vend all sticks" and "!vend sticks all" interchangeably
    let itemKey = sub, amtArg = qty;
    if (sub === 'all' && ITEMS[qty]) { itemKey = qty; amtArg = 'all'; }

    const item = ITEMS[itemKey];
    if (!item) {
      say(`❌ @${user} unknown item "${sub}" — try: sticks | balls | moons`);
      return { ok:false };
    }

    const have = inv[item.key];
    if (have <= 0) { say(`❌ @${user} you have no ${item.icon} to vend!`); return { ok:false }; }

    const isAll = amtArg === 'all';
    const want  = isAll ? have : Math.max(1, parseInt(amtArg, 10) || 1);
    const n     = Math.min(want, have);
    const rate  = cfg(item.rateKey);
    const earned = n * rate;

    Inventory.add(userId, { [item.key]: -n }, 'vend');
    Balance.add(userId, earned, 'vend');

    const remaining = have - n;
    say(
      `🏪 @${user} sold ${n}${item.icon} for +${earned}🍫` +
      (remaining > 0 ? ` (${remaining}${item.icon} left)` : ' (all sold)') +
      ` | Balance: ${Balance.get(userId)}🍫`
    );
    return { ok:true };
  },
};
