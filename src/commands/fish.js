'use strict';
const { calcReward, calcDrops } = require('../economy/calcReward');
const Duty         = require('../economy/duty');
const GameResponses = require('../core/GameResponses');

module.exports = {
  name:'fish', aliases:['cast'], permissions:'viewer', cooldown:60, strictCooldown:true,  // 1 per minute per user
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
    const bonuses = SpriteManager.getBonuses(sprite.name, 'fish');
    const favName = usePC ? (pc?.favPupName || null) : null;
    const pupName    = usePC ? (favName || sprite.name) : sprite.name;
    // Format name with (Rarity) tag for chat display

    const taggedName = `${pupName} (${rarLabel})`;
    const { amount } = calcReward('fish', cfg, {
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
    const resp = GameResponses.getResponse('fish', effRarity, taggedName, amount, bon);
    if (resp.emptyPaws) { say(`@${user}: ${resp.line}`); return {ok:true}; }
    say(`@${user}: ${resp.line}`);

    broadcast({ type:'game', command:'fish', user, userId, balance:newBal, reward:amount, drops,
      favPup, pupName, rarity:effRarity, isSub,
      pcImageURL:    usePC ? pc?.favPupImageURL : null,
      pcDisplayName: usePC ? (favName ? `${favName} (${rarLabel})` : taggedName) : taggedName,
      pcSkyConfig:   usePC ? pc?.favPupSkyConfig : null,
      pcSparkle:     usePC ? pc?.favPupSparkle   : null,
      pupId:         sprite.name });

    // ── NFT catch mechanic — 20% chance to reel in another user's fav pup ────
    // Fisher gets 100 Choctobits; the NFT owner gets nftLevel Choctobits.
    if (!isLurkTick && Math.random() < 0.20) {
      try {
        const PupXP   = require('../economy/pupXP');
        // Build pool of active + lurking users who have a fav pup set (not the fisher)
        const lurkers = Lurk ? Lurk.getLurkers().map(l => l.userId) : [];
        const candidates = lurkers.filter(uid => uid !== userId);
        const allCached = candidates.filter(uid => PupCore.getCachedState(uid)?.favPupMint);
        if (allCached.length > 0) {
          const ownerId  = allCached[Math.floor(Math.random() * allCached.length)];
          const ownerState = PupCore.getCachedState(ownerId);
          const catchMint  = ownerState?.favPupMint;
          if (catchMint) {
            const nameRow  = db.prepare('SELECT game_name FROM mint_names WHERE mint=?').get(catchMint);
            const nftStats = PupXP.getStats(db, catchMint);
            const catchName = nameRow?.game_name || ownerState?.favPupName || 'a Choctonaut';
            const ownerPayout = Math.max(1, nftStats?.level || 1);
            const CATCH_BONUS = 100;
            Balance.add(userId,  CATCH_BONUS,  user);      // fisher reward
            Balance.add(ownerId, ownerPayout, ownerId);    // nft owner reward
            say(`🎣 @${user} reeled in @${ownerId}'s ${catchName}! `
              + `@${user} +${CATCH_BONUS}🍫 · @${ownerId} +${ownerPayout}🍫 (NFT Lvl ${nftStats?.level || 1})`);
          }
        }
      } catch {}
    }

    return {ok:true};
  },
};
