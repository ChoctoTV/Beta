'use strict';
const mods = new Set(), devs = new Set();
function goOnDuty(id, isStreamer=false) {
  const Roles = require('../db/models/Roles');
  if (Roles.isMod(id)) { mods.add(id); return 'mod'; }
  if (Roles.isDev(id)) { devs.add(id); return 'dev'; }
  if (isStreamer)       { devs.add(id); return 'dev'; }  // broadcaster = dev tier
  return null;
}
function goOffDuty(id) { const was=mods.has(id)?'mod':devs.has(id)?'dev':null; mods.delete(id); devs.delete(id); return was; }
function isOnDuty(id)   { return mods.has(id)||devs.has(id); }
function modBoost(cfg)  { return mods.size>0 ? (cfg('mod_onduty_boost')||0.10) : 0; }
function onDutyList()   { return { mods:[...mods], devs:[...devs] }; }
function today()        { return new Date().toISOString().slice(0,10); }
function getRow(id) {
  const db  = require('../db');
  const t   = today();
  const row = db.prepare('SELECT * FROM airdrop_budgets WHERE user_id=?').get(id);
  if (!row||row.date!==t) { db.prepare('INSERT OR REPLACE INTO airdrop_budgets (user_id,date,used_free,used_paid) VALUES(?,?,0,0)').run(id,t); return {used_free:0,used_paid:0}; }
  return row;
}
function freeBudget(id, cfg) { const Roles=require('../db/models/Roles'); return Roles.isDev(id)?cfg('airdrop_dev_budget'):cfg('airdrop_mod_budget'); }
function freeLeft(id, cfg)   { return Math.max(0, freeBudget(id,cfg) - getRow(id).used_free); }
function useBudget(id, amt, type) {
  const db=require('../db'), col=type==='free'?'used_free':'used_paid';
  getRow(id);
  db.prepare(`UPDATE airdrop_budgets SET ${col}=${col}+? WHERE user_id=?`).run(amt,id);
}
module.exports = { goOnDuty, goOffDuty, isOnDuty, modBoost, onDutyList, freeBudget, freeLeft, useBudget };
