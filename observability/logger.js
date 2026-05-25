'use strict';
const pino = require('pino');
const path = require('path');
const fs   = require('fs');
const LOG_DIR = path.join(__dirname, '../logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const dest = process.env.LOG_PRETTY === '1'
  ? undefined
  : pino.destination(path.join(LOG_DIR, 'app.log'));
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  name:  'choctotv',
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: { err: pino.stdSerializers.err },
}, dest);
module.exports = logger;
