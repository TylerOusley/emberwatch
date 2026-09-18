# Emberwatch build validation

## Build 30 hotfix: all-resource merchant exports

Validated September 18, 2026: **891/891 tests pass** with `npm test`, with no failures, cancellations or skips. The final focused economy suite passes **29/29** after refining its private-plot/civic-storage fixture. All three changed runtime modules pass syntax checks, **93 browser modules** link with actual imports/exports, and `git diff --check` passes.

Six additional economy tests and expanded existing cases verify all six Resource Exchange materials, exact fixed treasury bids, each25/50/100% policy, whole-unit rounding, quantities above120, unchanged food/repair reserves, and all-resource policy changes before dawn. Tests also cover exporting ores even when absent from the merchant's player wares, defaulting missing saved ore stocks to zero, preventing repeated exports on saved-dawn reload, preserving private inventories/plot storage/civic depots and crafted/unknown public goods, and rejecting the complete mixed shipment when ore proceeds would overflow the treasury or safe integer range. The existing dawn transaction and persistence path are unchanged. Independent review found no implementation blocker.

This hotfix keeps the Build30 marker and takes effect at the next scheduled merchant arrival. No interactive browser playtest or manual production player mutation is claimed.

## Build 30: worker tool purchases and bank replacement

Validated September 18, 2026: **885/885 tests pass** with `npm test`, without failures, cancellations or skips. All five changed runtime JavaScript modules pass syntax checks, **93 browser modules** link with actual imports/exports, and `git diff --check` passes.

Fourteen new real Simulation/SQLite integration tests verify exact wallet-only prices, remote purchases without carried tools/materials, ownership and invalid requests, duplicate usable-tier rejection, worker-only gear, exact bank-only same-tier replacement, repeated breakage/restart, insufficient savings and later deposits, enabling/disabling, offline owners, empty villages, paused/inactive/suspended/unfunded crews, multiple workers sharing a bank without overdraft, and manual/automatic save-failure rollback. A two-worker failure regression verifies that the first committed replacement survives while only the unpaid second replacement retries. Legacy tools and conditions persist, old wallet/material maintenance stays off, and replacement settings are owner-private. Converted plot transporters can still disable bank spending.

The fourteen existing equipment/Manager tests retain wage, crew-limit, offline and yield coverage under the new purchase model. The 28 worker UI tests cover direct purchase controls, wallet and bank updates, current tool durability, toggle-only updates, inactive/transporter restrictions, legacy recovery (including converted transporters), reviewed dismissal and the prior roster/draft/click safeguards. No interactive browser playtest or manual production player mutation is claimed.

## Build 29 hotfix: worker management

Validated September 18, 2026: **867/867 tests pass** with `npm test`, without failures, cancellations or skips. The **24 worker UI tests** cover existing hiring, orders, tool transfers/repairs, maintenance, training, collection and dismissal, plus large rosters with one editor, search/type/status filters, empty results, stable worker identity after reordering, per-worker drafts across selection/tab/snapshot changes, UI reset, pointer/keyboard press protection and detached controls. Percentage editing preserves the Apply button through blur; transporter training offers movement/carrying and displays delivery progress. All three changed runtime JavaScript modules pass syntax checks, **93 browser modules** link with actual imports/exports, and `git diff --check` passes.

An independent fixture renders the actual UI with 26 mixed personal/plot workers: 26 roster controls and exactly one detail card. Structural parsing finds no duplicate IDs, unresolved label targets or unbalanced tags. A supplemental desktop static render was inspected using the actual markup, styles and fonts with print adaptations for native controls/scrolling. This is not an interactive browser screenshot or WebGL playtest; a browser executable was unavailable. Responsive styles are included, but mobile pixel rendering is not claimed from the print renderer.

This hotfix changes client presentation and interaction handling. Server worker behavior, employment limits, wages, routes, equipment costs, ownership and proximity validation remain unchanged. No production player data was manually changed.

## Build 29: uncapped zombie bounties

Validated September 18, 2026: **858/858 tests pass** with `npm test`, with no failures, cancellations or skips. All **120 runtime JavaScript modules** pass syntax checks, **93 browser modules** link with actual imports/exports, and `git diff --check` passes.

The new real Simulation/SQLite suite verifies all six roles, positive-damage assists below the old threshold, 60 same-night kills with an empty treasury, owner deduplication across direct/tower/troop damage, actual cannon splash and wizard lightning chains, ranged and melee troops, offline owners, burns, downed/daytime assists, splitter offspring, private saved totals, restart persistence and duplicate-death protection. Loan repayment and injected save failures verify atomic wallet, account debt, death and offspring updates, including rollback through an outer player attack transaction.

Existing enemy and early-dawn tests now expect immediate 100-gold bounties separately from accrued wages and service/repair bonuses. Treasury assertions verify that bounties do not spend public funds; early dawn and retry protection remain intact. The pack UI test covers all six roles, gross totals, no-cap/loan wording and refreshing when only bounty totals change. No interactive browser playtest or production player mutation is claimed.

## Build 28 hotfix: surplus proposals

Validated September 17, 2026: **68/68 focused settlement UI and economy tests pass**, runtime syntax and `git diff --check` pass, and **93 browser modules** link with the real imports/exports.

Reproduced two client failures before the fix: a surplus selection returned to the current policy after blur plus a live balance update, and a snapshot replaced the pressed proposal button before its native click. The export selector now uses the existing saved form drafts. Council buttons defer replacement until pointer/keyboard activation completes, with cancellation, blur, entrance-loss and menu-clear cleanup. Three UI regressions cover increasing/decreasing exports, pointer/Space/Enter activation, and stale-control cleanup. A server regression verifies all six directional policy changes through majority approval, next-dawn application and merchant export calculations.

Server economy rules are unchanged: propose at the Treasury or Hearthkeep entrance, then observe the existing vote, steward review and next-dawn timing. This hotfix does not claim a new full-suite run or interactive browser playtest.

## Build 28: Wizard staff repair

Validated September 17, 2026: **836/836 tests pass** with `npm test`, with no failures, cancellations or skips. All **120 runtime JavaScript modules** pass syntax checks and **93 browser modules** link using the real imports/exports. `git diff --check` passes.

The patch removes staff durability in favor of saved ownership, migrates existing broken staffs, and exposes free Academy recovery. New real Simulation/SQLite tests cover migration/restart, no role-change regrant, immediate/idempotent recovery and exact pack capacity, access/rejection rollback, ordinary respawn, private snapshots, repeated casts of all three elements below full mana, insufficient/exact mana thresholds, and 110 casts without wear. UI tests exercise actual reclaim handlers, stale clicks, ownership refresh, staff inventory/shop presentation and non-Wizard purchase restrictions. Client casting tests keep mana affordability separate from cooldown.

The firing delays are now 0.6 seconds for fire/frost and 0.8 seconds for lightning; costs remain 15/15/22 mana and regeneration remains 8/second. The prior 1.8-second fire delay nearly refilled the 15 mana spent, creating the appearance that a full bar was required. Both client input and server enforcement now use the shorter per-spell delays. No interactive browser playtest is claimed; automated tests cover the behavior and the existing lobby lifecycle regression.

## Build 27: village expansion

Validated September 17, 2026: **822/822 tests pass** with `npm test` (no failures, cancellations or skips). All **119 runtime JavaScript modules** pass syntax checks, and **91 modules** reachable from the real browser entry point link with actual imports/exports. `git diff --check` passes.

- Tavern: all four new games plus existing games, exact reel/wheel outcomes, card ranks and payouts, private hands, dealer rules, durable move receipts, treasury escrow and atomic timeout settlement/restart/rollback. Active button presses survive snapshot updates.
- Crates: exact one-step rarity frequencies, no Epic→Godly path, duplicate refunds/replays and account persistence. Heart Ward respects range, living allies, nonstacking, night identity, role/equipment/reconnect changes and failed-save rollback; its visible aura follows every protected ally.
- Roles: all six roles, paid Academy prerequisites/ranks/commission, active-role-only bonuses, one-time staff grant, mana and elemental hits. Real tower tests verify one sulfur per shot, fire34 and lightning42/27.3/17.745 with three-target/LOS limits. Guard capacity5/8, Priest39-point healing/4-second learned revival, and Tinker104-point ironhammer repairs exercise real simulation. Offline Tinker pricing quotes match purchase material requirements.
- Workers: Manager caps and wage buckets survive role switches and disconnected owners; stone/iron output uses exact fractional accumulation and real wear. Budgeted repair cannot spend the next required wage. An eighty-worker village completes market deliveries without blocked queues. Supplied and kit-bound gear cannot be discarded or duplicated through worker management.
- Transport: 1,000/2,000 migration, upgrade costs, shared server/client road speed, direct plot freight and preserved shortage provenance. Two-seat rescue conserves player identity and inventory through church handoff, disconnect, respawn and first join after a restart.
- Rebuilding: thirteen building kinds reopen only at35% health, retaining ownership, storage, levels, prices and trained paid troops. Materials/hammer durability are real, no starterstock repeats, and inactive ruins cannot fire.
- Civic works: inherited project identifiers are rejected, staged multiplayer donations/restarts and failed-save rollback preserve balances. Bound goods, cart ownership and contribution limits are enforced. The mason follows actual navigation, spends prepaid wages/materials, and the ballista/trebuchet consume depot ammunition for real damage.
- Jumping: authenticated WebSocket input produces height/velocity/grounded snapshots for another player. Forged client height/timestep/owner fields are ignored. Held input, SQLite midair restart, mounted/carried/bed/downed states, full cave descent, boundary collision, three-step ascent/walk-off, ledge rejoin, NPC detours and remote vertical interpolation are checked.
- The full regression suite retains prior seasons/weather/events, offline crew continuity, worker stall recovery, percentage merchant exports, musket manufacturing, owner pricing, ranged defenders and mine-light invariants.

All **23 expanded Three.js shader programs** compile and link on Mesa25.2.8/OpenGL ES3.2, including the new civic materials, emissive Academy/towers, fire projectiles and lightning lines. Offline renders of the mine arches, Academy, both tower levels and completed gatehouse projects were inspected. Geometry remains deterministic and shared collision preserves old ore positions. Graphics verification uses actual Three.js geometry and local materials with offline Mesa rendering/compilation. This is not an interactive browser playtest or a measured real-device frame-rate claim; sustained eight-player performance and the new balance still need ordinary live playtesting.

## Build 26: worker continuity after owner disconnect

Validated September 17, 2026: **731/731 tests pass** with `npm test`, with no failures, cancellations or skips. All **104 runtime JavaScript modules** pass syntax checks, and `git diff --check` passes.

The worker loop and Resource Exchange queue previously required each employer to be online even when another resident kept the village active. Both now use the existing owner record without requiring its connection. The worker loop explicitly freezes when the village is empty. Wage rates, prepaid balances, manual pauses and resource/capacity restrictions retain their existing behavior; queue positions exclude paused, retired and unfunded crews.

- Three real Simulation/SQLite regressions cover personal gathering, plot gathering and supply transport while the employer remains offline; the last resident disconnecting; save/restart with only another resident returning; retained cargo, orders, progress and prepaid wages; no duplicate staff or delivery; and manual staff pauses.
- A one-gold employer spends only that wallet gold, finishes the purchased work period, then stops harvesting when it is exhausted. Another resident's wallet, both bank balances and village funds remain untouched. The exhausted state survives restart.
- An actual worker market journey after restart sells cargo and credits the offline employer exactly once, including a nearly exhausted prepaid balance. A second restart cannot duplicate stock or payment. The existing forty-worker queue test now runs with all employers online and with all employers offline while another resident remains present; every delivery completes in both cases.
- Updated worker and plot-worker tests distinguish an empty village from an absent employer. Worker UI checks verify that the displayed guidance explains continuing after departure, prepaid wages and empty-village pausing. Independent review found no remaining owner-presence gate in worker execution, rendering, sale income or persistence.

These are local automated gameplay, navigation, persistence and UI checks. No interactive browser playtest is claimed for this patch.

## Build 25: seasons, industry, staffing and ranged defense

Validated September 17, 2026: **727/727 tests pass** with `npm test`, with no failures, cancellations or skips. All **104 runtime JavaScript modules** pass syntax checks; all **78 modules reachable from the browser entry point** link with their real imports/exports. `git diff --check` passes. An independent review covered feature integration, crafting conservation, saved migrations, troop orders and UI layout.

- Environment tests exercise four-season timing, six event types, avoidance of recent events, exact large/small tick equivalence, finite public demand, one-time caravan delivery and fractional harvest bonuses. A real two-player Simulation/SQLite restart checks shared state, empty-village pause, preserved countdowns and no duplicate delivery. Weather tests cover fixed geometry, quality budgets, reduced motion, seasonal uniforms and cave suppression.
- Plot-worker tests retain five personal slots alongside level-based grants, staff activation, owned source/destination access, weighted percentage targets, cargo reservations, storage conservation, wages and navigation. SQLite tests preserve IDs, cargo, assignments, training and prepaid work. An actual transporter completes a supply journey, and retired staff remain recoverable. Existing selective-stall and forty-worker queue regressions pass.
- Crafting and pricing tests cover sulfur node migration without replacing existing ore/depletion, each new recipe, prepared stock sold once, owner-only prices and manufacturing, stale quotes, insufficient materials/capacity and exact payment ledgers. A reviewed edge case now includes automatic owner debt repayment in treasury overflow preflight. Real SQLite restart preserves prices, manufactured stock and musket durability.
- Actual Simulation musket tests cover 64 base damage, guard bonus, armor, one ammo/durability per shot, 1.6-second reload, weapon switching, range/facing, static and private walls, gate obstruction, committed restart state and full rollback after failed saves. Character grip, recoil, shared model disposal, local/remote sounds and reconnect replay checks pass.
- Barracks checks cover mixed three/six-slot recruitment, individual training, legacy swordsman migration, replacement persistence and ammunition consumption. Real simulation firing verifies range, damage, reload and snapshots; empty musketeers continue rally orders instead of freezing on distant enemies. DOM tests activate recruitment and training controls.
- The Wayfarer menu test invokes the actual tavern callback, including with the merchant away. Real WebSocket tests place six 10,000-gold coinflip/roulette bets across day/night, reject 10,001, verify saved receipts and balances, and replay requests without another settlement. Existing finance click-race regressions remain green.
- Actual geometry regressions verify clearance at overlapping roof slates and turret corner stones. Three.js shadow matrices verify light-space texel stabilization across sun/moon directions and quality sizes. These fixes add no geometry. Eight sulfur veins add 9,520 triangles; the street-view budget rises from 525,000 to 535,000 for the measured 526,476 triangles. Other camera budgets remain unchanged.
- `node scripts/verify-graphics-shaders.mjs` compiles and links **17/17 actual Three-expanded programs** in Mesa OpenGL ES 3.2: thirteen baseline programs plus rain/snow, overcast clouds, seasonal terrain and seasonal instanced foliage. Static world rendering also succeeds. These are offline shader/geometry checks, not a moving browser gameplay test.

The available local browser runtime has no installed browser binary; earlier cloud/local preview attempts could not provide an interactive WebGL playtest. No real-device FPS improvement or full desktop/mobile visual playtest is claimed. Long-run economy balance and multiplayer frame times remain playtest work. The current requested systems are implemented; older unrelated asset and specialization backlog is not represented as complete.

## Build 24: tavern betting controls

Validated September 16, 2026: **650/650 tests pass** with `npm test`, with no failures, cancellations or skips. All **95 runtime JavaScript modules** pass syntax checks, and `git diff --check` passes.

Reproduced a finance-menu click race: a wallet or treasury snapshot triggers a full panel render while Place bet is pressed, replacing its DOM node before the click completes. The original code sends zero bets in the regression; the fix preserves the target and sends exactly one. This is consistent with the reported inability to bet, especially while workers change village balances; the exact affected player's browser state was not inspected.

- Finance buttons now retain an active pointer or keyboard press through the click. Release, cancellation, pointer exit, blur, panel replacement and the release fallback clear the held state. Disabled states and quotes continue to follow current funds, connection and entrance access.
- Five UI regressions cover balance updates during a press and between release/click, cancellation recovery, Space/Enter activation, funds/connection changes that must still block a bet, and visible restriction messages beside Place bet. The guidance includes invalid stakes, wallet/treasury funding, location, standing state and connection.
- A real WebSocket regression places six coinflip/red-roulette/single-number bets during day and night with the traveling merchant absent. It verifies durable receipts, exact wallet/treasury changes, saved state, snapshot history and replaying the same request without another debit or roll. The server route already worked; no odds, payout, reserve or eligibility changes were needed.
- Independent review found no blocking issue in press cleanup, receipt handling or live eligibility validation. The UI uses the existing DOM harness; its event sequencing is simulated. The available browser could not open the isolated local test page (`ERR_BLOCKED_BY_CLIENT`), so no interactive browser playtest is claimed.

## Build 23: percentage merchant exports

Validated September 16, 2026: **644/644 tests pass** with `npm test`, with no failures, cancellations or skips. All **95 runtime JavaScript modules** pass syntax checks, and `git diff --check` passes.

The steward's fixed 40/80/120-unit limits are replaced with 25% (Conserve), 50% (Balanced) and 100% (Trade) of each basic resource's surplus after existing protected reserves. Exports round down to whole units, pay the existing prices, and retain the complete shipment if its payment cannot be represented safely. Conserve keeps its double reserve. Council options, proposals, the current policy and merchant screens show the percentages.

- Economy regressions cover all three modes selling more than 120 units, exact stock and treasury changes, reserve retention, whole-unit rounding, approved policies taking effect before the dawn sale, repeated-dawn idempotence, and large-value arithmetic without partial loss.
- A real SQLite restart regression covers all three existing saved policy choices, the next merchant dawn, and a second restart that must not repeat the export. It failed against the old fixed caps and passes with the percentage calculation. No save migration or production data edit is required.
- The UI harness checks percentage labels, the submitted policy identifier, proposal wording and refreshed merchant policy information. This is a DOM behavior check, not an interactive visual playtest.

## Build 22: selective worker stalls

Validated September 16, 2026: **629/629 tests pass** with `npm test`, with no failures, cancellations or skips. Runtime JavaScript syntax checks and `git diff --check` pass.

Reproduced workers becoming nearly motionless when fractional travel billing leaves a tiny positive `paidWorkSeconds` balance. A balance of 0.0001 seconds limited each movement tick to less than 0.001 units; the old billing threshold ignored that movement, so the balance never depleted. Reassigning or restarting preserved the balance. Workers against an obstacle also advanced navigation retry clocks using that tiny movement allowance, delaying detours by thousands of simulation ticks.

The fix charges every positive movement using the existing distance-based wage calculation. Zero movement remains free. Navigation accepts elapsed simulation time separately from its funded movement allowance, so path retries and the worker stall timer progress normally without allowing unpaid travel. Other NPC callers retain the original default timing. No wages, hiring prices, worker limits, harvesting rules or saved ledgers are reset.

- Six new regression tests cover reassignment/resume, cargo sale accounting, blocked storage delivery, free paused return, funded movement bounds during replanning, and recovery from an actual SQLite save/restart. The movement and persistence regressions failed on Build 21. The blocked delivery test also failed with the billing change alone, establishing the need for the separate navigation timer fix.
- The SQLite test retains the exact affected worker ID, prepaid remainder, cargo, order and experience; after reconnect/reassignment the worker walks at normal speed, purchases only one new wage block and sells its original cargo once. A second save/restart cannot repeat the sale or change protected bank savings.
- Independent navigation/worker/persistence review passed **36/36 tests**, including collision-safe movement, no charge while blocked, the forty-worker Resource Exchange queue and normal gate/cave routes. A deterministic longer simulation of five workers per resource (25 total, 600 simulated seconds per resource scenario) reproduced several selective stalls before the fix; afterward every worker harvested, none remained path-stalled, all finite mineral/wheat cargo was delivered, and positions remained collision-valid.

These tests reproduce and fix a concrete server-side cause consistent with the report. The exact live workers' private state was not inspected. Legitimate pauses for wages, treasury funding, full storage, offline owners or unavailable resources remain in effect and are reported on worker cards. No production save edits, dismissals or rehires are required for fractional-time recovery.

## Build 21: mine entrance shader stability

Validated September 16, 2026: **623/623 tests pass** with `npm test` (no failures, cancellations or skips); all **95 runtime JavaScript modules** pass syntax checks and `git diff --check` passes. An independent review also passed 11 focused torch, camera and HTTP asset-serving tests.

The mine-approach reproduction followed the centerline from z=-70 to z=-150 in 0.25-meter steps. In daylight, Build 20 selected six different point-light counts (0, 2, 3, 4, 5, 6), with the last boundary at z=-117.5 near the entrance. Three.js 180 includes this count in each lit material's program-cache key. Hiding unused torch lights therefore invalidated the lighting layout and requested new shader variants while approaching or leaving the mine.

The fix retains the existing six light objects in the renderer and sets unused slots to zero intensity. Fixture selection, active brightness, flame geometry, day/night behavior and the no-shadow rule are unchanged; inactive fixture IDs are cleared. This trades a fixed six-slot lighting loop, including outdoors, for a stable shader layout. It does not reduce scene geometry or promise a higher average frame rate.

- The seven torch tests pass. The two new regressions failed on the original implementation and pass with the fix. They use the installed Three.js `WebGLLights` and `WebGLPrograms` code, not a substitute cache-key calculation. Across **1,926 sampled updates** (321 positions, both directions, daylight/dusk/night), the light-state version and material program key remain unchanged while active lights still cover all original daytime counts. Dynamic fixture hiding/removal, out-of-range fixtures, empty pools and capacities 0/1/3/8 are also covered. Unused light uniforms are black and light objects are reused.
- All **13 expanded graphics shader programs compile and link** in Mesa OpenGL ES 3.2 via `node scripts/verify-graphics-shaders.mjs`. The lit fixtures now use six point lights to match the runtime pool, including shadow/fog, instancing, skinning, reflection and direct-render variants.
- Read-only camera/cutaway profiling found no comparable transition work: cave updates were approximately 0.75 microseconds/call, camera constraints approximately 32–119 microseconds/call, and cave-view switching touches nine prebuilt mountain batches. Frustum estimates found the cave geometry already submitted before reaching the threshold, not a sudden mesh-load spike. These are local CPU/geometry observations, not device frame times.

The available Chrome test browser failed to create a WebGL context, including one reload, so no interactive entrance FPS measurement is claimed. Desktop confirmation remains: cross the mine entrance repeatedly in both directions at day and night, check torch appearance, and compare first-visit and repeat-crossing frame times at the same graphics preset. No server logic, player/village data, production settings or collision rules are changed by this patch.

## Build 18: scenery, sourced materials and lighting

Validated 2026-09-16 on Node 24.19.0: **620/620 tests pass** with `npm test`, with no failures, cancellations or skips. All **95 runtime JavaScript modules** pass syntax checks; **224 local imports** resolve. The entry page has **81 unique IDs** and all **14 linked assets** resolve. Whitespace and private-credential boundary checks pass. This validation covers Build 18, including the preceding Build 17 changes. The recovered release passed a fresh 620-test run and all 13 shader compile/link checks before publication.

- All 21 Poly Haven maps match their recorded SHA-256 hashes and 1024 × 1024 dimensions; the NASA Moon map matches its 2048 × 1024 dimensions, byte length and hash. Source licenses were checked against their official pages. A real HTTP test verifies exact JPEG bytes, `image/jpeg` delivery, new module/style routes and the Build 18 entry page. Browser construction failures and failed image loads retain valid neutral textures.
- **13 exact expanded Three.js 180 shader programs compile and link** through Mesa OpenGL ES 3.2. Variants cover smooth/flat surfaces, nonuniform instances, vertex color, double-sided faces, normal maps, skinning, shadows/fog, physical reflections, direct ACES/sRGB output and the final presentation shader with its edge-filter fallback. Albedo uses hardware sRGB decoding; normal and roughness textures remain linear. [Machine-readable shader results](graphics-shader-validation-build18.json) record source hashes. The [actual PBR diagnostic](previews/surface-materials-build18.jpg) renders all seven materials on curved meshes and scaled instances.
- All **six actual sky shaders** compile and render in Mesa using the real lunar texture. Dawn, midday, sunset, night, high clouds and lunar detail were inspected in [the sky preview](previews/sky-build18.jpg). Cycle wrapping, paused/shared timing, finite exposure, day/night light values, camera following, small disc sizes, texture fallback and disposal are covered by tests. HDR rendering disables scene tone mapping before the final output pass; the direct Low path maps once as well.
- Fifteen graphics-quality tests cover saved/corrupt/denied preferences, bounded atomic resizing, GPU limits, texture filtering, shadow target disposal, Auto hysteresis under both ordinary and severe load, manual stability, menu focus and lifecycle. Five pipeline tests cover one scene draw plus one output pass, compatible color/depth sample counts, direct-render fallback, target reuse/resizing and cleanup. Renderer review found no startup subscription recursion or stale projection references. Auto samples connected gameplay rather than the empty lobby.
- Thirty-four world-focused tests preserve deterministic resources, roads, entrances, landscape/cave boundaries, effect state and cleanup. New assertions cover organic tree/wheat bounds, spatial forest/ridge batches, smooth interpolated normals at cave cuts, individual slate tiles and hard roof/gable creases. Fourteen plot/cave tests retain the 44 ore anchors, floor/camera clearances, structure tiers and the existing cannon impact/reconnect behavior. The [textured world preview](previews/world-build18.jpg), [plot models](previews/plots-build18.jpg) and [cave models](previews/cave-build18.jpg) were visually inspected. A final roof revision removed broad alternating color strips in favor of staggered slate tiles.

Scenery was profiled against the same Build 17 fixture. Spatial batching and reduced distant leaf/branch detail lowered the initial new actor-view estimate from about 1.28 million triangles to **616,541**. The final world holds **1,321,373 instantiated triangles**, **1,150 draw groups before culling**, and approximately **35.83 MiB of unique geometry**. Representative static-world camera estimates use Three.js frustum tests at 60° FOV, without players, combat or occupied plot buildings:

| View | Build 17 triangles / draw groups | Build 18 triangles / draw groups |
| --- | ---: | ---: |
| Near the player entrance | 315,497 / 431 | 616,541 / 439 |
| Village center | 296,308 / 237 | 516,956 / 254 |
| Northern mine approach | 278,000 approximately / 92 | 395,565 / 107 |

These are geometry submission estimates, not device frame-rate measurements. The richer scenery uses more geometry than Build 17. High/Balanced/Low render-pixel caps, nearby shadow coverage and automatic quality changes constrain GPU work, but sustained multiplayer combat on real devices still needs testing.

The browser control surface previously rejected local preview access. During release recovery it reached the live Build 16 page but could not create a WebGL context, so no interactive browser playtest or live gameplay capture is claimed. World/plot/cave sheets use separate offline studio lighting; the PBR diagnostic and sky sheets execute the actual respective shaders. Their layout, shadow feel and combined in-game appearance still need a desktop playtest. QA used temporary data and did not alter production player or village state. The user requested continuation of the approved deployment; the GitHub release branch was accepted on 2026-09-16.

## Build 17: illustrated village menus, visible upgrades and village finance

Validated 2026-09-16 on Node 24.19.0: **578/578 tests pass** with `npm test`, with no failures, cancellations or skipped tests. All **91 runtime JavaScript modules** pass syntax and local import checks. The entry page has **80 unique HTML IDs**, all linked assets resolve, and the diff passes whitespace checks.

- Illustrated settlement, crate, trading, guard and finance menus retain exact/max quantities, focus, drafts, ownership checks and recovery behavior. A main-menu integration smoke check opens all five new or updated destinations and the Build 17 feature panel with real SVG/PNG artwork. Private admin access and disabled global development controls remain intact. The corner inventory reads the resident's own carried resources, tools and equipment without counting bound supplies twice.
- Ownership and worker checks cover eight plots per player, five workers, level III production costs and actual output, storage, node reserves and regrowth. Existing node identities and depleted state survive upgrades and reloads. Forty workers can deliver, return and be dismissed; worker progression and color persist through SQLite restart.
- Fourteen finance tests cover conservation, full-day investment eligibility, reserve-aware proportional dividends, earnings escrow, claim/reinvest, server-generated tavern outcomes, maximum-win funding checks, privacy, rollback and restart. Two real HTTP/WebSocket tests recover committed transactions, including receipts outside the twenty-entry display history and after the village falls, without charging again. Recent receipt queries use dedicated indexes; snapshots remain read-only.
- Eleven finance UI tests cover projections, exact/max actions, saved requests, matching committed receipts, animation/Skip, reduced motion and account changes. Sixteen crate UI tests preserve purchase and loadout recovery while checking illustrated tiers, results, odds and owned equipment. Forty-five settlement/worker UI tests and thirteen trading/guard UI tests verify their existing actions and new presentation.
- Twenty-nine focused world tests cover visible production and defense tiers, fitted veteran troop armor, disposal, bounded cannon impact pools and finite particle data. Impact effects appear at the saved target and cannot replay after reconnect or a hidden-tab time jump. The [production and cannon](previews/production-upgrades-build17.jpg), [defense](previews/defense-upgrades-build17.jpg) and [troop armor](previews/troop-upgrades-build17.jpg) previews use actual game meshes and were visually inspected. They are offline renders, not browser screenshots. The [settlement fixture](previews/settlement-build17.html) contains seven real HTML/CSS panels with live actions disabled.
- A local CPU sample used eight authenticated residents, forty hired workers and 8,000 durable finance receipts. One hundred cycles of all eight snapshots plus serialization measured **4.82 ms median / 7.08 ms P95**. One hundred simulation ticks measured **0.19 ms median / 0.69 ms P95**. These are local samples with mostly idle or returning workers, not sustained combat, Internet bandwidth or device frame-rate results.

The browser control surface blocked local preview access. Automated interface checks and offline model renders do not establish interactive menu layout, WebGL shader compilation, animation feel or long-run economy balance; those still need a desktop playtest. Validation used temporary databases and did not change production accounts, inventories or village funds.

## Build 16: a funded admin testing account

Validated 2026-09-15 on Node 24: **530/530 tests pass** with `npm test`. The four admin integration tests also pass after tightening the production night-control assertion. Changed runtime modules pass syntax checks, and the diff passes whitespace checks.

- Eight Store tests verify exact existing UUID authorization, one-time initial bank grants, ordinary ten-gold starts, per-village admin wallets, idempotent top-ups, preservation of larger balances, restart/login persistence, revoked access, nonexistent accounts and rollback/retry of failed bank and starter grants.
- Four integration tests use temporary SQLite databases and real HTTP/WebSocket clients. Missing or expired sessions cannot join; ordinary residents cannot gain privileges through forged IDs, amounts or admin flags. The private admin flag and balances are only included for their owner. The actual `startNight` action remains disabled in production mode.
- Refill affects only the authenticated tester's bank and active wallet. Downed, bed and mounted states can use it without changing health, healing, cooldown, equipment, loan credit, other residents or village funds. Repeated top-ups do not add more gold. A failed village save rolls back both bank and wallet before retry.
- Crate purchases still deduct the normal price and record a normal opening. Spent funds and crate history survive reconnect and process restart without another initial grant. A menu smoke check verifies that the refill button is present and wired only for the admin, while global development controls remain hidden.

The requested dedicated testing account was registered on the live game and its generated credentials were verified by signing in. Credentials are provided privately and are excluded from the repository. No existing player's funds or village data were edited. These checks do not constitute an interactive browser playtest.

## Build 15: persistent crates and equipment

Validated 2026-09-15 on Node 24: **518/518 tests pass** in the complete game suite. The final actor-cleanup change also passes the 15 focused crate UI/equipment tests. JavaScript syntax, local imports and unique HTML IDs were checked; `git diff --check` is clean.

The crate collection is connected to account progression, gameplay and the live character rig. This section records Build 15 checks; earlier sections describe the features available in their respective releases.

- SQLite tests cover the four tier prices, expanded equal pools, funding-specific duplicate refunds, shared credits, permanent ownership, consumable repeat drops, recorded-night milestone backfill and unique grants. Earned and credit-funded duplicates never create bank gold. Openings replay the saved result across restarts and concurrent HTTP/WebSocket requests.
- New-run loadouts grant physical equipment and bound kits once; returning residents migrate without supplies. Future choices do not change active equipment. Tests cover reconnect, used tool durability, manual-respawn forfeiture, stale village snapshots and preservation of ordinary replacement purchases. Failed opening, initial deployment and revival saves roll back account and world changes together.
- Real simulation tests verify shield-before-armor ordering, the 25% cap, Last Stand threshold/ward behavior and spent-cycle persistence, Phoenix health/inventory/wallet preservation, three-second protection and attack cancellation. Phoenix tests also cover carrying references, church-bed cleanup, escrow refund exactly once, stale requests and the one-use-per-run rule.
- Transfer, market, worker and trading tests exercise destination-specific pack weights, fractional capacity boundaries and unchanged storage weights. Bound food is excluded from transfers/sales/donations and consumed first; newly acquired gathering tools receive the buckle bonus without refilling existing tools or enhancing starting-kit tools.
- Eleven crate UI tests cover equal-odds disclosure, funding selection, complete receipts saved before payment, timeout and reload recovery, repeated clicks, committed-result animation/Skip, reduced motion, storage failure, ownership-only future loadout choices, draft preservation and account switching.
- Actual fitted models were checked for four-slot reuse, per-player material/resource ownership, role rebuilds, purchased-pack replacement and cleanup. The [equipped dwarf preview](previews/crate-equipment-build15.jpg) uses the actual live equipment manager and posed game meshes. It was visually inspected for face clearance and cross-slot layering.
- Live crate snapshots perform no writes or transaction acquisition. A local eight-player snapshot-and-serialization sample measured 3.09 ms median and 4.11 ms at the 95th percentile for all eight snapshots over 100 cycles. This is a local CPU check, not a production network or frame-rate result.

The browser control surface rejected the local preview URL with `ERR_BLOCKED_BY_CLIENT`. Model renders and automated DOM/controller checks do not establish interactive browser layout, animation feel, sustained eight-player frame rate or long-run crate balance. No production account, inventory or village was altered for QA.


## Build 14: interaction, trading, workers and connection recovery

Validated 2026-09-15 on Node 24: **461/461 tests pass** with `npm test`. Runtime and test JavaScript passed syntax checks, local runtime imports resolve, and `git diff --check` is clean.

- Real HTTP/WebSocket checks exercise authenticated joins, private snapshots, same-session reconnection, lost initial welcomes, stale socket fencing, delayed heartbeat responses, stalled connection cleanup, input bursts, explicit resync and legacy/patch client compatibility. Reconnection never queues or replays transactional actions.
- Priest tests cover healing public Watch guards and owned recruits, rejecting dead NPC guards, healing interruption, and immediate companion release. Pointer-lock/controller tests cover click capture, camera rotation, menu/blur/unlock release, repeat gathering cadence and cancellation, direct E horse controls and reachable treasury-board priority. A regression prevents repeated menu mouse movement from flooding movement packets.
- Storage tests preserve the typed amount `10` across input blur and live snapshots, verify exact/max transfer conservation and weight limits, and exercise store/take/deposit/withdraw at the same simulation time. Bank all-transfers persist through SQLite restarts. Cart ownership checks include packed, stored and deployed forms.
- Player trading tests cover two-sided latest-version confirmation, changed offers, duplicate confirms, private notifications, invalid amounts, current quantities, net pack capacities, gifts, cancellation, timeouts and atomic SQLite rollback/restart cancellation. UI tests verify draft preservation and safe literal names. Equipment, carts, account savings and loan credit are excluded.
- Worker tests verify productive nighttime work and wages, earned/spent attribute points, owner-only color changes, material isolation between dwarf models, retained XP/attributes/color after SQLite restart, and expanded delivery capacity. All three production building types validate upgrade costs, preserve depletion, regrow with level 2 reserves and reject invalid/duplicate upgrades atomically.
- Geometry and audio tests cover the new mine facade's clear approach/ramp, portal fixtures and disposal, four-profile sound variation without adjacent repeats, sound cooldowns and voice limits. The actual game geometry was rendered and visually inspected in [the Build 14 cave preview](previews/cave-build14.jpg).

This environment did not provide a live browser control surface. The mine preview uses actual meshes with offline lighting; it is not a live gameplay screenshot. Pointer-lock behavior, complete panel layout, sustained Internet multiplayer performance and economy balance still need a desktop playtest. Automated recovery tests cannot rule out hosting outages or every player-network failure. Existing accounts/villages are retained, and no production player data was modified during validation.

## Crate art preparation: 20 original models and a review gallery

The complete `npm test` run passes **409/409 tests**. All **73** runtime JavaScript modules pass syntax and local import checks. The game retains **76 unique HTML IDs**; the separate gallery has **26**, with its script, stylesheet and font paths resolving locally.

There are 19 crate-item designs and the Sunforged Viking Helm milestone trophy. Model checks cover finite geometry and normals, outward surface winding, all three jobs, skull and eye clearance, articulated shin/foot attachments, tool variants, material ownership and repeated disposal. Fitting hides only the original head covering, backpack group or boot surfaces as appropriate, preserves the face and beard, and restores prior visibility on removal. Default game characters retain their original batching; the optional equipment-preview mode preserves named head surfaces for the isolated gallery.

Camera checks use the actual model bounds across narrow/wide aspect ratios and rotated views. A sampled real pickaxe working animation stays inside the gallery frame on all three roles. Reduced motion disables optional glints and moving embers. The gallery uses generated studio reflections and existing Three.js lighting; it opens no account connection and sends no game actions. Its lifecycle preserves the canvas when the browser uses the back/forward cache.

All **20 GLBs** passed structural checks and a load through the installed GLTFLoader: bounds, mesh/triangle counts and embedded bump materials agree with the source geometry. Static exports total **12,781,672 bytes** and **429,172 triangles**. Export-only indexing preserves complete vertex attributes. JavaScript retains the procedural effects; the GLBs are static geometry/material snapshots with extensions documented in [CRATE-ART.md](CRATE-ART.md).

The [collection sheet](previews/crate-collection.jpg) and individual transparent item PNGs use actual authored geometry under offline studio lighting. Fitted armor, kit and Phoenix views were also inspected. These are geometry renders, not browser screenshots. The browser's URL policy blocked local HTTP and file previews; no live interactive browser or device-performance result is claimed. Gallery layout and feel still need review in a regular browser.

No crate currency, purchase/opening action, milestone grant, equipment bonus, starter supply or self-revival mechanic is enabled. Validation used temporary data and did not change production accounts or village balances.

## Build 13: resource exchange, illustrated building plans, nearby map and torches

The complete `npm test` run passes **384/384 tests**. All **65** runtime JavaScript modules pass syntax/local import checks, all local HTML assets resolve, and **76 HTML IDs** are unique.

Resource commerce now requires the Resource Exchange counter; banking and loans still require the treasury. Sell max computes the exact affordable carried quantity across price bands and tax rounding while keeping the treasury reserve. Tests cover incomplete custom quantity drafts, one protected sale action, changed prices or balances, stock/carry limits, and rejected transactions without partial mutations. Existing full-backpack and real WebSocket cave-mining tests now sell at the exchange while preserving their inventory, pricing and SQLite restart assertions.

The new building fits beside existing routes without changing any of the 48 plots or resource identities. Workers physically deliver sales there, including deep-cave journeys and concurrent sellers. Saved communal requests retain their identity, funding escrow, progress and withdrawal provenance while their delivery point/name migrates to the exchange. Existing saved occupants displaced by the new footprint retain cargo and gold when relocated to valid ground.

UI checks cover separate illustrated bank/market views, entrance access, exact trade payloads, live affordability, focus and draft preservation. The one-building carousel shows all 11 plans and preserves role, ownership, costs, conversion confirmation and keyboard navigation rules. Nearby-map checks cover player-centered projection, surface/cave ranges, marked destinations and actual rendering. The [minimap preview](previews/minimap.png) was produced with the real Canvas renderer and visually inspected. The [counter artwork](previews/shop-counter.svg), six [actual UI fixtures](previews/shop-ui.html), and building-plan illustrations were also inspected offline.

Torches use animated flame geometry and six pooled nearby lights. Checks cover outdoor daylight extinction, night lighting, cave fixtures staying lit, merchant presence, light selection, disposal and removal of old lantern fixtures. The actual flame shader compiled and rendered in Mesa OpenGL; day, dusk and two night animation frames were visually inspected in the [torch preview](previews/torches.jpg). The [Resource Exchange preview](previews/resource-exchange.jpg) uses the actual game geometry. These previews are not live browser screenshots.

Interactive browser control was unavailable in this session. Automated UI, simulation, network and offline rendering checks do not establish production browser layout, sustained frame rate or long-run balance. The complete update still needs an in-game playtest. Tests used temporary data; no production player data was modified during validation.

The approved crate credit prices and original item pool are recorded in [CRATE-PROPOSAL.md](CRATE-PROPOSAL.md), along with the proposed Phoenix Ember and Rare Mining Pack. Crate opening, credits, item grants, armor and self-revival remain unimplemented.

## Build 12: descending caves and visual storefronts

The complete `npm test` run passes **359/359 tests**. All **62** runtime JavaScript modules pass syntax/local import checks, all local HTML assets resolve, and **76 HTML IDs** are unique.

The public mineral map moves to the Deepworks while retaining every original resource identity and non-mineral location. Upper stone is guaranteed; middle/deep rolls follow the documented pools. Save migration retains wallet/bank gold, private plots, storage, depletion and timers. Real HTTP-authenticated WebSocket clients using full and patch snapshots agree on mining, exhaustion and regrowth. Reconnect, offline pause and two SQLite restarts cannot reroll available minerals or duplicate rewards. Harvested inventory and sale prices follow the actual mineral, independent of what a slot rolls later. Workers complete physical journeys from the treasury through the mine and back to sell the correct cargo.

Camera checks sweep yaw/pitch along each ramp and chamber transition, including interpolation through corners and entry from a high surface camera. The camera stays above floors and inside rock/ceiling headroom; a compressed view hides only the local dwarf until normal distance returns. Actors, horses, carts, rallies and harvest feedback use the shared ground height. Attack outlines and fills conform to ramp/landing seams across their complete triangles; committed centers/radii stay unchanged, terrain variants remain private, and outdoor attacks avoid terrain tessellation. Gathering prompts display the shared rolled type and reject a close node behind rock. The first-watch guide marks the mine entrance before leading to available stone underground. Existing plot approaches and neighborhood routes remain clear.

Shop checks cover distinct art for material tiers, durability/effect descriptions, recipe shortages, exact purchase payloads, preserved inspection state, focus and quantity drafts, safe player names, shop entrances, and native keyboard/touch disclosures. Request-board cards preserve their existing partial delivery and doorway validation. The six illustrated interiors and item art are local SVG with no external assets or duplicate SVG IDs.

The [cave preview](previews/cave.jpg) uses actual game geometry with offline lighting and was visually inspected. Its export contains 74,136 triangles including all 44 ore formations; the cave architecture uses 12 draw meshes and four pooled lantern lights without new shadow maps. Ceiling details remain attached above camera headroom. The [counter preview](previews/shop-counter.svg) composes the actual illustrations and UI fixture facts; it is an artwork/layout reference, not a browser screenshot. [Shop UI fixtures](previews/shop-ui.html) contain the real HTML/CSS for four service scenarios with disabled live actions. Interactive browser control was unavailable in this session. These geometry, DOM, audio, simulation and network checks do not establish production browser layout, perceived sound, sustained frame rate or long-run balance; those still need live playtesting.

Crate credits, armor and the gold helmet remain documentation-only in [CRATE-PROPOSAL.md](CRATE-PROPOSAL.md). No crate balances, opening actions or item grants are implemented in this update.

## Build 11: gate detail, well interior and physical request board

The complete `npm test` run passes **320/320 tests**. All **57** client/shared/server JavaScript modules pass syntax and local import checks; all local HTML assets resolve and **76 HTML IDs** are unique. The B shortcut is removed from the client.

The gate retains its original moving root, lift range, nearby-player opening rule and easing. New timber, metal fittings and fixed guides use eight material batches including the moving chain instances: 22,410 triangles when closed and 14,970 raised. Chain matrices change only when the gate moves. Fixed supports fit within the existing turret footprint. The well has inward-facing masonry and thick coping, with an open shaft and lower water surface; raycasts from inside in 24 directions at four heights confirm ordinary front-facing geometry instead of a one-sided outer cylinder. Its 13 material batches contain 10,904 triangles. Geometry, disposal, foliage clearances and road-junction regressions pass.

The [gate and well preview](previews/gate-well.jpg) was rendered from the actual game geometry and visually inspected in closed/raised and elevated/interior views. Its well roof is omitted to expose the stone lining, winding mechanism and bucket. Offline preview lighting does not reproduce the live renderer's procedural bump maps and shadows. In-game appearance and sustained frame rate still require a live playtest.

Request UI checks cover reachable board frontage, selecting the board versus the nearby bank door, retained gathering priority, preventing remote board access, and releasing the modal before walking to a marked destination. Treasury, public Watch and cannon entrances expose only their own requested deliveries. Quantity drafts and focused inputs survive snapshots; stale quantities, changed buildings and lost entrance access prevent sends. Existing server delivery validation, finite escrow, multiplayer and persistence tests remain green.

Only client artwork, request access, tests and documentation change. No server rules, balances, account statistics or saved village data change. The [crate and helmet proposal](CRATE-PROPOSAL.md) is documentation for review only: crates, new armor effects, starting kits and the gold helmet are not implemented in this release.

## Build 10: varied attacks, village requests and shared progression

The complete `npm test` run passes **313/313 tests**, including all earlier gameplay regressions. All **57** client, shared and server JavaScript modules pass syntax and local import checks. The HTML contains **76 unique IDs**, and its local script and stylesheet paths resolve.

Combat checks cover runners, armor, splitting husks and their three offspring, bounded enemy populations, graveyard emergence, fifth-night sieges, legacy enemies, and fixed warning circles whose damage uses the defenders' positions at impact. Sword cleaves hit each eligible enemy in the forward arc once, respect walls and the gate, and spend durability once. Guard animation windows match actual attacks. Both new and existing empty archer towers fire without ammunition; stored arrows remain cargo and cannon ammunition stays finite.

Seven early-dawn tests verify that the complete scheduled wave must spawn and every living enemy, including emerging offspring and older remnants, must be defeated. The final player swing or NPC/tower tick can begin dawn immediately. The normal deadline still advances a night with stragglers. Accrued wages, performance bonuses, the hidden survival grant, request expiry and honors commit once; a real SQLite failure rolls the final kill and dawn back together, and retry/restart cannot duplicate payment. Shortened-night honors require living participation for at least half the actual night rather than half its original maximum duration.

Request tests cover shortage detection, finite reward escrow, essential treasury/payroll reserves, partial doorway deliveries, loan repayment, cancellation/refunds, and persistent withdrawal provenance that prevents supply buyback loops. Troop-order checks enforce authenticated ownership and valid rally points, fallback when the owner cannot be followed, navigation around obstacles, and replacement troop inheritance. Progression checks cover additive account migration, private guide/unlock data, server-verified milestones and cosmetic selection, owned-property access and material cleanup.

A combined test runs HTTP authentication, two real WebSocket clients using patch and legacy snapshots, delivery rejection and payment, shared enemy warning timing, owner-only orders, public appearance choices, private progression, and SQLite restart with a funded request and active siege windup. An empty restarted village stays paused. Existing market concurrency tests account for public gold held in request escrow while preserving exact sale totals and stale-quote rejection.

Actual Three.js geometry was rendered and visually inspected for [enemy silhouettes](previews/zombie-variety.jpg), [grave emergence](previews/zombie-emergence.jpg), and [sword trails](previews/sword-trails.jpg). The trail shader compiled and rasterized in software OpenGL using the articulated sword geometry. Additional geometry previews checked character crests/sashes and property colors. Automated visual checks cover fixed ground warnings, animation transitions, disposal, pooled trails, reconnect suppression and frame timing. Procedural-audio tests verify gesture activation, persistent mute, bounded voices, footsteps, event deduplication and cleanup on pause/disconnect.

These checks do not establish interactive browser appearance, perceived sound quality, sustained multiplayer frame rate, or long-run balance. The available browser has no usable WebGL context, so the complete update still needs a live in-game playtest. No production player data was modified during testing; existing villages and account balances migrate in place.

## Build 09: foliage, moving clouds and the day/night sky

The complete `npm test` run passes **228/228 tests**. All 41 client, shared and server JavaScript modules pass syntax checks. The new timing metadata exposes the configured phase duration, fractional deadline and running state without changing the simulation clock or save format. Checks cover joining at each phase, rounded HUD countdowns, custom day/night lengths, bounded extrapolation during a stalled connection, phase boundaries, paused/fallen villages, and reconnects.

Sky checks verify continuous sunrise, noon, sunset and moon travel; gradual lighting, fog and visibility; camera-relative sky positioning with world-anchored directional lights; clock-driven cloud drift; and disposal. The [sky preview](previews/sky-cycle.jpg) was rendered and visually inspected using the actual Three.js geometry, shader code and cycle uniforms in a software OpenGL context. All six sky shader programs compiled and rasterized. A fixed-camera midday comparison at simulation seconds 180 and 300 confirms cloud motion (mean RGB difference 14.367/255). The preview follows the sun/moon to show the cycle; it is a sky-only render, not a browser gameplay capture.

Foliage uses 4,345 instances across seven draw calls and 163,660 triangles, with no new shadow casters. A shared wind uniform updates without rewriting instance matrices. Its actual material hook, expanded into Three's standard vertex shader with instancing, color, fog and shadow defines, compiles in a Mesa OpenGL ES 3.2 context. Deterministic placement checks cover complete plant footprints against actual curved roads, all 48 plots, buildings and entrances, church beds, resources, and the parked caravan. Existing road-junction checks remain green. A local geometry crop was inspected for plant scale and clear approaches. Camera tests verify normal player-centered orbit and upward viewing while keeping the physical camera above ground and collision rays anchored to the dwarf.

Interactive browser appearance and sustained multiplayer frame rate still need a live playtest. Existing villages, accounts, balances, resource identities, phase lengths and gameplay rules are preserved.

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
