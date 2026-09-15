# Emberwatch build validation

## Build 08: entrance access and the visiting merchant

The complete `npm test` run passes **212/212 tests**. All 39 client, shared and server JavaScript modules pass syntax checks. Shared entrance rules cover the actual rotated front doors and projecting shop counters. The checks verify reachable approach points for every permanent building and all 48 plots across supported building types, reject side/rear/interior positions, and use frontage gates for open land and ruins.

Authoritative action tests reject out-of-reach banking, trading, loans, food/tools/backpack/horse/merchant purchases, donations, plot storage/crafting/ownership controls, recruitment, upgrades and policy proposals without changing village or account balances. They recheck position on each request. Church treatment remains available at the beds and hammer repairs remain available beside damaged structures. Existing tests now approach the correct entrance; their economy, persistence, combat and multiplayer assertions are retained.

Client checks cover entrance-only prompts, gathering priority, stale open panels and confirmations, focused form invalidation, treatment controls at beds, worker hiring/dismissal, remote worker orders and council votes, and atlas markers that move from a plot gate to the current building entrance after construction. Worker delivery and waiting positions remain usable.

The merchant, two harnessed horses and covered carriage follow the authoritative visit-presence flag, including joining during a visit, departure, missing state and later arrivals. Geometry is reused across visits. Tests verify that these decorative visitors never create owned/purchasable horses or mutate game state, clear the stall approach, roads, buildings and mineral gathering areas, and dispose their private assets without damaging shared character/horse assets. The rigid carriage uses ten material batches. The [merchant preview](previews/merchant-visit.jpg) renders the actual stall and visitor geometry at their real relative positions; it was visually inspected. Studio rendering omits canvas sign lettering and game textures/ground.

Interactive WebGL appearance and production multiplayer frame rate still require a live playtest. This update does not reset villages or change existing balances, inventories, merchant schedules or trade prices.

## Build 07: articulated movement and clear path junctions

The complete `npm test` run passes **194/194 tests**. All 38 client, shared, server and movement-preview JavaScript modules pass syntax checks. New checks cover independent knee/ankle/elbow movement, walking versus running, floor clearance, frame-rate consistency, smooth transitions through tools, turns, carrying, riding and downing, clothing deformation and skeleton disposal. Existing combat, equipment, backpack, worker, multiplayer and persistence checks remain green.

Road edging now waits until all 70 road surfaces and the paved squares are known. Five junction regressions cover T intersections, crossroads, overlapping and reversed parallel lanes, wider roads, squares, and actual village shop/plot entrances. [Actual-geometry overhead comparisons](previews/path-junctions.png) confirm internal curb rows are removed while exposed edges remain. The road mesh, navigation and collision layout are unchanged; clipping runs only when the world is built.

Actual Three.js geometry was sampled and rendered for walking, running, workers, guards, priests and zombies. The selected 60 fps walk/run previews are in `docs/previews`; each repeats a 1.4-second sample four times. Boots articulate at the ankles, clothing follows the knees and hips, and tools/backpacks stay attached. Small clothing seam intersections can remain at extreme poses. These studio renders and automated checks do not establish interactive WebGL appearance or production multiplayer frame rate, which still require an in-game playtest. No server rules, save data or balances change in this update.

## Increasing night-survival treasury grants

The survival grant now uses `1,000 × completed night number`, calculated before advancing to the next day. All **19 existing backend and economy tests pass**, and the server passes its syntax check. A separate temporary-database check exercised real night-to-day ticks for completed nights 1, 2, 3 and 10, producing 1,000, 2,000, 3,000 and 10,000 gold. It also verified participant-count independence, unchanged player wallet/bank balances, no gold reward notices, preserved balances across SQLite restarts/rejoins, and no extra payment while the empty village remains paused. Merchant restocking, exports and wages were isolated from those grant assertions. Existing saves retain their current balances and receive the new formula only at future dawns.

## Build 06: visible backpacks, hired workers and fallen villages

The combined `npm test` run passes **177/177 tests**. Coverage includes public backpack-tier replication over real WebSockets while inventories stay private, authenticated worker hiring, owner-only orders and cargo, visible pack geometry and lifecycle, worker UI payloads and preserved drafts, finite shared harvests, paid work time, full-storage handling, partial taxed sales, the treasury reserve, the normal debt-income path, and pauses for night, nearby enemies, absent employers and insufficient wages.

Navigation checks exercise distant exterior-to-interior deliveries through the single gate and the return trip, obstacle avoidance, preventing harvests through walls, and sixteen workers delivering at once. Hired workers leave the hard-to-reach woodland beyond the sidewalls for player gathering; public interior and southern exterior sources remain available. Treasury waiting spots are spaced, and sales accept arrival beside the building so crowds cannot block a shared delivery point.

Two additional real-SQLite worker persistence tests pass (**179 passing tests in total**). They hire and assign through authenticated simulation actions, advance real movement and harvesting, save and reopen the database, and verify worker identity, orders, cargo, prepaid time, gathering progress and node depletion. Restarted players remain offline; rejoining neither charges another hiring fee nor grants fresh money. A legacy village without workers gains an empty roster and keeps its saved treasury.

The fallen-village check uses real keep destruction, HTTP browsing, a SQLite restart and bank withdrawal in the next run. Active villages with offline residents remain listed, fallen runs remain available to their current loss screen, and personal savings survive. Edited server/client modules pass JavaScript syntax checks.

The backpack preview in `docs/previews/backpacks.png` renders the actual game geometry, reviewed from behind at an angle. The three purchased tiers have distinct curved bags and equipment, follow the torso, and reuse cached geometry safely. This environment cannot perform an interactive WebGL playtest. In-game animation, lighting and sustained multiplayer performance still need live observation after deployment.

## Starting treasury balance adjustment

The initial public treasury is now **20,000 gold** for newly created village runs. The grant is made only by village creation; saved villages keep their current balances on reload or rejoin. Personal starting wallets remain separate. After the balance adjustment, all **33 existing starter, backpack, backend, economy and market tests pass**, including real WebSocket sales and SQLite treasury recovery. Only the default-dependent expected balances were updated; scenario-specific liquidity fixtures retain their original values. The server module also passes its syntax check.

## Tool-grip follow-up

After the screenshot of the sideways pickaxe, the shared straight-handle grip, carrying elbow pose and tool strokes were corrected. The full automated suite passes **151/151 tests**. New geometry regressions check all working tools, three material tiers and three jobs, actual finger alignment, upright shafts and forward heads, animation continuity, stowing, ore-height mining contact, a level scythe blade and forward bow aim. Existing sword, character, horse and multiplayer tests also pass. Front, side, quarter and working-stroke renders were inspected from the actual Three.js geometry. This follow-up changes character visuals and preview tooling, with no server rules or save migration.

## Build 05: both playtest feedback lists

Validated 2026-09-15 on Node 24: **148/148 tests pass** with `npm test`. All 34 client, server and shared JavaScript modules pass `node --check`.

Added regression coverage for empty-handed ten-gold arrivals, one grant per run and reconnect persistence, rejecting unowned equipment, inventory/backpack loss on manual dawn respawn, credit-funded replacement tools, backpack purchases and every weight-limited transfer, larger villager capacity, whole-quantity bulk trading, treasury UI quotes and preserved input focus, role shield/health migration and regeneration, downed-overlay camera dragging, recruited guard replacements and saved timers, and tower construction/firing/ammo depletion/restocking.

Actual Three.js geometry checks cover sculpted horses, skin weights, finite animated poses, exact mounted rider/horse position and yaw, shared geometry cleanup, sword grip alignment, natural quarry formations, bounded harvest particle/fall effects, depletion/regrowth and reconnect suppression. Independently reviewed the combined client/server wiring. Horse, mineral-bed and sword-grip CPU renders are in `docs/previews` and were visually inspected.

**Limits:** the available cloud browser has no usable WebGL context. These are automated simulation, real WebSocket, DOM-harness and actual-mesh checks; they do not establish live browser frame rate or end-to-end visual quality on the production site. Production deployment status must be checked separately.

Existing accounts, savings, inventories, plots and villages migrate in place. New arrivals receive 10 gold and no equipment; existing residents are not reset. A unique account/village grant record prevents reconnect grants. Existing depleted archer towers still require arrows; only new paid construction includes the starter quiver. Guard shield, priest HP and villager capacity values are initial playtest settings.

## Build 04: the full village map and connected progression systems

Date: 2026-09-14. The Watch now faces the central street and its two guards leave the east entrance. The map contains 40 internal plots and eight exterior deeds, connected streets, stable and merchant services, and public iron/coal sites. All eleven plot building types have server actions and matching scene geometry. This is the first integrated playtest of ownership, crafting, treasury policies, food tiers, church care, owned defenses, horses, carts and purchase credit.

The automated suite contains **99 passing tests**. It includes actual HTTP/WebSocket authentication and multiplayer transactions, persistent SQLite saves and legacy account migration, finite resource/crafting/ammunition ledgers, exact private-harvest shares, role wages and tax accounting, steward approval/veto, safe merchant exports, manual respawn and church rescue, protected bank/loan separation, and obstacle-aware NPC movement. Integration checks exercise construction with occupants, a guard leaving a rear barracks through a fully built map, and an injected save failure that must roll back both village state and account credit. Combat regressions check attacks across a gate, a healing channel interrupted by downing, and full-pack tool purchases.

New clients opt into state patches; old clients continue receiving full snapshots. Real WebSocket tests merge updates back to the exact authoritative state, verify reconnect baselines and private fields, and measure 40-byte idle updates versus 27,410-byte full snapshots, and about 1,450-byte movement updates versus 27,460-byte full snapshots in the test fixture. These are protocol measurements, not a production bandwidth guarantee.

All 26 client/shared/server JavaScript modules pass syntax and local import resolution checks. The HTML has 67 unique IDs. Six UI tests exercise displayed trade quotes, construction from stored materials, equipment replacement confirmation, church treatment, safe resident-name rendering, focused form preservation, and every service/building panel branch using a narrow DOM harness. These do not establish browser layout or usability.

Node/Three.js scene checks construct the map, all eleven building types and upgrades, four-bed church coordinates, ruins and collision changes, tower projectile lifecycle, private crop depletion/removal, and all road-facing service approaches without a GPU. Character probes cover tool motion at 30/60/120 Hz plus 4,320 bow/mount/carry/down transition frames with finite transforms and clean disposal.

**This update has not been visually playtested in the available cloud browser, whose WebGL context is disabled.** Full-screen layout, lighting, mounted and carrying poses, eight-player frame rates, long survival runs, and economy/combat balance still need playtesting on the actual game. No live player data or production test accounts were modified during these checks. Existing Railway saves are migrated in place; neither a database reset nor a new village is required.

## Build 03: village chat and quarry access

Date: 2026-09-14. Adds a toggleable chat panel, transient overhead speech and typing bubbles, gathering-first interaction selection, and quarry spacing. The remaining reported building could not be identified in the geometry audit; its orientation is pending a screenshot/location rather than an arbitrary rotation.

The automated suite now has **34 passing tests**: the 20 build-02 tests plus five server-chat tests, five client-chat-state tests, two interaction-priority tests, and two quarry-compatibility tests. Server chat checks use real WebSocket clients to verify authenticated identity, village isolation, sender echo, history limits, normalization/rate limits, reconnect behavior, and typing cleanup. Client state checks cover message deduplication, length/cap bounds, literal text, quiet history, and speech/typing expiry. The reported church/stone overlap is covered by a resource-priority test, and quarry checks verify clear harvesting positions and preserved resource identities.

All 14 client/shared/server JavaScript files passed syntax checks. Chat host/stylesheet wiring and unique HTML IDs were inspected. Code review confirmed that text focus clears movement, suppresses gameplay shortcuts, and uses textContent for messages/bubbles. Browser layout and live in-game chat still need user playtesting because the available cloud browser cannot render the game's WebGL scene.

## Build 02: player-feedback update

Date: 2026-09-14. Adds a persistent hunger HUD, stock-priced resource selling, building entrance/path corrections, tool-specific animation, and remote movement interpolation. Existing save structures are unchanged.

The automated suite now contains **20 passing tests**: the eight original server tests below, six market tests, and six interpolation tests. Market checks cover scarcity/surplus prices, per-unit bulk price changes, inventory and treasury conservation, invalid/range/funds rejection, two real WebSocket sellers with a stale quote, and SQLite reload. Movement checks cover irregular snapshot timing, shortest-angle turns, stationary/stalled streams, bounded history, and teleport resets.

Additional Node/Three.js checks constructed the world and character rigs without a browser renderer. All eight building fronts and approaches were checked against the shared collision map; side paths and curbs avoid solid footprints. Animation transforms remained finite across seven role/tool combinations at 30, 60, and 120 updates per second, including role/tool replacement and down/revive transitions. These checks verify structure and timing, not visual quality.

**Build 02 has not been visually rendered or playtested in the current cloud browser.** Its graphics context is disabled. Tyler reported that the previous deployed build supports account creation, gathering, banking, food, two-player synchronization, priest healing, and surviving a night. He could not test repairing the gate because enemies did not reach it. This feedback is distinct from the automated checks.

The original build-01 browser results are retained below as historical evidence; they do not validate the changed build-02 visuals.

## Build 01 baseline

Build date: 2026-09-14. Original standalone codebase; no changes to the previous games.

## Automated checks

`npm test` runs eight tests against the Node server and SQLite store:

1. HTTP account authentication, two real WebSocket clients, shared movement snapshots, private wallet/bank data, and stopping stale movement input.
2. Eight persistent residents, including offline members, and rejecting a ninth resident.
3. Repair distance/tool/material validation, the separate ten-gold repair allowance, and dawn payouts.
4. Account and bank recovery after closing and reopening SQLite, and paused empty villages.
5. Resource depletion and tool use, downed players waiting for dawn, and explicit respawn penalties.
6. Priest revival across dawn and rejecting revival by other jobs.
7. Zombies following the road, attacking the gate before the keep, and keep destruction ending a run.
8. Both NPC guards leaving the barracks, passing the gate, and reaching their separate defensive posts.

All eight passed. The server and browser JavaScript files also passed syntax checks.

## Actual browser checks

The Three.js client was rendered in headless Chromium with WebGL 2 through SwiftShader. Daytime and nighttime screenshots were visually inspected. No browser JavaScript or console errors were recorded in the final interaction pass.

The browser registered and joined a guard named Borin. A second authenticated WebSocket client joined as a priest named Elowen; the browser displayed both residents. Keyboard movement was checked against authoritative server coordinates. Gathering with the axe, depositing gold, donating timber, repairing the gate, and starting a development-mode night were exercised through the real interface. Saved account data, quantities, gate health, and repair earnings were checked against server state.

The interaction test used server-side test fixtures to place the player beside resources and the bank, damage the gate, and advance the simulation for the night scene. These setup shortcuts are not available through production client messages. Development night controls require ALLOW_DEV_TOOLS=true; the default is disabled.

## Scope and remaining checks

This is the first playable foundation. It is not the full design in DESIGN.md. Player plots and owned buildings, upgraded tools, the market and steward, taxes, loans, horses, church beds, and advanced NPC navigation are later milestones. Build 02 adds basic resource selling as described above.

Tyler has since deployed the game on Railway and reported the live checks noted above. The cloud browser reached the login screen but could not create a WebGL context, and separate live endpoint probes timed out. These checks do not establish a hardware frame-rate target or simultaneous multi-village hosting capacity. Test on the target computers and configure the persistent Railway volume before retaining real player progress.
