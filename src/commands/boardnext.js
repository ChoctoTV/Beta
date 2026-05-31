'use strict';
// !boardnext — advances the billboard to the next image immediately and
// restarts the 30-second timer. Mod/dev/streamer only.

module.exports = {
  name: 'boardnext',
  requirePrefix: true,
  permissions: 'mod',
  cooldown: false,

  execute(ctx) {
    const { say, broadcast } = ctx;
    broadcast({ type: 'billboard_next' });
    say(`⏭️ Billboard advanced to next image.`);
    return { ok: true };
  },
};
