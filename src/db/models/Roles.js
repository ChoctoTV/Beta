'use strict';
const db = require('../');
const Balance = require('./Balance');
function isMod(id) { return !!db.prepare("SELECT 1 FROM roles WHERE user_id=? AND role='mod'").get(id); }
function isDev(id) { return !!db.prepare("SELECT 1 FROM roles WHERE user_id=? AND role='dev'").get(id); }
function grant(id, role, by, disp) { Balance.ensure(id,disp); db.prepare('INSERT OR IGNORE INTO roles (user_id,role,granted_by) VALUES(?,?,?)').run(id,role,by); }
function revoke(id, role) { db.prepare('DELETE FROM roles WHERE user_id=? AND role=?').run(id,role); }
function list(role) { return db.prepare('SELECT user_id FROM roles WHERE role=?').all(role).map(r=>r.user_id); }
module.exports = { isMod, isDev, grant, revoke, list };
