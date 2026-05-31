// QueueDisplay — horizontal queue bar (center, fades after 30s, !queues to revive)
// ActivePanel   — left-side list of players active in the last 10 min
// LurkerPanel   — right-side list of lurking players
//
// CHANGES (UI Layout Update):
//  - Lurker list and Active list now display MAX 5 users at a time
//  - Both lists scroll internally when more than 5 users are present
//  - Count badge always shows the true total even when list is truncated

const ITEMS = [
  {key:'toss',   icon:'🎯', label:'TOSS'},
  {key:'throw',  icon:'🎾', label:'THROW'},
  {key:'dig',    icon:'⛏️',  label:'DIG'},
  {key:'walk',   icon:'🐾', label:'WALK'},
  {key:'fish',   icon:'🎣', label:'FISH'},
  {key:'battle', icon:'⚔️',  label:'BATTLE'},
];
const TTL        = 9000;    // auto-decrement ms
const SHOW_MS    = 30000;   // auto-hide after 30s
const MAX_VISIBLE = 5;      // max rows before internal scroll kicks in

const QueueDisplay = {
  mount:null, EventBus:null,
  counts:{}, timers:{}, els:{},
  _hideTimer:null, _visible:true,
  _activePanel:null,

  async init({mount, EventBus}) {
    this.mount = mount; this.EventBus = EventBus;
    ITEMS.forEach(q => { this.counts[q.key]=0; this.timers[q.key]=[]; });
    this._buildCSS();
    this._buildQueueBar();
    this._buildLurkerPanel();
    this._buildActivePanel();
    this._bind();
    // Start hidden — only !queues reveals it
    if (this._bar) this._bar.classList.add('hidden');
    this._visible = false;
  },

  _buildCSS() {
    if (document.getElementById('qd-css')) return;
    const s = document.createElement('style'); s.id='qd-css';
    s.textContent = `
      @keyframes qdPop{0%{transform:scale(.5);opacity:0}70%{transform:scale(1.25)}100%{transform:scale(1);opacity:1}}
      /* ── Horizontal queue bar (center, fade) ── */
      #qd-bar{
        display:flex;flex-direction:row;align-items:center;gap:6px;
        background:rgba(0,0,0,.88);border:1.5px solid rgba(255,255,255,.15);
        border-radius:18px;padding:10px 18px;
        transition:opacity 1.5s ease;pointer-events:none;
      }
      #qd-bar.hidden{opacity:0;}
      .qd-item{display:flex;flex-direction:column;align-items:center;gap:4px;
        min-width:52px;}
      .qd-icon{font-size:22px;line-height:1;}
      .qd-badge{min-width:28px;height:28px;border-radius:14px;
        display:flex;align-items:center;justify-content:center;
        font-size:15px;font-weight:800;color:#fff;padding:0 6px;}
      .qd-badge.zero{background:rgba(255,255,255,.18);color:rgba(255,255,255,.4);}
      .qd-lbl{font-size:10px;color:rgba(255,255,255,.55);font-family:Consolas,monospace;
        letter-spacing:.07em;font-weight:700;}
      .qd-divider{width:1.5px;height:44px;background:rgba(255,255,255,.12);flex-shrink:0;}

      /* ── Right-side lurker panel ── */
      #lk-panel{position:fixed;bottom:415px;right:20px;
        z-index:50;display:flex;flex-direction:column;gap:8px;min-width:220px;
        max-height:320px;overflow:hidden;
        font-family:Consolas,monospace;pointer-events:none;}
      .lk-head{display:flex;align-items:center;gap:6px;
        background:linear-gradient(135deg,rgba(40,20,70,.92),rgba(20,10,45,.95));
        border:1px solid rgba(150,110,230,.4);border-radius:10px;padding:5px 12px;}
      .lk-head .moon{font-size:16px;}
      .lk-head .title{font-size:11px;font-weight:800;letter-spacing:.1em;color:#c9b3ff;}
      .lk-head .cnt{margin-left:auto;font-size:11px;font-weight:800;color:#fff;
        background:rgba(150,110,230,.45);border-radius:8px;padding:1px 7px;}
      /* ── Scrollable lurker list — max 5 rows ── */
      #lk-list{
        overflow-y:auto;
        max-height:calc(5 * 44px);  /* 5 rows × row height */
        display:flex;flex-direction:column;gap:8px;
        /* Hide scrollbar visually on the overlay */
        scrollbar-width:none;
      }
      #lk-list::-webkit-scrollbar{display:none;}
      /* Subscriber highlight */
      .lk-row.is-sub .lk-name,
      .ap-row.is-sub .ap-name { color:#f0c0ff; font-weight:900; text-shadow:0 0 8px rgba(200,100,255,.7); }
      .sub-badge { font-size:11px; background:rgba(180,80,255,.35);
        border:1px solid rgba(200,100,255,.5); border-radius:6px;
        padding:1px 5px; color:#e0a0ff; font-weight:700; flex-shrink:0; }
      .lk-row{display:flex;align-items:center;gap:6px;
        background:rgba(15,8,30,.85);border:1px solid rgba(150,110,230,.22);
        border-radius:8px;padding:4px 10px;flex-shrink:0;}
      .lk-name{font-size:12px;color:#eee;font-weight:700;white-space:nowrap;
        overflow:hidden;text-overflow:ellipsis;max-width:100px;}
      .lk-lvl{font-size:10px;color:#b0a0d0;font-weight:700;white-space:nowrap;flex-shrink:0;}
      .lk-nft{font-size:10px;color:#f1c40f;flex-shrink:0;}
      .lk-time{margin-left:auto;font-size:11px;font-weight:800;color:#9fe;
        font-variant-numeric:tabular-nums;}
      .lk-empty{font-size:13px;color:rgba(201,179,255,.45);font-style:italic;
        padding:4px 12px;}
      /* Overflow indicator — shows when there are more lurkers below */
      .lk-overflow{font-size:11px;color:rgba(201,179,255,.5);text-align:center;
        padding:2px 6px;letter-spacing:.05em;font-style:italic;}

      /* ── Active players left panel ── */
      #ap-panel{position:fixed;bottom:415px;left:16px;
        z-index:90;display:flex;flex-direction:column;gap:8px;min-width:195px;
        max-height:320px;overflow:hidden;
        pointer-events:none;font-family:Consolas,monospace;}
      .ap-head{display:flex;align-items:center;gap:6px;
        background:linear-gradient(135deg,rgba(20,50,20,.92),rgba(10,30,10,.95));
        border:1px solid rgba(80,200,80,.35);border-radius:10px;padding:5px 12px;}
      .ap-head .icon{font-size:16px;}
      .ap-head .title{font-size:11px;font-weight:800;letter-spacing:.1em;color:#7fdf7f;}
      .ap-head .cnt{margin-left:auto;font-size:11px;font-weight:800;color:#fff;
        background:rgba(80,200,80,.35);border-radius:8px;padding:1px 7px;}
      /* ── Scrollable active list — max 5 rows ── */
      #ap-list{
        overflow-y:auto;
        max-height:calc(5 * 40px);  /* 5 rows × row height */
        display:flex;flex-direction:column;gap:8px;
        scrollbar-width:none;
      }
      #ap-list::-webkit-scrollbar{display:none;}
      .ap-row{display:flex;align-items:center;gap:6px;
        background:rgba(10,25,10,.85);border:1px solid rgba(80,200,80,.2);
        border-radius:8px;padding:4px 10px;flex-shrink:0;}
      .ap-name{font-size:12px;color:#ddd;font-weight:700;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100px;}
      .ap-lvl{font-size:10px;color:#90d090;font-weight:700;white-space:nowrap;flex-shrink:0;}
      .ap-nft{font-size:10px;color:#f1c40f;flex-shrink:0;}
      .ap-star{color:#f1c40f;font-size:11px;flex-shrink:0;margin-left:auto;}
      .ap-empty{font-size:12px;color:rgba(127,223,127,.45);font-style:italic;
        padding:4px 12px;}
      .ap-overflow{font-size:11px;color:rgba(127,223,127,.45);text-align:center;
        padding:2px 6px;letter-spacing:.05em;font-style:italic;}
    `;
    document.head.appendChild(s);
  },

  _buildQueueBar() {
    const bar = document.createElement('div'); bar.id='qd-bar';
    ITEMS.forEach((q, i) => {
      if (i > 0) {
        const div = document.createElement('div'); div.className='qd-divider';
        bar.appendChild(div);
      }
      const item = document.createElement('div'); item.className='qd-item';
      item.innerHTML =
        `<span class="qd-icon">${q.icon}</span>` +
        `<span class="qd-badge zero">0</span>` +
        `<span class="qd-lbl">${q.label}</span>`;
      bar.appendChild(item);
      this.els[q.key] = { badge: item.querySelector('.qd-badge') };
    });
    this.mount.appendChild(bar);
    this._bar = bar;
  },

  _buildLurkerPanel() {
    const panel = document.createElement('div'); panel.id='lk-panel';
    panel.innerHTML =
      `<div class="lk-head"><span class="moon">🌙</span>` +
      `<span class="title">LURKERS</span>` +
      `<span class="cnt" id="lk-cnt">0</span></div>` +
      `<div id="lk-list"></div>`;
    document.body.appendChild(panel);
    this._lkPanel = panel;
    this._lkList  = panel.querySelector('#lk-list');
    this._lkCnt   = panel.querySelector('#lk-cnt');
    this._tickTimer = setInterval(() => this._renderLurkers(), 1000);
  },

  _renderLurkers() {
    if (!this._lkList) return;
    const now    = Date.now();
    const active = (this._lurkers||[]).filter(l => !l.until || l.until > now);
    // Count badge always shows TRUE total
    this._lkCnt.textContent = String(active.length);

    if (!active.length) {
      this._lkList.innerHTML = `<div class="lk-empty">No lurkers</div>`;
      return;
    }

    function fmt(ms) {
      if (ms <= 0) return '0m';
      const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
      return m > 0 ? `${m}m ${s}s` : `${s}s`;
    }

    // Render up to MAX_VISIBLE rows; the container scrolls if there are more
    const visible = active.slice(0, MAX_VISIBLE);
    const extra   = active.length - visible.length;

    let html = visible.map(l => {
      const subCls = l.isSub ? ' is-sub' : '';
      const lvlStr = l.userLevel ? `Lv${l.userLevel}` : '';
      const nftStr = l.hasFav && l.nftLevel ? `★${l.nftLevel}` : (l.hasFav ? '★' : '');
      return `<div class="lk-row${subCls}">` +
        `<span class="lk-name">${l.display || l.userId || '???'}</span>` +
        (lvlStr ? `<span class="lk-lvl">${lvlStr}</span>` : '') +
        (nftStr ? `<span class="lk-nft">${nftStr}</span>` : '') +
        `<span class="lk-time">${fmt(l.until ? l.until - now : 0)}</span>` +
      `</div>`;
    }).join('');

    if (extra > 0) {
      html += `<div class="lk-overflow">+${extra} more lurking…</div>`;
    }

    this._lkList.innerHTML = html;
  },

  _buildActivePanel() {
    const panel = document.createElement('div'); panel.id='ap-panel';
    panel.innerHTML =
      `<div class="ap-head">` +
        `<span class="icon">🎮</span>` +
        `<span class="title">ACTIVE</span>` +
        `<span class="cnt" id="ap-cnt">0</span>` +
      `</div>` +
      `<div id="ap-list"></div>`;
    document.body.appendChild(panel);
    this._apPanel = panel;
    this._apList  = panel.querySelector('#ap-list');
    this._apCnt   = panel.querySelector('#ap-cnt');
    this._renderActive([]);
  },

  _bind() {
    ['toss','throw','dig','walk','fish'].forEach(cmd =>
      this.EventBus.on('event:game', m => { if (m.command===cmd) this._inc(cmd); })
    );
    this.EventBus.on('event:battle',         () => this._inc('battle'));
    this.EventBus.on('event:lurk_update',    m  => this._onLurk(m));
    this.EventBus.on('event:active_players', m  => this._renderActive(m.players||[]));
    this.EventBus.on('event:show_queues',    () => this._revive());
  },

  // ── Queue bar visibility ────────────────────────────────────────────────────
  _scheduleHide() {
    if (this._hideTimer) clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      if (this._bar) this._bar.classList.add('hidden');
      this._visible = false;
    }, SHOW_MS);
  },
  _revive() {
    if (this._bar) this._bar.classList.remove('hidden');
    this._visible = true;
    if (this._bar) this._bar.classList.add('hidden');
    this._visible = false;
  },

  // ── Active players panel ────────────────────────────────────────────────────
  _renderActive(players) {
    if (!this._apList) return;
    // Count badge always shows TRUE total
    this._apCnt.textContent = String(players.length);

    if (!players.length) {
      this._apList.innerHTML = `<div class="ap-empty">No recent players</div>`;
      return;
    }

    // Render up to MAX_VISIBLE rows
    const visible = players.slice(0, MAX_VISIBLE);
    const extra   = players.length - visible.length;

    let html = visible.map(p => {
      const subCls = p.isSub ? ' is-sub' : '';
      const lvlStr = p.userLevel ? `Lv${p.userLevel}` : '';
      const nftStr = p.hasFav && p.nftLevel ? `★${p.nftLevel}` : (p.hasFav ? '★' : '');
      return `<div class="ap-row${subCls}">` +
        `<span class="ap-name">${p.display || p.userId}</span>` +
        (lvlStr ? `<span class="ap-lvl">${lvlStr}</span>` : '') +
        (nftStr ? `<span class="ap-nft">${nftStr}</span>` : '') +
      `</div>`;
    }).join('');

    if (extra > 0) {
      html += `<div class="ap-overflow">+${extra} more active…</div>`;
    }

    this._apList.innerHTML = html;
  },

  _onLurk(m) { this._lurkers = Array.isArray(m.lurkers)?m.lurkers:[]; this._renderLurkers(); },

  _inc(key) {
    this.counts[key]++; this._render(key);
    this.timers[key].push(setTimeout(() => this._dec(key), TTL));
  },
  _dec(key) {
    if (this.counts[key]>0) { this.counts[key]--; this._render(key); }
    this.timers[key].shift();
  },
  _render(key) {
    const { badge } = this.els[key];
    const n = this.counts[key];
    badge.textContent = String(n);
    if (n > 0) {
      badge.classList.remove('zero');
      badge.style.background = n>=5?'#e74c3c':n>=3?'#f39c12':'#2ecc71';
      badge.style.animation='none'; badge.offsetHeight;
      badge.style.animation='qdPop .2s ease both';
    } else {
      badge.classList.add('zero');
      badge.style.background=''; badge.style.animation='';
    }
  },
  destroy() {
    if (this._hideTimer) clearTimeout(this._hideTimer);
    if (this._tickTimer) clearInterval(this._tickTimer);
    if (this._apPanel?.parentNode) this._apPanel.parentNode.removeChild(this._apPanel);
    if (this._lkPanel?.parentNode) this._lkPanel.parentNode.removeChild(this._lkPanel);
  },
};
export default QueueDisplay;
