'use strict';
// CommandGate — global pause/resume for command processing.
// Paused at startup (enabled after 5s); paused again before maintenance reboots.
let _paused = false;
let _reason  = '';

module.exports = {
  pause(reason = 'Commands paused for maintenance') {
    _paused = true; _reason = reason;
    console.log(`[CommandGate] ⏸  Paused — ${reason}`);
  },
  resume() {
    _paused = false; _reason = '';
    console.log('[CommandGate] ▶  Commands enabled');
  },
  isPaused()  { return _paused; },
  reason()    { return _reason;  },
};
