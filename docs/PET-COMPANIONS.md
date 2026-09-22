# Build 32 pet companions

**Build 32 release, publication authorized September 22, 2026.** This completes the pet direction approved after the original asset shortlist.

## Eggs and permanent ownership

The traveling merchant has a 25% chance to offer one mysterious egg per visit. The egg costs 5,000 wallet gold and its stock is shared by the village. Opening menus or restarting the server does not reroll an offer. Eggs hatch after 30 real minutes, including offline time; ownership and the single equipped companion follow the player's account between villages.

The latest requested odds apply to every egg:

| Rarity | Chance |
| --- | ---: |
| Common | 38% |
| Uncommon | 30% |
| Rare | 20% |
| Epic | 10% |
| Legendary | 2% |

The server rolls rarity first, then selects uniformly among unowned species in that rarity, counting incubating eggs as already reserved. When that tier is complete, it selects a duplicate in the same tier. A duplicate hatch returns 1,000 bank gold exactly once. A full bank keeps the refund pending until it has room. Collection progress cannot increase the Legendary chance. The chosen species remains hidden until the hatch.

Purchase receipts recover interrupted requests without taking gold twice. Durable hatch receipts survive reload. Private collection/equipment endpoints only expose the signed-in account's eggs and unlocks; other villagers can see the equipped follower in the world.

## Companions

| Pet | Rarity | Equipped ability | Movement |
| --- | --- | --- |
| Rabbit | Common | +20% carrying allowance | Ground |
| Marmot | Common | +15% carrying allowance | Ground |
| Husky | Common | 8 melee damage per hit | Ground |
| Shiba | Common | 8 melee damage per hit | Ground |
| Fox | Uncommon | 12 melee damage per hit | Ground |
| Boar | Uncommon | 12 melee damage per hit | Ground |
| Undead Squirrel | Uncommon | +25% carrying allowance | Ground |
| Wolf | Rare | 20 melee damage per hit | Ground |
| Owl | Rare | 20 ranged wind damage per hit | Flying |
| Frost Bat | Epic | 32 ranged frost damage per hit | Flying |
| Griffin | Epic | 32 melee damage per hit | Flying |
| Dragon | Legendary | 50 ranged fire damage per hit | Ground |
| Vampire Bat | Legendary | 50 melee damage; heals its owner 2 HP per successful hit | Flying |

Combat pets attack at most once every two seconds. The server requires a nearby target, a living online owner, clear attack space and valid terrain. Pets acquire enemies within eight metres of their owner and remain leashed to that owner. Melee strikes have a visible windup; fire, frost and wind attacks add projectile travel. Invalidated attacks cannot damage or heal. Switching companions retains the cooldown. Damage credits the owner for the existing kill/assist reward system. Vampire healing cannot exceed maximum HP or revive a downed owner; impact, healing and bounty payment commit together.

Pets remain permanent unlocks and are not destructible combat targets. They rest while their owner is downed/offline or the village has fallen. While the owner is riding, receiving bed treatment or transporting a downed player, pets follow without attacking. Utility bonuses apply only to the equipped pet, never stack with stored companions, and do not enlarge buildings or carts. Unequipping a carry pet preserves all items and applies encumbrance if necessary.

## Art and animations

Runtime models, thumbnails and per-file provenance live under `public/assets/pets/`. Each model has named idle and walk animations; every combat pet also has an attack animation. Utility companions retain any useful creator-supplied clips. Creator rigs and texture maps are preserved, with missing motion authored and old constraints baked for browser playback. Model transforms use +Y up and +Z forward, with consistent ground contact; each species has its own companion scale.

The renderer lazily caches each species, clones skeletons for independent animation, blends movement/attack clips and caps visible companions at the village's eight-player limit. Projectile effects are pooled and add no point lights. Missing downloads retry without replacing the selected species with a generic mesh.

Free sources include CDmir/TinyWorlds, Teh_Bucket, rubberduck, Cethiel/Drummyfish, Quaternius and Gobkit. Their styles intentionally vary: the rabbit/bats/dragon use mapped surfaces, while Quaternius animals use angular colored materials. See [runtime credits](../public/assets/pets/CREDITS.html) and each species' `provenance.json` for the actual imported source, license, changes, hashes and clip provenance. The earlier shortlisted VitSh griffin required a signed-in download and was not acquired; the local griffin combines a Quaternius quadruped (CC0) with Panther-One’s textured Bird–Animated mesh and wing rig (CC BY 3.0), with a modified beak, crest and lion-colored body. Its component attribution and changes are included in the credits.

The source shortlist remains available as historical research in [PET-ASSET-SHORTLIST.md](PET-ASSET-SHORTLIST.md). Current implementation and actual model files take precedence over its earlier proposals. Verification and remaining playtest limitations are recorded in [VALIDATION.md](VALIDATION.md).
