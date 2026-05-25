'use strict';
const fs   = require('fs');
const path = require('path');
class CommandLoader {
  constructor() { this._map = new Map(); this._nl = []; }
  load(dir) {
    for (const file of fs.readdirSync(dir).filter(f=>f.endsWith('.js'))) {
      const mod = require(path.join(dir, file));
      if (!mod.name || !mod.execute) continue;
      for (const n of [mod.name, ...(mod.aliases||[])]) this._map.set(n.toLowerCase(), mod);
      for (const p of (mod.nlPatterns||[])) this._nl.push({ pattern:p, name:mod.name });
    }
    console.log(`[Commands] ${this._map.size} loaded`);
  }
  get(name)    { return this._map.get((name||'').toLowerCase()) || null; }
  resolve(msg) {
    const direct = this._map.get(msg.toLowerCase());
    if (direct) return direct;
    for (const {pattern, name} of this._nl) if (pattern.test(msg)) return this._map.get(name);
    return null;
  }
}
module.exports = CommandLoader;
