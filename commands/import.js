'use strict';
// !import @user bits,sticks,balls,moons  — streamer only (for Firebot integration)
// Example: !import @RydersBnC 1230,322,14,4
module.exports = {
  name:'import', permissions:'streamer', cooldown:false,
  execute({ args, say, Balance, Inventory }) {
    // Parse args: !import @user 1230,322,14,4
    const rawUser = (args[0] || '').replace(/^@/, '').toLowerCase().trim();
    const rawNums = (args[1] || args.slice(1).join('').replace(/\s/g,'')).split(',');

    if (!rawUser) {
      say('❌ Usage: !import @user bits,sticks,balls,moons');
      return { ok:false };
    }

    const [bits=0, sticks=0, balls=0, moons=0] = rawNums.map(n => Math.max(0, parseInt(n,10)||0));

    // Apply to inventory
    if (bits   > 0) Balance.add(rawUser, bits, 'import');
    if (sticks > 0 || balls > 0 || moons > 0)
      Inventory.add(rawUser, { sticks, balls, moons }, 'import');

    // Read new totals
    const newBits  = Balance.get(rawUser)   || 0;
    const newInv   = Inventory.get(rawUser) || { sticks:0, balls:0, moons:0 };

    say(
      `✅ Completed @${rawUser} import — they now have ` +
      `${newBits.toLocaleString()} 🍫 Choctobits, ` +
      `${newInv.sticks.toLocaleString()} 🪵 Sticks, ` +
      `${newInv.balls.toLocaleString()} 🎾 Balls, ` +
      `and ${newInv.moons.toLocaleString()} 🌙 Moons.`
    );
    return { ok:true };
  },
};
