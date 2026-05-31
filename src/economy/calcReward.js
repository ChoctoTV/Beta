'use strict';
const MoraleState   = require('../core/MoraleState');
const DynRewards    = require('./dynamicRewards');

// Rarity key → config key mapping
const RARITY_CFG = { common:'rarity_common_mult', rare:'rarity_rare_mult',
                     epic:'rarity_epic_mult', legendary:'rarity_legendary_mult' };

// Exported table for display (falls back to DEFAULTS if cfg unavailable)
const RARITY_MULT = { common:1, rare:2, epic:3, legendary:5 };
function rarityMult(rarity, cfg) {
  const key = RARITY_CFG[(rarity||'common').toLowerCase()];
  return (cfg && key) ? (cfg(key) || RARITY_MULT[(rarity||'common').toLowerCase()] || 1)
                      : (RARITY_MULT[(rarity||'common').toLowerCase()] || 1);
}

function calcReward(game, cfg, opts={}) {
  const { usePC=false, favGame=false, favWeather=false,
          modOnDuty=false, lurkMult=1, activeScale=1, rarity='common',
          isSub=false, isHowliday=false, adBreakActive=false } = opts;
  const base = cfg(`${game}_min`) + Math.random() * (cfg(`${game}_max`) - cfg(`${game}_min`));
  let mult = 1.0;
  const bonuses = [];
  if (usePC) {
    const b = cfg('favpup_bonus') || 0.25;
    mult += b;
    bonuses.push(`favpup+${Math.round(b*100)}%`);
  }
  if (favGame) {
    const b = cfg('favgame_bonus') || 0.10;
    mult += b;
    bonuses.push(`fav game+${Math.round(b*100)}%`);
  }
  if (favWeather) {
    const b = cfg('favweather_bonus') || 0.10;
    mult += b;
    bonuses.push(`fav weather+${Math.round(b*100)}%`);
  }
  if (modOnDuty) {
    const b = cfg('mod_onduty_boost') || 0.10;
    mult += b;
    bonuses.push(`mod+${Math.round(b*100)}%`);
  }
  // ── Sub bonus: +10% normally, +20% on howlidays (double) ──────────────────
  if (isSub) {
    const subBase = cfg('sub_reward_bonus') || 0.10;
    const subMult = isHowliday ? subBase * 2 : subBase;
    mult += subMult;
    bonuses.push(isHowliday ? `sub+${Math.round(subMult*100)}%🎉` : `sub+${Math.round(subMult*100)}%`);
  }
  // ── Ad break bonus: +10% while ads are running ────────────────────────────
  if (adBreakActive) {
    const adB = cfg('ad_break_reward_bonus') || 0.10;
    mult += adB;
    bonuses.push(`ad+${Math.round(adB*100)}%`);
  }
  const rmult  = rarityMult(rarity, cfg);
  const amount = Math.round(base * mult * (cfg('reward_multiplier')||1) * activeScale * lurkMult * rmult);
  return { amount, bonuses };
}
function calcDrops(cfg) {
  // Only ONE resource type per reward — moons rarest, balls uncommon, sticks common
  if (Math.random() < (cfg('moon_chance') || 0.05)) {
    return { sticks:0, balls:0, moons:1 };
  }
  const ballChance = cfg('ball_chance') || 0.20;
  if (Math.random() < ballChance) {
    const balls = Math.floor((cfg('balls_min')||1) + Math.random()*((cfg('balls_max')||3)-(cfg('balls_min')||1)+1));
    return { sticks:0, balls, moons:0 };
  }
  const sticks = Math.floor((cfg('sticks_min')||3) + Math.random()*((cfg('sticks_max')||5)-(cfg('sticks_min')||3)+1));
  return { sticks, balls:0, moons:0 };
}
module.exports = { calcReward, calcDrops, rarityMult, RARITY_MULT };
