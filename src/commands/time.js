'use strict';
// !time — posts the current ChoctoTV dog time and date as a single chat line.
// Mod/streamer only.

const Cal = require('../services/ChoctoCalendarHelper');

module.exports = {
  name: 'time',
  requirePrefix: true,
  permissions: 'mod',
  cooldown: false,

  execute(ctx) {
    const { say } = ctx;
    say(Cal.formatTimeDate());
    return { ok: true };
  },
};
