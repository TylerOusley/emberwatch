# Emberwatch crate and Hundredth Watch helmet proposal

Design draft for Tyler's review. **None of this document's crates, armor statistics, starting kits, new milestones or helmet are implemented in Build 11.** The approved Build 11 changes concern gate/well artwork and physical noticeboard access only.

## Requested prices, milestones and accepted duplicate-credit rule

Crates would be purchased in the menu using either the player's personal bank savings or shared crate credits. Wallet funds, village treasury funds and restricted loan credit would not be charged. A crate costs the listed amount once, with no separate key purchase. Each purchase uses one currency; mixed bank-gold/credit payments are outside the initial proposal.

| Crate | Requested bank price | Proposed credit price | Earned at survived-night milestones | Bank-funded duplicate refund at these prices | Earned or credit-funded duplicate rebate |
| --- | ---: | ---: | --- | ---: | ---: |
| Basic | 1,000 gold | 100 credits | 10, 20, 30 | 700 gold | 70 credits |
| Rare | 10,000 gold | 1,000 credits | 40, 50, 60 | 7,000 gold | 700 credits |
| Epic | 50,000 gold | 5,000 credits | 70, 80, 90 | 35,000 gold | 3,500 credits |
| Legendary | 100,000 gold | 10,000 credits | 100, 110, 120, and every ten afterward | 70,000 gold | 7,000 credits |

Each opening awards one item. A duplicate means that exact item is already permanently unlocked on the account, even if it is unequipped or the character lost its physical copy. The original unlock remains and the duplicate automatically converts to the displayed refund or rebate. A new unlock receives the item without a duplicate rebate. Bank prices are the requested starting values; credit prices and the corresponding rebate amounts above are proposed values for review and playtesting.

**Accepted direction:** duplicates from crates that were not purchased with bank gold award one shared, permanent account balance of crate credits. Players can use that balance on any crate tier or save it for a more expensive tier. Credits are not separate balances for Basic, Rare, Epic or Legendary crates.

The funding source determines the return:

- **Bank-funded crate:** a duplicate returns 70% of the actual bank-gold purchase price to the personal bank. If discounted prices are introduced later, the refund must use the amount actually paid, not an undiscounted catalog price.
- **Earned milestone crate:** a duplicate awards 70% of that tier's credit price as crate credits, using the proposed values above. It creates no bank gold.
- **Credit-funded crate:** a duplicate returns 70% of the credits spent as crate credits. It never converts those credits into bank gold, regardless of how the original item was unlocked.

Examples using the proposed prices:

- A duplicate earned Legendary crate gives **7,000 shared credits**. That buys seven Rare crates, one Epic crate with 2,000 credits left, or seventy Basic crates. The player can instead save it and collect 3,000 more credits for a Legendary crate.
- A duplicate earned Basic crate gives **70 credits**. The player can save another 30 for a Basic crate or continue saving toward any higher tier.
- A Rare crate purchased for 1,000 credits that yields a duplicate returns 700 credits. The opening therefore consumes 300 credits overall; repeated duplicates cannot grow the balance.

Credits remain account-bound between villages. They cannot be withdrawn, sold, traded, transferred to another player, donated to the treasury, or used to repay loans. They purchase crates only. A credit-funded crate remains credit-funded permanently; reopening its result must never treat it as a gold purchase.

### Economy and repeat-claim safeguards

This accepted rule prevents free or credit-funded Legendary duplicates from becoming recurring 70,000-gold deposits. Shared credits still let players exchange a high-tier duplicate for several lower-tier openings, which is intended collection progress. With a four-item pool, completed tiers will generate duplicates frequently, so the opening screen must clearly display the pool, ownership and applicable return.

Persist each crate's owner, tier, original funding source, actual price paid, unique grant/purchase identifier and final result. Deducting the price, recording the result, unlocking an item and issuing any duplicate return must commit together. Refund currency follows that stored funding source, not a client field or the source of an earlier copy of the item. Do not add a general credit-to-gold exchange or allow rewards from credit purchases to be sold for bank gold through another menu.

Milestone grants need their own permanent unique claims. The lifetime-versus-single-village milestone choice below remains unresolved; whichever is selected, reconnecting, repeated dawn handling, loading an older village snapshot or retrying an opening must not grant that same earned crate again. The helmet and starting-kit rules elsewhere in this draft remain proposals, not approved runtime changes.

## Suggested first item pool

These are proposed starting values. Each tier has four distinct items with a transparent 25% chance per item for this small initial pool. Higher tiers would contain their own listed items rather than rolling low-tier filler. Add more items before launch if four outcomes feel repetitive; publish any changed probabilities.

| Crate | Item | Slot | Proposed effect |
| --- | --- | --- | --- |
| Basic | Padded cap | Head | 2% less incoming enemy damage. |
| Basic | Stout leather boots | Feet | 1% less incoming enemy damage. |
| Basic | Forager's pouch | Utility | +15 carrying capacity, added to the normal role/backpack capacity. |
| Basic | Hearth ration kit | Starting kit | Begin a new run with two bread items. |
| Rare | Iron coif | Head | 4% less incoming enemy damage. |
| Rare | Riveted vest | Body | 6% less incoming enemy damage. |
| Rare | Miner's buckle | Utility | Newly acquired gathering tools have 10% more maximum durability. No faster swings or additional resources. |
| Rare | Tradesman's kit | Starting kit | Begin with one chosen wooden axe, pickaxe or scythe, plus two bread items. |
| Epic | Tempered cuirass | Body | 9% less incoming enemy damage. |
| Epic | Runed helm | Head | 6% less incoming enemy damage. |
| Epic | Deep-delver's belt | Utility | +40 carrying capacity. |
| Epic | Prospector's kit | Starting kit | Begin with one chosen stone axe, pickaxe or scythe, plus two hearty meals. |
| Legendary | Runeforged cuirass | Body | 12% less incoming enemy damage. |
| Legendary | Dawnsteel helm | Head | 8% less incoming enemy damage. |
| Legendary | Guardian's boots | Feet | 5% less incoming enemy damage. |
| Legendary | Master expedition kit | Starting kit | Begin with one chosen iron axe, pickaxe or scythe, plus two feasts. |

One head, body, feet, utility and starting-kit slot keeps choices readable. Equipment would visibly attach to the dwarf. Gear damage reduction would add across equipped armor, capped at 25%, and apply once to enemy damage remaining after the existing shield absorbs its normal amount. It would affect enemy attacks against the player only. It would not protect buildings, troops, horses or every member of the village.

Starting kits deliberately grant a small initial supply. Tool swing speed and wood/stone/iron yields remain 1/2/3 as requested earlier, and upgraded replacement tools still come from stocked player shops. Kit equipment has ordinary durability; no infinite weapons, wheat or ammunition.

## Hundredth Watch reward

Suggested name: **Sunforged Viking Helm**. Award it directly at the 100-night milestone, alongside the legendary crate. It should be an earned trophy rather than a random crate drop.

Appearance: a polished gold helmet with a fitted curved bowl, engraved bands, a nose guard, bright reflected highlights and restrained moving sparkles. Keep it readable and attractive in the game's daylight and torchlight; include a reduced-effects option for sparkles.

Suggested ability: 6% damage reduction in the head slot, plus **Last Stand**. Once per night, a nonlethal enemy hit that brings health below 25% of maximum grants a 20-point temporary ward for ten seconds. The ward absorbs later enemy damage; it does not reverse the triggering hit or revive a downed player. It cannot stack with itself, refresh through equipment changes, or reset on reconnect. The helmet trades some ordinary protection compared with the legendary Dawnsteel helm for this emergency benefit.

## Progression, equipment and death

The current honors system counts personal credited nights across villages. A credit requires being online and alive for at least half of the night's actual length, including an early-cleared night. A village merely reaching a day number does not automatically credit every resident.

Recommended baseline for review: use that same personal total for the crate schedule and the 100-night helmet. Milestones pay once per account, so starting a new village or reconnecting cannot repeat them. If the intended achievement is surviving night 100 in a single village, use a separate run milestone instead and make the interface say so clearly. This distinction needs Tyler's choice before implementation. Do not invent retroactive credit for nights that the server never recorded.

Permanent account unlocks survive a fallen village. Before joining a new run, select a loadout; the chosen physical equipment and kit contents are granted once for that account/run. Buying or opening a crate during a run unlocks a future choice, without immediately spawning another set of supplies.

Recommended death rule: being healed or revived preserves equipped gear, while choosing the morning respawn loses the current run's granted gear and supplies along with ordinary inventory. The permanent unlocks remain for the next new run. Reconnecting, switching roles, redeploying a loadout or pressing respawn must not grant replacements or refill durability. Starter grants should be bound to their owner and unavailable for sale, donation or storage transfer, preventing an unlimited shop stock source through repeated new runs. Spending durability or using food is allowed normally.

This preserves the existing reason to rescue a fallen dwarf and leaves the normal shop economy useful. Whether permanent armor should instead remain equipped after a manual respawn is a separate balance choice for review.

## Opening presentation

Use a horizontal reel of item cards moving beneath a fixed central pointer. A short anticipation, quick spin and gradual slowdown lasting roughly four seconds leads to the final item, followed by its full model, effect and unlock/duplicate result. Offer Skip and reduced motion; both reveal the same already-selected outcome.

The server should select and save the result once before the animation begins. Reopening the menu, losing connection, double-clicking or skipping must show that same result rather than roll again. Show the item pool, odds, selected payment currency, price and source-appropriate duplicate return before buying. Purchase/opening/award/refund should be one persistent transaction. Decorative passing cards must not imply odds or a special near-miss chance that does not exist.

## Decisions to settle before implementation

1. Personal lifetime survived nights, or reaching these numbered nights within one village?
2. Approve or adjust the proposed credit prices: 100 / 1,000 / 5,000 / 10,000. Shared credits from earned and credit-funded duplicates are already the accepted direction.
3. Approve or change the proposed equipment slots, 25% armor cap, item pool and death behavior.
4. Keep the helmet's Last Stand ability, choose another function, or make it visual only.
