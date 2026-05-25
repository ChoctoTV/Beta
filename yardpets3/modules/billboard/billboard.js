/**
 * Billboard — rotates background billboard images.
 * Discovers: billboard.png (main), billboard(1).png … billboard(9).png
 * Timing: 3 minutes per image. Every 5 rotations shows the main billboard.png.
 * Lights glow at dusk and fade off at dawn, driven by yard.js daytime events.
 */

const TIMING_MS  = 3 * 60 * 1000;
const MAIN_EVERY = 5;
const BASE       = './assets';
const LIGHT_COUNT = 18;   // number of bulbs along the top

const Billboard = {
  mount: null,
  _el: null,
  _lights: null,
  _images: [],
  _idx: 0,
  _changeCount: 0,
  _timer: null,
  _night: 0,

  async init({ mount, EventBus }) {
    this.mount = mount;
    this.mount.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2;';

    // ── Container: always full-brightness, no weather dimming ──────────────
    this._el = document.createElement('div');
    this._el.style.cssText = [
      'position:absolute;bottom:0;left:0;right:0;pointer-events:none;',
      'filter:none;',     // billboard never dims in weather
    ].join('');
    this.mount.appendChild(this._el);

    // ── Lights strip along the top of the billboard ────────────────────────
    if (!document.getElementById('bb-css')) {
      const s = document.createElement('style'); s.id='bb-css';
      s.textContent = `
        .bb-lights{position:absolute;top:0;left:0;right:0;height:18px;
          display:flex;justify-content:space-around;align-items:center;
          padding:0 8px;pointer-events:none;z-index:3;}
        .bb-bulb{width:10px;height:10px;border-radius:50%;opacity:0;
          transition:opacity 1.8s ease;flex-shrink:0;}
        .bb-bulb.lit{animation:bbGlow 2.2s ease-in-out infinite alternate;}
        @keyframes bbGlow{
          0%  {filter:brightness(1.2)  drop-shadow(0 0 3px currentColor);}
          100%{filter:brightness(1.6)  drop-shadow(0 0 8px currentColor) drop-shadow(0 0 12px currentColor);}
        }
      `;
      document.head.appendChild(s);
    }
    this._lights = document.createElement('div');
    this._lights.className = 'bb-lights';
    const COLORS = ['#FF5555','#FFD700','#55FF55','#55AAFF','#FF88FF','#FFB347'];
    for (let i = 0; i < LIGHT_COUNT; i++) {
      const b = document.createElement('div');
      b.className = 'bb-bulb';
      b.style.color = COLORS[i % COLORS.length];
      b.style.background = COLORS[i % COLORS.length];
      this._lights.appendChild(b);
    }
    this._el.appendChild(this._lights);

    await this._discover();
    if (this._images.length) this._show(0);

    // Listen for yard.js daytime events to control lights
    window.addEventListener('chocto:daytime', e => this._setNight(e.detail.night));
  },

  _setNight(night) {
    this._night = night;
    const bulbs = this._lights ? this._lights.querySelectorAll('.bb-bulb') : [];
    // Lights fade in at dusk (night > 0.35), full brightness at night > 0.6
    const brightness = Math.max(0, Math.min(1, (night - 0.35) / 0.25));
    bulbs.forEach((b, i) => {
      b.style.opacity = brightness.toFixed(3);
      if (brightness > 0.05 && !b.classList.contains('lit')) {
        // Stagger the glow animation start so bulbs twinkle independently
        b.style.animationDelay = `${(i * 0.12).toFixed(2)}s`;
        b.classList.add('lit');
      } else if (brightness <= 0.05) {
        b.classList.remove('lit');
      }
    });
  },

  async _discover() {
    const cands = [
      `${BASE}/billboard.png`,
      ...Array.from({length:9}, (_,i) => `${BASE}/billboard(${i+1}).png`),
    ];
    for (const src of cands) {
      if (await this._exists(src)) this._images.push(src);
    }
    console.log(`[Billboard] ${this._images.length} image(s) found`);
  },

  _exists(src) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => res(true);
      img.onerror = () => res(false);
      img.src = src;
    });
  },

  _show(idx) {
    const src = this._images[idx];
    if (!src) return;
    // Keep lights strip; replace only the image
    const old = this._el.querySelector('img');
    if (old) old.remove();
    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'width:100%;height:auto;max-height:200px;object-fit:contain;object-position:bottom;display:block;';
    img.onerror = () => {};
    this._el.appendChild(img);
    this._changeCount++;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._next(), TIMING_MS);
    // Re-apply light state after image swap
    this._setNight(this._night);
  },

  _next() {
    if (!this._images.length) return;
    if (this._changeCount % MAIN_EVERY === 0) this._idx = 0;
    else this._idx = (this._idx + 1) % this._images.length;
    this._show(this._idx);
  },
};

export default Billboard;
