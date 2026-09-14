# Character design update

The dwarfs and zombies retain their original articulated rigs with smoother silhouettes and shading. Rounded faces, inset eyes, fuller beard locks, contoured clothing, softened boots and armor, and raised headwear make the characters easier to read. Guard armor and villager straps also distinguish them from behind, where the third-person camera usually sits.

![Revised villager, guard, priest and zombie models](previews/characters.jpg)

This is a CPU render of the actual game meshes, using interpolated normals, a depth buffer, and fixed studio lighting. It is not a live-game screenshot; the game uses its own WebGL lighting and shadows. No generated concept art or external character assets are used.

## Validation

The existing animation probe passes at 30, 60 and 120 Hz across seven role/tool combinations. A further 8,640 animation frames exercise four roles, eight equipment types and all three tiers, including mounting, carrying, downing, role changes and disposal. Geometry, normals and transforms remain finite. Six multiplayer motion tests pass. Server rules, saves and networking are unchanged by this character update.

Mesh counts stay unchanged in the neutral equipped preview. Triangle counts increase to soften the shapes:

| Character | Previous triangles | Revised triangles | Meshes |
| --- | ---: | ---: | ---: |
| Villager | 2,528 | 8,616 | 32 |
| Guard | 3,304 | 10,608 | 40 |
| Priest | 2,716 | 8,692 | 30 |
| Zombie | 1,638 | 5,284 | 25 |

These counts describe this pose and equipment, not a frame-rate guarantee. Geometry and materials are cached, and rigid details are merged per joint/material as before. Eight-player and large-wave performance still require a live playtest. Front and rear CPU renders were inspected and used to correct headwear occlusion and major armor/robe intersections. The available cloud browser has WebGL disabled, so this revision has not been visually playtested there.

## Reproduce the preview

From the repository root, with normal npm dependencies installed and Python with NumPy, Pillow and DejaVu Sans available:

```sh
node scripts/preview-characters.mjs public/src/characters.js /tmp/characters.json
python scripts/render-character-preview.py /tmp/characters.json /tmp/characters.jpg 'EMBERWATCH  /  CHARACTER UPDATE'
```

Pass `2.86` as a fourth argument to the exporter for the reverse view. The preview scripts are development tools and are not loaded by the game.
