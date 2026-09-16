# Sky rendering assets

`public/assets/sky/moon-albedo.jpg` is the unmodified 2048 × 1024 JPEG from the NASA Scientific Visualization Studio CGI Moon Kit (2025 color-map revision).

- Credit: NASA’s Scientific Visualization Studio. Visualizer: Ernie Wright (USRA); scientist: Noah Petro (NASA/GSFC). Source imagery: Lunar Reconnaissance Orbiter Camera / Arizona State University.
- Source and rendering explanation: [NASA CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/).
- Download: [Original 2K JPEG](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg).
- [Public-domain policy](https://svs.gsfc.nasa.gov/help/#faq): SVS content is public domain unless otherwise noted; this lunar color map has no separate restriction listed.
- Retrieved 2026-09-16. Size: 457942 bytes. SHA-256: `f7130a1822681fa7512d7dcfd40db8c10b9ba4f06777910348698260ed7a2170`.

The shader samples the sRGB map on a reconstructed lunar hemisphere. It adds soft limb shading and applies the same ACES output path as the scene. Moon size is approximately 0.65 degrees; solar solid disc size is approximately 0.56 degrees. These small angular sizes are intentional. Neither disc is a scene light or a screen-filling glow.

The atmosphere, sun aureole, clouds and star distribution are code-native procedural shaders. The sky uses six draw calls and one 458 KB texture. Texture loading is asynchronous with a deterministic lunar fallback; headless scene construction makes no requests. `sampleSkyCycle` retains the shared cycle convention and returns suggested world exposure (1.02 day to 1.12 night) and fog density. No gameplay time or visibility rules are changed.

Run `node scripts/preview-sky.mjs /tmp/emberwatch-sky.json` and `python scripts/render-sky-preview.py /tmp/emberwatch-sky.json /tmp/emberwatch-sky.jpg` to compile and render the actual shaders with Mesa EGL. The preview loads this same lunar texture; no substitute artwork is used.

[Verified Build 18 sky preview](previews/sky-build18.jpg) shows sunrise, midday, sunset, moonlight, a lunar inspection zoom and high clouds. This is an offline shader render rather than an interactive browser screenshot. The normal sky panels use the runtime angular sizes; only the explicitly labeled lunar inspection panel uses a zoomed camera. `test/sky.test.js` verifies the map's dimensions and SHA-256, day/night continuity, stable scene allocations, local asynchronous loading, fallback behavior and one-time disposal.
