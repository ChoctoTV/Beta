'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');
const PORT = () => parseInt(process.env.TELLER_PORT||'3003');

function _req(method, ep, body, ms=10000) {
  return new Promise((res,rej) => {
    const p = body?JSON.stringify(body):null;
    const r = http.request({
      hostname:'localhost', port:PORT(), path:ep, method,
      headers:{'Content-Type':'application/json',...(p?{'Content-Length':Buffer.byteLength(p)}:{})},
    }, r2 => { let d=''; r2.on('data',c=>d+=c); r2.on('end',()=>{ try{res({status:r2.statusCode,body:JSON.parse(d)});}catch{res({status:r2.statusCode,body:{}});} }); });
    r.setTimeout(ms, ()=>{ r.destroy(); rej(new Error('teller timeout')); });
    r.on('error', rej);
    if (p) r.write(p);
    r.end();
  });
}

function configured() {
  return fs.existsSync(path.join(process.cwd(),'teller.json')) ||
         fs.existsSync(path.join(process.cwd(),'vault','teller.json'));
}
async function getHealth() { try{const r=await _req('GET','/health',null,3000);return r.body;}catch{return null;} }
async function isVerified(id) { try{const r=await _req('GET',`/verified/${encodeURIComponent(id)}`,null,3000);return r.body?.verified===true;}catch{return false;} }
async function cashout(id, display, choctopus, choctobitsSpent, remainder) {
  try {
    const r = await _req('POST','/cashout',{ username:id, display, choctopus,
      choctobits_spent:choctobitsSpent, remainder }, 120000);
    return r.body;
  } catch(e) { return { ok:false, error:e.message }; }
}
async function vcode(id, display, code) {
  try { const r=await _req('POST','/vcode',{ username:id, twitchUsername:id, twitchDisplay:display, code },10000); return r.body; }
  catch(e) { return { ok:false, error:e.message }; }
}
module.exports = { configured, getHealth, isVerified, cashout, vcode };
