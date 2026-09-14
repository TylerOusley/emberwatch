# First Light build validation

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

This is the first playable foundation. It is not the full design in DESIGN.md. Player plots and owned buildings, upgraded tools, the market and steward, taxes, loans, horses, church beds, and advanced NPC navigation are later milestones.

Railway has not been deployed or inspected. These checks do not establish a hardware frame-rate target or simultaneous multi-village hosting capacity. Test on the target computers and configure the persistent Railway volume before retaining real player progress.
