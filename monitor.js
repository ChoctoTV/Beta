#!/usr/bin/env node
'use strict';
// monitor.js — ChoctoTV Performance Monitor
// Run: node monitor.js   OR   ./start.sh monitor
// Shows live CPU, RAM, GPU usage + per-service stats
// Updates every 2 seconds. Press Q or Ctrl+C to exit.

require('dotenv').config({ path: require('path').join(__dirname, 'vault', '.env') });
const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const http = require('http');

const DIR      = __dirname;
const PIDS_DIR = path.join(DIR, '.pids');
const INTERVAL = 2000;

const C = {
  gr:'\x1b[32m', rd:'\x1b[31m', yl:'\x1b[33m', cy:'\x1b[36m',
  wt:'\x1b[1;37m', dm:'\x1b[2m', mg:'\x1b[35m', bl:'\x1b[34m',
  nc:'\x1b[0m', clear:'\x1b[2J\x1b[H', up: n => `\x1b[${n}A`,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const run  = cmd => { try { return execSync(cmd, { encoding:'utf8', timeout:3000 }).trim(); } catch { return ''; } };
const bar  = (pct, w=20) => {
  const filled = Math.round(Math.min(100, Math.max(0, pct)) / 100 * w);
  const color  = pct > 85 ? C.rd : pct > 60 ? C.yl : C.gr;
  return `${color}${'█'.repeat(filled)}${C.dm}${'░'.repeat(w - filled)}${C.nc}`;
};
const fmt  = (n, unit) => `${n}${unit}`;
const pad  = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

// ── System stats ──────────────────────────────────────────────────────────────
function getCpu() {
  try {
    const r = run("top -bn1 | grep 'Cpu(s)' | awk '{print $2+$4}'");
    return parseFloat(r) || 0;
  } catch { return 0; }
}

function getRam() {
  try {
    const r = run("free -m | awk 'NR==2{print $2,$3,$7}'").split(' ');
    return { total:parseInt(r[0])||0, used:parseInt(r[1])||0, avail:parseInt(r[2])||0 };
  } catch { return { total:0, used:0, avail:0 }; }
}

function getGpu() {
  // Try nvidia-smi first (desktop with GTX)
  const nv = run("nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits 2>/dev/null");
  if (nv) {
    const [util, memUsed, memTotal, temp] = nv.split(',').map(s => parseFloat(s.trim()));
    return { type:'NVIDIA', util: util||0, memUsed: memUsed||0, memTotal: memTotal||0, temp: temp||0 };
  }
  // Try AMD/Intel via radeontop or intel_gpu_top (best effort)
  const amd = run("radeontop -d - -l 1 2>/dev/null | tail -1 | grep -oP 'gpu \\K[0-9.]+'");
  if (amd) return { type:'AMD', util:parseFloat(amd)||0, memUsed:0, memTotal:0, temp:0 };
  return null;
}

function getDisk() {
  try {
    const r = run(`df -m "${DIR}" | tail -1 | awk '{print $2,$3,$5}'`).split(' ');
    return { total:parseInt(r[0])||0, used:parseInt(r[1])||0, pct:parseInt(r[2])||0 };
  } catch { return { total:0, used:0, pct:0 }; }
}

function getLoad() {
  try { return run("cat /proc/loadavg | awk '{print $1,$2,$3}'"); } catch { return '?'; }
}

// Track last network sample for delta calculation
let _lastNet = null;
function getNetwork() {
  try {
    // Find the active network interface (not lo)
    const ifaces = run("cat /proc/net/dev").split('\n')
      .filter(l => l.includes(':') && !l.includes('lo:'));
    
    const now  = Date.now();
    const data = {};
    for (const line of ifaces) {
      const parts = line.trim().split(/\s+/);
      const name  = parts[0].replace(':', '');
      const rx    = parseInt(parts[1])  || 0;  // bytes received
      const tx    = parseInt(parts[9])  || 0;  // bytes transmitted
      data[name]  = { rx, tx };
    }

    const result = { interfaces:[], totalTx:0, totalRx:0 };

    if (_lastNet && (now - _lastNet.ts) > 0) {
      const dt = (now - _lastNet.ts) / 1000; // seconds
      for (const [name, cur] of Object.entries(data)) {
        const prev = _lastNet.data[name];
        if (!prev) continue;
        const txRate = Math.max(0, (cur.tx - prev.tx) / dt); // bytes/sec
        const rxRate = Math.max(0, (cur.rx - prev.rx) / dt);
        result.interfaces.push({ name, txRate, rxRate });
        result.totalTx += txRate;
        result.totalRx += rxRate;
      }
    }

    _lastNet = { ts:now, data };
    return result;
  } catch { return { interfaces:[], totalTx:0, totalRx:0 }; }
}

function fmtNet(bytesPerSec) {
  if (bytesPerSec >= 1024*1024) return (bytesPerSec/1024/1024).toFixed(2) + ' MB/s';
  if (bytesPerSec >= 1024)      return (bytesPerSec/1024).toFixed(1)      + ' KB/s';
  return Math.round(bytesPerSec) + ' B/s';
}

// ── Per-process stats ─────────────────────────────────────────────────────────
function getProcStats(pid) {
  if (!pid) return null;
  const r = run(`ps -p ${pid} -o pid=,pcpu=,rss=,vsz= 2>/dev/null`).trim().split(/\s+/);
  if (r.length < 4 || !r[0]) return null;
  return {
    pid:  parseInt(r[0]),
    cpu:  parseFloat(r[1]) || 0,
    rss:  Math.round((parseInt(r[2]) || 0) / 1024),  // MB
    vsz:  Math.round((parseInt(r[3]) || 0) / 1024),  // MB
  };
}

function readPid(name) {
  try { return parseInt(fs.readFileSync(path.join(PIDS_DIR, `${name}.pid`), 'utf8').trim()); } catch { return null; }
}

const SERVICES = [
  { name:'app',    label:'App (game)  ' },
  { name:'stream', label:'Stream      ' },
  { name:'music',  label:'Music       ' },
];

// ── App health via API ────────────────────────────────────────────────────────
let appHealth = null;
function fetchHealth() {
  const req = http.request({ hostname:'127.0.0.1', port:parseInt(process.env.API_PORT||'3000'), path:'/status', method:'GET', timeout:1000 }, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => { try { appHealth = JSON.parse(d); } catch {} });
  });
  req.on('error', () => { appHealth = null; });
  req.end();
}




// ── FFmpeg / Chrome PIDs (not tracked by our pid files) ──────────────────────
function findPid(pattern) {
  const r = run(`pgrep -f "${pattern}" | head -1`);
  return r ? parseInt(r) : null;
}

// ── Render ────────────────────────────────────────────────────────────────────
let firstRender = true;

function render() {
  const cpu  = getCpu();
  const ram  = getRam();
  const gpu  = getGpu();
  const disk = getDisk();
  const load = getLoad();
  const ramPct = ram.total ? (ram.used / ram.total * 100) : 0;

  const lines = [];
  const w = process.stdout.columns || 80;
  const div = C.dm + '─'.repeat(w) + C.nc;

  lines.push(`${C.wt}━━━  ChoctoTV Monitor  ━━━${C.nc}  ${C.dm}${new Date().toLocaleTimeString()}  load: ${load}  Press Ctrl+C to exit${C.nc}`);
  lines.push('');

  // ── System ────────────────────────────────────────────────────────────────
  lines.push(`${C.cy}  SYSTEM${C.nc}`);
  lines.push(`  CPU  ${bar(cpu)}  ${rpad(cpu.toFixed(1), 5)}%`);
  lines.push(`  RAM  ${bar(ramPct)}  ${rpad(ram.used, 6)}MB / ${ram.total}MB  (${rpad(ramPct.toFixed(1),5)}%)`);

  if (gpu) {
    const gpuMemPct = gpu.memTotal ? (gpu.memUsed / gpu.memTotal * 100) : 0;
    lines.push(`  GPU  ${bar(gpu.util)}  ${rpad(gpu.util.toFixed(1),5)}%  ${C.dm}${gpu.type}${gpu.temp?'  '+gpu.temp+'°C':''}${C.nc}`);
    if (gpu.memTotal) {
      lines.push(`  VRAM ${bar(gpuMemPct)}  ${rpad(gpu.memUsed,6)}MB / ${gpu.memTotal}MB`);
    }
  } else {
    lines.push(`  GPU  ${C.dm}Not detected (nvidia-smi not found)${C.nc}`);
  }

  const diskPct = disk.total ? (disk.used / disk.total * 100) : 0;
  lines.push(`  Disk ${bar(diskPct)}  ${rpad(disk.used,6)}MB / ${disk.total}MB  ${C.dm}(app folder)${C.nc}`);
  lines.push('');

  // ── Services ──────────────────────────────────────────────────────────────
  lines.push(`${C.cy}  SERVICES${C.nc}`);
  lines.push(`  ${ pad('Name', 14) }${ pad('PID', 8) }${ pad('CPU%', 7) }${ pad('RAM', 8) }Status`);
  lines.push(`  ${C.dm}${'-'.repeat(50)}${C.nc}`);

  for (const svc of SERVICES) {
    const pid   = readPid(svc.name);
    const stats = pid ? getProcStats(pid) : null;
    const alive = stats !== null;
    const status = alive
      ? `${C.gr}● running${C.nc}`
      : pid ? `${C.rd}✗ crashed${C.nc}` : `${C.dm}○ stopped${C.nc}`;
    const cpu_  = stats ? `${stats.cpu.toFixed(1)}%` : '-';
    const ram_  = stats ? `${stats.rss}MB` : '-';
    lines.push(`  ${pad(svc.label, 14)}${pad(pid||'-', 8)}${pad(cpu_, 7)}${pad(ram_, 8)}${status}`);
  }

  // FFmpeg and Chrome (pipeline internals)
  const ffpid = findPid('ffmpeg.*rtmp');
  const crpid = findPid('chromium.*app=http');
  for (const [label, pid] of [['FFmpeg      ', ffpid], ['Chromium    ', crpid]]) {
    const stats  = pid ? getProcStats(pid) : null;
    const alive  = stats !== null;
    const status = alive ? `${C.gr}● running${C.nc}` : `${C.dm}○ not running${C.nc}`;
    const cpu_   = stats ? `${stats.cpu.toFixed(1)}%` : '-';
    const ram_   = stats ? `${stats.rss}MB` : '-';
    lines.push(`  ${pad(label, 14)}${pad(pid||'-', 8)}${pad(cpu_, 7)}${pad(ram_, 8)}${status}`);
  }

  lines.push('');

  // ── App stats ─────────────────────────────────────────────────────────────
  lines.push(`${C.cy}  STREAM APP${C.nc}`);
  if (appHealth) {
    const h=Math.floor(appHealth.uptime/3600), m=Math.floor((appHealth.uptime%3600)/60), s=appHealth.uptime%60;
    const uptimeStr = h+'h '+String(m).padStart(2,'0')+'m '+String(s).padStart(2,'0')+'s';
    lines.push('  Uptime:         ' + uptimeStr);
    lines.push(`  WS clients:     ${appHealth.wsClientsClients}`);
    lines.push(`  Active players: ${Object.entries(appHealth.counters||{}).filter(([k])=>k.includes("commands_total")).reduce((t,[,v])=>t+v,0)}`);
    lines.push('  Status:         \x1b[32mconnected\x1b[0m');
  } else {
    lines.push(`  ${C.yl}App not reachable on port ${parseInt(process.env.API_PORT||'3000')}${C.nc}`);
  }

  lines.push('');



  lines.push('');

  // ── Errors (per-component error counts since startup) ─────────────────────
  // Sourced from appHealth.counters['choctotv_errors_total{service="X"}']
  lines.push(`${C.cy}  ERRORS (since startup)${C.nc}`);
  if (appHealth && appHealth.counters) {
    const errCounts = {};
    for (const [key, val] of Object.entries(appHealth.counters)) {
      const m = key.match(/^choctotv_errors_total\{service="([^"]+)"\}$/);
      if (m) errCounts[m[1]] = val;
    }
    const entries = Object.entries(errCounts).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      lines.push(`  ${C.gr}● No errors recorded${C.nc}`);
    } else {
      for (const [svc, count] of entries.slice(0, 8)) {
        const col = count > 10 ? C.rd : count > 3 ? C.yl : C.dm;
        lines.push(`  ${pad(svc, 24)}${col}${rpad(count, 6)}${C.nc}`);
      }
    }
    // Show the 3 most recent error messages
    if (appHealth.recentErrors && appHealth.recentErrors.length > 0) {
      lines.push(`  ${C.dm}── recent ──${C.nc}`);
      for (const e of appHealth.recentErrors.slice(0, 3)) {
        const t   = e.ts ? e.ts.slice(11, 19) : '??:??:??';
        const svc = (e.service || '?').slice(0, 12);
        const msg = (e.message || '').slice(0, 60);
        lines.push(`  ${C.dm}${t}${C.nc} ${C.yl}${pad(svc, 13)}${C.nc}${C.dm}${msg}${C.nc}`);
      }
    }
  } else {
    lines.push(`  ${C.dm}(app not reachable — cannot read error counts)${C.nc}`);
  }

  // ── Output (clear screen each frame to avoid residual text) ───────────────
  // Each line is padded with ANSI clear-to-end-of-line (\x1b[K) so any leftover
  // characters from previous frames get wiped.
  const CLR_EOL = '\x1b[K';
  const out = lines.map(l => l + CLR_EOL).join('\n') + CLR_EOL + '\n';
  if (firstRender) {
    process.stdout.write(C.clear);
    firstRender = false;
  } else {
    process.stdout.write('\x1b[H');  // move cursor to top-left without clearing
  }
  process.stdout.write(out);
  // Wipe anything below the final line (clear from cursor to end of screen)
  process.stdout.write('\x1b[J');
}

// ── Main ──────────────────────────────────────────────────────────────────────
fetchHealth();
render();
const timer       = setInterval(render, INTERVAL);
const apiTimer = setInterval(fetchHealth, 5000);

process.on('SIGINT',  () => { clearInterval(timer); clearInterval(apiTimer); console.log('\n'); process.exit(0); });
process.on('SIGTERM', () => { clearInterval(timer); clearInterval(apiTimer); process.exit(0); });
