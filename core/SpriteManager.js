/**
 * SpriteManager — server-side sprite selection and daily bonus assignment.
 *
 * Each sprite gets randomly assigned favGame + favWeather at midnight UTC.
 * These reset every day — users cannot set them. The server knows which
 * sprite was chosen for each play (sent as pupName in broadcast), so
 * chat responses can use the actual PNG filename as the pup's name.
 *
 * Weather is also server-driven: randomly changes every ~15 min and is
 * pushed to the overlay via { type:'weather', weather:'sunny' } etc.
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const GAMES    = ['walk','toss','throw','dig','fish'];
const WEATHERS = ['sunny','cloudy','rainy','stormy','snowy','windy'];
const META_PATH = path.join(__dirname, '../yardpets3/assets/sprites_meta.json');

let _sprites     = [];   // flat array of { name, rarity }
let _dailyBonus  = new Map(); // spriteName → { favGame, favWeather }
let _weather     = 'sunny';  // current stream weather (server-authoritative)
let _broadcast   = null;

// ── Load & flatten sprite manifest ───────────────────────────────────────────
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
    _sprites = (Array.isArray(raw) ? raw : [raw])
      .flatMap(sheet => sheet.sprites || [])
      .filter(s => s.name)
      .map(s => ({ name: s.name, rarity: (s.rarity || 'Common').toLowerCase() }));
    console.log(`[Sprites] ${_sprites.length} sprites loaded`);
  } catch (e) {
    console.warn('[Sprites] Could not load sprites_meta.json:', e.message);
    _sprites = [];
  }
}

// ── Daily bonus regeneration (midnight UTC) ───────────────────────────────────
function generateDailyBonuses() {
  _dailyBonus.clear();
  for (const s of _sprites) {
    _dailyBonus.set(s.name, {
      favGame:    GAMES[Math.floor(Math.random() * GAMES.length)],
      favWeather: WEATHERS[Math.floor(Math.random() * WEATHERS.length)],
    });
  }
  console.log(`[Sprites] Daily bonuses regenerated for ${_dailyBonus.size} sprites`);
  if (_broadcast) _broadcast({ type:'daily_bonuses', ts: new Date().toISOString() });
}

// ── Persist / restore daily bonuses and weather ──────────────────────────────
function saveState() {
  try {
    const db   = require('../db');
    const date = new Date().toISOString().slice(0,10);
    db.prepare("INSERT OR REPLACE INTO app_state (key,value) VALUES ('weather',?)").run(_weather);
    const insert = db.prepare('INSERT OR REPLACE INTO sprite_bonuses (sprite_name,date,fav_game,fav_weather) VALUES (?,?,?,?)');
    db.transaction(() => {
      for (const [name, bonus] of _dailyBonus) insert.run(name, date, bonus.favGame, bonus.favWeather);
    })();
    console.log(`[Sprites] State saved (${_dailyBonus.size} bonuses, weather:${_weather})`);
  } catch (e) { console.warn('[Sprites] Save failed:', e.message); }
}

function restoreState() {
  try {
    const db   = require('../db');
    const date = new Date().toISOString().slice(0,10);
    // Restore weather
    const wRow = db.prepare("SELECT value FROM app_state WHERE key='weather'").get();
    if (wRow) { _weather = wRow.value; console.log('[Sprites] Weather restored:', _weather); }
    // Restore daily bonuses (only today's)
    const rows = db.prepare('SELECT sprite_name,fav_game,fav_weather FROM sprite_bonuses WHERE date=?').all(date);
    if (rows.length) {
      _dailyBonus.clear();
      for (const r of rows) _dailyBonus.set(r.sprite_name, { favGame:r.fav_game, favWeather:r.fav_weather });
      console.log(`[Sprites] ${rows.length} daily bonuses restored from DB`);
      return true; // restored — no need to regenerate
    }
    return false; // nothing to restore
  } catch (e) { console.warn('[Sprites] Restore failed:', e.message); return false; }
}

// Schedule midnight UTC reset
function scheduleDailyReset() {
  const now  = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  setTimeout(() => { generateDailyBonuses(); scheduleDailyReset(); }, next - now);
}

// ── Weather management ────────────────────────────────────────────────────────
function changeWeather(cfg) {
  const minMs = cfg ? cfg('weather_min_ms') : 900000;
  _weather = WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
  if (_broadcast) _broadcast({ type:'weather', weather: _weather });
  // Schedule next change (min interval + random extra up to 10 min)
  const nextMs = minMs + Math.random() * 600000;
  setTimeout(() => changeWeather(cfg), nextMs);
}

function getWeather()  { return _weather; }
function setWeather(w) { _weather = w; }

// ── Sprite selection ──────────────────────────────────────────────────────────
function pickRandom(rarity) {
  const pool = rarity
    ? _sprites.filter(s => s.rarity === rarity.toLowerCase())
    : _sprites;
  const src = pool.length ? pool : _sprites;
  if (!src.length) return { name:'pup', rarity:'common' };
  return src[Math.floor(Math.random() * src.length)];
}

// ── Bonus check for a sprite on a given game ─────────────────────────────────
function getBonuses(spriteName, game) {
  const daily = _dailyBonus.get(spriteName);
  if (!daily) return { favGame: false, favWeather: false, dailyFavGame: null, dailyFavWeather: null };
  return {
    favGame:         daily.favGame    === game,
    favWeather:      daily.favWeather === _weather,
    dailyFavGame:    daily.favGame,
    dailyFavWeather: daily.favWeather,
  };
}

function setEventBroadcast(fn) { _broadcast = fn; }
function sprites()             { return _sprites; }
function rarities()            { return [...new Set(_sprites.map(s => s.rarity))]; }

// Init
load();
// Try to restore from DB first; generate fresh if nothing saved for today
if (!restoreState()) generateDailyBonuses();
scheduleDailyReset();

module.exports = { pickRandom, getBonuses, getWeather, setWeather,
                   changeWeather, setEventBroadcast, sprites, rarities,
                   saveState, restoreState };
