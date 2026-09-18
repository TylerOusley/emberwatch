# Emberwatch

An original cooperative 3D dwarf village survival game. **Emberwatch is a working title.** This standalone project does not import or depend on code from Tyler’s other games.

**First Light — Zombie bounties build 29.** This build connects the 48-plot village to seasons, weather, village events, plot workers, manufacturing, owner pricing and ranged barracks troops. Guard, Priest and Villager are joined by Manager, Tinker and Wizard. The accepted rules and current balance choices are recorded in [docs/DESIGN.md](docs/DESIGN.md).

The approved gameplay systems described below have playable implementations. This is their first combined playtest build: visual refinement, economy tuning, long-run balance, accessibility, and sustained multiplayer performance still need testing. Automated checks and their limits are recorded in [docs/VALIDATION.md](docs/VALIDATION.md).

## Latest playtest improvements

The Build 29 worker UI hotfix replaces repeated full worker cards with a compact, searchable roster and a selected-worker panel. Filter by status or crew type, see cargo and work status at a glance, and switch between Orders, Tools and Training. Draft orders stay with each worker across selections and live updates. Wage, staffing and work rules remain unchanged.

Build 29 pays every contributing resident 100 gold immediately when a zombie dies. Any positive damage counts, regardless of role, including damage from owned towers and guards while their owner is offline. Each player receives one full bounty per zombie, with no nightly cap or treasury funding requirement. Normal loan repayments apply. The pack tracks kills, assists and gross bounty gold for the current village run.

Build 28 makes Wizard staffs unbreakable and restores existing broken staffs during saved-game migration. Wizards can reclaim a lost staff for free at any working Arcane Academy entrance with room for its 3 weight. Recovery preserves mana, spell cooldown and learned skills. Fire/frost spend 15 mana with a 0.6-second delay; lightning spends 22 with a 0.8-second delay. You can keep casting below full mana until you cannot afford the next spell.

Build 27 adds all four requested tavern games together: blackjack, three-card poker, Enchanted reels and Wheel of Fate, alongside coin flip and roulette. Card hands persist privately with escrowed payouts and a 120-second automatic decision. Maximum committed stake is 10,000 gold; three-card poker allows up to 5,000 ante plus its matching play wager.

Managers start with eight personal workers and 60-second wages, train up to ten, and retain the existing plot staff system. Supply stone or iron tools for 25% or 50% more output, with actual durability and optional budgeted repairs. Tinker owners discount shop recipes 10–20% for every customer. Wizards start with a fire staff, can learn frost and chain lightning, and build Arcane Academies and sulfur-fed wizard towers. Each of the six roles has paid skill branches; lessons survive role changes, respawn and academy destruction for the current village run.

The mine is recessed into broad mountain foothills, with folded vaults, side workings and readable sulfur veins. Space jumps over new fallen logs and onto stone ledges; tall walls and plots retain authoritative collision. Any dwarf can rebuild a ruin by hammering with timber and stone; it reopens at 35% health while preserving ownership, stock, upgrades and recruited troop training.

Carriages hold 1,000 weight, upgrade to 2,000 for 750 gold, 40 timber and 15 iron, and travel 20% faster on roads when loaded. Direct plot freight and two rescue stretchers make mine runs and church evacuation practical. Shared village works fund gate/keep reinforcement (300 timber, 500 stone, 5,000 gold), a repair mason, a ballista and a trebuchet. Later projects cost up to 30,000 gold plus bulk resources and need donated supplies/ammunition.

Crates now include seven additional rewards. Each opening makes one rarity roll: Basic 5% Rare, Rare 10% Epic, Epic 20% Legendary, and actual Legendary crates 1% Godly. The Godly Heart of Emberwatch grants a once-per-night Ember Ward (Q): wearer and nearby living allies gain 50 absorption for ten seconds, without stacking. Epic crates cannot award Godly items. Duplicate refunds remain based on the purchased crate price.

Build 26 keeps unpaused personal hires, plot gatherers and transporters working after their owner leaves, as long as someone remains online in that village. Each crew spends its own owner's wallet and prepaid wage time; when both are exhausted, paid work stops. Sales still credit the owner. Leaving the village does not cancel orders or discard cargo. When the last resident disconnects, movement, gathering, deliveries and wages pause until a resident returns. The market queue also includes working crews whose owners are offline.

Build 25 implements four one-hour seasons, season-aware rain/snow/clouds/fog, and six timed village events with actual production, public supply and demand effects. The HUD explains the current season, weather and event with countdowns. Schedules pause in empty villages and persist across restarts.

Five personal workers remain available alongside one additional plot worker per building level: gatherers for mines and farms, transporters for shops, defenses and churches. New staff start paused without a hiring charge; activate them through **Pack → Manage workers**, where transporters can select another owned source and maintain a 1–100% destination storage target by weight. Active work uses existing wallet wages. Staff, cargo, assignments and training survive restarts.

Mine sulfur from eight dedicated public veins or owned mines. Tinker owners can make **5 gunpowder from 2 sulfur + 1 coal**, a **musket from 14 iron + 16 timber**, and **8 musket shots from 4 stone + 2 gunpowder**. Craft powder and shot into shop storage for sale or use. Shop owners set each recipe's price from 1 to 10,000 gold; buyers see the current quote. Equip a musket through the pack's hotbar controls: 64 base damage, 38m range, 1.6-second reload, and one ammunition/durability per shot.

Owned barracks recruit swordsmen, archers and musketeers, with individual veteran training. Upgrading a barracks increases its shared capacity from three to six troops. Ranged soldiers use arrows or musket shot from their own barracks, follow orders when ammunition runs out, and have distinct equipment and shot effects.

At **The Wayfarer entrance**, press **E → Play tavern games** to reach coin flip or roulette, including when the traveling merchant is absent. Maximum stake rises to **10,000 gold**, subject to wallet funds and treasury payout cover. Overlapping roof tiles and turret corner stones now have physical clearance, and light-space shadow stabilization reduces movement shimmer. Existing mine-light pooling and percentage merchant exports remain in place.

Build 24 fixes tavern button presses being interrupted when wallet or treasury updates rebuild the menu. Controls retain the active press while still checking current funds before accepting a bet. Clear guidance beside Place bet explains invalid stakes and unavailable funds. The same interaction protection covers village investment controls. Betting odds, payouts, wallet funding, the treasury reserve and entrance requirements keep their existing rules.

Build 23 removes the steward's fixed 40/80/120-unit merchant export limits. Council policies now sell 25% (Conserve), 50% (Balanced, the default), or 100% (Trade) of surplus wheat, timber and stone at each visit. Food and repair reserves are protected before calculating the percentage, and sales round down to whole units. Conserve retains its larger reserve. Existing villages keep their selected policy; the council and merchant screens show its percentage.

Build 22 fixes a reproduced worker stall caused by tiny remaining fractions of prepaid work time. Workers now account for every positive movement and renew their normal wage block when it is spent. Navigation retry timers follow simulation time even when the worker can afford only a tiny final step. Existing saved workers recover through ordinary simulation, keeping their identities, assignments, cargo and earned upgrades. Paused workers, offline owners, full storage and insufficient wages/treasury funds still follow their existing rules.

Build 21 keeps the six nearby torch lights registered throughout mine entry and exit, setting unused lights to zero intensity instead of removing them from the renderer. This prevents proximity changes from selecting new lighting shader variants across the scene. Torch reach, brightness, nearest-fixture selection, day/night behavior and the shadow-free light budget are unchanged. Cave geometry, camera collision, multiplayer rules and saved data are untouched. This targets a reproduced shader-churn cause of entrance hitching; real-device frame-time confirmation is still needed.

Build 20 added Quick Sell for carried raw resources, visit-stable merchant stock, rear carriage storage-chest animation and E-to-close, worker route recovery, a 5,000-gold nightly treasury award cap and a 1,000-gold outstanding personal-loan cap.

Build 19 keeps a held gathering click active as the nearest valid matching node changes, so a dwarf can sweep across wheat or continue through adjacent ore without releasing the mouse. Closing an in-game panel now immediately asks the browser to recapture the mouse, while **F** toggles fullscreen from gameplay or a menu. The first-watch guide is now an illustrated progress card with step artwork, a completion meter, an expandable visual route and a one-click map marker.

Build 18 replaces flat scenery surfaces with seven locally hosted, 1K PBR material sets: mossy grass, forest earth, weathered rock, cobblestones, timber, castle masonry and roof tiles. Color, normal and roughness maps add surface detail under moving light. Trees now have tapered branching trunks and individual leaves or needle sprays; wheat has bent stalks, grains and awns. Smooth terrain, eroded mountain ridges, detailed ground cover, overlapping shingles, beveled masonry, framed windows and turned cannon barrels replace many of the earlier primitive silhouettes. All roads, deed bounds, cave floors, gathering anchors and collision rules remain authoritative and unchanged.

Daylight and moonlight use a calibrated sky, warmer horizon scattering and sharper shadows around the viewer. A small solar disc and a NASA lunar surface texture replace the oversized discs; drifting cloud layers and stars follow the shared village clock. A sky reflection probe adds sheen to metal, leather and water. High detail adds restrained contact shading and highlight glow, with one scene render and one final presentation pass. [Textured world preview](docs/previews/world-build18.jpg), [actual sky shader preview](docs/previews/sky-build18.jpg), [actual PBR shader diagnostic](docs/previews/surface-materials-build18.jpg), [plot geometry](docs/previews/plots-build18.jpg), [cave geometry](docs/previews/cave-build18.jpg). These are offline rendering checks, not interactive browser captures.

Open **Graphics settings** in the lobby or **Graphics** in the village menu. **Auto** starts Balanced and adjusts after sustained performance changes; **High**, **Balanced** and **Low** keep your chosen level. Preferences stay in this browser. High allows up to 4 million rendered pixels and 4096-pixel nearby shadows; Balanced caps rendering at 2.5 million pixels with 2048-pixel shadows; Low caps at 2 million pixels and disables shadow maps and the extra presentation pass. Device capabilities can reduce these limits. Image filtering and supported multisample antialiasing keep detail stable; a directional edge filter handles GPUs without compatible multisampled HDR targets. No simulation or multiplayer settings change with picture quality.

The 21 original Poly Haven CC0 maps total 13.36 MB; the NASA Moon map adds 0.46 MB. They are served from the game, with neutral fallbacks while unavailable. Exact sources, licenses and integrity hashes are recorded in [Graphics assets](docs/GRAPHICS-ASSETS.md) and [Sky assets](docs/SKY-ASSETS.md).

Build 17 brings illustrated cards and clearer actions to the village menu, inventory, treasury, workers, storage, care, defense, crate collection and equipment. A corner **On you** display keeps all carried resource and provision counts visible, alongside owned tools, equipped crate items and carrying weight. It reads your personal inventory only. Buildings and troops gain visible reinforcement when upgraded, and cannon arrivals create brief fire, spark, shockwave and smoke effects at the actual target.

Residents can now hire **five workers** and own **eight plots**. Personal mines, tree farms and wheat farms support levels 1–3, with extra yield for players and workers, more harvest reserves, shorter regrowth and larger storage. Upgrade cards show current and next values before payment.

The treasury now offers **Village investments**: contribute wallet gold, collect funded dividends, reinvest earnings or withdraw available principal. **The Wayfarer** is a permanent tavern as well as the merchant's stop, offering coin flip and European roulette day and night. Both features use the existing village treasury and have illustrated rules and receipts. See the rules below for funding, eligibility and returns.

Build 16 adds a dedicated admin testing account with a one-time grant of **10,000,000 personal bank gold**. It also starts each new village with **10,000,000 wallet gold**. Its village menu includes **Refill test gold**, which tops both balances up to ten million without reducing a higher balance. Purchases, crates, equipment and survival use the normal game rules. Other accounts retain their ten-gold start.

Testing access is restricted to authenticated account UUIDs in `server/admin.js`; names and client-supplied admin fields never grant access. Initial bank funding is recorded once in SQLite and does not repeat on login or restart. Refill writes the bank and current wallet in one transaction. Credentials are supplied separately and must never be committed. To revoke testing controls, remove the account UUID from that server allowlist and deploy; previously granted gold remains. This does not enable the global `ALLOW_DEV_TOOLS` flag.

Build 15 connects the crate collection to gameplay. Open **Crates & equipment** from the signed-in lobby or village menu to open earned crates, spend personal bank gold or shared crate credits, and choose the next run’s loadout. Each tier shows its exact pool, equal odds and duplicate return before opening. The server saves the result before a short reel animation; Skip and reconnect keep the same outcome.

The 19 random rewards include fitted armor, carrying utilities, the Mining Pack and Lumber Pack, starting kits and consumable Phoenix Ember charges. Permanent unlocks survive villages; equipment and bound starter supplies deploy once on a new run. Manual respawn forfeits current run gear. Lifetime credited nights earn crates every ten nights, with the Sunforged Viking Helm and Last Stand at 100. See [the crate rules](docs/CRATE-PROPOSAL.md) for prices, effects, loadouts and the 70% source-specific duplicate returns.

Build 14 addresses the interaction and reliability feedback. Click the world once to capture the mouse, then move it to look around; Escape releases it for menus. Hold left click to keep gathering the selected nearby node. Press **E** to mount/dismount your horse or put down a carried companion. Priests can heal injured living Watch guards and recruited troops. The treasury wall board has a wider reachable interaction area and a direct request-menu action.

Storage and cart panels preserve entered quantities across live updates and provide **Store max / Take max** using current inventory and free space. The bank adds **Deposit all / Withdraw all** and preserves typed amounts. New cart purchases count packed, stored and deployed carts toward one cart per resident. Existing extra carts are preserved, but additional purchases are blocked.

Workers continue through day and night. Productive gathering earns attribute points for gathering speed, travel speed and carrying capacity, and workers have eight selectable clothing colors. Owned timber/wheat farms and stone/iron/coal mines now upgrade through level 3. Player trading exchanges resources, food, arrows and wallet gold after both players confirm the latest terms. The Deepworks entrance has a more substantial carved stone portal, and gathering/repair sounds use varied profiles. [Updated mine geometry preview](docs/previews/cave-build14.jpg).

Connection recovery now uses heartbeats, bounded retry delays, resumable connection identity and fresh state baselines. Temporary connection loss is shown in the HUD; disconnected actions are not replayed. Server restarts still briefly interrupt play on the current single-service host.

The crate **art collection** supports the playable rewards: 19 crate item models plus the Sunforged Viking Helm, with fitted armor, distinct utility packs, three tool choices for expedition kits, and the Phoenix Ember. Open **`/crate-gallery.html`** on the game server to rotate each model, change lighting, or preview wearable pieces on a moving dwarf. The [collection sheet](docs/previews/crate-collection.jpg), individual PNG renders and reusable GLB files are included. See the [art guide](docs/CRATE-ART.md). The gallery is an art inspection tool; use Crates & equipment to open rewards and save loadouts.

Build 13 separates the **Resource Exchange**, north of the stables, from the **Village Treasury**. The exchange handles illustrated resource buying, selling, donations and communal supply-request deliveries. Each resource has **Sell max**, which sells the largest carried bundle the village can afford at the displayed price and tax while preserving its reserve. Typed quantities remain available. The treasury's illustrated vault focuses on savings, loans and accounts; worker hiring and council links remain there. Workers physically bring resource sales to the exchange. [Resource Exchange geometry](docs/previews/resource-exchange.jpg).

At your plot, browse one illustrated building plan at a time using the previous/next arrows. Each plan shows its purpose, materials, price, role requirements and current blockers; conversion still uses the existing confirmation. The nearby minimap follows your dwarf within a 42-meter surface radius or 25-meter cave radius. It draws colored landmarks, roads, resources and allies/enemies, names landmarks on hover, and points toward distant marked destinations. [Actual minimap preview](docs/previews/minimap.png).

Open-flame torches replace lanterns. Outdoor flames and warm light fade in at dusk and out at dawn; cave torches remain lit for navigation. The carriage's two torch holders appear with merchant visits, and shop illustrations use the same torch motif. Flame animation shares a small shader batch and six nearby lights without adding shadow maps. [Actual torch shader preview](docs/previews/torches.jpg).

Build 12 adds **the Deepworks**, a three-level mine entered from the northern village at the mountain base. All 44 public mineral nodes are inside it: 12 guaranteed-stone sites above, 16 mixed sites in the middle, and 16 deeper sites with more iron/coal. Deeper nodes roll a shared mineral type when they regrow after depletion. Exploration, camera height, horses, carts, workers, mining effects, footsteps and the minimap follow the cave's ramps. Owned private mines keep their existing behavior. [Cave geometry preview](docs/previews/cave.jpg).

Shops now display illustrated tools, weapons, food, backpacks, horses and merchant supplies against themed interiors with shopkeepers. Hover, keyboard focus, or **Inspect item** reveals useful stats and durability; the displayed purchase still uses the shop's actual price, recipe and stock. The physical request board uses pinned parchment cards with resource art and delivery controls. [Counter artwork preview](docs/previews/shop-counter.svg) and [actual UI fixtures](docs/previews/shop-ui.html) are available for review; the artwork preview is not a browser screenshot.

Build 11 refines the lifting gate with beveled timber, forged metal joints and moving chains, and fixes the well with thick inward-facing masonry. [Gate and well preview](docs/previews/gate-well.jpg). Read village requests by walking up to the treasury noticeboard and pressing **E**. The HUD/menu can mark the board on the map; requests for a particular delivery destination are available at that destination’s entrance.

Builds 11–14 prepared the crate proposal and artwork. Build 15 implements the expanded pools and reward mechanics described above.

Build 10 adds six zombie types, graveyard emergence, sword cleave and dodgeable enemy attacks. Players and guards can strike multiple zombies in a forward arc; a short blade trail and swoosh follow the swing. Red ground circles mark enemy attacks before impact. The large Brood husk releases up to three weak Grave mites when killed, subject to the 120-enemy battlefield limit, and a Gravebreaker leads every fifth night. Archer towers now fire without ammunition, including existing empty towers; bows and cannons still need their normal supplies.

Read steward-funded deliveries at the board on the treasury wall. Press **R** to command your own barracks troops to defend, hold your current position, follow, or retreat. The village menu includes **Honors & appearance** and the optional **First-watch guide**. Surviving credited nights unlocks permanent cosmetic colors and crests. New footsteps, village ambience, zombie cues and the dusk bell share the saved Game sound setting.

Grass clumps, ferns, wildflowers, shrubs, clover, fallen leaves and small patches of wall ivy give the village and woodland more detail. Plants sway in a breeze, with clear roads, doors, plots and gathering approaches. The sky now has drifting cloud layers, a sun that rises and sets, a visible moon and stars, and warm dawn/dusk lighting. It follows the village’s actual clock, including joining mid-cycle and pausing. Mouse look can look upward to follow the sky. [Sky cycle preview](docs/previews/sky-cycle.jpg).

Mineral seams sit in the cave floor and walls, with loose fragments around each deposit. Trees react and fall when exhausted; mineral deposits chip and crumble as they are mined. Horses have sculpted, articulated models and share the rendered rider transform while mounted. Sword grips follow the hand. Routine successful strikes, gathering and repairs no longer produce pop-ups; other notices sit in a corner. Downed players can rotate the camera while deciding whether to wait for a rescue.

Buildings now offer services at their front doors or shop counters. Player businesses use their actual building entrance; open plots, farms and mines use the frontage gate. The server checks the same access points for purchases and storage. Church care remains available beside the beds. Atlas markers lead to these entrance points. The visiting merchant appears at The Wayfarer with a covered carriage and two horses, and leaves when the visit ends.

Walking and running now use independent hip, knee, ankle and elbow movement, coordinated shoulder rotation, and smoother transitions. Boots and trousers deform with the joints; zombies retain a slower uneven gait. Road edging is trimmed where paths meet.

Oak & Iron sells backpack upgrades with visible, tier-specific packs worn on the dwarf’s back. New residents enter each run empty-handed with 10 gold, enough for one wooden tool; reconnecting preserves their existing gear and money. The Resource Exchange accepts a typed resource quantity or Sell max with the exact tax and total shown before purchase or sale. Guard shields, priest health and villager carrying bonuses distinguish the three jobs. Fallen recruited troops return after 30 active seconds when their barracks has wheat. Archer towers fire without ammunition and report why they are firing or idle; cannons consume stone and coal.

Actual mesh previews: [sword sweep](docs/previews/sword-trails.jpg), [zombie varieties](docs/previews/zombie-variety.jpg), [graveyard emergence](docs/previews/zombie-emergence.jpg), [visiting merchant](docs/previews/merchant-visit.jpg), [horse](docs/previews/horse.jpg), [mineral beds](docs/previews/mineral-beds.jpg), [sword grip](docs/previews/sword-grip.jpg). These show the game geometry under preview lighting; they are not live gameplay captures.

## Integrated map and systems

| Area | Playable behavior |
| --- | --- |
| Full map | Forty internal plots, eight exposed plots, connected neighborhood lanes, woodland, wheat fields, three connected cave levels for public stone and ore, permanent services, and the single gate/graveyard approach. The Watch faces the street and its guards leave from that entrance. |
| Ownership | Up to eight plots per resident, one building per plot, construction and conversion, stored supplies, visitor harvesting permissions, and an accumulated 80/20 harvest split. |
| Player businesses | Tool shops, sword shops, and tinker shops craft from actual shop storage and pay their owner. Mines, tree farms, wheat farms, and houses provide owned land uses and storage. |
| Progression | Wood/stone/iron equipment, iron and coal nodes, bows and arrows, tool durability, eight configurable hotbar slots, weighted carrying, and three food tiers. |
| Village economy | Stock-priced resource buying/selling, finite treasury reserves, transaction and land taxes, participation-based dawn wages, performance pay, merchant exports, and votes reviewed by the steward. |
| Care and defense | Owned barracks and recruitment, troop wheat supplies, ammunition-free archer towers, cannons supplied with stone and coal, upgrades and repairs, carrying downed dwarfs, and paid church-bed healing/revival. |
| Transport and banking | Stable restocking, owned riding horses, cargo carts, protected account savings, restricted purchase loans, and repayments from earnings. |
| Existing foundation | Eight-resident multiplayer, three roles, persistent villages, empty-village pause, chat and overhead bubbles, hunger HUD, escalating zombie nights, and manual dawn respawn. |

Build 02 added hunger visibility, resource selling and movement/orientation improvements. Build 03 added village chat and improved quarry access. Build 04 retains those features and upgrades existing saved villages without a database reset.

## Run on your computer

Install a current **Node.js 24** release from [nodejs.org](https://nodejs.org/en/download). This server uses Node's built-in SQLite module. Open a terminal or Windows PowerShell inside this project's folder:

```sh
npm ci
npm start
```

Open **http://localhost:3000** in a desktop browser with WebGL support. Keep the terminal open while playing. Stop the server with Ctrl+C. To restart while developing server files, use `npm run dev`.

Create an account, create or join a village, and select Guard, Priest, or Villager. These accounts belong to this game, independently of the existing website's accounts.

## Starting a village

A village starts with 20,000 treasury gold, 60 timber, 40 stone, 40 wheat, and two public watch guards with 12 wheat in their barracks. A new resident receives 10 wallet gold once per village run, with no tools, weapons, food or backpack. Rejoining never grants more. Visit Oak & Iron to choose the first wooden tool; existing residents retain their earned inventory and wallet. Join a village, gather and trade supplies, buy a plot, and establish the businesses and defenses the residents need.

Each account has one active village. Its resident place, plots and stored property remain reserved while offline. Villages hold eight saved residents, including offline members; a single player can start alone. When nobody is online, the simulation pauses. Eight-minute days alternate with nights lasting up to four minutes, and zombie difficulty grows every five nights. Defeating the entire spawned wave, including splitter offspring, starts dawn early; gaps between scheduled spawns do not. The keep’s destruction ends the run.

Job changes preserve land and universal buildings. Changing away from Guard removes owned barracks and sword shops; changing away from Priest removes owned churches. The game requires confirmation and requires stores and treatment beds to be clear before removing buildings. Earned wages accrue under the role actually held at the time, so switching roles does not duplicate a cycle’s pay.

## Current balance settings

These are tunable implementation values, not a claim that the economy is already balanced.

| System | Current setting |
| --- | --- |
| Land | Eight plots maximum per resident, including exterior plots; successive deeds cost 100 / 200 / 350 / 550 / 800 / 1,100 / 1,450 / 1,850 gold. |
| Land tax | Default daily total is `2 × owned plots²` gold, prorated for active participation and rounded up. A council policy can change the base. Unpaid tax becomes in-run arrears; offline-only cycles do not accrue it. |
| Carrying | Guards and priests start at 100 weight; villagers at 150. Oak & Iron backpacks add 100 / 250 / 400 capacity for 40 / 100 / 200 gold. Upgrading replaces the previous bag and charges the full listed price. Weight includes usable equipped tools. Timber weighs 2, stone/iron 3, wheat/food 1, coal 2, arrows 0.1, and a packed cart 12. |
| Role bonuses | Guard: 40 shield, regenerating 4/second after six seconds without damage; Priest: 125 max HP; Villager: +50 carrying capacity. Role changes preserve health percentage and do not refill shields. |
| Public mining | Upper: 12 stone sites. Middle: 16 sites rolling 40% stone / 30% iron / 30% coal. Deep: 16 sites rolling 20% stone / 40% iron / 40% coal. Eight successful swings deplete a mineral node; its existing regrowth timer then triggers a fresh shared roll. |
| Tools | Wood / stone / iron yield 1 / 2 / 3 resources per successful swing with 100 / 150 / 200 durability. Swing speed and resource access are the same across tiers. Wooden replacements cost 10 gold and require no materials. |
| Crafting | Stone/iron tools require a stocked player tool shop. All crafted sword tiers require materials; sword damage is 10 / 15 / 20 at the same attack speed. Tinker shops make bows, arrows, and carts. |
| Repairs | Hammers restore up to 35 / 55 / 80 health. Gate repair consumes one village timber; keep and plot repair consume one timber and one stone. Valid repair swings earn one gold, capped at ten per cycle and paid at dawn. |
| Food | Food / good food / best food restore 25 / 60 / 100 hunger when eaten and consume 2 / 4 / 6 village wheat when bought. Prices follow the wheat value plus a preparation fee. |
| Wages | Guard and Priest each start at 25 gold per active 12-minute cycle, accrued by role and participation, funded by the treasury, and paid at dawn. Priest service pay adds up to 25; repair pay and immediate zombie bounties are separate. |
| Zombie bounties | Every role earns 100 gold per kill or positive-damage assist, including owned towers and troops. One full payment per contributing player per zombie; paid immediately, with no nightly cap. Normal loan repayments apply. |
| Priest performance | Priests receive one gold per 50 meaningful HP healed and five per eligible revival, within the 25-gold cycle cap. |
| Field care | Priest healing channels for two seconds and restores 30 HP. Revival channels for five seconds and restores 45 HP. |
| Church beds | Two beds, upgradeable to four. Healing costs eight gold for ten seconds; revival costs twenty gold for twenty seconds and returns the dwarf at 45 HP. |
| Barracks | At most two per Guard, three recruited slots each, counting living and pending replacements. Recruitment costs 35 gold plus five timber and two iron in barracks storage. Each troop consumes one wheat per night; unfed troops deal 25% less damage. A fallen recruited guard returns after 30 active seconds for one stored wheat, which covers that night’s ration. Empty wheat storage delays replacement. The public Watch follows the same replacement rule. |
| Towers | All archer towers fire without ammunition and grant no starter arrows. Existing stored arrows remain cargo. Cannons consume one stored stone and one coal per shot. Both defense types need repairs and can be upgraded. |
| Horses | Stable capacity three. When empty, the steward can buy horses from the visiting merchant for 50 gold each; residents pay 100 gold. One owned horse per resident in the run. |
| Carts | One cart per resident across packed, owned storage and deployed forms; 300 cargo weight in owner-controlled storage. Attach it to your horse for hauling. |
| Loans | At most 1,000 outstanding debt per account, an 8,000-gold lending ceiling per run, and a 1,000-gold treasury floor for new loans. Credit can fund approved purchases; it cannot be banked or withdrawn. Twenty percent of cumulative earnings repays debt, up to the remaining balance. |

Horses and deployed carts remain in the current village when their owner disconnects. Riding ends safely on disconnect or downing. A cart caught behind an obstacle detaches with its contents intact. Their current persistence is within the run; personal savings, outstanding debt and unused purchase credit follow the account into later runs.

## Trading and village decisions

At the Resource Exchange, resource prices rise with scarcity and fall with surplus. Type a whole quantity to trade a custom bundle, up to the stock, inventory, weight and funds available (10,000 units per request maximum). Each bundle is priced unit by unit. The server checks the quoted maximum purchase price or minimum sale payment before transferring anything; insufficient stock, money, or capacity rejects the whole trade. Purchases from players preserve 500 treasury gold for essentials. The starting trade tax is 5%; buying and selling use a two-gold unit spread before tax.

The traveling merchant visits on day 3 and every second morning after that, staying for the day. Each visit selects two limited specialist wares from iron, coal, and arrows and discounts them 20–30 percent. The steward never imports wheat, timber, or stone. After setting aside food and repair reserves, it exports 25% of each surplus under Conserve, 50% under Balanced, or 100% under Trade, rounded down to whole units without a fixed unit cap. Conserve also doubles the usual reserves. Exports earn one treasury gold per wheat and two per timber or stone. An empty stable may be restocked when affordable. Night-survival grants go directly to the treasury rather than the player reward feed: 1,000 gold after night 1, 2,000 after night 2, and 1,000 more for each subsequent night, capped at 5,000 gold for one defended night. The reward uses the village's completed night number, including in existing runs, and is independent of player count.

Residents can propose wages, taxes, and export policy at the treasury or keep. A majority of the residents active when the vote opens sends the proposal to the steward. Its rules examine demand, wages plus service income, reserves, repairs and affordability; it explains an approval or veto. Approved changes are reviewed again at the next dawn before taking effect. A vote without a majority keeps the current policy. The steward is deterministic game logic and needs no external AI service.

Bank savings are personal and separate from village funds. Loans create restricted purchase credit, not wallet gold. Credit is valid for land, construction, purchases from another player’s equipment shop, wooden tools, backpacks, and horses. It cannot finance buying from your own shop, ordinary transfers, or depositing money into savings. Debt and unused credit persist across runs; no one’s private savings fund public loans. Voluntary repayment uses wallet gold at the treasury.

## Enemy attacks and village cooperation

| Enemy | Behavior |
| --- | --- |
| Shambler | Standard slow zombie with a small telegraphed strike. |
| Grave runner | Faster, less durable attacker with a short warning. |
| Ironbound | Armored enemy with a recognizable helmet and reduced incoming damage. |
| Brood husk | Large zombie with a wide slam; releases up to three weak Grave mites on death, within the battlefield limit. |
| Grave mite | Small, weak offspring. Cannot split again. |
| Gravebreaker | A larger siege enemy on every fifth night, with a slow, wide slam and heavy structure damage. |

Graveyard spawns take 2.2 seconds to climb free before moving or attacking. Split offspring take 0.65 seconds to settle at the parent's death site. Once every scheduled enemy and split offspring is defeated, the night ends early and dawn pays accrued wages, bonuses and the survival grant once. Wages accrue at the same per-second rate, so a shorter night does not grant a full twelve-minute wage. If the four-minute deadline arrives first, dawn stops new spawns while existing zombies remain to be defeated. Attack circles lock to the ground when the windup starts; damage checks the defenders still inside at impact, with obstruction checks. Leaving the red circle lets you dodge. Sword cleave covers a 120-degree forward arc, with 3.2 m reach for players and 2.6 m for NPC guards. Each player swing consumes durability once, and each defeated zombie grants its eligible credit once. Bows remain single-target.

The noticeboard posts real shortages in communal food/repair stock, public barracks wheat and cannon supplies. At most four requests and 300 reserved gold are committed per day, with up to 24 units per request. It preserves 500 treasury gold plus two active payroll cycles before funding deliveries. Bring a chosen partial quantity to the marked entrance; communal stock requests now turn in at the Resource Exchange, while barracks and cannon requests stay at their own entrances. Payment uses the normal loan-repayment rules. Ordinary donations or sales can fill a need without an extra bounty. Expired, superseded and fallen-village requests refund unused escrow; withdrawing supplies cannot manufacture a new rewarded shortage.

Owned barracks support Defend the gate, Hold here, Follow me and Retreat to barracks. Hold captures the owner's actual current position. Troops follow the existing roads and gate, respect obstacles and stay within their order's fighting area. A following troop retreats when its owner is unavailable or unreachable, and replacements inherit the barracks order. The public Watch remains independent.

New accounts receive a compact optional guide covering their first tool, gathering, selling, food and finding the gate. Dismiss or reopen it from the village menu. Account honors unlock at 1, 5, 10 and 20 credited nights across runs; a credit requires being online and alive for at least half of an actually survived night. Cosmetic sashes and crests persist across runs. Earned colors can decorate owned buildings at their entrances, and the founder can choose the keep banner at the keep entrance. These choices affect appearance only.

## Hired workers

Visit the treasury to hire up to five workers per resident for 75 wallet gold each. Open **Workers** from the treasury or your inventory to choose wheat, timber, stone, iron or coal, select public resources or one of your matching production plots, and order delivery to one of your buildings or automatic sale at the Resource Exchange. Other residents’ private plots cannot be assigned.

A new worker gathers one unit per harvest on public or level 1 sites, two on level 2 sites, and three on level 3 sites, before seasonal/event bonuses. Each harvest initially takes four seconds; the worker travels between the actual resource and destination and carries up to 40 weight. Tools are included in the contract. Pay is one owner-wallet gold per 30 seconds of work, prepaid in small installments; bank savings and purchase credit are never charged. Workers work day and night while anyone is online in their village, including while their employer is offline and near enemies. They finish prepaid time and stop when the owner cannot fund the next wage. Manual pause calls them home; an empty village freezes all crews without spending wages. Returning and waiting for resources, storage, or affordable sales do not incur wages.

Sales use current stock prices, tax, the treasury’s emergency reserve and normal loan repayments. Full or unavailable storage and an underfunded treasury leave cargo with the worker. You can collect cargo beside the worker, change orders, pause/resume, or dismiss an empty worker at the treasury without a refund. Workers and their orders persist within the village run. Fallen villages disappear from the selection list; account savings remain available in the next run.

Every 25 successful harvests earns one upgrade point, up to 15 points total. Each of the three attributes accepts five points: gathering reduces the work interval by 0.4 seconds per point (4 to 2 seconds); movement adds 0.3 m/s per point (3 to 4.5 m/s); carrying adds 10 weight per point (40 to 90). The Workers panel shows progress, spent/available points and eight free clothing colors. Existing workers begin with zero earned points and retain their orders, cargo and prepaid wages.

## Production upgrades

Upgrade an owned mine, tree farm or wheat farm at its entrance, using wallet gold and materials from its storage first, then your pack. Each paid upgrade preserves the original harvest anchors and spent harvests: active nodes gain only their additional reserve, and depleted nodes retain depletion with a proportionally shorter remaining regrowth time. Rejoining or restarting does not refill deposits. Visitor harvests still split the full boosted output 80/20 with the owner.

| Benefit | Level 1 | Level 2 | Level 3 |
| --- | ---: | ---: | ---: |
| Yield added to each player tool swing | 0 | +1 | +2 |
| Worker yield per completed harvest | 1 | 2 | 3 |
| Harvests per wheat / timber / mineral node | 1 / 5 / 8 | 2 / 8 / 12 | 3 / 10 / 16 |
| Private-site regrowth time | 100% | 75% | 50% |
| Storage capacity | 1,500 | 2,000 | 3,000 |
| Building health compared with level 1 | 100% | 150% | 200% |

| Upgrade | Gold | Materials |
| --- | ---: | --- |
| Wheat farm → level 2 | 80 | 20 timber, 15 stone, 3 iron |
| Wheat farm → level 3 | 180 | 40 timber, 30 stone, 8 iron |
| Tree farm → level 2 | 100 | 25 timber, 20 stone, 5 iron |
| Tree farm → level 3 | 220 | 50 timber, 40 stone, 12 iron |
| Mine → level 2 | 150 | 30 timber, 30 stone, 10 iron |
| Mine → level 3 | 300 | 60 timber, 60 stone, 25 iron |

Defense and care upgrades retain their existing level 2 rules. Cards show building health +50%, barracks troops 160→220 health and 14→18 damage, church beds 2→4, archer damage 20→30 and cannon damage 48→72. Upgraded structures gain additional stonework, braces or fixtures; recruited troops gain a fitted veteran armor kit. Cannon bursts are cosmetic and do not apply another damage hit.

## Village investments

At the treasury, invest 1–1,000,000 wallet gold per action, up to 1,000,000,000 principal per resident in that village. Contributions enter the village treasury immediately. New contributions and reinvested earnings skip their first dawn: a contribution during day 1 first becomes eligible at the dawn following day 2. Fully eligible principal has a potential **1% daily dividend**, carrying fractional gold forward.

After normal dawn income and payroll, available treasury gold above the existing emergency reserve funds dividends. If the village cannot pay the full amount, the available pool is split proportionally; ties rotate between days. An underfunded day's unpaid whole-gold portion is not a debt owed by the village. Funded dividends leave the spendable treasury and remain held in your separate earnings balance. **Collect earnings** moves them to your wallet; **Reinvest earnings** returns them to the treasury as new principal with fresh eligibility.

Principal can be withdrawn only to the extent the current treasury can preserve its reserve. These investments belong to the village run, not your persistent account bank. A fallen village closes new investments, claims and withdrawals; collect or withdraw beforehand to carry gold away. Ordinary bank savings remain independent. The UI shows eligible/pending principal, first eligible day, previous dividend, withdrawal availability and projected fully eligible income.

## The Wayfarer tavern

Visit The Wayfarer entrance at any time, even while its traveling merchant is away. Bet 1–1,000 **wallet gold** on the illustrated coin or roulette table. The server resolves and saves each result before the reveal animation; Skip or reduced motion reveals the same saved result.

| Game / bet | Winning chance | Total returned on a win | Net profit on a win |
| --- | --- | --- | --- |
| Coin flip: heads or tails | 1/2 | 2× stake | 1× stake |
| European roulette: one number, 0–36 | 1/37 | 36× stake | 35× stake |
| Roulette: red, black, even or odd | 18/37 | 2× stake | 1× stake |

Zero loses all outside roulette bets. A lost stake goes to the village treasury; a win pays the net profit from that treasury. Before accepting any stake, the treasury must cover the maximum possible win while preserving its emergency reserve. Bank savings, loans and investment earnings are not wagered. The interface distinguishes total return, profit, loss and currently affordable stakes.

Investment and tavern actions have durable, authenticated per-resident receipts. Repeated requests return the original receipt, including old results outside the recent history list. A reconnect, lost response or repeated click cannot repeat the same payment. Failed database writes roll back the wallet, treasury, position and receipt together.

## Player trading

Open **Trade** from the village menu while standing within four meters of another player. Invite them, accept the invitation, and set each side's resources and wallet gold. Both players must confirm the same offer version; changing either offer clears both confirmations. The exchange checks current quantities, gold and resulting pack weights immediately before transferring anything. Cancellation, disconnect, downing or moving out of range ends the trade without transferring resources. Equipment, carts, savings and purchase credit are not exchangeable.

## Controls

| Input | Action |
| --- | --- |
| W / A / S / D | Walk, or ride while mounted. |
| Shift | Sprint while hunger allows. |
| Mouse movement | After clicking the world to capture the pointer, turn the camera without holding a button. |
| Left mouse | Use the selected weapon, tool, food, or blessing. Hold to repeat gathering on the same node. |
| 1–8 / mouse wheel | Select a configured hotbar slot. |
| E | Mount/dismount your horse, put down a carried companion, or interact with the nearby resource, noticeboard, service, plot or cart. |
| I | Open your pack, equipment and hotbar setup. |
| M | Open the village atlas and mark a destination. |
| R | Command troops belonging to your own barracks. |
| G | Put down a carried companion, leave a church bed, or dismount. |
| Enter | Focus chat; send the typed message. |
| T | Toggle village chat. |
| H | Open controls and help. |
| F | Toggle fullscreen. |
| Escape | Release mouse capture, close the active panel or open the village menu. Click the world to resume mouse look. |

Use an axe on trees, a pickaxe on stone/iron/coal inside the northern mountain mine, and a scythe on individual wheat stalks. Open the atlas to mark the mine entrance; underground, follow the local cave map and torches to return. Higher tier tools increase the resource count, not gathering speed. A matching resource takes priority over a nearby building menu. Equip a weapon or step away from the resource when you want the service instead.

Chat is village-only, limited to 240 characters and one message per second. Messages appear briefly above dwarfs; a typing indicator does not reveal unfinished draft text. Chat input suspends game controls. The latest thirty messages are held in server memory for reconnecting residents, without writing chat to saved games.

## Playtest the complete loop

1. Join the same village with two separate accounts in different browsers. Confirm synchronized gathering and chat, then use the atlas to find plots and permanent services.
2. Trade supplies, buy land, and build a stocked tool shop. Have the other account buy a stone or iron tool and verify its yield, durability, storage cost and payment.
3. Build a production plot, allow visitors, and gather enough resources to observe the accumulated owner share. Load stores or a cart when your pack fills.
4. Recruit and feed barracks troops; build an archer tower without ammunition and supply a cannon with stone and coal. Defend the single gate, repair damage, and inspect combined wages and bonuses at dawn.
5. Carry a downed dwarf to a church bed or revive them in the field. Dawn enables manual respawn without interrupting a rescue; choosing respawn loses all carried inventory, tools, weapons, the backpack and 25% of wallet gold. Respawn grants no free replacement gear; bank savings or approved purchase credit can fund a new tool.
6. Try a policy proposal and inspect the steward’s reason. On a merchant morning, check surplus exports and stable stock, then ride and haul a cart.
7. Deposit wallet gold, use approved purchase credit, and verify that debt, unused credit and protected savings survive a server restart. Check that all-offline villages remain paused.

These are checks to perform on actual desktop browsers and the hosted service. They do not mean every visual, performance and end-to-end multiplayer path has already passed a live playtest.

## Local night testing

Optional development controls let you test a night without waiting through the full day. They are **disabled by default**. Enable them only on an isolated local test server:

Windows PowerShell:

```powershell
$env:ALLOW_DEV_TOOLS = "true"
npm start
```

macOS/Linux:

```sh
ALLOW_DEV_TOOLS=true npm start
```

Remove the variable or set it to `false` before public hosting. Development controls must not be enabled on a village where normal progression matters.

## Configuration and saves

| Setting | Local default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP and WebSocket port; Railway supplies its own runtime value. |
| `DATA_DIR` | `./data` | Directory containing `emberwatch.sqlite` and its SQLite sidecar files. |
| `ALLOW_DEV_TOOLS` | Disabled | Enables local testing shortcuts when explicitly set to `true`. |
| `NODE_ENV` | Unset locally | The Docker image sets this to `production`. |

The game runs its authoritative simulation in one Node process. Use **one service replica** for this service. Multiple replicas would run different in-memory worlds and require a different coordination and persistence design.

Existing databases migrate in place: account savings are preserved, loan fields are added, and saved villages receive the expansion state without restarting the run. Do not delete the Railway volume or database to install this update. Preserve the entire data directory. For a manual backup, stop the application cleanly before copying it; do not copy only the main database file while the server is writing to it. Keep test databases separate from real player saves. The included ignore files exclude local saves and environment files from normal Git commits and Docker builds.

Account passwords are salted and hashed with scrypt; the database stores hashed session tokens. This is an initial account system, with no email recovery or shared website login. General account administration, operational monitoring, restore drills, and broader abuse/load testing remain work for a public release; Build 16 only adds the restricted testing-funds capability described above.

## Deploy as a separate Railway service

The project is available in [TylerOusley/emberwatch](https://github.com/TylerOusley/emberwatch). Tyler has deployed it on Railway at [bobbybgames.com](https://www.bobbybgames.com). For a new deployment, use these settings:

1. Use the `TylerOusley/emberwatch` repository with this project at its root. Keep `package-lock.json`, `Dockerfile`, `public`, `server`, and `shared` in the repository. Do not upload your local `data` directory.
2. In Railway, create a new service from that repository. Use the root `Dockerfile` to build it. Clear any old Python start-command override, or set **`node server/index.js`**. The container runs `node server/index.js`; there is no separate frontend build command.
3. Attach a persistent volume to this new service at **`/data`**, then set **`DATA_DIR=/data`**. The application creates its database when it starts. Railway volumes are mounted at runtime, so this must not be moved into a build or pre-deploy command. [Railway volumes](https://docs.railway.com/volumes)
4. Keep one replica, leave `ALLOW_DEV_TOOLS` unset or set it to `false`, and use **`/health`** as the deployment healthcheck. Let the service use Railway's `PORT`. [Railway healthchecks](https://docs.railway.com/deployments/healthchecks)
5. Generate a public domain for the new service. Once it is running, visit its HTTPS URL and repeat the two-player and restart checks above.
6. Add a link from your existing website's game-selection page to that URL. The new game runs independently; it does not need to be merged into the old game code or share its database.

The included `railway.json` expresses the Docker build and healthcheck settings for Railway's legacy Config as Code format. Railway currently documents that format as deprecated, so configure the service settings above directly if a new service does not accept it; the root Dockerfile remains the build definition. [Railway configuration reference](https://docs.railway.com/config-as-code/reference)

Expect a brief interruption when deploying an update to this single-service, volume-backed prototype. Players should reconnect after the service resumes; a healthcheck does not make an active multiplayer match transfer seamlessly between server processes. Railway documents a brief redeploy interruption for attached volumes. [Railway healthchecks and volumes](https://docs.railway.com/deployments/healthchecks)

## Project layout

| Path | Responsibility |
| --- | --- |
| `public/` | Browser interface, 3D world, characters, input, and rendering. |
| `server/` | HTTP/WebSocket server, authoritative simulation, accounts, and saving. |
| `shared/world.js` | Static map, forty internal/eight exterior plots, resource locations, access routes and collision geometry. |
| `shared/content.js`, `shared/defense.js`, `shared/economy.js`, `shared/transport.js` | Equipment, recipes, construction costs, care/defense, policies, food and transport balance. |
| `server/ownership.js`, `server/economy.js`, `server/care-defense.js`, `server/transport.js` | Authoritative expansion actions and simulation hooks. |
| `public/src/settlement-ui.js`, `public/src/plots-world.js`, `public/src/transport-world.js` | Services, plot management and atlas UI, owned-building art, horses and carts. |
| `test/` | Automated checks for gameplay, persistence, permissions, and economy behavior. |
| `docs/DESIGN.md` | Accepted design, provisional balance values, and remaining milestones. |
| `Dockerfile` | Standalone Node 24 runtime for Railway or local Docker. |

Run the automated checks with `npm test`. Browser performance and visual quality should also be checked on the actual computers that will play the game.

### Windows shortcut

After installing Node.js 24 or newer and extracting this folder, double-click `START-WINDOWS.cmd`. The launcher installs the pinned dependencies on the first run, starts the game server, and prints the local address. Open `http://localhost:3000` in a browser and keep the terminal window open while playing.

### Art and dependencies

The village geometry, characters, animations, interface, and gameplay code were created for Emberwatch. No code from the existing games was copied. Build 18 surface textures are Poly Haven CC0 assets; the lunar map comes from NASA SVS. Their source and license records are linked above. Cinzel and DM Sans font files are bundled locally under the included SIL Open Font License notices in `public/fonts/`. Three.js and ws are installed through npm under their package licenses. The game makes no runtime CDN requests for fonts, rendering code or scenery textures.

See `docs/VALIDATION.md` for the checks performed on this build.
