'use strict';
const CM = require('../core/ClassifiedsManager');
module.exports = {
  name:'read',
  requirePrefix: true, permissions:'mod', cooldown:false,
  execute(ctx) {
    const { args, say, broadcast } = ctx;
    const nfts = CM.getCachedNFTs();

    if (!nfts.length) {
      say('📰 No classifieds loaded yet — try again in a moment');
      return { ok:false };
    }
    if (!args[0]) {
      const nums = nfts.filter(n=>n.mintNum).map(n=>'#'+n.mintNum).join(', ');
      say(`📰 ${nfts.length} pups listed — use !read <mintNum> e.g. !read ${nfts[0]?.mintNum||'2343'} · Available: ${nums}`);
      return { ok:true };
    }

    const input = args[0].replace('#','').trim();
    // Find by mint number first, fall back to 1-based index for convenience
    let nft  = nfts.find(n => n.mintNum === input);
    let index = nft ? nfts.indexOf(nft)+1 : null;

    if (!nft) {
      // Try numeric index as fallback
      const num = parseInt(input);
      if (!isNaN(num) && num >= 1 && num <= nfts.length) {
        nft   = nfts[num-1];
        index = num;
      }
    }

    if (!nft) {
      say(`❌ No pup with mint #${input} in classifieds. Try: !read to see available mint numbers`);
      return { ok:false };
    }

    const name  = nft.name  || 'Choctonaut';
    const price = nft.price ? `${nft.price} SOL` : 'Make an offer';
    const url   = nft.url   || 'magiceden.io/marketplace/choctonaut_army';
    const num   = nft.mintNum ? `#${nft.mintNum}` : '';

    say(`📰 ${name} ${num} — Adoption fee: ${price} — ${url}`);
    broadcast({ type:'show_classified_spotlight', nft, index });
    return { ok:true };
  },
};
