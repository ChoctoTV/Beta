'use strict';
class CircuitBreaker {
  constructor({ name, threshold=5, windowMs=60000, resetMs=30000, timeoutMs=8000 }={}) {
    Object.assign(this, { name, threshold, windowMs, resetMs, timeoutMs,
      _state:'CLOSED', _failures:[], _openedAt:null });
  }
  async call(fn) {
    if (this._state==='OPEN') {
      if (Date.now()-this._openedAt >= this.resetMs) { this._state='HALF_OPEN'; }
      else throw new Error(`Circuit OPEN: ${this.name}`);
    }
    try {
      const r = await Promise.race([
        fn(),
        new Promise((_,rej) => setTimeout(()=>rej(new Error(`${this.name} timeout`)), this.timeoutMs)),
      ]);
      if (this._state==='HALF_OPEN') { this._state='CLOSED'; this._failures=[]; }
      return r;
    } catch(e) {
      const now = Date.now();
      this._failures.push(now);
      this._failures = this._failures.filter(t=>now-t<this.windowMs);
      if (this._failures.length>=this.threshold && this._state!=='OPEN') {
        this._state='OPEN'; this._openedAt=now;
        console.warn(`[CB] ${this.name} OPEN`);
      }
      throw e;
    }
  }
}
module.exports = CircuitBreaker;
