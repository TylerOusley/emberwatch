# Emberwatch

An original cooperative 3D dwarf village survival game. **Emberwatch is a working title.** This is a standalone project with newly written client, server, and game systems; it does not import or depend on the code from Tyler's existing games.

**First Light — playable build 02.** This early prototype establishes the village's appearance, third-person movement, shared gathering, NPC combat, and persistent multiplayer sessions. The full accepted game design is preserved in [docs/DESIGN.md](docs/DESIGN.md). The complete economy, player construction, and all planned content are still future work.

## Current scope at a glance

| Available in build 02 | Still planned |
| --- | --- |
| Multiplayer, three roles, gathering, gate defense, priest healing/revival, repairs, banking, bread, and persistent hunger HUD. | Player plots, construction, role changes, owned shops and barracks, towers, church beds/carrying, horses/carts, and loans. |
| Sell wheat, timber, and stone at the treasury for stock-based prices. | The complete market, transaction/land taxes, full job bonuses, merchant exports, votes and steward decisions. |
| Wooden tools and one bread item. | Stone/iron equipment, additional resources and food tiers. |

Build 02 also improves entrance orientation, village paths, tool-specific animation, and remote movement interpolation. **The full game plan is not complete.** The in-game village menu has a **Build status** button listing this boundary.

## Run on your computer

Install a current **Node.js 24** release from [nodejs.org](https://nodejs.org/en/download). This server uses Node's built-in SQLite module. Open a terminal or Windows PowerShell inside this project's folder:

```sh
npm ci
npm start
```

Open **http://localhost:3000** in a desktop browser with WebGL support. Keep the terminal open while playing. Stop the server with Ctrl+C. To restart while developing server files, use `npm run dev`.

Create an account, create or join a village, and select Guard, Priest, or Villager. These accounts belong to this game, independently of the existing website's accounts.

## What the prototype includes

- A 3D fortified village, one southern gate, a keep, woodland, wheat, quarry resources, and a graveyard approach.
- Animated dwarf and zombie characters, third-person movement, and keyboard/mouse controls.
- Server-controlled movement, resource gathering, combat, structure damage, repairs, and day/night timing.
- Public village browsing with online and offline resident counts. Eight saved residents fill a village even when some are offline; a returning member uses their reserved place.
- Guard, Priest, and Villager roles; priest healing and revival.
- Two initial NPC guards for testing road movement and cooperative defense. Player-owned barracks and recruitment are future work.
- Wooden gathering tools and hammer durability, replacement-tool purchases, bread purchases, personal resources, shared village stock, and repairs paid at dawn with a ten-gold allowance per cycle.
- Stock-priced selling of wheat, timber, and stone at the treasury, with exact bundle quotes, finite treasury funds, and a 500-gold purchasing reserve.
- Hunger displayed below health at all times during play, including a low-hunger warning.
- Persistent accounts, personal bank balances, and village state in SQLite.
- An eight-minute day and four-minute night. Empty villages pause. Zombie difficulty increases in five-night bands, and keep destruction ends a run.
- Downed players wait until dawn before manually choosing respawn. A revival can preserve their belongings.

The visible shop and church buildings help establish the intended village layout. Their presence does **not** mean every planned shop, bed, recipe, and building feature is implemented.

For this prototype, a new account receives 50 wallet gold once and a full set of wooden tools so every activity can be tried immediately. Each account has one active village; its place remains reserved until that run ends. The selected job is saved with that character. In-run job changes and releasing an active membership are future features.

| Prototype balance setting | Current value |
| --- | --- |
| Carry capacity | 60 items, without different item weights yet. |
| Wooden gathering tool / hammer | 100 successful uses; replacement costs 10 gold after it breaks. |
| Wooden sword | No durability loss in this milestone. |
| Bread | 5 gold and 2 village wheat; restores 35 hunger when eaten. |
| Gate repair | Up to 35 health for 1 village timber. |
| Keep repair | Up to 35 health for 1 village timber and 1 village stone. |
| Priest healing | 30 health after a 2-second channel. |
| Priest revival | 45 health after a 5-second channel. |
| Initial NPC guard supplies | 12 wheat in the public prototype barracks. |

These starter supplies and simplified recipes are test defaults. The later ownership, tiered tools, food tiers, and complete market rules are described separately in the design document.

## Resource selling in build 02

Visit the treasury and press **E**. Each resource offers **Sell 1**, **Sell 10**, and **Sell all** with the total payment shown. The sale adds the resources to village stores and moves gold from the public treasury to your wallet. Personal bank savings are separate. Donating remains optional and pays no gold.

| Village stock before each unit | Wheat | Timber | Stone |
| --- | --- | --- | --- |
| 0–24 | 4 gold | 5 gold | 5 gold |
| 25–99 | 3 gold | 4 gold | 4 gold |
| 100–299 | 2 gold | 3 gold | 3 gold |
| 300–999 | 1 gold | 2 gold | 2 gold |
| 1,000+ | 1 gold | 1 gold | 1 gold |

These are provisional balance values. Bundles use the price of **each unit at its resulting stock level**, so a bundle crossing a price band is not overpaid. At stock 24, selling two wheat pays 4 + 3 = 7 gold. If another player lowers the price before your sale arrives, the server rejects it and asks you to review the updated quote. Sales never partially complete, and purchases stop before spending the treasury's last 500 gold. Other village expenses may still use that reserve.

## Controls

| Input | Action |
| --- | --- |
| W / A / S / D | Move. |
| Shift | Sprint. |
| Hold right mouse and move the mouse | Turn the camera. |
| Left mouse | Use the selected tool or ability. |
| Number keys | Select the corresponding hotbar slot. |
| E | Interact with a nearby service. |
| I | View personal supplies and village stores. |
| H | Open controls and help. |
| Escape | Open the village menu. |

Use an axe on trees, a pickaxe on quarry stones, and a scythe on wheat. Equip the hammer near a damaged gate or keep to repair it. The priest blessing is for another injured or downed dwarf within reach.

## Try multiplayer

1. Start the server and join a village in one browser.
2. Open another browser or a private window, register a different account, and join the same village. Both characters should appear in the same world. Two normal tabs may share the same stored login.
3. Gather timber, stone, and wheat using their corresponding tools. Check that nearby resources change for both players and that successful actions reduce tool durability.
4. Bring resources to the Village Treasury and sell or donate them to village stock, then repair a damaged gate or keep with the hammer. Verify that stock is consumed and repair earnings stop increasing after ten successful rewarded repairs in the cycle.
5. Defend together at night. Check that zombies approach along the road, engage defenders, and damage an undefended gate. Try priest support with the second player.
6. If a dwarf is downed, wait for dawn and choose whether to revive them or click respawn. Respawn should require a player action.
7. Deposit wallet gold in the bank, leave, and sign in again. Close both game sessions and confirm that returning to the village resumes its paused simulation.
8. Stop the server cleanly, restart it with the same data directory, and verify that the accounts, bank balances, and saved village are still present.

These are manual checks to perform on your own machine and, later, on the hosted service. They are not a claim that a public Railway deployment has already been tested.

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

The game runs its authoritative simulation in one Node process. Use **one service replica** for this prototype. Multiple replicas would run different in-memory worlds and require a different coordination and persistence design.

Preserve the entire data directory. For a manual backup, stop the application cleanly before copying it; do not copy only the main database file while the server is writing to it. Keep test databases separate from real player saves. The included ignore files exclude local saves and environment files from normal Git commits and Docker builds.

Account passwords are salted and hashed with scrypt; the database stores hashed session tokens. This is an initial account system, with no email recovery or shared website login. Account administration, operational monitoring, restore drills, and broader abuse/load testing remain work for a public release.

## Deploy as a separate Railway service

The project is available in [TylerOusley/emberwatch](https://github.com/TylerOusley/emberwatch). Tyler has deployed it on Railway at https://www.bobbybgames.com. For a new deployment, use these settings:

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
| `shared/world.js` | Shared map geometry and gameplay constants. |
| `test/` | Automated checks for supported prototype behavior. |
| `docs/DESIGN.md` | Accepted design, provisional balance values, and remaining milestones. |
| `Dockerfile` | Standalone Node 24 runtime for Railway or local Docker. |

Run the automated checks with `npm test`. Browser performance and visual quality should also be checked on the actual computers that will play the game.

### Windows shortcut

After installing Node.js 24 or newer and extracting this folder, double-click `START-WINDOWS.cmd`. The launcher installs the pinned dependencies on the first run, starts the game server, and prints the local address. Open `http://localhost:3000` in a browser and keep the terminal window open while playing.

### Art and dependencies

The village geometry, characters, animations, interface, and gameplay code were created for Emberwatch. No code from the existing games was copied. Cinzel and DM Sans font files are bundled locally under the included SIL Open Font License notices in `public/fonts/`. Three.js and ws are installed through npm under their package licenses. The game makes no runtime CDN requests for fonts or rendering code.

See `docs/VALIDATION.md` for the checks performed on this build.
