# Crate equipment art

This original Emberwatch art pack contains **20 models: 19 proposed crate items and the Sunforged Viking Helm, a proposed day-100 trophy**. It is an art and fitting package. It does not implement crate opening, drops, unlocks, inventory grants, damage reduction, carrying bonuses, starter supplies, self-revival, or Last Stand. The catalog and gallery describe those effects as planned features.

## Explore the collection

Open `/crate-gallery.html` on the running game server. The Reliquary gallery presents individual items and fitted dwarf previews, collection filters, warm or moonlit lighting, and an option to reduce animation and sparkles. Wearable pieces can be inspected on villagers, guards, and priests. Expedition kits offer an axe, pickaxe, or scythe choice.

An item ID in the URL fragment selects a model directly, for example `/crate-gallery.html#sunforged_viking_helm`.

Drag to rotate and scroll to zoom. The canvas also supports arrow keys for rotation, plus/minus for zoom, and **R** to reset. The gallery's **Save render** button saves the current view. These controls preview the art; they do not equip a player's saved account.

## Catalog

The authoritative names, classifications, designs, and proposed effects are in [crate-catalog.js](../public/src/crate-catalog.js). IDs remain stable across the JavaScript factory and exported filenames.

| ID | Model | Collection | Attachment |
| --- | --- | --- | --- |
| `padded_cap` | Padded cap | Basic | Head |
| `stout_leather_boots` | Stout leather boots | Basic | Feet |
| `foragers_pouch` | Forager's pouch | Basic | Body utility |
| `hearth_ration_kit` | Hearth ration kit | Basic | Display bundle |
| `iron_coif` | Iron coif | Rare | Head |
| `riveted_vest` | Riveted vest | Rare | Body |
| `miners_buckle` | Miner's buckle | Rare | Body utility |
| `tradesmans_kit` | Tradesman's kit | Rare | Display bundle |
| `mining_pack` | Mining Pack | Rare | Body utility |
| `lumber_pack` | Lumber Pack | Rare | Body utility |
| `tempered_cuirass` | Tempered cuirass | Epic | Body |
| `runed_helm` | Runed helm | Epic | Head |
| `deep_delvers_belt` | Deep-delver's belt | Epic | Body utility |
| `prospectors_kit` | Prospector's kit | Epic | Display bundle |
| `runeforged_cuirass` | Runeforged cuirass | Legendary | Body |
| `dawnsteel_helm` | Dawnsteel helm | Legendary | Head |
| `guardians_boots` | Guardian's boots | Legendary | Feet |
| `master_expedition_kit` | Master expedition kit | Legendary | Display bundle |
| `phoenix_ember` | Phoenix Ember | Legendary | Display object |
| `sunforged_viking_helm` | Sunforged Viking Helm | Hundredth Watch | Head |

## JavaScript factory

Import [crate-assets.js](../public/src/crate-assets.js):

```js
import { createCrateAsset, CRATE_REST_ANCHORS } from './crate-assets.js';

const asset = createCrateAsset('sunforged_viking_helm', {
  tool: 'pickaxe',
  backpackTier: 0,
});
scene.add(asset.root);
asset.update(elapsedSeconds, { reducedMotion: true });
```

`tool` accepts `axe`, `pickaxe`, or `scythe`; the default is `pickaxe`. `backpackTier` accepts an integer from 0 through 3. Unknown item IDs and invalid factory options throw an error.

| Member | Purpose |
| --- | --- |
| `root` | A Three.js group containing the item at its display/rest anchors. Add it to a scene for a standalone study or export. |
| `parts` | Attachment records with a bone name, owned Three.js object, and optional names of original objects to hide. Display bundles may have unbound parts. |
| `fit(character)` | Moves wearable parts onto matching bones of an existing natural dwarf rig. Accepts the character API object or its group. Returns `root`. |
| `unfit()` | Returns parts to their display anchors and restores the original objects' saved visibility. |
| `update(time, options)` | Updates procedural presentation effects. Time is in seconds; `{ reducedMotion: true }` reduces motion where supported. |
| `setBackpackTier(tier)` | Updates the cosmetic model's backpack-tier metadata for valid tiers. It does not purchase equipment or change capacity. |
| `fitted` | Reports whether the asset is attached to a character. |
| `dispose()` | Unfits the item, restores hidden originals, detaches the root, and disposes its owned resources. Safe to call more than once. |

Kits and the Phoenix Ember are standalone display objects. Calling `fit()` on a non-wearable item throws. A wearable also requires the expected Three.js bones; a generic group with similarly named meshes is insufficient.

### Fit the existing dwarf rig

```js
import { createCharacter } from './characters.js';
import { createCrateAsset } from './crate-assets.js';

const dwarf = createCharacter('villager', 1, { equipmentPreview: true });
dwarf.setBackpackTier(2);
scene.add(dwarf.group);

const pack = createCrateAsset('mining_pack', { backpackTier: 2 });
pack.fit(dwarf);

// In the existing frame loop:
dwarf.update(deltaSeconds, elapsedSeconds, {
  moving: true,
  backpackTier: 2,
});
pack.update(elapsedSeconds, { reducedMotion: false });

// When removing this preview:
pack.dispose();
dwarf.dispose();
```

The gallery uses `createCharacter(role, seed, { equipmentPreview: true })` to preserve separately named head surfaces. This lets a fitted cap, coif, or helm hide the original hair, hood, or helmet and restore it when removed. Use that opt-in mode for headwear review; ordinary game characters retain their existing batching behavior.

The character supplies joint animation. Equipment follows its attachment bones through movement rather than running a separate character animation. If the character's role rebuilds its rig, unfit the equipment before the rebuild and fit it again afterward. Dispose the previous asset when replacing equipment so visibility restoration remains under one owner.

The Mining Pack and Lumber Pack declare `hideNames: ['worn-backpack']`. Fitting either hides the ordinary purchased `worn-backpack` group, then restores its prior visibility when removed. This changes the silhouette only: purchased backpack tier, carrying capacity, item weight, and inventory remain untouched.

### Rest coordinates

`CRATE_REST_ANCHORS` places separate attachment parts into a consistent static dwarf pose. Coordinates are in meters, with **+Y up and +Z toward the face/chest**. Each component's geometry remains local to its attachment bone.

| Bone | Rest position `[x, y, z]` |
| --- | --- |
| `head` | `[0, 1.80, 0.01]` |
| `body` | `[0, 1.04, 0]` |
| `leftShin` | `[0.21, 0.42, 0]` |
| `rightShin` | `[-0.21, 0.42, 0]` |
| `leftFoot` | `[0.21, 0.17, 0.015]` |
| `rightFoot` | `[-0.21, 0.17, 0.015]` |
| `hand` | `[-0.48, 0.76, 0.035]` |

Use the named bones for live fitting. The rest coordinates describe static display placement; they are not substitutes for the animated bone transforms.

## Static GLB export

From the repository root, run:

```sh
node scripts/export-crate-assets.mjs
```

The export uses Three.js and an already installed `@napi-rs/canvas` package. It resolves the canvas package locally or through `CODEX_PRIMARY_RUNTIME_NODE_MODULES`; it does not install dependencies or contact the network. The generated GLBs can be served without running this export script on the production server.

The exporter writes one file for each of the 20 catalog models to `public/assets/crate-items/<id>.glb`, plus `public/assets/crate-items/manifest.json`. The kit exports use the default **pickaxe** option. The JavaScript factory and gallery retain the other gathering-tool choices.

Exports use the rest anchors for static placement. The manifest records each model's attachment bones, anchor positions, original-object hide names, bounds, file size, mesh and triangle counts, embedded images, and glTF extensions. Gallery lighting, cameras, and the studio environment are separate from the exported item assets.

### Materials and animation

The GLBs retain authored color, roughness, metalness, clearcoat, emissive properties, and vertex colors. Procedural textile bump maps are encoded as embedded PNG images, preserving their texture transforms and bump strength. Bump detail uses `EXT_materials_bump`; receiving renderers need that extension to display it. The manifest also records use of `KHR_texture_transform`, `KHR_materials_clearcoat`, and `KHR_materials_emissive_strength` where applicable.

Export runs at time zero with reduced motion enabled. Base emissive geometry remains visible, but the Sunforged helmet's glints and the Phoenix Ember's moving spark particles are omitted from this static state. Glow modulation, sparkle timing, and ember drift remain in the JavaScript factories. There are **no baked animation clips** and no animated dwarf skeleton in these files.

### Export validation

The current 20 GLBs total **12,781,672 bytes (12.19 MiB)** and **429,172 triangles** across the complete collection. These totals describe all exported items together, not a single equipped character.

The exporter checks GLB structure, embedded buffers and PNG images, then loads every file through Three.js `GLTFLoader`. Round-trip checks preserve mesh counts, triangle counts, fitted bounds, and bump-material counts. The generated [manifest](../public/assets/crate-items/manifest.json) contains per-item measurements. This validation checks the assets and their serialization; it does not establish frame rates or appearance in every browser or third-party glTF viewer.
