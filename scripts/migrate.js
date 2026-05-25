#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const db   = require('../db');

const JSON_DIR = process.argv[2] || path.join(process.cwd(), 'vault', 'data');
let total = 0;

function read(file, fallback={}) {
  const p = path.join(JSON_DIR, file);
  if (!fs.existsSync(p)) { console.log(`  skip: ${file}`); return fallback; }
  try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch(e) { console.error(`  error: ${file}: ${e.message}`); return fallback; }
}
function ensureUser(id) {
  db.prepare('INSERT OR IGNORE INTO users(id,display) VALUES(?,?)').run(id,id);
}

console.log('ChoctoTV v2 → v3 migration\n');

const bal = read('balances.json');
const insertBal = db.prepare('INSERT OR IGNORE INTO balances(user_id,amount) VALUES(?,?)');
db.transaction(()=>{ for(const[id,amt]of Object.entries(bal)){ensureUser(id);insertBal.run(id,amt);total++;} })();
console.log(`balances: ${Object.keys(bal).length}`);

const items = read('items.json');
const insertInv = db.prepare('INSERT OR IGNORE INTO inventory(user_id,sticks,balls,moons) VALUES(?,?,?,?)');
db.transaction(()=>{ for(const[id,inv]of Object.entries(items)){ensureUser(id);insertInv.run(id,inv.sticks||0,inv.balls||0,inv.moons||0);total++;} })();
console.log(`inventory: ${Object.keys(items).length}`);

const roles = read('roles.json', {mods:[],devs:[]});
const insertRole = db.prepare('INSERT OR IGNORE INTO roles(user_id,role) VALUES(?,?)');
db.transaction(()=>{
  for(const u of roles.mods||[]){ensureUser(u);insertRole.run(u,'mod');total++;}
  for(const u of roles.devs||[]){ensureUser(u);insertRole.run(u,'dev');total++;}
})();
console.log(`roles: ${(roles.mods||[]).length} mods, ${(roles.devs||[]).length} devs`);

const lotto = read('lottery.json', {tickets:{}});
const insertTicket = db.prepare('INSERT OR IGNORE INTO lottery_tickets(user_id,numbers) VALUES(?,?)');
db.transaction(()=>{ for(const[id,nums]of Object.entries(lotto.tickets||{})){if(/^\d{4}$/.test(nums)){ensureUser(id);insertTicket.run(id,nums);total++;}} })();
console.log(`lottery: ${Object.keys(lotto.tickets||{}).length} tickets`);

const wallets = read('wallets.json');
const insertW = db.prepare('INSERT OR IGNORE INTO wallets(user_id,address) VALUES(?,?)');
db.transaction(()=>{ for(const[id,addr]of Object.entries(wallets)){ensureUser(id);insertW.run(id,addr);total++;} })();
console.log(`wallets: ${Object.keys(wallets).length}`);

const colls = read('collections.json', {addresses:[]});
const insertC = db.prepare('INSERT OR IGNORE INTO collections(address) VALUES(?)');
db.transaction(()=>{ for(const a of colls.addresses||[]){insertC.run(a);total++;} })();
console.log(`collections: ${(colls.addresses||[]).length}`);

const scroll = read('scrollsites.json', {sites:[]});
const insertS = db.prepare('INSERT OR IGNORE INTO scroll_sites(url) VALUES(?)');
db.transaction(()=>{ for(const u of scroll.sites||[]){insertS.run(u);total++;} })();
console.log(`scroll sites: ${(scroll.sites||[]).length}`);

const coins = read('coins.json', {coins:[]});
const coinList = Array.isArray(coins)?coins:(coins.coins||[]);
const insertCoin = db.prepare('INSERT OR IGNORE INTO coins(sym,id,color) VALUES(?,?,?)');
db.transaction(()=>{ for(const c of coinList){if(c.sym&&c.id){insertCoin.run(c.sym.toUpperCase(),c.id,c.color||'#ffffff');total++;}} })();
console.log(`coins: ${coinList.length}`);

const verified = read('verified_accounts.json', []);
const vList = Array.isArray(verified)?verified:Object.keys(verified);
const insertV = db.prepare('INSERT OR IGNORE INTO verified_accounts(user_id) VALUES(?)');
db.transaction(()=>{ for(const id of vList){ensureUser(id);insertV.run(id);total++;} })();
console.log(`verified: ${vList.length}`);

console.log(`\n✅ Done — ${total} records imported`);
console.log('  Verify: sqlite3 vault/data/choctotv.db ".tables"');
