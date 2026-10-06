// ============================================================================
// Northhold — 3D renderer tests.   node tests/render3d.test.js
// Runs in Node: geometry building and camera maths need no WebGL context.
// ============================================================================
import * as THREE from '../vendor/three.module.min.js';
import * as E from '../src/engine.js';
import { BUILDINGS, TERRAIN } from '../src/data.js';
import {
  buildTileMesh, buildDecorations, buildBuildingMesh, buildUnitMesh,
  hexPrismGeometry, hexRingGeometry,
} from '../src/models3d.js';
import {
  createCameraRig, applyRig, rigEye, screenToGround, groundToScreen,
  pickTileFromScreen, webglAvailable, tileTo3D, hexTo3D,
} from '../src/render3d.js';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
function section(t) { console.log(`\n${t}`); }
const countMeshes = (obj) => {
  let n = 0;
  obj.traverse((o) => { if (o.isMesh) n++; });
  return n;
};
const countTris = (geo) => geo.attributes.position.count / 3;

// ---------------------------------------------------------------- geometry
section('Procedural geometry');
{
  const prism = hexPrismGeometry(1, 0.2, 1);
  ok(countTris(prism) === 24, 'hex prism has 6 side + 2 cap fans (24 triangles)', countTris(prism));
  ok(prism.attributes.position.count === 72, 'prism vertex count matches', prism.attributes.position.count);
  ok(!!prism.attributes.normal, 'prism normals are computed (lighting works)');
  const tapered = hexPrismGeometry(1, 0.85, 0.55);
  const pos = tapered.attributes.position;
  let maxX = 0, maxZ = 0, topMax = 0;
  for (let i = 0; i < pos.count; i++) {
    maxX = Math.max(maxX, Math.abs(pos.getX(i)));
    maxZ = Math.max(maxZ, Math.abs(pos.getZ(i)));
    if (Math.abs(pos.getY(i) - 0.85) < 1e-6) topMax = Math.max(topMax, Math.hypot(pos.getX(i), pos.getZ(i)));
  }
  // pointy-top hexes: corners sit at 30° and 90°, so |x| ≤ √3/2 and |z| ≤ 1
  ok(Math.abs(maxX - Math.sqrt(3) / 2) < 1e-6, 'hex corner geometry is correct on x', maxX);
  ok(Math.abs(maxZ - 1) < 1e-6, 'hex corner geometry is correct on z', maxZ);
  ok(Math.abs(topMax - 0.55) < 1e-6, 'tapered top scales the radius', topMax);
  const ring = hexRingGeometry(0.8, 1, 0.2);
  ok(countTris(ring) === 12, 'hex ring is 12 triangles', countTris(ring));
}

section('Tile meshes & decorations');
{
  for (const kind of Object.keys(TERRAIN)) {
    const tile = { id: 3, q: 0, r: 0, terrain: kind, wild: 2 };
    const mesh = buildTileMesh(tile);
    const meshes = countMeshes(mesh);
    ok(meshes >= 1, `tile mesh for ${kind}`, meshes);
    const top = mesh.userData.terrainTop;
    ok(top > 0, `${kind} slab has height`, top);
    const decor = buildDecorations(tile);
    const decorMeshes = countMeshes(decor);
    if (kind === 'lake') ok(true, 'lake decorations (reeds) optional');
    else ok(decorMeshes >= 1, `${kind} has decorations`, decorMeshes);
  }
  const water = buildTileMesh({ id: 1, q: 0, r: 0, terrain: 'lake' });
  ok(!!water.getObjectByName('water'), 'lakes get a water surface');
  const peak = buildTileMesh({ id: 2, q: 0, r: 0, terrain: 'mountain' });
  ok(peak.userData.terrainTop > 0.5, 'mountains stand taller than plains', peak.userData.terrainTop);
}

section('Buildings (every type)');
{
  for (const type of Object.keys(BUILDINGS)) {
    const g = buildBuildingMesh(type, '#3f9e8f', '#63c7b7', true);
    const meshes = countMeshes(g);
    if (type === 'townhall') ok(meshes >= 6, 'town hall is detailed', meshes);
    else ok(meshes >= 2, `${type} model has geometry`, meshes);
    ok(g.children.length >= 2, `${type} model has parts`, g.children.length);
  }
  const unfinished = buildBuildingMesh('house', '#e09a3a', '#f0b757', false);
  ok(!!unfinished.getObjectByName('scaffold'), 'unfinished buildings get scaffolding');
  const finished = buildBuildingMesh('house', '#e09a3a', '#f0b757', true);
  ok(!finished.getObjectByName('scaffold'), 'finished buildings have no scaffolding');
}

section('Units (every type)');
{
  for (const type of ['warrior', 'axe', 'shield', 'scout', 'warchief']) {
    const g = buildUnitMesh(type, '#3f9e8f', '#63c7b7');
    const meshes = countMeshes(g);
    ok(meshes >= 8, `${type} is an assembled body`, meshes);
    const parts = g.userData.parts;
    ok(!!parts.body && !!parts.head && !!parts.armL && !!parts.armR && !!parts.weapon,
      `${type} exposes animatable parts`);
    ok(!!g.getObjectByName('selectRing'), `${type} has a selection ring`);
    let clanColored = false;
    g.traverse((o) => {
      if (o.isMesh && o.material && o.material.color && o.material.color.getHexString() === '3f9e8f') clanColored = true;
    });
    ok(clanColored, `${type} wears the clan colour`);
  }
  const hero = buildUnitMesh('warchief', '#fff', '#000');
  const warrior = buildUnitMesh('warrior', '#fff', '#000');
  ok(countMeshes(hero) > countMeshes(warrior), 'the warchief is fancier than a warrior',
    `${countMeshes(hero)} vs ${countMeshes(warrior)}`);
}

// ---------------------------------------------------------------- camera
section('Camera rig');
{
  const rig = createCameraRig({ target: { x: 4, z: -3 }, distance: 30, yaw: 0.7, pitch: 0.9 });
  const eye = rigEye(rig);
  ok(eye.y > 0, 'the eye is above the ground', eye.y);
  ok(Math.hypot(eye.x - 4, eye.z + 3) < 30, 'the eye is within the orbit radius');
  const cam = new THREE.PerspectiveCamera(48, 16 / 9, 0.5, 400);
  applyRig(rig, cam);
  ok(Math.abs(cam.position.y - eye.y) < 1e-9, 'applyRig places the camera');
  // the target should project to the centre of the screen
  const centre = groundToScreen(rig, cam, 4, -3, 1280, 720);
  ok(Math.abs(centre.x - 640) < 0.5 && Math.abs(centre.y - 360) < 0.5, 'the camera target is centred',
    `${centre.x.toFixed(1)}, ${centre.y.toFixed(1)}`);
  // zooming out must keep the target centred
  rig.distance = 55;
  const centre2 = groundToScreen(rig, cam, 4, -3, 1280, 720);
  ok(Math.abs(centre2.x - 640) < 0.5 && Math.abs(centre2.y - 360) < 0.5, 'still centred when zoomed out');
}

section('Screen ↔ ground round trip');
{
  const cam = new THREE.PerspectiveCamera(48, 16 / 9, 0.5, 400);
  let worst = 0;
  for (const yaw of [0, 0.8, 2.1, 4.4, 5.9]) {
    for (const pitch of [0.6, 0.92, 1.3]) {
      const rig = createCameraRig({ target: { x: 0, z: 0 }, distance: 28, yaw, pitch });
      for (const [x, z] of [[0, 0], [3, -2], [-6, 5], [8, 8], [12, -7]]) {
        const s = groundToScreen(rig, cam, x, z, 1280, 720);
        if (s.behind) continue;
        const back = screenToGround(rig, cam, s.x, s.y, 1280, 720);
        const err = Math.hypot(back.x - x, back.z - z);
        worst = Math.max(worst, err);
      }
    }
  }
  ok(worst < 1e-6, 'projecting then unprojecting returns the same ground point', worst.toExponential(2));

  const rig2 = createCameraRig({ pitch: 1.4, distance: 10 });
  const cam2 = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
  applyRig(rig2, cam2);
  ok(screenToGround(rig2, cam2, 0, -4000, 640, 480) === null, 'rays that miss the ground return null');
}

section('Tile picking (the mouse)');
{
  const state = E.createGame({ clanId: 'wolf', difficulty: 'normal', mapSeed: 11 });
  const cam = new THREE.PerspectiveCamera(48, 16 / 9, 0.5, 400);
  let hits = 0, tries = 0;
  for (const yaw of [0, 1.1, 2.4, 3.9, 5.2]) {
    for (const distance of [18, 34, 60]) {
      const rig = createCameraRig({ target: { x: 0, z: 0 }, distance, yaw, pitch: 0.95 });
      applyRig(rig, cam);
      for (const tile of state.tiles) {
        const p = groundToScreen(rig, cam, tile.x, tile.y, 1280, 720, 0.1);
        if (p.behind || p.x < 0 || p.y < 0 || p.x > 1280 || p.y > 720) continue;
        const picked = pickTileFromScreen(state, rig, cam, p.x, p.y, 1280, 720);
        tries++;
        if (picked && picked.id === tile.id) hits++;
      }
    }
  }
  ok(tries > 300, 'the test actually sampled many tiles', tries);
  ok(hits === tries, 'every visible tile centre picks that tile', `${hits}/${tries}`);
  const off = pickTileFromScreen(state, rig0(state), cam0(), -5000, -5000, 1280, 720);
  ok(off === null || state.tileById.has(off.id), 'picks outside the map never return phantom tiles');
}

function rig0(state) {
  return createCameraRig({ target: { x: state.starts[0].x, z: state.starts[0].y }, distance: 26, yaw: 0.8, pitch: 0.9 });
}
function cam0() {
  return new THREE.PerspectiveCamera(48, 16 / 9, 0.5, 400);
}

section('Hex ↔ 3D mapping');
{
  const state = E.createGame({ clanId: 'wolf', difficulty: 'normal', mapSeed: 3 });
  let mismatches = 0;
  for (const tile of state.tiles) {
    const p = tileTo3D(tile);
    if (Math.abs(p.x - tile.x) > 1e-9 || Math.abs(p.z - tile.y) > 1e-9) mismatches++;
  }
  ok(mismatches === 0, 'every tile maps onto the same coordinates the engine uses', mismatches);
  const direct = hexTo3D(2.5, -1.25);
  ok(direct.x === 2.5 && direct.z === -1.25, 'hexTo3D is an identity in ground space');
  // neighbouring tiles are exactly one hex apart on the ground plane
  const n = E.neighborsOf(state.tiles[20], state)[0];
  const d = Math.hypot(n.x - state.tiles[20].x, n.y - state.tiles[20].y);
  ok(Math.abs(d - Math.sqrt(3)) < 1e-9, 'neighbouring hexes are sqrt(3) apart (constant tile size)', d);
}

section('Fallback safety');
{
  ok(webglAvailable() === false, 'Node reports no WebGL — the 2D fallback path is what tests use');
  // building a model must never need a GL context
  const g = buildBuildingMesh('altar', '#fff', '#000', true);
  ok(countMeshes(g) >= 5, 'models build without a renderer', countMeshes(g));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
