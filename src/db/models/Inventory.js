'use strict';
const db = require('../');
const Balance = require('./Balance');
function get(id) { return db.prepare('SELECT sticks,balls,moons FROM inventory WHERE user_id=?').get(id) || {sticks:0,balls:0,moons:0}; }
function add(id, {sticks=0,balls=0,moons=0}, disp) {
  Balance.ensure(id, disp);
  db.prepare("INSERT INTO inventory (user_id,sticks,balls,moons) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET sticks=sticks+excluded.sticks,balls=balls+excluded.balls,moons=moons+excluded.moons,updated_at=datetime('now')").run(id,sticks,balls,moons);
}

function set(id, items) {
  // For testing: replace inventory with exact array
  if (!items || !items.length) { db.prepare('DELETE FROM inventory WHERE user_id=?').run(id); return; }
  db.transaction(() => {
    db.prepare('DELETE FROM inventory WHERE user_id=?').run(id);
    for (const item of items) {
      db.prepare('INSERT INTO inventory (user_id, item, qty) VALUES (?,?,?)').run(id, item.item||item, item.qty||1);
    }
  })();
}
module.exports = { get, add, set };
