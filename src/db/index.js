'use strict';
const Database = require('better-sqlite3');
const P        = require('../core/Paths');
const { runMigrations } = require('./migrations');

const db = new Database(P.db);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys  = ON');
db.pragma('synchronous   = NORMAL');
runMigrations(db);
module.exports = db;
