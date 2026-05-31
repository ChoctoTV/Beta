// YardPets3 — config.js
const _p = new URLSearchParams(window.location.search);
const p  = (k, fb) => _p.has(k) ? _p.get(k) : fb;

const CONFIG = {
  wsPort:  parseInt(p('wsPort',  '3001')),
  apiPort: parseInt(p('apiPort', '3000')),

  get wsUrl()  { return `ws://${window.location.hostname}:${this.wsPort}`; },
  get apiUrl() { return `http://${window.location.hostname}:${this.apiPort}`; },

  assets: {
    base: './assets',
    // PNG lives at: assets/pups/{rarity}/{name}.png
    // Served by app.js under the /assets/ URL prefix
    get spritesMeta() { return '/assets/sprites_meta.json'; },
    pupImage(name, rarity) {
      return `/assets/pups/${(rarity||'common').toLowerCase()}/${encodeURIComponent(name)}.png`;
    },
  },

  layout: {
    width:       1920,
    height:      1080,
    grassY:       310,   // fence line — pushed down 40px for larger ticker
    pondX:       1680,   // pond centre X (lower-right)
    pondY:        800,   // pond centre Y
    safeMarginX:  120,   // game pups stay inside this horizontal margin
    popupBottom:  206,   // centers popup between morale meter bottom (228px) and bowl tops (283px)
    puppyWarsY:   864,   // battle zone top edge (bottom ~20%)
  },

  demo: p('demo', null) !== null,
};

export default CONFIG;



// ── Choctopi icon helper — use everywhere Choctopus amounts appear in overlay ──
// choctopiImg(7)  → '<span class="choctopi-amount">7 <img ...></span>'
// choctopiImg()   → just the <img> tag alone (no number)
window.choctopiImg = function(n) {
  const img = '<img src="/assets/choctopi.png" class="choctopi-icon" alt="Choctopus">';
  if (n === undefined || n === null) return img;
  return `<span class="choctopi-amount">${n} ${img}</span>`;
};