// YardPets3 — modules/queueDisplay/queueDisplay.js
// Top-left HUD: live queue counts per game type with colour-coded badges.
const ITEMS = [
  {key:'toss',   icon:'🎯', label:'TOSS'},
  {key:'throw',  icon:'🎾', label:'THROW'},
  {key:'dig',    icon:'⛏️', label:'DIG'},
  {key:'walk',   icon:'🐾', label:'WALK'},
  {key:'fish',   icon:'🎣', label:'FISH'},
  {key:'battle', icon:'⚔️', label:'BATTLE'},
];
const TTL = 9000; // ms before auto-decrement

const QueueDisplay = {
  mount:null, EventBus:null,
  counts:{}, timers:{}, els:{},

  async init({mount,EventBus}) {
    this.mount=mount; this.EventBus=EventBus;
    ITEMS.forEach(q=>{ this.counts[q.key]=0; this.timers[q.key]=[]; });
    this._buildDOM();
    this._bind();
  },

  _buildDOM() {
    if (!document.getElementById('qd-css')) {
      const s=document.createElement('style'); s.id='qd-css';
      s.textContent=`
        @keyframes qdPop {0%{transform:scale(.5);opacity:0}70%{transform:scale(1.25)}100%{transform:scale(1);opacity:1}}
        .qd-wrap{display:flex;flex-direction:column;gap:10px;}
        .qd-row{display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.85);border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:8px 18px;}
        .qd-row.empty{opacity:1;}
        .qd-icon{font-size:26px;width:30px;text-align:center;flex-shrink:0;}
        .qd-badge{min-width:30px;height:30px;border-radius:15px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#fff;padding:0 7px;}
        .qd-badge.zero{background:rgba(255,255,255,.18);color:rgba(255,255,255,.5);}
        .qd-lbl{font-size:15px;color:rgba(255,255,255,.65);font-family:Consolas,monospace;letter-spacing:.06em;font-weight:700;}
      `;
      document.head.appendChild(s);
    }
    const wrap=document.createElement('div'); wrap.className='qd-wrap';
    ITEMS.forEach(q=>{
      const row=document.createElement('div'); row.className='qd-row empty';
      row.innerHTML=`<span class="qd-icon">${q.icon}</span><span class="qd-badge zero">0</span><span class="qd-lbl">${q.label}</span>`;
      wrap.appendChild(row);
      this.els[q.key]={row, badge:row.querySelector('.qd-badge')};
    });
    this.mount.appendChild(wrap);
  },

  _bind() {
    ['toss','throw','dig','walk','fish'].forEach(cmd=>{
      this.EventBus.on('event:game', msg=>{ if(msg.command===cmd) this._inc(cmd); });
    });
    this.EventBus.on('event:battle', ()=>this._inc('battle'));
  },

  _inc(key) {
    this.counts[key]++;
    this._render(key);
    const tid=setTimeout(()=>this._dec(key), TTL);
    this.timers[key].push(tid);
  },
  _dec(key) {
    if(this.counts[key]>0){ this.counts[key]--; this._render(key); }
    this.timers[key].shift();
  },
  _render(key) {
    const{row,badge}=this.els[key];
    const n=this.counts[key];
    badge.textContent=String(n);
    if(n>0){
      row.classList.remove('empty'); badge.classList.remove('zero');
      badge.style.background=n>=5?'#e74c3c':n>=3?'#f39c12':'#2ecc71';
      badge.style.animation='none'; badge.offsetHeight;
      badge.style.animation='qdPop .2s ease both';
    } else {
      row.classList.add('empty'); badge.classList.add('zero');
      badge.style.background=''; badge.style.animation='';
    }
  },
};
export default QueueDisplay;
