# Build 32: late-game enemy pressure review

Status: provisional local balancing changes for review. Not published or deployed.

## Why established villages stop facing new problems

The current curve adds a difficulty band every five nights. Before this local
change, the ordinary composition is effectively fixed from night 3 onward:
each 28-slot cycle has 15 shamblers, 5 runners, 4 Ironbound and 4 Brood husks.
Every fifth night replaces the first slot with exactly one Gravebreaker.

Several other difficulty controls eventually stop growing:

| Control | Existing behavior | Stops increasing |
| --- | --- | --- |
| Main wave size | `min(80, 5 + 3 × online players + 5 × band)` | Night 56 with 8 players; 66 with 4; 76 solo |
| Attack damage | Base damage plus at most 15 | Night 41 |
| Movement speed | Base speed plus at most 0.65 | Night 46 |
| Spawn spacing | `max(1.5, 6 − 0.4 × band)` seconds | Night 61 |
| Structure damage | Base structure damage plus at most 35 | Night 91 |
| Enemy behavior and composition | Same roles, same route, one fifth-night siege | No later introductions |

Health continues rising. Ordinary enemies gain 14 health per band, brood
children gain 3, and the Gravebreaker gains 55 plus its existing population
bonus. That eventually makes later nights mainly longer versions of familiar
fights. Increasing health alone would amplify that weakness.

The defense side has several effective answers to a repeated single-lane wave:
upgraded cannons deal 72 damage in a 3.5 m splash; upgraded wizard towers chain
to three enemies; the communal trebuchet deals 100 damage in a 5 m splash.
Veteran archers and musketeers also add repeatable ranged damage. These are
code-level reasons to test more simultaneous pressure and tougher composition;
they are not a claim that live player combat was profiled or balance-tested.

## Local change for review

Nights 1–20 keep their exact previous enemy sequence and spawn spacing.
Health, damage, movement, armor, rewards, wave sizes and attack warning windows
keep their existing formulas at every night.

| Starts | Composition adjustment | Spawn interval adjustment |
| --- | --- | --- |
| Night 21 | More runners: 8 of each 28 ordinary slots, previously 5 | Existing interval multiplied by 0.9 |
| Night 31 | More Ironbound: 8 of each 28 ordinary slots, previously 4 | Keep the 0.9 multiplier |
| Night 41 | Keep the established mix | Existing interval multiplied by 0.8 |

The night-31 mix has 9 shamblers, 7 runners, 8 Ironbound and 4 Brood husks per
28 slots. One additional Ironbound slot replaces a runner, so the runner count
drops from 8 to 7 at that stage. Fifth-night boss replacement remains separate.
Brood slots are preserved throughout; no brood children enter the scheduled
wave directly.

The interval floor remains **1.5 seconds**. This is a 10%/20% reduction in the
interval, corresponding to about 11%/25% more spawns per unit time before the
floor is reached. It does not create more scheduled enemies. The battlefield
limit remains 120 live enemies with room reserved for brood children. A full
battlefield delays a scheduled slot instead of consuming it.

Examples:

| Night | Previous interval | Local interval |
| --- | ---: | ---: |
| 20 | 4.80 s | 4.80 s |
| 21 | 4.40 s | 3.96 s |
| 31 | 3.60 s | 3.24 s |
| 41 | 2.80 s | 2.24 s |
| 51 | 2.00 s | 1.60 s |
| 56 | 1.60 s | 1.50 s |
| 100 | 1.50 s | 1.50 s |

The intent is to make upgraded villages handle more fast attackers and armored
front-line enemies together, while preserving the existing performance budget
and readable attacks. This is deliberately a modest first adjustment. Playtest
solo and populated villages around nights 20/21, 30/31 and 40/41 before judging
whether another difficulty step is needed. Useful observations are how often
enemies reach the gate, player intervention required, defender losses, and
ammunition spent—not just time until the wave ends.

## New enemy ideas to discuss, not implemented

**Recommended: Gravecaller.** A rare support enemy with a visible 2.5-second
ritual that raises two ordinary shamblers in marked spots near itself, once per
Gravecaller. Killing it before the ritual completes cancels the summons. The
summons obey normal collision, stay on the same side of an intact gate, respect
the shared live-enemy limit, and cannot spawn more summoners. Each summoned
shambler remains eligible for the normal kill/assist gold, so the mechanic does
not change the player's requested uncapped bounty rule. A once-only ritual
also avoids an endlessly farmable summoning loop. Start with one rare slot in
later waves; choose the exact debut night and health after agreement. This
creates a clear priority target and an active decision for ranged defenders.

**Alternative: Plaguebearer.** A slow enemy that leaves a short-lived, clearly
marked cloud when killed. The cloud damages defenders who remain inside it,
does not block movement, and cannot damage across walls or a closed gate.
It adds positioning pressure rather than more health. It needs readable ground
warnings and deliberate guard movement behavior before release so it does not
simply punish stationary NPC defenders.

No new enemy kind, art, spell, summon system, poison damage or collision rule is
included in the current local changes. These concepts require a separate choice.

## Verification and source locations

Focused tests cover exact early-night compatibility, late composition and
cadence boundaries, unchanged real-wave count and per-enemy combat stats,
the one-boss contract, ordinary brood slots, and crowded-battlefield recovery.
Existing enemy and bounty integration tests also pass.

Relevant code: `shared/enemies.js`, `server/enemies.js`,
`server/simulation.js` (`startNight`), `shared/defense.js`, `shared/troops.js`,
and `shared/civic.js`. Regression coverage: `test/enemies.test.js` and
`test/zombie-bounties.integration.test.js`.
