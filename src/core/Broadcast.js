'use strict';
const { WebSocketServer } = require('ws');
let _wss = null;
function init(port=3001) {
  _wss = new WebSocketServer({ port });
  _wss.on('connection', ws => { ws.on('error', ()=>{}); });
  console.log(`[WS] Broadcast server on :${port}`);
}
function broadcast(msg) {
  if (!_wss) return;
  const s = JSON.stringify(msg);
  for (const c of _wss.clients) if (c.readyState===1) c.send(s, ()=>{});
}
function clientCount() { return _wss?.clients.size || 0; }
module.exports = { init, broadcast, clientCount };
