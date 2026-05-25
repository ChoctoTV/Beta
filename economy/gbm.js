'use strict';
const db  = require('../db');
const log = require('../observability/logger').child({ service:'gbm' });
const CHOICES = ['Good','Ball','Moon'];
const BEATS   = { Good:'Moon', Moon:'Ball', Ball:'Good' };

function setPick(id, raw) {
  const p = CHOICES.find(x=>x.toLowerCase()===raw.toLowerCase()||x[0].toLowerCase()===raw[0]?.toLowerCase());
  if (!p) return { ok:false, error:`Choose Good, Ball, or Moon` };
  db.prepare("INSERT INTO gbm_picks(user_id,pick) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET pick=excluded.pick,set_at=datetime('now')").run(id,p);
  return { ok:true, pick:p };
}
function getPick(id) { return db.prepare('SELECT pick FROM gbm_picks WHERE user_id=?').get(id)?.pick||null; }
function getAll()    { return db.prepare('SELECT user_id,pick FROM gbm_picks').all(); }

function reveal(getCfg) {
  const all = getAll();
  const result = CHOICES[Math.floor(Math.random()*CHOICES.length)];
  const winner = BEATS[result];
  const winners = all.filter(r=>r.pick===winner);
  const counts  = Object.fromEntries(CHOICES.map(c=>[c, all.filter(r=>r.pick===c).length]));
  const isTie   = winners.length===0 || winners.length===all.length;
  const reward  = isTie ? getCfg('gbm_tie_reward') : getCfg('gbm_win_reward');
  log.info({ result, winner, winners:winners.length, total:all.length }, 'GBM reveal');
  return { result, winner, winners:winners.map(r=>r.user_id), isTie, reward, counts, total:all.length };
}
module.exports = { setPick, getPick, getAll, reveal, CHOICES, BEATS };
