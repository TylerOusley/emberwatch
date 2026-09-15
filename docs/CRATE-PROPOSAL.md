# Emberwatch crate and Hundredth Watch helmet proposal

Design record and remaining proposals for Tyler's review. **Crate opening, credits, equipment bonuses, starting-kit grants, new crate milestones and the Hundredth Watch helmet reward mechanics are not implemented.** Tyler authorized preparing the item artwork, which is available in the [art collection and fitting gallery](CRATE-ART.md). Gameplay still awaits the remaining design decisions and an explicit implementation instruction.

## Accepted prices, original item pool and duplicate-credit rule

Crates would be purchased in the menu using either the player's personal bank savings or shared crate credits. Wallet funds, village treasury funds and restricted loan credit would not be charged. A crate costs the listed amount once, with no separate key purchase. Each purchase uses one currency; mixed bank-gold/credit payments are outside the initial proposal.

| Crate | Bank price | Accepted credit price | Crate milestone schedule; basis unresolved | Bank-funded duplicate refund at these prices | Earned or credit-funded duplicate rebate |
| --- | ---: | ---: | --- | ---: | ---: |
| Basic | 1,000 gold | 100 credits | 10, 20, 30 | 700 gold | 70 credits |
| Rare | 10,000 gold | 1,000 credits | 40, 50, 60 | 7,000 gold | 700 credits |
| Epic | 50,000 gold | 5,000 credits | 70, 80, 90 | 35,000 gold | 3,500 credits |
| Legendary | 100,000 gold | 10,000 credits | 100, 110, 120, and every ten afterward | 70,000 gold | 7,000 credits |

Each opening awards one item. A duplicate means that exact item is already permanently unlocked on the account, even if it is unequipped or the character lost its physical copy. The original unlock remains and the duplicate automatically converts to the displayed refund or rebate. A new unlock receives the item without a duplicate rebate. Bank prices remain the requested starting values. Tyler approved credit prices of **100 / 1,000 / 5,000 / 10,000** and the **70% credit return** for earned or credit-funded duplicates. The original four-item pool in each tier is also accepted as the starting design. The proposed Phoenix Ember consumable below needs its own duplicate-handling exception; it is not silently included in that approval.

**Accepted direction:** duplicates from crates that were not purchased with bank gold award one shared, permanent account balance of crate credits. Players can use that balance on any crate tier or save it for a more expensive tier. Credits are not separate balances for Basic, Rare, Epic or Legendary crates.

The funding source determines the return:

- **Bank-funded crate:** a duplicate returns 70% of the actual bank-gold purchase price to the personal bank. If discounted prices are introduced later, the refund must use the amount actually paid, not an undiscounted catalog price.
- **Earned milestone crate:** a duplicate awards 70% of that tier's credit price as crate credits, using the accepted values above. It creates no bank gold.
- **Credit-funded crate:** a duplicate returns 70% of the credits spent as crate credits. It never converts those credits into bank gold, regardless of how the original item was unlocked.

Examples using the accepted prices:

- A duplicate earned Legendary crate gives **7,000 shared credits**. That buys seven Rare crates, one Epic crate with 2,000 credits left, or seventy Basic crates. The player can instead save it and collect 3,000 more credits for a Legendary crate.
- A duplicate earned Basic crate gives **70 credits**. The player can save another 30 for a Basic crate or continue saving toward any higher tier.
- A Rare crate purchased for 1,000 credits that yields a duplicate returns 700 credits. The opening therefore consumes 300 credits overall; repeated duplicates cannot grow the balance.

Credits remain account-bound between villages. They cannot be withdrawn, sold, traded, transferred to another player, donated to the treasury, or used to repay loans. They purchase crates only. A credit-funded crate remains credit-funded permanently; reopening its result must never treat it as a gold purchase.

### Economy and repeat-claim safeguards

This accepted rule prevents free or credit-funded Legendary duplicates from becoming recurring 70,000-gold deposits. Shared credits still let players exchange a high-tier duplicate for several lower-tier openings, which is intended collection progress. With a four-item pool, completed tiers will generate duplicates frequently, so the opening screen must clearly display the pool, ownership and applicable return.

Persist each crate's owner, tier, original funding source, actual price paid, unique grant/purchase identifier and final result. Deducting the price, recording the result, unlocking an item and issuing any duplicate return must commit together. Refund currency follows that stored funding source, not a client field or the source of an earlier copy of the item. Do not add a general credit-to-gold exchange or allow rewards from credit purchases to be sold for bank gold through another menu.

Milestone grants need their own permanent unique claims. The lifetime-versus-single-village milestone choice below remains unresolved; whichever is selected, reconnecting, repeated dawn handling, loading an older village snapshot or retrying an opening must not grant that same earned crate again. The helmet and starting-kit rules elsewhere in this draft remain proposals, not approved runtime changes.

## Accepted original item pool

The following sixteen items form the accepted starting pool: four distinct items per tier, with a transparent **25% chance per item**. Higher tiers contain their own listed items rather than rolling low-tier filler. Effects below are initial, tunable balance settings. The three additional item designs below would change the Rare and Legendary pools and require an explicit odds update.

| Crate | Item | Slot | Initial effect |
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

## Additional item designs — not implemented

### Legendary: Phoenix Ember

**Recommended ownership: a true one-use, account-bound consumable.** One Phoenix Ember grants one successful self-revival. It is not a permanent unlock that generates a fresh charge on every death, reconnect or new village. The alternative of a permanently unlocked revival starting kit would create a new charge every run; that is a different, broader benefit and is not the recommendation here.

Recommended activation and balance:

- The player deliberately activates the item while downed and while the keep and run are still alive. It works without a priest. Dawn continues to enable the separate manual respawn button; the Ember never forces an automatic respawn.
- Revive at the existing downed position with **40% of current maximum health**, rounded up. Keep the player's current inventory, equipment, durability and wallet intact. Do not restore already lost gear, refill hunger or shields, award priest performance pay, or grant new starting supplies.
- Consume exactly one charge **only when the authoritative server successfully commits the revival**. If a priest or church revives the player first, the request is stale and costs no charge. Repeated clicks, a reconnect during activation, failed saving, or replayed requests cannot consume twice or produce a second revival.
- Proposed protection: **three seconds of protection from enemy damage**, ending early if the player attacks. This would prevent immediate downing inside an ongoing attack. Both the 40% health value and this protection window remain balance choices for review; zero protection is the simpler alternative. Protection would cover only the revived player, not nearby dwarfs or structures.
- Recommend **one equipped Ember charge per account per village run**. Additional owned charges stay in the account reserve for later runs. Successfully using one, choosing manual respawn, changing jobs or reconnecting cannot equip another charge in that same run. This prevents a stockpile from becoming repeated revivals during one defense.

A charge stays in the account reserve until successfully consumed, with its equipped reservation recorded against that specific village. An unused charge is released for a later run when its current village ends; simply leaving and rejoining an active village does not refresh eligibility. Manual respawn can forfeit this run's equipped use without spending the unused account charge. This ownership rule is a proposed exception to ordinary disposable starting-kit contents and must be explicit in the interface.

**Duplicate handling needs a new decision.** Recommend that every Phoenix Ember result grants one consumable charge, including a repeat result; spare charges may accumulate in the account reserve. Because a charge is consumable rather than a permanent unlock, a repeat Ember would **not** receive the 70% duplicate return. That exception is proposed, not part of the approved refund rule for permanent equipment. An alternative is making it a permanent starting-kit unlock with ordinary duplicate refunds, but that changes the benefit to one free charge every new run.

Implementation must persist the charge grant, ownership, run reservation, successful-use record and resulting player state together. The same charge must never be both refunded and granted, or be usable by a second player or run. It cannot be sold, traded, deposited into village stock, or converted into bank gold.

### Rare: Mining Pack

**Recommended tier: Rare; utility slot.** Reduce the carried weight of **stone, iron and coal only by 20%** while equipped. This provides a focused mining benefit while broader capacity equipment remains useful for timber, food and mixed loads.

| Carried item | Normal weight | Proposed weight with Mining Pack |
| --- | ---: | ---: |
| Stone | 3 | 2.4 |
| Iron | 3 | 2.4 |
| Coal | 2 | 1.6 |
| Timber, wheat, food, tools and other items | Existing weight | Unchanged |

The Mining Pack occupies the same single utility slot as the Lumber Pack, Forager's pouch, Miner's buckle and Deep-delver's belt. Those utility benefits cannot stack. Normal purchased backpack upgrades and role capacity remain compatible and keep their existing capacity values; the Mining Pack adds no separate capacity bonus or second backpack tier. A visible mining attachment could distinguish it on the worn backpack instead of placing two full backpacks on the character.

The reduction applies only to minerals actually carried by that player. Village stock, shop/plot storage, worker cargo and carts retain normal weights and capacities. Transferring an item must recalculate weight for its destination. Sum the fractional weights before checking capacity rather than rounding each item down. Unequipping the utility must preserve cargo and apply the existing overweight behavior until space is freed; it cannot delete or duplicate resources. Mining yield, durability, node type, gathering speed, resource prices and gold are unchanged.

This would be a permanent utility unlock, so its repeats would use the already accepted funding-source-specific 70% duplicate rule.

### Rare: Lumber Pack

**Requested addition:** Tyler wants a matching pack that reduces wood weight. **Recommended balance: Rare; utility slot; 20% less carried timber weight.** Timber is the game's wood resource, so one timber would weigh **1.6 instead of 2** while this pack is equipped. Stone, iron, coal, wheat, tools, food and other items keep their normal weight.

The Lumber Pack shares the single utility slot with the Mining Pack and other utility equipment. Players choose a mining or lumber gathering bonus; they cannot equip both packs at once. Purchased backpack capacity upgrades and the villager carrying bonus still apply normally. A leather log sling and small timber bundle could visually distinguish the Lumber Pack attachment.

Only timber carried by the equipped player receives the reduction. Plot storage, village stock, worker cargo and carts retain normal weight rules. Sum fractional weights before checking capacity, recalculate at the destination when transferring items, and preserve cargo with the existing overweight behavior if the pack is unequipped. The pack does not increase chopping yield, speed or tool durability.

Like the Mining Pack, this would be a permanent utility unlock with the accepted funding-source-specific 70% duplicate return. Its Rare placement, 20% value and appearance are proposed balance/art details; the requested wood-weight item remains design-only until crate implementation begins.

### Proposed odds if these additions are accepted

| Tier | Accepted pool today | Proposed expanded pool | Proposed chance per item |
| --- | --- | --- | ---: |
| Basic | Four listed items | Unchanged | 25% |
| Rare | Four listed items | Add Mining Pack and Lumber Pack; six total | 1/6 (approximately 16.67%) |
| Epic | Four listed items | Unchanged | 25% |
| Legendary | Four listed items | Add Phoenix Ember; five total | 20% |

The expanded pools and their odds remain proposals: **six equally likely Rare items at 1/6 each**, and **five equally likely Legendary items at 20% each**. The accepted original four-item pools remain at 25% each until the expanded odds are finalized. If the consumable exception is chosen, show each Legendary outcome's ownership and refund behavior separately before purchase.

## Hundredth Watch reward

Suggested name: **Sunforged Viking Helm**. Award it directly at the 100-night milestone, alongside the legendary crate. It should be an earned trophy rather than a random crate drop.

Appearance: a polished gold helmet with a fitted curved bowl, engraved bands, a nose guard, bright reflected highlights and restrained moving sparkles. Keep it readable and attractive in the game's daylight and torchlight; include a reduced-effects option for sparkles.

Suggested ability: 6% damage reduction in the head slot, plus **Last Stand**. Once per night, a nonlethal enemy hit that brings health below 25% of maximum grants a 20-point temporary ward for ten seconds. The ward absorbs later enemy damage; it does not reverse the triggering hit or revive a downed player. It cannot stack with itself, refresh through equipment changes, or reset on reconnect. The helmet trades some ordinary protection compared with the legendary Dawnsteel helm for this emergency benefit.

## Progression, equipment and death

The current honors system counts personal credited nights across villages. A credit requires being online and alive for at least half of the night's actual length, including an early-cleared night. A village merely reaching a day number does not automatically credit every resident.

Recommended baseline for review: use that same personal total for the crate schedule and the 100-night helmet. Milestones pay once per account, so starting a new village or reconnecting cannot repeat them. If the intended achievement is surviving night 100 in a single village, use a separate run milestone instead and make the interface say so clearly. This distinction needs Tyler's choice before implementation. Do not invent retroactive credit for nights that the server never recorded.

Permanent account equipment unlocks survive a fallen village. Before joining a new run, select a loadout; the chosen physical equipment and kit contents are granted once for that account/run. The proposed Phoenix Ember would instead use an existing account consumable charge, with no new-run replenishment. Permanent gear won during a run unlocks a future loadout choice; an Ember result adds a reserve charge for a later run. Neither immediately spawns another set of supplies.

Recommended death rule: being healed or revived preserves equipped gear, while choosing the morning respawn loses the current run's granted gear and supplies along with ordinary inventory. The permanent unlocks remain for the next new run. Reconnecting, switching roles, redeploying a loadout or pressing respawn must not grant replacements or refill durability. Starter grants should be bound to their owner and unavailable for sale, donation or storage transfer, preventing an unlimited shop stock source through repeated new runs. Spending durability or using food is allowed normally.

This preserves the existing reason to rescue a fallen dwarf and leaves the normal shop economy useful. Whether permanent armor should instead remain equipped after a manual respawn is a separate balance choice for review. The proposed Ember reservation and unused-charge handling are described separately above; they must not be inferred from the permanent-unlock rules.

## Opening presentation

Use a horizontal reel of item cards moving beneath a fixed central pointer. A short anticipation, quick spin and gradual slowdown lasting roughly four seconds leads to the final item, followed by its full model, effect and unlock/duplicate result. Offer Skip and reduced motion; both reveal the same already-selected outcome.

The server should select and save the result once before the animation begins. Reopening the menu, losing connection, double-clicking or skipping must show that same result rather than roll again. Show the item pool, odds, selected payment currency, price and source-appropriate duplicate return before buying. Purchase/opening/award/refund should be one persistent transaction. Decorative passing cards must not imply odds or a special near-miss chance that does not exist.

## Accepted and outstanding decisions

Already accepted: credit prices **100 / 1,000 / 5,000 / 10,000**, one shared permanent credit balance, **70% source-appropriate duplicate returns**, and the original four-item pool in each tier at 25% per item. Tyler also requested a Lumber Pack that reduces wood weight, alongside the Mining Pack. Crate systems remain unimplemented.

Still to settle:

1. Use personal lifetime credited nights, or the numbered nights within one village, for the crate schedule and Hundredth Watch helmet? Existing honors use personal lifetime credited nights, but that does not automatically decide the crate rule.
2. Add Phoenix Ember as the recommended true consumable, or as a permanent starting-kit unlock? For the consumable, approve its repeat-drop exception, one equipped use per run, unused-charge reservation rule, 40% revival health and optional three-second protection.
3. Finalize the Mining Pack and requested Lumber Pack as Rare utilities, each with a 20% reduction for its specified carried resources and only one utility equipped at a time?
4. With all three additions, use six equally likely Rare items at 1/6 each and five equally likely Legendary items at 20% each; Basic and Epic remain four items at 25% each.
5. Confirm equipment-slot, 25% armor-cap, loadout and manual-respawn behavior before implementing stat-bearing rewards.
6. Keep the helmet's Last Stand ability, choose another function, or make it visual only.

Do not build or deploy these crate systems until the remaining decisions and an explicit implementation instruction are supplied.
