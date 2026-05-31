# ChoctoTV — Chat Commands Reference

## Viewer Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `!toss` | — | Throw a stick — pup fetches it. 60s cooldown |
| `!throw` | — | Same as toss, different animation |
| `!dig` | — | Pup digs for buried treasure |
| `!fish` | `!cast` | Fish in the pond. 20% chance to reel in a lurker's NFT pup |
| `!walk` | — | Walk your pup around the yard. 3 min cooldown. NFT scales 130px→400px by level |
| `!lick` | — | Lick the peanut butter jar (+1% food bowl) |
| `!lurk` | — | Enter lurk mode — earn passive rewards + XP while away |
| `!balance` | `!bal` | Check your Choctobit balance |
| `!inv` | — | View your item inventory |
| `!cashout` | — | Convert Choctobits → Choctopus via tipbot |
| `!cashout test` | — | Dry run — shows what would happen, no real payout |
| `!vend` | — | Spend items at the vending machine |
| `!setwallet <addr>` | — | Link your Solana wallet |
| `!setfav <mint>` | — | Set your fav NFT pup (requires !setwallet first) |
| `!checkfav [@user]` | — | Show fav pup card popup on overlay |
| `!namepup <name>` | — | Name your set NFT |
| `!pupstats` | `!level`, `!puplevel` | Show NFT level + player level + hourly passive |
| `!setfavgame <game>` | — | Set your fav game (toss/throw/dig/fish/walk) |
| `!setfavweather <w>` | — | Set your fav weather |
| `!top` | — | Leaderboard top 10 |
| `!lore` | — | Random Choctonaut lore |
| `!tradition` | — | Show a random ChoctoTV tradition |
| `!time` | — | Current stream time |
| `!help` | — | Command list (viewer-friendly) |

## Rarity Appearance Chances (Non-Walk Games)

Rarity is based on how many other NFTs share the same level (dynamic):

| Rarity | Count at level | Reward mult | Appearance % |
|--------|---------------|-------------|--------------|
| Legendary | 1–2 | 5× | 2% |
| Epic | 3–5 | 3× | 5% |
| Rare | 6–15 | 2× | 12% |
| Common | 16+ | 1× | 25% |

When the NFT appears: reward mult + 25% favpup bonus applies.
When it doesn't appear: base sprite reward (1×).

## Mod Commands

| Command | Description |
|---------|-------------|
| `!mod <user>` | Grant mod role |
| `!roles` | List current roles |
| `!onduty` | Toggle on-duty status (enables morale bonuses) |
| `!quality` | Set stream quality tag |
| `!classifieds` | Manage classified ads |
| `!announcements` | Post/clear announcements |
| `!song` | Control music |
| `!wanted` | Post wanted poster |
| `!feed` | Fill the food bowl |
| `!water` | Fill the water bowl |

## Streamer / Dev Commands

| Command | Description |
|---------|-------------|
| `!airdrop <amount>` | Airdrop Choctobits to all active viewers |
| `!inject <user> <amount>` | Give specific user Choctobits |
| `!purge <user>` | Reset user balance |
| `!addcoin <sym> <id> <color>` | Add coin to price ticker |
| `!addcollection <addr>` | Add NFT collection |
| `!import` | Import data |
| `!set !<cmd> <cooldown>` | Override command cooldown at runtime |
| `!reload` | Hot-reload all game commands without restart |
