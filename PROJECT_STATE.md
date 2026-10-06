# PROJECT_STATE

_Last updated: 2026-10-06 (session 1, milestone 3)_

## Project State

**Northhold** — a browser real-time strategy game inspired by Northgard. Vanilla ES modules with
vendored three.js for the 3D renderer, **zero network dependencies**, no build step. Served statically. Original code/art;
no Northgard assets are used.

Current version: **v0.3.0 — full 3D presentation, same simulation**.

* Engine suite: **84/84 passing** (`node tests/engine.test.js`)
* Save/load suite: **48/48 passing** (`node tests/save.test.js`)
* 3D model/camera suite: **101/101 passing** (`node tests/render3d.test.js`)
* 3D integration suite: **49/49 passing** (`node tests/ui.3d.test.js`, jsdom + a fake GL backend)
* UI smoke suite: **82/82 passing** (`node tests/ui.smoke.test.js`, needs jsdom)
* Full run: `npm test` (364 assertions)

## Current Goal

Milestone 3 is complete: the game is presented in **full 3D** (3D map, terrain, buildings, units,
effects) with the 2D canvas renderer kept as an automatic fallback, and the simulation untouched.
Next goal: **clan differentiation + content** (clan-specific passives and starts, neutral monsters,
events), then audio.

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
* **Buildings**: 14 types with terrain rules, per-type limits, 3 buildings per tile, construction
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
* **3D presentation (v0.3.0)**: the whole board is rendered in 3D through vendored three.js —
  extruded hex prisms per terrain, decorated forests/mountains/water with gentle motion, buildings
  and units as procedural low-poly meshes (body/head/arms/weapon parts), clans distinguished by
  colour + banner, selection rings, shield walls, projectiles, damage floaters and building
  scaffolding. 3D camera: orbit (Q/E or middle-drag+Ctrl), tilt (R/F), wheel/pinch zoom,
  middle-drag/WASD pan, and the same click/box select and right-click orders as before. A camera
  button cluster (rotate left/right, zoom in/out, reset) is in the top bar for touch.
* **Renderer fallback + switch**: WebGL is probed at boot; without it the game silently falls back
  to the 2D renderer (with a toast explaining why). The pause menu has a
  "Renderer — 3D / 2D" section to switch at will; switching swaps in a fresh canvas element
  (a canvas that has served 2D can never host WebGL, and vice versa) while input, HUD and
  simulation carry on without a reload. Renderer choice persists for the session.
* **Tooling**: `npm start` static server, `npm test` (engine + save + 3D + jsdom UI suites), debug
  hook at `window.__northhold` (now also exposes `view` and `setRenderer`).

## Features In Progress

* None half-finished. 3D is presentation-only: the hex simulation, balance and save format are
  unchanged, and saves made in 2D load in 3D and vice versa.

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

None known. All five suites pass (364 assertions). Watch list:

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
* **Picking is maths, not raycasting against the scene.** `pickTileFromScreen` converts a pixel to a
  world point on the ground plane and then to an axial tile, which is exact (455/455 sampled pixels
  across five yaws) and cheap enough to run on every pointer move.
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
* **The 3D renderer takes a `rendererFactory` seam.** `createRenderer3D(canvas, { rendererFactory })`
  lets tests inject a fake GL backend, which is how the full 3D pipeline (scene graph, mesh
  bookkeeping, seasons, picking, disposal) is verified headlessly in jsdom.

## Files/Systems Modified Recently

* `vendor/three.module.min.js` + `vendor/THREE-LICENSE.txt` — **new**: vendored three.js r169 (MIT).
* `src/models3d.js` — **new**: procedural 3D geometry — hex prism tiles, terrain colours, trees,
  rocks, mountains, water, 15 building models, 5 unit models, selection rings, scaffolds.
* `src/render3d.js` — **new**: scene/lights/shadow setup, `hexTo3D`/`tileTo3D`, camera rig
  (`createCameraRig`, `CAM`, pan/zoom/orbit/tilt clamps), `pickTileFromScreen`, `screenToGround`,
  `groundToScreen`, per-frame sync of terrain/decorations/territory/buildings/units/fx, `dispose`.
* `src/view.js` — **new**: renderer adapter; owns the live canvas, WebGL probe, `use3D`/`use2D`
  switching, and the shared camera/hit-test API that input and UI use.
* `src/input.js` — refactored onto the view adapter: panning, zoom-at-cursor, camera keys Q/E/R/F,
  middle-drag pan and middle-drag+Ctrl orbit, `view.pickRadius()` hit tests; listeners now sit on
  the stage element and pointer capture is optional (jsdom-safe).
* `src/render.js` — `setupCanvas` made rebindable (`surfaces.rebind`, live `canvas`/`ctx` getters) so
  the 2D renderer can be re-attached to a swapped canvas.
* `src/main.js` — `createView` wiring, `setRenderer('3d'|'2d')` + `syncRendererUI()`, hold-to-repeat
  camera buttons, renderer section in the pause menu, `view`/`setRenderer` on the debug hook.
* `src/ui.js` / `index.html` / `src/style.css` — camera control cluster, "Renderer — 3D/2D" pause
  section with fallback reason, Q/E/R/F line in help.
* `tests/render3d.test.js` — **new**: 101 tests for geometry, camera rig clamps, picking accuracy,
  model building and scene sync.
* `tests/ui.3d.test.js` — **new**: 49 jsdom integration tests running the real app's 3D renderer
  through a fake GL backend (world build, buildings, units/combat, territory, seasons, camera,
  900-frame run, disposal, canvas-swap switch).
* `tests/ui.smoke.test.js` — extended to 82 tests: renderer state, 3D camera fallback keys, pause
  menu renderer section, `getContext('2d')`-only canvas stub.
* `package.json` — `test` now runs all five suites; new `test:3d` script.
* `README.md`, `PROJECT_STATE.md` — 3D controls, fallback behaviour and new counts.

## How To Run

```bash
# play
node tools/serve.mjs         # → http://localhost:8080

# test
npm test                     # engine + save + 3D + UI suites (364 assertions)
npm run test:engine          # no dependencies needed
npm run test:3d              # 3D models/camera + jsdom 3D integration
npm i --no-save jsdom && npm run test:ui
```

## Last Stable Milestone

**v0.3.0 — full 3D presentation.** Commit: `feat: 3D renderer (map, units, buildings) with 2D
fallback`. Verified by 364 assertions across five suites: 84 engine tests (20-minute headless
simulation, all four victory paths, AI robustness), 48 save/load tests (exact round trip and
byte-identical continuation after a reload), 101 3D model/camera/picking tests, 49 jsdom 3D
integration tests (real app + fake GL backend: full world, buildings, combat, territory, seasons,
camera clamps, 900-frame AI run, disposal, canvas-swap switch) and 82 jsdom UI tests (boots the app,
renders, builds, settles, staffs jobs, trains, saves, loads, exports, imports, pause menu,
renderer switching, game over overlay).

Previous milestones: **v0.2.0 — save/load + pause menu**; **v0.1.0 — playable prototype**.
