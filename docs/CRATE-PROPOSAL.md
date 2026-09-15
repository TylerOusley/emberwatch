# Emberwatch crates and the Hundredth Watch

Build 15 implements the previously prepared crate collection after Tyler’s instruction to add it to the game. The previously unresolved balance choices use the recommended defaults below: lifetime credited nights, expanded equal pools, consumable Phoenix Ember, one loadout per run, and the Sunforged helm’s Last Stand. These are initial playtest settings.

## Opening crates

Open **Crates & equipment** from the signed-in lobby or village menu. Spend personal bank savings or account crate credits; wallet gold, village treasury and restricted loan credit are never charged. There is no separate key and no mixed-currency payment. Each opening gives one outcome from its tier’s displayed pool.

| Tier | Bank gold | Crate credits | Earned at lifetime credited nights | Pool and odds |
| --- | ---: | ---: | --- | --- |
| Basic | 1,000 | 100 | 10, 20, 30 | Four items, 25% each |
| Rare | 10,000 | 1,000 | 40, 50, 60 | Six items, 1/6 each (about 16.67%) |
| Epic | 50,000 | 5,000 | 70, 80, 90 | Four items, 25% each |
| Legendary | 100,000 | 10,000 | 100 and every ten afterward | Five items, 20% each |

A credited night requires being online and alive for at least half of an actually survived night, including an early clear. Milestones pay once per account across villages. Existing recorded personal nights count; joining a village already on a high numbered day does not create credit for earlier nights. The 100-night milestone also grants the Sunforged Viking Helm directly, outside the random pool.

The server selects and saves the outcome before the roughly four-second horizontal reel begins. **Skip**, reduced motion, reopening, reconnecting and retrying the same request all show that committed outcome. The moving cards are presentation only. Recent results remain available in the collection screen.

## Duplicate returns

Permanent equipment is a duplicate when that exact item is already unlocked, including unequipped items or gear lost in a run.

| Original funding | Duplicate return |
| --- | --- |
| Personal bank | 70% of the actual bank-gold price paid, returned to that bank |
| Crate credits | 70% of the credits actually spent, returned as crate credits |
| Earned milestone | 70% of that tier’s credit price, awarded as crate credits |

At current prices, bank returns are 700 / 7,000 / 35,000 / 70,000 gold. Credit returns are 70 / 700 / 3,500 / 7,000 credits. All tiers share one permanent account credit balance. Credits cannot be sold, withdrawn, traded, donated or used to repay loans. A credit-funded or earned crate never produces a bank-gold duplicate refund.

**Phoenix Ember is a consumable exception:** every Ember outcome grants one charge, including repeats; it never also gives a duplicate return. The pool identifies this exception before purchase.

## Equipment collection

| Tier | Item | Slot | Effect |
| --- | --- | --- | --- |
| Basic | Padded cap | Head | 2% less incoming enemy damage |
| Basic | Stout leather boots | Feet | 1% less incoming enemy damage |
| Basic | Forager’s pouch | Utility | +15 carrying capacity |
| Basic | Hearth ration kit | Starting kit | Two bread items for a new run |
| Rare | Iron coif | Head | 4% less incoming enemy damage |
| Rare | Riveted vest | Body | 6% less incoming enemy damage |
| Rare | Miner’s buckle | Utility | Newly purchased gathering tools gain 10% maximum durability |
| Rare | Tradesman’s kit | Starting kit | Chosen wooden axe, pickaxe or scythe and two bread |
| Rare | Mining Pack | Utility | Carried stone, iron and coal weigh 20% less |
| Rare | Lumber Pack | Utility | Carried timber weighs 20% less |
| Epic | Tempered cuirass | Body | 9% less incoming enemy damage |
| Epic | Runed helm | Head | 6% less incoming enemy damage |
| Epic | Deep-delver’s belt | Utility | +40 carrying capacity |
| Epic | Prospector’s kit | Starting kit | Chosen stone gathering tool and two hearty meals |
| Legendary | Runeforged cuirass | Body | 12% less incoming enemy damage |
| Legendary | Dawnsteel helm | Head | 8% less incoming enemy damage |
| Legendary | Guardian’s boots | Feet | 5% less incoming enemy damage |
| Legendary | Master expedition kit | Starting kit | Chosen iron gathering tool and two feasts |
| Legendary | Phoenix Ember | Consumable reserve | One successful self-revival, at most one equipped use per run |
| Hundredth Watch | Sunforged Viking Helm | Head | 6% less enemy damage and Last Stand |

Head, body and feet reductions add, capped at 25%, and apply once to enemy damage remaining after the normal guard shield. They protect the equipped player only. Equipment is visibly attached to the moving dwarf. One utility can be equipped: capacity, weight and tool-durability bonuses do not stack with other utility items. Purchased backpack capacity and the villager role bonus still work normally.

Mining Pack weights are stone 2.4, iron 2.4 and coal 1.6; Lumber Pack timber weighs 1.6. Only that player’s carried resources receive the reduction. Carts, workers and building storage retain normal weights. Transfers recalculate destination weight and sum fractional weights before enforcing capacity. Cargo is preserved if equipment is lost, with existing overweight movement and acquisition limits. Neither pack changes yields, tool speed, resource prices or gold.

The Miner’s buckle changes newly acquired axe/pickaxe/scythe durability to 110 / 165 / 220 for wood / stone / iron. It does not refill existing tools or improve swords, bows or hammers. Starting-kit tools use ordinary 100 / 150 / 200 durability. Gathering yield remains 1 / 2 / 3.

## Loadouts and run ownership

Select the next run’s head, body, feet, utility and starting kit, choose the kit’s gathering tool, and optionally reserve an owned Ember. Selecting a loadout does not immediately grant items. When the account first joins a new village, the server records that deployment and issues its selected equipment and supplies once. New unlocks won during a run are choices for a later new run.

Existing residents migrate without a new starter grant or retroactive equipment. Rejoining an existing village, changing jobs, reconnecting and manual respawn cannot redeploy equipment or refill supplies and durability. Being healed or revived preserves current gear. Manual morning respawn forfeits the current run’s equipment and supplies under the existing inventory-loss rule; permanent unlocks remain for the next run.

Starting food is bound to its owner: it can be eaten but cannot be stored, sold, donated or traded. Mixed food stacks consume bound units first and allow only the ordinary purchased part to transfer. Kit tools use the existing nontransferable equipped-tool slots.

## Phoenix Ember

Every outcome grants one account-bound reserve charge. An existing charge may be reserved at the start of a new run; winning an Ember during a run adds to the future reserve. An active run keeps its reservation across reconnects. At most one charge can be equipped and successfully used for that account/run. Once the run ends, an unused reservation can be released for a later run.

Activate the Ember deliberately while downed, with the keep and run still alive. Successful revival consumes exactly one reserved charge and returns the player at the downed location with **40% of current maximum health, rounded up**. Inventory, equipment, durability, wallet, hunger and shield are preserved. There is no priest reward, starter refill or automatic respawn. Three seconds of enemy-damage protection ends early when the player attacks.

A stale request after a priest or church already revived the player spends nothing. Repeated clicks, replayed requests and failed saving cannot grant another revival or consume twice. Manual respawn forfeits eligibility for this run without consuming the unused reserve charge. Job changes and reconnects never equip a replacement. Charges cannot be sold, traded, deposited or converted into gold.

## Sunforged Viking Helm and Last Stand

The 100-night helmet is a permanent earned trophy with polished gold, engraved bands, a nose guard and optional glints. While equipped, its 6% armor reduction combines with **Last Stand**: once per village day/night cycle, a nonlethal enemy hit crossing from at least 25% health to below 25% grants a 20-point ward lasting ten seconds. The ward absorbs later enemy damage, after shield and armor. It does not undo the triggering hit or revive a downed player. Role changes, equipment changes, reconnects and respawn cannot reset the spent-cycle marker.

## Persistence and presentation

SQLite records account ownership, credits, unique milestone claims, purchases, original funding and actual paid price, committed results, run deployments and consumable reservation/use. Purchases, unlocks, duplicate returns and results commit together. Run grants, forfeiture and revival commit with the village snapshot. Account records take precedence over an older village snapshot for already-forfeited equipment and consumed charges.

Other players see the equipped head/body/feet/utility, not the owner’s credit balance, reserve charges, unopened crates, future loadout or result history. The art gallery remains a separate inspection surface; it does not make purchases or change loadouts. See [CRATE-ART.md](CRATE-ART.md) for the procedural assets and [VALIDATION.md](VALIDATION.md) for checks and limits.
