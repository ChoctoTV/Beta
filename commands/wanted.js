/**
 * !wanted — streamer command to trigger the classifieds adoption scroll.
 * Shows the classifieds panel as long as no battle or gauntlet is running.
 * Overlay listens for event:show_classifieds and switches to idle/classifieds view.
 */
'use strict';
module.exports = {
  name:        'wanted',
  permissions: 'streamer',
  cooldown:    false,
  execute(ctx) {
    const { say, broadcast } = ctx;
    broadcast({ type: 'show_classifieds' });
    say(`📰 Choctonaut Adoption Classifieds — find your pup!`);
    return { ok: true };
  },
};
