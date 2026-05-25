'use strict';
const fs   = require('fs');
const path = require('path');
const ANN  = path.join(process.cwd(), 'announcements.txt');
const ARC  = path.join(process.cwd(), 'announcementsArchive.txt');
let _last  = '';

function parseAll() {
  if (!fs.existsSync(ANN)) return [];
  return fs.readFileSync(ANN,'utf8').split('\n')
    .map(l=>l.trim()).filter(l=>l.startsWith('exp_date'))
    .map(l=>{ const m=l.match(/^exp_date(\d{8})\s+message:\s*(.*?)\s*(\*u|\*)\s*$/); return m?{dateStr:m[1],text:m[2].trim(),urgent:m[3]==='*u',raw:l}:null; })
    .filter(Boolean);
}
function expire(broadcast) {
  const all=parseAll(), now=new Date(), keep=[], expire=[];
  for (const a of all) {
    if (a.dateStr==='00000000'){keep.push(a);continue;}
    const d=a.dateStr.slice(0,2),mo=a.dateStr.slice(2,4),y=a.dateStr.slice(4);
    new Date(Date.UTC(+y,+mo-1,+d)) <= now ? expire.push(a) : keep.push(a);
  }
  if (expire.length) {
    fs.writeFileSync(ANN, keep.map(a=>a.raw).join('\n')+(keep.length?'\n':''));
    fs.appendFileSync(ARC, expire.map(a=>`[expired:${now.toISOString()}] ${a.raw}`).join('\n')+'\n');
  }
  if (broadcast) broadcast({ type:'announcements', announcements:getAll() });
}
function getAll()        { return parseAll().map(a=>({ text:`${a.urgent?'★★★':'★'} ${a.text} ${a.urgent?'★★★':'★'}`, urgent:a.urgent })); }
function setLastShown(t) { _last=t; }
function getLastShown()  { return _last; }

module.exports = {
  name:'lastannounce', aliases:['announce','urgent'], permissions:'viewer', cooldown:false,
  expire, getAll, setLastShown, getLastShown,
  execute(ctx) {
    const { cmd, say } = ctx;
    if (cmd==='urgent') {
      const u=getAll().filter(a=>a.urgent);
      u.length ? u.forEach(a=>say(`🚨 ${a.text}`)) : say(`📢 No urgent announcements`);
    } else {
      say(_last ? `📢 ${_last}` : `📢 No announcement yet`);
    }
    return { ok:true };
  },
};
