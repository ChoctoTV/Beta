/**
 * MoraleMeter — morale bar (center-bottom) + in-scene food & water bowls.
 * Bowls sit on the yard ground. When filled, AP count floats to water bowl
 * and lurker count floats to food bowl.
 */
const MoraleMeter = {
  mount:null,
  _score:0, _bonus:100, _food:60, _water:60,
  _foodEl:null, _waterEl:null,

  async init({ mount, EventBus }) {
    this.mount = mount;
    this._buildCSS();
    this._buildMeterBar();
    this._buildInSceneBowls();
    EventBus.on('event:morale_update', m => this._onMorale(m));
    EventBus.on('event:bowl_update',   m => this._onBowls(m));
    EventBus.on('event:bowl_filled',   m => this._onFilled(m));
  },

  _buildCSS() {
    if (document.getElementById('mm-css')) return;
    const s = document.createElement('style'); s.id='mm-css';
    s.textContent = `
      /* ── Meter bar ── */
      #mm-wrap{display:flex;flex-direction:column;align-items:center;gap:4px;
        background:rgba(0,0,0,.80);border:1.5px solid rgba(255,255,255,.15);
        border-radius:14px;padding:8px 18px;backdrop-filter:blur(4px);
        font-family:Consolas,monospace;}
      #mm-label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;
        color:rgba(255,255,255,.6);font-weight:700;}
      #mm-bar{position:relative;width:260px;height:18px;border-radius:9px;overflow:hidden;
        background:linear-gradient(90deg,#c0392b,#555 50%,#2980b9);}
      #mm-marker{position:absolute;top:-3px;width:6px;height:24px;background:#fff;
        border-radius:3px;box-shadow:0 0 6px rgba(0,0,0,.8);
        transform:translateX(-3px);transition:left .9s ease;}
      #mm-tick-lbl{display:flex;justify-content:space-between;width:260px;
        font-size:9px;color:rgba(255,255,255,.4);}
      #mm-bonus{font-size:14px;font-weight:800;color:#f1c40f;
        text-align:center;letter-spacing:.04em;}
      #mm-bowl-note{font-size:9px;color:rgba(255,255,255,.35);text-align:center;
        letter-spacing:.06em;}
      /* ── In-scene bowls (ground-level) ── */
      .sc-bowl{position:fixed;display:flex;flex-direction:column;
        align-items:center;gap:3px;pointer-events:none;z-index:18;}
      .sc-bowl-lbl{font-size:10px;font-weight:800;letter-spacing:.1em;
        color:rgba(255,255,255,.7);text-transform:uppercase;
        text-shadow:0 1px 4px rgba(0,0,0,.9);}
      .sc-bowl svg{filter:drop-shadow(0 3px 6px rgba(0,0,0,.6));}
      .sc-bowl-pct{font-size:10px;font-weight:800;color:rgba(255,255,255,.8);
        text-shadow:0 1px 3px rgba(0,0,0,.9);}
      /* ── Floating number animation ── */
      @keyframes mmFloat{
        0%  {opacity:0;transform:translate(0,0) scale(.7);}
        15% {opacity:1;transform:translate(0,-10px) scale(1);}
        80% {opacity:1;}
        100%{opacity:0;transform:var(--mm-target) scale(1.3);}
      }
      .mm-floater{position:fixed;pointer-events:none;z-index:200;
        font-family:Consolas,monospace;font-size:18px;font-weight:900;
        color:#fff;text-shadow:0 0 8px rgba(0,0,0,.9);
        animation:mmFloat 1.6s cubic-bezier(.2,0,.4,1) forwards;}
    `;
    document.head.appendChild(s);
  },

  _buildMeterBar() {
    this.mount.innerHTML='';
    const wrap=document.createElement('div'); wrap.id='mm-wrap';
    wrap.innerHTML=`
      <div id="mm-label">🐾 MORALE METER</div>
      <div id="mm-bar"><div id="mm-marker"></div></div>
      <div id="mm-tick-lbl">
        <span style="color:#e74c3c">😠 -10</span>
        <span style="color:rgba(255,255,255,.4)">0</span>
        <span style="color:#3498db">+10 😊</span>
      </div>
      <div id="mm-bonus">Morale Bonus: 100 🍫</div>
      <div id="mm-bowl-note">bowl levels affect bonus</div>
    `;
    this.mount.appendChild(wrap);
    this._updateBar();
  },

  _buildInSceneBowls() {
    // Food bowl — right side of yard (lurkers drain it)
    this._foodEl = this._makeBowl('food','🍗 FOOD','#D4774B','rgba(220,150,50,.75)', 'left:16px;bottom:220px');
    // Water bowl — left side of yard (active players drain it)
    this._waterEl= this._makeBowl('water','💧 WATER','#2980b9','rgba(52,152,219,.75)','left:100px;bottom:220px');
    document.body.appendChild(this._foodEl);
    document.body.appendChild(this._waterEl);
    this._updateBowl('food',  this._food);
    this._updateBowl('water', this._water);
  },

  _makeBowl(id, label, stroke, fill, pos) {
    const wrap=document.createElement('div');
    wrap.className='sc-bowl'; wrap.id=`sc-bowl-${id}`;
    wrap.style.cssText=pos+';';
    wrap.innerHTML=`
      <div class="sc-bowl-lbl">${label}</div>
      <svg id="sc-svg-${id}" width="72" height="56" viewBox="0 0 72 56" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <clipPath id="sc-clip-${id}">
            <rect id="sc-cr-${id}" x="4" y="4" width="64" height="48" rx="8"/>
          </clipPath>
        </defs>
        <!-- bowl body outline -->
        <path d="M8 12 Q4 12 4 18 L10 50 Q10 52 14 52 L58 52 Q62 52 62 50 L68 18 Q68 12 64 12 Z"
          fill="rgba(0,0,0,.35)" stroke="${stroke}" stroke-width="2"/>
        <!-- liquid fill (clipped) -->
        <path id="sc-fill-${id}"
          d="M8 12 Q4 12 4 18 L10 50 Q10 52 14 52 L58 52 Q62 52 62 50 L68 18 Q68 12 64 12 Z"
          fill="${fill}" clip-path="url(#sc-clip-${id})" style="transition:all .7s ease;"/>
        <!-- rim highlight -->
        <ellipse cx="36" cy="13" rx="28" ry="5" fill="rgba(255,255,255,.18)"/>
      </svg>
      <div class="sc-bowl-pct" id="sc-pct-${id}">60%</div>
    `;
    return wrap;
  },

  _updateBar() {
    const marker=document.getElementById('mm-marker');
    const bonus =document.getElementById('mm-bonus');
    if (marker) marker.style.left=((this._score+10)/20*260)+'px';
    if (bonus) {
      const b=this._bonus;
      bonus.style.color = b===0?'#e74c3c':b>=150?'#2ecc71':'#f1c40f';
      bonus.textContent = b===0?'No Morale Bonus 😔':`Morale Bonus: ${b} 🍫`;
    }
  },

  _updateBowl(id, pct) {
    const cr  = document.getElementById(`sc-cr-${id}`);
    const lbl = document.getElementById(`sc-pct-${id}`);
    if (cr) {
      const fillH=Math.round(48*pct/100);
      cr.setAttribute('y',  String(52-fillH));
      cr.setAttribute('height',String(fillH));
    }
    if (lbl) lbl.textContent=Math.round(pct)+'%';
  },

  // ── Floating number animation ─────────────────────────────────────────────
  _onFilled(m) {
    // AP count → water bowl (left side)
    // Lurker count → food bowl (right side)
    const apCount  = m.activePlayers || 0;
    const lkCount  = m.lurkers       || 0;
    const waterEl  = document.getElementById('sc-bowl-water');
    const foodEl   = document.getElementById('sc-bowl-food');
    if (apCount > 0 && waterEl) this._floatTo('👥'+apCount, 'left:16px;top:50%',  waterEl, '#3498db');
    if (lkCount > 0 && foodEl)  this._floatTo('🌙'+lkCount, 'right:20px;top:50%', foodEl,  '#f39c12');
  },

  _floatTo(text, fromStyle, toEl, color) {
    const f=document.createElement('div'); f.className='mm-floater';
    f.textContent=text; f.style.color=color;
    // Start position
    fromStyle.split(';').filter(Boolean).forEach(rule=>{
      const [k,v]=rule.split(':'); if(k&&v) f.style[k.trim()]=v.trim();
    });
    document.body.appendChild(f);
    // Calculate vector to bowl center
    requestAnimationFrame(()=>{
      const fr=f.getBoundingClientRect(), tr=toEl.getBoundingClientRect();
      const dx=Math.round((tr.left+tr.width/2)-(fr.left+fr.width/2));
      const dy=Math.round((tr.top +tr.height/2)-(fr.top +fr.height/2));
      f.style.setProperty('--mm-target',`translate(${dx}px,${dy}px)`);
      f.addEventListener('animationend',()=>f.remove());
    });
  },

  _onMorale(m) {
    this._score = m.score || 0;
    this._bonus = m.bonus != null ? m.bonus : 100;
    if (m.foodBowl  != null) { this._food  = m.foodBowl;  this._updateBowl('food',  m.foodBowl);  }
    if (m.waterBowl != null) { this._water = m.waterBowl; this._updateBowl('water', m.waterBowl); }
    this._updateBar();
  },
  _onBowls(m) {
    if (m.food  != null) { this._food  = m.food;  this._updateBowl('food',  m.food);  }
    if (m.water != null) { this._water = m.water; this._updateBowl('water', m.water); }
  },
};
export default MoraleMeter;
