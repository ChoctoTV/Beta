'use strict';
const fs   = require('fs');
const path = require('path');
const db   = require('../db');

const ECON = path.join(process.cwd(), 'rewardsEcon.txt');

const DEFAULTS = {
  // ── Game base rewards (Choctobits per play)
  toss_min:3,  toss_max:7,
  throw_min:3, throw_max:7,
  dig_min:3,   dig_max:7,
  walk_min:2,  walk_max:5,
  fish_min:3,  fish_max:8,

  // ── Item drops per play
  sticks_min:3, sticks_max:5,
  balls_min:1,  balls_max:3,
  moon_chance:0.05,

  // ── Rarity reward multipliers (applied on top of all other bonuses)
  rarity_common_mult:1.0,
  rarity_rare_mult:2.0,
  rarity_epic_mult:3.0,
  rarity_legendary_mult:5.0,

  // ── Fav pup bonuses (fraction added to reward multiplier, e.g. 0.25 = +25%)
  favpup_bonus:0.25,       // bonus when fav pup is featured in animation
  favgame_bonus:0.10,      // extra when pup's daily assigned game matches
  favweather_bonus:0.10,   // extra when pup's daily assigned weather matches current

  // ── On-duty mod boost
  mod_onduty_boost:0.10,   // fraction added when a mod is on duty

  // ── Global multiplier (set >1 for events, e.g. reward_multiplier = 2)
  reward_multiplier:1.0,
  earn_target_hr:25000,
  active_window_min:10,

  // ── Cooldowns (milliseconds)
  cooldown_ms:8000,
  sub_cooldown_ms:4000,

  // ── Lurk
  lurk_duration_hr:8,
  lurk_reward_mult:0.33,   // fraction of active rate (0.33 = 33%)

  // ── Chest (!lick game)
  chest_min_lock:50,
  chest_max_lock:500,

  // ── GBM (Good / Ball / Moon)
  gbm_round_min:10,        // minutes between auto-reveals (0 = manual only via !gbmreveal)
  gbm_win_reward:0,        // Choctobits bonus per winner
  gbm_tie_reward:1,

  // ── Airdrop
  airdrop_min:1000,
  airdrop_max:25000,
  airdrop_mod_budget:5000,
  airdrop_dev_budget:25000,
  airdrop_window_min:60,   // active window (minutes) used to find eligible viewers

  // ── Lottery prizes (Choctobits)
  lotto_common_prize:100,
  lotto_rare_prize:500,
  lotto_epic_prize:2000,
  lotto_jackpot_prize:10000,

  // ── Vending & Forging
  vend_sticks_rate:1,      // Choctobits per stick
  vend_balls_rate:50,
  vend_moons_rate:200,
  vend_min:100,
  vend_max:999,
  forge_balls_cost:100,    // sticks required to forge 1 ball
  forge_moons_cost:100,    // balls required to forge 1 moon

  // ── Music & Stream
  // Channel Points
  cp_auto_create:1, cp_cost_walk:5, cp_cost_toss:2, cp_cost_throw:2,
  cp_cost_dig:2,
  ad_airdrop_amount:1, ad_airdrop_lurker_pct:33, ad_airdrop_sub_bonus_pct:25,  // post-ad airdrop per active viewer    cp_cost_fish:3, cp_cost_lurk:1, cp_cost_lick:1,

  music_volume:50,
  music_enabled:1,
  autopilot_sec:45,
  weather_min_ms:900000,   // minimum ms between weather changes (15 min)
  stream_buffer_ms:3000,    // ms to delay overlay animations for stream sync (Low Latency=3000, Normal=10000, local=0)
};
let _live = { ...DEFAULTS };

function loadFile() {
  if (!fs.existsSync(ECON)) return;
  let n = 0;
  for (const raw of fs.readFileSync(ECON,'utf8').split('\n')) {
    const line = raw.split('#')[0].trim();
    const eq   = line.indexOf('=');
    if (eq < 1) continue;
    const k = line.slice(0,eq).trim();
    const v = parseFloat(line.slice(eq+1).trim());
    if (k in DEFAULTS && !isNaN(v)) { _live[k]=v; n++; }
  }
  console.log(`[Config] rewardsEcon.txt: ${n} values`);
}
function loadDB() {
  for (const {key,value} of db.prepare('SELECT key,value FROM config').all())
    if (key in DEFAULTS) _live[key] = value;
}
function reload() { _live={...DEFAULTS}; loadFile(); loadDB(); }
function get(key)       { return _live[key] ?? DEFAULTS[key]; }
function set(key, val)  {
  if (!(key in DEFAULTS)) throw new Error(`Unknown config key: ${key}`);
  _live[key] = val;
  db.prepare("INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')").run(key,val);
}
reload();
module.exports = { get, set, reload, DEFAULTS };
