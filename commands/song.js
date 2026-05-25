'use strict';
const fs   = require('fs');
const CTRL = '/tmp/choctotv_music_ctrl.json';
function send(cmd, val) {
  try { fs.writeFileSync(CTRL, JSON.stringify(val !== undefined ? { cmd, val } : { cmd })); } catch {}
}
module.exports = {
  name:'song', aliases:['skip','volume','music'], permissions:'viewer', cooldown:false,
  execute(ctx) {
    const { cmd, args, user, say, isMod, isDev, isStreamer } = ctx;
    if (cmd === 'song') { say(`🎵 !music on/off · !skip · !volume 0-100`); return { ok:true }; }
    // Streamer always allowed; mods/devs allowed; viewers blocked
    if (!isStreamer && !isMod && !isDev) { say(`❌ Mods only`); return { ok:false }; }
    if (cmd === 'skip')  { send('skip');                         say(`⏭️ @${user} skipped`); }
    if (cmd === 'music') { send(args[0]==='off'?'off':'on');     say(`🎵 Music ${args[0]==='off'?'off':'on'}`); }
    if (cmd === 'volume') {
      const v = parseInt(args[0]);
      if (isNaN(v)||v<0||v>100) { say(`❌ !volume 0-100`); return { ok:false }; }
      send('volume', v);
      say(`🔊 Volume: ${v}%`);
    }
    return { ok:true };
  },
};
