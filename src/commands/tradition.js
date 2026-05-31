'use strict';
// !tradition — posts the tradition message for today's howliday.
// On non-howliday days, mentions the next upcoming howliday.

const Cal = require('../services/ChoctoCalendarHelper');

let _lastUsed = 0;
const COOLDOWN_MS = 10 * 60 * 1000;

module.exports = {
  name: 'tradition',
  permissions: 'viewer',
  cooldown: false,

  execute(ctx) {
    const { say, user, isMod, isDev, isStreamer } = ctx;

    if (!isMod && !isDev && !isStreamer) {
      const remain = COOLDOWN_MS - (Date.now() - _lastUsed);
      if (remain > 0) {
        const secs = Math.ceil(remain / 1000);
        say(`@${user} !tradition on cooldown — ${secs}s remaining.`);
        return { ok: false };
      }
    }
    _lastUsed = Date.now();

    const day = Cal.getChoctoDay();

    if (day.isHowliday && day.howlidayData) {
      say(`🎉 ${day.howlidayName} — ${day.howlidayData.tradition}`);
      return { ok: true };
    }

    say(`It's a great day to adopt a Choctonaut or stack some more $Choctopus. Oh yea....Go Earn Some Choctobits!!`);
    return { ok: true };
  },
};
