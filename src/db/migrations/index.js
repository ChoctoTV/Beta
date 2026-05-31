'use strict';
const fs   = require('fs');
const path = require('path');
function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    applied TEXT DEFAULT (datetime('now'))
  )`);
  const done = new Set(db.prepare('SELECT version FROM _migrations').all().map(r => r.version));
  const dir  = path.join(__dirname);
  const files = fs.readdirSync(dir).filter(f => /^\d{3}_.*\.js$/.test(f)).sort();
  for (const file of files) {
    const { version, up } = require(path.join(dir, file));
    if (done.has(version)) continue;
    db.transaction(() => {
      up(db);
      db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(version);
    })();
    console.log(`[DB] Migration ${version} applied`);
  }
}
module.exports = { runMigrations };
