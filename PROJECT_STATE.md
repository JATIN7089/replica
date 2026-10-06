# PROJECT_STATE

_Last updated: 2026-10-06 (session 1, milestone 5)_

## Project State

**Northhold** — a browser real-time strategy game inspired by Northgard. Vanilla ES modules with
vendored three.js for the 3D renderer, **zero network dependencies**, no build step. Served statically. Original code/art;
no Northgard assets are used.

Current version: **v0.5.0 — continuous 3D world (the hex board is gone)**.

* Engine suite: **90/90 passing** (`node tests/engine.test.js`)
* Save/load suite: **48/48 passing** (`node tests/save.test.js`)
* 3D model/camera/picking suite: **251/251 passing** (`node tests/render3d.test.js`)
* 3D integration suite: **76/76 passing** (`node tests/ui.3d.test.js`, jsdom + a fake GL backend)
* UI smoke suite: **84/84 passing** (`node tests/ui.smoke.test.js`, needs jsdom)
* Full run: `npm test` (**549 assertions**)

Visual checkpoint: `docs/preview/world.png` (the whole island) and `docs/preview/buildings.png`
(the building catalogue), both rendered by `tools/render-preview.mjs`.

## Current Goal

Milestone 5 is complete: the world is no longer a hex board. One continuous terrain surface
(baked height field, vertex-coloured grass/dirt/rock/sand/snow), instanced 3D forests, 3D rocks and
resource nodes, ruin and farm props, 15 stylized buildings, sky/sun/fog/atmosphere, animated water,
wind-swayed trees and a geographic (not hexagonal) territory wash. Still open in the art programme:
**Phase 6 — better units**, atmosphere polish, and **Phase 9 — reduce UI obstruction**. No new
gameplay systems until the visual foundation is signed off (standing directive).

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
* **Territory as geography (v0.5.0)**: ownership is drawn as a desaturated ground wash that follows
  the terrain with a per-vertex fade and a brighter frontier rim, rebuilt when ownership changes;
  capture cues are rings draped on the actual ground. No hex outlines anywhere.
* **Tooling: `tools/render-preview.mjs`** — a software rasteriser that loads the *real* three.js
  scene (the same code path the game uses, with a fake GL backend) and writes a PNG, so the world
  can be inspected headlessly. `node tools/render-preview.mjs --out shot.png --distance 16
  --yaw 0.7 --pitch 0.8 --center player`; `--mode buildings` renders the catalogue (see
  `docs/preview/`).
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
* **Units in 3D (v0.3.0 → still Phase 6 of the art programme)**: units are procedural low-poly
  humanoids (body, head, arms, legs, weapon, clothing by clan colour) that stand on and walk across
  the continuous surface, with selection rings, shield walls, projectiles, damage floaters and
  building scaffolding. Making them *better* characters (distinct silhouettes per unit type,
  animation) is the next art phase.
* **Renderer fallback + switch**: WebGL is probed at boot; without it the game silently falls back
  to the 2D renderer (with a toast explaining why). The pause menu has a
  "Renderer — 3D / 2D" section to switch at will; switching swaps in a fresh canvas element
  (a canvas that has served 2D can never host WebGL, and vice versa) while input, HUD and
  simulation carry on without a reload. Renderer choice persists for the session.
* **Tooling**: `npm start` static server, `npm test` (engine + save + 3D + jsdom UI suites), debug
  hook at `window.__northhold` (now also exposes `view` and `setRenderer`).

## Features In Progress

* **Visual overhaul, Phase 6 (units)** — next up; today's units are the v0.3.0 humanoids.
* **Phase 7 polish (lighting/atmosphere) and Phase 9 (UI obstruction)** — Phase 7 is partly done
  (sun/shadows/hemi/fog/sky/water animation/wind), Phase 9 not started.
* 3D remains presentation-only: the hex simulation, balance and save format are unchanged, and
  saves made in 2D load in 3D and vice versa. `src/render.js` (2D) survives only as the
  no-WebGL fallback and is never presented as a way to play.

## Next Tasks

1. ~~Save/load: JSON state serialisation, localStorage + file export/import, pause menu,
   versioned format~~ ✅ (v2 format; `src/save.js`)
2. Clan differentiation beyond modifiers: Raven scouting/coastal bonuses, Wolf aggression,
   Stag stability — plus clan-specific starting units and a clan passive display in the HUD.
3. Content: neutral monsters (draugr/wolves), random events, runestones, a third clan.
4. Audio (WebAudio synthesis, original): ambience, UI feedback, battle cues, off/mute toggle.
5. ~~Art pass: 3D map, units and buildings~~ ✅ (v0.3.0) — still to come: view-dependent 2D sprite
   artwork, richer mountain cliffs, more tree variety and per-clan HUD banner emblems.
6. Balance pass with a headless benchmark script (win-rate and time-to-victory per difficulty).

## Known Bugs

None known. All five suites pass (549 assertions). Watch list:

* Very long sessions (>40 in-game years) only covered in simulation, not in the browser.
* Touch: two-finger pinch zoom is implemented but only manually verified (jsdom cannot test it).
* Real GPU drivers cannot be exercised in this sandbox: the 3D pipeline is verified through jsdom
  with a fake GL backend plus pure-math tests. First load in a real browser is still worth a look.
* 3D shadow quality varies by device; the renderer already downgrades shadows on small screens.

## Architecture

```
index.html → src/main.js ─┬─ src/view.js      (renderer adapter: 3D ⇄ 2D, one API for everything)
                          │        ├─ src/render3d.js  (three.js scene, camera rig, picking)
                          │        │        └─ src/models3d.js (procedural tile/building/unit meshes)
                          │        └─ src/render.js    (2D canvas world + minimap, fallback)
                          ├─ src/input.js    (pointer/keyboard → engine commands, camera)
                          ├─ src/ui.js       (HUD DOM, panels, modals; reads state, sends commands)
                          ├─ src/ai.js       (aiStep(state, dt) — the rival jarl)
                          ├─ src/save.js     (serialise/deserialise state, storage, files)
                          └─ src/engine.js   (pure simulation: createGame/step + exported commands)
                                   └─ src/data.js (all tunable constants & definitions)
```

* **The view adapter is the only renderer boundary.** `src/view.js` exposes one surface
  (`draw`, `drawMinimap`, `screenToTile`, `worldToScreen`, `centerOn`, `panBy`, `zoomAt/zoomBy`,
  `rotateBy`, `tiltBy`, `pickRadius`, `use3D`, `use2D`) and input/UI only ever talk to it, so the
  3D and 2D renderers are interchangeable and the 2D fallback can never drift out of sync.
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
  create a WebGL context and vice versa, so `view.js` builds the incoming renderer on a brand new
  canvas and only swaps it in once it succeeds — a failed switch leaves a working renderer alone.
  Input listeners live on the parent `main` element, so they survive the swap.

* **Engine is DOM-free** and safe to import in Node — that is what makes the simulation tests and
  the long-run balance sweeps possible.
* **Commands are plain functions** (`build`, `colonize`, `assignWorker`, `trainUnit`,
  `commandMove`, `commandAttack`, `demolish`, `holdUnit`, `grantBlessing`) returning
  `{ ok, reason }`; the UI and AI both call them so rules can never diverge.
* **State is a single plain object graph** (`state`) with `tiles`, `units`, `clans`, `time`,
  `floaters`, `log`, `toasts`. Units/buildings are mirrored in `unitById` / `buildingsById` maps.
* **Renderer is stateless per frame**, driven by `draw(ctx, state, canvas, ui, dt)`; UI state lives
  in `app.ui` (selection, modes, highlights) so the engine never knows about the mouse.
* **HUD updates on signatures** — panels/catalog/toasts re-render only when something they display
  changed, keeping the DOM cheap next to the canvas.

## Important Technical Decisions

* **Plain ES modules, no bundler, no dependencies.** Runs from any static host; the whole game is
  readable without a build toolchain. jsdom is only needed for the optional UI test.
* **Hex grid**: axial coordinates (q, r), 6-direction neighbours, O(1) lookup via `tileByKey`.
  Rendering uses pointy-top hexes at world scale 1 with a single zoom factor.
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
  no network access, so a CDN import is not acceptable; the vendored file is loaded lazily — the
  2D path never touches it.
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
* `src/models3d.js` — rewritten around primitives, merging and instancing: tree/rock/ore/ruin/plot
  variants, deer, villager and unit meshes, `workToolFor`. The old per-tile hex prisms are gone
  (dead `hexPrismGeometry` deleted).
* `src/render3d.js` — layers are `terrain/water/scatter/territory/buildings/units/workers/fx`;
  `buildWorld` rebuilds the surface from signatures, instanced scatter, wind sway, water scroll,
  season tinting, draped highlights/capture cues, the territory wash (now built on the first frame),
  a marching height-aware picker over the continuous surface, and a camera whose pan starts eased
  and is speed-capped.
* `src/engine.js` / `src/save.js` — deposit fix: kinds live in `depositKind`, amounts in `deposit`
  (`depositMax` is capacity), so mining depletes deposits instead of poisoning them with `NaN`;
  saves carry the kind and default it from the terrain.
* `tools/render-preview.mjs` — **new**: headless PNG renders of the real scene (two-pass
  transparency, sky background, `--mode buildings`); `npm run preview` regenerates the island shot.
* `tests/render3d.test.js` — rewritten for the new architecture, extended to **251** tests
  (continuity at two scales, relief, shore, territory, scatter, models, camera, picking against an
  independent ray march).
* `tests/ui.3d.test.js` — ported to the new layers, extended to **76** tests (one island mesh plus a
  sea bed, no tile columns, per-vertex territory fade, seasonal tint × vertex colour).
* `docs/preview/` — rendered checkpoints (`world.png`, `buildings.png`), `PROJECT_STATE.md`,
  `README.md`, `package.json` — v0.5.0.

## How To Run

```bash
# play
node tools/serve.mjs         # → http://localhost:8080

# test
npm test                     # engine + save + 3D + UI suites (549 assertions)
npm run test:engine          # no dependencies needed
npm run test:3d              # 3D models/camera + jsdom 3D integration
npm i --no-save jsdom && npm run test:ui

# look at the world without a GPU (writes a PNG)
node tools/render-preview.mjs --out shot.png --distance 16 --yaw 0.7 --pitch 0.8 --center player
node tools/render-preview.mjs --out village.png --mode buildings --distance 6 --cols 4
```

## Last Stable Milestone

**v0.5.0 — continuous 3D world (the hex board is gone).** Commit:
`feat: continuous 3D world — terrain, forests, rocks, buildings, atmosphere` (the deposit-kind fix
and the territory-wash build fix are folded into it). Verified by **549 assertions** across five
suites: 90 engine (20-minute headless simulation, all four victory paths, AI robustness), 48
save/load (exact round trip, byte-identical continuation after a reload), 251 3D tests (height-field
continuity, relief, coast, materials, scatter, models, camera clamps and easing, picking against an
independent ray march), 76 jsdom 3D integration tests (one island mesh, sea bed, territory fade,
seasons, work parties, units on the ground, 900-frame AI run, canvas swap) and 84 jsdom UI tests
(boot, build, settle, staff, train, save/load, pause menu, renderer switch).

Previous milestones: **v0.4.0 — 3D RTS foundation** (height field, RTS camera, workers);
**v0.3.0 — full 3D presentation**; **v0.2.0 — save/load + pause menu**; **v0.1.0 — playable
prototype**.
