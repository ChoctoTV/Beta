/**
 * !classifieds — streamer/mod verification command.
 * Shows how many NFTs are cached from Magic Eden + first few names.
 * Confirms the classifieds scroll is working with live data.
 */
'use strict';
const CM = require('../core/ClassifiedsManager');
module.exports = {
  name: 'classifieds', permissions: 'mod', cooldown: false,
  execute(ctx) {
    const { say, broadcast } = ctx;
    const nfts = CM.getCachedNFTs();
    if (!nfts.length) {
      say(`📰 Classifieds: no data yet — Magic Eden scrape pending (runs every hour)`);
      return { ok: true };
    }
    const names = nfts.slice(0, 5).map(n => n.name || '?').join(', ');
    const prices = nfts.filter(n => n.price).length;
    say(`📰 Classifieds: ${nfts.length} pups cached · ${prices} listed · First: ${names}${nfts.length > 5 ? '...' : ''}`);
    // Also trigger the overlay to show classifieds
    broadcast({ type: 'show_classifieds' });
    return { ok: true };
  },
};
