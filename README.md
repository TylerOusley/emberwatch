# Emberwatch

An original cooperative 3D dwarf village survival game. **Emberwatch is a working title.** This standalone project does not import or depend on code from Tyler’s other games.

**First Light — playtest feedback build 11.** This build expands the village into the full 48-plot map and connects ownership, crafting, the treasury economy, defenses, care, and transport. The original three roles remain Guard, Priest, and Villager. The accepted rules and current balance choices are recorded in [docs/DESIGN.md](docs/DESIGN.md).

The approved gameplay systems described below have playable implementations. This is their first combined playtest build: visual refinement, economy tuning, long-run balance, accessibility, and sustained multiplayer performance still need testing. Automated checks and their limits are recorded in [docs/VALIDATION.md](docs/VALIDATION.md).

## Latest playtest improvements

Build 11 refines the lifting gate with beveled timber, forged metal joints and moving chains, and fixes the well with thick inward-facing masonry. [Gate and well preview](docs/previews/gate-well.jpg). Read village requests by walking up to the treasury noticeboard and pressing **E**. The HUD/menu can mark the board on the map; requests for a particular delivery destination are available at that destination’s entrance.

The proposed crates, functional armor and 100-night gold helmet are **not implemented**. Their prices, suggested items and open balance questions are recorded separately in [the crate proposal](docs/CRATE-PROPOSAL.md) for review.

Build 10 adds six zombie types, graveyard emergence, sword cleave and dodgeable enemy attacks. Players and guards can strike multiple zombies in a forward arc; a short blade trail and swoosh follow the swing. Red ground circles mark enemy attacks before impact. The large Brood husk releases up to three weak Grave mites when killed, subject to the 120-enemy battlefield limit, and a Gravebreaker leads every fifth night. Archer towers now fire without ammunition, including existing empty towers; bows and cannons still need their normal supplies.

Read steward-funded deliveries at the board on the treasury wall. Press **R** to command your own barracks troops to defend, hold your current position, follow, or retreat. The village menu includes **Honors & appearance** and the optional **First-watch guide**. Surviving credited nights unlocks permanent cosmetic colors and crests. New footsteps, village ambience, zombie cues and the dusk bell share the saved Game sound setting.

Grass clumps, ferns, wildflowers, shrubs, clover, fallen leaves and small patches of wall ivy give the village and woodland more detail. Plants sway in a breeze, with clear roads, doors, plots and gathering approaches. The sky now has drifting cloud layers, a sun that rises and sets, a visible moon and stars, and warm dawn/dusk lighting. It follows the village’s actual clock, including joining mid-cycle and pausing. Right-drag can look upward to follow the sky. [Sky cycle preview](docs/previews/sky-cycle.jpg).

Natural mineral beds replace scattered boulders. Trees react and fall when exhausted; mineral deposits chip and crumble as they are mined. Horses have sculpted, articulated models and share the rendered rider transform while mounted. Sword grips follow the hand. Routine successful strikes, gathering and repairs no longer produce pop-ups; other notices sit in a corner. Downed players can rotate the camera while deciding whether to wait for a rescue.

Buildings now offer services at their front doors or shop counters. Player businesses use their actual building entrance; open plots, farms and mines use the frontage gate. The server checks the same access points for purchases and storage. Church care remains available beside the beds. Atlas markers lead to these entrance points. The visiting merchant appears at The Wayfarer with a covered carriage and two horses, and leaves when the visit ends.

Walking and running now use independent hip, knee, ankle and elbow movement, coordinated shoulder rotation, and smoother transitions. Boots and trousers deform with the joints; zombies retain a slower uneven gait. Road edging is trimmed where paths meet.

Oak & Iron sells backpack upgrades with visible, tier-specific packs worn on the dwarf’s back. New residents enter each run empty-handed with 10 gold, enough for one wooden tool; reconnecting preserves their existing gear and money. The treasury accepts a typed resource quantity with the exact tax and total shown before purchase or sale. Guard shields, priest health and villager carrying bonuses distinguish the three jobs. Fallen recruited troops return after 30 active seconds when their barracks has wheat. Archer towers fire without ammunition and report why they are firing or idle; cannons consume stone and coal.

Actual mesh previews: [sword sweep](docs/previews/sword-trails.jpg), [zombie varieties](docs/previews/zombie-variety.jpg), [graveyard emergence](docs/previews/zombie-emergence.jpg), [visiting merchant](docs/previews/merchant-visit.jpg), [horse](docs/previews/horse.jpg), [mineral beds](docs/previews/mineral-beds.jpg), [sword grip](docs/previews/sword-grip.jpg). These show the game geometry under preview lighting; they are not live gameplay captures.

## Integrated map and systems

| Area | Playable behavior |
| --- | --- |
| Full map | Forty internal plots, eight exposed plots, connected neighborhood lanes, woodland, wheat fields, stone and ore gathering, permanent services, and the single gate/graveyard approach. The Watch faces the street and its guards leave from that entrance. |
| Ownership | Up to five plots per resident, one building per plot, construction and conversion, stored supplies, visitor harvesting permissions, and an accumulated 80/20 harvest split. |
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
| Land | Five plots maximum per resident, including exterior plots; successive deeds cost 100 / 200 / 350 / 550 / 800 gold. |
| Land tax | Default daily total is `2 × owned plots²` gold, prorated for active participation and rounded up. A council policy can change the base. Unpaid tax becomes in-run arrears; offline-only cycles do not accrue it. |
| Carrying | Guards and priests start at 100 weight; villagers at 150. Oak & Iron backpacks add 100 / 250 / 400 capacity for 40 / 100 / 200 gold. Upgrading replaces the previous bag and charges the full listed price. Weight includes usable equipped tools. Timber weighs 2, stone/iron 3, wheat/food 1, coal 2, arrows 0.1, and a packed cart 12. |
| Role bonuses | Guard: 40 shield, regenerating 4/second after six seconds without damage; Priest: 125 max HP; Villager: +50 carrying capacity. Role changes preserve health percentage and do not refill shields. |
| Tools | Wood / stone / iron yield 1 / 2 / 3 resources per successful swing with 100 / 150 / 200 durability. Swing speed and resource access are the same across tiers. Wooden replacements cost 10 gold and require no materials. |
| Crafting | Stone/iron tools require a stocked player tool shop. All crafted sword tiers require materials; sword damage is 10 / 15 / 20 at the same attack speed. Tinker shops make bows, arrows, and carts. |
| Repairs | Hammers restore up to 35 / 55 / 80 health. Gate repair consumes one village timber; keep and plot repair consume one timber and one stone. Valid repair swings earn one gold, capped at ten per cycle and paid at dawn. |
| Food | Food / good food / best food restore 25 / 60 / 100 hunger when eaten and consume 2 / 4 / 6 village wheat when bought. Prices follow the wheat value plus a preparation fee. |
| Wages | Guard and Priest each start at 25 gold per active 12-minute cycle, accrued by role and participation, funded by the treasury, and paid at dawn. Performance pay adds up to 25; repair pay is separate. |
| Job performance | Guards receive kill or meaningful-assist credit, including owned defenders while the owner is online. Priests receive one gold per 50 meaningful HP healed and five per eligible revival, within the cycle cap. |
| Field care | Priest healing channels for two seconds and restores 30 HP. Revival channels for five seconds and restores 45 HP. |
| Church beds | Two beds, upgradeable to four. Healing costs eight gold for ten seconds; revival costs twenty gold for twenty seconds and returns the dwarf at 45 HP. |
| Barracks | At most two per Guard, three recruited slots each, counting living and pending replacements. Recruitment costs 35 gold plus five timber and two iron in barracks storage. Each troop consumes one wheat per night; unfed troops deal 25% less damage. A fallen recruited guard returns after 30 active seconds for one stored wheat, which covers that night’s ration. Empty wheat storage delays replacement. The public Watch follows the same replacement rule. |
| Towers | All archer towers fire without ammunition and grant no starter arrows. Existing stored arrows remain cargo. Cannons consume one stored stone and one coal per shot. Both defense types need repairs and can be upgraded. |
| Horses | Stable capacity three. When empty, the steward can buy horses from the visiting merchant for 50 gold each; residents pay 100 gold. One owned horse per resident in the run. |
| Carts | One deployed cart per resident; 300 cargo weight in owner-controlled storage. Attach it to your horse for hauling. |
| Loans | At most 200 outstanding debt per account, a 500-gold lending pool per run, and a 1,000-gold treasury floor for new loans. Credit can fund approved purchases; it cannot be banked or withdrawn. Twenty percent of cumulative earnings repays debt, up to the remaining balance. |

Horses and deployed carts remain in the current village when their owner disconnects. Riding ends safely on disconnect or downing. A cart caught behind an obstacle detaches with its contents intact. Their current persistence is within the run; personal savings, outstanding debt and unused purchase credit follow the account into later runs.

## Trading and village decisions

At the treasury, resource prices rise with scarcity and fall with surplus. Type a whole quantity to trade a custom bundle, up to the stock, inventory, weight and funds available (10,000 units per request maximum). Each bundle is priced unit by unit. The server checks the quoted maximum purchase price or minimum sale payment before transferring anything; insufficient stock, money, or capacity rejects the whole trade. Purchases from players preserve 500 treasury gold for essentials. The starting trade tax is 5%; buying and selling use a two-gold unit spread before tax.

The traveling merchant visits on day 3 and every second morning after that, staying for the day. Residents can buy limited specialist supplies of iron, coal, and arrows. The steward never imports wheat, timber, or stone; it may export a measured surplus after reserving food and repair supplies. An empty stable may be restocked when affordable. Night-survival grants go directly to the treasury rather than the player reward feed: 1,000 gold after night 1, 2,000 after night 2, and 1,000 more for each subsequent night. The reward uses the village's completed night number, including in existing runs, and is independent of player count.

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

The noticeboard posts real shortages in communal food/repair stock, public barracks wheat and cannon supplies. At most four requests and 300 reserved gold are committed per day, with up to 24 units per request. It preserves 500 treasury gold plus two active payroll cycles before funding deliveries. Bring a chosen partial quantity to the marked entrance; payment uses the normal loan-repayment rules. Ordinary donations or sales can fill a need without an extra bounty. Expired, superseded and fallen-village requests refund unused escrow; withdrawing supplies cannot manufacture a new rewarded shortage.

Owned barracks support Defend the gate, Hold here, Follow me and Retreat to barracks. Hold captures the owner's actual current position. Troops follow the existing roads and gate, respect obstacles and stay within their order's fighting area. A following troop retreats when its owner is unavailable or unreachable, and replacements inherit the barracks order. The public Watch remains independent.

New accounts receive a compact optional guide covering their first tool, gathering, selling, food and finding the gate. Dismiss or reopen it from the village menu. Account honors unlock at 1, 5, 10 and 20 credited nights across runs; a credit requires being online and alive for at least half of an actually survived night. Cosmetic sashes and crests persist across runs. Earned colors can decorate owned buildings at their entrances, and the founder can choose the keep banner at the keep entrance. These choices affect appearance only.

## Hired workers

Visit the treasury to hire up to two workers per resident for 75 wallet gold each. Open **Workers** from the treasury or your inventory to choose wheat, timber, stone, iron or coal, select public resources or one of your matching production plots, and order delivery to one of your buildings or automatic sale at the treasury. Other residents’ private plots cannot be assigned.

A worker gathers one unit every four seconds, travels between the actual resource and destination, and carries up to 40 weight. Tools are included in the contract. Pay is one wallet gold per 30 seconds of work, prepaid in small installments; bank savings and purchase credit are never charged. Workers work while their employer is online during the day and return to the treasury at night, when paused, or when their employer goes offline. Nearby zombies interrupt work. Returning to shelter and waiting for resources, storage, or affordable sales do not incur wages.

Sales use current stock prices, tax, the treasury’s emergency reserve and normal loan repayments. Full or unavailable storage and an underfunded treasury leave cargo with the worker. You can collect cargo beside the worker, change orders, pause/resume, or dismiss an empty worker at the treasury without a refund. Workers and their orders persist within the village run. Fallen villages disappear from the selection list; account savings remain available in the next run.

## Controls

| Input | Action |
| --- | --- |
| W / A / S / D | Walk, or ride while mounted. |
| Shift | Sprint while hunger allows. |
| Hold right mouse and move | Turn the third-person camera and look upward, including while downed. |
| Left mouse | Use the selected weapon, tool, food, or blessing. |
| 1–8 / mouse wheel | Select a configured hotbar slot. |
| E | Gather a matching nearby resource or interact with the noticeboard, a service, plot, horse, cart, or downed companion. |
| I | Open your pack, equipment and hotbar setup. |
| M | Open the village atlas and mark a destination. |
| R | Command troops belonging to your own barracks. |
| Enter | Focus chat; send the typed message. |
| T | Toggle village chat. |
| H | Open controls and help. |
| F | Toggle fullscreen. |
| Escape | Close the active panel or open the village menu. |

Use an axe on trees, a pickaxe on stone/iron/coal, and a scythe on individual wheat stalks. Higher tier tools increase the resource count, not gathering speed. A matching resource takes priority over a nearby building menu. Equip a weapon or step away from the resource when you want the service instead.

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

Account passwords are salted and hashed with scrypt; the database stores hashed session tokens. This is an initial account system, with no email recovery or shared website login. Account administration, operational monitoring, restore drills, and broader abuse/load testing remain work for a public release.

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

The village geometry, characters, animations, interface, and gameplay code were created for Emberwatch. No code from the existing games was copied. Cinzel and DM Sans font files are bundled locally under the included SIL Open Font License notices in `public/fonts/`. Three.js and ws are installed through npm under their package licenses. The game makes no runtime CDN requests for fonts or rendering code.

See `docs/VALIDATION.md` for the checks performed on this build.
