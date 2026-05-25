'use strict';
const _map = new Map();  // id → { ts, isSub }
function markActive(id, isSub=false) { _map.set(id.toLowerCase(), { ts:Date.now(), isSub:!!isSub }); }
function getActive(ms, excl='') {
  const now=Date.now(), out=[];
  for (const [id,e] of _map) { if (now-e.ts>ms){_map.delete(id);continue;} if(id!==excl) out.push(id); }
  return out;
}
// Returns [{ userId, isSub }] for richer airdrop logic
function getActiveDetailed(ms, excl='') {
  const now=Date.now(), out=[];
  for (const [id,e] of _map) { if (now-e.ts>ms){_map.delete(id);continue;} if(id!==excl) out.push({ userId:id, isSub:e.isSub }); }
  return out;
}
function isSub(id) { return !!_map.get(id.toLowerCase())?.isSub; }
setInterval(() => { const now=Date.now(); for (const [id,e] of _map) if (now-e.ts>7200000) _map.delete(id); }, 300000);
module.exports = { markActive, getActive, getActiveDetailed, isSub };
