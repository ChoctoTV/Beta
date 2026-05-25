/**
 * !checkfav — shows the user's current fav pup as a trading card popup.
 * Card displays: NFT image, pup name, @username as owner,
 * today's randomly-assigned favGame and favWeather.
 */
'use strict';
const SpriteManager = require('../core/SpriteManager');
module.exports = {
  name: 'checkfav', permissions: 'viewer', cooldown: false,
  execute(ctx) {
    const { userId, user, args, say, broadcast, PupCore } = ctx;
    // Can check another user with !checkfav @user, or own fav pup with no arg
    const targetUser = (args[0] || '').replace('@','').toLowerCase() || userId;
    const state      = PupCore.getCachedState(targetUser);

    if (!state?.favPupImageURL) {
      say(`❌ @${user}: ${targetUser === userId ? 'You have' : targetUser + ' has'} no fav pup set — use !setwallet then !setfav`);
      return { ok: false };
    }

    // Get today's bonuses for this pup (assigned daily by SpriteManager)
    // The bonuses are tied to the sprite (PNG), not the NFT directly.
    // For display, we show the state's stored bonuses if pupcore provides them.
    const favGame    = state.favPupBonuses?.favGame    || null;
    const favWeather = state.favPupBonuses?.favWeather || null;

    const nft = {
      name:       state.favPupName    || 'Choctonaut',
      image:      state.favPupImageURL,
      mintNum:    state.favPupMint    ? state.favPupMint.slice(0,8)+'...' : null,
      owner:      targetUser,
      favGame,
      favWeather,
    };

    broadcast({ type: 'show_favpup_card', nft, requestedBy: user });
    return { ok: true };
  },
};
