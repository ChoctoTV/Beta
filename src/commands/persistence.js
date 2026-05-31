'use strict';
/**
 * !persistence           — show last backup time and vault.zip status
 * !persistence backup    — trigger an immediate backup right now (dev/streamer)
 */
module.exports = {
  name: 'persistence',
  aliases: ['backup'],
  permissions: 'dev',
  cooldown: 10,

  async execute(ctx) {
    const { args, say, isDev, isStreamer } = ctx;
    const PG = require('../services/PersistenceGuard');
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'backup') {
      say('💾 Triggering manual backup...');
      await PG.backup('manual');
      say('✅ Backup complete — vault/persistence/ and vault.zip updated.');
      return { ok: true };
    }

    const st = PG.status();
    if (!st.ok) { say('❌ PersistenceGuard not available.'); return { ok: false }; }
    say(`💾 Last backup: ${st.lastBackup} · DB: ${(st.dbSizeBytes/1024).toFixed(1)}KB · vault.zip: ${st.vaultZip ? '✅' : '❌ missing'}`);
    return { ok: true };
  },
};
