'use strict';
/**
 * ChoctoCalendarHelper — server-side dog-date calculator.
 * Mirrors the formula in yardpets3/modules/choctoCalendar/choctoCalendar.js.
 * Used by app.js (howliday announcements, reward bonuses) and commands (!lore, !tradition).
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

const MONTH_STARTS = [];
let _off = 0;
for (const m of DOG_MONTHS) { MONTH_STARTS.push(_off); _off += m.days; }

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

function getChoctoDay(nowMs) {
  const d     = new Date(nowMs ?? Date.now());
  const year  = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const date  = d.getUTCDate();
  const hh    = d.getUTCHours();
  const mm    = d.getUTCMinutes();
  const ss    = d.getUTCSeconds();

  const GREG = [31,28,31,30,31,30,31,31,30,31,30,31];
  let gregDayOfYear = date - 1;
  for (let m = 0; m < month; m++) gregDayOfYear += GREG[m];

  const humanDays  = (year - 1) * 365 + gregDayOfYear
                   + (hh * 3600 + mm * 60 + ss) / 86400;
  const dogDaysTotal = humanDays * 7;
  const dogDaysInt   = Math.floor(dogDaysTotal);
  const dogFrac      = dogDaysTotal - dogDaysInt;

  const dogYear    = Math.floor(dogDaysInt / 365) + 1;
  const dogDayOfYr = dogDaysInt % 365;

  let dogMonthIdx = 0;
  for (let i = DOG_MONTHS.length - 1; i >= 0; i--) {
    if (dogDayOfYr >= MONTH_STARTS[i]) { dogMonthIdx = i; break; }
  }
  const dogDay     = dogDayOfYr - MONTH_STARTS[dogMonthIdx] + 1;
  const dogWeekday = dogDaysInt % 7;

  // Dog time-of-day
  const dogSecInDay = Math.floor(dogFrac * 86400);
  const dogHour     = Math.floor(dogSecInDay / 3600);
  const dogMin      = Math.floor((dogSecInDay % 3600) / 60);
  const dogSec      = dogSecInDay % 60;

  const howlidayData = HOWLIDAYS.find(h => h.monthIndex === dogMonthIdx && h.day === dogDay) || null;

  return {
    dogYear, dogMonthIdx, dogMonth: DOG_MONTHS[dogMonthIdx].name,
    dogDay, dogDayOfYr, dogWeekday, dogWeekdayName: WEEKDAYS[dogWeekday],
    dogHour, dogMin, dogSec,
    isHowliday:    !!howlidayData,
    howlidayName:  howlidayData?.name  || null,
    howlidayData:  howlidayData        || null,
    HOWLIDAYS,     // expose for lookahead
  };
}

/**
 * Returns the howliday approaching within the next N dog-days, or null.
 * Used for pre-howliday announcements.
 */
function getUpcomingHowliday(withinDogDays = 7) {
  const now = getChoctoDay();
  for (let d = 1; d <= withinDogDays; d++) {
    // Each dog-day = (24*3600*1000/7) real ms
    const futureDogDay = getChoctoDay(Date.now() + d * Math.floor(24 * 3600 * 1000 / 7));
    if (futureDogDay.isHowliday) {
      return { howliday: futureDogDay.howlidayData, dogDaysAway: d };
    }
  }
  return null;
}

/**
 * Format a day number with English ordinal suffix: 1st, 2nd, 3rd, 4th, ...
 */
function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return n + 'th';
  switch (n % 10) {
    case 1: return n + 'st';
    case 2: return n + 'nd';
    case 3: return n + 'rd';
    default: return n + 'th';
  }
}

/**
 * Returns a single string in the format:
 *   "Time HH:MM <suffix>, Date Month Day{ordinal} Year"
 * Suffix is "noon" at 12:00, "midnight" at 00:00, otherwise "AM" / "PM"
 * with the hour shown in 12-hour format.
 */
function formatTimeDate(day) {
  day = day || getChoctoDay();
  const h  = day.dogHour;
  const m  = day.dogMin;
  const mm = String(m).padStart(2, '0');

  let suffix, hh;
  if (h === 12 && m === 0)      { suffix = 'noon';     hh = 12; }
  else if (h === 0 && m === 0)  { suffix = 'midnight'; hh = 12; }
  else if (h < 12)              { suffix = 'AM'; hh = h === 0 ? 12 : h; }
  else                          { suffix = 'PM'; hh = h === 12 ? 12 : h - 12; }

  return `Time ${hh}:${mm} ${suffix}, Date ${day.dogMonth} ${ordinal(day.dogDay)} ${day.dogYear}`;
}

module.exports = { getChoctoDay, getUpcomingHowliday, HOWLIDAYS, DOG_MONTHS, ordinal, formatTimeDate };
