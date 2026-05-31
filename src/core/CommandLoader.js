'use strict';
const fs   = require('fs');
const path = require('path');

class CommandLoader {
  constructor() {
    this._map  = new Map();
    this._nl   = [];
    this._dir  = null;
  }

  load(dir) {
    this._dir = dir;
    this._loadDir(dir);
    console.log(`[Commands] ${this._map.size} loaded`);
  }

  _loadDir(dir) {
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
      const fullPath = path.join(dir, file);
      try {
        delete require.cache[require.resolve(fullPath)];
        const mod = require(fullPath);
        if (!mod.name || !mod.execute) continue;
        for (const n of [mod.name, ...(mod.aliases || [])]) {
          this._map.set(n.toLowerCase(), mod);
        }
        for (const p of (mod.nlPatterns || [])) {
          this._nl.push({ pattern: p, name: mod.name });
        }
      } catch (e) {
        console.error(`[Commands] Failed to load ${file}:`, e.message);
      }
    }
  }

  /** Hot-reload all commands without restarting the process. */
  reload() {
    this._map.clear();
    this._nl.length = 0;
    if (this._dir) this._loadDir(this._dir);
    console.log(`[Commands] Hot-reloaded — ${this._map.size} commands active`);
    return this._map.size;
  }

  get(name)    { return this._map.get((name || '').toLowerCase()) || null; }
  resolve(msg) {
    const direct = this._map.get(msg.toLowerCase());
    if (direct) return direct;
    for (const { pattern, name } of this._nl) {
      if (pattern.test(msg)) return this._map.get(name);
    }
    return null;
  }
  size() { return this._map.size; }
}

module.exports = CommandLoader;
