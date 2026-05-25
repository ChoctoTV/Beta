/**
 * !hotfix
 *
 * STREAMER: checks which service files changed, reloads/restarts only those.
 *   - rewardsEcon.txt / announcements.txt → in-place reload, no restart
 *   - pupcore.js / teller.js / music.js   → SIGTERM + relaunch process
 *   - app.js                              → notify streamer to restart manually
 *   - No changes detected                 → reload config + DB overrides
 *
 * MOD / DEV: saves all persistent state, checks recent errors, announces
 *   restart in chat, then exits so start.sh watchdog relaunches cleanly.
 */
'use strict';
const fs      = require('fs');
const path    = require('path');
const { spawn } = require('child_process');
const Config  = require('../core/Config');
const metrics = require('../observability/metrics');

const CWD  = process.cwd();
const PIDS = path.join(CWD, 'pids');
const LOGS = path.join(CWD, 'logs');

// Files to monitor: key = filename, value = handler spec
const WATCH = {
  'rewardsEcon.txt':   { type: 'config'  },
  'announcements.txt': { type: 'ann'     },
  'pupcore.js':        { type: 'service', name: 'pupcore' },
  'teller.js':         { type: 'service', name: 'teller'  },
  'music.js':          { type: 'service', name: 'music'   },
  'app.js':            { type: 'self'    },
};

function mtime(file) {
  try { return fs.statSync(path.join(CWD, file)).mtimeMs; }
  catch { return 0; }
}

// Baseline captured at first module load — updated after each hotfix
let _baseline = Object.fromEntries(Object.keys(WATCH).map(f => [f, mtime(f)]));

function refreshBaseline() {
  _baseline = Object.fromEntries(Object.keys(WATCH).map(f => [f, mtime(f)]));
}

function restartService(serviceName) {
  const pidFile    = path.join(PIDS, `${serviceName}.pid`);
  const logFile    = path.join(LOGS, `${serviceName}.log`);
  const scriptFile = path.join(CWD, `${serviceName}.js`);

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
    if (!isNaN(pid)) process.kill(pid, 'SIGTERM');
  } catch {}

  return new Promise(resolve => {
    setTimeout(() => {
      try {
        const out   = fs.openSync(logFile, 'a');
        const child = spawn('node', [scriptFile], {
          detached: true,
          stdio:    ['ignore', out, out],
          env:      process.env,
          cwd:      CWD,
        });
        child.unref();
        fs.mkdirSync(PIDS, { recursive: true });
        fs.writeFileSync(pidFile, String(child.pid));
        resolve({ ok: true, pid: child.pid });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    }, 1200);
  });
}

// ── Streamer hotfix: file-change detection + targeted restarts ────────────────
async function doStreamerHotfix(ctx) {
  const { say, broadcast } = ctx;
  const changed = [];

  for (const [file, handler] of Object.entries(WATCH)) {
    const now  = mtime(file);
    const base = _baseline[file] || 0;
    if (now > base + 500) changed.push({ file, handler });
  }

  if (!changed.length) {
    Config.reload();
    say(`✅ !hotfix — no file changes, config reloaded`);
    return;
  }

  say(`🔧 Changes in: ${changed.map(c => c.file).join(', ')} — applying...`);
  const actions = [];

  for (const { file, handler } of changed) {
    if (handler.type === 'config') {
      Config.reload();
      actions.push(`rewardsEcon.txt ✓`);
    } else if (handler.type === 'ann') {
      try { require('./announcements').expire(broadcast); actions.push(`announcements ✓`); }
      catch { actions.push(`announcements failed`); }
    } else if (handler.type === 'service') {
      const r = await restartService(handler.name);
      actions.push(r.ok ? `${handler.name} restarted (pid ${r.pid})` : `${handler.name} FAILED`);
    } else if (handler.type === 'self') {
      actions.push(`app.js changed — run ./start.sh restart`);
    }
  }

  Config.reload();
  refreshBaseline();
  say(`✅ hotfix: ${actions.join(' · ')}`);
}

// ── Mod/Dev hotfix: save state + announce + full restart ─────────────────────
async function doModRestart(ctx) {
  const { say } = ctx;

  // 1. Check recent errors from metrics
  const st     = metrics.status();
  const errors = st.recentErrors || [];
  const errMsg = errors.length
    ? ` ${errors.length} recent error(s): ${errors.slice(0,3).map(e => e.service + ':' + e.message?.slice(0,30)).join(', ')}`
    : ' No recent errors.';

  // 2. Save all persistent state before exit
  try {
    const Lurk          = require('../economy/lurk');
    const SpriteManager = require('../core/SpriteManager');
    Lurk.save();
    SpriteManager.saveState();
    // Save on-duty state
    const Duty = require('../economy/duty');
    const db   = require('../db');
    const { mods, devs } = Duty.onDutyList();
    db.prepare("INSERT OR REPLACE INTO app_state (key,value) VALUES ('onduty_mods',?)")
      .run(JSON.stringify(mods));
    db.prepare("INSERT OR REPLACE INTO app_state (key,value) VALUES ('onduty_devs',?)")
      .run(JSON.stringify(devs));
  } catch (e) {
    console.error('[Hotfix] State save error:', e.message);
  }

  // 3. Announce then exit — start.sh watchdog relaunches app.js automatically
  say(`🔄 ChoctoTV restarting now...${errMsg} State saved. Back in a moment! 🐾`);

  // Small delay so the chat message sends before we exit
  setTimeout(() => {
    console.log('[Hotfix] Mod-triggered restart — exiting for watchdog relaunch');
    process.exit(0);
  }, 2000);
}

module.exports = {
  name:        'hotfix',
  permissions: 'mod',
  cooldown:    false,

  async execute(ctx) {
    const { isStreamer, isDev, isMod } = ctx;

    if (isStreamer || isDev) {
      // Streamer / dev: smart per-file check + targeted restarts
      await doStreamerHotfix(ctx);
    } else if (isMod) {
      // Mod: save state + announce + full restart
      await doModRestart(ctx);
    }
    return { ok: true };
  },
};
