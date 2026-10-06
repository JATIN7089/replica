# PROJECT_STATE

_Last updated: 2026-10-06 (session 1)_

## Project State

**Northhold** — a browser real-time strategy game inspired by Northgard. Vanilla ES modules on an
HTML5 canvas, **zero runtime dependencies**, no build step. Served statically. Original code/art;
no Northgard assets are used.

Current version: **v0.1.0 — playable single-player prototype (vs. one AI jarl)**.

* Engine suite: **84/84 passing** (`node tests/engine.test.js`)
* UI smoke suite: **39/39 passing** (`node tests/ui.smoke.test.js`, needs jsdom)

## Current Goal

Milestone 1 is complete: a playable prototype covering the full core loop
(map → settle → work → build → survive winter → train → fight → win).
Next goal: **save/load + settings**, then deeper clan differentiation and content.

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
* **Tooling**: `npm start` static server, `npm test` (engine + jsdom UI suites), debug hook at
  `window.__northhold`.

## Features In Progress

* None half-finished. Save/load is the next feature to start.

## Next Tasks

1. Save/load: serialize `state` to JSON in localStorage + export/import file; pause menu with
   save/load/restart; versioned save format.
2. Clan differentiation beyond modifiers: Raven scouting/coastal bonuses, Wolf aggression,
   Stag stability — plus clan-specific starting units and a clan passive display in the HUD.
3. Content: neutral monsters (draugr/wolves), random events, runestones, a third clan.
4. Audio (WebAudio synthesis, original): ambience, UI feedback, battle cues, off/mute toggle.
5. Art pass: richer tile decoration (cliffs, tree variety, water animation), animated units,
   attack/hit feedback, banner colours per clan in the HUD.
6. Balance pass with a headless benchmark script (win-rate and time-to-victory per difficulty).

## Known Bugs

None known. Both suites pass. Watch list:

* Very long sessions (>40 in-game years) only covered in simulation, not in the browser.
* Touch: two-finger pinch zoom is implemented but only manually verified (jsdom cannot test it).

## Architecture

```
index.html → src/main.js ─┬─ src/render.js   (canvas world + minimap, no game rules)
                          ├─ src/input.js    (pointer/keyboard → engine commands, camera)
                          ├─ src/ui.js       (HUD DOM, panels, modals; reads state, sends commands)
                          ├─ src/ai.js       (aiStep(state, dt) — the rival jarl)
                          └─ src/engine.js   (pure simulation: createGame/step + exported commands)
                                   └─ src/data.js (all tunable constants & definitions)
```

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
* **Placeholder art is generated at runtime** (canvas paths, emoji glyphs for icons/units) so no
  third-party asset is ever committed; a future art pass can replace the drawing functions
  without touching rules.

## Files/Systems Modified Recently

* `src/data.js` — balance pass: forge consumes iron, house cap 8, easy-AI production 0.92.
* `src/engine.js` — building registry fix (`buildingsById`), map fairness block, blob overwrite
  guard, mine/capture rules, `holdUnit`, `demolish`, `countDone`.
* `src/ai.js` — rewritten worker assignment, population-scaled building plan, deposit-seeking
  expansion, famine handling, training gate.
* `src/render.js` — off-map border crash fix, capture marker cleanup.
* `tests/engine.test.js`, `tests/ui.smoke.test.js` — new suites.
* `README.md`, `PROJECT_STATE.md`, `package.json`, `.gitignore`, `tools/serve.mjs` — added.

## How To Run

```bash
# play
node tools/serve.mjs         # → http://localhost:8080

# test
npm test                     # engine + UI suites
npm run test:engine          # no dependencies needed
npm i --no-save jsdom && npm run test:ui
```

## Last Stable Milestone

**v0.1.0 — playable prototype.** Tag/commit: first `feat:` commit on `arena/c4b5c775-replica`.
Verified by 84 engine tests (including a 20-minute headless simulation with no NaN, no economic
collapse, all four victory paths) and 39 jsdom tests that boot the real app, render frames, build,
settle, assign workers, train a unit and show the game-over overlay.
