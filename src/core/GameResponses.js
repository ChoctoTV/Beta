/**
 * Game chat responses — 3-5 per game per rarity tier.
 * Pups always bring rewards BACK TO THE USER — never claim or earn for themselves.
 * <1% chance of empty paws.
 */
'use strict';

const EMPTY_PAW_CHANCE = 0.008; // 0.8%

const EMPTY_PAWS = {
  walk:  n => `${n} explored the whole yard and came back with muddy paws and nothing else. 🐾`,
  toss:  n => `${n} chased the stick... then buried it somewhere. Back empty-pawed. 🐾`,
  throw: n => `${n} fetched the ball... and decided to keep it. Nothing brought back. 🐾`,
  dig:   n => `${n} dug all afternoon and found absolutely nothing. 🕳️`,
  fish:  n => `${n} stared at the pond for ages and caught zero. 🎣`,
};

const R = {

  walk: {
    common: [
      (n,a,b) => `${n} trots the yard perimeter and brings back ${a}🍫 for you!${b}`,
      (n,a,b) => `${n} explored every corner and dug up ${a}🍫 for you!${b}`,
      (n,a,b) => `${n} completed the full yard loop and dropped ${a}🍫 at your feet!${b}`,
    ],
    rare: [
      (n,a,b) => `✨ ${n} dashes the full perimeter and returns with ${a}🍫 for you!${b}`,
      (n,a,b) => `✨ ${n} scouted the yard and uncovered ${a}🍫 — all yours!${b}`,
      (n,a,b) => `✨ ${n} blazed through the yard and dropped ${a}🍫 right at your feet!${b}`,
      (n,a,b) => `✨ ${n} knew exactly where to look — brought back ${a}🍫 for you!${b}`,
    ],
    epic: [
      (n,a,b) => `🌟 ${n} SPRINTS the perimeter and delivers ${a}🍫 straight to you!${b}`,
      (n,a,b) => `🌟 ${n} doesn't walk — ${n} hunts. Found ${a}🍫 and brought it back!${b}`,
      (n,a,b) => `🌟 Epic stride! ${n} drops ${a}🍫 at your feet!${b}`,
      (n,a,b) => `🌟 ${n} mapped every inch of the yard and hauled back ${a}🍫 for you!${b}`,
      (n,a,b) => `🌟 The whole yard surveyed — ${n} brings you ${a}🍫!${b}`,
    ],
    legendary: [
      (n,a,b) => `👑 LEGENDARY! ${n} blazes the yard like a comet and drops ${a}🍫 in your lap!${b}`,
      (n,a,b) => `👑 ${n} walks where others dare not — returns with ${a}🍫 for you!${b}`,
      (n,a,b) => `👑 The yard trembles as ${n} makes the full loop, delivering ${a}🍫!${b}`,
      (n,a,b) => `👑 ${n} — the legend — drops ${a}🍫 at your feet like it's nothing!${b}`,
      (n,a,b) => `👑 They said it couldn't be done. ${n} did it and brought back ${a}🍫!${b}`,
    ],
  },

  toss: {
    common: [
      (n,a,b) => `${n} chases the stick and brings back ${a}🍫 for you!${b}`,
      (n,a,b) => `${n} fetches it and digs up ${a}🍫 on the way back!${b}`,
      (n,a,b) => `${n} returns the stick with ${a}🍫 attached for you!${b}`,
    ],
    rare: [
      (n,a,b) => `✨ ${n} leaps, snatches the stick, and brings back ${a}🍫!${b}`,
      (n,a,b) => `✨ Perfect fetch! ${n} drops ${a}🍫 at your feet!${b}`,
      (n,a,b) => `✨ ${n} goes long for the stick and returns with ${a}🍫 for you!${b}`,
      (n,a,b) => `✨ What a fetch! ${n} brought back ${a}🍫!${b}`,
    ],
    epic: [
      (n,a,b) => `🌟 ${n} LAUNCHES after the stick and drops ${a}🍫 at your feet!${b}`,
      (n,a,b) => `🌟 Incredible fetch! ${n} brings you ${a}🍫!${b}`,
      (n,a,b) => `🌟 ${n} doesn't just fetch — ${n} CONQUERS and delivers ${a}🍫!${b}`,
      (n,a,b) => `🌟 The stick never had a chance. ${n} brings back ${a}🍫 for you!${b}`,
      (n,a,b) => `🌟 ${n} sets a new yard record delivering ${a}🍫 to you!${b}`,
    ],
    legendary: [
      (n,a,b) => `👑 LEGENDARY FETCH! ${n} defies gravity and drops ${a}🍫 at your feet!${b}`,
      (n,a,b) => `👑 ${n} fetched the stick before it even landed — brings you ${a}🍫!${b}`,
      (n,a,b) => `👑 The stick is no match for ${n}. Returned with ${a}🍫 for you!${b}`,
      (n,a,b) => `👑 ${n} makes fetching look like an art form — drops ${a}🍫 in your lap!${b}`,
      (n,a,b) => `👑 Was that a pup or a missile? ${n} brings back ${a}🍫!${b}`,
    ],
  },

  throw: {
    common: [
      (n,a,b) => `${n} sprints after the ball and brings back ${a}🍫 for you!${b}`,
      (n,a,b) => `${n} catches the ball and drops ${a}🍫 at your feet!${b}`,
      (n,a,b) => `${n} brings the ball back with ${a}🍫 scored for you!${b}`,
    ],
    rare: [
      (n,a,b) => `✨ ${n} leaps and snatches the ball — brings you ${a}🍫!${b}`,
      (n,a,b) => `✨ Athletic! ${n} tracks the ball perfectly and drops ${a}🍫 for you!${b}`,
      (n,a,b) => `✨ ${n} pulls off a diving catch and brings back ${a}🍫!${b}`,
      (n,a,b) => `✨ The crowd goes wild as ${n} delivers ${a}🍫 to you!${b}`,
    ],
    epic: [
      (n,a,b) => `🌟 ${n} SOARS for the ball and brings ${a}🍫 back to you!${b}`,
      (n,a,b) => `🌟 One-paw catch — ${n} scores ${a}🍫 for you!${b}`,
      (n,a,b) => `🌟 ${n} runs, leaps, catches — flawless! Drops ${a}🍫 at your feet!${b}`,
      (n,a,b) => `🌟 ${n} turned a simple throw into ${a}🍫 for you!${b}`,
      (n,a,b) => `🌟 Jaw-dropping catch by ${n} — brings you ${a}🍫!${b}`,
    ],
    legendary: [
      (n,a,b) => `👑 LEGENDARY! ${n} catches with eyes closed and drops ${a}🍫 in your lap!${b}`,
      (n,a,b) => `👑 ${n} broke three yard records getting ${a}🍫 back to you!${b}`,
      (n,a,b) => `👑 Physics didn't apply to ${n} just then — brings you ${a}🍫!${b}`,
      (n,a,b) => `👑 ${n} has paws of gold — drops ${a}🍫 at your feet!${b}`,
      (n,a,b) => `👑 The ball surrendered willingly to ${n}. ${a}🍫 delivered to you!${b}`,
    ],
  },

  dig: {
    common: [
      (n,a,b) => `${n} digs up ${a}🍫 from the yard and drops it at your feet!${b}`,
      (n,a,b) => `${n} paws at the dirt and brings you ${a}🍫!${b}`,
      (n,a,b) => `${n} unearths ${a}🍫 and delivers it right to you!${b}`,
    ],
    rare: [
      (n,a,b) => `✨ ${n} digs with precision and surfaces with ${a}🍫 for you!${b}`,
      (n,a,b) => `✨ ${n} tunnels right to the jackpot — brings you ${a}🍫!${b}`,
      (n,a,b) => `✨ Expert nose leads ${n} to ${a}🍫 buried deep — delivered!${b}`,
      (n,a,b) => `✨ ${n} clears half the yard and surfaces with ${a}🍫 for you!${b}`,
    ],
    epic: [
      (n,a,b) => `🌟 ${n} EXCAVATES at blistering speed and brings you ${a}🍫!${b}`,
      (n,a,b) => `🌟 ${n} goes down 4 feet and pulls out ${a}🍫 for you!${b}`,
      (n,a,b) => `🌟 The whole yard shook — ${n} surfaces with ${a}🍫 for you!${b}`,
      (n,a,b) => `🌟 ${n} sensed the treasure and brought back ${a}🍫!${b}`,
      (n,a,b) => `🌟 Spectacular excavation — ${n} drops ${a}🍫 at your feet!${b}`,
    ],
    legendary: [
      (n,a,b) => `👑 ${n} digs to the CORE and surfaces with ${a}🍫 for you!${b}`,
      (n,a,b) => `👑 LEGENDARY dig! ${n} strikes the motherlode and brings you ${a}🍫!${b}`,
      (n,a,b) => `👑 ${n} smelled this stash from three yards away — delivered ${a}🍫!${b}`,
      (n,a,b) => `👑 The earth itself yielded to ${n}. ${a}🍫 dropped at your feet!${b}`,
      (n,a,b) => `👑 Geologists couldn't find it. ${n} did, and brought you ${a}🍫!${b}`,
    ],
  },

  fish: {
    common: [
      (n,a,b) => `${n} fishes the pond and reels in ${a}🍫 for you!${b}`,
      (n,a,b) => `${n} pulls something in and drops ${a}🍫 at your feet!${b}`,
      (n,a,b) => `${n} got a bite — brought back ${a}🍫 worth of loot for you!${b}`,
    ],
    rare: [
      (n,a,b) => `✨ ${n} hooks a rare catch and brings you ${a}🍫!${b}`,
      (n,a,b) => `✨ Expert angler ${n} hauls in ${a}🍫 for you!${b}`,
      (n,a,b) => `✨ ${n} reads the pond perfectly — lands ${a}🍫 for you!${b}`,
      (n,a,b) => `✨ That's a keeper! ${n} drops ${a}🍫 at your feet!${b}`,
    ],
    epic: [
      (n,a,b) => `🌟 ${n} reels in an EPIC catch and brings you ${a}🍫!${b}`,
      (n,a,b) => `🌟 The pond had no chance — ${n} delivers ${a}🍫 to you!${b}`,
      (n,a,b) => `🌟 ${n} lands the big one and drops ${a}🍫 at your feet!${b}`,
      (n,a,b) => `🌟 Master angler ${n} scores ${a}🍫 from the deep for you!${b}`,
      (n,a,b) => `🌟 The whole pond yielded to ${n} — brings you ${a}🍫!${b}`,
    ],
    legendary: [
      (n,a,b) => `👑 LEGENDARY! ${n} pulled up ${a}🍫 from another dimension for you!${b}`,
      (n,a,b) => `👑 ${n} fished the pond into submission — drops ${a}🍫 at your feet!${b}`,
      (n,a,b) => `👑 The fish were lining up for ${n} — brings you ${a}🍫!${b}`,
      (n,a,b) => `👑 ${n} didn't even use bait. Just legend — delivers ${a}🍫 to you!${b}`,
      (n,a,b) => `👑 Scientists are baffled by what ${n} brought you: ${a}🍫!${b}`,
    ],
  },
};

/**
 * @param {string} game       - walk|toss|throw|dig|fish
 * @param {string} rarity     - common|rare|epic|legendary
 * @param {string} pupName    - sprite.name + rarity tag, e.g. "Chance (Common)"
 * @param {number} amount     - Choctobits scored for the user
 * @param {string[]} bonuses  - active bonus labels
 * @returns {{ line: string, emptyPaws: boolean }}
 */
function getResponse(game, rarity, pupName, amount, bonuses) {
  if (Math.random() < EMPTY_PAW_CHANCE) {
    const fn = EMPTY_PAWS[game] || (n => `${n} came back empty-pawed.`);
    return { line: fn(pupName), emptyPaws: true };
  }
  const tier = (rarity || 'common').toLowerCase();
  const pool = R[game]?.[tier] || R[game]?.common || [(n,a) => `${n} scored ${a}🍫 for you!`];
  const fn   = pool[Math.floor(Math.random() * pool.length)];
  const bonStr = bonuses?.length ? ` (${bonuses.join(', ')})` : '';
  return { line: fn(pupName, amount.toLocaleString(), bonStr), emptyPaws: false };
}

module.exports = { getResponse, EMPTY_PAW_CHANCE };
