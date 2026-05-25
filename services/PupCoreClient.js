'use strict';
const http           = require('http');
const { WebSocket }  = require('ws');
const CircuitBreaker = require('./CircuitBreaker');

const PORT   = () => parseInt(process.env.PUPCORE_PORT||'3002');
const breaker = new CircuitBreaker({ name:'pupcore', threshold:5, timeoutMs:5000 });

const _cache = new Map();
let _broadcast = null;
let _ws = null;

function setEventBroadcast(fn) { _broadcast = fn; }

function _connect() {
  if (_ws && _ws.readyState <= 1) return;
  _ws = new WebSocket(`ws://localhost:${PORT()}`);
  _ws.on('open',    () => console.log('[PupCore] WS connected'));
  _ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type==='pupcore:state' && msg.userId) {
        _cache.set(msg.userId, msg.state);
        if (_broadcast) _broadcast({ type:'pupcore:state', userId:msg.userId, state:msg.state });
      }
    } catch {}
  });
  _ws.on('close', () => { console.warn('[PupCore] WS closed, retry 5s'); setTimeout(_connect, 5000); });
  _ws.on('error', () => {});
}

function _http(method, path, body) {
  return breaker.call(() => new Promise((res,rej) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname:'localhost', port:PORT(), path, method,
      headers:{ 'Content-Type':'application/json', ...(payload?{'Content-Length':Buffer.byteLength(payload)}:{}) },
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d));}catch{res(null);} }); });
    req.on('error', rej);
    if (payload) req.write(payload);
    req.end();
  }));
}

function getCachedState(userId)    { return _cache.get(userId)||null; }
async function getUserState(id)    { try{return await _http('GET',`/user/state/${id}`);}catch{return null;} }
async function equip(id, data)     { try{return await _http('POST','/user/equip',{userId:id,...data});}catch{return null;} }
async function reportAction(id, g, bal) { try{_http('POST','/action/complete',{userId:id,game:g,choctobits:bal});}catch{} }
async function addCollection(a)    { try{return await _http('POST','/collections/add',{address:a});}catch{return null;} }
async function removeCollection(a) { try{return await _http('POST','/collections/remove',{address:a});}catch{return null;} }
async function debugVerify(w,m)    { try{return await _http('GET',`/debug/verify?wallet=${w}&mint=${m}`);}catch{return null;} }

setTimeout(_connect, 3000);
module.exports = { setEventBroadcast, getCachedState, getUserState, equip, reportAction,
                   addCollection, removeCollection, debugVerify };
