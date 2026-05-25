/**
 * ClassifiedsManager — Magic Eden hourly scrape.
 * Caches Choctonaut Army listings in memory.
 * Broadcasts { type:'classifieds_update', nfts } after each refresh.
 */
'use strict';
const https = require('https');

const ME_COLLECTION = 'choctonaut_army';
const ME_API        = `https://api-mainnet.magiceden.dev/v2/collections/${ME_COLLECTION}/listings`;
const FETCH_MS      = 60 * 60 * 1000;   // 1 hour

const GAMES    = ['walk','toss','throw','dig','fish'];
const WEATHERS = ['sunny','cloudy','rainy','stormy','snowy','windy'];
const DESCS    = [
  'Loyal companion. Well-trained. Excellent yard skills.',
  'Energetic spirit, loves walks and adventures.',
  'Friendly disposition. Gets along with all pups.',
  'Rare find. Spirited adventurer. Blockchain certified.',
  'Distinguished pup seeks a discerning home.',
  'Enthusiastic fetcher with a nose for treasure.',
  'Calm and collected. Expert digger.',
  'Social pup. Thrives in active yards.',
  'Independent thinker with championship instincts.',
  'Legendary lineage. Natural-born yard champion.',
];

let _nfts      = [];
let _broadcast = null;
let _lastHash  = '';  // hash of last broadcast — skip if unchanged

function _hashNFTs(nfts) {
  // Fast fingerprint: concat mintNum+price+name — detects any listing change
  return nfts.map(n => `${n.mintNum}|${n.name}|${n.price||''}`).join(',');
}

function setEventBroadcast(fn) { _broadcast = fn; }
function getCachedNFTs()       { return _nfts; }

function get(url, ms = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'ChoctoTV/3.0' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(ms, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function scrapeListings(limit = 15) {
  try {
    const { status, body } = await get(`${ME_API}?offset=0&limit=${limit}`);
    if (status !== 200) return [];
    const raw = JSON.parse(body);
    const data = Array.isArray(raw) ? raw : (raw.results || []);
    return data.map((l, i) => {
      const name    = l.token?.name || l.tokenMint?.slice(0, 8) || 'Choctonaut';
      const mintNum = name.match(/#(\d+)/)?.[1] || null;
      return {
        name, mintNum,
        image:      l.token?.image || null,
        price:      l.price        ? parseFloat(l.price).toFixed(2) : null,
        url:        l.tokenMint    ? `https://magiceden.io/item-details/${l.tokenMint}` : null,
        favGame:    GAMES[i % GAMES.length],
        favWeather: WEATHERS[(i + 3) % WEATHERS.length],
        desc:       DESCS[i % DESCS.length],
      };
    });
  } catch (e) {
    console.warn('[Classifieds] Scrape failed:', e.message);
    return [];
  }
}

async function refresh() {
  console.log('[Classifieds] Refreshing Magic Eden listings...');
  const nfts = await scrapeListings(15);
  if (nfts.length) {
    _nfts = nfts;
    console.log(`[Classifieds] ${nfts.length} listings cached`);
    const hash = _hashNFTs(_nfts);
    if (hash !== _lastHash) {
      _lastHash = hash;
      if (_broadcast) _broadcast({ type: 'classifieds_update', nfts: _nfts });
      console.log('[Classifieds] Data changed — broadcasting update');
    } else {
      console.log('[Classifieds] No change in listings — skipping broadcast');
    }
  }
  setTimeout(refresh, FETCH_MS);
}

function init() {
  refresh();
}

module.exports = { init, setEventBroadcast, getCachedNFTs };
