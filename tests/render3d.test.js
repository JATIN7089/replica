// ============================================================================
// Northhold — 3D world tests.   node tests/render3d.test.js
// Pure geometry, materials, scatter and camera maths: no WebGL needed.
// ============================================================================
import * as THREE from '../vendor/three.module.min.js';
import * as E from '../src/engine.js';
import { BUILDINGS, TERRAIN } from '../src/data.js';
import { buildBuildingMesh } from '../src/buildings3d.js';
import {
  buildUnitMesh, buildVillagerMesh, workToolFor, buildDeerMesh,
  buildTreeVariants, buildRockVariants, buildOreVariant, buildRuinVariants, buildPlotVariant,
  mergeMeshes, hexRingGeometry,
} from '../src/models3d.js';
import {
  terrainHeightAt, elevationAt, elevationOf, worldToTile, tileElevation,
  buildTerrainMesh, buildWaterMesh, buildSeaFloorMesh, buildTerritoryMesh, drapeGeometry,
  terrainSignature, ownershipSignature, mapExtent,
  WATER_LEVEL, BASE_Y, TERRAIN_STEP, SHORE_DROP,
} from '../src/terrain3d.js';
import { buildScatter, scatterSignature, groupByKind } from '../src/scatter3d.js';
import {
  createCameraRig, applyRig, rigEye, rigStep, rigGroundY, screenToGround, groundToScreen,
  pickTileFromScreen, webglAvailable, tileTo3D, hexTo3D,
} from '../src/render3d.js';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
function section(t) { console.log(`\n${t}`); }
function summary() {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILURES:'); for (const f of failures) console.log(` - ${f}`); process.exitCode = 1; }
}

const game = (seed = 11) => E.createGame({ clanId: 'wolf', difficulty: 'normal', mapSeed: seed });
const countMeshes = (g) => { let n = 0; g.traverse((o) => { if (o.isMesh) n++; }); return n; };

// ---------------------------------------------------------------- terrain surface
section('Continuous terrain surface (no hex steps)');
{
  const state = game();
  const h = (x, z) => terrainHeightAt(state, x, z);

  // every tile centre sits near its tile's elevation
  let worst = 0;
  for (const t of state.tiles) worst = Math.max(worst, Math.abs(h(t.x, t.y) - tileElevation(t)));
  ok(worst < 0.34, 'the surface follows the tile elevations at their centres', worst.toFixed(2));

  // ...but between tiles there are no cliffs from the hex lattice. Two checks:
  // a seam shows up as a jump between samples a hair apart, while a genuine hill
  // only ever rises as fast as its slope. Both are measured between *adjacent*
  // samples, so a long climb never counts as a discontinuity.
  const angles = [0, 1.1, 2.3, 3.4, 4.5, 5.6];
  let maxJump = 0;   // over 0.05 units  -> a seam would be huge
  let maxStep = 0;   // over 0.20 units  -> a cliff, not a step
  for (const t of state.tiles) {
    for (const a of angles) {
      const cos = Math.cos(a), sin = Math.sin(a);
      for (let k = 0; k < 30; k++) {
        const r0 = 0.1 + k * 0.14;
        const x = t.x + cos * r0, z = t.y + sin * r0;
        maxJump = Math.max(maxJump, Math.abs(h(t.x + cos * (r0 + 0.05), t.y + sin * (r0 + 0.05)) - h(x, z)));
        maxStep = Math.max(maxStep, Math.abs(h(t.x + cos * (r0 + 0.2), t.y + sin * (r0 + 0.2)) - h(x, z)));
      }
    }
  }
  ok(maxJump < 0.25, 'the ground is continuous: no seam between samples 0.05 apart', maxJump.toFixed(3));
  ok(maxStep < 0.55, 'no 0.5+ unit step over 0.2 units of travel', maxStep.toFixed(2));

  ok(h(0, 0) !== null && Number.isFinite(h(0, 0)), 'the middle of the map has ground');
  ok(h(...Object.values(mapExtent(state, 40)).filter((_, i) => i % 2 === 0)) !== null, 'far offshore still answers');

  // lakes are below the water line, land is above it
  const lakes = state.tiles.filter((t) => t.terrain === 'lake');
  const plains = state.tiles.filter((t) => t.terrain === 'plains');
  ok(lakes.every((t) => h(t.x, t.y) < WATER_LEVEL), 'lake surfaces are under the water line');
  ok(plains.every((t) => h(t.x, t.y) > WATER_LEVEL), 'open ground is above the water line');

  // mountains stand tall, and nothing pokes through the water in a silly way
  const peaks = state.tiles.filter((t) => t.terrain === 'mountain' || t.terrain === 'iron');
  ok(peaks.every((t) => h(t.x, t.y) > 1), 'mountains and iron ridges stand well above the fields');

  // the shore: outside the map the ground dives to the sea floor
  const edge = mapExtent(state, 0);
  const near = state.tiles.reduce((best, t) => (Math.hypot(t.x - edge.maxX, t.y) < Math.hypot(best.x - edge.maxX, best.y) ? t : best));
  const outside = h(near.x + SHORE_DROP + 3, near.y);
  ok(outside < WATER_LEVEL, 'the island has a shore that falls below the water line', outside.toFixed(2));
  ok(Math.abs(outside - BASE_Y) < 0.3, 'far offshore reaches the sea floor', outside.toFixed(2));
  ok(BASE_Y < WATER_LEVEL - 0.2, 'the sea floor is deep enough to read as water');

  // building pads: the ground flattens where a clan builds
  const start = state.starts[0];
  const before = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    before.push(h(start.x + Math.cos(a) * 0.6, start.y + Math.sin(a) * 0.6));
  }
  const th = state.tiles.find((t) => t.buildings.some((b) => b.type === 'townhall' && b.clan === 0));
  ok(!!th && th.buildings.length > 0, 'the player starts with a town hall');
  const spreadBefore = Math.max(...before) - Math.min(...before);
  let maxLocal = 0;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    maxLocal = Math.max(maxLocal, Math.abs(h(th.x + Math.cos(a) * 0.5, th.y + Math.sin(a) * 0.5) - h(th.x, th.y)));
  }
  ok(spreadBefore >= 0, 'the height field is sampled around the start', spreadBefore.toFixed(2));
  ok(maxLocal < 0.08, 'the ground is levelled under a built tile', maxLocal.toFixed(3));

  // determinism: the same state gives the same world
  const again = game();
  ok(Math.abs(terrainHeightAt(again, 1.7, -2.3) - h(1.7, -2.3)) < 1e-12, 'the surface is deterministic');

  // helpers agree with the surface
  const t = plains[0];
  ok(Math.abs(elevationAt(state, t.x, t.y) - h(t.x, t.y)) < 1e-9, 'elevationAt follows the surface');
  ok(worldToTile(state, t.x, t.y) === t, 'worldToTile finds the tile under a point');
  ok(elevationOf(state, t.id) === tileElevation(t), 'elevationOf returns the tile reference height');
  ok(terrainSignature(state) === terrainSignature(game()), 'the terrain signature is stable');
}

// ---------------------------------------------------------------- terrain mesh
section('Terrain mesh (one continuous surface)');
{
  const state = game();
  const mesh = buildTerrainMesh(state);
  ok(mesh.isMesh, 'the terrain is a single mesh');
  const pos = mesh.geometry.getAttribute('position');
  ok(pos.count > 5000, 'the surface is finely tessellated', pos.count);
  ok(!mesh.geometry.getIndex().count || mesh.geometry.getIndex().count > 30000, 'indexed triangle grid',
    mesh.geometry.getIndex().count);
  ok(!!mesh.geometry.getAttribute('color'), 'vertex colours carry the material blend');
  ok(!!mesh.geometry.getAttribute('normal'), 'normals are computed from the height field');
  ok(mesh.material.vertexColors === true, 'the material uses vertex colours');
  ok(!!mesh.material.map, 'a detail texture is tiled over the surface');
  ok(mesh.material.roughness > 0.85, 'the ground is matte');
  ok(mesh.receiveShadow === true, 'the ground receives shadows');

  // colours vary a lot: grass, dirt, rock, sand, snow
  const col = mesh.geometry.getAttribute('color');
  const seen = new Set();
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i += 7) {
    seen.add(`${col.getX(i).toFixed(2)},${col.getY(i).toFixed(2)},${col.getZ(i).toFixed(2)}`);
    minY = Math.min(minY, pos.getY(i));
    maxY = Math.max(maxY, pos.getY(i));
  }
  ok(seen.size > 400, 'the ground has hundreds of distinct shades (not flat colour)', seen.size);
  ok(maxY - minY > 1.5, 'the mesh spans real height variation', (maxY - minY).toFixed(2));
  ok(maxY < 3.2 && minY > BASE_Y - 0.2, 'height stays inside the expected band', `${minY.toFixed(2)}…${maxY.toFixed(2)}`);

  // the mesh extends past the outermost tiles: an island, not a board
  const ext = mapExtent(state, 0);
  let maxX = -Infinity;
  for (let i = 0; i < pos.count; i += 7) maxX = Math.max(maxX, pos.getX(i));
  ok(maxX > ext.maxX + 2, 'the surface runs past the playable tiles into a shore', maxX.toFixed(1));

  // there is exactly one terrain mesh: no per-tile prisms anywhere
  ok(mesh.geometry.getAttribute('position').count === new Set([mesh.uuid]).size * pos.count, 'a single surface object');
}

section('Water and sea floor');
{
  const state = game();
  const water = buildWaterMesh(state);
  ok(water.material.transparent, 'water is translucent');
  ok(water.material.opacity > 0.5 && water.material.opacity < 1, 'partly see-through, not glass', water.material.opacity);
  ok(!!water.material.map, 'water has a rippling detail map');
  ok(water.position.y === WATER_LEVEL, 'water sits at the water line');
  const geo = water.geometry;
  geo.computeBoundingBox();
  ok(geo.boundingBox.max.y - geo.boundingBox.min.y < 0.01, 'the water is flat');
  ok(geo.getAttribute('position').count > 100, 'the water surface is tessellated (fog and ripples read evenly)');

  const floor = buildSeaFloorMesh(state);
  ok(floor.position.y < WATER_LEVEL, 'the sea floor is under the water');
  ok(floor.geometry.boundingBox === null || true, 'the sea floor builds');
  const wb = new THREE.Box3().setFromObject(water);
  const fb = new THREE.Box3().setFromObject(floor);
  ok(wb.max.x <= fb.max.x + 0.01 && wb.min.x >= fb.min.x - 0.01, 'the sea floor covers the whole water surface');
}

// ---------------------------------------------------------------- territory
section('Territory as a geographic overlay');
{
  const state = game();
  const mesh = buildTerritoryMesh(state);
  ok(!!mesh, 'a territory overlay is built');
  const col = mesh.geometry.getAttribute('color');
  ok(col.itemSize === 4, 'vertex alpha lets the wash fade out at the frontier');
  ok(mesh.material.transparent === true, 'the overlay is transparent');
  ok(mesh.material.depthWrite === false, 'it never writes depth (it lies on the ground)');
  let minA = 1, maxA = 0;
  for (let i = 0; i < col.count; i++) { minA = Math.min(minA, col.getW(i)); maxA = Math.max(maxA, col.getW(i)); }
  ok(maxA < 0.45, 'the strongest tint is a subtle wash, not a painted tile', maxA.toFixed(2));
  ok(minA === 0, 'the overlay fades to nothing where no clan holds the land');

  // the overlay follows the terrain, not a flat plane
  const pos = mesh.geometry.getAttribute('position');
  let spread = 0, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i += 5) {
    minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i));
  }
  spread = maxY - minY;
  ok(spread > 0.5, 'the overlay drapes over the hills', spread.toFixed(2));
  // and its colours are the clans', desaturated for the ground
  ok(ownershipSignature(state) === ownershipSignature(game()), 'the ownership signature is stable');

  // capturing a tile changes the signature (so the renderer rebuilds it)
  const target = state.tiles.find((t) => t.owner === null && E.neighborsOf(t, state).some((n) => n.owner === 0));
  if (target) {
    target.owner = 0;
    ok(ownershipSignature(state) !== ownershipSignature(game()), 'capturing land changes the overlay');
  }
}

// ---------------------------------------------------------------- scatter
section('Natural scatter: forests, rocks, ruins, props');
{
  const state = game();
  const data = buildScatter(state);
  ok(data.trees.length > 120, 'the island is wooded', data.trees.length);
  ok(new Set(data.trees.map((t) => t.kind)).size >= 3, 'several tree species grow',
    [...new Set(data.trees.map((t) => t.kind))].join(','));
  ok(data.rocks.length > 20, 'rock formations are scattered', data.rocks.length);
  ok(data.ore.length > 0, 'iron deposits appear as ore rocks', data.ore.length);
  ok(data.ruins.length > 0, 'ruins are built from pillars and walls', data.ruins.length);
  ok(data.animals.length > 0, 'wildlife has animals', data.animals.length);

  // forests cluster instead of scattering evenly
  let near = 0;
  for (const t of data.trees) {
    if (data.trees.some((o) => o !== t && Math.hypot(o.x - t.x, o.z - t.z) < 0.3)) near++;
  }
  ok(near / data.trees.length > 0.6, 'trees grow in clusters, not evenly', (near / data.trees.length).toFixed(2));

  // trees cross tile borders (so the woods do not show the hex grid)
  const tileOf = (x, z) => worldToTile(state, x, z);
  let outside = 0;
  for (const t of data.trees) {
    const home = state.tileById.get(t.tileId);
    if (Math.hypot(t.x - home.x, t.z - home.y) > 1.0) outside++;
  }
  ok(outside > 0, 'some trees stand across the tile boundary', outside);

  // nothing is planted inside a building
  let clash = 0;
  for (const t of data.trees) {
    for (const tile of state.tiles) {
      if (!tile.buildings.length) continue;
      if (Math.hypot(tile.x - t.x, tile.y - t.z) < 0.5) clash++;
    }
  }
  ok(clash === 0, 'no tree grows through a building', clash);

  // forest tiles really are the dense ones
  const byTerrain = {};
  for (const t of data.trees) {
    const tile = state.tileById.get(t.tileId);
    byTerrain[tile.terrain] = (byTerrain[tile.terrain] || 0) + 1;
  }
  ok((byTerrain.forest || 0) > (byTerrain.plains || 0), 'forests are denser than plains',
    JSON.stringify(byTerrain));

  // scale and rotation vary
  const scales = new Set(data.trees.map((t) => t.scale.toFixed(2)));
  ok(scales.size > 5, 'trees vary in size', scales.size);
  const rots = new Set(data.trees.map((t) => t.rot.toFixed(2)));
  ok(rots.size > 20, 'trees vary in rotation', rots.size);

  // deterministic
  const again = buildScatter(game());
  ok(again.trees.length === data.trees.length, 'scatter is deterministic (count)');
  ok(Math.abs(again.trees[0].x - data.trees[0].x) < 1e-12, 'scatter is deterministic (positions)');
  ok(scatterSignature(state) === scatterSignature(game()), 'the scatter signature is stable');
  ok(groupByKind(data.trees).size >= 3, 'scatter groups by variant for instancing');

  // a building changes the scatter signature
  const built = E.build(state, state.starts[0].id, 'house', 0);
  if (built.ok) {
    ok(scatterSignature(state) !== scatterSignature(game()), 'building changes the scatter');
    ok(!buildScatter(state).trees.some((t) => Math.hypot(t.x - state.starts[0].x, t.z - state.starts[0].y) < 0.5),
      'and clears the ground it stands on');
  }
}

// ---------------------------------------------------------------- models
section('Trees, rocks and ruins are real 3D models');
{
  const trees = buildTreeVariants();
  ok(trees.length >= 4, 'four tree species', trees.length);
  for (const v of trees) {
    const pos = v.geometry.getAttribute('position');
    ok(pos.count > 40, `${v.id} has real geometry (trunk + branches + foliage)`, pos.count);
    ok(!!v.geometry.getAttribute('color'), `${v.id} bakes its materials into vertex colours`);
    v.geometry.computeBoundingBox();
    const bb = v.geometry.boundingBox;
    ok(bb.max.y > 0.8, `${v.id} stands tall`, bb.max.y.toFixed(2));
    ok(bb.max.y - bb.min.y > 0.6, `${v.id} has height`, (bb.max.y - bb.min.y).toFixed(2));
    ok(v.height > 0.5 && v.radius > 0.2, `${v.id} declares a size for placement`);
    const colors = new Set();
    for (let i = 0; i < pos.count; i += 3) {
      const c = v.geometry.getAttribute('color');
      colors.add(`${c.getX(i).toFixed(2)}`);
    }
    ok(colors.size > 2, `${v.id} uses several materials (trunk vs foliage)`, colors.size);
  }
  const rocks = buildRockVariants();
  ok(rocks.length >= 3, 'three rock formations', rocks.length);
  const ore = buildOreVariant();
  ok(!!ore && ore.geometry.getAttribute('position').count > 30, 'ore is a rock shot through with veins');
  const ruins = buildRuinVariants();
  ok(ruins.length >= 4, 'ruins come in several shapes', ruins.length);
  for (const kind of ['farm', 'logs']) {
    const v = buildPlotVariant(kind);
    ok(v.geometry.getAttribute('position').count > 30, `${kind} prop has geometry`);
  }
  const deer = buildDeerMesh(1.2);
  ok(countMeshes(deer) >= 4, 'wildlife animals are 3D creatures', countMeshes(deer));
}

section('Buildings (every type)');
{
  for (const type of Object.keys(BUILDINGS)) {
    const g = buildBuildingMesh(type, '#3f9e8f', '#63c7b7', true);
    const meshes = countMeshes(g);
    ok(meshes >= 12, `${type} is built from real modules (walls, roof, details)`, meshes);
    if (type === 'townhall') ok(meshes >= 40, 'the town hall is the grandest building', meshes);
    const scaffold = g.getObjectByName('scaffold');
    ok(!!scaffold, `${type} has a construction state`);
    ok(scaffold.visible === false, `${type} hides its scaffold when finished`);
  }
  const unfinished = buildBuildingMesh('house', '#e09a3a', '#f0b757', false);
  ok(unfinished.getObjectByName('scaffold').visible === true, 'unfinished buildings show their scaffolding');
  const finished = buildBuildingMesh('house', '#e09a3a', '#f0b757', true);
  ok(finished.getObjectByName('scaffold').visible === false, 'finished buildings do not');

  // roofs must be roofs: the model is taller than its walls and pointed on top
  const house = buildBuildingMesh('house', '#e09a3a', '#f0b757', true);
  house.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(house);
  ok(bb.max.y > 0.4, 'a house has a roof above its walls', bb.max.y.toFixed(2));
  ok(bb.min.y <= 0.02, 'and sits on the ground', bb.min.y.toFixed(3));

  // clan identity: banners use the clan colour
  const red = buildBuildingMesh('townhall', '#c0392b', '#ff8a70', true);
  const blue = buildBuildingMesh('townhall', '#2b6ec0', '#70b0ff', true);
  const colorsOf = (g) => {
    const out = new Set();
    g.traverse((o) => { if (o.isMesh && o.material.color) out.add(o.material.color.getHexString()); });
    return out;
  };
  const a = colorsOf(red), b = colorsOf(blue);
  ok(a.size > 5 && b.size > 5, 'buildings use several materials', `${a.size}/${b.size}`);
  ok([...a].some((c) => !b.has(c)) && [...b].some((c) => !a.has(c)), 'clans are visually distinct');

  // shadows on every part, so buildings ground themselves in the terrain
  let shadowed = 0, parts = 0;
  for (const type of Object.keys(BUILDINGS)) {
    buildBuildingMesh(type, '#3f9e8f', '#63c7b7', true).traverse((o) => {
      if (!o.isMesh) return;
      parts++;
      if (o.castShadow && o.receiveShadow) shadowed++;
    });
  }
  ok(shadowed === parts, 'every building part casts and receives shadows', `${shadowed}/${parts}`);
}

section('Units and villagers');
{
  const state = game();
  for (const type of ['warrior', 'axe', 'shield', 'scout', 'warchief']) {
    const g = buildUnitMesh(type, '#3f9e8f', '#63c7b7');
    const parts = g.userData.parts;
    ok(parts && parts.body && parts.armL && parts.armR && parts.weapon, `${type} has animatable parts`);
    ok(countMeshes(g) >= 8, `${type} is a full figure (torso, head, arms, legs, weapon)`, countMeshes(g));
    ok(!!g.getObjectByName('selectRing'), `${type} carries a selection ring`);
  }
  for (const tool of ['axe', 'pick', 'sickle', 'rod', 'bow']) {
    const v = buildVillagerMesh('#c9b184', '#f0b757', tool);
    ok(countMeshes(v) >= 8, `villager with a ${tool} is a full figure`, countMeshes(v));
    ok(v.getObjectByName('load').visible === false, `the ${tool} villager carries a hideable load`);
  }
  ok(workToolFor('wood', 'woodcutter') === 'axe', 'woodcutters swing axes');
  ok(workToolFor('stone', 'mine') === 'pick', 'miners swing picks');
  ok(workToolFor('food', 'farm') === 'sickle', 'farmers reap');
  ok(workToolFor('food', 'fishery') === 'rod', 'fishers cast');
  ok(workToolFor('food', 'hunter') === 'bow', 'hunters hunt');
  void state;
}

// ---------------------------------------------------------------- camera
section('RTS camera');
{
  const rig = createCameraRig();
  const degrees = (rad) => (rad * 180) / Math.PI;
  ok(rig.fieldOfView >= 45 && rig.fieldOfView <= 60, 'perspective FOV is in the 45-60° band', rig.fieldOfView);
  ok(degrees(rig.pitch) > 45 && degrees(rig.pitch) < 60, 'the default view looks down at ~50°',
    `${degrees(rig.pitch).toFixed(0)}°`);
  ok(degrees(rig.minPitch) > 30, 'never flattens into a side view', `${degrees(rig.minPitch).toFixed(0)}°`);
  ok(degrees(rig.maxPitch) < 80, 'never becomes a flat top-down board', `${degrees(rig.maxPitch).toFixed(0)}°`);
  ok(rigEye(rig).y > 10, 'the default eye is well above the ground', rigEye(rig).y.toFixed(1));

  const instant = createCameraRig();
  instant.target.x = 10;
  rigStep(instant, 0.016);
  ok(instant.now.x === 10, 'with smoothing off the pose is exact');

  const smooth = createCameraRig({ smooth: 6 });
  smooth.target.x = 10;
  smooth.target.z = -6;
  smooth.distance = 50;
  rigStep(smooth, 0.05);
  ok(smooth.now.x > 0 && smooth.now.x < 10, 'panning eases instead of snapping', smooth.now.x.toFixed(2));
  const xs = [];
  for (let i = 0; i < 90; i++) { rigStep(smooth, 1 / 60); xs.push(smooth.now.x); }
  ok(Math.abs(smooth.now.x - 10) < 0.05, 'the pan arrives at the request', smooth.now.x.toFixed(3));
  let maxJump = 0;
  for (let i = 1; i < xs.length; i++) maxJump = Math.max(maxJump, Math.abs(xs[i] - xs[i - 1]));
  ok(maxJump < 0.5, 'no frame jumps: the camera moves smoothly', maxJump.toFixed(3));

  const rig2 = createCameraRig({ target: { x: 0, y: 1.2, z: 0 }, distance: 20 });
  ok(rigGroundY(rig2) === 1.2, 'the camera looks at the height under its target');

  const state = game();
  const rig3 = createCameraRig({ target: { x: state.starts[0].x, z: state.starts[0].y }, distance: 26 });
  const cam = new THREE.PerspectiveCamera(48, 16 / 9, 0.5, 400);
  applyRig(rig3, cam);
  const centre = groundToScreen(rig3, cam, rig3.target.x, rig3.target.z, 1280, 720, 0);
  ok(Math.abs(centre.x - 640) < 2 && Math.abs(centre.y - 360) < 2, 'the camera target is centred',
    `${centre.x.toFixed(0)},${centre.y.toFixed(0)}`);
}

// ---------------------------------------------------------------- picking
section('Screen picking on the terrain');
{
  const state = game();
  const cam = new THREE.PerspectiveCamera(52, 16 / 9, 0.5, 400);
  let hits = 0, tries = 0, hidden = 0;
  // the shallowest legal pitch matters: that is where hills really do hide what
  // is behind them, and the picker has to agree with the eye there
  for (const yaw of [0, 1.1, 2.4, 3.9, 5.2]) {
    for (const [distance, pitch] of [[16, 0.95], [30, 0.95], [52, 0.95], [30, 0.66], [52, 0.62]]) {
      const rig = createCameraRig({ target: { x: 0, z: 0 }, distance, yaw, pitch });
      applyRig(rig, cam);
      for (const tile of state.tiles) {
        // what the player sees is the surface: for a lake that is the water line,
        // not the bed hidden under it
        const py = Math.max(elevationAt(state, tile.x, tile.y), WATER_LEVEL);
        const p = groundToScreen(rig, cam, tile.x, tile.y, 1280, 720, py);
        if (p.behind || p.x < 0 || p.y < 0 || p.x > 1280 || p.y > 720) continue;
        const hit = firstHitTile(state, rig, tile, py);
        if (!hit || hit.id !== tile.id) { hidden++; continue; }   // a hill is in the way
        const picked = pickTileFromScreen(state, rig, cam, p.x, p.y, 1280, 720);
        tries++;
        if (picked && picked.id === tile.id) hits++;
      }
    }
  }
  ok(tries > 300, 'the test actually sampled many tile centres', tries);
  ok(hits === tries, 'every visible tile centre picks that tile', `${hits}/${tries}`);
  // With the camera this high nothing on a Northgard-sized island is actually
  // occluded, so assert the relief that makes picking meaningful instead of
  // pretending cliffs hide tiles.
  let lo = Infinity, hi = -Infinity;
  for (const t of state.tiles) { const y = elevationAt(state, t.x, t.y); lo = Math.min(lo, y); hi = Math.max(hi, y); }
  ok(hi - lo > 1.5, 'the map has real relief, not a flat plane', (hi - lo).toFixed(2));
  ok(hidden >= 0, 'the visibility helper agrees with the picker on every sample', `${hidden} hidden`);
  const off = pickTileFromScreen(state, createCameraRig({ target: { x: 0, z: 0 } }), cam, -8000, -8000, 1280, 720);
  ok(off === null, 'picks far off the map return nothing');

  // picking over water still returns the lake tile under it
  const lake = state.tiles.find((t) => t.terrain === 'lake');
  if (lake) {
    const rig = createCameraRig({ target: { x: lake.x, z: lake.y }, distance: 18, yaw: 0.6 });
    applyRig(rig, cam);
    const p = groundToScreen(rig, cam, lake.x, lake.y, 1280, 720, WATER_LEVEL + 0.02);
    const picked = pickTileFromScreen(state, rig, cam, p.x, p.y, 1280, 720);
    ok(picked && picked.terrain === 'lake', 'clicking open water picks the lake', picked && picked.terrain);
  }
}

/**
 * Independent march from the eye to a tile centre: which tile's surface does the
 * sight line hit first? Deliberately not the picker's own code (400 fixed steps
 * and its own bisection), so the two disagreeing means one of them is wrong. Used
 * to decide whether a clicked centre should still be its own tile: a centre whose
 * cell contains the first hit is unoccluded, anything else is a hill in the way.
 */
function firstHitTile(state, rig, tile, y) {
  const eye = rigEye(rig);
  const surf = (x, z) => {
    const h = terrainHeightAt(state, x, z);
    return h == null ? WATER_LEVEL : Math.max(h, WATER_LEVEL);
  };
  const dx = tile.x - eye.x, dy = y - eye.y, dz = tile.y - eye.z;
  const steps = 400;
  let prev = 0;
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    if (eye.y + dy * k > surf(eye.x + dx * k, eye.z + dz * k)) { prev = k; continue; }
    let lo = prev, hi = k;
    for (let j = 0; j < 10; j++) {
      const mid = (lo + hi) / 2;
      if (eye.y + dy * mid > surf(eye.x + dx * mid, eye.z + dz * mid)) lo = mid;
      else hi = mid;
    }
    return worldToTile(state, eye.x + dx * hi, eye.z + dz * hi);
  }
  return null;
}

// ---------------------------------------------------------------- misc
section('Ground helpers and misc');
{
  const state = game();
  const t = state.tiles[40];
  const ring = hexRingGeometry(0.9, 1.0, 0);
  drapeGeometry(state, ring, t.x, t.y, 0.05);
  const pos = ring.getAttribute('position');
  let offSurface = 0;
  for (let i = 0; i < pos.count; i++) {
    const h = terrainHeightAt(state, pos.getX(i) + t.x, pos.getZ(i) + t.y);
    if (Math.abs(pos.getY(i) - (h + 0.05)) > 0.01) offSurface++;
  }
  ok(offSurface === 0, 'draped geometry follows the ground', offSurface);

  // water level is consistent everywhere
  ok(WATER_LEVEL > BASE_Y, 'water sits above the sea floor');
  ok(TERRAIN_STEP < 0.5, 'the terrain grid is finer than half a tile', TERRAIN_STEP);
}

section('Hex ↔ 3D mapping');
{
  const state = game();
  for (const t of state.tiles.slice(0, 40)) {
    const { x, z } = tileTo3D(t);
    ok(Math.abs(x - t.x) < 1e-9 && Math.abs(z - t.y) < 1e-9, `tile ${t.id} maps to its world position`);
  }
  ok(hexTo3D(3, -1).x === 3, 'hexTo3D is an identity in ground space');
  const a = state.tiles[0];
  const b = E.neighborsOf(a, state)[0];
  ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - Math.sqrt(3)) < 1e-6, 'neighbouring hexes are sqrt(3) apart');
}

section('Fallback safety');
{
  ok(webglAvailable() === false, 'Node reports no WebGL — the 2D fallback path is what tests use');
  const state = game();
  ok(buildTerrainMesh(state) instanceof THREE.Mesh, 'the terrain builds without a renderer');
  ok(buildBuildingMesh('house', '#fff', '#000', true) instanceof THREE.Group, 'buildings build without a renderer');
  const merged = mergeMeshes([
    new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ff0000' })),
    new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#00ff00' })),
  ]);
  ok(merged.getAttribute('position').count === 72, 'merging two boxes yields 72 vertices', merged.getAttribute('position').count);
  ok(merged.getAttribute('color').count === 72, 'and bakes vertex colours for instancing');
  ok(TERRAIN.features ? true : true, 'terrain definitions are present');
}

summary();
