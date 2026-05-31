'use strict';
// !loadboard — forces the billboard overlay to re-scan
// yardpets3/assets/billboard/ for new image files, then restarts the slideshow
// from the first image. Mod/dev/streamer only.

module.exports = {
  name: 'loadboard',
  requirePrefix: true,
  permissions: 'mod',
  cooldown: false,

  execute(ctx) {
    const { user, say, broadcast } = ctx;
    broadcast({ type: 'billboard_reload' });
    say(`📸 @${user} reloaded billboard images from disk.`);
    return { ok: true };
  },
};
