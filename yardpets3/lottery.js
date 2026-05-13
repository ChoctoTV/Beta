'use strict';
const fs   = require('fs');
const path = require('path');

const DATA_FILE = path.resolve(__dirname, 'lottery.json');

// ─── Data ─────────────────────────────────────────────────────────────────────
let data = {
  tickets:  {},    // { username: "1342" }
  lastDraw: null,  // { date:"YYYY-MM-DD", numbers:"1432", winners:[{user,ticket,matches,winnings}] }
};

function load() {
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    console.log(`[Lottery] Loaded — ${Object.keys(data.tickets).length} tickets`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[Lottery] Load error:', e.message);
  }
}

function save() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('[Lottery] Save error:', e.message); }
}

load();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function formatTicket(t) {
  return t.split('').join('-'); // "1342" → "1-3-4-2"
}

function validateTicket(input) {
  const clean = (input || '').toString().replace(/\s+/g, '').replace(/-/g, '');
  if (!/^[1-4]{4}$/.test(clean)) return null;
  return clean;
}

function countMatches(ticket, drawn) {
  let m = 0;
  for (let i = 0; i < 4; i++) if (ticket[i] === drawn[i]) m++;
  return m;
}

function randomNumbers() {
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 4) + 1).join('');
}

function msUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight - now;
}

function timeUntilDraw() {
  const ms = msUntilMidnight();
  const h  = Math.floor(ms / 3_600_000);
  const m  = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

// ─── Core API ─────────────────────────────────────────────────────────────────
function getTicket(user) {
  return data.tickets[user] || null;
}

function setTicket(user, raw) {
  const ticket = validateTicket(raw);
  if (!ticket) return { ok: false, error: 'Invalid ticket — use 4 digits, each 1-4 (e.g. 1342)' };
  data.tickets[user] = ticket;
  save();
  return { ok: true, ticket };
}

function getLastDraw() {
  return data.lastDraw || null;
}

function alreadyDrawnToday() {
  return data.lastDraw?.date === todayStr();
}

// Run the daily draw — returns results
function runDraw(addBalanceFn) {
  const drawn   = randomNumbers();
  const date    = todayStr();
  const winners = [];

  for (const [user, ticket] of Object.entries(data.tickets)) {
    const matches  = countMatches(ticket, drawn);
    const winnings = matches * 1000;
    winners.push({ user, ticket, matches, winnings });
    if (winnings > 0 && addBalanceFn) {
      addBalanceFn(user, winnings).catch(() => {});
    }
  }

  winners.sort((a, b) => b.winnings - a.winnings);

  data.lastDraw = { date, numbers: drawn, winners };
  save();

  console.log(`[Lottery] Draw! Numbers: ${formatTicket(drawn)} | ${winners.filter(w => w.winnings > 0).length} winners`);
  return { drawn, date, winners };
}

// ─── Ticket info for a user ───────────────────────────────────────────────────
function ticketInfo(user) {
  const ticket   = getTicket(user);
  const lastDraw = getLastDraw();
  const today    = alreadyDrawnToday();

  let matchInfo = null;
  if (ticket && lastDraw) {
    const matches  = countMatches(ticket, lastDraw.numbers);
    const winnings = matches * 1000;
    matchInfo = { matches, winnings, drawn: lastDraw.numbers, date: lastDraw.date };
  }

  return {
    ticket,
    matchInfo,
    drawnToday: today,
    nextDraw:   timeUntilDraw(),
  };
}

// ─── Schedule automatic daily draw ───────────────────────────────────────────
function scheduleDraw(addBalanceFn, announceFn) {
  const scheduleNext = () => {
    const ms = msUntilMidnight() + 500; // +500ms buffer past midnight
    console.log(`[Lottery] Next draw in ${timeUntilDraw()}`);
    setTimeout(() => {
      if (!alreadyDrawnToday()) {
        const result = runDraw(addBalanceFn);
        if (announceFn) announceFn(result);
      }
      scheduleNext(); // schedule the next day's draw
    }, ms);
  };
  scheduleNext();
}

module.exports = {
  getTicket, setTicket, getLastDraw, alreadyDrawnToday,
  runDraw, ticketInfo, scheduleDraw,
  formatTicket, validateTicket, timeUntilDraw,
};
