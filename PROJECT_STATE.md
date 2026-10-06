# PROJECT_STATE

_Last updated: 2026-10-06 (session 2, milestone 6)_

## Project State

**Northhold** — a browser real-time strategy game inspired by Northgard. Vanilla ES modules with
vendored three.js, a WebGL renderer and a CPU 3D rasterizer when WebGL is unavailable. No build
step or external runtime dependencies. The built-in static server binds to `0.0.0.0`, sends
`no-store` responses and logs each request. Original code/art; no Northgard assets are used.

Current version: **v0.6.0 — CPU 3D fallback + Phase 6 units**. The top-bar build stamp is
`r5-world`.

* Engine suite: **90/90 passing** (`node tests/engine.test.js`)
* Save/load suite: **48/48 passing** (`node tests/save.test.js`)
* 3D model/camera/picking suite: **266/266 passing** (`node tests/render3d.test.js`)
* CPU rasterizer suite: **7/7 passing** (`node tests/raster3d.test.js`)
* Static server suite: **6/6 passing** (`node tests/server.test.js`)
* 3D integration suite: **78/78 passing** (`node tests/ui.3d.test.js`, jsdom + a fake GL backend)
* UI smoke suite: **86/86 passing** (`node tests/ui.smoke.test.js`, CPU 3D fallback; needs jsdom)
* Full run: `npm test` (**581 assertions**)

Visual checkpoints: `docs/preview/world.png` (whole island), `docs/preview/buildings.png` (building
catalogue) and `docs/preview/units.png` (five military roles), rendered through the shared CPU
rasterizer by `tools/render-preview.mjs`.

## Current Goal

Milestone 5 remains the continuous-world foundation; milestone 6 removes the old hex-shaped world
fallback. WebGL and CPU rendering now consume the same three.js scene. The software backend draws
the terrain, sea, instanced scatter, buildings, characters and soft decals with a depth buffer. The
trade-off is lower internal resolution and no GPU shadow maps / full material shaders. Hexes remain
only as simulation and picking coordinates. Phase 6 is complete: units now have role-specific
silhouettes, armour, headgear, shields/weapons and articulated walk/attack animation. Still open:
atmosphere polish and **Phase 9 — reduce UI obstruction**. No new gameplay systems until the visual
foundation is signed off (standing directive).

## Completed Features

* **Map**: 91-tile hex map, procedurally generated with fairness guarantees — every start has
  two forest tiles and one fertile tile adjacent, plus stone, iron and water within 3–4 tiles.
  Terrains: plains, forest, fertile, wildlands, lake, mountain, iron, ruins.
* **Camera & input**: drag/WASD/arrow pan, wheel + pinch zoom, tap-to-select, drag box-select,
  shift-click add, right-click orders, minimap click-to-jump, `H`/`Tab`/`C`/`M`/`Space`/`1`–`3`,
  touch-friendly (pointer events, `touch-action: none`).
* **Territory**: settle adjacent unclaimed tiles for food (cost scales with terrain); capture
  enemy tiles by standing on them with a warband while no enemy fighters/buildings defend.
* **Economy**: food, wood, krowns, stone, iron, lore, fame, happiness; monthly rates shown live in
  the HUD; upkeep per villager/building; deposits deplete; Forge converts iron into +6%/month
  wargear damage (cap +30%).
* **Buildings**: 15 types with terrain rules, per-type limits, 3 buildings per tile, construction
  timers, worker slots, worker picker in the panel, demolition (50% wood/stone back), building HP
  and destruction.
* **Workers & population**: idle/assigned villagers, job assignment per building, house-driven pop
  cap, happiness model (houses, brewery, food stores, season, overcrowded army), growth timer,
  starvation deaths and deserter warriors.
* **Seasons**: 12-month year, 4 seasons, winter food collapse (×0.35), +45% food consumption,
  visual snow and palette shift, seasonal toasts.
* **Combat & units**: Warrior, Axe Thrower (range 2), Shield Bearer (tanky), Scout, Warchief
  (fame hero). Auto-acquire, chasing with hex pathfinding, attack cooldowns, projectiles, towers
  (with or without a gunner), damage floaters, fame for kills/buildings.
* **Blessings**: Altar of Odin produces lore; at 40 lore the game offers 3 of 12 permanent
  blessings (max 5 per game) with modifiers applied everywhere.
* **Victory/defeat**: fame 300, trade 2200 krowns (needs a Market/Trading Post), domination
  (destroy the enemy Town Hall), 9-year fame timeout, victory/defeat overlay with end stats.
* **AI jarl**: greedy worker assignment with famine handling, plan-based building with
  population-scaled production targets, deposit-seeking expansion, ruin scouting, garrison
  defence, offensive pushes, warchief and blessings. Three difficulties.
* **UI/UX**: start screen (clan + difficulty), HUD resource chips with rate deltas, contextual
  side panel (building / warband / overview + tile inspector), build catalog, orders bar, event
  log, toasts, minimap, help and blessing modals, mobile layout breakpoints.
* **Save/load**: versioned JSON serialisation of the full simulation (tiles, buildings, units,
  clans, AI memory, time, log, RNG state, start tiles) into localStorage + file export/import;
  autosave every in-game year; pause menu (`Esc`/☰) with save/load/export/import/restart; the start
  screen offers "Continue" when a save exists. Derived maps are rebuilt on load, and because the
  RNG state is stored a reloaded game continues *identically* (tested).
* **Continuous 3D terrain (v0.5.0)**: the island is **one mesh** built from a baked height field
  (`src/terrain3d.js`) — every tile splats a gaussian bump of its own elevation into a 0.25-unit
  grid, each tile pins its centre to its exact elevation inside 0.84 units, an fBm term adds rolling
  ground and a shoreline meander (weighted to zero at tile centres) turns hex edges into bays and
  headlands. Below the ground: a draped sea bed coloured by depth; above it: one animated water
  surface at `WATER_LEVEL`, and the shore dives to the sea floor past the outer ring through a
  noisy mask that never cuts into the outermost ring of gameplay tiles. Verified continuous: no
  0.05-unit sample jumps more than 0.25, no 0.2-unit step exceeds 0.55, and every lake centre sits
  under the water line while every land centre stays above it (10 seeds).
* **Real materials & surface detail (v0.5.0)**: terrain is vertex-coloured (grass/forest floor/
  fertile/dry grass/dirt/rock/sand/snow/lake bed) with slope→rock, wetness→sand, height→snow,
  hollow ambient occlusion, two scales of patchy fBm variation and a procedural detail map; water
  has a scrolling procedural texture with depth-tinted shallows.
* **3D forests, rocks and resource nodes (v0.5.0)**: instanced pines, firs, broadleaf and birch
  (trunk + branches + layered foliage, per-tree scale and rotation, saplings beside parents) in
  deterministic clusters that spill across tile borders; boulders, crags and slabs on broken ground;
  iron tiles carry dark ore-bearing rock; ruins use pillars/walls/rubble/arches; farms own furrow
  rows with crops and a scarecrow, woodcutters own log piles; deer wander the wildlife tiles.
  Trees sway in the wind and the whole scatter layer rebuilds only when its signature changes.
* **15 stylized buildings (v0.5.0)** (`src/buildings3d.js`): town hall, house, woodcutter's lodge,
  hunter's lodge, farm (barn + furrow field + scarecrow), fishery, stone mine (cut hillside, timber
  portal, rails, ore cart) and iron mine, forge with a lit furnace, market, brewery, altar with
  standing stones, barracks, watchtower and trading post — footing, walls, doors, windows, gable
  and shingled roofs, banner poles, chimneys, all casting and receiving shadows, with scaffolding
  while under construction.
* **Sky, sun, fog and atmosphere (v0.5.0)**: gradient sky dome repainted per season, directional
  sun with shadow mapping, hemisphere ambient light, distance fog for depth, season-driven light
  colour/intensity, snow whiten in winter and a season tint over the whole terrain material.
* **Territory and interaction decals (v0.6.0)**: ownership is a desaturated geographic wash with
  a per-vertex fade and frontier glow. Hover/build/capture feedback is a terrain-draped radial
  wash; selection markers are circular. No visible hex outlines or hex decals remain.
* **Phase 6 unit pass (v0.6.0)**: warrior, raider, shield-bearer, scout and warchief use distinct
  headgear, torso shapes, armour, shields/weapons and scale. Arms and legs pivot independently for
  a walk cycle; attacks use a weapon lunge. Character meshes remain original procedural geometry.
* **CPU 3D renderer (`src/raster3d.js`)**: software triangle rasterizer with perspective projection,
  per-vertex colour/alpha, depth buffer, lighting/fog approximation, texture sampling for procedural
  maps, order-line/text overlays and terrain LOD. `view.js` selects it when WebGL is unavailable;
  both backends render the exact same scene graph.
* **Visual tooling: `tools/render-preview.mjs`** uses that runtime rasterizer to write PNGs from the
  real scene (no GPU required). `node tools/render-preview.mjs --out shot.png --distance 16
  --yaw 0.7 --pitch 0.8 --center player`; `--mode buildings` renders the catalogue and `--mode units`
  renders the five role-specific military models (see `docs/preview/`).
* **Preview diagnostics**: `tools/serve.mjs` sends `Cache-Control: no-store` and logs method, URL,
  status, bytes and duration for every request. The `r5-world` top-bar badge is a stable build stamp;
  its `data-renderer` attribute reports `3d` or `raster3d`.
* **Northgard-style RTS camera (v0.4.0)**: ~54° downward 3/4 view (clamped 35°–75° so it never
  becomes a flat top-down board), perspective FOV 52°, free orbit (Q/E), tilt (R/F), zoom 7–72
  (wheel/pinch/buttons), pan by drag/minimap/WASD. Pan, zoom, orbit and tilt are eased with a
  frame-rate independent filter, and the camera aims at the ground height under its target, so it
  glides instead of snapping and never stares at sea level on a hill.
* **Mouse picking on real terrain (v0.4.0)**: the pointer ray is marched down through the height
  field and bisected on the first surface it crosses, so clicking a mountain face selects the
  mountain rather than the ground behind it (verified against 1345 sampled tile centres, with
  occlusion-aware expectations).
* **Workers in the world (v0.4.0)**: staffed woodcutters, hunters, fishers and mines send villagers
  walking from the building to the resource node they exploit, harvesting there with the tool of
  their trade, carrying a load home and starting again. Presentation only — the simulation remains
  authoritative, and the party follows `building.workers` exactly.
* **3D renderer fallback + switch**: WebGL is preferred. Without it, the app constructs the same
  3D scene and software-rasterizes it through `src/raster3d.js`; the pause menu can switch between
  WebGL and CPU 3D. A fresh canvas is used for each backend because a canvas cannot change context
  type after creation. HUD, input and simulation continue without a reload.
* **Minimap**: the only independent 2D canvas is a compact top-down navigation aid; it uses blended
  terrain circles and soft ownership washes, not a second world renderer.
* **Tooling**: `npm start` static server, seven-suite `npm test`, and the debug hook at
  `window.__northhold` (including `view`, active backend and `setRenderer`).

## Features In Progress

* **Phase 7 polish (lighting/atmosphere)** — partly done (fog, sky, animated water and wind); GPU
  shadow quality remains device-dependent.
* **Phase 9 (UI obstruction)** — not started.
* 3D remains presentation-only: the hex simulation, balance and save format are unchanged. A save
  does not contain renderer state and loads identically with either 3D backend.

## Next Tasks

1. ~~Save/load: JSON state serialisation, localStorage + file export/import, pause menu,
   versioned format~~ ✅ (v2 format; `src/save.js`)
2. Clan differentiation beyond modifiers: Raven scouting/coastal bonuses, Wolf aggression,
   Stag stability — plus clan-specific starting units and a clan passive display in the HUD.
3. Content: neutral monsters (draugr/wolves), random events, runestones, a third clan.
4. Audio (WebAudio synthesis, original): ambience, UI feedback, battle cues, off/mute toggle.
5. ~~Art pass: 3D map, units and buildings~~ ✅ — still to come: richer mountain cliffs, more tree
   variety and per-clan HUD banner emblems.
6. Balance pass with a headless benchmark script (win-rate and time-to-victory per difficulty).

## Known Bugs

No known gameplay bugs. Current automated run: **581 assertions** across seven suites. Watch list:

* Very long sessions (>40 in-game years) are covered by simulation, not a full-length browser run.
* Touch: two-finger pinch zoom is implemented but only manually verified (jsdom cannot test it).
* Real GPU drivers are unavailable in this sandbox. The WebGL scene path is exercised through a fake
  backend; the CPU path is rasterized directly and should still get a real-browser visual check.
* CPU 3D intentionally renders at a bounded resolution and omits GPU shadow maps; WebGL shadow
  quality varies by device.

## Visual Acceptance & Diagnosis

Visual sign-off is a required gate before calling the renderer work done. Automated tests can prove the
scene graph and CPU framebuffer are valid; the final art read still needs a browser check.

### Acceptance checklist

1. Start with `node tools/serve.mjs`; confirm request lines show `GET /`, ES modules and CSS returning
   `200`, and `Cache-Control: no-store` on both successful and missing-file responses.
2. The topbar displays **`r5-world`**. `#rendererBadge[data-renderer="3d"]` means WebGL;
   `data-renderer="raster3d"` means the CPU fallback. Both must show the same continuous island.
3. In a broad and a close view, the land is one connected height-field surface: no per-tile slabs,
   no six-sided borders, no hex-shaped hover/build/capture decal. Territory fades as a soft geographic
   wash; interaction markers fade radially and follow the terrain.
4. Check a forest edge, lake shore, mountain, building, moving villager and each military role. Units
   must read as separate 3D characters (silhouette, headgear, weapon/shield and leg/arm motion), not
   coloured pips. Verify click-picking and camera pan/zoom/orbit in both backends.
5. For a repeatable headless art check, run `node tools/render-preview.mjs --out /tmp/northhold.png
   --width 960 --height 540 --distance 30 --center map`; add `--mode buildings` or `--mode units`
   to inspect the catalogue or role silhouettes. Current examples are in `docs/preview/`.

**Current sign-off:** the shared CPU-rasterized island, building catalogue and five-role unit showcase
have been generated and visually inspected; automated scene/raster tests also pass. Interactive
browser checks (especially on a real GPU/WebGL driver) remain an external sign-off gate. The CPU
fallback is deliberately lower resolution and does not reproduce GPU shadows or every material shader.

### Diagnosis notes

| Symptom | Diagnosis |
|---|---|
| Blank or stale world after editing | Check the dev-server request log for module status; successful and 404 responses are `no-store`. Confirm `raster3d.js` loaded and inspect the first console exception. |
| CPU fallback looks softer than WebGL | Expected bounded internal resolution (max 768×512 / 280k pixels) and no GPU shadow map. Confirm `data-renderer="raster3d"`; this is not a hidden 2D board. |
| Tile edges return | Regression: world geometry should have one terrain mesh plus the sea bed; inspect hover/build/capture feedback for a six-sided decal. Gameplay hex coordinates remain in `engine.js` only. |
| Units still read as dots | Check camera distance, `buildUnitMesh` role style, articulated `legL/legR` pivots, and whether `syncUnits` sees movement/attack state. The minimap may still use tiny dots by design. |
| Picking seems offset | Compare `screenToTile` against the height-field ray march; keep CSS canvas dimensions distinct from the CPU backing-buffer dimensions. |

## Architecture

```
index.html → src/main.js ─┬─ src/view.js      (renderer adapter: WebGL ⇄ CPU 3D)
                          │        ├─ src/render3d.js  (shared three.js scene, camera, picking)
                          │        │        └─ src/models3d.js (procedural terrain props/building/unit meshes)
                          │        └─ src/raster3d.js  (CPU triangle rasterizer + soft minimap)
                          ├─ src/input.js    (pointer/keyboard → engine commands, camera)
                          ├─ src/ui.js       (HUD DOM, panels, modals; reads state, sends commands)
                          ├─ src/ai.js       (aiStep(state, dt) — the rival jarl)
                          ├─ src/save.js     (serialise/deserialise state, storage, files)
                          └─ src/engine.js   (pure simulation: createGame/step + exported commands)
                                   └─ src/data.js (all tunable constants & definitions)
```

* **The view adapter is the only renderer boundary.** `src/view.js` exposes one surface
  (`draw`, `drawMinimap`, `screenToTile`, `worldToScreen`, `centerOn`, `panBy`, `zoomAt/zoomBy`,
  `rotateBy`, `tiltBy`, `pickRadius`, `use3D`, `useRaster3D`). Both backends render one shared 3D
  scene; there is no 2D world renderer to drift out of sync.
* **3D is presentation-only.** `render3d.js` reads `state` and mirrors tiles, buildings, units and
  effects into scene groups; it never mutates the simulation. Unit positions come straight from the
  engine's world coordinates (`u.x`, `u.y`) mapped by `hexTo3D`. Game rules stay in `engine.js`.
* **Terrain height lives in the renderer, not the simulation.** `tileElevation(tile)` is a pure,
  deterministic function of terrain type and axial coordinates (`src/terrain3d.js`), and the whole
  surface is baked from it once per game into a height grid (`heightFieldFor`, cached on the state).
  Renderer, picking maths and tests all read the same field, and no elevation is ever saved into
  the game state.
* **The height field is the only source of ground truth.** `terrainHeightAt(state, x, z)` is used by
  the terrain mesh, scatter placement, buildings, units, work parties, markers and the picker, so a
  change to the field can never desynchronise the world from what the player can click.
* **Picking marches the height field.** `pickTileFromScreen` walks the mouse ray down through the
  world's vertical band, bisects on the first surface it crosses and returns the tile under that
  point; water counts as a surface at the water line. It agrees with an independent march of the
  same ray on every sampled tile centre (2250 samples over five camera angles, including the
  shallowest legal pitch).
* **Renderer switching swaps the canvas element.** A canvas that has handed out a 2D context cannot
  create a WebGL context and vice versa, so `view.js` builds the incoming renderer on a fresh canvas
  and swaps it in only after success. A failed switch leaves the current backend working. Input
  listeners live on parent `main`, so they survive the swap.

* **Engine is DOM-free** and safe to import in Node — that is what makes the simulation tests and
  the long-run balance sweeps possible.
* **Commands are plain functions** (`build`, `colonize`, `assignWorker`, `trainUnit`,
  `commandMove`, `commandAttack`, `demolish`, `holdUnit`, `grantBlessing`) returning
  `{ ok, reason }`; the UI and AI both call them so rules can never diverge.
* **State is a single plain object graph** (`state`) with `tiles`, `units`, `clans`, `time`,
  `floaters`, `log`, `toasts`. Units/buildings are mirrored in `unitById` / `buildingsById` maps.
* **Rendering is presentation-only**: `render3d.draw(state, ui, dt)` mirrors state into the scene;
  WebGL or `raster3d` renders it. UI state lives in `app.ui` (selection, modes, highlights), so the
  engine never knows about the mouse.
* **HUD updates on signatures** — panels/catalog/toasts re-render only when something they display
  changed, keeping the DOM cheap next to the canvas.

## Important Technical Decisions

* **Plain ES modules, no bundler, no dependencies.** Runs from any static host; the whole game is
  readable without a build toolchain. jsdom is only needed for the optional UI test.
* **Hex grid**: axial coordinates (q, r), 6-direction neighbours, O(1) lookup via `tileByKey`.
  This is simulation/picking data only; world geometry is continuous and the minimap uses soft circles.
* **Time**: 1 in-game month = 6 real seconds; all rates are "per month", converted with
  `dt / MONTH_SECONDS`. Game speed multiplies dt, and dt is clamped to 0.25 s per step so a
  background tab cannot teleport the simulation.
* **Determinism**: one seeded RNG (`mulberry32`) lives on the state and is used by map generation,
  AI decisions and ruin rewards, so a seed fully reproduces a game (verified by tests).
* **Config-first balance**: every gameplay number lives in `src/data.js`; systems read modifiers
  through a single `recomputeMods()` result (`clan.mods`) instead of ad-hoc multipliers.
* **AI is a client of the engine**, not a special case: it may only use the same exported commands
  the player's UI uses (plus direct state reads), which keeps it honest and testable.
* **Deliberate fairness guarantees** in map gen (forest/fertile adjacent to every start; stone,
  iron and water within a short march) — without them an AI clan can be starved of stone forever.
* **Placeholder art is generated at runtime** (canvas paths, emoji glyphs for icons, and in 3D
  procedural geometry) so no third-party asset is ever committed; a future art pass can replace the
  drawing functions without touching rules.
* **three.js r169 is vendored, not fetched.** `vendor/three.module.min.js` (MIT, license text next
  to it) is imported with a relative ESM specifier. The game must run inside a preview iframe with
  no external network access, so a CDN import is not acceptable. The CPU backend reuses three.js
  geometry/camera math but never requests a WebGL context.
* **Deposits have a kind and an amount, never both in one field.** `tile.deposit` is the remaining
  amount and `tile.depositKind` is `'stone'`/`'iron'` (`depositMax` is the original size). They used
  to be one field, so mining did `'stone' - 1` and quietly made the deposit `NaN` (infinite mines,
  "NaN / 320" in the UI panel).
* **Work parties are presentation, recruiting arms villagers.** Staffed buildings spawn worker
  meshes that walk to their resource node; the engine only knows `building.workers`. Related engine
  rule added in v0.4.0: recruiting takes an existing villager (population unchanged, Northgard
  style), so a clan whose houses are full can still field its warband.
* **The 3D renderer takes a `rendererFactory` seam.** `createRenderer3D(canvas, { rendererFactory })`
  lets tests inject a fake GL backend, which is how the full 3D pipeline (scene graph, mesh
  bookkeeping, seasons, picking, disposal) is verified headlessly in jsdom.

## Files/Systems Modified Recently

* `src/terrain3d.js` — **new**: the continuous world. Baked height field (`heightFieldFor`,
  `terrainHeightAt`, `FIELD_STEP`), `tileElevation`/`worldToTile`/`mapExtent`, the terrain mesh
  (vertex-coloured, hollow AO, detail map, flattened building pads), animated water, draped
  depth-tinted sea bed, geographic territory wash, `drapeGeometry`, procedural textures, and the
  signatures the renderer rebuilds the world on.
* `src/scatter3d.js` — **new**: deterministic clustered placement of trees (with saplings), rocks,
  ore, ruins, farm/log props and animals, as pure data for instancing.
* `src/buildings3d.js` — **new**: the 15 stylized buildings and their parts (footing, walls, door,
  window, roofGable, shingles, chimney, bannerPole, scaffold).
* `src/models3d.js` — procedural tree/rock/ore/ruin/plot variants, deer, villagers and Phase 6
  military units. Unit types now differ in build, armour, headgear, shield/weapon and scale; arm and
  leg pivots are driven by `render3d.js`.
* `src/render3d.js` — shared WebGL/CPU scene layers `terrain/water/scatter/territory/buildings/units/
  workers/fx`; continuous world sync, wind/water/season updates, radial ground washes, height-aware
  picking and eased RTS camera.
* `src/raster3d.js` — **new** runtime CPU rasterizer: projected scene triangles, per-vertex colour and
  alpha, depth buffer, lighting/fog approximation, procedural DataTexture sampling and text/order
  overlays. Terrain uses a cached stride-2 raster LOD; the backing canvas is bounded for performance.
* `src/view.js` / `src/input.js` / `src/main.js` / `index.html` — remove the 2D world renderer, default
  to WebGL or CPU 3D, expose both 3D backends in the pause menu, fix minimap navigation, and show the
  `r5-world` build stamp plus active backend in `data-renderer`.
* `src/terrain3d.js` — adds terrain-draped soft radial feedback geometry; the ownership mesh remains
  a geographic per-vertex wash.
* `tools/serve.mjs` — no-store headers and one access-log line per request (method/path/status/bytes/
  duration), with a static-file path check.
* `tools/render-preview.mjs` — PNG preview of the real scene using the same CPU rasterizer as the
  browser fallback; `--mode buildings` still renders the catalogue.
* `tests/render3d.test.js` — **266 assertions** across terrain continuity, coast, territory and soft
  decals, scatter, model silhouettes, Phase 6 pivots, camera and picking.
* `tests/raster3d.test.js` — **7 assertions** for framebuffer output, depth ordering and no-WebGL
  renderer construction; `tests/server.test.js` — **6 assertions** for no-store and request logging.
* `tests/ui.3d.test.js` — **78 assertions** through the fake GL backend; `tests/ui.smoke.test.js` —
  **86 assertions** booting the real app through CPU 3D.
* `docs/preview/` remains the visual checkpoint directory; package and project version are **v0.6.0**.

## How To Run

```bash
# play
node tools/serve.mjs         # → http://localhost:8080

# test
npm i --no-save --no-package-lock jsdom # optional dependency for browser-DOM suites
npm test                     # all seven suites (581 assertions)
npm run test:engine          # headless simulation; no dependencies needed
npm run test:3d              # geometry, CPU rasterizer and jsdom scene integration
npm run test:ui              # boots the game through CPU 3D (needs jsdom)

# inspect the same CPU rasterizer used by no-WebGL browsers (writes a PNG)
node tools/render-preview.mjs --out shot.png --distance 16 --yaw 0.7 --pitch 0.8 --center player
node tools/render-preview.mjs --out village.png --mode buildings --distance 6 --cols 4
node tools/render-preview.mjs --out units.png --mode units --distance 6
```

## Last Stable Milestone

**v0.6.0 — CPU 3D fallback + Phase 6 units.** The old hex-shaped 2D world renderer (`src/render.js`)
was deleted. WebGL and CPU backends now render the same scene; no-WebGL browsers retain 3D terrain,
props, buildings, units, picking and camera controls through `src/raster3d.js`. Territory and
interaction decals are soft washes, and the five military roles have distinct 3D silhouettes plus
articulated walk/attack motion. `r5-world` is the visible build stamp; `tools/serve.mjs` disables
caching and logs requests for visual debugging.

Verified by **581 assertions** across seven suites: 90 engine (long-run simulation and victory paths),
48 save/load (exact round trip and deterministic continuation), 266 terrain/model/camera/picking,
7 CPU rasterizer, 6 static-server headers/logging, 78 jsdom 3D scene integration, and 86 UI smoke
checks through the CPU fallback. The manual visual acceptance checklist above remains the final
browser/GPU sign-off.

Previous milestones: **v0.5.0 — continuous 3D world**; **v0.4.0 — 3D RTS foundation** (height field,
RTS camera, workers); **v0.3.0 — full 3D presentation**; **v0.2.0 — save/load + pause menu**;
**v0.1.0 — playable prototype**.
