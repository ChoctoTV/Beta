'use strict';
const { calcReward, calcDrops } = require('../economy/calcReward');
const Duty         = require('../economy/duty');
const GameResponses = require('../core/GameResponses');

module.exports = {
  name:'walk', permissions:'viewer', cooldown:180, strictCooldown:true,
  async execute(ctx) {
    const { userId, user, say, cfg, broadcast, Balance, Inventory, PupCore, Lurk,
            SpriteManager, CHANNEL, isLurkTick, isSub, isHowliday, adBreakActive, db } = ctx;
    if (!isLurkTick && Lurk.isActive(userId)) { Lurk.remove(userId); }

    const pc      = PupCore.getCachedState(userId);
    const favPup  = pc?.favPupImageURL
      ? { imageUrl:pc.favPupImageURL, pcSkyConfig:pc.favPupSkyConfig, sparkle:pc.favPupSparkle, num:pc.favPupNum }
      : null;
    const sprite  = SpriteManager.pickRandom();
    const bonuses = SpriteManager.getBonuses(sprite.name, 'walk');
    const usePC   = !!favPup;
    const favName = pc?.favPupName || null;
    const pupName = usePC ? (favName || sprite.name) : sprite.name;

    const PupXP     = require('../economy/pupXP');
    const effRarity = PupXP.getEffectiveRarity(db, userId, PupCore, sprite.rarity);
    const rarLabel  = effRarity.charAt(0).toUpperCase() + effRarity.slice(1);
    const taggedName = `${pupName} (${rarLabel})`;

    const { amount } = calcReward('walk', cfg, {
      usePC, favGame:bonuses.favGame, favWeather:bonuses.favWeather,
      modOnDuty:Duty.modBoost(cfg)>0, rarity:effRarity,
      isSub, isHowliday, adBreakActive});
    const drops  = calcDrops(cfg);
    const newBal = Balance.add(userId, amount, user);
    Inventory.add(userId, drops, user);

    const bon = [];
    if (usePC) bon.push('favpup +25%');
    if (bonuses.favGame)    bon.push('fav game +10%');
    if (bonuses.favWeather) bon.push('fav weather +10%');

    const resp = GameResponses.getResponse('walk', effRarity, taggedName, amount, bon);
    if (resp.emptyPaws) { say(`@${user}: ${resp.line}`); return {ok:true}; }
    say(`@${user}: ${resp.line}`);

    const _top = Balance.top(50, CHANNEL);
    const _ri  = _top.findIndex(r => r.display?.toLowerCase() === userId);
    if (_ri >= 0) { say(`@${user} is #${_ri+1} on the leaderboard.`); }

    // Look up NFT level for sprite scaling in overlay
    let nftLevel = 1;
    try {
      const _state = PupCore.getCachedState(userId);
      if (_state?.favPupMint) {
        const st = PupXP.getStats(db, _state.favPupMint);
        nftLevel = st?.level || 1;
      }
    } catch {}

    broadcast({ type:'game', command:'walk', user, userId, balance:newBal, reward:amount, drops,
      favPup, pupName, nftLevel, rarity:effRarity,
      pcImageURL:    usePC ? pc?.favPupImageURL : null,
      pcDisplayName: usePC ? (favName ? `${favName} (${rarLabel})` : taggedName) : taggedName,
      pcSkyConfig:   usePC ? pc?.favPupSkyConfig : null,
      pcSparkle:     usePC ? pc?.favPupSparkle   : null,
      pupId:         sprite.name });
    return {ok:true};
  },
};
