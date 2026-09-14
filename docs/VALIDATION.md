# First Light build validation

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
