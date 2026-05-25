'use strict';
const START    = Date.now();
const counters = new Map();
const gauges   = new Map();
const errors   = [];

function inc(name, labels = {}) {
  const k = _key(name, labels);
  counters.set(k, (counters.get(k) || 0) + 1);
}
function set(name, val, labels = {}) { gauges.set(_key(name, labels), val); }
function recordError(svc, msg) {
  errors.unshift({ ts: new Date().toISOString(), service: svc, message: msg });
  if (errors.length > 50) errors.length = 50;
  inc('choctotv_errors_total', { service: svc });
}
function _key(name, labels) {
  const l = Object.entries(labels).map(([k,v]) => `${k}="${v}"`).join(',');
  return l ? `${name}{${l}}` : name;
}
function prometheus() {
  return [
    `choctotv_uptime_seconds ${Math.round((Date.now()-START)/1000)}`,
    `process_heap_bytes ${process.memoryUsage().heapUsed}`,
    ...Array.from(counters, ([k,v]) => `${k} ${v}`),
    ...Array.from(gauges,   ([k,v]) => `${k} ${v}`),
  ].join('\n') + '\n';
}
function status() {
  return {
    uptime:       Math.round((Date.now()-START)/1000),
    memory:       process.memoryUsage(),
    recentErrors: errors.slice(0,10),
    counters:     Object.fromEntries(counters),
  };
}
module.exports = { inc, set, recordError, prometheus, status };
