'use strict';
const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const CommandGate = require('../core/CommandGate');

const DRAIN_MS = 15000;  // 15s for running animations to finish before reboot

// !480 / !720 / !1080 — set stream output quality and clean-reboot the app.
// Quality is persisted to vault/data/quality.txt (read by stream.js at startup).
module.exports = {
  name:'quality', aliases:['480','720','1080'], permissions:'streamer', cooldown:false,
  async execute(ctx) {
    const { cmd, args, say } = ctx;
    const MAP = { '480':'480p', '720':'720p', '1080':'1080p' };

    // Resolve target: !480/!720/!1080 directly, or !quality 720
    let q = MAP[cmd];
    if (!q) {
      const a = (args[0] || '').replace(/p$/i, '');
      q = MAP[a];
    }
    if (!q) { say('❌ Use !480, !720, or !1080 to set stream quality'); return { ok:false }; }

    const root = path.join(__dirname, '..');
    const qDir = path.join(root, 'vault', 'data');
    try {
      fs.mkdirSync(qDir, { recursive:true });
      fs.writeFileSync(path.join(qDir, 'quality.txt'), q);
    } catch (e) {
      say('❌ Could not save quality: ' + e.message);
      return { ok:false };
    }

    // ── Graceful shutdown: pause commands, let queues drain, then reboot ──────
    CommandGate.pause('Stream quality switch — commands paused while queues clear');
    say(`🔧 Commands paused — clearing queues for stream maintenance (${q} quality switch). Rebooting in ~15s…`);

    // Wait for any running game animations to finish before restarting
    await new Promise(r => setTimeout(r, DRAIN_MS));
    say('♻️ Queues clear — rebooting now. Back in ~20s.');
    await new Promise(r => setTimeout(r, 1500)); // let the message send

    // Write a self-contained reboot script to /tmp so it survives stop_all.
    // Uses setsid to break away from every process group before restarting.
    try {
      const script = `/tmp/choctotv_reboot_${Date.now()}.sh`;
      fs.writeFileSync(script,
        `#!/bin/bash\n` +
        `sleep 5\n` +
        `cd "${root}"\n` +
        `bash "${root}/start.sh" restart >> /tmp/choctotv_reboot.log 2>&1\n` +
        `rm -f "${script}"\n`
      );
      fs.chmodSync(script, 0o755);
      // setsid gives the script its own session — immune to any signal sent to
      // the app's process group when stop_all kills the services.
      const child = spawn('setsid', ['bash', script], {
        detached: true, stdio: 'ignore',
      });
      child.unref();
    } catch (e) {
      say('⚠ Quality saved but auto-reboot failed: ' + e.message + ' — run ./start.sh restart manually.');
    }
    return { ok:true };
  },
};
