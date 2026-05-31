'use strict';
// !set !<command> <yes|no|seconds>
// Streamer/dev only. Runtime overrides stored in Config (persist across hotfix, lost on restart).
//
//   !set !vend no          → vend works without ! prefix
//   !set !toss yes         → toss requires ! prefix
//   !set !vend 30          → vend cooldown = 30 seconds per user
//   !set !vend off         → vend cooldown disabled
//   !set !vend reset       → vend cooldown back to command default
//
// Overrides live in Config as:
//   cmd_require_prefix_<name>  1 = must have !, 0 = optional
//   cmd_cooldown_<name>        seconds, -1 = disabled, -2 = reset to default

const Config = require('../core/Config');

module.exports = {
  name: 'set',
  requirePrefix: true,
  permissions: 'dev',

  execute(ctx) {
    const { args, say, user, isMod, isDev, isStreamer } = ctx;
    if (!isDev && !isStreamer) {
      say(`❌ @${user} !set is streamer/dev only.`);
      return { ok: false };
    }

    // Expects: !set !<cmd> <value>
    const rawCmd = (args[0] || '').replace(/^!/, '').toLowerCase();
    const val    = (args[1] || '').toLowerCase();

    if (!rawCmd || !val) {
      say(`Usage: !set !<command> <yes|no|seconds|off|reset>`);
      return { ok: false };
    }

    // ── Prefix override ──────────────────────────────────────────────────────
    if (val === 'yes') {
      Config.setRuntime(`cmd_require_prefix_${rawCmd}`, 1);
      say(`✅ !${rawCmd} now requires the ! prefix.`);
      return { ok: true };
    }
    if (val === 'no') {
      Config.setRuntime(`cmd_require_prefix_${rawCmd}`, 0);
      say(`✅ ${rawCmd} now works with or without !`);
      return { ok: true };
    }

    // ── Cooldown override ────────────────────────────────────────────────────
    if (val === 'off') {
      Config.setRuntime(`cmd_cooldown_${rawCmd}`, -1);
      say(`✅ !${rawCmd} cooldown disabled.`);
      return { ok: true };
    }
    if (val === 'reset') {
      Config.setRuntime(`cmd_cooldown_${rawCmd}`, -2);
      say(`✅ !${rawCmd} cooldown reset to default.`);
      return { ok: true };
    }
    const secs = parseFloat(val);
    if (!isNaN(secs) && secs >= 0) {
      Config.setRuntime(`cmd_cooldown_${rawCmd}`, secs);
      say(`✅ !${rawCmd} cooldown set to ${secs}s per user.`);
      return { ok: true };
    }

    say(`Usage: !set !<command> <yes|no|seconds|off|reset>`);
    return { ok: false };
  },
};
