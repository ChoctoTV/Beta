// YardPets3 — renderer.js
// Boots the overlay: loads assets, initialises modules, manages WebSocket.
// The 10-second stream buffer lives here — a plain setTimeout in onmessage.
// Nothing else can break it.

import CONFIG from './config.js';
export { CONFIG };

// ─── EventBus ─────────────────────────────────────────────────────────────────
export const EventBus = (() => {
  const h = {};
  return {
    on  (e, fn) { (h[e] = h[e] || []).push(fn); },
    off (e, fn) { if (h[e]) h[e] = h[e].filter(f => f !== fn); },
    emit(e, d)  { (h[e] || []).slice().forEach(fn => { try { fn(d); } catch(err) { console.error(`[Bus:${e}]`, err); } }); },
  };
})();

// ─── Stream delay ──────────────────────────────────────────────────────────────
// Delays all gameplay events by BUFFER_MS so the overlay syncs with the
// Twitch stream delay that viewers experience.
const BUFFER_MS    = 10_000;
const BYPASS_TYPES = new Set(['shutdown', 'settings']); // fire immediately

function dispatchMsg(msg) {
  EventBus.emit('server:event', msg);
  if (msg.type) EventBus.emit('event:' + msg.type, msg);
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
  getSpriteByPupId, getRandomSprite, getImageForSprite,
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
    loadModule('puppyWars',    'battle-mount',   './modules/puppyWars/puppyWars.js'),
    loadModule('priceTicker',  'ticker-mount',   './modules/priceTicker/priceTicker.js'),
    loadModule('settings',     'settings-mount', './modules/settings/settings.js'),
    loadModule('streaming',    'stream-mount',   './modules/streaming/streaming.js'),
    loadModule('queueDisplay', 'queue-mount',    './modules/queueDisplay/queueDisplay.js'),
  ]);

  connectWS();
  if (CONFIG.demo) EventBus.emit('demo:start', {});
  clearStatus();
  console.log('[YardPets3] Ready — stream buffer:', BUFFER_MS/1000 + 's');
}

boot();
