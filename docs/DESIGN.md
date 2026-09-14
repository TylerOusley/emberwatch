# Emberwatch: accepted design and prototype boundaries

This document records Tyler's game plan so later implementation does not silently change the rules. Emberwatch is a working title. Numerical prices, health values, recipes, and balance examples remain tunable unless a rule below explicitly fixes the relationship.

The new game has its own codebase and will use a separate GitHub repository and Railway service, linked from Tyler's existing website. No previous game code is part of this project.

## First playable milestone

The first milestone demonstrates a new 3D village, third-person movement, animated characters, server-controlled multiplayer, public villages, wooden resource gathering, repairs, basic priest support, bank saving, and the gate-to-keep defense loop. Two initial guards serve as a prototype defense force.

The complete design below is the target, **not a list of features already implemented**. Player plots, production buildings, crafted upgraded equipment, the complete treasury economy, voting/steward decisions, church beds/carrying, loans, merchant trade, horses/carts, and owned defenses require later milestones. Prototype building scenery is not a substitute for those systems.

## Build 03 update

Village text chat is available in a toggleable corner panel, with sent-message bubbles and typing indicators above dwarfs. It is scoped to the joined village and available while downed. The server derives the sender identity from the session, bounds message length/rate and retains a short in-memory history. Draft contents are never transmitted. Text entry suspends movement and gameplay hotkeys.

Quarry stones now have spacing from buildings and usable harvesting approaches. Matching tools prioritize nearby resources over opening a building menu. Saved resource IDs remain stable. No further building was rotated without identifying the one reported by Tyler.

## Build 02 update

The core milestone now includes a persistent hunger meter and selling wheat, timber, and stone to the treasury. Sales use whole-gold, stock-dependent unit prices, recalculate every unit in a bundle, protect a 500-gold purchasing reserve, and reject a quote if another sale reduces its payout before execution. These price bands and the reserve are provisional balance settings in `shared/market.js`; this is only the first part of the planned economy. Taxes, player shops, merchant exports and steward/voting logic remain unimplemented.

Entrance orientation, access lanes, building trim, tool-specific animations, and remote movement interpolation have been improved. They do not add building ownership or construction.

## Village survival

- Humans play dwarfs only. Zombies are controlled by the game.
- The three starting jobs are **Guard, Priest, and Villager**. All three can gather, defend, and build universal structures.
- A village holds **eight saved residents total**, counting online and offline players. An offline member retains their place and plot ownership. Solo play is valid; no minimum party size is needed.
- Public server browsing shows online players, offline residents, and occupied capacity. There are no private invitation codes in the initial plan.
- A day lasts eight minutes and a night lasts four. Difficulty increases after each five-night band, with a warning before the stronger wave.
- When a village has no online players, freeze its clock, enemies, resource consumption, wages, and rewards. Resume the same run rather than resetting its attacks.
- Dawn stops new night-wave spawns. Existing zombies remain until defeated. A living keep at dawn counts as a survived night.
- Keep destruction ends the run. A downed party does not immediately end a run while the keep still stands.

## Map and visual direction

The intended style is a cohesive low-poly fantasy world with terrain detail, lighting, shadows, readable silhouettes, and convincing animation. Third-person keyboard/mouse controls must feel smooth. The prototype's procedural meshes and movement provide a visual starting point; later art work can improve them without changing the game rules.

The village sits against mountains with its keep to the north, permanent services near the center, and **one southern gate**. The internal plan allows forty plots, with eight optional exposed plots outside. Trees grow around the village; there is no dedicated public timber section. A public quarry and an internal wheat field keep essential gathering available.

The outside landscape has additional woodland and wheat, rewarding a dangerous trip with more gathering opportunities. Higher reward comes from resource density and availability, preserving the fixed tool yields. Roads remain clear for defenders, carts, and rescues. Exterior plots flank the approach and can support defenses.

Zombies spawn at a graveyard and follow its road to the gate. Barracks troops follow their road out of the village to defensive positions. Nearby enemies interrupt marching; after a fight guards return to their positions and zombies resume their approach. Zombies can attack defending dwarfs of any job. With no nearby defender, they attack the gate; after breaching it, they can advance on the keep. Both sides need obstacle avoidance and distinct movement, attack, and hit reactions.

## Tools and resources

Core resources are wheat, timber, stone, iron, and coal. Gold ore is optional future content and is not automatically spendable currency.

| Tool | Function |
| --- | --- |
| Axe | Chop trees for timber. |
| Pickaxe | Mine stone and ore nodes. |
| Scythe | Harvest individual wheat stalks. |
| Hammer | Repair damaged gates and other repairable structures. |

| Tier | Gathered units per successful action | Starting durability target |
| --- | --- | --- |
| Wood | 1 | 100 uses |
| Stone | 2 | 150 uses |
| Iron | 3 | 200 uses |

All tiers have the same gathering speed and can harvest every resource appropriate to that tool type. Higher tiers improve yield, not mining speed or access to ore. A wheat field contains individual harvestable stalks; harvesting is not a single whole-plot collection. Air swings do not consume gathering durability. A broken tool is removed and must be replaced.

The permanent starter tool shop sells wooden tools for gold without consuming crafting materials. Ten gold per tool is the starting price target. Stone and iron tools require player-owned tool shops. On purchase, the server verifies stock and payment, consumes the recipe, pays the owner, and grants the tool together. Insufficient stock means no purchase and no charge. An example stone pickaxe recipe is ten stone and five timber; actual recipes remain a balance task.

Hammer tiers keep the same swing speed and restore progressively more structure health. Repairs consume the appropriate timber and/or stone from **shared village storage** and consume hammer durability only for a valid repair. No available materials or no damage means no paid repair. All jobs can repair.

Carry capacity will be weight based, with carts providing separate storage capacity. Exact limits and weights remain tunable. The final hotbar has eight slots for tools and consumables; items in the hotbar still count as carried inventory.

## Land, buildings, and changing jobs

Each resident may own up to **five plots combined**, inside and outside. A plot holds one building or land use. Converting a plot removes its existing structure; the player retains the plot. The initial purchase-price targets are 100, 200, 350, 550, and 800 gold for successive owned plots. Daily land tax starts at two gold per owned plot, with no tax accruing simply because a player is offline.

| Who can build | Structures |
| --- | --- |
| Every job | Tool shop, tinker shop, mine, tree farm, wheat farm, house, archer tower, cannon defense. |
| Guard only | Barracks and sword shop. |
| Priest only | Church. |

Tinkering is a universal shop, not a fourth job. Bows, arrows, and carts belong to the planned tinker-shop content.

A player changing jobs loses buildings exclusive to the previous job. Universal buildings and owned land remain. Removed barracks disband their troops. Storage and church patients must be handled before a destructive conversion, and earned wages/bonuses must not be duplicated by switching jobs.

Private resource plots improve supply density, growth, and convenience. Owners can allow other players to harvest. A visitor receives 80% and the owner receives 20% of the actual resource output, using persistent fractional accounting so small harvests still produce the correct cumulative split. Owners keep their entire harvest when gathering their own plots.

Sword shops craft wooden, stone, and iron swords on purchase from real stored resources. Every sword tier requires materials. Higher tiers deal more damage at the same attack speed and reach; 10/15/20 damage is a starting example. Weapon durability is not yet a settled rule and must not be inferred from gathering-tool durability.

## Defenders, barracks, and towers

Every role may own and use basic swords and bows. Everyone starts with a basic sword. Guard specialization provides the exclusive buildings and combat role, without preventing villagers and priests from defending the gate.

A guard may own at most two barracks. Each supports three living troops, for six per owner. Troops and upgrades must have finite costs; exact recruitment and replacement recipes remain to be set.

Each living deployed troop consumes **one wheat per night from its own barracks stock**. A replacement deployed that night also needs one wheat. Partial supply feeds a corresponding number of soldiers; unfed soldiers deal 25% less damage. Delivering wheat during the night can feed an unfed soldier without charging a fed soldier twice. Other residents may donate supplies. Owner withdrawals require permission.

An offline owner's troops still defend and consume supplies while other residents keep the village active. They do not generate an offline owner's performance bonus. A completely empty village pauses these activities.

Exterior archer towers and cannon defenses require construction resources, ammunition, and repair. They can be destroyed. Starting construction examples are 200 gold, 60 timber, and 40 stone for an archer tower, and 500 gold, 40 timber, and 100 stone for a later cannon. Ammunition and upgrade recipes are still to be balanced.

## Treasury, pay, and resource markets

Each new village starts with **2,500 gold in a public treasury**, once per run rather than per arriving player. Initial planning allocations are 750 for payroll, 1,250 for resource purchases, and 500 for defense/emergencies.

| Earnings | Starting target | Payment timing |
| --- | --- | --- |
| Guard base wage | 25 gold per active day/night cycle, prorated participation | Dawn |
| Priest base wage | 25 gold per active day/night cycle, prorated participation | Dawn |
| Guard performance | 1 per standard zombie, 3 per elite; up to 25 extra | With dawn wages |
| Priest performance | 1 per 50 meaningful HP healed; 5 per eligible revival; up to 25 extra | With dawn wages |
| Repairs, every job | 1 per successful repair swing, up to 10 extra per cycle | Dawn |

Guard credit includes meaningful assists and owned troop kills, with one credit per enemy per owner. Priest healing rewards actual damage recovery and revival rewards are limited per rescued player/night. Automatic paid church treatment produces service revenue for its owner rather than personal priest performance credit. Repair earnings are a separate ten-gold allowance covering the full day/night cycle, including daytime rebuilding.

Village purchases use real public gold and real stocks. Scarcity raises resource prices and surplus lowers them, with minimum/maximum prices, stock reserves, and a buying/selling spread. Bulk quotes must account for changing stock levels. Resource trading must not generate items or funds that the seller does not possess.

The treasury also receives transaction and land taxes, proceeds from steward-approved surplus exports, and a hidden survived-night grant. The initial grant formula is **50 + 20 per active player**, paid directly to the treasury without a player reward announcement. Empty villages earn nothing.

## Votes and the steward

There is no player king. Residents vote on taxes, wages, spending, and resource priorities. A rules-based steward evaluates affordability, projected consumption, stock shortages/surpluses, full role earnings, upcoming danger, and village-wide fairness.

The steward may approve, veto with a concrete explanation, or suggest a revised proposal for another vote. A role majority cannot award itself unsustainable pay. A temporary shortage may justify a temporary incentive rather than a permanent increase. Starting voting rules are a majority of active voters, ties keeping current policy, and accepted changes taking effect next morning. A solo resident can propose a policy directly, subject to the same steward evaluation.

The steward does **not** buy basic raw resources from the traveling merchant. Dwarfs must gather them. It can export verified surplus after reserving enough stock for food, repairs, defense, and expected consumption.

## Merchant, food, and transport

The traveling merchant visits every second night's following morning and stays through that day. Specialist goods may be available, while stone/iron tools remain exclusive to stocked player tool shops.

The permanent food stand sells an inventory item rather than instantly restoring hunger. The buyer chooses when to eat it from the hotbar. Buying deducts gold and wheat once; eating later consumes only the food item.

| Food tier | Hunger restored, initial target | Wheat per purchase, initial target |
| --- | --- | --- |
| Food | 25 | 2 |
| Good food | 60 | 4 |
| Best food | 100 | 6 |

Food prices should reflect current ingredient value plus a fee to avoid buying wheat at high prices and selling meals at a loss. Revenue goes to the treasury. Hunger begins at 100; the initial zero-hunger penalty prevents sprinting. Hunger pauses while offline or downed. Food restores hunger, while priests and church beds restore health.

The stable is a permanent public shop with up to three unowned horses. When empty, the steward may buy up to three from a visiting merchant at 50 gold each, subject to a safe treasury budget. Players buy a horse for 100 gold, paid to the treasury. Sold horses leave the sale stock. Horses can be ridden or attached to carts. Horse loss/persistence details and cart capacities are later balance decisions.

## Downing, churches, and respawn

Priests can revive downed players in the field. Other players can carry a downed dwarf slowly, without fighting, to a church bed. Churches begin with two beds and can upgrade to four. A living dwarf pays to lie down and heal; a rescuer can pay the displayed cost to revive a carried casualty in a bed. Automatic bed treatment can work without the priest owner present. A twenty-second revive with partial health is the initial target.

A downed player has **no respawn option until the next dawn**. Dawn enables a button; it never respawns the player automatically. The player may continue waiting for a priest or bed, and a treatment already underway can finish normally. A completed revival removes the respawn option.

Manual respawn loses all carried/equipped inventory and 25% of wallet gold. The player's bank balance, purchased land, buildings, and goods stored elsewhere remain intact while the run continues. Debt persists. The initial recovery-kit proposal is an unsellable basic sword and one limited-durability wooden gathering tool. Revival preserves belongings apart from any treatment fee.

## Personal banking and loans

Public treasury gold and protected personal bank savings are separate. Players can deposit wallet gold, and bank savings survive a village's defeat for withdrawal in a later run. Public treasury, buildings, plots, and in-run goods reset when that run ends; carried wallet gold is lost. Account savings must not be wiped by that reset or counted as the steward's spending money.

Loans are planned, using a limited lending pool and approved purchases rather than unrestricted borrowing that can immediately be banked. Debt follows the account across runs, with capped repayments from earnings. Death and village switching cannot erase it. Private savings are not automatically available for public lending.

## Delivery milestones

1. **Current foundation:** standalone visual identity, movement, public multiplayer villages, authoritative gathering/combat/repairs, pause/resume, and saved accounts/villages.
2. **Village economy:** basic stock-priced resource selling is implemented; remaining work includes buying/trading, complete payroll, food tiers, dynamic prices, merchant exports, and steward proposals/voting.
3. **Ownership and crafting:** plot purchases/conversions/taxes, private harvesting splits, tool/sword/tinker shops, and equipment tiers.
4. **Care and defenses:** owned barracks and supplies, tower ammunition/upgrades, carrying and church beds, full death/recovery handling.
5. **Longer-term progression:** horses/carts, carry weights, loans, additional enemy variety, balance, art/animation refinement, accessibility, and hosting load tests.

The deployment target is one Railway service for the first prototype, with persistent SQLite storage. More servers/replicas, a managed database, and larger populations require measured scaling work. A source package and deployment instructions do not mean a cloud service has already been created or published.
