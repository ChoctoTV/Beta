/**
 * musicToast — shows current track name for 5 seconds when a new song starts.
 * Strips .mp3/.wav/.flac/.ogg extension. Fades in and out smoothly.
 */
const MusicToast = {
  _el: null, _timer: null,

  async init({ mount, EventBus }) {
    this._buildCSS();
    this._buildEl(mount);
    EventBus.on('event:music_track', m => this._show(m.track || ''));
  },

  _show(raw) {
    if (!raw) return;
    const track = raw.replace(/\.(mp3|wav|flac|ogg|aac|m4a)$/i, '').trim();
    if (!track) return;
    const el = this._el;
    el.querySelector('.mt-track').textContent = track;
    el.style.opacity = '0';
    el.style.display = 'flex';
    void el.offsetWidth;
    el.style.transition = 'opacity 0.6s ease';
    el.style.opacity = '1';
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      el.style.transition = 'opacity 1.2s ease';
      el.style.opacity = '0';
      setTimeout(() => { el.style.display = 'none'; }, 1300);
    }, 5000);
  },

  _buildEl(mount) {
    const el = document.createElement('div');
    el.id = 'mt-wrap';
    el.innerHTML = `<span class="mt-icon">♪</span><span class="mt-track"></span>`;
    el.style.display = 'none';
    mount.appendChild(el);
    this._el = el;
  },

  _buildCSS() {
    if (document.getElementById('mt-css')) return;
    const s = document.createElement('style'); s.id = 'mt-css';
    s.textContent = `
      #mt-wrap {
        position:fixed;bottom:260px;left:50%;transform:translateX(-50%);
        display:flex;align-items:center;gap:10px;
        background:rgba(0,0,0,.78);border:1px solid rgba(255,255,255,.18);
        border-radius:30px;padding:8px 22px;
        font-family:'Libre Baskerville',Georgia,serif;font-size:18px;color:#fff;
        box-shadow:0 4px 24px rgba(0,0,0,.5);pointer-events:none;
        white-space:nowrap;max-width:600px;overflow:hidden;text-overflow:ellipsis;
        z-index:9998;
      }
      .mt-icon { color:#f1c40f;font-size:20px;flex-shrink:0; }
      .mt-track { overflow:hidden;text-overflow:ellipsis; }
    `;
    document.head.appendChild(s);
  },
};
export default MusicToast;
