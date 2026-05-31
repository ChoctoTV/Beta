'use strict';
const db  = require('../db');
const log = require('../observability/logger').child({ service:'lottery' });
const TIERS = { 4:{name:'Jackpot',emoji:'🌟',key:'lotto_jackpot_prize'}, 3:{name:'Epic',emoji:'🟣',key:'lotto_epic_prize'}, 2:{name:'Rare',emoji:'🔵',key:'lotto_rare_prize'}, 1:{name:'Common',emoji:'🟢',key:'lotto_common_prize'} };
function setTicket(id, nums) {
  if (!/^\d{4}$/.test(nums)) return { ok:false, error:'Must be exactly 4 digits' };
  db.prepare("INSERT INTO lottery_tickets(user_id,numbers) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET numbers=excluded.numbers,set_at=datetime('now')").run(id,nums);
  return { ok:true, numbers:nums };
}
function getTicket(id) { return db.prepare('SELECT numbers FROM lottery_tickets WHERE user_id=?').get(id)?.numbers||null; }
function format(n)     { return n.split('').join(' - '); }
function draw(getCfg) {
  const drawn  = Array.from({length:4},()=>Math.floor(Math.random()*4)+1).join('');
  const all    = db.prepare('SELECT user_id,numbers FROM lottery_tickets').all();
  const results = [];
  for (const {user_id:uid, numbers} of all) {
    let m=0; for (let i=0;i<4;i++) if (drawn[i]===numbers[i]) m++;
    if (!m) continue;
    const tier=TIERS[m];
    results.push({ userId:uid, matches:m, prize:Math.round(getCfg(tier.key)), tier:tier.name, emoji:tier.emoji });
  }
  log.info({ drawn, participants:all.length, winners:results.length }, 'Lottery draw');
  return { drawn, results };
}
module.exports = { setTicket, getTicket, format, draw, TIERS };
