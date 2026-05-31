'use strict';
// !testhowliday [name] — triggers a 30-second Howliday demo on the overlay.
// Cycles through all 7 Howlidays one by one if no arg given,
// or jumps to a specific one by partial name match.
// Examples:
//   !testhowliday              → cycle through all howlidays
//   !testhowliday newbarks     → NewBarks Day demo
//   !testhowliday halloween    → Octobark Howloween demo
//   !testhowliday drip         → Decemgrrr Drip Day demo

const HOWLIDAYS = [
  { name: 'NewBarks Eve',           fenceLights: ['#FFD700', '#C0C0C0'] },
  { name: 'NewBarks Day',           fenceLights: ['#FFD700', '#C0C0C0'] },
  { name: 'Marfket Surge Day',      fenceLights: ['#00CC44', '#FFD700'] },
  { name: 'Airdropawril',           fenceLights: ['#9B59B6', '#00CED1'] },
  { name: 'Augruff Activation Day', fenceLights: ['#FF6B35', '#CC2200'] },
  { name: 'Octobark Howloween',     fenceLights: ['#FF6600', '#440088'] },
  { name: 'Decemgrrr Drip Day',     fenceLights: ['#CC0000', '#B0E8FF'] },
];

module.exports = {
  name: 'testhowliday',
  requirePrefix: true,
  permissions: 'mod',
  cooldown: false,

  execute(ctx) {
    const { args, say, broadcast, user } = ctx;

    const query = (args[0] || '').toLowerCase().trim();

    let target = null;
    if (query) {
      target = HOWLIDAYS.find(h => h.name.toLowerCase().includes(query));
      if (!target) {
        const names = HOWLIDAYS.map(h => h.name).join(', ');
        say(`❌ @${user} no Howliday matching "${query}". Available: ${names}`);
        return { ok: false };
      }
    }

    // Broadcast to overlay — calendar module handles the 30-second demo
    broadcast({
      type:    'test_howliday',
      target:  target ? target.name : null,  // null = cycle all
      demoMs:  30000,
    });

    const msg = target
      ? `🎉 Howliday demo: ${target.name} (30s)`
      : `🎉 Howliday demo: cycling all 7 Howlidays (30s each)`;
    say(msg);
    return { ok: true };
  },
};
