# Graphics assets — Build 18

Emberwatch locally hosts seven complete PBR material sets from Poly Haven. The 21 maps are the original 1024 × 1024 JPEG downloads, unchanged apart from descriptive local filenames. Total: **13,363,437 bytes (12.75 MiB)**. They require no third-party network requests while playing.

The separately sourced NASA Moon texture is documented in [Sky assets](SKY-ASSETS.md).

## License and provenance

All listed textures are released under **CC0 1.0**. Poly Haven explicitly permits commercial use and redistribution, including distribution inside a game: [official asset license](https://polyhaven.com/license), [CC0 1.0 deed](https://creativecommons.org/publicdomain/zero/1.0/). Verified and downloaded on 2026-09-16. No asset previews, branding or other website artwork are included. Source asset attribution follows as a courtesy.

| Surface | Original asset | Author | Maps |
| --- | --- | --- | --- |
| Moss and grass ground (`grass`) | [Aerial Grass Rock](https://polyhaven.com/a/aerial_grass_rock) | Rob Tuytel | Albedo, OpenGL normal, roughness |
| Forest earth (`earth`) | [Forest Ground 01](https://polyhaven.com/a/forrest_ground_01) | Rob Tuytel | Albedo, OpenGL normal, roughness |
| Weathered rock (`rock`) | [Rock 01](https://polyhaven.com/a/rock_01) | Rob Tuytel | Albedo, OpenGL normal, roughness |
| Worn cobbles (`cobble`) | [Cobblestone Floor 08](https://polyhaven.com/a/cobblestone_floor_08) | Rob Tuytel | Albedo, OpenGL normal, roughness |
| Aged timber (`wood`) | [Wood Planks](https://polyhaven.com/a/wood_planks) | Amal Kumar | Albedo, OpenGL normal, roughness |
| Castle masonry (`masonry`) | [Castle Brick 01](https://polyhaven.com/a/castle_brick_01) | Rob Tuytel | Albedo, OpenGL normal, roughness |
| Weathered tiles (`roof`) | [Roof 07](https://polyhaven.com/a/roof_07) | Rob Tuytel | Albedo, OpenGL normal, roughness |

## Runtime material integration

`public/src/surface-materials.js` provides:

- `createSurfaceMaterial(kind, options)` returns a unique `THREE.MeshStandardMaterial`, sharing the bounded texture cache.
- `applySurface(material, kind, options)` adds the same mapping to an existing standard/physical material, preserving its color, roughness, custom compilation hook and other standard properties.
- Options: `worldScale` is texture tile width in world units; `normalStrength` sets relief (0–2); `colorStrength` blends source albedo with white (0–1). The factory also accepts standard material options, including `color`, `vertexColors`, `flatShading` and `side`.
- Kinds: `grass`, `earth`, `rock`, `cobble`, `wood`, `masonry`, `roof`. Aliases: `soil`/`dirt` → earth, `path`/`cobbles` → cobble, `stone` → masonry, `timber` → wood. `plaster` uses weak rock detail without masonry joints.
- `configureSurfaceTextures({anisotropy, normalMaps})` changes loaded and future texture filtering and relief. The renderer should clamp anisotropy to its supported maximum first.
- `surfaceTextures()` exposes current shared textures for inspection; `surfaceTextureStatus()` exposes loading status. Dispose individual materials normally; do not dispose shared maps during per-village or per-prop cleanup.

World-space triplanar projection uses the complete object and instance transforms. It therefore maintains consistent scale on arbitrary meshes, including nonuniformly scaled instances and terrain without UVs. Normal-map slopes are reoriented per projection and applied in world space before conversion to the Three.js lighting space. Albedo maps are tagged sRGB; normal and roughness maps remain linear data. Mipmap filtering and bounded anisotropy reduce distant shimmer. Source colors multiply the material/vertex tint; use pale tints or reduce `colorStrength` when retaining an existing strong palette. Geometry and authored silhouettes are unchanged by this helper.

Custom map uniforms retain valid 1-pixel white/neutral fallbacks until images load. Failed requests leave those fallbacks in place. The module and material factory run in Node without a browser, and textures start loading only when a real browser document API is available. Texture requests and GPU maps are shared across material instances; scene replacement does not issue a new set of requests.

## Exact local files and download integrity

The machine-readable [asset manifest](../public/assets/surfaces/manifest.json) also records source URLs, byte lengths, roles and SHA-256 hashes. The following files live under `public/assets/surfaces/`.

| Local file | Bytes | SHA-256 | Original download |
| --- | ---: | --- | --- |
| `grass-albedo.jpg` | 666,655 | `57b8041bfe0d0f01430e4dbaad45e7ddddf0a9fc97317f90dbc51f7b0d9e1b5d` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_grass_rock/aerial_grass_rock_diff_1k.jpg) |
| `grass-normal.jpg` | 904,956 | `1aa3e23bff453f152e089b9f83aa36b4901651e019f7e2ca01d5331a9bbbda78` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_grass_rock/aerial_grass_rock_nor_gl_1k.jpg) |
| `grass-roughness.jpg` | 362,214 | `b9f3f76aba74007f708333c0dbe73c52eb83ea0c4187a13e2e994f888a25114a` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_grass_rock/aerial_grass_rock_rough_1k.jpg) |
| `earth-albedo.jpg` | 833,711 | `3dd6875cb3908e022a3c45ebbffa5e84c670ff2691fbbb6dc9ea4bff88523800` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/forrest_ground_01/forrest_ground_01_diff_1k.jpg) |
| `earth-normal.jpg` | 1,428,763 | `32528a7cdee962cc0b248ee4023a74d0df175737ea90e1eb425122351e0bdab4` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/forrest_ground_01/forrest_ground_01_nor_gl_1k.jpg) |
| `earth-roughness.jpg` | 257,165 | `30d8b56a03d7b12da16f58011b675662a40e58e1cdc768119a5f03968140058c` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/forrest_ground_01/forrest_ground_01_rough_1k.jpg) |
| `rock-albedo.jpg` | 688,083 | `0b5f0418eb1e686190c5d33bb54c400b1f9ed58813b5e34aa5e573a5197302b5` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_01/rock_01_diff_1k.jpg) |
| `rock-normal.jpg` | 798,807 | `7a7146f51159a7667233c2c14c34ff18a9f4374cc8869d53a1162648d0941023` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_01/rock_01_nor_gl_1k.jpg) |
| `rock-roughness.jpg` | 383,709 | `e98b9c8ffb35513bd7b36a8730bf9745d05325376a85fae87ebf56a7c071a123` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_01/rock_01_rough_1k.jpg) |
| `cobble-albedo.jpg` | 585,727 | `ec131f7a99a1e7f9df25d4725609c55a6dad1df487630685e9a66ecbf41ec33a` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/cobblestone_floor_08/cobblestone_floor_08_diff_1k.jpg) |
| `cobble-normal.jpg` | 1,002,410 | `26bfff70b266a4e86983814c7e56a9b48daf93cd34dcdc16a5db13e4fabcfbb6` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/cobblestone_floor_08/cobblestone_floor_08_nor_gl_1k.jpg) |
| `cobble-roughness.jpg` | 408,718 | `f92bcaf897cd98bc3cf11e6409b3e42145e7d0f659eaaad8807dfb0c5d16afc6` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/cobblestone_floor_08/cobblestone_floor_08_rough_1k.jpg) |
| `wood-albedo.jpg` | 609,525 | `3b0669f683e4bf10f5a55a381cfa9669a7b8dfd921901829daa3b35acc2bbdec` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_planks/wood_planks_diff_1k.jpg) |
| `wood-normal.jpg` | 652,441 | `d02abf113e17a8abe97e1be3e9d6d88add242e8c2291e2200d37aa8c68909f25` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_planks/wood_planks_nor_gl_1k.jpg) |
| `wood-roughness.jpg` | 299,757 | `1b7f115bfa25619b0a2db554eb1ab88a6fc5ef0b74ba4890611eae04d00b9829` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_planks/wood_planks_rough_1k.jpg) |
| `masonry-albedo.jpg` | 693,571 | `3823fdc4bcb37cc7b26fd7e3b2a80e82f5a23354d22d84eb0ca277909f923b2c` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/castle_brick_01/castle_brick_01_diff_1k.jpg) |
| `masonry-normal.jpg` | 1,069,379 | `f3c4c0538fd5c3f9e1aabcb0169fbbc3ac2883ed5544f05d9008d2736a2899de` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/castle_brick_01/castle_brick_01_nor_gl_1k.jpg) |
| `masonry-roughness.jpg` | 263,291 | `0958bde6010e2b7e4098b2737e94cff53c0c41c865e09a69b1a1e39ba7973985` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/castle_brick_01/castle_brick_01_rough_1k.jpg) |
| `roof-albedo.jpg` | 584,122 | `41b7cd7785c60bfe1348eeb7642b4fbb412ff9dab710b4b8016cce70c37a9239` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/roof_07/roof_07_diff_1k.jpg) |
| `roof-normal.jpg` | 344,106 | `af231288c45d24c8e0c1675b4b239e9bfd3800de699b1bc66cf50dfd733c93a8` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/roof_07/roof_07_nor_gl_1k.jpg) |
| `roof-roughness.jpg` | 526,327 | `2c805e5f140438dbf7bfdf6b1064b1b606c8a5d348bf7ae4d4bc54b6ffc15b52` | [JPEG](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/roof_07/roof_07_rough_1k.jpg) |

## Preview and validation

[Named albedo contact sheet](previews/materials-build18.jpg). This sheet is a resized QA preview only; runtime textures remain unchanged original downloads. `test/surface-materials.test.js` checks local JPEG dimensions and hashes, color-space roles, shared loading/fallback behavior, quality changes, shader integration and safe Node construction. The graphics shader verification script additionally expands and compiles the actual Three.js shaders for representative rendering variants.
