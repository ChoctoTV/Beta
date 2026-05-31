/**
 * Classifieds module — permanent bottom layer newspaper scroll.
 * Fetches Choctonaut Army listings hourly from /classifieds.
 * Scrolls continuously right→left. Battles pop up over it at higher z-index.
 */

const GAME_ICONS    = { walk:'🐾', toss:'🎯', throw:'🎾', dig:'⛏️', fish:'🎣' };
const WEATHER_ICONS = { sunny:'☀️', cloudy:'☁️', rainy:'🌧️', stormy:'⛈️', snowy:'❄️', windy:'💨' };

const Classifieds = {
  mount: null, EventBus: null, CONFIG: null,
  _nfts: [], _imgCache: new Map(), _timer: null,

  async init({ mount, EventBus, CONFIG }) {
    this.mount    = mount;
    this.EventBus = EventBus;
    this.CONFIG   = CONFIG;

    // Newspaper CSS
    if (!document.getElementById('__clsCSS')) {
      const st = document.createElement('style'); st.id = '__clsCSS';
      st.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=UnifrakturMaguntia&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap');
        .cls-wrap   { position:absolute;inset:0;overflow:hidden;display:flex;flex-direction:column;
                      background:#f2ead8;
                      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Crect width='4' height='4' fill='%23f2ead8'/%3E%3Ccircle cx='1' cy='1' r='.4' fill='%23d8cebc' opacity='.5'/%3E%3C/svg%3E"); }
        .cls-banner { display:flex;align-items:baseline;gap:16px;padding:4px 20px 3px;border-bottom:2.5px solid #1a1a1a;flex-shrink:0; }
        .cls-title  { font-family:'UnifrakturMaguntia','Times New Roman',serif;font-size:24px;color:#1a1a1a;letter-spacing:.03em; }
        .cls-rule   { font-family:'Libre Baskerville',Georgia,serif;font-size:18px;letter-spacing:.15em;text-transform:uppercase;color:#1a1a1a; }
        .cls-date   { font-family:'Libre Baskerville',Georgia,serif;font-size:18px;color:#555;font-style:italic;margin-left:auto;white-space:nowrap; }
        .cls-track  { flex:1;overflow:hidden;display:flex;align-items:center;contain:layout style; }
        .cls-inner  { display:flex;align-items:center;flex-shrink:0;gap:0;will-change:transform; }
        .cls-inner.running { animation:clsScroll var(--cls-dur,60s) linear infinite; }

        /* ~2 cards visible at 1920px — 900px each with a sliver of the 3rd showing */
        .cls-card   { flex-shrink:0;width:900px;border-right:2px solid #1a1a1a;position:relative;
                      padding:10px 20px;gap:20px;
                      display:flex;align-items:center;background:#f5edda;
                      position:relative;height:100%;box-sizing:border-box; }
        .cls-card::before { content:'';position:absolute;inset:4px;border:.5px dashed rgba(26,26,26,.2);pointer-events:none; }
        .cls-photo  { width:168px;height:168px;object-fit:cover;flex-shrink:0;
                      border:2px solid #1a1a1a;filter:contrast(1.08) sepia(.15); }
        .cls-text   { flex:1;overflow:hidden;font-family:'Libre Baskerville',Georgia,serif;color:#1a1a1a; }
        /* desc: top line, word-wraps to fill available space */
        .cls-desc   { font-size:34px;color:#222;font-style:italic;line-height:1.35;
                      word-wrap:break-word;white-space:normal;overflow:hidden;
                      display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2; }
        /* price + !read on the SAME line — price left, read right */
        .cls-bottom { display:flex;justify-content:space-between;align-items:baseline;
                      margin-top:14px;gap:16px; }
        .cls-price  { font-size:36px;font-weight:800;color:#1a1a1a;flex-shrink:0; }
        .cls-cmd    { font-size:28px;font-family:'Libre Baskerville',Georgia,serif;
                      color:#555;font-style:italic;letter-spacing:.02em;text-align:right; }
      `;
      document.head.appendChild(st);
    }

    // Build mount structure
    this.mount.innerHTML = '';
    this.wrap = document.createElement('div'); this.wrap.className = 'cls-wrap';
    this.wrap.innerHTML = `
      <div class="cls-banner">
        <span class="cls-title">The Choctonaut Chronicle</span>
        <span class="cls-rule">★ Adoption Classifieds ★ Pups Seeking Good Homes ★</span>
        <span class="cls-date" id="__clsDate"></span>
      </div>
      <div class="cls-track"><div class="cls-inner" id="__clsInner"></div></div>
    `;
    this.mount.appendChild(this.wrap);
    const d = this.wrap.querySelector('#__clsDate');
    if (d) d.textContent = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});

    // Image blob cache — 1 hour TTL
    this._cacheImg = async url => {
      if (!url) return null;
      if (this._imgCache.has(url)) return this._imgCache.get(url);
      try {
        const r = await fetch(url); if (!r.ok) return url;
        const blobUrl = URL.createObjectURL(await r.blob());
        this._imgCache.set(url, blobUrl); return blobUrl;
      } catch { return url; }
    };
    setInterval(() => {
      for (const b of this._imgCache.values()) try { URL.revokeObjectURL(b); } catch {}
      this._imgCache.clear();
    }, 3600000);

    // Render the scroll strip
    await this._render();

    // ── Spotlight overlay for !read command ─────────────────────────────────
    // Injected into the #spotlight-mount (z-index 150, above everything)
    this._spotlight = document.getElementById('spotlight-mount');

    this._showSpotlight = async (nft, index) => {
      if (!this._spotlight) return;
      const imgSrc = await this._cacheImg(nft.image);
      const name    = nft.name    || 'Choctonaut';
      const mintNum = nft.mintNum ? `#${nft.mintNum}` : '';
      const price   = nft.price   ? `${nft.price} SOL` : 'Make an offer';
      const url     = nft.url     ? nft.url.replace('https://','') : 'magiceden.io';
      const desc    = nft.desc    || 'Loyal companion. Seeks a good home.';
      const gIcon   = {walk:'🐾',toss:'🎯',throw:'🎾',dig:'⛏️',fish:'🎣'}[nft.favGame]   || '';
      const wIcon   = {sunny:'☀️',cloudy:'☁️',rainy:'🌧️',stormy:'⛈️',snowy:'❄️',windy:'💨'}[nft.favWeather] || '';

      // Card color tier based on price
      const priceVal = parseFloat(nft.price) || 0;
      const tier = priceVal >= 15 ? 'legendary'
                 : priceVal >= 5  ? 'epic'
                 : priceVal >= 1  ? 'rare'
                 : priceVal > 0   ? 'common'
                 : 'free';
      const TIERS = {
        legendary: { from:'#c8960c', mid:'#f5d060', to:'#c8960c', glow:'#ffd700', txt:'#fff8dc', badge:'✦ LEGENDARY' },
        epic:      { from:'#6a0dad', mid:'#b44fdc', to:'#6a0dad', glow:'#c77dff', txt:'#f3e0ff', badge:'◆ EPIC'      },
        rare:      { from:'#0057b7', mid:'#4da6ff', to:'#0057b7', glow:'#4da6ff', txt:'#ddf0ff', badge:'● RARE'      },
        common:    { from:'#2d6a2d', mid:'#5aad5a', to:'#2d6a2d', glow:'#7ec87e', txt:'#e6ffe6', badge:'○ COMMON'    },
        free:      { from:'#444',    mid:'#888',    to:'#444',    glow:'#aaa',    txt:'#eee',    badge:'◌ UNLISTED'  },
      };
      const c = TIERS[tier];

      this._spotlight.style.display = 'block';
      this._spotlight.innerHTML = `
        <style>
          @keyframes cardIn  { from{opacity:0;transform:translateY(40px) scale(.92)} to{opacity:1;transform:translateY(0) scale(1)} }
          @keyframes cardOut { from{opacity:1;transform:scale(1)} to{opacity:0;transform:scale(.88)} }
          @keyframes holo    { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
          @keyframes borderSpin { to{transform:rotate(360deg)} }
          @keyframes shimmer {
            0%   { background-position: -200% center }
            100% { background-position:  200% center }
          }
        </style>

        <div id="__spl" style="
          position:fixed;bottom:230px;right:270px;z-index:9999;
          animation:cardIn .5s cubic-bezier(.22,1,.36,1) both;">

          <!-- Card wrapper with spinning gradient border -->
          <div style="position:relative;padding:4px;border-radius:22px;
            background:linear-gradient(135deg,${c.from},${c.mid},${c.to},${c.mid},${c.from});
            background-size:300% 300%;
            animation:holo 4s ease infinite;
            box-shadow:0 0 40px ${c.glow}88, 0 0 80px ${c.glow}44, 0 24px 60px rgba(0,0,0,.8);
          ">

            <!-- The card itself -->
            <div style="
              width:420px;
              background:linear-gradient(170deg,${c.from}dd 0%,#0a0a0f 40%,#0a0a0f 100%);
              border-radius:18px;
              overflow:hidden;
              font-family:'Segoe UI',system-ui,sans-serif;
              position:relative;
            ">

              <!-- Holographic shimmer overlay -->
              <div style="position:absolute;inset:0;border-radius:18px;pointer-events:none;z-index:10;
                background:linear-gradient(105deg,transparent 20%,rgba(255,255,255,.06) 30%,rgba(255,255,255,.12) 45%,transparent 55%);
                background-size:200% 100%;
                animation:shimmer 3s linear infinite;
              "></div>

              <!-- Header strip -->
              <div style="
                padding:14px 18px 10px;
                background:linear-gradient(90deg,${c.from}cc,${c.mid}88);
                display:flex;justify-content:space-between;align-items:center;
              ">
                <span style="font-size:11px;font-weight:800;letter-spacing:.18em;
                  text-transform:uppercase;color:${c.txt};opacity:.9;">
                  Choctonaut Army
                </span>
                <span style="font-size:11px;font-weight:700;color:${c.txt};
                  background:rgba(0,0,0,.35);padding:3px 10px;border-radius:20px;
                  letter-spacing:.1em;">
                  ${c.badge}
                </span>
              </div>

              <!-- NFT Image -->
              <div style="position:relative;overflow:hidden;background:#000;height:380px;">
                <img src="${imgSrc||''}" onerror="this.style.display='none'" style="
                  width:100%;height:100%;object-fit:cover;
                  display:block;
                ">
                <!-- Image bottom fade -->
                <div style="position:absolute;bottom:0;left:0;right:0;height:100px;
                  background:linear-gradient(transparent,#0a0a0f);"></div>
                <!-- Mint number badge -->
                ${mintNum ? `<div style="position:absolute;top:10px;right:12px;
                  background:rgba(0,0,0,.7);color:${c.txt};
                  font-size:13px;font-weight:700;padding:4px 12px;border-radius:20px;
                  letter-spacing:.05em;backdrop-filter:blur(4px);">${mintNum}</div>` : ''}
              </div>

              <!-- Name banner -->
              <div style="
                padding:0 20px;
                margin-top:-28px;
                position:relative;z-index:5;
              ">
                <div style="font-size:34px;font-weight:800;color:#fff;line-height:1.1;
                  text-shadow:0 2px 12px rgba(0,0,0,.9);">${name}</div>
              </div>

              <!-- Stats section -->
              <div style="padding:12px 20px 8px;">
                <div style="font-size:13px;color:#aaa;font-style:italic;
                  line-height:1.5;margin-bottom:10px;">${desc}</div>

                ${(gIcon||wIcon) ? `
                <div style="display:flex;gap:12px;margin-bottom:10px;">
                  ${gIcon ? `<div style="flex:1;background:rgba(255,255,255,.07);border-radius:10px;
                    padding:8px 12px;text-align:center;">
                    <div style="font-size:20px;">${gIcon}</div>
                    <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-top:2px;">
                      ${nft.favGame||''}
                    </div>
                  </div>` : ''}
                  ${wIcon ? `<div style="flex:1;background:rgba(255,255,255,.07);border-radius:10px;
                    padding:8px 12px;text-align:center;">
                    <div style="font-size:20px;">${wIcon}</div>
                    <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-top:2px;">
                      ${nft.favWeather||''}
                    </div>
                  </div>` : ''}
                </div>` : ''}
              </div>

              <!-- Price + URL footer -->
              <div style="
                margin:4px 14px 14px;
                background:linear-gradient(135deg,${c.from}44,${c.mid}22);
                border:1px solid ${c.glow}44;
                border-radius:12px;
                padding:12px 16px;
              ">
                <div style="font-size:24px;font-weight:800;color:#fff;margin-bottom:4px;">
                  ${price}
                </div>
                <div style="font-size:11px;color:#888;word-break:break-all;">${url}</div>
              </div>

              <!-- Card number footer -->
              <div style="
                padding:8px 20px;background:rgba(0,0,0,.4);
                display:flex;justify-content:space-between;align-items:center;
              ">
                <span style="font-size:10px;color:#555;letter-spacing:.1em;">
                  ${index}/${this._nfts.length}
                </span>
                <span style="font-size:10px;color:#555;letter-spacing:.06em;">
                  CHOCTONAUT ARMY &nbsp;·&nbsp; MAGICEDEN
                </span>
              </div>

            </div><!-- card -->
          </div><!-- border wrapper -->

          <!-- Dismiss hint -->
          <div style="position:absolute;bottom:32px;
            font-size:14px;color:rgba(255,255,255,.35);letter-spacing:.08em;">
            AUTO-DISMISS IN 15s
          </div>
        </div>
      `;

      // Auto-dismiss after 15 seconds
      if (this._splTimer) clearTimeout(this._splTimer);
      this._splTimer = setTimeout(() => {
        const el = document.getElementById('__spl');
        if (el) {
          el.style.animation = 'splOut .4s ease forwards';
          setTimeout(() => { if(this._spotlight) this._spotlight.style.display='none'; }, 400);
        }
      }, 15000);
    };

    // ── FavPup trading card — same style as classified card, ownership theme ──
    this._showFavPupCard = async (nft, requestedBy) => {
      if (!this._spotlight) return;
      const imgSrc   = await this._cacheImg(nft.image);
      const name     = nft.name    || 'Choctonaut';
      const mintNum  = nft.mintNum ? `#${nft.mintNum}` : '';
      const owner    = nft.owner   || requestedBy || '?';
      const gIcon    = {walk:'🐾',toss:'🎯',throw:'🎾',dig:'⛏️',fish:'🎣'}[nft.favGame]    || '❓';
      const wIcon    = {sunny:'☀️',cloudy:'☁️',rainy:'🌧️',stormy:'⛈️',snowy:'❄️',windy:'💨'}[nft.favWeather] || '❓';
      const gameLbl  = nft.favGame    ? nft.favGame.charAt(0).toUpperCase()+nft.favGame.slice(1)    : 'Unknown';
      const wxLbl    = nft.favWeather ? nft.favWeather.charAt(0).toUpperCase()+nft.favWeather.slice(1) : 'Unknown';

      this._spotlight.style.display = 'block';
      const lvl     = nft.level || 1;
      const xpPct   = nft.xpPct ?? 0;
      const xpLabel = nft.level >= 99
        ? '⭐ MAX LEVEL'
        : `${nft.xpInLevel || 0} / ${nft.xpToNext || '?'} XP`;
      const lvlBar  = '▓'.repeat(Math.round(xpPct/10)) + '░'.repeat(10-Math.round(xpPct/10));

      this._spotlight.innerHTML = `
        <style>
          @keyframes cardIn  { from{opacity:0;transform:translateY(40px) scale(.92)} to{opacity:1;transform:translateY(0) scale(1)} }
          @keyframes cardOut { from{opacity:1;transform:scale(1)} to{opacity:0;transform:scale(.88)} }
          @keyframes holo    { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
          @keyframes shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
        </style>
        <div id="__spl" style="
          position:fixed;bottom:230px;right:480px;z-index:9999;
          animation:cardIn .5s cubic-bezier(.22,1,.36,1) both;">

          <!-- Holographic border — purple/teal owner theme -->
          <div style="position:relative;padding:4px;border-radius:22px;
            background:linear-gradient(135deg,#0e7c7b,#7c0e7c,#0e7c7b,#7c0e7c,#0e7c7b);
            background-size:300% 300%;animation:holo 4s ease infinite;
            box-shadow:0 0 40px #7c0e7c88,0 0 80px #0e7c7b44,0 24px 60px rgba(0,0,0,.8);">

            <div style="width:420px;background:linear-gradient(170deg,#0e2a2add 0%,#0a0a0f 40%,#0a0a0f 100%);
              border-radius:18px;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;position:relative;">

              <!-- Shimmer overlay -->
              <div style="position:absolute;inset:0;border-radius:18px;pointer-events:none;z-index:10;
                background:linear-gradient(105deg,transparent 20%,rgba(255,255,255,.06) 30%,rgba(255,255,255,.12) 45%,transparent 55%);
                background-size:200% 100%;animation:shimmer 3s linear infinite;"></div>

              <!-- Header -->
              <div style="padding:14px 18px 10px;
                background:linear-gradient(90deg,#0e7c7bcc,#7c0e7c88);
                display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:11px;font-weight:800;letter-spacing:.18em;
                  text-transform:uppercase;color:#e0ffff;opacity:.9;">Choctonaut Army</span>
                <span style="font-size:11px;font-weight:700;color:#e0ffff;
                  background:rgba(0,0,0,.35);padding:3px 10px;border-radius:20px;letter-spacing:.1em;">
                  ★ FAV PUP
                </span>
              </div>

              <!-- NFT Image -->
              <div style="position:relative;overflow:hidden;background:#000;height:340px;">
                <img src="${imgSrc||''}" onerror="this.style.display='none'" style="width:100%;height:100%;object-fit:cover;display:block;">
                <div style="position:absolute;bottom:0;left:0;right:0;height:100px;background:linear-gradient(transparent,#0a0a0f);"></div>
                ${mintNum ? `<div style="position:absolute;top:10px;right:12px;
                  background:rgba(0,0,0,.7);color:#e0ffff;font-size:13px;font-weight:700;
                  padding:4px 12px;border-radius:20px;letter-spacing:.05em;">${mintNum}</div>` : ''}
              </div>

              <!-- Name -->
              <div style="padding:0 20px;margin-top:-28px;position:relative;z-index:5;">
                <div style="font-size:34px;font-weight:800;color:#fff;line-height:1.1;
                  text-shadow:0 2px 12px rgba(0,0,0,.9);">${name}</div>
              </div>

              <!-- Owner + Daily Bonuses -->
              <div style="padding:12px 20px 8px;">
                <div style="font-size:14px;color:#aaa;margin-bottom:12px;">
                  🏠 &nbsp;<span style="color:#7cf0f0;font-weight:700;">@${owner}</span>
                </div>
                <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px;">
                  Today's Bonuses
                </div>
                <div style="display:flex;gap:12px;">
                  <div style="flex:1;background:rgba(255,255,255,.07);border-radius:10px;padding:10px 14px;text-align:center;">
                    <div style="font-size:26px;">${gIcon}</div>
                    <div style="font-size:11px;color:#e0ffff;font-weight:700;margin-top:4px;">${gameLbl}</div>
                    <div style="font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.1em;">Fav Game</div>
                  </div>
                  <div style="flex:1;background:rgba(255,255,255,.07);border-radius:10px;padding:10px 14px;text-align:center;">
                    <div style="font-size:26px;">${wIcon}</div>
                    <div style="font-size:11px;color:#e0ffff;font-weight:700;margin-top:4px;">${wxLbl}</div>
                    <div style="font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.1em;">Fav Weather</div>
                  </div>
                </div>
              </div>

              <!-- Level Bar -->
              <div style="padding:0 20px 12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                  <span style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.1em;">Level</span>
                  <span style="font-size:13px;font-weight:800;color:#f0e0ff;">${lvl >= 99 ? '⭐ 99' : lvl}</span>
                </div>
                <div style="background:rgba(255,255,255,.1);border-radius:6px;height:8px;overflow:hidden;">
                  <div style="height:100%;width:${xpPct}%;background:linear-gradient(90deg,#0e7c7b,#a855f7);border-radius:6px;transition:width .4s;"></div>
                </div>
                <div style="font-size:10px;color:#666;margin-top:4px;text-align:right;">${xpLabel}</div>
              </div>

              <!-- Footer -->
              <div style="padding:10px 20px;background:rgba(0,0,0,.4);
                display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:10px;color:#555;letter-spacing:.06em;">CHOCTONAUT ARMY</span>
                <span style="font-size:10px;color:#555;">+10% when active today</span>
              </div>
            </div>
          </div>

        </div>`;

      if (this._splTimer) clearTimeout(this._splTimer);
      this._splTimer = setTimeout(() => {
        const el = document.getElementById('__spl');
        if (el) {
          el.style.animation = 'cardOut .4s ease forwards';
          setTimeout(() => { if(this._spotlight) this._spotlight.style.display='none'; }, 400);
        }
      }, 15000);
    };

    // EventBus listeners
    EventBus.on('event:classifieds_update', async ev => {
      if (ev.nfts?.length) { this._nfts = ev.nfts; this._imgCache.clear(); await this._render(); }
    });
    EventBus.on('event:show_classifieds', () => {
      this.mount.style.display = 'block';
    });
    EventBus.on('event:show_classified_spotlight', async ev => {
      await this._showSpotlight(ev.nft, ev.index);
    });

    // !checkfav — trading card for the user's own fav pup
    EventBus.on('event:show_favpup_card', async ev => {
      await this._showFavPupCard(ev.nft, ev.requestedBy);
    });

    // Initial fetch
    this._fetch();
    setInterval(() => this._fetch(), 3600000);
  },

  async _fetch() {
    try {
      const port = this.CONFIG?.apiPort || 3000;
      const base = (port===80||port===443) ? '' : `http://${window.location.hostname}:${port}`;
      const r = await fetch(`${base}/classifieds?limit=15`);
      if (r.ok) { this._nfts = await r.json(); this._imgCache.clear(); await this._render(); }
    } catch (e) { console.warn('[Classifieds] fetch failed:', e.message); }
  },

  async _render() {
    const inner = this.wrap?.querySelector('#__clsInner');
    if (!inner) return;
    const nfts = this._nfts.length ? this._nfts
      : [{ name:'Loading adoptable pups…', desc:'Check back soon!', image:'', price:null, url:'' }];

    const blobs = await Promise.all(nfts.map(n => this._cacheImg(n.image)));

    const GAME_VERBS = {toss:'tossing',throw:'throwing',dig:'digging',walk:'walking',fish:'fishing'};
    const GAME_EMOJI = {toss:'🎯',throw:'🎾',dig:'⛏️',walk:'🐾',fish:'🎣'};
    const WEATHER_PHRASES = {sunny:'sunny days',cloudy:'cloudy weather',rainy:'rainy walks',
                             stormy:'stormy nights',snowy:'snow days',windy:'breezy days'};

    const mkCard = (nft, src) => {
      const mintNum = nft.mintNum ? `#${nft.mintNum}` : '';
      const price   = nft.price   ? `${nft.price} SOL` : 'Make an offer';
      const rawDesc = nft.desc    || '';

      // Fix game mentions: replace any wrong game verb with the actual fav game
      const correctVerb = GAME_VERBS[nft.favGame] || '';
      let desc = rawDesc;
      if (correctVerb && desc) {
        Object.entries(GAME_VERBS).forEach(([g, v]) => {
          if (g !== nft.favGame) {
            desc = desc.replace(new RegExp(`loves? ${v}`, 'gi'), `loves ${GAME_EMOJI[nft.favGame]||''} ${correctVerb}`);
            desc = desc.replace(new RegExp(`enjoy[s]? ${v}`, 'gi'), `enjoys ${correctVerb}`);
          }
        });
      }
      // Generate description from attributes if blank
      if (!desc.trim()) {
        const gPart = correctVerb ? `loves ${GAME_EMOJI[nft.favGame]||''} ${correctVerb}` : '';
        const wPart = WEATHER_PHRASES[nft.favWeather] ? `prefers ${WEATHER_PHRASES[nft.favWeather]}` : '';
        desc = `Loyal companion${gPart ? `, ${gPart}` : ''}${wPart ? `, ${wPart}` : ''}. Seeking a forever home!`;
      }

      const cmdLine = mintNum ? `!read "${mintNum}"` : '!read to learn more';
      return `<div class="cls-card">
        <img class="cls-photo" src="${src||''}" onerror="this.style.display='none'">
        <div class="cls-text">
          <div class="cls-desc">${desc}</div>
          <div class="cls-bottom">
            <div class="cls-price">${price}</div>
            <div class="cls-cmd">${cmdLine}</div>
          </div>
        </div>
      </div>`;
    };

    const cards = nfts.map((n,i) => mkCard(n, blobs[i])).join('');
    inner.innerHTML = cards + cards; // duplicate for seamless loop
      // Measure actual pixel width after paint — prevents the restart jump
      inner.classList.remove('running');
      inner.style.transform = '';
      requestAnimationFrame(() => {
        const halfW = Math.round(inner.scrollWidth / 2);
        const dur   = Math.min(180, Math.max(30, nfts.length * 12));
        // Inject pixel-precise keyframe so loop restarts on exact pixel boundary
        let kfEl = document.getElementById('__clsKf');
        if (!kfEl) { kfEl = document.createElement('style'); kfEl.id = '__clsKf'; document.head.appendChild(kfEl); }
        kfEl.textContent = '@keyframes clsScroll{from{transform:translateX(0)}to{transform:translateX(-' + halfW + 'px)}}';
        inner.style.animation = 'none';
        requestAnimationFrame(() => {
          inner.style.animation = '';
          inner.style.setProperty('--cls-dur', dur + 's');
          inner.classList.add('running');
        });
      });
  },
};

export default Classifieds;
