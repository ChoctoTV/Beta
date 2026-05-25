/**
 * ChoctoCalendar — page-flip desk calendar showing ChoctoDate.
 * 1 Earth day = 96 ChoctoHours (96 × 15-min intervals, 0.00–0.95)
 * Dog months, Octopus days.
 */
const MONTHS = [
  'Slooberary','Fetchruary','Barkch','Sniffpril','Stay','Zoomune',
  'SitLay','Fetchgust','Wooftember','Howloween','Borkember','Droolcember',
];
const DAYS = [
  'Squiddleday','Mondopus','Tentaday','Wrigglesday','Inkday','Flipday','Suckersday',
];

function choctoNow() {
  const now = new Date();
  const msToday = now.getHours()*3600000 + now.getMinutes()*60000 + now.getSeconds()*1000;
  const hour = Math.floor(msToday / 900000);
  return {
    month:   MONTHS[now.getMonth()],
    day:     now.getDate(),
    dow:     DAYS[now.getDay()],
    hourStr: '.' + String(hour).padStart(2,'0'),
    hour,
  };
}

const ChoctoCalendar = {
  mount:null, _hour:-1, _timer:null,

  init({ mount }) {
    this.mount = mount;
    if (!document.getElementById('__calCss')) {
      const st = document.createElement('style'); st.id='__calCss';
      st.textContent = `
        #chocto-cal{position:absolute;bottom:0;right:0;width:384px;height:220px;
          display:flex;align-items:stretch;font-family:'Segoe UI',system-ui,sans-serif;
          perspective:700px;}
        .cal-spine{width:10px;background:linear-gradient(#8b0000,#600000);
          border-left:1px solid #400;}
        .cal-body{flex:1;display:flex;flex-direction:column;
          background:linear-gradient(160deg,#f5ead8,#e8d5b5);
          border-left:2px solid #1a1a1a;border-top:2px solid #1a1a1a;
          box-shadow:-4px 0 18px rgba(0,0,0,.55);overflow:hidden;position:relative;}
        .cal-hdr{background:linear-gradient(135deg,#8b0000,#c0392b);
          padding:9px 10px 7px;text-align:center;border-bottom:2px solid #600;}
        .cal-dow{font-size:18px;font-weight:800;letter-spacing:.14em;
          text-transform:uppercase;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.5);}
        .cal-page{flex:1;display:flex;flex-direction:column;align-items:center;
          justify-content:center;padding:4px 6px;
          transform-origin:top center;backface-visibility:hidden;}
        .cal-page.fo{animation:calFO .38s ease-in forwards;}
        .cal-page.fi{animation:calFI .38s ease-out forwards;}
        .cal-month{font-size:46px;font-weight:800;color:#8b0000;
          text-transform:uppercase;letter-spacing:.08em;line-height:1;}
        .cal-dn{font-size:110px;font-weight:900;color:#1a1a1a;line-height:1;margin:2px 0;white-space:nowrap;}
        .cal-hr{font-size:64px;font-weight:800;color:#666;letter-spacing:.02em;vertical-align:baseline;display:inline;
          font-variant-numeric:tabular-nums;}
        .cal-rule{position:absolute;top:50%;left:0;right:0;height:2px;
          background:linear-gradient(90deg,transparent,#c8b89a 15%,#c8b89a 85%,transparent);}
        @keyframes calFO{from{transform:rotateX(0deg);opacity:1}to{transform:rotateX(-88deg);opacity:0}}
        @keyframes calFI{from{transform:rotateX(88deg);opacity:0}to{transform:rotateX(0deg);opacity:1}}
      `;
      document.head.appendChild(st);
    }
    mount.innerHTML = `<div id="chocto-cal">
      <div class="cal-spine"></div>
      <div class="cal-body">
        <div class="cal-hdr"><div class="cal-dow" id="cdow"></div></div>
        <div class="cal-page" id="cpg">
          <div class="cal-month" id="cmo"></div>
          <div style="display:flex;align-items:baseline;gap:0;line-height:1;"><div class="cal-dn" id="cdn"></div><div class="cal-hr" id="chr"></div></div>
        </div>
        <div class="cal-rule"></div>
      </div>
    </div>`;
    this._update(true);
    this._tick();
  },

  _set(d) {
    const dow = document.getElementById('cdow');
    const mo  = document.getElementById('cmo');
    const dn  = document.getElementById('cdn');
    const hr  = document.getElementById('chr');
    if (dow) dow.textContent = d.dow;
    if (mo)  mo.textContent  = d.month;
    if (dn)  dn.textContent  = d.day;
    if (hr)  hr.textContent  = d.hourStr;
  },

  _update(instant) {
    const d  = choctoNow();
    const pg = document.getElementById('cpg');
    if (!pg) { this._set(d); return; }
    if (instant) { this._set(d); return; }
    pg.classList.add('fo');
    setTimeout(() => {
      this._set(d);
      pg.classList.remove('fo');
      pg.classList.add('fi');
      setTimeout(() => pg.classList.remove('fi'), 400);
    }, 380);
  },

  _tick() {
    const { hour } = choctoNow();
    if (hour !== this._hour) {
      const first = this._hour === -1;
      this._hour  = hour;
      this._update(first);
    }
    this._timer = setTimeout(() => this._tick(), 10000);
  },

  destroy() { if (this._timer) clearTimeout(this._timer); },
};

export default ChoctoCalendar;
