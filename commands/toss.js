'use strict';
const { calcReward, calcDrops } = require('../economy/calcReward');
const Duty         = require('../economy/duty');
const GameResponses = require('../core/GameResponses');

module.exports = {
  name:'toss', permissions:'viewer', cooldown:true,
  async execute(ctx) {
    const { userId, user, say, cfg, broadcast, Balance, Inventory, PupCore, Lurk, SpriteManager, CHANNEL, isLurkTick } = ctx;
    if (!isLurkTick && Lurk.isActive(userId)) { Lurk.remove(userId); }
    var catchFav = null;
    const pc     = PupCore.getCachedState(userId);
    const usePC  = !!pc?.favPupImageURL && Math.random() < 0.1;
    const favPup = usePC ? { imageUrl:pc.favPupImageURL, pcSkyConfig:pc.favPupSkyConfig, sparkle:pc.favPupSparkle, num:pc.favPupNum } : null;
    const sprite  = SpriteManager.pickRandom();
    const bonuses = SpriteManager.getBonuses(sprite.name, 'toss');
    const favName = usePC ? (pc?.favPupName || null) : null;
    const pupName    = usePC ? (favName || sprite.name) : sprite.name;
    // Format name with (Rarity) tag for chat display
    const rarLabel   = sprite.rarity.charAt(0).toUpperCase() + sprite.rarity.slice(1);
    const taggedName = `${pupName} (${rarLabel})`;
    const { amount } = calcReward('toss', cfg, {
      usePC, favGame:bonuses.favGame, favWeather:bonuses.favWeather,
      modOnDuty:Duty.modBoost(cfg)>0, rarity:sprite.rarity });
    const drops  = calcDrops(cfg);
    const newBal = Balance.add(userId, amount, user);
    Inventory.add(userId, drops, user);
    const bon = [];
    if (usePC) bon.push('favpup +25%');
    if (bonuses.favGame)    bon.push('fav game +10%');
    if (bonuses.favWeather) bon.push('fav weather +10%');
    const resp = GameResponses.getResponse('toss', sprite.rarity, taggedName, amount, bon);
    if (resp.emptyPaws) { say(`@${user}: ${resp.line}`); return {ok:true}; }
    say(`@${user}: ${resp.line}`);

    broadcast({ type:'game', command:'toss', user, userId, balance:newBal, reward:amount, drops,
      favPup, pupName, rarity:sprite.rarity,
      pcImageURL:    usePC ? pc?.favPupImageURL : null,
      pcDisplayName: usePC ? (favName ? `${favName} (${rarLabel})` : taggedName) : taggedName,
      pcSkyConfig:   usePC ? pc?.favPupSkyConfig : null,
      pcSparkle:     usePC ? pc?.favPupSparkle   : null,
      pupId:         sprite.name }); // sprite.name = PNG filename for exact lookup
    return {ok:true};
  },
};
