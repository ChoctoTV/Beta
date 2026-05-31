'use strict';
// !lore — posts the Choctoverse lore tidbit for the current dog day of the year.
// The same dog day always returns the same lore line so chatters can collect them all.
// On a howliday, posts that howliday's special lore. Viewer-allowed, 10-min cooldown.

const LORE = require('../data/lore');
const Cal  = require('../services/ChoctoCalendarHelper');

let _lastUsed = 0;
const COOLDOWN_MS = 10 * 60 * 1000;

module.exports = {
  name: 'lore',
  permissions: 'viewer',
  cooldown: false,

  execute(ctx) {
    const { say, user, isMod, isDev, isStreamer } = ctx;

    if (!isMod && !isDev && !isStreamer) {
      const remain = COOLDOWN_MS - (Date.now() - _lastUsed);
      if (remain > 0) {
        const secs = Math.ceil(remain / 1000);
        say(`@${user} !lore on cooldown — ${secs}s remaining.`);
        return { ok: false };
      }
    }
    _lastUsed = Date.now();

    const day = Cal.getChoctoDay();

    // On a howliday, post that howliday's lore instead
    if (day.isHowliday && day.howlidayData && day.howlidayData.lore) {
      say(`📜 ${day.howlidayName} — ${day.howlidayData.lore}`);
      return { ok: true };
    }

    const line = LORE[day.dogDayOfYr % LORE.length];
    say(`📜 ${day.dogMonth} ${day.dogDay}, DogYear ${day.dogYear} — ${line}`);
    return { ok: true };
  },
};
