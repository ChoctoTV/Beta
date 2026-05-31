/**
 * ChestGame — Peanut Butter Jar, always on screen.
 * PB level drains visually with each lick. Bigger label text.
 * Queue ensures pups animate one at a time.
 */
const ChestGame = {
  mount:null, _wrap:null, _jar:null, _lid:null, _pbFill:null, _countEl:null,
  _queue:[], _processing:false, _paused:false,
  _lockTarget: 100,   // total licks needed (updated from chest_new)
  _licksDone:  0,     // licks so far this round

  async init({ mount, EventBus }) {
    this.mount = mount;
    this._buildCSS();
    this._buildDOM();
    EventBus.on('event:chest_new',  m => this._onNew(m));
    EventBus.on('event:chest_lick', m => this._onLick(m));
  },

  _onNew(m) {
    this._lockTarget = m.lock || 100;
    this._licksDone  = 0;
    this._updateFill(1.0);         // full jar on new round
    if (this._lid) { this._lid.classList.remove('popped'); void this._lid.offsetWidth; }
    if (this._countEl) this._countEl.textContent = '';
  },

  _onLick(m) {
    // Update fill level from event data
    if (m.lock_target) this._lockTarget = m.lock_target;
    this._licksDone = m.clicks ?? this._licksDone + 1;
    const fillRatio = Math.max(0, 1 - this._licksDone / this._lockTarget);
    this._updateFill(fillRatio);
    if (this._countEl) {
      const remaining = m.lock > 0 ? m.lock : 0;
      this._countEl.textContent = remaining > 0 ? `${remaining} licks left` : 'Opening!';
    }
    this._queue.push(m);
    this._processNext();
  },

  // Fill ratio: 1.0 = completely full, 0 = empty
  _updateFill(ratio) {
    if (!this._pbFill) return;
    // The PB fill rect covers the jar interior.
    // Jar interior: y=50 to y=108 (58px tall). Full = y:50, partial slides up from bottom.
    const maxH   = 58;   // full height of PB in the SVG jar
    const h      = Math.round(maxH * ratio);
    const y      = 50 + (maxH - h);   // top of fill rect
    this._pbFill.setAttribute('y', String(y));
    this._pbFill.setAttribute('height', String(h));
    // Color shifts from rich peanut brown (full) to almost-gone light tan (empty)
    const r = Math.round(180 + (200 - 180) * (1 - ratio));
    const g = Math.round(100 + (185 - 100) * (1 - ratio));
    const b = Math.round(30  + (140 - 30)  * (1 - ratio));
    this._pbFill.setAttribute('fill', `rgb(${r},${g},${b})`);
  },

  _processNext() {
    if (this._paused || this._processing || !this._queue.length) return;
    this._processing = true;
    const m = this._queue.shift();
    const isLast = (m.lock <= 0);
    this._spawnRunner(m.sprite, m.rarity, isLast, () => {
      this._processing = false;
      if (isLast) {
        this._paused = true;
        setTimeout(() => { this._paused = false; this._processNext(); }, 3600);
      } else {
        this._processNext();
      }
    });
  },

  _spawnRunner(spriteName, rarity, isLast, onDone) {
    const SCALE = { common:.75, uncommon:.85, rare:1, epic:1.1, legendary:1.25 };
    const size  = Math.round(64 * (SCALE[rarity] || 1));

    const img = document.createElement('img');
    img.className = 'cg-runner';
    img.style.width  = size + 'px';
    img.style.height = 'auto';
    img.src = `./assets/pups/${rarity||'common'}/${spriteName}.png`;
    img.onerror = () => { img.style.display = 'none'; };

    const jarX     = window.innerWidth / 2 + 168 + 50;
    const fromLeft = Math.random() > 0.3;
    const startX   = fromLeft ? -size - 10 : window.innerWidth + 10;
    const arriveX  = fromLeft ? jarX - size - 8 : jarX + 8;

    img.style.left            = startX + 'px';
    img.style.transform       = fromLeft ? 'scaleX(1)' : 'scaleX(-1)';
    img.style.transitionDuration = '0s';
    document.body.appendChild(img);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        img.style.transitionDuration = '1s';
        img.style.left = arriveX + 'px';

        img.addEventListener('transitionend', () => {
          img.classList.add('licking');

          setTimeout(() => {
            img.classList.remove('licking');

            if (this._jar) {
              this._jar.classList.remove('wiggle'); void this._jar.offsetWidth;
              this._jar.classList.add('wiggle');
              this._jar.addEventListener('animationend',
                () => this._jar.classList.remove('wiggle'), { once:true });
            }

            if (isLast) {
              setTimeout(() => {
                this._openJar();
                img.style.transitionDuration = '.6s';
                img.style.left = startX + 'px';
                img.style.transform = fromLeft ? 'scaleX(-1)' : 'scaleX(1)';
                img.addEventListener('transitionend',
                  () => { img.remove(); onDone?.(); }, { once:true });
              }, 400);
            } else {
              img.style.transitionDuration = '.8s';
              img.style.left = startX + 'px';
              img.style.transform = fromLeft ? 'scaleX(-1)' : 'scaleX(1)';
              img.addEventListener('transitionend',
                () => { img.remove(); onDone?.(); }, { once:true });
            }
          }, 350);
        }, { once:true });
      });
    });
  },

  _openJar() {
    if (this._lid) this._lid.classList.add('popped');
    const emojis = ['🥜','🥜','🍫','🥜','🥜','🍫','🥜','🍫'];
    emojis.forEach((e, i) => {
      setTimeout(() => {
        const p = document.createElement('div'); p.className = 'cg-peanut';
        p.textContent = e;
        p.style.cssText = `left:${10+Math.random()*80}px;top:${10+Math.random()*25}px;
          animation-delay:${Math.random()*.25}s`;
        this._jar?.appendChild(p);
        p.addEventListener('animationend', () => p.remove());
      }, i * 55);
    });
    setTimeout(() => {
      if (this._lid) { this._lid.classList.remove('popped'); }
      this._licksDone  = 0;
      this._updateFill(1.0);   // reset to full for next round
      if (this._countEl) this._countEl.textContent = '';
    }, 3500);
  },

  _buildCSS() {
    if (document.getElementById('cg-css')) return;
    const s = document.createElement('style'); s.id = 'cg-css';
    s.textContent = `
      #cg-wrap{
        position:fixed;bottom:248px;left:calc(50% + 168px);
        display:flex;flex-direction:column;align-items:center;gap:0;
        pointer-events:none;z-index:22;
      }
      /* Lick count below jar */
      #cg-count{
        font-family:Consolas,monospace;font-size:12px;font-weight:700;
        color:rgba(255,220,120,.75);letter-spacing:.05em;
        text-shadow:0 1px 4px rgba(0,0,0,.9);
        text-align:center;min-height:14px;
        margin-top:2px;
      }
      /* "Lick Me!" tag BELOW the jar */
      #cg-tag{
        background:#FFF8DC;border:2px solid #C8882A;border-radius:8px;
        padding:4px 13px;font-family:Consolas,monospace;font-size:18px;
        font-weight:900;color:#8B4513;letter-spacing:.06em;
        box-shadow:0 2px 6px rgba(0,0,0,.4);margin-top:5px;position:relative;
      }
      #cg-tag::before{content:'';position:absolute;top:-8px;left:50%;
        transform:translateX(-50%);border:4px solid transparent;
        border-bottom-color:#C8882A;}

      @keyframes cgWiggle{0%,100%{transform:rotate(0)translateX(0)}
        20%{transform:rotate(-7deg)translateX(-4px)}40%{transform:rotate(7deg)translateX(4px)}
        60%{transform:rotate(-4deg)translateX(-2px)}80%{transform:rotate(4deg)translateX(2px)}}
      #cg-jar.wiggle{animation:cgWiggle .35s ease;}

      @keyframes cgLidPop{0%{transform:translateY(0)rotate(0);opacity:1}
        100%{transform:translateY(-120px)rotate(-40deg);opacity:0}}
      #cg-lid-el.popped{animation:cgLidPop .7s cubic-bezier(.2,0,.2,1) forwards;}

      @keyframes cgPeanut{0%{opacity:1;transform:translateY(0)rotate(0)scale(1)}
        100%{opacity:0;transform:translateY(-70px)rotate(360deg)scale(1.4)}}
      .cg-peanut{position:absolute;font-size:20px;
        animation:cgPeanut 1s ease forwards;pointer-events:none;}

      .cg-runner{position:fixed;bottom:252px;image-rendering:pixelated;
        object-fit:contain;z-index:21;pointer-events:none;
        transition:left 1s ease-in-out;}
      @keyframes cgLickBob{0%,100%{transform:translateY(0)}
        30%{transform:translateY(-12px)rotate(-8deg)}
        60%{transform:translateY(-6px)rotate(4deg)}}
      .cg-runner.licking{animation:cgLickBob .35s ease;}
    `;
    document.head.appendChild(s);
  },

  _buildDOM() {
    this.mount.innerHTML = '';
    const wrap = document.createElement('div'); wrap.id = 'cg-wrap';
    wrap.innerHTML = `
      <div id="cg-jar" style="width:100px;height:120px;position:relative;">
        <svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" width="100" height="120">
          <!-- Jar body outline -->
          <rect x="10" y="30" width="80" height="78" rx="6" fill="#F5E6C8" stroke="#C8A060" stroke-width="2"/>
          <!-- PB fill (dynamic level — starts full) -->
          <rect id="cg-pb-fill" x="13" y="50" width="74" height="58" rx="4" fill="#C8882A"/>
          <!-- PB surface ripple detail (drawn over fill) -->
          <path d="M13 50 Q25 44 37 50 Q49 56 62 50 Q74 44 87 50 L87 55 Q74 49 62 55 Q49 61 37 55 Q25 49 13 55 Z" fill="#D4980E" id="cg-pb-wave"/>
          <!-- Jar highlight -->
          <rect x="15" y="32" width="12" height="70" rx="4" fill="rgba(255,255,255,.22)"/>
          <!-- Label band -->
          <rect x="10" y="62" width="80" height="32" fill="#D4890A" opacity=".9"/>
          <text x="50" y="75" text-anchor="middle" font-size="11" font-family="'Segoe UI',sans-serif" font-weight="800" fill="white" letter-spacing="1">CHOCTO</text>
          <text x="50" y="88" text-anchor="middle" font-size="9" font-family="'Segoe UI',sans-serif" font-weight="700" fill="rgba(255,255,200,.9)">PEANUT BUTTER</text>
          <!-- Jar bottom shadow -->
          <ellipse cx="50" cy="108" rx="40" ry="5" fill="#C8A060" opacity=".6"/>
          <!-- Lid -->
          <g id="cg-lid-el">
            <rect x="8" y="18" width="84" height="16" rx="4" fill="#8B5E1A" stroke="#5C3800" stroke-width="1.5"/>
            <rect x="10" y="19" width="80" height="5" rx="3" fill="rgba(255,255,255,.2)"/>
            <rect x="8" y="27" width="84" height="3" fill="rgba(0,0,0,.12)"/>
            <line x1="22" y1="20" x2="22" y2="33" stroke="rgba(0,0,0,.18)" stroke-width="2"/>
            <line x1="36" y1="20" x2="36" y2="33" stroke="rgba(0,0,0,.18)" stroke-width="2"/>
            <line x1="50" y1="20" x2="50" y2="33" stroke="rgba(0,0,0,.18)" stroke-width="2"/>
            <line x1="64" y1="20" x2="64" y2="33" stroke="rgba(0,0,0,.18)" stroke-width="2"/>
            <line x1="78" y1="20" x2="78" y2="33" stroke="rgba(0,0,0,.18)" stroke-width="2"/>
          </g>
        </svg>
      </div>
      <div id="cg-count"></div>
      <div id="cg-tag">👅 Lick Me!</div>`;
    this.mount.appendChild(wrap);
    this._wrap    = wrap;
    this._jar     = wrap.querySelector('#cg-jar');
    this._lid     = wrap.querySelector('#cg-lid-el');
    this._pbFill  = wrap.querySelector('#cg-pb-fill');
    this._pbWave  = wrap.querySelector('#cg-pb-wave');
    this._countEl = wrap.querySelector('#cg-count');
  },
};
export default ChestGame;
