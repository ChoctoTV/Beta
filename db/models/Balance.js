'use strict';
const db = require('../');
function ensure(id, display) {
  db.prepare('INSERT OR IGNORE INTO users (id, display) VALUES (?,?)').run(id, display||id);
  db.prepare('INSERT OR IGNORE INTO balances (user_id, amount) VALUES (?,0)').run(id);
}
function get(id)            { return db.prepare('SELECT amount FROM balances WHERE user_id=?').get(id)?.amount || 0; }
function add(id, amt, disp) { ensure(id, disp); db.prepare("UPDATE balances SET amount=amount+?,updated_at=datetime('now') WHERE user_id=?").run(amt,id); return get(id); }
function subtract(id, amt)  {
  const bal = get(id);
  if (bal < amt) throw new Error(`Insufficient: ${bal} < ${amt}`);
  db.prepare("UPDATE balances SET amount=amount-?,updated_at=datetime('now') WHERE user_id=?").run(amt,id);
  return get(id);
}
function top(limit=5, excludeId=null) {
  return db.prepare('SELECT u.display,b.amount FROM balances b JOIN users u ON u.id=b.user_id WHERE b.user_id!=COALESCE(?,\'\') AND b.amount>0 ORDER BY b.amount DESC LIMIT ?').all(excludeId,limit);
}
module.exports = { ensure, get, add, subtract, top };
