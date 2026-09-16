# Emberwatch: accepted design and current implementation

## Build 18: terrain, materials and believable light

Tyler requested a complete graphics overhaul: sharper scenery, objects with convincing surfaces and silhouettes, suitable sourced assets, better lighting and a more realistic sun and moon. This extends the completed local Build 17 gameplay update. Existing characters, game rules, network actions, accounts and village ledgers are retained.

The world uses seven complete Poly Haven CC0 PBR sets, locally hosted at 1024 pixels per map, plus NASA SVS lunar imagery. Materials project in world space to maintain texture scale on differently sized static meshes and instances. Scenery gains organic branching trees, individual foliage, fuller wheat heads, eroded mountain ridges, smooth terrain normals, improved ground cover and crafted building details. Presentation geometry must not move a gathering anchor, road, plot border, cave floor, entrance or collision boundary.

The sky retains the authoritative village cycle and pause behavior. Small sun and moon discs, atmospheric horizon scattering, soft cloud layers, lunar detail and calibrated direct/hemisphere lighting replace the earlier oversized and flatter treatment. One directional shadow caster follows the nearby view, switching between sunlight and moonlight; inactive shadow targets are released. A small reflection probe adds material response. High detail adds bounded depth-based contact shading and restrained highlight glow, without another scene geometry pass.

Players can choose Auto, High, Balanced or Low from the lobby or village menu. Auto waits through sustained load before switching, ignores loading/tab stalls and cannot alter game state. Render-pixel, texture filtering and shadow budgets respect hardware limits. Low uses the direct render path; compatible higher settings use HDR color/depth and one final output pass. A software edge filter is used only when the required multisampled formats are unavailable. Saved preferences, window resizing and repeated quality changes must not leak GPU targets or repeatedly rebuild the menu.

Source records are in [GRAPHICS-ASSETS.md](GRAPHICS-ASSETS.md) and [SKY-ASSETS.md](SKY-ASSETS.md). Offline shader and geometry checks are documented separately from interactive playtest evidence in [VALIDATION.md](VALIDATION.md).

## Build 17: illustrated menus, expansion and village gold

Tyler requested more illustrative menus, a persistent corner inventory view, visible and explained upgrades, five workers and eight plots per resident, stronger private production, cannon impact explosions, village investment dividends and tavern gold games. The implementation keeps the shop/building-plan art language and uses actual crate-item renders in the crate collection and equipment UI.

Current limits are five workers and eight deeds; the final three deeds cost 1,100, 1,450 and 1,850 gold. Mines, tree farms and wheat farms now support levels 1–3. Each production tier adds one resource to player/worker harvest output, increases available node reserves and storage, and reduces regrowth duration; current/next cards disclose exact values. Upgraded defense/care buildings and barracks troops have visible model changes. Cannon impact bursts are presentation only, with bounded particles and no additional combat damage.

Village investments fund the treasury from wallet gold. The initial dividend target is 1% of fully eligible principal per game day, after skipping the contribution's first dawn. Dividends are funded from treasury surplus after normal dawn costs, fairly reduced when underfunded, and held in an earnings balance until collected or reinvested. Principal withdrawals depend on available treasury surplus. Investments are specific to their village, and a fallen village closes investment actions; persistent bank savings are separate. Detailed caps, timing, reserve and fractional rules are recorded in [README.md](../README.md#village-investments).

The Wayfarer now offers permanent coin flip and European roulette alongside its visiting merchant. Stakes use virtual wallet gold only; losses enter the village fund and wins draw from it. The treasury must cover each maximum win above its reserve before accepting the wager. Cryptographic server rolls and saved per-player transaction receipts govern settlement. The exact chances and total/profit multipliers are in [README.md](../README.md#the-wayfarer-tavern). Blackjack is not part of this release.

## Build 15: crates and lasting equipment

The prepared collection now has server-authoritative opening, permanent account unlocks, shared crate credits, source-specific duplicate refunds, lifetime milestone rewards and one-time run loadouts. Rare has six equal outcomes including both resource packs; Legendary has five including consumable Phoenix Ember. Fitted equipment affects armor, capacity, resource weight or newly purchased gathering-tool durability. Starter supplies are bound and do not refill. The Sunforged Viking Helm is earned at 100 personal credited nights and grants Last Stand. The complete current rules and initial balance settings are in [CRATE-PROPOSAL.md](CRATE-PROPOSAL.md). Historical entries below describe their respective releases.

This document records Tyler's game plan so later implementation does not silently change the rules. Emberwatch is a working title. Numerical prices, health values, recipes, and balance examples remain tunable unless a rule below explicitly fixes the relationship.

The game has its own codebase, GitHub repository and Railway service, linked from Tyler's website. No previous game code is part of this project.

## Build 13: resource exchange, building plans and nearby map

The permanent Resource Exchange stands north of the stables at (18, -86) with a west-facing counter at (9.45, -86). It handles public resource purchases, sales, donations and communal-stock requested deliveries. The treasury remains the place for personal savings, purchase loans, repayments, worker hiring/dismissal and council access. Prices, public stock and treasury funding retain their existing ledgers. Existing communal requests keep their internal bank identity and withdrawal history; only their physical delivery point/name changes, so saved escrow and progress remain valid. Workers travel to the exchange for sales and return to the treasury for shelter and management. Saved occupants displaced by the new building move to valid ground without losing cargo or balances.

Each illustrated resource card offers a one-click Sell max alongside custom buy/sell quantities. Its shared calculation follows unit-by-unit stock prices and tax, fits the carried quantity and 10,000-unit action limit, and preserves the 500-gold reserve. It submits the displayed amount and minimum payout as one sale; changed funds, inventory, access or an unfavorable quote reject without partial mutation. The remaining resources stay carried when the treasury cannot afford the whole pack.

Owned plots display one illustrated building plan with previous/next arrows, keyboard access, current costs, benefits and role/building limits. Eligible plans come first; role-locked plans remain inspectable with their requirements. Current funds and materials are rechecked on selection, and destructive conversion retains confirmation. The selection and inspection focus survive state snapshots.

The circular minimap stays centered on the player with a 42-meter surface radius and 25-meter underground radius. North stays up; nearby landmarks use colored silhouettes, roads use the actual world curves, and available resources have distinct colors/shapes. Gold marks the player, blue allies and red enemies. Marked destinations outside the view receive an edge pointer; destinations in another level route through the cave entrance. Hover exposes POI names and distance, with an accessible text description of nearby landmarks.

Standing and wall torches replace outdoor, cave and carriage lanterns. Outdoor flames kindle with the authoritative dusk lighting and extinguish at dawn. Cave torches remain lit during the day for navigation. Procedural animated flame shapes and a bounded pool of six warm, flickering, shadowless lights avoid one light per fixture; visiting carriage flames follow the merchant's actual presence. Shop interior illustrations also use torches.

Crate credit prices and the original item pool are approved in the design proposal. The Phoenix Ember self-revive item and Rare Mining Pack are proposed additions with balance choices recorded in [CRATE-PROPOSAL.md](CRATE-PROPOSAL.md). All crate gameplay remains unimplemented pending the user's instruction to build it.

## Build 12: the Deepworks and visual storefronts

The public surface quarry and fixed iron/coal patches move into a mountain cave entered from inside the northern village at (0, -118). A continuous passage descends through upper, middle and deep chambers at 3, 8 and 14 meters below the surface. The 44 existing public mineral identities are preserved; individual stored depletion, accounts, plots and village economies migrate in place.

| Depth | Sites | Mineral pool per regrowth |
| --- | --- | --- |
| Upper | 12 | Guaranteed stone |
| Middle | 16 | 40% stone, 30% iron, 30% coal |
| Deep | 16 | 20% stone, 40% iron, 40% coal |

The server stores each village's roll seed and each node's current mineral and roll number. Only a depleted node finishing its regrowth timer rolls again; joining, pausing and restarting never reroll available resources. All residents see and harvest the same mineral. Wooden/stone/iron picks retain equal access and speed with 1/2/3 yield. Private player mines keep their existing rules. Hired workers seek the current rolled type and walk through the cave to deliver or sell it. Solid rock blocks both movement and harvesting.

The cave has connected ramp geometry, supports, lanterns, inward-facing walls and rock ceilings. The camera and rendered actors/transport follow ground height; camera paths are clipped against rock, floor and ceiling headroom. Surface ambience gives way to stone footsteps underground. The minimap switches to a local cave plan and routes surface destinations through the entrance.

Shops use illustrated item displays, themed interiors and shopkeepers. Hover/focus and a native Inspect item disclosure expose durability and item effects, with prices, exact stock and recipe checks preserved. The physical treasury board displays pinned parchment requests and illustrated resources. Shops still require their existing door access, and requesting a delivery payment still requires its destination entrance.

The crate system remains proposal-only. The accepted shared-credit direction and proposed exchange rates are recorded in [CRATE-PROPOSAL.md](CRATE-PROPOSAL.md). No crate currency, armor, starting kits or gold helmet is enabled by this build.

## Build 11: gate detail, solid well and physical noticeboard

Build 11 improves gate and well artwork while preserving gate movement and gameplay. Players read village requests by approaching the treasury noticeboard and pressing E. The previous B shortcut is removed; menu/HUD navigation points to the physical board. Delivery destinations expose their own requested deliveries at their actual entrances. Public request data and authoritative payment checks remain unchanged.

Crates, functional armor, starting kits and a 100-night gold helmet are design ideas awaiting review, not accepted runtime behavior. See [CRATE-PROPOSAL.md](CRATE-PROPOSAL.md); Build 11 does not add them.

Build 04 implements the forty internal and eight exposed plots, ownership and construction, private harvesting, stocked crafting shops, upgraded equipment, the treasury market and policies, merchant trade, owned defenses, church care, and horses/carts with protected loans. The Watch now faces the street; its guard exit and road agree with that entrance. Existing villages and account savings migrate without resetting the run.

This is the first integrated playtest implementation of the accepted plan. “Implemented” means that server rules, saved state, client interactions and world representations are connected; it does not mean visual polish, balance, long-run survival progression or sustained eight-player performance are complete. See [VALIDATION.md](VALIDATION.md) for the checks performed and their limits.

Builds 01–03 established the original village art, third-person multiplayer, authoritative gathering/combat, priest revival, protected banking, stock-priced selling, a persistent hunger meter, village chat with overhead bubbles, and clearer quarry access. Those features remain in this expansion.

Build 05 adds the accepted feedback: empty-handed starts with one tool’s purchase price, backpacks, role traits, custom treasury quantities, wheat-funded replacement guards, clear tower ammunition status, death-camera control, corrected sword grip, sculpted horses with aligned riders, natural mineral beds and harvest effects. Successful harvest/attack/repair notices are suppressed and other notices move to the corner.

Build 06 corrects the working-tool hand poses, gives each backpack upgrade a visible worn model, increases newly founded treasuries to 20,000 gold, adds paid gathering workers, and removes fallen runs from public browsing. Existing runs retain their saved treasury balances and bank accounts remain independent of a village’s survival.

Build 07 adds articulated knees, ankles, elbows and hip rotation to walking and running, blended by movement speed. The upper body counters the hips and leans gently into turns. Zombie movement remains slower and uneven. Boots and trousers now deform around the extra joints. These are client visual changes; authoritative movement speed, collision, combat timing and saved game rules remain the same. Road border stones stop at adjoining path surfaces so junctions do not contain internal curb rows.

Build 08 requires residents to approach the front door or counter for building services. Owned structures use their building entrance; unbuilt plots, ruins, farms and mines use their frontage gate. Client prompts and authoritative transactions share these access points, while church beds remain separate care interaction points. The atlas marks entrances. A merchant character, a covered carriage and two harnessed horses appear during the authoritative merchant visit and disappear when it ends. They are visual visitors, separate from residents’ owned horses and carts.

Build 09 adds decorative grass, ferns, shrubs, wildflowers, clover, leaf litter and limited wall ivy, with clearances around roads, permanent services, all plots, church beds, harvest nodes and the merchant caravan. Two drifting cloud decks, the sun, moon, stars and gradual lighting changes show the actual village cycle. Sunrise starts the day; sunset starts the night. Build 09 uses eight-minute days and four-minute nights; Build 10 allows dawn sooner when the complete wave is defeated. Everyone joining the same village sees its current phase, and the sky stops advancing when the simulation pauses. The camera can look upward without orbiting underground.

Build 10 implements the accepted follow-up ideas: distinct zombie behaviors, graveyard emergence, a Brood husk that splits into up to three weak non-splitting Grave mites within the battlefield population limit, fifth-night Gravebreaker sieges, funded shortage deliveries, owned troop commands, richer procedural audio, an optional first-day checklist, and persistent cosmetic milestones. Later steering makes all archer towers ammunition-free, adds a forward sword cleave for players and guards, and gives every zombie a fixed red attack warning that can be dodged before impact. Brief translucent sword trails and swoosh sounds follow the blade.

### Current implementation choices

The values below resolve earlier provisional details for this playtest and remain tunable. The accepted relationships in the following sections still apply.

| Area | Current choice |
| --- | --- |
| Land | Forty plots inside and eight outside; five total deeds per resident. Successive plot prices are 100, 200, 350, 550 and 800 gold. Each plot holds one structure or resource land use. |
| Tax scaling | Starting daily land tax is `2 × number of owned plots²`, prorated by active cycle participation and rounded up. The policy sets the base multiplier. No participation means no new land tax; unpaid tax becomes in-run arrears. |
| Carrying and storage | Guard/Priest capacity is 100 and Villager capacity is 150, including equipped tools with durability remaining. Backpack upgrades add 100/250/400 for 40/100/200 gold at Oak & Iron; building stores hold 1,500 weight. A deployed cart holds 300 weight. Inventory transfers are checked before mutation. |
| Workers | Up to two per resident. Hire at the treasury for 75 wallet gold; pay one wallet gold per 30 seconds of work. Gather one unit every four seconds with provided basic tools, carry 40 weight, and deliver to an owned building or sell at the treasury. Daytime work while the employer is online; return to shelter at night or on pause. Cargo and paid work time survive saves. No automatic use of savings or purchase credit. |
| Troops | Recruitment is 35 gold plus five timber and two iron from that barracks. Two barracks per Guard, three recruited slots each, including pending replacements. Troops consume one wheat per night. Fallen recruited troops respawn after 30 active seconds if the barracks has one wheat; that wheat covers the current night. Replacements preserve recruitment investment and wait when wheat is absent. |
| Church care | Player-owned churches begin with two beds and upgrade to four. Bed healing is eight gold for ten seconds; revival is twenty gold for twenty seconds, returning at 45 HP. Cancelled or interrupted paid treatment refunds its payer. The permanent Sanctuary guides residents to priest care and owned churches. |
| Defense | Archer towers automatically shoot without consuming arrows or any ammunition; newly built towers grant no starter arrows. Existing stored arrows remain ordinary cargo. Cannon shots spend one stone and one coal. Paid level-two upgrades and shared-stock hammer repairs keep defenses useful. |
| Food | Three inventory items restore 25, 60 and 100 hunger and use two, four and six wheat. Prices follow wheat scarcity plus a preparation fee. |
| Horses and carts | The public stable stores up to three sale horses. The steward can restock an empty stable at 50 gold per horse during a merchant visit; players pay 100. Each resident can own one horse and deploy one cart in the run. Cart contents are owner-controlled; blocked carts detach without deleting cargo. |
| Protected credit | Maximum outstanding debt is 200 gold per account; the village lends at most 500 gold per run and retains 1,000 treasury gold before a new loan. Borrowing creates approved purchase credit rather than wallet gold. |
| Repayment | Up to 20% of cumulative earnings repays debt; fractional accounting handles small payments fairly. Remaining debt and unused credit persist across runs. Private savings are never used automatically. |
| Purchases on credit | Land, construction, a different player's equipment shop, starter wooden tools, backpacks, and horses may use credit after wallet gold. Buying from your own shop, banking, ordinary supplies and treatment require wallet gold. |
| Wage tracking | Each active tick accrues the wage for the job actually held, divided by the full day/night duration. Dawn pays the funded whole-gold amount plus accrued performance and repair bonuses; changing jobs cannot reprice earlier participation. |
| Council and steward | Starting trade tax is 5%; Guard and Priest wage policies start at 25. Wages, trade tax, land-tax base and export priority can be proposed. A deterministic steward examines need and reserves and explains its decision; approved changes are rechecked at dawn. |
| Merchant | Visits begin on day 3, then every other morning for the day. Limited iron, coal and arrows are available to residents. The steward exports only a safe surplus of wheat, timber and stone and never imports those basics. |

## Accepted game rules

## Village survival

- Humans play dwarfs only. Zombies are controlled by the game.
- The three starting jobs are **Guard, Priest, and Villager**. All three can gather, defend, and build universal structures.
- A village holds **eight saved residents total**, counting online and offline players. An offline member retains their place and plot ownership. Solo play is valid; no minimum party size is needed.
- Public server browsing shows online players, offline residents, and occupied capacity. There are no private invitation codes in the initial plan.
- A day lasts eight minutes and a night lasts up to four. Clearing the complete scheduled wave and all split offspring starts dawn early; empty gaps between spawns do not. Difficulty increases after each five-night band, with a warning before the stronger wave.
- When a village has no online players, freeze its clock, enemies, resource consumption, wages, and rewards. Resume the same run rather than resetting its attacks.
- Dawn stops new night-wave spawns. Existing zombies remain until defeated. A living keep at dawn counts as a survived night.
- Keep destruction ends the run and removes the village from the selection list. Current residents can still view the loss result, and account savings are retained for the next run. A downed party does not immediately end a run while the keep still stands.

## Map and visual direction

The intended style is a cohesive fantasy world with terrain detail, lighting, shadows, readable silhouettes, and convincing animation. Tyler clarified that characters should look natural, with sculpted faces, connected anatomy and fitted clothing; smoothing visibly assembled primitive shapes is insufficient. The current character redesign is documented in CHARACTERS.md for visual review. Third-person keyboard/mouse controls must feel smooth, and art improvements must preserve the game rules.

The village sits against mountains with its keep to the north, permanent services near the center, and **one southern gate**. The internal plan allows forty plots, with eight optional exposed plots outside. Trees grow around the village; there is no dedicated public timber section. The upper level of the northern mountain mine guarantees public stone, and an internal wheat field keeps food gathering available. Iron and coal occur randomly in the deeper mine levels.

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

Carry capacity is weight based, with carts providing separate storage capacity. Current limits and weights are listed above and in `shared/content.js` and `shared/transport.js`; they remain tunable. The final hotbar has eight slots for tools and consumables; items in the hotbar still count as carried inventory.

## Land, buildings, and changing jobs

Each resident may own up to **eight plots combined**, inside and outside. A plot holds one building or land use. Converting a plot removes its existing structure; the player retains the plot. The initial purchase-price targets are 100, 200, 350, 550, 800, 1,100, 1,450, and 1,850 gold for successive owned plots. Daily land tax scales with the number of plots owned, starting with a two-gold base; the current quadratic formula is listed above. No tax accrues simply because a player is offline.

| Who can build | Structures |
| --- | --- |
| Every job | Tool shop, tinker shop, mine, tree farm, wheat farm, house, archer tower, cannon defense. |
| Guard only | Barracks and sword shop. |
| Priest only | Church. |

Tinkering is a universal shop, not a fourth job. Its stocked recipes make bows, arrows, and carts.

A player changing jobs loses buildings exclusive to the previous job. Universal buildings and owned land remain. Removed barracks disband their troops. Storage and church patients must be handled before a destructive conversion, and earned wages/bonuses must not be duplicated by switching jobs.

Private resource plots improve supply density, growth, and convenience. Owners can allow other players to harvest. A visitor receives 80% and the owner receives 20% of the actual resource output, using persistent fractional accounting so small harvests still produce the correct cumulative split. Owners keep their entire harvest when gathering their own plots.

Sword shops craft wooden, stone, and iron swords on purchase from real stored resources. Every sword tier requires materials. Higher tiers deal more damage at the same attack speed and reach; 10/15/20 damage is a starting example. Current sword durability is 100/150/200 for wood/stone/iron. Each valid player attack consumes one durability, including an attack that misses; hitting several enemies with a cleave still consumes only one.

## Class traits

Guard has 100 HP and a 40-point shield that absorbs hits first. After six seconds without damage it recovers four points per second; it does not regenerate while downed or offline. Priest has 125 HP. Villager has 100 HP and 50 extra carrying capacity, added to every backpack tier. These are initial balance values. Changing roles preserves health percentage and cannot refill a guard shield; changing to a lower capacity preserves the cargo but prevents further loading until space is made.

## Defenders, barracks, and towers

Every role may own and use basic swords and bows. New residents start each village run with no items and 10 gold, enough for one wooden tool at Oak & Iron. An account can reside in only one active village; reconnecting grants nothing. Existing residents retain their inventories. Guard specialization provides the exclusive buildings and combat role, without preventing villagers and priests from defending the gate.

A guard may own at most two barracks. Each supports three recruited slots including pending replacements, for six per owner. Fallen troops return after 30 active seconds when the originating barracks has one wheat. Destroyed or converted barracks cannot replace troops. Troops and upgrades have finite costs; current recruitment and upgrade recipes are in `shared/defense.js`.

Each living deployed troop consumes **one wheat per night from its own barracks stock**. A replacement deployed that night also needs one wheat. Partial supply feeds a corresponding number of soldiers; unfed soldiers deal 25% less damage. Delivering wheat during the night can feed an unfed soldier without charging a fed soldier twice. Other residents may donate supplies. Owner withdrawals require permission.

An offline owner's troops still defend and consume supplies while other residents keep the village active. They do not generate an offline owner's performance bonus. A completely empty village pauses these activities.

Exterior archer towers and cannon defenses require construction resources and repair. Archer towers need no ammunition; cannons consume stone and coal. They can be destroyed. Starting construction examples are 200 gold, 60 timber, and 40 stone for an archer tower, and 500 gold, 40 timber, 100 stone and 20 iron for a later cannon. Cannon ammunition and upgrade recipes are still to be balanced.

## Treasury, pay, and resource markets

Each new village starts with **20,000 gold in a public treasury**, once per run rather than per arriving player. This larger starting reserve funds payroll, resource purchases, and defense costs under the existing payment rules. Saved villages continue from their current treasury balance; loading or rejoining never grants the starting reserve again.

| Earnings | Starting target | Payment timing |
| --- | --- | --- |
| Guard base wage | 25 gold per active day/night cycle, prorated participation | Dawn |
| Priest base wage | 25 gold per active day/night cycle, prorated participation | Dawn |
| Guard performance | 1 per Shambler, Grave runner or Grave mite; 2 per Brood husk; 3 per Ironbound; 5 per Gravebreaker; up to 25 extra total | With dawn wages |
| Priest performance | 1 per 50 meaningful HP healed; 5 per eligible revival; up to 25 extra | With dawn wages |
| Repairs, every job | 1 per successful repair swing, up to 10 extra per cycle | Dawn |

Guard credit includes meaningful assists and owned troop kills, with one credit per enemy per owner. Priest healing rewards actual damage recovery and revival rewards are limited per rescued player/night. Automatic paid church treatment produces service revenue for its owner rather than personal priest performance credit. Repair earnings are a separate ten-gold allowance covering the full day/night cycle, including daytime rebuilding.

Village purchases use real public gold and real stocks. Scarcity raises resource prices and surplus lowers them, with minimum/maximum prices, stock reserves, and a buying/selling spread. Bulk quotes must account for changing stock levels. Resource trading must not generate items or funds that the seller does not possess.

The treasury also receives transaction and land taxes, proceeds from steward-approved surplus exports, and a hidden survived-night grant. The grant is **1,000 × the completed night number**: 1,000 after night 1, 2,000 after night 2, 3,000 after night 3, and so on. It is paid directly to the treasury without a player reward announcement and does not depend on player count. Existing runs use their current night number on the next dawn; earlier nights are not paid again. Empty villages remain paused and earn nothing.

## Votes and the steward

There is no player king. Current votes cover guard/priest wages, trade tax, land-tax base and surplus-export priority. Broader spending votes remain a future extension. A rules-based steward evaluates affordability, projected consumption, stock shortages/surpluses, full role earnings, upcoming danger, and village-wide fairness.

The current steward approves or vetoes with a concrete explanation. Automatically suggesting revised counterproposals remains a future extension. A role majority cannot award itself unsustainable pay. A temporary shortage may justify a temporary incentive rather than a permanent increase. Starting voting rules are a majority of active voters, ties keeping current policy, and accepted changes taking effect next morning. A solo resident can propose a policy directly, subject to the same steward evaluation.

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

The stable is a permanent public shop with up to three unowned horses. When empty, the steward may buy up to three from a visiting merchant at 50 gold each, subject to a safe treasury budget. Players buy a horse for 100 gold, paid to the treasury. Sold horses leave the sale stock. Horses can be ridden or attached to carts. Current horses and carts remain with the village during the run; a resident may own one of each, and cart storage holds 300 weight. These remain tunable balance choices.

## Downing, churches, and respawn

Priests can revive downed players in the field. Other players can carry a downed dwarf slowly, without fighting, to a church bed. Churches begin with two beds and can upgrade to four. A living dwarf pays to lie down and heal; a rescuer can pay the displayed cost to revive a carried casualty in a bed. Automatic bed treatment can work without the priest owner present. A twenty-second bed revival with 45 HP is implemented in this build.

A downed player has **no respawn option until the next dawn**. Dawn enables a button; it never respawns the player automatically. The player may continue waiting for a priest or bed, and a treatment already underway can finish normally. A completed revival removes the respawn option.

Manual respawn loses all carried/equipped inventory and 25% of wallet gold. The player's bank balance, purchased land, buildings, and goods stored elsewhere remain intact while the run continues. Debt persists. No recovery kit is granted. Equipped backpacks are lost too. A resident can recover a wooden tool using remaining wallet gold, bank savings, or approved purchase credit. Revival preserves belongings apart from any treatment fee.

## Personal banking and loans

Public treasury gold and protected personal bank savings are separate. Players can deposit wallet gold, and bank savings survive a village's defeat for withdrawal in a later run. Public treasury, buildings, plots, and in-run goods reset when that run ends; carried wallet gold is lost. Account savings must not be wiped by that reset or counted as the steward's spending money.

Loans use a limited lending pool and approved purchases rather than unrestricted borrowing that can immediately be banked. Debt follows the account across runs, with capped repayments from earnings. Death and village switching cannot erase it. Private savings are not automatically available for public lending.

## Implementation stages and remaining work

1. **Foundation, implemented:** original village identity, movement, public multiplayer, authoritative gathering/combat/repairs, chat, pause/resume, accounts and saved villages.
2. **Village economy, implemented:** resource buying/selling, treasury reserves, role-tracked wages and bonuses, food tiers, transaction/land taxes, merchant exports and steward-reviewed voting.
3. **Ownership and crafting, implemented:** full plot map, purchases/conversions, storage, visitor harvesting shares, stocked tool/sword/tinker shops and equipment tiers.
4. **Care and defenses, implemented:** owned barracks and food, recruitment, towers and ammunition, upgrades, damage/repair, carrying and church-bed treatment, manual dawn respawn with inventory and wallet penalties.
5. **Transport and credit, implemented:** horses, carts, weight limits, restricted loans, durable debt, and repayments from earnings.
6. **Playtest and refine:** verify every service and route visually in live multiplayer, tune survival/economy progression and solo play, refine models/animations, test eight-player performance and reconnects over long runs, and improve accessibility and operations. More jobs, gold ore, further enemy varieties and additional expansion ideas remain later content decisions.

The deployment remains one Railway service using Node 24 and persistent SQLite storage. Existing account and village data are migrated in place. More server replicas, a different database or higher populations require measured coordination and scaling work; the full map alone does not establish that capacity.

## Build 10 accepted additions

- Enemies: Shambler, Grave runner, armored Ironbound, splitting Brood husk, weak Grave mite, and fifth-night Gravebreaker. Their silhouettes and behavior are distinct. New graveyard enemies visibly emerge for 2.2 seconds and cannot move or attack while rising. Offspring settle for 0.65 seconds at the death site and cannot split again. Active enemies are capped at 120, so a crowded battlefield can limit a brood to fewer than three offspring.
- Combat: player and NPC guard sword swings hit all eligible zombies in a 120-degree forward arc, with existing wall/gate obstruction rules and one durability cost per player swing. Player reach is 3.2 m; guard reach 2.6 m. Red circular warnings lock to their world position; impact checks current defenders in the circle, so moving clear prevents damage. Base windups range from 0.65 to 1.65 seconds; Brood husk and Gravebreaker slams cover wider areas. Sword trails are short and translucent.
- Noticeboard: the steward reserves actual treasury gold for finite shortages rather than creating new currency. Four requests/day, at most 24 units each, and 300 gold/day are initial limits. Requests protect the 500-gold reserve and two payroll cycles, accept partial deliveries at the destination entrance, refund unused escrow, and retain provenance across reloads to prevent withdrawal/redeposit bounty loops. Archer towers never request arrows.
- Troop orders: owners who are currently guards can remotely order their intact barracks to defend the gate, hold the owner's current reachable position, follow, or retreat. Rally markers are owner-visible. Follow falls back home while the owner is downed, offline, mounted, in bed or unreachable. The public Watch keeps its original defense role; recruitment and supplies remain entrance interactions.
- Guide and honors: new accounts can follow or dismiss a five-step first-watch guide. Existing accounts are not forced into it. Account honors unlock colors and crests after 1/5/10/20 credited nights, requiring at least half of the actual night online and alive. No retroactive joining credits or combat advantages. Personal choices persist across runs; owned-building trim and founder-selected keep banners remain within the run and are changed at their entrances. Banner choice is decorative and grants no governing power.
- Audio: footsteps reflect roads/ground; daytime birds, nighttime crickets, wind, tools, fighting, grave emergence and a dusk bell make activity audible. Game sound has a saved mute control, starts only after a user gesture, and stops during hidden/stale/paused sessions.

Early dawn: when all scheduled spawns have occurred and no living or emerging zombies remain, start the next day immediately. Run the same dawn wages, bonuses, survival grant and merchant/request review once. Wages keep their configured full-cycle per-second accrual rate, so an early clear pays only the time actually accrued, plus earned bonuses. If the four-minute deadline arrives first, the existing rule still applies: stop new spawns and leave surviving zombies to be cleared. Cosmetic participation measures half of the actual elapsed night, including an early clear.
