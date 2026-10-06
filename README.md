# Northhold

**A browser real-time strategy game in the spirit of Northgard** — lead a Viking clan onto a
cold shore, settle hex tiles, keep your people fed through winter, expand your territory,
raise a warband and write your name into the sagas before a rival jarl does.

Northhold is an original implementation. It shares the *genre and feel* of Northgard
(tile-based settlement, worker economy, seasonal survival, fame victory), but all code,
art (canvas-drawn), text and balance here are original. It is **not** affiliated with
Shiro Games and contains no Northgard assets, code or data.

<p align="center"><em>Playable right now: no build step, no network calls — plain ES modules, and a full 3D
renderer built on a vendored copy of three.js (MIT).</em></p>

---

## Play it

```bash
node tools/serve.mjs          # serves the game on http://localhost:8080
# or simply open index.html in a browser (any static server works)
```

Then: pick a clan, pick a difficulty, hit **Raise the banner**.

## What is in the game

| System | Status | Notes |
|---|---|---|
| Hex map + camera | ✅ | 91-tile procedural map: plains, forest, fertile, wildlands, lakes, mountains, iron, ruins. Drag/WASD/pinch pan, wheel zoom, minimap. |
| 3D presentation | ✅ | The whole board in 3D: extruded hex terrain, decorated forests/mountains/water, procedural buildings and units, selection rings, projectiles, snow in winter. Orbit/tilt/zoom camera. Automatic 2D fallback when WebGL is missing, and a 3D ⇄ 2D switch in the pause menu. |
| Territory | ✅ | Settle unclaimed tiles bordering your land for food; capture enemy tiles by standing on them with a warband. |
| Resources | ✅ | Food, wood, krowns, stone, iron, lore + fame and happiness, with per-month rates in the HUD. |
| Buildings | ✅ | 14 types: Town Hall, House, Woodcutter's Lodge, Hunter's Lodge, Farm, Fisherman Hut, Stone/Iron Mine, Forge, Market, Brewery, Altar of Odin, Barracks, Watchtower, Trading Post. |
| Workers | ✅ | Villagers are assigned per building with a worker picker; idle villagers do nothing. |
| Population | ✅ | Population cap from houses, growth driven by happiness and food, starvation kills villagers. |
| Seasons | ✅ | Spring/summer/autumn/winter cycle. Winter collapses food output, raises consumption and freezes the map white. |
| Combat | ✅ | Warriors, Axe Throwers, Shield Bearers, Scouts and a Warchief hero. Auto-acquire, chase, buildings take damage, towers shoot, units gain fame when they kill. |
| Enemy AI | ✅ | A rival jarl that expands, staffs jobs, chases deposits, builds a settlement, trains a warband and attacks. Three difficulties (Thrall/Karl/Jarl). |
| Blessings | ✅ | Lore → Altar → choose 1 of 3 permanent blessings (12 available, up to 5 per game). |
| Victory | ✅ | Fame (300), Trade (2200 krowns with a Market/Trading Post), Domination (burn their Town Hall), or highest fame after 9 years. |
| Save/load | ✅ | localStorage save + autosave every in-game year, JSON export/import, continue from the start screen, pause menu. |
| Audio | ⏳ | Not yet. |

## Controls

| Action | Input |
|---|---|
| Select unit / building | Left click or tap |
| Move / attack | Click or right-click a tile, unit or building |
| Box select | Drag a box |
| Add to selection | Shift + click |
| Pan | Drag with middle mouse, WASD/arrows, or drag on the minimap |
| Zoom | Mouse wheel, pinch, or the zoom buttons |
| Orbit / tilt (3D) | `Q` / `E` to rotate, `R` / `F` to tilt, middle-drag + `Ctrl` to orbit, or the on-screen camera buttons |
| Jump home | `H` · Cycle warriors: `Tab` · Pause: `Space` · Cancel: `Esc` |
| Settle mode | `C` · Move mode: `M` · Speeds: `1` `2` `3` |
| Pause menu | `Esc` (twice if something is selected) or the ☰ button — save, load, export, import, restart |

## Project layout

```
index.html            app shell + all overlays (start screen, help, blessings, game over)
src/data.js           every tunable: costs, yields, units, buildings, clans, seasons, victory
src/engine.js         pure simulation (no DOM): map gen, economy, construction, combat, AI support
src/ai.js             the rival jarl's brain
src/view.js           renderer adapter: 3D ⇄ 2D, one API (draw, picking, camera, switching)
src/render3d.js       three.js scene, camera rig, picking, per-frame world sync
src/models3d.js       procedural 3D meshes: hex terrain, trees, mountains, water, buildings, units
src/render.js         2D canvas renderer (the fallback): terrain art, territories, units, minimap
src/input.js          pointer/keyboard/minimap input, camera, orders
src/ui.js             HUD: resource bar, contextual panels, build catalog, modals
src/main.js           bootstrap + game loop glue, pause menu, autosave (debug hook on window.__northhold)
src/save.js           serialise/deserialise the whole state, localStorage slots, file export/import
tools/serve.mjs       dependency-free static server
vendor/               three.js r169 (MIT) — vendored so the game needs no CDN
tests/engine.test.js  84 simulation tests (map, economy, seasons, combat, victory, AI, determinism)
tests/save.test.js    48 save/load tests (round trip, exact reload determinism, bad input)
tests/render3d.test.js 101 3D tests (geometry, camera clamps, exact screen picking, model building)
tests/ui.3d.test.js   49 jsdom tests running the real 3D pipeline through a fake GL backend
tests/ui.smoke.test.js 82 jsdom tests that boot the real app and drive it (2D fallback path)
```

## Tests

```bash
npm test              # all five suites (364 assertions)
npm run test:engine   # headless simulation (needs no dependencies)
npm run test:3d       # 3D models/camera/picking + jsdom 3D integration
npm run test:ui       # boots the app in jsdom (needs: npm i --no-save jsdom)
```

The 3D suites are honest about their limits: jsdom has no WebGL, so the integration suite injects a
fake GL backend through the renderer's `rendererFactory` seam and asserts on the real scene graph —
mesh counts track the world exactly, picks are pixel-accurate, and 900 frames run with the AI live.

The engine suite simulates thousands of ticks: it checks map fairness (every start gets wood,
fertile land, stone, iron and water), that workers are the only source of production, winter
collapse, capture rules, all four victory paths, long-run stability (no NaN, no economic
collapse over ~20 minutes of play) and determinism for a fixed seed.

## Roadmap

1. ~~Playable prototype: map, economy, workers, buildings, combat, AI, UI~~ ✅
2. ~~Save/load (localStorage + JSON export) and pause menu~~ ✅
3. ~~Full 3D presentation (map, buildings, units), with the 2D renderer as a fallback~~ ✅
4. Clans differentiated by more than modifiers (Raven scouting, Wolf aggression) — done partly
5. More content: events, runestones, neutral monsters, a 3rd/4th clan, larger maps
6. Audio: ambient wind/waves, UI clicks, battle cues (WebAudio, original synthesis)
7. Art pass: more terrain variety, animated unit rigs, banner/hero portraits
8. Mobile UX polish and performance budget

## License

MIT (see `LICENSE`). Original work; inspired by the design of Northgard (Shiro Games) with no
affiliated assets or code.
