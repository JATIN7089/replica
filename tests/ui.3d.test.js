// ============================================================================
// Northhold — 3D integration test (jsdom + a fake GL backend).
// Exercises the *complete* 3D pipeline — world build, buildings, units,
// territory, effects, seasons, camera, picking — without needing a GPU.
//
//   node tests/ui.3d.test.js
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
function section(t) { console.log(`\n${t}`); }

// ---------------------------------------------------------------- jsdom
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/' });
const { window } = dom;
for (const prop of ['clientWidth', 'clientHeight']) {
  Object.defineProperty(window.HTMLCanvasElement.prototype, prop, {
    get() { return prop === 'clientWidth' ? 1280 : 720; },
  });
}
function ctx2dStub(canvas) {
  const grad = { addColorStop() {} };
  const target = {
    canvas,
    calls: 0,
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    measureText: () => ({ width: 12 }),
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return () => { t.calls++; };
    },
    set(t, prop, value) { t[prop] = value; return true; },
  });
}
const contexts = new Map();
window.HTMLCanvasElement.prototype.getContext = function (kind) {
  if (kind !== '2d') return null;
  if (!contexts.has(this)) contexts.set(this, ctx2dStub(this, kind));
  return contexts.get(this);
};
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLCanvasElement = window.HTMLCanvasElement;

// ---------------------------------------------------------------- modules
const THREE = await import(path.join(root, 'vendor/three.module.min.js'));
const E = await import(path.join(root, 'src/engine.js'));
const { aiStep } = await import(path.join(root, 'src/ai.js'));
const { createRenderer3D } = await import(path.join(root, 'src/render3d.js'));
const { tileElevation, elevationAt } = await import(path.join(root, 'src/models3d.js'));

// ---------------------------------------------------------------- fake GL
function fakeRenderer(canvas) {
  return {
    domElement: canvas,
    frames: 0,
    scenes: 0,
    shadowMap: {},
    outputColorSpace: null,
    setPixelRatio(v) { this.pixelRatio = v; },
    setSize(w, h) { this.size = { w, h }; },
    render(scene, camera) {
      this.frames++;
      this.lastScene = scene;
      this.lastCamera = camera;
      this.triangles = 0;
      scene.traverse((o) => {
        if (o.isMesh && o.visible) {
          const g = o.geometry;
          if (g && g.index) this.triangles += g.index.count / 3;
          else if (g && g.attributes.position) this.triangles += g.attributes.position.count / 3;
        }
      });
    },
    dispose() { this.disposed = true; },
  };
}

const canvas = document.createElement('canvas');
const gl = fakeRenderer(canvas);
const r3d = createRenderer3D(canvas, { rendererFactory: () => gl });

const state = E.createGame({ clanId: 'wolf', difficulty: 'normal', mapSeed: 808 });
const ui = {
  selectedUnits: new Set(),
  selectedBuildingId: null,
  highlightTiles: new Set(),
  highlightCosts: new Map(),
  highlightColor: '#ffd98a',
  hoverTile: null,
  mode: 'select',
};

const countIn = (group) => group.children.length;
function frames(n, dt = 0.05, withAI = true) {
  for (let i = 0; i < n; i++) {
    E.step(state, dt);
    if (withAI) aiStep(state, dt);
    r3d.draw(state, ui, dt);
  }
}

// ---------------------------------------------------------------- tests
section('World build');
{
  frames(3);
  ok(gl.frames === 3, 'the 3D renderer draws frames', gl.frames);
  ok(gl.size.w === 1280 && gl.size.h === 720, 'the renderer is sized to the canvas', JSON.stringify(gl.size));
  ok(countIn(r3d.layers.terrain) === state.tiles.length, 'a mesh exists for every hex tile',
    `${countIn(r3d.layers.terrain)} / ${state.tiles.length}`);
  ok(countIn(r3d.layers.decor) === state.tiles.length, 'every tile has decorations', countIn(r3d.layers.decor));
  ok(gl.triangles > 5000, 'the scene has real geometry', Math.round(gl.triangles));
  const first = r3d.layers.terrain.children[0];
  ok(!!first.getObjectByName('slab'), 'tiles are built as slabs');
}

section('Buildings');
{
  const clan = state.clans[0];
  clan.res.wood = 900; clan.res.stone = 900; clan.res.food = 900; clan.res.krown = 900;
  const before = countIn(r3d.layers.buildings);
  const tile = state.starts[0];
  E.build(state, tile.id, 'house');
  E.build(state, tile.id, 'tower');
  frames(3, 0.05, false);
  ok(countIn(r3d.layers.buildings) === before + 2, 'new buildings appear in the scene',
    `${before} → ${countIn(r3d.layers.buildings)}`);
  const houseEntry = [...r3d.layers.buildings.children].find((g) => g.getObjectByName('scaffold'));
  ok(!!houseEntry, 'unfinished buildings show scaffolding');
  frames(600, 0.05, false);
  const stillScaffold = [...r3d.layers.buildings.children].filter((g) => g.getObjectByName('scaffold')?.visible);
  ok(stillScaffold.length < 2, 'scaffolding disappears once work completes', stillScaffold.length);
  const house = state.starts[0].buildings.find((b) => b.type === 'house');
  const demolition = E.demolish(state, house.id, house.clan);
  ok(demolition.ok, 'a house can be demolished', demolition.reason || '');
  frames(3, 0.05, false);
  ok(countIn(r3d.layers.buildings) === before + 1, 'demolished buildings leave the scene',
    countIn(r3d.layers.buildings));
  ok(!r3d.layers.buildings.children.some((g) => g.userData.buildingId === house.id),
    'the demolished building mesh is really gone');
}

section('Units & combat visuals');
{
  // the start tile is already full (3/3), so settle a neighbour for the barracks
  state.clans[0].res.food = 400;
  const plotTile = E.neighborsOf(state.starts[0], state).find((t) => t.owner === null);
  ok(E.colonize(state, plotTile.id, 0).ok, 'a neighbour tile was settled for the barracks');
  const barracksRes = E.build(state, plotTile.id, 'barracks');
  ok(barracksRes.ok, 'barracks placed in 3D test', barracksRes.reason || '');
  const barracks = barracksRes.building;
  barracks.done = true; barracks.build = 0;
  E.trainUnit(state, 'warrior');
  frames(200, 0.05, false);
  const warriors = E.unitsOf(state, 0).filter((u) => u.type === 'warrior');
  ok(warriors.length >= 1, 'a warrior was trained');
  ok(countIn(r3d.layers.units) === state.units.length, 'a 3D body exists for every unit',
    `${countIn(r3d.layers.units)} / ${state.units.length}`);
  const body = r3d.layers.units.children.find((g) => g.userData.style);
  ok(!!body && !!body.userData.parts.weapon, 'unit bodies expose animated parts');
  ok(!!body.getObjectByName('selectRing'), 'units carry a selection ring');
  ok(r3d.layers.units.children.every((g) => typeof g.userData.unitId === 'number'),
    'every unit mesh knows which unit it belongs to');

  // selection + move order → ring lights up and a marker line appears
  const w = warriors[0];
  const wMesh = r3d.layers.units.children.find((g) => g.userData.unitId === w.id);
  ok(!!wMesh, 'the selected warrior has a mesh');
  ui.selectedUnits = new Set([w.id]);
  const dest = E.neighborsOf(E.tileById(state, w.tileId), state)[0];
  E.commandMove(state, [w.id], dest.id);
  frames(6, 0.05, false);
  const ring = wMesh.getObjectByName('selectRing');
  ok(ring.material.opacity > 0.5, 'selected units light their ring', ring.material.opacity);
  ok(countIn(r3d.layers.fx) >= 2, 'order markers are drawn for selected units', countIn(r3d.layers.fx));

  // damage → hp bar appears, floaters become sprites
  w.hp = w.maxHp * 0.5;
  E.addFloater(state, w.x, w.y, '12', '#ffd07a', 0.8);
  frames(3, 0.05, false);
  ok(E.unitsOf(state, 0).length === state.units.filter((u) => u.clan === 0).length, 'unit bookkeeping is consistent');
  ui.selectedUnits = new Set();
  E.commandAttack(state, [w.id], null, E.buildingsOf(state, 1, 'townhall')[0].id, state.starts[1].id);
  frames(400, 0.05, false);
  const enemyHall = E.buildingsOf(state, 1, 'townhall')[0];
  ok(!enemyHall || enemyHall.hp < enemyHall.maxHp, 'the assault reaches the enemy hall in 3D too');
}

section('Territory, highlights & seasons');
{
  ok(countIn(r3d.layers.territory) >= 2, 'territory borders are rendered', countIn(r3d.layers.territory));
  ui.highlightTiles = new Set([state.starts[0].id, ...E.neighborsOf(state.starts[0], state).slice(0, 2).map((t) => t.id)]);
  frames(2, 0.05, false);
  ok(countIn(r3d.layers.fx) >= ui.highlightTiles.size, 'build/settle highlights are rendered',
    `${countIn(r3d.layers.fx)} for ${ui.highlightTiles.size} tiles`);
  ui.highlightTiles = new Set();
  ui.hoverTile = state.tiles[5];
  frames(2, 0.05, false);
  ok(true, 'hover ring updates without errors');
  ui.hoverTile = null;

  const sampleIndex = state.tiles.findIndex((t) => t.terrain === 'plains');
  const entry = r3d.layers.terrain.children[sampleIndex];
  // pin the clock to mid-summer, draw, read the terrain colour
  state.time.month = 4;
  state.time.monthProgress = 2;
  frames(2, 0.05, false);
  const summerColor = entry.getObjectByName('slab').material.color.getHexString();
  const summerSeason = E.seasonOf(state).key;
  // then pin it to deep winter
  state.time.month = 11;
  state.time.monthProgress = 5;
  frames(2, 0.05, false);
  const winterColor = entry.getObjectByName('slab').material.color.getHexString();
  ok(summerSeason === 'summer' && E.seasonOf(state).key === 'winter', 'the season clock was moved');
  ok(summerColor !== winterColor, 'terrain turns white in winter', `${summerColor} → ${winterColor}`);
  const r = parseInt(winterColor.slice(0, 2), 16);
  const g2 = parseInt(winterColor.slice(2, 4), 16);
  const b = parseInt(winterColor.slice(4, 6), 16);
  ok(b > 130 && b >= r - 6 && g2 >= r - 6, 'winter terrain is pale and cold-toned', winterColor);
  const sr = parseInt(summerColor.slice(0, 2), 16);
  const sg = parseInt(summerColor.slice(2, 4), 16);
  ok(sg > sr, 'summer terrain keeps its green cast', summerColor);
}

section('Camera & picking (3D)');
{
  const rig = r3d.rig;
  const start = { ...rig.target };
  r3d.panBy(120, -60);
  ok(rig.target.x !== start.x || rig.target.z !== start.z, 'panning moves the camera target');
  const yaw = rig.yaw;
  r3d.rotateBy(0.5);
  ok(Math.abs(rig.yaw - (yaw + 0.5)) < 1e-9, 'rotating turns the camera');
  const pitch = rig.pitch;
  r3d.tiltBy(0.2);
  ok(rig.pitch > pitch, 'tilting raises the pitch');
  r3d.tiltBy(9);
  ok(rig.pitch <= rig.maxPitch + 1e-9, 'pitch is clamped', rig.pitch);
  const z = rig.distance;
  r3d.setZoom(1);
  ok(rig.distance === rig.minDistance, 'zoom is clamped to the minimum', rig.distance);
  r3d.setZoom(9999);
  ok(rig.distance === rig.maxDistance, 'zoom is clamped to the maximum', rig.distance);
  r3d.setZoom(z);

  r3d.centerOn(state.starts[0].x, state.starts[0].y);
  frames(2, 0.05, false);
  let hits = 0;
  const tiles = [...state.tiles].slice(0, 40);
  for (const tile of tiles) {
    const p = r3d.groundToScreen(tile.x, tile.y, 0.1);
    if (p.behind || p.x < 0 || p.y < 0 || p.x > 1280 || p.y > 720) continue;
    const picked = r3d.screenToTile(state, p.x, p.y);
    if (picked && picked.id === tile.id) hits++;
    else ok(false, `picking tile ${tile.q},${tile.r} through the live renderer`);
  }
  ok(hits >= 20, 'screen picking works through the live renderer', hits);
}

section('Long run & cleanup');
{
  frames(900, 0.05, true);
  ok(true, '900 frames of 3D rendering with the AI running: no exceptions');
  ok(Number.isFinite(r3d.rig.target.x), 'camera state stays finite');
  const live = new Set(state.units.map((u) => u.id));
  let stale = 0;
  r3d.layers.units.children.forEach((g) => { if (g.userData.staleTest) stale++; });
  ok(stale === 0, 'no stale unit meshes');
  ok(countIn(r3d.layers.units) === live.size, 'unit meshes match the living units',
    `${countIn(r3d.layers.units)} / ${live.size}`);
  ok(countIn(r3d.layers.buildings) === state.tiles.reduce((n, t) => n + t.buildings.length, 0),
    'building meshes match the world', countIn(r3d.layers.buildings));
  r3d.dispose();
  ok(gl.disposed === true, 'dispose releases the GL backend');
}


section('Terrain relief, work parties & ground-aware units');
{
  // an isolated world so this section cannot disturb the others
  const stage2 = document.createElement('div');
  document.body.appendChild(stage2);
  const canvas2 = document.createElement('canvas');
  stage2.appendChild(canvas2);
  const gl2 = fakeRenderer(canvas2);
  const r2 = createRenderer3D(canvas2, { rendererFactory: () => gl2 });
  const st2 = E.createGame({ clanId: 'wolf', difficulty: 'normal', mapSeed: 5 });
  const ui2 = { selectedUnits: new Set(), highlightTiles: new Set(), highlightCosts: new Map(), hoverTile: null };
  const draw2 = (n, dt = 0.05) => { for (let i = 0; i < n; i++) { E.step(st2, dt); r2.draw(st2, ui2, dt); } };

  // --- the map is a real height field, not a flat board
  draw2(2);
  const tops = r2.layers.terrain.children.map((g) => g.userData.terrainTop);
  const spread = Math.max(...tops) - Math.min(...tops);
  ok(spread > 1, 'the terrain has real relief in the scene', spread.toFixed(2));
  ok(new Set(tops.map((t) => t.toFixed(1))).size > 5, 'many distinct ground levels are drawn');
  const slabs = r2.layers.terrain.children.map((g) => g.getObjectByName('slab'));
  ok(slabs.every((sl) => Math.abs(sl.position.y - (-0.95)) < 0.01), 'every column is rooted at the common floor');

  // --- buildings stand on their tile's surface
  const startTile = st2.starts[0];
  const built = E.build(st2, startTile.id, 'woodcutter', 0);
  ok(built.ok, 'a woodcutter can be raised on the start tile', built.reason || '');
  draw2(200);   // finish construction
  const campMesh = r2.layers.buildings.children.find((g) => g.userData.buildingId === built.building.id);
  ok(!!campMesh, 'the woodcutter has a 3D mesh');
  ok(Math.abs(campMesh.position.y - tileElevation(startTile)) < 1e-6,
    'the building stands exactly on its tile surface', campMesh.position.y.toFixed(2));
  ok(campMesh.position.y > 0, 'which is above the water line');

  // --- workers walk out to a resource node and back
  const assigned = E.assignWorker(st2, built.building.id, 1);
  ok(assigned.ok, 'a villager can take the woodcutting job', assigned.reason || '');
  draw2(2);
  const party = r2.layers.workers.children.find((g) => g.userData.buildingId === built.building.id);
  ok(!!party, 'the staffed woodcutter has a work party in the world');
  ok(party.children.length === 1, 'one worker per assigned villager', party.children.length);
  const nodeTile = st2.tileById.get(party.userData.nodeId);
  ok(!!nodeTile, 'the party knows which resource node it works');
  ok(['forest', 'wildlife'].includes(nodeTile.terrain), 'wood is cut in the forest', nodeTile.terrain);
  const worker = party.children[0];
  const home = { x: campMesh.position.x, z: campMesh.position.z };
  const node = { x: nodeTile.x, z: nodeTile.y };
  let maxFromHome = 0, minFromHome = Infinity, closestToNode = Infinity, moved = 0;
  let prev = { x: worker.position.x, z: worker.position.z };
  for (let i = 0; i < 300; i++) {
    draw2(1);
    const dHome = Math.hypot(worker.position.x - home.x, worker.position.z - home.z);
    const dNode = Math.hypot(worker.position.x - node.x, worker.position.z - node.z);
    maxFromHome = Math.max(maxFromHome, dHome);
    minFromHome = Math.min(minFromHome, dHome);
    closestToNode = Math.min(closestToNode, dNode);
    moved += Math.hypot(worker.position.x - prev.x, worker.position.z - prev.z);
    prev = { x: worker.position.x, z: worker.position.z };
  }
  ok(maxFromHome > 0.5, 'the worker leaves the building and walks to the node', maxFromHome.toFixed(2));
  ok(minFromHome < 0.3, 'and returns home each round trip', minFromHome.toFixed(2));
  ok(closestToNode < 0.6, 'it works right at the resource node', closestToNode.toFixed(2));
  ok(moved > 4, 'it is actually travelling, not sliding in place', moved.toFixed(1));
  ok(worker.position.y > 0, 'the worker walks on the terrain surface, not on a plane', worker.position.y.toFixed(2));

  // --- units stand on the ground too
  const warrior = E.spawnUnit(st2, 0, 'warrior', startTile);
  E.commandMove(st2, [warrior.id], E.neighborsOf(startTile, st2)[0].id);
  draw2(30);
  const wMesh = r2.layers.units.children.find((g) => g.userData.unitId === warrior.id);
  ok(!!wMesh, 'the warrior has a mesh');
  const groundUnder = elevationAt(st2, warrior.x, warrior.y);
  ok(Math.abs(wMesh.position.y - groundUnder) < 0.25,
    'the unit follows the ground as it walks', `${wMesh.position.y.toFixed(2)} vs ${groundUnder.toFixed(2)}`);

  // --- picking respects the terrain height
  const rig2 = r2.rig;
  const mountain = st2.tiles.find((t) => t.terrain === 'mountain');
  r2.centerOn(mountain.x, mountain.y);
  rig2.distance = 30;
  draw2(140);   // let the eased camera settle on the mountain
  const projected = r2.groundToScreen(mountain.x, mountain.y, tileElevation(mountain) + 0.05);
  ok(projected.x > 0 && projected.x < 1280 && projected.y > 0 && projected.y < 720,
    'the mountain is on screen', `${projected.x.toFixed(0)},${projected.y.toFixed(0)}`);
  const picked = r2.screenToTile(st2, projected.x, projected.y);
  ok(picked && picked.id === mountain.id, 'clicking a mountain picks the mountain, not the ground behind it',
    picked ? `${picked.q},${picked.r} (${picked.terrain})` : 'null');

  // --- work parties follow the workforce
  E.assignWorker(st2, built.building.id, -1);
  draw2(2);
  ok(!r2.layers.workers.children.some((g) => g.userData.buildingId === built.building.id),
    'the party disappears when the job is abandoned');
  ok(countIn(r2.layers.workers) === 0, 'no worker meshes are left behind', countIn(r2.layers.workers));
  r2.dispose();
}

section('Renderer switching (canvas swap)');
{
  // A canvas that has handed out a 2D context can never host WebGL, so the view
  // swaps in a brand new element. Prove the recreated renderer works.
  const stage = document.createElement('div');
  document.body.appendChild(stage);
  const first = document.createElement('canvas');
  first.id = 'map';
  first.className = 'map-canvas';
  stage.appendChild(first);
  first.getContext('2d');           // "used" as a 2D surface
  const replacement = document.createElement('canvas');
  replacement.id = first.id;
  replacement.className = first.className;
  first.replaceWith(replacement);
  ok(stage.children.length === 1, 'exactly one map canvas remains in the stage');
  ok(stage.firstChild === replacement, 'the replacement canvas is the live one');
  ok(stage.firstChild.id === 'map' && stage.firstChild.className === 'map-canvas',
    'the replacement keeps its id and class (CSS and lookups still work)');
  const gl2 = fakeRenderer(replacement);
  const r2 = createRenderer3D(replacement, { rendererFactory: () => gl2 });
  r2.draw(state, ui, 0.05);
  ok(gl2.frames === 1, 'the recreated 3D renderer draws on the new canvas', gl2.frames);
  ok(r2.layers.terrain.children.length === state.tiles.length, 'the world is rebuilt on the new canvas');
  r2.dispose();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
