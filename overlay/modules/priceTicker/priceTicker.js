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
  { label:'💵 !cashout',  desc:'redeem for <img src="/assets/choctopi.png" class="choctopi-icon" style="height:1em;vertical-align:middle;" alt="Chocto">Chocto' },
  { label:'🪵 !vendsticks 100', desc:'sell sticks'         },
  { label:'🎾 !vendballs 100',  desc:'sell balls'          },
  { label:'🌙 !vendmoons 100',  desc:'sell moons'          },
  { label:'⚗️ !forgeballs',     desc:'sticks → balls'      },
  { label:'🔮 !forgemoons',     desc:'balls → moons'       },
  { label:'🎰 !ticket',         desc:'check lottery'       },
  { label:'🎫 !lottoupdate 1342', desc:'set ticket digits 1-4' },
  { label:'😴 !lurk',           desc:'8h auto-play at 33% reward' },
  { label:'🎮 !GBM Good/Ball/Moon', desc:'every 10min RPS for 🍫' },
  { label:'👅 !lick',           desc:'lick the peanut butter jar for 🍫' },
];

// ── Item renderers ─────────────────────────────────────────────────────────────
function coinItem(c, p) {
  const ch    = parseFloat(p?.ch);
  const chOk  = !isNaN(ch);
  const chCol = chOk ? (ch >= 0 ? '#2ecc71' : '#e74c3c') : '#888';
  // Rename CHOCT sym to $Choctopus in the display
  const isChocto = c.sym && c.sym.toUpperCase().includes('CHOCT');
  const displaySym = isChocto ? '$Choctopus' : c.sym;
  return `<div class="t-item">
    <span class="t-sym" style="color:${c.color};text-shadow:0 0 8px ${c.color}55;">${displaySym}</span>
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

function annItem(a) {
  if (!a) return '';
  const cls = a.urgent ? 't-ann t-ann-urgent' : 't-ann';
  return `<div class="${cls}">${a.text}</div>`;
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
// Lurker list item (defined outside Ticker object like all other helpers)
function rewardStatsItem(stats) {
  if (!stats) return '';
  const avg = stats.avgHr > 0 ? `🍫 Avg/hr: ${stats.avgHr.toLocaleString()}` : null;
  const top = stats.topUser && stats.topAmt > 0
    ? `⭐ Top last hr: @${stats.topUser} +${stats.topAmt.toLocaleString()}🍫`
    : null;
  if (!avg && !top) return '';
  const parts = [avg, top].filter(Boolean);
  return parts.map(p =>
    `<span style="color:#ffd700;font-weight:700;padding:0 10px;">${p}</span>`
  ).join(DIVIDER);
}

function lurkerItem(lurkers) {
  if (!lurkers || lurkers.length === 0) return '';
  const names = lurkers.map(l => `<span class="t-lurker">😴${l.display}</span>`).join(' ');
  return `<div class="t-item" style="border-left:2px solid #6644aa;">
    <span class="t-sym" style="color:#8855cc;">LURKING</span>
    <span class="t-price" style="color:#aa88ff;font-size:14px;">${names}</span>
  </div>`;
}

const PriceTicker = {
  mount:null, bar:null, inner:null, rafId:null, timer:null, visible:true,
  coins:[],
  prices:{},
  scrollPos:0,
  announcements: [],    // fetched from /announcements
  annIndex:      0,
  lurkers:       [],
  rotationCount: 0,
  _contentHash:  '',    // fingerprint — skip rebuild if content unchanged
  _rewardStats:  null,  // fetched from /reward-stats
  contentW:0,
  lastTs:null,

  async init({mount, EventBus}) {
    this.mount = mount;
    this.mount.style.cssText = 'position:absolute;top:0;left:0;right:0;pointer-events:none;z-index:30;';
    await this._loadTickerFile();

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
    setInterval(() => this._loadTickerFile(), 5 * 60 * 1000);  // reload ticker.txt every 5 min
    this._startScroll();
  },

  // ── Price fetching ───────────────────────────────────────────────────────────
  async _loadTickerFile() {
    try {
      const r = await fetch('/ticker');
      if (r.ok) {
        const items = await r.json();
        if (Array.isArray(items) && items.length) {
          VIEWER_COMMANDS.length = 0;
          items.forEach(i => VIEWER_COMMANDS.push(i));
          console.log(`[Ticker] Loaded ${items.length} entries from ticker.txt`);
        }
      }
    } catch (e) { console.warn('[Ticker] Could not load ticker.txt:', e.message); }
  },

  async fetchAll() {
    const cg  = this.coins.filter(c => sourceOf(c.id) === 'cg');
    const dex = this.coins.filter(c => sourceOf(c.id) === 'dex');
    const today = new Date().toISOString().slice(0, 10);
    const needsLotto = !localStorage.getItem(`choctotv_lotto_${today}`);
    await Promise.allSettled([
      cg.length ? this._fetchCG(cg) : Promise.resolve(),
      ...dex.map(c => this._fetchDex(c)),
      needsLotto ? this._fetchLotto() : Promise.resolve(),
      this._fetchAnnouncements(),
      this._fetchRewardStats(),
      this._fetchSolBinance(),   // always fetch SOL directly — never skip
    ]);
    this._buildContent();
  },

  async _fetchAnnouncements() {
    try {
      const r = await fetch('/announcements');
      if (r.ok) this.announcements = await r.json();
    } catch(e) { console.warn('[Ticker] announcements:', e.message); }
    // Lurk updates arrive via WS
    EventBus.on('event:lurk_update', ev => {
      this.lurkers = ev.lurkers || [];
      // Debounce: lurk fires every 3-5s per user — don't rebuild on every single one
      if (this._lurkRebuildTimer) clearTimeout(this._lurkRebuildTimer);
      this._lurkRebuildTimer = setTimeout(() => this._buildContent(), 2000);
    });
    try {
    } catch {}
  },

  async _fetchRewardStats() {
    try {
      const r = await fetch('/reward-stats');
      if (r.ok) this._rewardStats = await r.json();
    } catch {}
  },

  async _fetchLotto() {
    try {
      const today   = new Date().toISOString().slice(0, 10);
      const cacheKey= `choctotv_lotto_${today}`;
      // Use localStorage cache — lottery only changes at midnight
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        this.lottoData = JSON.parse(cached);
        return;
      }
      const r = await fetch('/lottery/today');
      if (r.ok) {
        const data = await r.json();
        this.lottoData = data;
        // Cache for the day — clear yesterday's entries
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith('choctotv_lotto_') && k !== cacheKey) localStorage.removeItem(k);
        }
        localStorage.setItem(cacheKey, JSON.stringify(data));
      }
    } catch(e) {}
  },

  async _fetchCG(list) {
    try {
      // Always include SOL (Solana) — it's the pairing coin for Choctopus
      const solanaId = 'solana';
      const allIds   = [...new Set([...list.map(c=>c.id), solanaId])];
      const ids = allIds.join(',');
      const r   = await fetch(`${COINGECKO}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
      if (!r.ok) { await this._fetchSolBinance(); return; }
      const j = await r.json();
      // Store individual coin prices
      list.forEach(c => {
        const d = j[c.id]; if (!d) return;
        if (!this.prices[c.sym]) this.prices[c.sym] = {price:null,ch:null};
        this.prices[c.sym].price = d.usd;
        this.prices[c.sym].ch    = d.usd_24h_change;
      });
    } catch(e) {
      console.warn('[Ticker] CoinGecko:', e.message);
      await this._fetchSolBinance();
    }
  },

  // Free public Binance ticker — works without keys, no rate limit issues
  async _fetchSolBinance() {
    try {
      // Use server-side proxy to avoid CORS issues in the browser overlay
      const r = await fetch('/sol-price');
      if (!r.ok) return;
      const j = await r.json();
      if (j.price !== null && j.price !== undefined) {
        this.prices['__SOL__'] = { price: j.price, ch: j.ch };
      }
    } catch (e) { console.warn('[Ticker] SOL price fetch:', e.message); }
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
    // Compute a quick fingerprint — skip the innerHTML rebuild if nothing changed.
    // This prevents scroll position resets during stable periods.
    const urgents = (this.announcements||[]).filter(a=>a.urgent);
    const normals = (this.announcements||[]).filter(a=>!a.urgent);
    const ann = normals[this.annIndex % Math.max(1, normals.length)];
    const fp = [
      this.coins.map(c=>`${c.sym}:${(this.prices[c.sym]||{}).price||''}`).join(','),
      (this.prices['__SOL__']||{}).price||'',
      this.lurkers.map(l=>l.userId).join(','),
      urgents.map(a=>a.text).join('|'),
      ann?.text||'',
      this.lottoData?.prize||'',
      (this._rewardStats?.avgHr||0) + ':' + (this._rewardStats?.topUser||''),
    ].join(';');
    if (fp === this._contentHash) return;  // nothing changed — keep scrolling uninterrupted
    this._contentHash = fp;

    // Build coin items — SOL always first as the anchor/pairing coin
    const solPrice = this.prices['__SOL__'];
    const solItemHtml = coinItem({ sym:'SOL', color:'#9945FF' }, solPrice || { price:null, ch:null });
    const otherCoinItems = this.coins.map(c => coinItem(c, this.prices[c.sym])).join('');
    const coinItems = solItemHtml + (otherCoinItems ? DIVIDER + otherCoinItems : '');
    const cmdItems   = VIEWER_COMMANDS.map(cmdItem).join('');
    const lottoBlock = lottoItem(this.lottoData);

    let annBlock = '';
    urgents.forEach(a => { annBlock += annItem(a); });
    if (normals.length && this.rotationCount % 3 === 0) {
      annBlock += annItem(ann);
    }

    const lurkBlock   = lurkerItem(this.lurkers);
    const rewardBlock = rewardStatsItem(this._rewardStats);
    const segment = coinItems + DIVIDER
      + (lottoBlock   ? lottoBlock   + DIVIDER : '')
      + (lurkBlock    ? lurkBlock    + DIVIDER : '')
      + (rewardBlock  ? rewardBlock  + DIVIDER : '')
      + (annBlock     ? annBlock     + DIVIDER : '')
      + cmdItems + DIVIDER;
    this.inner.innerHTML = segment + segment; // duplicate for seamless loop
    // Measure width synchronously now — innerHTML assignment already forced layout.
    // Doing it inside another rAF caused a second layout per build → frame stutter.
    this.contentW = this.inner.scrollWidth / 2;
  },

  // ── Scroll loop ──────────────────────────────────────────────────────────────
  _startScroll() {
    // No fps throttle here — transform writes are GPU-composited (essentially free).
    // dt-capping prevents jumps if the tab is backgrounded.
    const tick = ts => {
      this.rafId = requestAnimationFrame(tick);
      const elapsed = (this.lastTs != null) ? ts - this.lastTs : 16;
      this.lastTs = ts;
      if (this.visible && this.contentW > 0) {
        const dt = Math.min(elapsed / 1000, 0.1);  // never jump more than 100ms worth
        this.scrollPos += SCROLL_PPS * dt;
        if (this.scrollPos >= this.contentW) {
          this.scrollPos -= this.contentW;
          this.rotationCount++;
          // Only rebuild when an announcement slot actually changes (every 3rd rotation
          // if there are normals). Defer the rebuild out of the rAF loop via setTimeout
          // so it doesn't block the next frame and cause stutter.
          const normals = (this.announcements||[]).filter(a=>!a.urgent);
          const needsRebuild = normals.length && this.rotationCount % 3 === 0;
          if (needsRebuild && !this._rebuildPending) {
            this._rebuildPending = true;
            setTimeout(() => {
              this._rebuildPending = false;
              this.annIndex = (this.annIndex + 1) % normals.length;
              this._buildContent();
            }, 0);
          }
        }
        this.inner.style.transform = `translateX(${-this.scrollPos.toFixed(2)}px)`;
      }
    };
    this.rafId = requestAnimationFrame(tick);
  },
};

export default PriceTicker;
