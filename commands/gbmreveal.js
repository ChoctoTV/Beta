'use strict';
const GBMEcon = require('../economy/gbm');
module.exports = {
  name:'gbmreveal', aliases:['gbmresult'], permissions:'streamer', cooldown:false,
  execute(ctx) {
    const { cmd, say, broadcast, cfg, Balance } = ctx;
    if (cmd==='gbmresult') {
      const all = GBMEcon.getAll();
      const c   = Object.fromEntries(GBMEcon.CHOICES.map(x=>[x, all.filter(r=>r.pick===x).length]));
      say(`🎯 GBM: Good ${c.Good} · Ball ${c.Ball} · Moon ${c.Moon} (${all.length} picks)`);
      return { ok:true };
    }
    const r = GBMEcon.reveal(cfg);
    const { result, winner, winners, isTie, reward, counts, total } = r;
    if (!total) { say(`🎯 No GBM picks set yet`); return { ok:true }; }
    const cStr = GBMEcon.CHOICES.map(c=>`${c}: ${counts[c]}`).join(' · ');
    if (isTie) {
      say(`🎯 GBM: ${result} vs ${winner}... TIE! (${cStr})`);
    } else {
      winners.forEach(uid => Balance.add(uid, reward, uid));
      say(`🎯 GBM: ${result} beats ${GBMEcon.BEATS[result]}! ${winners.length} winner(s) +${reward}🍫 · (${cStr})`);
    }
    // Overlay listens for event:gbm_result
    broadcast({ type:'gbm_result', result, winner, winners, isTie, counts, reward });
    return { ok:true };
  },
};
