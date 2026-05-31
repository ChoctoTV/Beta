'use strict';
/**
 * Dynamic Payout Multiplier
 * ─────────────────────────────────────────────────────────────────────────────
 * Reward = (Hourly_Target / 60) × Pool_Health × Global_Scaling × base_reward
 *
 * Pool Health (sigmoid decay):
 *   100% → 40%  = 1.0 (full payouts)
 *   40%  → 25%  = linear decay 1.0 → 0.0
 *   < 25%       = 0.0 (Recovery Mode — payouts suspended)
 *
 * Global Scaling (congestion buffer):
 *   If (N players × hourly_target) > (pool / 24h), apply congestion tax.
 *   Floors at 0.10 to prevent zero-reward situations.
 *
 * State persists in vault/dynamic-state.json so restarts don't lose tracking.
 * Resets on the SNAPSHOT_DAY each month.
 */

const fs   = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../vault/dynamic-state.json');

let _state = {
  distributed:  0,     // ChoctoBits paid out this cycle
  cycleStart:   null,  // ISO date of cycle start
  lastSave:     0,
};

// ── Persistence ──────────────────────────────────────────────────────────────
function load() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      Object.assign(_state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
    }
  } catch (e) { console.warn('[DynRewards] State load failed:', e.message); }
}

function save() {
  const now = Date.now();
  if (now - _state.lastSave < 10000) return;  // debounce — max once per 10s
  _state.lastSave = now;
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive:true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(_state, null, 2));
  } catch (e) { console.warn('[DynRewards] State save failed:', e.message); }
}

function resetCycle() {
  _state.distributed = 0;
  _state.cycleStart  = new Date().toISOString().slice(0, 10);
  _state.lastSave    = 0;
  save();
  console.log('[DynRewards] 🔄 Cycle reset — rewards pool refilled');
}

// ── Check if cycle should reset (aligned with SNAPSHOT_DAY) ─────────────────
function checkCycleReset(cfg) {
  const snapshotDay = cfg('snapshot_day') || 16;
  const today       = new Date();
  const dateStr     = today.toISOString().slice(0, 10);
  if (today.getDate() === snapshotDay && _state.cycleStart !== dateStr) {
    resetCycle();
  }
}

// ── Pool Health (sigmoid decay) ───────────────────────────────────────────────
// Config values (rewards_pool_total, min_pool_reserve) are in Choctobits — use directly.
function poolHealth(cfg) {
  const totalBits  = cfg('rewards_pool_total')  || 5000000;
  const minResBits = cfg('min_pool_reserve')    || 1250000;  // 25% of 5M default
  const remaining  = Math.max(0, totalBits - (_state.distributed || 0));
  const pct        = remaining / totalBits;
  const resPct     = minResBits / totalBits;
  const decayStart = 0.40;

  if (pct >= decayStart)  return 1.0;
  if (pct <= resPct)      return 0.0;
  return (pct - resPct) / (decayStart - resPct);
}

// ── Congestion / Global Scaling ───────────────────────────────────────────────
// hourly_grind_target is in Choctobits/hr — use directly.
function congestionScale(activePlayers, cfg) {
  const threshold    = cfg('congestion_threshold') || 50;
  if (activePlayers <= threshold) return 1.0;

  const totalBits    = cfg('rewards_pool_total')   || 5000000;
  const hourlyTarget = cfg('hourly_grind_target')  || 25000;   // bits/hr per active player
  const netBurnPerHr = activePlayers * hourlyTarget;
  const sustainHr    = totalBits / 24;

  if (netBurnPerHr <= sustainHr) return 1.0;
  return Math.max(0.10, sustainHr / netBurnPerHr);
}

// ── Main: apply dynamic multiplier to a base reward ──────────────────────────
function applyDynamic(baseReward, activePlayers, cfg) {
  checkCycleReset(cfg);

  const health      = poolHealth(cfg);
  if (health <= 0) {
    console.warn('[DynRewards] 🛑 Recovery Mode — pool < 25%, payouts suspended');
    return 0;
  }

  const congestion  = congestionScale(activePlayers, cfg);
  const scaled      = Math.max(1, Math.round(baseReward * health * congestion));

  // Track distribution (debounced save)
  _state.distributed = (_state.distributed || 0) + scaled;
  save();

  return scaled;
}

// ── Lurk reward: target-based rather than game-based ─────────────────────────
// hourly_lurk_target is in Choctobits/hr — divide by 60 for per-minute base.
function lurkReward(cfg, activePlayers) {
  checkCycleReset(cfg);
  const health = poolHealth(cfg);
  if (health <= 0) return 0;

  const baseBits   = Math.round((cfg('hourly_lurk_target') || 8000) / 60);
  const congestion = congestionScale(activePlayers, cfg);
  const reward     = Math.max(1, Math.round(baseBits * health * congestion));

  _state.distributed = (_state.distributed || 0) + reward;
  save();
  return reward;
}

// ── Status (for !poolstatus command) ─────────────────────────────────────────
function getStatus(cfg, activePlayers=0) {
  checkCycleReset(cfg);
  const totalBits  = cfg('rewards_pool_total') || 5000000;
  const remaining  = Math.max(0, totalBits - (_state.distributed || 0));
  const pct        = remaining / totalBits;
  const health     = poolHealth(cfg);
  const congestion = congestionScale(activePlayers, cfg);

  let mode = '✅ Normal';
  if (health <= 0)        mode = '🛑 Recovery (payouts suspended)';
  else if (pct < 0.40)    mode = '⚠️  Tapering (pool below 40%)';
  else if (congestion < 1) mode = '⚙️  Congestion tax active';

  return {
    mode,
    poolPct:         Math.round(pct * 100),
    remaining:       Math.round(remaining),
    distributed:     Math.round(_state.distributed || 0),
    totalPool:       totalBits,
    healthMult:      Math.round(health * 100) / 100,
    congestionMult:  Math.round(congestion * 100) / 100,
    effectiveMult:   Math.round(health * congestion * 100) / 100,
    activePlayers,
    cycleStart:      _state.cycleStart,
  };
}

load();

// ── Test helper (allows overriding state in unit tests) ─────────────────────
function _setDistributed(n) { _state.distributed = n; }

module.exports = { applyDynamic, lurkReward, poolHealth, congestionScale, getStatus, resetCycle, _setDistributed };
