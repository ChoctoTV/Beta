/**
 * ChoctoCalendar — In-game dog calendar.
 *
 * DATE FORMULA:
 *   Dogs started counting time on Jan 1, 0001 AD, same as humans.
 *   Their clock runs 7× faster and they never use leap years.
 *   "Days since year 1" = (currentYear - 1) * 365 + dayOfYear (no leap correction)
 *   Dog-days = human-days × 7
 *   Dog-year = floor(dog-days / 365) + 1   (year 1 = first dog-year)
 *
 * MONTHS (mirrors Gregorian day-lengths, no leap):
 *   Justfeedmeary(31) Febwary(28) Marf(31) Apawril(30) Mutt(31) Joon(30)
 *   Jowly(31) Augruff(31) Septimber(30) Octobark(31) Novemfur(30) Decemgrrr(31) = 365
 *
 * WEEKDAYS (7 Octopus-weekdays, cycling from Jan 1 year 1 = Mucusday):
 *   Mucusday Tentacleday Wavenday Thalassaday Frothday Suctionday Snuggleday
 */

const DOG_MONTHS = [
  { name:'Justfeedmeary', days:31 },
  { name:'Febwary',       days:28 },
  { name:'Marf',          days:31 },
  { name:'Apawril',       days:30 },
  { name:'Mutt',          days:31 },
  { name:'Joon',          days:30 },
  { name:'Jowly',         days:31 },
  { name:'Augruff',       days:31 },
  { name:'Septimber',     days:30 },
  { name:'Octobark',      days:31 },
  { name:'Novemfur',      days:30 },
  { name:'Decemgrrr',     days:31 },
];

const WEEKDAYS = [
  'Mucusday','Tentacleday','Wavenday','Thalassaday',
  'Frothday','Suctionday','Snuggleday',
];

// Pre-compute month start offsets
const MONTH_STARTS = [];
let _off = 0;
for (const m of DOG_MONTHS) { MONTH_STARTS.push(_off); _off += m.days; }
// _off === 365 ✓

const HOWLIDAYS = [
  { monthIndex:0,  day:27, name:'NewBarks Eve',           fenceLights:['#FFD700','#C0C0C0'],
    lore:'The night before NewBarks Day is sacred — every pup grooms their octopus costume and polishes their snout for the new year ahead.',
    tradition:'Choctonauts count down the final chocolate drops of the old DogYear, wearing their finest tentacle formalwear and sipping warm cocoa.' },
  { monthIndex:0,  day:28, name:'NewBarks Day',           fenceLights:['#FFD700','#C0C0C0'],
    lore:'NewBarks Day marks the start of a fresh DogYear. All past debts are forgiven and every pup begins their chocolate journey anew.',
    tradition:'Choctonauts bark loudly at midnight to usher in the new DogYear, then share the first chocolate treat of the year with their nearest tentacle-buddy.' },
  { monthIndex:2,  day:14, name:'Marfket Surge Day',      fenceLights:['#00CC44','#FFD700'],
    lore:'On Marfket Surge Day, the great Chocto-Exchange opens its gates for 24 full DogHours.',
    tradition:'Choctonauts trade their finest chocolate reserves and forge moon-coins by moonlight, hoping for a surge in the Choctoverse economy.' },
  { monthIndex:3,  day:1,  name:'Airdropawril',           fenceLights:['#9B59B6','#00CED1'],
    lore:'Airdropawril began when the legendary Captain Splorch accidentally knocked an entire barrel of chocolate off a cliff, showering the village below with riches.',
    tradition:'Choctonauts fling chocolate from the highest dunes into the open pouches of their friends below — the greatest airdrop tradition in the Choctoverse.' },
  { monthIndex:7,  day:15, name:'Augruff Activation Day', fenceLights:['#FF6B35','#CC2200'],
    lore:'On Augruff Activation Day, all game cooldowns are spiritually halved in spirit. Even lurking pups wake up to play.',
    tradition:'Choctonauts sprint through the yard at full speed, activating every game command available, to honor the first Choctonaut who ran so fast they turned into pure chocolate energy.' },
  { monthIndex:9,  day:28, name:'Octobark Howloween',     fenceLights:['#FF6600','#440088'],
    lore:'On the 28th of Octobark, the spirits of ancient Choctonauts visit the yard, wearing their spookiest tentacle costumes.',
    tradition:'Choctonauts trade rare chocolate treats and dare each other to dig in the darkest corners of the yard for surprise items.' },
  { monthIndex:11, day:21, name:'Decemgrrr Drip Day',     fenceLights:['#CC0000','#B0E8FF'],
    lore:'Decemgrrr Drip Day is the most stylish howliday of the year — every pup earns bonus Choctobits for drip.',
    tradition:'Choctonauts wear their rarest costumes and parade through the yard, voting for the most iconic outfit.' },
];

// ── Time calculation ──────────────────────────────────────────────────────────
function getChoctoDay(nowMs) {
  const now   = nowMs ?? Date.now();
  const d     = new Date(now);
  // Use calendar fields directly — treat all years as 365 days (no leap correction)
  const year  = d.getUTCFullYear();
  const month = d.getUTCMonth();     // 0-indexed
  const date  = d.getUTCDate();      // 1-indexed
  const hh    = d.getUTCHours();
  const mm    = d.getUTCMinutes();
  const ss    = d.getUTCSeconds();

  // Day-of-year for Gregorian months, no leap (Feb always 28)
  const GREG_MONTH_DAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
  let gregDayOfYear = date - 1;
  for (let m = 0; m < month; m++) gregDayOfYear += GREG_MONTH_DAYS[m];

  // Human days since Jan 1, year 1 (no leap years ever)
  const humanDays = (year - 1) * 365 + gregDayOfYear
                  + (hh * 3600 + mm * 60 + ss) / 86400;

  // Dog-days (7× faster)
  const dogDaysTotal = humanDays * 7;
  const dogDaysInt   = Math.floor(dogDaysTotal);
  const dogFrac      = dogDaysTotal - dogDaysInt;  // fraction of current dog-day

  // Dog year (365 days/year, no leap, 1-indexed)
  const dogYearIdx  = Math.floor(dogDaysInt / 365);
  const dogYear     = dogYearIdx + 1;
  const dogDayOfYr  = dogDaysInt % 365;  // 0-indexed within dog year

  // Dog month + day
  let dogMonthIdx = 0;
  for (let i = DOG_MONTHS.length - 1; i >= 0; i--) {
    if (dogDayOfYr >= MONTH_STARTS[i]) { dogMonthIdx = i; break; }
  }
  const dogDay = dogDayOfYr - MONTH_STARTS[dogMonthIdx] + 1;  // 1-indexed

  // Dog weekday (0 = Mucusday on the very first dog-day)
  const dogWeekday = dogDaysInt % 7;

  // Dog time-of-day
  const dogSecInDay = Math.floor(dogFrac * 86400);
  const dogHour     = Math.floor(dogSecInDay / 3600);
  const dogMin      = Math.floor((dogSecInDay % 3600) / 60);
  const dogSec      = dogSecInDay % 60;

  // Howliday check
  const howlidayData = HOWLIDAYS.find(h => h.monthIndex === dogMonthIdx && h.day === dogDay) || null;

  return {
    dogYear, dogMonthIdx, dogMonth: DOG_MONTHS[dogMonthIdx].name,
    dogDay, dogDayOfYr, dogWeekday, dogWeekdayName: WEEKDAYS[dogWeekday],
    dogHour, dogMin, dogSec,
    isHowliday: !!howlidayData,
    howlidayName: howlidayData?.name || null,
    howlidayData: howlidayData || null,
  };
}

// ── Apply CSS vars for howliday fence tinting ──────────────────────────────
function applyHowlidayCSSVars(dayData) {
  const root = document.documentElement;
  if (dayData.isHowliday && dayData.howlidayData) {
    const [c1, c2] = dayData.howlidayData.fenceLights;
    root.style.setProperty('--howliday-active',  '1');
    root.style.setProperty('--howliday-light-1', c1);
    root.style.setProperty('--howliday-light-2', c2);
  } else {
    root.style.setProperty('--howliday-active',  '0');
    root.style.removeProperty('--howliday-light-1');
    root.style.removeProperty('--howliday-light-2');
  }
}

// ── Main module ───────────────────────────────────────────────────────────────
const ChoctoCalendar = {
  mount:       null,
  _el:         null,
  _timer:      null,
  _demoTimer:  null,
  _demoIdx:    0,
  _inDemo:     false,

  init({ mount, EventBus }) {
    this.mount = mount;
    this._buildCSS();
    this._buildDOM();
    this._updateNow();
    if (EventBus) EventBus.on('event:test_howliday', m => this._runDemo(m));
  },

    _buildCSS() {
    if (document.getElementById('chocto-cal-css')) return;
    const s = document.createElement('style'); s.id = 'chocto-cal-css';
    s.textContent = `
      #chocto-cal {
        position: absolute;
        inset: 0;
        background: rgba(242,234,216,1);
        border-left: 2.5px solid #1a1a1a;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        padding: 10px 20px 10px 18px;
        gap: 6px;
        pointer-events: none;
        overflow: hidden;
      }
      #chocto-cal-date {
        font-family: 'UnifrakturMaguntia','Times New Roman',serif;
        font-size: 48px;
        color: #1a1a1a;
        letter-spacing: .02em;
        white-space: nowrap;
        line-height: 1;
      }
      #chocto-cal-dayname {
        font-family: 'Libre Baskerville',Georgia,serif;
        font-size: 26px;
        color: #444;
        letter-spacing: .05em;
        white-space: nowrap;
        line-height: 1;
      }
      #chocto-cal-time {
        font-family: Consolas, monospace;
        font-size: 34px;
        font-weight: 800;
        color: #1a1a1a;
        letter-spacing: .08em;
        white-space: nowrap;
        line-height: 1;
      }
      #chocto-cal-year {
        font-family: 'Libre Baskerville',Georgia,serif;
        font-size: 22px;
        color: #555;
        font-style: italic;
        white-space: nowrap;
        line-height: 1;
      }
      #chocto-cal-howliday-badge {
        display: none;
        font-family: 'Libre Baskerville',Georgia,serif;
        font-size: 22px;
        font-weight: 800;
        color: #8B0000;
        white-space: nowrap;
        animation: calHowlidayPulse 2s ease-in-out infinite;
      }
      @keyframes calHowlidayPulse { 0%,100%{opacity:1} 50%{opacity:.45} }
      #chocto-demo-banner {
        position: fixed; top: 12px; left: 50%;
        transform: translateX(-50%);
        background: rgba(80,0,180,.92);
        color: #ffdd00; font-weight: 800; font-size: 18px;
        padding: 8px 28px; border-radius: 20px;
        border: 2px solid #ffdd00;
        box-shadow: 0 0 18px rgba(140,0,255,.7);
        z-index: 99999; pointer-events: none;
        font-family: Consolas, monospace; letter-spacing: .06em;
        animation: demoPop .4s ease-out;
      }
      @keyframes demoPop {
        from { opacity:0; transform:translateX(-50%) scale(.8); }
        to   { opacity:1; transform:translateX(-50%) scale(1); }
      }
    `;
    document.head.appendChild(s);
  },

    _buildDOM() {
    const el = document.createElement('div'); el.id = 'chocto-cal';
    el.innerHTML = `
      <div id="chocto-cal-date">—</div>
      <div id="chocto-cal-dayname">—</div>
      <div id="chocto-cal-time">—</div>
      <div id="chocto-cal-year">DogYear —</div>
      <div id="chocto-cal-howliday-badge"></div>
    `;
    this.mount.appendChild(el);
    this._el = el;
  },

  _updateNow(forceNow) {
    if (this._timer) clearTimeout(this._timer);
    // While a howliday demo is active, skip the regular tick so the demo's
    // fake day and CSS vars aren't overwritten by the real-day rendering loop.
    if (this._inDemo) {
      const DOG_SEC_MS = Math.ceil(1000 / 7);
      this._timer = setTimeout(() => this._updateNow(), DOG_SEC_MS);
      return;
    }
    const day = getChoctoDay();
    this._render(day, forceNow);
    const DOG_SEC_MS = Math.ceil(1000 / 7);
    this._timer = setTimeout(() => this._updateNow(), DOG_SEC_MS);
  },

  _render(day, fromDemo) {
    if (!this._el) return;
    if (!fromDemo) applyHowlidayCSSVars(day);

    const pad = n => String(n).padStart(2, '0');
    const dateEl    = document.getElementById('chocto-cal-date');
    const dayEl     = document.getElementById('chocto-cal-dayname');
    const timeEl    = document.getElementById('chocto-cal-time');
    const yearEl    = document.getElementById('chocto-cal-year');
    const hwBadge   = document.getElementById('chocto-cal-howliday-badge');

    if (dateEl)  dateEl.textContent  = `${day.dogMonth} ${day.dogDay}`;
    if (dayEl)   dayEl.textContent   = day.dogWeekdayName;
    if (timeEl) {
      const h = day.dogHour;
      let suffix, hh;
      if (h === 12 && day.dogMin === 0 && day.dogSec === 0)      { suffix = 'noon';     hh = 12; }
      else if (h === 0 && day.dogMin === 0 && day.dogSec === 0)  { suffix = 'midnight'; hh = 12; }
      else if (h < 12) { suffix = 'AM'; hh = h === 0 ? 12 : h; }
      else             { suffix = 'PM'; hh = h === 12 ? 12 : h - 12; }
      timeEl.textContent = `${pad(hh)}:${pad(day.dogMin)}:${pad(day.dogSec)} ${suffix}`;
    }
    if (yearEl)  yearEl.textContent  = `DogYear ${day.dogYear}`;

    if (hwBadge) {
      if (day.isHowliday) {
        hwBadge.textContent    = `🎉 ${day.howlidayName}`;
        hwBadge.style.display  = 'block';
      } else {
        hwBadge.style.display  = 'none';
      }
    }
  },

  // ── Demo: !testhowliday ──────────────────────────────────────────────────
  _runDemo(msg) {
    this._cancelDemo();
    const demoMs = msg.demoMs || 30000;
    if (msg.target) {
      const hw = HOWLIDAYS.find(h => h.name === msg.target);
      if (!hw) return;
      this._applyDemoHowliday(hw, demoMs, true);
    } else {
      this._demoIdx = 0;
      const step = () => {
        if (this._demoIdx >= HOWLIDAYS.length) { this._cancelDemo(); return; }
        this._applyDemoHowliday(HOWLIDAYS[this._demoIdx], demoMs, false);
        this._demoIdx++;
        this._demoTimer = setTimeout(step, demoMs);
      };
      step();
    }
  },

  _applyDemoHowliday(hw, durationMs, isOnly) {
    this._inDemo = true;
    // Build fake day for this howliday
    const real = getChoctoDay();
    const fakeDay = {
      ...real,
      dogMonth: DOG_MONTHS[hw.monthIndex].name,
      dogMonthIdx: hw.monthIndex,
      dogDay: hw.day,
      dogWeekdayName: WEEKDAYS[real.dogWeekday],
      isHowliday: true,
      howlidayName: hw.name,
      howlidayData: hw,
    };
    // Apply CSS vars immediately for fence tinting
    applyHowlidayCSSVars(fakeDay);
    this._render(fakeDay, true);
    this._showDemoBanner(hw.name, durationMs);
    // Auto-restore after last single demo
    if (isOnly) this._demoTimer = setTimeout(() => this._cancelDemo(), durationMs);
  },

  _showDemoBanner(name, durationMs) {
    document.getElementById('chocto-demo-banner')?.remove();
    const el = document.createElement('div'); el.id = 'chocto-demo-banner';
    el.textContent = `🎉 DEMO: ${name} (${Math.round(durationMs/1000)}s)`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), durationMs);
  },

  _cancelDemo() {
    if (this._demoTimer) { clearTimeout(this._demoTimer); this._demoTimer = null; }
    this._demoIdx = 0;
    this._inDemo  = false;
    document.getElementById('chocto-demo-banner')?.remove();
    this._updateNow(true); // restore real calendar state
  },

  destroy() {
    if (this._timer)     clearTimeout(this._timer);
    if (this._demoTimer) clearTimeout(this._demoTimer);
    this._el?.remove();
    document.getElementById('chocto-demo-banner')?.remove();
  },

  getCurrentDay: getChoctoDay,
};

export default ChoctoCalendar;
