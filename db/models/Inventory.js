'use strict';
const db = require('../');
const Balance = require('./Balance');
function get(id) { return db.prepare('SELECT sticks,balls,moons FROM inventory WHERE user_id=?').get(id) || {sticks:0,balls:0,moons:0}; }
function add(id, {sticks=0,balls=0,moons=0}, disp) {
  Balance.ensure(id, disp);
  db.prepare("INSERT INTO inventory (user_id,sticks,balls,moons) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET sticks=sticks+excluded.sticks,balls=balls+excluded.balls,moons=moons+excluded.moons,updated_at=datetime('now')").run(id,sticks,balls,moons);
}
module.exports = { get, add };
