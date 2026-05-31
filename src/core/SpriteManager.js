/**
 * SpriteManager — server-side sprite selection and daily bonus assignment.
 *
 * Pup PNGs live at:  assets/pups/{rarity}/{name}.png
 *   rarity folders:  common / rare / epic / legendary
 *   name = PNG filename without extension = the pup's in-game identifier
 *
 * Sprite list is built by:
 *   1. Reading assets/sprites_meta.json  (if present)
 *   2. Falling back to scanning assets/pups/{rarity}/ directories
 *
 * sprites_meta.json format (either a single object or array of sheets):
 *   [{ "sprites": [{ "name": "fido", "rarity": "common" }, ...] }]
 *   or the flat form: [{ "name": "fido", "rarity": "common" }, ...]
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const P    = require('./Paths');

const GAMES    = ['walk','toss','throw','dig','fish'];
const WEATHERS = ['sunny','cloudy','rainy','stormy','snowy','windy'];
const RARITIES = ['common','rare','epic','legendary'];

let _sprites    = [];              // [{ name, rarity }]
let _dailyBonus = new Map();       // name → { favGame, favWeather }
let _weather    = 'sunny';
let _broadcast  = null;

// ── Load sprites from meta JSON, or scan pups/ folders ───────────────────────
function load() {
  // Try sprites_meta.json first
  if (fs.existsSync(P.spriteMeta)) {
    try {
      const raw  = JSON.parse(fs.readFileSync(P.spriteMeta, 'utf8'));
      const list = Array.isArray(raw) ? raw : [raw];
      // Support both sheet format and flat format
      const items = list[0]?.sprites
        ? list.flatMap(sheet => sheet.sprites || [])
        : list;
      _sprites = items
        .filter(s => s?.name)
        .map(s => ({ name: s.name, rarity: (s.rarity || 'common').toLowerCase() }));
      if (_sprites.length) {
        console.log(`[Sprites] ${_sprites.length} sprites loaded from sprites_meta.json`);
        return;
      }
    } catch (e) {
      console.warn('[Sprites] sprites_meta.json parse error:', e.message);
    }
  }

  // Fallback: scan assets/pups/{rarity}/ directories
  _sprites = [];
  for (const rarity of RARITIES) {
    const dir = path.join(P.pups, rarity);
    if (!fs.existsSync(dir)) continue;
    try {
      const pngs = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png'));
      for (const png of pngs) {
        _sprites.push({ name: path.basename(png, '.png'), rarity });
      }
    } catch {}
  }

  if (_sprites.length) {
    console.log(`[Sprites] ${_sprites.length} sprites scanned from assets/pups/`);
  } else {
    console.warn('[Sprites] No sprites found — add PNGs to assets/pups/{rarity}/');
    _sprites = [{ name: 'pup', rarity: 'common' }]; // safe fallback
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

// ── Persist / restore state ───────────────────────────────────────────────────
function saveState() {
  try {
    const db   = require('../db');
    const date = new Date().toISOString().slice(0,10);
    db.prepare("INSERT OR REPLACE INTO app_state (key,value) VALUES ('weather',?)").run(_weather);
    const ins  = db.prepare('INSERT OR REPLACE INTO sprite_bonuses (sprite_name,date,fav_game,fav_weather) VALUES (?,?,?,?)');
    db.transaction(() => {
      for (const [name, b] of _dailyBonus) ins.run(name, date, b.favGame, b.favWeather);
    })();
  } catch (e) { console.warn('[Sprites] Save failed:', e.message); }
}

function restoreState() {
  try {
    const db   = require('../db');
    const date = new Date().toISOString().slice(0,10);
    const wRow = db.prepare("SELECT value FROM app_state WHERE key='weather'").get();
    if (wRow) _weather = wRow.value;
    const rows = db.prepare('SELECT sprite_name,fav_game,fav_weather FROM sprite_bonuses WHERE date=?').all(date);
    if (rows.length) {
      _dailyBonus.clear();
      for (const r of rows) _dailyBonus.set(r.sprite_name, { favGame:r.fav_game, favWeather:r.fav_weather });
      console.log(`[Sprites] ${rows.length} daily bonuses restored`);
      return true;
    }
    return false;
  } catch (e) { console.warn('[Sprites] Restore failed:', e.message); return false; }
}

function scheduleDailyReset() {
  const now  = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  setTimeout(() => { generateDailyBonuses(); scheduleDailyReset(); }, next - now);
}

// ── Weather ───────────────────────────────────────────────────────────────────
function changeWeather(cfg) {
  _weather = WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
  if (_broadcast) _broadcast({ type:'weather', weather: _weather });
  const nextMs = (cfg ? cfg('weather_min_ms') : 900000) + Math.random() * 600000;
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
  return src[Math.floor(Math.random() * src.length)] || { name:'pup', rarity:'common' };
}

/**
 * Return the URL path for a pup PNG so the overlay can load it.
 * Format: /assets/pups/{rarity}/{name}.png
 */
function pupImageUrl(name, rarity) {
  const r = (rarity || 'common').toLowerCase();
  return `/assets/pups/${r}/${encodeURIComponent(name)}.png`;
}

// ── Bonuses for a sprite on a given game ─────────────────────────────────────
function getBonuses(spriteName, game) {
  const daily = _dailyBonus.get(spriteName);
  if (!daily) return { favGame:false, favWeather:false, dailyFavGame:null, dailyFavWeather:null };
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

// ── Init ──────────────────────────────────────────────────────────────────────
load();
if (!restoreState()) generateDailyBonuses();
scheduleDailyReset();

module.exports = {
  pickRandom, getBonuses, pupImageUrl,
  getWeather, setWeather, changeWeather,
  setEventBroadcast, sprites, rarities,
  saveState, restoreState, load,
};
