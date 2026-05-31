'use strict';
// Shared morale state — imported by app.js, feed.js, water.js
const ACTIVE_WINDOW_MS = 600000; // 10 min

module.exports = {
  plays:     new Map(),  // userId → { ts, display }
  actionCount: 0,            // game actions fired since last 5-min drain tick
  foodBowl:  60,         // 0–100 fill level
  waterBowl: 60,
  recordPlay(uid, display) {
    const entry = this.plays.get(uid) || {};
    this.plays.set(uid, { ts: Date.now(), display: display || entry.display || uid });
  },
  getDisplay(uid) { return (this.plays.get(uid)||{}).display || uid; },
  getActivePlayers() {
    const cutoff = Date.now() - ACTIVE_WINDOW_MS;
    return [...this.plays.entries()].filter(([,{ts}]) => ts >= cutoff).map(([id]) => id);
  },
  calcScore(activeCnt, lurkerCnt) {
    return Math.max(-10, Math.min(10, activeCnt - lurkerCnt));
  },
  calcBonus(score) { return Math.max(0, 100 + score * 10); },
  // Bowl factor: both full (100%) = full bonus; each % empty = that % less bonus
  // e.g. both at 90% → (90+90)/200 = 0.9 → 10% less bonus
  calcBowlBonus(score) {
    const base = this.calcBonus(score);
    const factor = (this.foodBowl + this.waterBowl) / 200; // 0..1
    return Math.max(0, Math.round(base * factor));
  },
};
