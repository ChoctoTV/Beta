// YardPets3 — renderer.js
// Boots the overlay: loads assets, initialises modules, manages WebSocket.
// The 10-second stream buffer lives here — a plain setTimeout in onmessage.
// Nothing else can break it.

import CONFIG from './config.js';
export { CONFIG };

// ─── EventBus ─────────────────────────────────────────────────────────────────
// Preload Google Fonts synchronously to prevent mid-render layout shifts
(function preloadFonts() {
  const fonts = [
    'https://fonts.googleapis.com/css2?family=UnifrakturMaguntia&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap',
  ];
  fonts.forEach(href => {
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'preload'; link.as = 'style'; link.href = href;
      link.onload = () => { link.rel = 'stylesheet'; };
      document.head.appendChild(link);
    }
  });
  // Also preload choctopi icon
  const icon = new Image(); icon.src = '/assets/choctopi.png';
})();

export const EventBus = (() => {
  const h = {};
  return {
    on  (e, fn) { (h[e] = h[e] || []).push(fn); },
    off (e, fn) { if (h[e]) h[e] = h[e].filter(f => f !== fn); },
    emit(e, d)  { (h[e] || []).slice().forEach(fn => { try { fn(d); } catch(err) { console.error(`[Bus:${e}]`, err); } }); },
  };
})();

// ─── Stream delay ──────────────────────────────────────────────────────────────
// Delays gameplay events to sync with Twitch stream delay viewers experience.
// Twitch Low Latency:  ~3-5s  → set streamBuffer=3000 in URL or rewardsEcon.txt
// Twitch Normal:       ~10-15s → set streamBuffer=10000
// Local testing / demo: set streamBuffer=0 to see animations instantly
const p = new URLSearchParams(window.location.search);
const BUFFER_MS    = parseInt(p.get('streamBuffer') ?? '3000', 10);
const BYPASS_TYPES = new Set(['shutdown', 'settings', 'weather', 'lurk_update',
  'classifieds_update', 'show_classifieds', 'show_classified_spotlight',
  'show_favpup_card', 'daily_bonuses']); // fire immediately — not gameplay

// ── Pre-warm NFT image cache from localStorage ───────────────────────────────
// Any URL stored from a previous session gets pre-loaded into memory cache now
// so the first favpup walk of the day doesn't stall waiting for network
(function prewarmNFTCache() {
  try {
    const store = JSON.parse(localStorage.getItem('choctotv_nft_imgs') || '{}');
    for (const url of Object.keys(store)) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { _nftImgPrewarm = _nftImgPrewarm || {}; _nftImgPrewarm[url] = img; };
      img.src = url;
    }
  } catch {}
})();
let _nftImgPrewarm = {};

// ── Cashout visual — floats choctopi.png above the overlay ──────────────────
function showCashoutVisual(data) {
  const el   = document.createElement('div');
  const n    = data.choctopus || 0;
  el.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:120px', 'transform:translateX(-50%)',
    'display:flex', 'align-items:center', 'gap:10px',
    'background:rgba(0,0,0,.75)', 'border-radius:16px',
    'padding:12px 24px', 'color:#FFD700', 'font-size:28px', 'font-weight:700',
    'z-index:9999', 'pointer-events:none',
    'box-shadow:0 4px 24px rgba(0,0,0,.5)',
    'animation:cfloat 3.2s ease-out forwards',
  ].join(';');
  el.innerHTML = `@${data.user || ''} ➜ ${window.choctopiImg ? window.choctopiImg(n) : n + ' Choctopus'} cashed out!`;
  if (!document.getElementById('__cf_keyframes')) {
    const s = document.createElement('style');
    s.id = '__cf_keyframes';
    s.textContent = '@keyframes cfloat{0%{opacity:0;transform:translateX(-50%) translateY(20px)}15%{opacity:1;transform:translateX(-50%) translateY(0)}80%{opacity:1}100%{opacity:0;transform:translateX(-50%) translateY(-40px)}}';
    document.head.appendChild(s);
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function dispatchMsg(msg) {
  EventBus.emit('server:event', msg);
  if (msg.type) EventBus.emit('event:' + msg.type, msg);
        if (msg.type === 'cashout_confirm') showCashoutVisual(msg);
        // Track last announcement for !lastannounce — send back to app via fetch
        if (msg.type === 'announcements' && msg.announcements?.length) {
          try {
            const last = msg.announcements[msg.announcements.length - 1];
            fetch('/api/lastannounce', { method:'POST',
              headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ text: last.text }) }).catch(()=>{});
          } catch {}
        }
}

// ─── Image cache ───────────────────────────────────────────────────────────────
const _cache = new Map();

function loadImg(url) {
  if (_cache.has(url)) return _cache.get(url);
  const p = new Promise(resolve => {
    const img = new Image();
    const t   = setTimeout(() => resolve(null), 6000);
    img.onload  = () => { clearTimeout(t); resolve(img); };
    img.onerror = () => {
      clearTimeout(t);
      // Try alternate PNG case (.png ↔ .PNG)
      const alt = url.endsWith('.png') ? url.slice(0,-4)+'.PNG'
                : url.endsWith('.PNG') ? url.slice(0,-4)+'.png' : null;
      if (alt && !_cache.has(alt + '_tried')) {
        _cache.set(alt + '_tried', Promise.resolve(null));
        const i2 = new Image();
        const t2 = setTimeout(() => resolve(null), 6000);
        i2.onload  = () => { clearTimeout(t2); resolve(i2); };
        i2.onerror = () => { clearTimeout(t2); resolve(null); };
        i2.src = alt;
      } else { resolve(null); }
    };
    img.src = url;
  });
  _cache.set(url, p);
  return p;
}

// ─── Sprite metadata ───────────────────────────────────────────────────────────
let _meta = null;

async function loadAssets() {
  const res = await fetch(CONFIG.assets.spritesMeta);
  if (!res.ok) throw new Error(`sprites_meta.json: HTTP ${res.status}`);
  const raw = await res.json();

  let sprites = [];
  if (Array.isArray(raw)) {
    raw.forEach(o => {
      if (Array.isArray(o.sprites)) sprites.push(...o.sprites);
      else if (o.name) sprites.push(o);
    });
  } else if (raw.sprites) {
    sprites = raw.sprites;
  }
  _meta = { sprites };
  console.log(`[Assets] ${sprites.length} sprites loaded`);

  // Precache every pup image before modules start
  const urls = sprites.map(s => CONFIG.assets.pupImage(s.name, s.rarity || 'common'));
  setStatus(`⏳ Caching ${urls.length} pup images…`);
  await Promise.all(urls.map(u => loadImg(u)));
  console.log('[Assets] All images cached');
}

// ─── Sprite helpers ────────────────────────────────────────────────────────────
export const getSprites        = ()       => _meta?.sprites || [];
export const getSpritesMeta    = ()       => _meta;
export const getSpritesByRarity = rarity  => (_meta?.sprites||[]).filter(s => (s.rarity||'').toLowerCase() === (rarity||'').toLowerCase());
export const getSpriteByPupId  = id       => { const s=_meta?.sprites; if(!s?.length) return null; return s[Math.abs(parseInt(id)||0) % s.length]; };
export const getSpriteByName   = name     => _meta?.sprites?.find(s => s.name === name) || null;
export function getRandomSprite(rarity) {
  const pool = rarity ? getSpritesByRarity(rarity) : (_meta?.sprites||[]);
  const src  = pool.length ? pool : (_meta?.sprites||[]);
  return src.length ? src[Math.floor(Math.random()*src.length)] : null;
}
export function getImageForSprite(sprite) {
  if (!sprite) return Promise.resolve(null);
  return loadImg(CONFIG.assets.pupImage(sprite.name, sprite.rarity || 'common'));
}

// ─── WebSocket ─────────────────────────────────────────────────────────────────
let _ws=null, _wsRetry=null, _wsDelay=3000;

function connectWS() {
  if (_wsRetry) { clearTimeout(_wsRetry); _wsRetry=null; }
  if (_ws && _ws.readyState < 2) { try { _ws.close(); } catch {} }

  _ws = new WebSocket(CONFIG.wsUrl);
  console.log('[WS] Connecting →', CONFIG.wsUrl);

  _ws.onopen = () => {
    console.log('[WS] Connected');
    _wsDelay = 3000;
    EventBus.emit('ws:connected', {});
  };
  _ws.onclose = e => {
    console.warn('[WS] Closed', e.code, '— retry in', _wsDelay + 'ms');
    EventBus.emit('ws:disconnected', {});
    _wsRetry = setTimeout(connectWS, _wsDelay);
    _wsDelay = Math.min(_wsDelay * 1.5, 30000);
  };
  _ws.onerror = () => {};
  _ws.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.type === 'shutdown') {
      setStatus('🔄 Shutting down…');
      setTimeout(() => window.close(), 800);
      return;
    }

    // System events fire immediately; gameplay events are delayed by BUFFER_MS
    if (BYPASS_TYPES.has(msg.type)) {
      dispatchMsg(msg);
    } else {
      setTimeout(() => dispatchMsg(msg), BUFFER_MS);
    }
  };
}

export function reconnectWS() { connectWS(); }

// ─── Module loader ─────────────────────────────────────────────────────────────
const API = {
  EventBus, CONFIG,
  getSpritesMeta, getSprites, getSpritesByRarity,
  getSpriteByPupId, getSpriteByName, getRandomSprite, getImageForSprite,
};

async function loadModule(name, mountId, src) {
  try {
    const mod = await import(src);
    if (!mod.default?.init) { console.warn('[Mod]', name, '— no init()'); return; }
    const el = document.getElementById(mountId);
    if (!el) { console.warn('[Mod]', name, '— mount #'+mountId+' not found'); return; }
    await mod.default.init({ mount:el, ...API });
    console.log('[Mod] ✓', name);
  } catch(e) { console.error('[Mod] ✗', name, e); }
}

// ─── Boot ──────────────────────────────────────────────────────────────────────
const _statusEl = document.getElementById('boot-status');
function setStatus(msg) { if (_statusEl) _statusEl.textContent = msg; }
function clearStatus()  { if (_statusEl) { _statusEl.style.opacity='0'; setTimeout(()=>_statusEl?.remove(), 1500); } }

async function boot() {
  setStatus('⏳ Loading assets…');
  try {
    await loadAssets();
  } catch(e) {
    console.error('[Boot] Asset load failed:', e);
    setStatus('⚠ ' + e.message);
    // Continue anyway — modules will use fallback colour circles
  }

  setStatus('⏳ Loading modules…');

  // Yard loads first (sequential) so the scene is visible immediately
  await loadModule('yard', 'yard-mount', './modules/yard/yard.js');

  // Everything else in parallel
  await Promise.all([
    loadModule('classifieds',  'classifieds-mount', './modules/classifieds/classifieds.js'),
    loadModule('choctoCal',   'calendar-mount',    './modules/choctoCalendar/choctoCalendar.js'),
    loadModule('puppyWars',    'battle-mount',       './modules/puppyWars/puppyWars.js'),
    loadModule('priceTicker',  'ticker-mount',    './modules/priceTicker/priceTicker.js'),
    loadModule('settings',     'settings-mount',  './modules/settings/settings.js'),
    loadModule('streaming',    'stream-mount',    './modules/streaming/streaming.js'),
    loadModule('queueDisplay', 'queue-mount',     './modules/queueDisplay/queueDisplay.js'),
    loadModule('moraleMeter',  'morale-mount',   './modules/moraleMeter/moraleMeter.js'),
    loadModule('chestGame',    'chest-mount',    './modules/chestGame/chestGame.js'),
    loadModule('musicToast',  'music-toast-mount','./modules/musicToast/musicToast.js'),
  ]);


  connectWS();
  if (CONFIG.demo) EventBus.emit('demo:start', {});
  clearStatus();
  console.log('[YardPets3] Ready — stream buffer:', BUFFER_MS/1000 + 's');
}

boot();
