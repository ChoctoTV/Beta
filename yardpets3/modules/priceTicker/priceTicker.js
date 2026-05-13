// YardPets3 — modules/priceTicker/priceTicker.js
// Scrolling ticker: SOL price | CHOCT price | viewer commands (looping)
// Coins managed via !addcoin / !removecoin in Twitch chat.

const HIST       = 20;
const REFRESH_MS = 60_000;
const SCROLL_PPS = 90;
const COINGECKO  = 'https://api.coingecko.com/api/v3/simple/price';
const DEXSCREEN  = 'https://api.dexscreener.com/latest/dex/tokens/';

function sourceOf(id) { return id.length > 20 ? 'dex' : 'cg'; }

function fmt(v) {
  if (v == null || isNaN(v)) return '—';
  if (v >= 1000)  return '$' + v.toLocaleString('en-US', {maximumFractionDigits:0});
  if (v >= 1)     return '$' + v.toFixed(2);
  if (v >= 0.01)  return '$' + v.toFixed(4);
  return '$' + v.toFixed(8);
}

function pctStr(ch) {
  const n = parseFloat(ch);
  if (isNaN(n)) return '';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

// Static viewer command list shown between coin prices
const VIEWER_COMMANDS = [
  { label:'🎯 !toss',     desc:'earn Choctobits'           },
  { label:'🎾 !throw',    desc:'earn Choctobits'           },
  { label:'⛏️ !dig',      desc:'earn Choctobits'           },
  { label:'🐾 !walk',     desc:'walk the yard'             },
  { label:'🎣 !fish',     desc:'catch a pup'               },
  { label:'⚔️ !battle',   desc:'enter Puppy Wars'          },
  { label:'💰 !balance',  desc:'check Choctobits'          },
  { label:'🎒 !inv',      desc:'check items'               },
  { label:'💵 !cashout',  desc:'redeem Choctobits'         },
  { label:'🪵 !vendsticks 100', desc:'sell sticks'         },
  { label:'🎾 !vendballs 100',  desc:'sell balls'          },
  { label:'🌙 !vendmoons 100',  desc:'sell moons'          },
  { label:'⚗️ !forgeballs',     desc:'sticks → balls'      },
  { label:'🔮 !forgemoons',     desc:'balls → moons'       },
  { label:'🎰 !ticket',         desc:'check lottery'       },
  { label:'🎫 !lottoupdate 1342', desc:'set ticket digits 1-4' },
  { label:'😴 !lurk',           desc:'8h auto-play at 33% reward' },
  { label:'🎮 !GBM Good/Ball/Moon', desc:'every 10min RPS for 🍫' },
  { label:'👅 !lick',           desc:'chip at the chest lock for 🍫' },
];

// ── Item renderers ─────────────────────────────────────────────────────────────
function coinItem(c, p) {
  const ch    = parseFloat(p?.ch);
  const chOk  = !isNaN(ch);
  const chCol = chOk ? (ch >= 0 ? '#2ecc71' : '#e74c3c') : '#888';
  return `<div class="t-item">
    <span class="t-sym" style="color:${c.color};text-shadow:0 0 8px ${c.color}55;">${c.sym}</span>
    <span class="t-price">${fmt(p?.price)}</span>
    ${chOk ? `<span class="t-pct" style="color:${chCol};">${pctStr(ch)}</span>` : ''}
  </div>`;
}

function cmdItem(cmd) {
  return `<div class="t-item t-cmd">
    <span class="t-cmd-label">${cmd.label}</span>
    <span class="t-cmd-desc">${cmd.desc}</span>
  </div>`;
}

// Divider between groups
const DIVIDER = `<div class="t-divider">◆</div>`;

function lottoItem(data) {
  if (!data) return '';
  if (data.drawn) {
    const tiers = [
      data.jackpot && `🌟${data.jackpot}`,
      data.epic    && `🟣${data.epic}`,
      data.rare    && `🔵${data.rare}`,
      data.common  && `🟢${data.common}`,
    ].filter(Boolean).join(' ');
    return `<div class="t-item" style="border-color:rgba(255,215,0,.35);background:rgba(255,215,0,.07);">
      <span class="t-sym" style="color:#ffd700;">🎰 LOTTO</span>
      <span class="t-price" style="color:#ffd700;font-size:28px;letter-spacing:4px;">${data.display}</span>
      <span class="t-pct" style="color:#ccc;">${tiers || 'no winners'} · !ticket to check</span>
    </div>`;
  }
  return `<div class="t-item" style="border-color:rgba(255,215,0,.2);">
    <span class="t-sym" style="color:#ffd700;">🎰 LOTTO</span>
    <span class="t-price" style="color:#888;font-size:22px;">Draw at midnight</span>
    <span class="t-pct" style="color:#aaa;">${data.ticketCount||0} ticket${data.ticketCount!==1?'s':''} · 🌟10k 🟣2k 🔵500 🟢100🍫</span>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
const PriceTicker = {
  mount:null, bar:null, inner:null, rafId:null, timer:null, visible:true,
  coins:[],
  prices:{},
  scrollPos:0,
  contentW:0,
  lastTs:null,

  async init({mount, EventBus}) {
    this.mount = mount;
    this.mount.style.cssText = 'position:absolute;top:0;left:0;right:0;pointer-events:none;z-index:30;';

    if (!document.getElementById('ticker-css')) {
      const s = document.createElement('style'); s.id='ticker-css';
      s.textContent = `
        #ticker-bar {
          overflow:hidden; background:rgba(0,0,0,.88);
          border-bottom:2px solid rgba(255,255,255,.14);
          height:76px; display:flex; align-items:center;
        }
        #ticker-inner {
          display:flex; align-items:center;
          white-space:nowrap; will-change:transform;
        }
        .t-item {
          display:inline-flex; align-items:center; gap:14px;
          padding:0 36px; height:76px; flex-shrink:0;
          border-right:1px solid rgba(255,255,255,.08);
        }
        .t-sym   { font-size:30px; font-weight:900; letter-spacing:1.5px;
                   font-family:Consolas,monospace; }
        .t-price { font-size:32px; font-weight:700; color:#fff;
                   font-family:Consolas,monospace; }
        .t-pct   { font-size:26px; font-weight:600;
                   font-family:Consolas,monospace; }
        .t-cmd   { background:rgba(255,255,255,.03); }
        .t-cmd-label { font-size:28px; font-weight:700; color:#f0c040;
                       font-family:Consolas,monospace; }
        .t-cmd-desc  { font-size:24px; color:rgba(255,255,255,.45);
                       font-family:'Segoe UI',system-ui,sans-serif; }
        .t-divider   { display:inline-flex; align-items:center;
                       padding:0 28px; color:rgba(255,255,255,.2);
                       font-size:22px; flex-shrink:0; }
      `;
      document.head.appendChild(s);
    }

    this.bar   = document.createElement('div'); this.bar.id='ticker-bar';
    this.inner = document.createElement('div'); this.inner.id='ticker-inner';
    this.bar.appendChild(this.inner);
    this.mount.appendChild(this.bar);

    EventBus.on('ticker:toggle', ({visible}) => {
      this.visible = visible;
      this.bar.style.display = visible ? 'flex' : 'none';
    });

    // Live coin list updates
    EventBus.on('event:lottery:draw', ({drawn, winners, byTier}) => {
      this.lottoData = {
        drawn, display:drawn.split('').join('-'),
        date:new Date().toISOString().slice(0,10),
        winners, byTier,
        jackpot: byTier?.[4]?.length || 0,
        epic:    byTier?.[3]?.length || 0,
        rare:    byTier?.[2]?.length || 0,
        common:  byTier?.[1]?.length || 0,
      };
      this._buildContent();
    });

    EventBus.on('event:coins_update', ({coins}) => {
      this.coins = coins || [];
      this.fetchAll();
    });

    // Fetch initial coin list from overlay server
    try {
      const r = await fetch('/coins');
      if (r.ok) this.coins = await r.json();
    } catch(e) { console.warn('[Ticker] /coins:', e.message); }

    await this.fetchAll();
    this.timer = setInterval(() => this.fetchAll(), REFRESH_MS);
    this._startScroll();
  },

  // ── Price fetching ───────────────────────────────────────────────────────────
  async fetchAll() {
    const cg  = this.coins.filter(c => sourceOf(c.id) === 'cg');
    const dex = this.coins.filter(c => sourceOf(c.id) === 'dex');
    await Promise.allSettled([
      cg.length ? this._fetchCG(cg) : Promise.resolve(),
      ...dex.map(c => this._fetchDex(c)),
      this._fetchLotto(),
    ]);
    this._buildContent();
  },

  async _fetchLotto() {
    try {
      const r = await fetch('/lottery/today');
      if (r.ok) this.lottoData = await r.json();
    } catch(e) {}
  },

  async _fetchCG(list) {
    try {
      const ids = list.map(c=>c.id).join(',');
      const r   = await fetch(`${COINGECKO}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
      if (!r.ok) return;
      const j = await r.json();
      list.forEach(c => {
        const d = j[c.id]; if (!d) return;
        if (!this.prices[c.sym]) this.prices[c.sym] = {price:null,ch:null};
        this.prices[c.sym].price = d.usd;
        this.prices[c.sym].ch    = d.usd_24h_change;
      });
    } catch(e) { console.warn('[Ticker] CoinGecko:', e.message); }
  },

  async _fetchDex(coin) {
    try {
      const r = await fetch(`${DEXSCREEN}${coin.id}`);
      if (!r.ok) return;
      const j = await r.json();
      if (!j.pairs?.length) return;
      const pair  = j.pairs.sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0];
      const price = parseFloat(pair.priceUsd);
      if (!this.prices[coin.sym]) this.prices[coin.sym] = {price:null,ch:null};
      this.prices[coin.sym].price = isNaN(price) ? null : price;
      this.prices[coin.sym].ch    = pair.priceChange?.h24 ?? null;
    } catch(e) { console.warn(`[Ticker] DexScreener ${coin.sym}:`, e.message); }
  },

  // ── Content: coins | divider | commands | divider | repeat ─────────────────
  _buildContent() {
    const coinItems  = this.coins.map(c => coinItem(c, this.prices[c.sym])).join('');
    const cmdItems   = VIEWER_COMMANDS.map(cmdItem).join('');
    const lottoBlock = lottoItem(this.lottoData);

    const segment = coinItems + DIVIDER + lottoBlock + DIVIDER + cmdItems + DIVIDER;
    this.inner.innerHTML = segment + segment; // duplicate for seamless loop

    requestAnimationFrame(() => {
      this.contentW = this.inner.scrollWidth / 2;
    });
  },

  // ── Scroll loop ──────────────────────────────────────────────────────────────
  _startScroll() {
    const tick = ts => {
      this.rafId = requestAnimationFrame(tick);
      if (this.lastTs !== null && this.visible && this.contentW > 0) {
        const dt = Math.min((ts - this.lastTs) / 1000, 0.1);
        this.scrollPos += SCROLL_PPS * dt;
        if (this.scrollPos >= this.contentW) this.scrollPos -= this.contentW;
        this.inner.style.transform = `translateX(${-this.scrollPos.toFixed(2)}px)`;
      }
      this.lastTs = ts;
    };
    this.rafId = requestAnimationFrame(tick);
  },
};

export default PriceTicker;
