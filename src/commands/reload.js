'use strict';
/**
 * !reload — hot-reload game commands without restarting the process.
 * Streamer/dev only. Also callable via HTTP POST /admin/reload (localhost only).
 */
module.exports = {
  name: 'reload',
  aliases: ['hotfix'],
  permissions: 'dev',
  cooldown: 5,

  execute(ctx) {
    const { say, loader } = ctx;
    if (!loader?.reload) { say('❌ Reload not available.'); return { ok: false }; }
    const n = loader.reload();
    say(`🔄 Commands hot-reloaded — ${n} active. No restart needed.`);
    return { ok: true };
  },
};
