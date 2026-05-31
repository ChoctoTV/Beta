'use strict';
const { calcReward, calcDrops } = require('../economy/calcReward');
const Duty         = require('../economy/duty');
const GameResponses = require('../core/GameResponses');

module.exports = {
  name:'toss', permissions:'viewer', cooldown:60, strictCooldown:true,  // 1 per minute per user
  async execute(ctx) {
    const { userId, user, say, cfg, broadcast, Balance, Inventory, PupCore, Lurk, SpriteManager, CHANNEL, isLurkTick, isSub, isHowliday, adBreakActive, db } = ctx;
    if (!isLurkTick && Lurk.isActive(userId)) { Lurk.remove(userId); }
    const pc      = PupCore.getCachedState(userId);
    const sprite  = SpriteManager.pickRandom();
    const PupXP   = require('../economy/pupXP');
    const effRarity = PupXP.getEffectiveRarity(db, userId, PupCore, sprite.rarity);
    const rarLabel  = effRarity.charAt(0).toUpperCase() + effRarity.slice(1);
    // Appearance chance: common 25% · rare 12% · epic 5% · legendary 2%
    const _pcChance = {'legendary':0.02,'epic':0.05,'rare':0.12,'common':0.25}[effRarity] ?? 0.10;
    const usePC   = !!pc?.favPupImageURL && Math.random() < _pcChance;
    const favPup = usePC ? { imageUrl:pc.favPupImageURL, pcSkyConfig:pc.favPupSkyConfig, sparkle:pc.favPupSparkle, num:pc.favPupNum } : null;
    const bonuses = SpriteManager.getBonuses(sprite.name, 'toss');
    const favName = usePC ? (pc?.favPupName || null) : null;
    const pupName    = usePC ? (favName || sprite.name) : sprite.name;
    // Format name with (Rarity) tag for chat display

    const taggedName = `${pupName} (${rarLabel})`;
    const { amount } = calcReward('toss', cfg, {
      usePC, favGame:bonuses.favGame, favWeather:bonuses.favWeather,
      modOnDuty:Duty.modBoost(cfg)>0, rarity: usePC ? effRarity : sprite.rarity,
      isSub, isHowliday, adBreakActive});
    const drops  = calcDrops(cfg);
    const newBal = Balance.add(userId, amount, user);
    Inventory.add(userId, drops, user);
    const bon = [];
    if (usePC) bon.push('favpup +25%');
    if (bonuses.favGame)    bon.push('fav game +10%');
    if (bonuses.favWeather) bon.push('fav weather +10%');
    const resp = GameResponses.getResponse('toss', effRarity, taggedName, amount, bon);
    if (resp.emptyPaws) { say(`@${user}: ${resp.line}`); return {ok:true}; }
    say(`@${user}: ${resp.line}`);

    broadcast({ type:'game', command:'toss', user, userId, balance:newBal, reward:amount, drops,
      favPup, pupName, rarity:effRarity,
      pcImageURL:    usePC ? pc?.favPupImageURL : null,
      pcDisplayName: usePC ? (favName ? `${favName} (${rarLabel})` : taggedName) : taggedName,
      pcSkyConfig:   usePC ? pc?.favPupSkyConfig : null,
      pcSparkle:     usePC ? pc?.favPupSparkle   : null,
      pupId:         sprite.name }); // sprite.name = PNG filename for exact lookup
    return {ok:true};
  },
};
