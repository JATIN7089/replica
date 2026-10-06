// ============================================================================
// Northhold — 3D world renderer (three.js r169, vendored).
// Draws the hex map, terrain, decorations, buildings, units and effects in
// three dimensions with an RTS camera rig. This module only reads game state.
// ============================================================================
import * as THREE from '../vendor/three.module.min.js';
import { BUILDINGS, SEASONS } from './data.js';
import { hexToWorld, tileById, seasonIndexOf, winterAmount } from './engine.js';
import { buildBuildingMesh } from './buildings3d.js';
import {
  buildUnitMesh, buildVillagerMesh, buildDeerMesh,
  hexRingGeometry, HEX_RADIUS, TILE_HEIGHT,
  buildTreeVariants, buildRockVariants, buildOreVariant, buildRuinVariants, buildPlotVariant,
} from './models3d.js';
import {
  WATER_LEVEL, BASE_Y, terrainHeightAt, elevationAt, elevationOf, worldToTile, tileElevation,
  buildTerrainMesh, buildWaterMesh, buildTerritoryMesh, buildSeaFloorMesh,
  terrainSignature, ownershipSignature, drapeGeometry, TERRAIN_STEP,
} from './terrain3d.js';
import { buildScatter, scatterSignature } from './scatter3d.js';

// vertical band the terrain occupies: used to bound the picking march
const TERRAIN_TOP = 2.2;
const TERRAIN_BOTTOM = BASE_Y;

// ---------------------------------------------------------------- hex → 3D
export function hexTo3D(x, z) {
  // game space is 2D: tile.x / tile.y (see engine.hexToWorld) → ground plane
  return { x, z };
}
export function tileTo3D(tile) {
  const w = hexToWorld(tile.q, tile.r, 1);
  return { x: w.x, z: w.y };
}

// ---------------------------------------------------------------- camera rig
/**
 * Northgard-style elevated RTS camera: a 3/4 perspective view that looks down at
 * roughly 50° over the ground, orbits freely and can be tilted between ~35° and
 * ~75°. Pan/zoom/orbit/tilt are eased so the camera glides instead of snapping
 * (set `smooth: 0` to make it instantaneous — the pure maths tests do that).
 */
export function createCameraRig(overrides = {}) {
  const rig = {
    target: { x: 0, y: 0, z: 0 },
    distance: 26,
    yaw: Math.PI * 0.25,
    pitch: 0.95,          // ~54° above the ground: classic RTS 3/4 view
    minDistance: 7,
    maxDistance: 72,
    minPitch: 0.62,       // never flat
    maxPitch: 1.30,       // never a flat top-down board
    fieldOfView: 52,
    smooth: 0,            // >0 eases towards the requested pose
    ...overrides,
  };
  // `now` is the pose actually rendered; the fields above are the requested one
  rig.now = { x: rig.target.x, y: rig.target.y, z: rig.target.z, distance: rig.distance, yaw: rig.yaw, pitch: rig.pitch };
  return rig;
}

/** The app camera: eased movement, tuned for a smooth RTS feel. */
export const CAM = createCameraRig({ distance: 26, smooth: 7.5 });

/** Advance the eased pose towards the requested pose. Returns the rendered pose. */
export function rigStep(rig, dt) {
  const want = rig;
  const now = rig.now;
  if (!now) return want;
  if (!rig.smooth) {
    now.x = want.target.x; now.y = want.target.y; now.z = want.target.z;
    now.distance = want.distance; now.yaw = want.yaw; now.pitch = want.pitch;
    return now;
  }
  const step = Math.max(0, Math.min(dt, 0.25));
  const k = 1 - Math.exp(-rig.smooth * step);
  // A pan never starts at full speed: the ramp eases the first quarter second in,
  // and the cap keeps a long pan from lurching (a jumpy camera feels broken even
  // when the world looks right).
  const moving = Math.abs(want.target.x - now.x) + Math.abs(want.target.z - now.z) > 1e-4;
  rig.ramp = moving ? Math.min(1, (rig.ramp || 0) + step / 0.25) : 0;
  const cap = (7 + rig.distance * 0.38) * rig.ramp * step;
  const ease = (from, to) => from + Math.max(-cap, Math.min(cap, (to - from) * k));
  now.x = ease(now.x, want.target.x);
  now.z = ease(now.z, want.target.z);
  now.y += (want.target.y - now.y) * k;
  now.distance += (want.distance - now.distance) * k;
  // shortest way around the circle
  let dyaw = want.yaw - now.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  now.yaw += dyaw * (k * 1.25);
  now.pitch += (want.pitch - now.pitch) * k;
  return now;
}

/** Ground height the camera is currently looking at. */
export function rigGroundY(rig) {
  if (rig.smooth && rig.now) return rig.now.y;
  return rig.target.y || 0;
}

export function rigEye(rig) {
  const src = rig.smooth && rig.now ? rig.now : rig;
  const pos = src === rig ? rig.target : rig.now;
  const cosP = Math.cos(src.pitch);
  return {
    x: pos.x + Math.sin(src.yaw) * cosP * src.distance,
    y: Math.sin(src.pitch) * src.distance,
    z: pos.z + Math.cos(src.yaw) * cosP * src.distance,
  };
}

export function applyRig(rig, camera) {
  const eye = rigEye(rig);
  const y = rigGroundY(rig);
  const src = rig.smooth && rig.now ? rig.now : null;
  const tx = src ? src.x : rig.target.x;
  const tz = src ? src.z : rig.target.z;
  camera.position.set(eye.x, eye.y, eye.z);
  camera.lookAt(tx, y, tz);
  camera.updateMatrixWorld();
}

const _raycaster = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit = new THREE.Vector3();

/**
 * Screen css pixels → point on a horizontal ground plane. The plane sits at the
 * height the camera is looking at by default, which is close enough for the
 * picking refinement pass to converge in a step or two.
 */
export function screenToGround(rig, camera, sx, sy, width, height, planeY = null) {
  applyRig(rig, camera);
  const y = planeY == null ? rigGroundY(rig) : planeY;
  _plane.constant = -y;
  _raycaster.setFromCamera(new THREE.Vector2((sx / width) * 2 - 1, -(sy / height) * 2 + 1), camera);
  if (!_raycaster.ray.intersectPlane(_plane, _hit)) return null;
  return { x: _hit.x, y, z: _hit.z };
}

/** Ground point → screen css pixels. */
export function groundToScreen(rig, camera, x, z, width, height, elevation = 0) {
  applyRig(rig, camera);
  const v = new THREE.Vector3(x, elevation, z).project(camera);
  return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height, behind: v.z > 1 };
}

// ---------------------------------------------------------------- text
const textCache = new Map();
function textCanvas(text, color, size) {
  const key = `${text}|${color}|${size}`;
  let canvas = textCache.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    ctx.font = `bold ${size}px system-ui, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(text, 80, 40);
    ctx.fillStyle = color;
    ctx.fillText(text, 80, 40);
    textCache.set(key, canvas);
    if (textCache.size > 240) textCache.delete(textCache.keys().next().value);
  }
  return canvas;
}

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.isMesh || o.isSprite || o.isLine) {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.map && m.map.isCanvasTexture) m.map.dispose();
        m.dispose();
      }
    }
  });
}

/** Is WebGL usable here? (jsdom and locked-down browsers say no.) */
export function webglAvailable(canvas = null) {
  try {
    if (canvas) return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Screen point → hex tile. Pure maths: usable in tests without WebGL. */
function tileAtGroundPoint(state, x, z) {
  const r = Math.round(z / 1.5);
  const q = Math.round(x / Math.sqrt(3) - r / 2);
  let best = null;
  let bestD = Infinity;
  for (let dq = -1; dq <= 1; dq++) {
    for (let dr = -1; dr <= 1; dr++) {
      const t = state.tileByKey.get(`${q + dq},${r + dr}`);
      if (!t) continue;
      const d = (t.x - x) ** 2 + (t.y - z) ** 2;
      if (d < bestD) { best = t; bestD = d; }
    }
  }
  return best;
}

/**
 * Screen point → hex tile, on the continuous terrain surface. The ray is marched
 * down through the world and bisected where it first crosses the ground (or the
 * water surface over a lake), so a click on a mountain flank picks the mountain.
 */
export function pickTileFromScreen(state, rig, camera, sx, sy, width, height) {
  applyRig(rig, camera);
  _raycaster.setFromCamera(new THREE.Vector2((sx / width) * 2 - 1, -(sy / height) * 2 + 1), camera);
  const { origin, direction } = _raycaster.ray;
  if (direction.y >= -1e-4) {
    const hit = screenToGround(rig, camera, sx, sy, width, height);
    return hit ? tileAtGroundPoint(state, hit.x, hit.z) : null;
  }
  const tTop = Math.max(0, (origin.y - (TERRAIN_TOP + 0.4)) / -direction.y);
  const tBottom = Math.max(tTop, (origin.y - TERRAIN_BOTTOM) / -direction.y);
  const steps = Math.min(220, Math.max(10, Math.ceil((tBottom - tTop) / (TERRAIN_STEP * 0.9))));
  let prev = tTop;
  const surface = (x, z) => {
    const h = terrainHeightAt(state, x, z);
    if (h == null) return WATER_LEVEL;                 // open sea
    return Math.max(h, h < WATER_LEVEL ? WATER_LEVEL : h);
  };
  for (let i = 1; i <= steps; i++) {
    const t = tTop + ((tBottom - tTop) * i) / steps;
    const x = origin.x + direction.x * t;
    const y = origin.y + direction.y * t;
    const z = origin.z + direction.z * t;
    if (y > surface(x, z)) { prev = t; continue; }
    let lo = prev;
    let hi = t;
    for (let k = 0; k < 6; k++) {
      const mid = (lo + hi) / 2;
      const mx = origin.x + direction.x * mid;
      const my = origin.y + direction.y * mid;
      const mz = origin.z + direction.z * mid;
      if (my <= surface(mx, mz)) hi = mid;
      else lo = mid;
    }
    const hx = origin.x + direction.x * hi;
    const hz = origin.z + direction.z * hi;
    return worldToTile(state, hx, hz);
  }
  return null;
}

// ---------------------------------------------------------------- renderer
/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ rendererFactory?: (canvas: HTMLCanvasElement) => any }} [opts]
 *   rendererFactory lets tests swap in a fake GL backend so the whole 3D
 *   pipeline (scene building, syncing, effects) can be exercised without a GPU.
 */
export function createRenderer3D(canvas, opts = {}) {
  const renderer = opts.rendererFactory
    ? opts.rendererFactory(canvas)
    : new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  if (renderer.setPixelRatio) {
    renderer.setPixelRatio(Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
  }
  if (renderer.shadowMap) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM.fieldOfView, 1, 0.5, 400);
  const rig = createCameraRig({ smooth: 7.5 });

  // --- sky dome, painted with a canvas gradient (original art)
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 8;
  skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d');
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(200, 20, 14),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  sky.name = 'sky';
  scene.add(sky);
  scene.fog = new THREE.Fog('#93b0c4', 42, 150);

  function paintSky(seasonKey, winter) {
    const g = skyCtx.createLinearGradient(0, 0, 0, 256);
    const bands = {
      winter: ['#1b2a42', '#4a6486', '#c9d9ea'],
      summer: ['#123a63', '#5fa4cf', '#d8ecf3'],
      autumn: ['#22314c', '#8b7d68', '#e3cba4'],
      spring: ['#17364f', '#6f9fb9', '#dcecef'],
    }[seasonKey] || ['#17364f', '#6f9fb9', '#dcecef'];
    g.addColorStop(0, bands[0]);
    g.addColorStop(winter > 0.35 ? 0.45 : 0.62, bands[1]);
    g.addColorStop(1, bands[2]);
    skyCtx.fillStyle = g;
    skyCtx.fillRect(0, 0, 8, 256);
    skyTex.needsUpdate = true;
  }

  // --- lights
  const hemi = new THREE.HemisphereLight('#e2eef8', '#39412f', 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4de', 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 140;
  const SPAN = 17;   // shadow coverage while the camera pans
  sun.shadow.camera.left = -SPAN;
  sun.shadow.camera.right = SPAN;
  sun.shadow.camera.top = SPAN;
  sun.shadow.camera.bottom = -SPAN;
  sun.shadow.bias = -0.0011;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  scene.add(new THREE.AmbientLight('#ffffff', 0.22));

  // --- world layers
  const layers = {
    terrain: new THREE.Group(),
    water: new THREE.Group(),
    scatter: new THREE.Group(),
    territory: new THREE.Group(),
    buildings: new THREE.Group(),
    units: new THREE.Group(),
    workers: new THREE.Group(),
    fx: new THREE.Group(),
  };
  scene.add(layers.terrain, layers.water, layers.scatter, layers.territory,
    layers.buildings, layers.units, layers.workers, layers.fx);

  const maps = {
    buildings: new Map(),    // buildingId → { group, type, clan, built, flash }
    units: new Map(),        // unitId → { group, parts, hpBar, prev }
    workers: new Map(),      // buildingId → { group, party: [{ group, parts, seed }], nodeId }
    highlights: new Map(),   // tileId → ring
    captures: new Map(),     // tileId → ring (transient capture cue)
    markers: new Map(),      // unitId → { line, dot }
    floaters: new Map(),     // floater → sprite
  };
  const projectiles = [];
  let hoverRing = null;
  let state = null;
  let time = 0;
  let built = false;
  let lastSeasonKey = '';
  let terrainMesh = null;
  let waterMesh = null;
  let seaFloorMesh = null;
  let territoryMesh = null;
  let signature = '';
  let ownSignature = '';
  let swayTimer = 0;
  const swayers = [];        // { mesh, items, base:Float32Array } for wind animation

  const ringGeo = hexRingGeometry(HEX_RADIUS * 0.9, HEX_RADIUS * 1.0, 0);
  const unitRingGeo = hexRingGeometry(0.26, 0.34, 0.006);

  // ---------------------------------------------------------------- scatter
  function addInstanced(list, variants, materialOpts, layer) {
    if (!list.length) return null;
    const byKind = new Map();
    for (const item of list) {
      if (!byKind.has(item.kind)) byKind.set(item.kind, []);
      byKind.get(item.kind).push(item);
    }
    const meshes = [];
    for (const [kind, items] of byKind) {
      const variant = variants[kind];
      if (!variant) continue;
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0, ...materialOpts,
      });
      const mesh = new THREE.InstancedMesh(variant.geometry, mat, items.length);
      mesh.castShadow = variant.sway > 0;
      mesh.receiveShadow = true;
      const base = new Float32Array(items.length * 16);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        dummy.position.set(it.x, elevationAt(state, it.x, it.z) + (it.yOffset || 0), it.z);
        dummy.rotation.set(0, it.rot, 0);
        dummy.scale.setScalar(it.scale);
        dummy.updateMatrix();
        dummy.matrix.toArray(base, i * 16);
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.kind = kind;
      layer.add(mesh);
      meshes.push(mesh);
      if (variant.sway > 0) swayers.push({ mesh, items, base, sway: variant.sway, height: variant.height });
    }
    return meshes;
  }

  function buildScatterMeshes(s) {
    disposeGroup(layers.scatter);
    layers.scatter.clear();
    swayers.length = 0;
    const data = buildScatter(s);
    const treeVariants = Object.fromEntries(buildTreeVariants().map((v) => [v.id, v]));
    const rockVariants = Object.fromEntries([...buildRockVariants(), buildOreVariant()].map((v) => [v.id, v]));
    const ruinVariants = Object.fromEntries(buildRuinVariants().map((v) => [v.id, v]));
    const propVariants = { farm: buildPlotVariant('farm'), logs: buildPlotVariant('logs') };

    addInstanced(data.trees, treeVariants, {}, layers.scatter);
    addInstanced(data.rocks, rockVariants, { roughness: 1 }, layers.scatter);
    addInstanced(data.ore, { ore: rockVariants.ore }, { roughness: 0.7, metalness: 0.3 }, layers.scatter);
    addInstanced(data.ruins, ruinVariants, {}, layers.scatter);
    addInstanced(data.props, propVariants, {}, layers.scatter);

    // a handful of animals: plain meshes, they are few and they move
    for (const a of data.animals) {
      const deer = buildDeerMesh(a.rot);
      deer.position.set(a.x, elevationAt(s, a.x, a.z), a.z);
      deer.castShadow = true;
      layers.scatter.add(deer);
    }
    return data;
  }

  /** Wind: lean the trees a little, slowly, with a per-tree phase. */
  function swayTrees(dt) {
    if (!swayers.length) return;
    swayTimer -= dt;
    if (swayTimer > 0) return;
    swayTimer = 1 / 24;
    const dummy = new THREE.Object3D();
    for (const s2 of swayers) {
      for (let i = 0; i < s2.items.length; i++) {
        const it = s2.items[i];
        const phase = time * 0.9 + it.x * 0.7 + it.z * 0.5;
        const amount = Math.sin(phase) * 0.045 + Math.sin(phase * 2.3) * 0.02;
        dummy.position.set(it.x, elevationAt(state, it.x, it.z) + (it.yOffset || 0), it.z);
        dummy.rotation.set(amount * 0.6, it.rot, amount);
        dummy.scale.setScalar(it.scale);
        dummy.updateMatrix();
        s2.mesh.setMatrixAt(i, dummy.matrix);
      }
      s2.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function size() {
    const w = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 960;
    const h = canvas.clientHeight || (canvas.parentElement && canvas.parentElement.clientHeight) || 600;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    canvas._w = w;
    canvas._h = h;
    return { w, h };
  }
  size();

  // ---------------------------------------------------------------- build
  function buildWorld(s) {
    for (const layer of [layers.terrain, layers.water, layers.territory]) {
      disposeGroup(layer);
      layer.clear();
    }
    terrainMesh = buildTerrainMesh(s);
    layers.terrain.add(terrainMesh);
    seaFloorMesh = buildSeaFloorMesh(s);
    layers.terrain.add(seaFloorMesh);
    waterMesh = buildWaterMesh(s);
    layers.water.add(waterMesh);
    buildScatterMeshes(s);
    territoryMesh = null;
    built = true;
    lastSeasonKey = '';
    signature = `${terrainSignature(s)}|${scatterSignature(s)}`;
    ownSignature = null;   // force the first territory sync: the home land is owned
  }

  function syncTerritory(s) {
    const sig = ownershipSignature(s);
    if (sig !== ownSignature) {
      ownSignature = sig;
      if (territoryMesh) {
        layers.territory.remove(territoryMesh);
        disposeGroup(territoryMesh);
        territoryMesh = null;
      }
      territoryMesh = buildTerritoryMesh(s);
      if (territoryMesh) layers.territory.add(territoryMesh);
    }
    // transient cue: a tile being captured glows under the warband
    const wanted = new Set();
    for (const tile of s.tiles) {
      if (!(tile.captureProgress > 0)) continue;
      wanted.add(tile.id);
      let ring = maps.captures.get(tile.id);
      if (!ring) {
        ring = new THREE.Mesh(ringGeo.clone(), new THREE.MeshBasicMaterial({
          color: '#ffd27a', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
        }));
        ring.position.set(tile.x, 0, tile.y);
        drapeGeometry(s, ring.geometry, tile.x, tile.y, 0.05);
        maps.captures.set(tile.id, ring);
        layers.fx.add(ring);
      }
      ring.material.opacity = 0.35 + tile.captureProgress * 0.45;
    }
    for (const [id, ring] of maps.captures) {
      if (wanted.has(id)) continue;
      layers.fx.remove(ring);
      ring.geometry.dispose();
      ring.material.dispose();
      maps.captures.delete(id);
    }
  }

  function syncBuildings(s) {
    const seen = new Set();
    for (const tile of s.tiles) {
      const { x, z } = tileTo3D(tile);
      for (const b of tile.buildings) {
        seen.add(b.id);
        let entry = maps.buildings.get(b.id);
        if (!entry || entry.type !== b.type || entry.clan !== b.clan) {
          if (entry) { layers.buildings.remove(entry.group); disposeGroup(entry.group); }
          const clan = s.clans[b.clan];
          const group = buildBuildingMesh(b.type, clan.color, clan.banner, b.done);
          group.userData.buildingId = b.id;
          group.position.set(x, tileElevation(tile), z);
          group.rotation.y = ((b.id * 37) % 9) * 0.13 - 0.55;
          layers.buildings.add(group);
          entry = { group, type: b.type, clan: b.clan, built: b.done ? 1 : 0, flash: 0 };
          maps.buildings.set(b.id, entry);
        }
        // grow while under construction
        const def = BUILDINGS[b.type];
        const target = b.done ? 1 : 1 - Math.max(0, b.build) / Math.max(0.001, def.build || 1);
        entry.built += (target - entry.built) * 0.15;
        entry.group.scale.setScalar(b.done ? 1 : 0.45 + entry.built * 0.6);
        const scaffold = entry.group.getObjectByName('scaffold');
        if (scaffold) scaffold.visible = !b.done;
        // damage flash
        if ((b.flash > 0) !== (entry.flash > 0)) {
          entry.flash = b.flash > 0 ? 1 : 0;
          entry.group.traverse((o) => {
            if (o.isMesh && o.material && o.material.emissive) {
              o.material = o.material.clone();
              o.material.emissive = new THREE.Color(entry.flash ? '#ff5f2e' : '#000000');
              o.material.emissiveIntensity = entry.flash ? 0.85 : 1;
            }
          });
        }
      }
    }
    for (const [id, entry] of maps.buildings) {
      if (seen.has(id)) continue;
      layers.buildings.remove(entry.group);
      disposeGroup(entry.group);
      maps.buildings.delete(id);
    }
  }

  function makeHpBar() {
    const group = new THREE.Group();
    group.position.y = 1.02;
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.46, 0.075),
      new THREE.MeshBasicMaterial({ color: '#12100e', transparent: true, opacity: 0.8, depthWrite: false }),
    );
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.05),
      new THREE.MeshBasicMaterial({ color: '#7fd07a', transparent: true, depthWrite: false }),
    );
    fill.position.z = 0.004;
    group.add(bg, fill);
    group.renderOrder = 5;
    return { group, fill };
  }

  function syncUnits(s, ui, dt) {
    const seen = new Set();
    for (const u of s.units) {
      seen.add(u.id);
      let entry = maps.units.get(u.id);
      if (!entry || entry.type !== u.type || entry.clan !== u.clan) {
        if (entry) { layers.units.remove(entry.group); disposeGroup(entry.group); }
        const clan = s.clans[u.clan];
        const group = buildUnitMesh(u.type, clan.color, clan.banner);
        group.userData.unitId = u.id;
        layers.units.add(group);
        entry = { group, type: u.type, clan: u.clan, parts: group.userData.parts, hpBar: null, prev: { x: u.x, y: u.y } };
        maps.units.set(u.id, entry);
      }
      // unit world coordinates are already in the same 2D space as tiles;
      // the ground under them is not flat any more, so ease onto the local height
      const groundY = elevationAt(s, u.x, u.y);
      entry.group.position.x = u.x;
      entry.group.position.z = u.y;
      entry.group.position.y += (groundY - entry.group.position.y) * (1 - Math.exp(-14 * (dt || 0.016)));
      const dx = u.x - entry.prev.x;
      const dy = u.y - entry.prev.y;
      entry.prev.x = u.x;
      entry.prev.y = u.y;

      const parts = entry.parts;
      if (parts) {
        const moving = Math.hypot(dx, dy) > 0.0015;
        const bob = moving ? Math.sin(time * 11 + u.id * 0.7) : Math.sin(time * 2 + u.id) * 0.2;
        parts.body.position.y = moving ? Math.abs(bob) * 0.06 : 0;
        parts.armL.rotation.x = moving ? bob * 0.6 : 0;
        parts.armR.rotation.x = moving ? -bob * 0.6 : 0;
        if (moving) {
          const heading = Math.atan2(dx, dy);
          parts.body.rotation.y += angleDelta(parts.body.rotation.y, heading) * 0.2;
        } else if (u.facing < 0) {
          parts.body.rotation.y += angleDelta(parts.body.rotation.y, Math.PI * 0.5) * 0.05;
        }
        if (u.attackAnim > 0) {
          parts.weapon.rotation.x = -1.25;
        } else {
          parts.weapon.rotation.x *= 0.75;
        }
        parts.body.rotation.z = u.attackAnim > 0 ? 0.1 : 0;
      }

      const ring = entry.group.getObjectByName('selectRing');
      if (ring) {
        ring.material.opacity = ui.selectedUnits && ui.selectedUnits.has(u.id) ? 0.95 : 0;
        ring.rotation.y = time * 0.5;
      }
      if (u.hp < u.maxHp - 0.5) {
        if (!entry.hpBar) { entry.hpBar = makeHpBar(); entry.group.add(entry.hpBar.group); }
        entry.hpBar.group.visible = true;
        const frac = Math.max(0, u.hp / u.maxHp);
        entry.hpBar.fill.scale.x = frac;
        entry.hpBar.fill.position.x = -(1 - frac) * 0.2;
        entry.hpBar.group.quaternion.copy(camera.quaternion);
      } else if (entry.hpBar) {
        entry.hpBar.group.visible = false;
      }
    }
    for (const [id, entry] of maps.units) {
      if (seen.has(id)) continue;
      layers.units.remove(entry.group);
      disposeGroup(entry.group);
      maps.units.delete(id);
    }
  }

  function angleDelta(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function syncHighlights(s, ui) {
    const wanted = ui.highlightTiles instanceof Set ? ui.highlightTiles : new Set();
    const color = ui.highlightColor || '#ffd98a';
    for (const id of wanted) {
      if (maps.highlights.has(id)) continue;
      const tile = tileById(s, id);
      if (!tile) continue;
      const geo = ringGeo.clone();
      drapeGeometry(s, geo, tile.x, tile.y, 0.06);
      const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
      }));
      ring.position.set(tile.x, 0, tile.y);
      maps.highlights.set(id, ring);
      layers.fx.add(ring);
    }
    for (const [id, ring] of maps.highlights) {
      if (wanted.has(id)) { ring.material.color.set(color); continue; }
      layers.fx.remove(ring);
      ring.geometry.dispose();
      ring.material.dispose();
      maps.highlights.delete(id);
    }
    if (ui.hoverTile) {
      if (!hoverRing) {
        hoverRing = new THREE.Mesh(ringGeo.clone(), new THREE.MeshBasicMaterial({
          color: '#ffffff', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
        }));
        layers.fx.add(hoverRing);
      }
      if (hoverRing.userData.tileId !== ui.hoverTile.id) {
        hoverRing.userData.tileId = ui.hoverTile.id;
        drapeGeometry(s, hoverRing.geometry, ui.hoverTile.x, ui.hoverTile.y, 0.07);
        hoverRing.position.set(ui.hoverTile.x, 0, ui.hoverTile.y);
      }
      hoverRing.visible = true;
    } else if (hoverRing) {
      hoverRing.visible = false;
    }
  }

  function syncMarkers(s, ui) {
    const wanted = new Map();
    for (const id of ui.selectedUnits || []) {
      const u = s.unitById.get(id);
      if (!u) continue;
      let target = null;
      if (u.destTileId != null) {
        const t = tileById(s, u.destTileId);
        if (t) target = t;
      } else if (u.targetUnitId != null) {
        const tu = s.unitById.get(u.targetUnitId);
        if (tu) target = { x: tu.x, y: tu.y };
      } else if (u.targetBuildingId != null) {
        const b = s.buildingsById.get(u.targetBuildingId);
        if (b) { const t = tileById(s, b.tileId); if (t) target = t; }
      }
      if (target) wanted.set(id, { unit: u, target });
    }
    for (const [id, m] of maps.markers) {
      if (wanted.has(id)) continue;
      layers.fx.remove(m.line, m.dot);
      m.line.geometry.dispose();
      m.line.material.dispose();
      m.dot.geometry.dispose();
      m.dot.material.dispose();
      maps.markers.delete(id);
    }
    for (const [id, { unit, target }] of wanted) {
      let m = maps.markers.get(id);
      if (!m) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
          new THREE.LineDashedMaterial({
            color: '#ffe9a8', dashSize: 0.28, gapSize: 0.2, transparent: true, opacity: 0.9, depthWrite: false,
          }),
        );
        const dot = new THREE.Mesh(
          new THREE.RingGeometry(0.11, 0.19, 14),
          new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
        );
        dot.rotation.x = -Math.PI / 2;
        layers.fx.add(line, dot);
        m = { line, dot };
        maps.markers.set(id, m);
      }
      const from = { x: unit.x, z: unit.y };
      const to = { x: target.x, z: target.y };
      const pos = m.line.geometry.attributes.position;
      pos.setXYZ(0, from.x, TILE_HEIGHT + 0.1, from.z);
      pos.setXYZ(1, to.x, TILE_HEIGHT + 0.1, to.z);
      pos.needsUpdate = true;
      m.line.computeLineDistances();
      m.dot.position.set(to.x, TILE_HEIGHT + 0.06, to.z);
    }
  }

  function syncEffects(s) {
    const live = new Set();
    for (const f of s.floaters) {
      live.add(f);
      let sprite = maps.floaters.get(f);
      if (!sprite) {
        const tex = new THREE.CanvasTexture(textCanvas(f.text, f.color, Math.round(46 * (f.size || 1))));
        tex.colorSpace = THREE.SRGBColorSpace;
        sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
        sprite.scale.set(1.2, 0.6, 1);
        layers.fx.add(sprite);
        maps.floaters.set(f, sprite);
      }
      sprite.position.set(f.x, 1.05 + (f.maxLife - f.life) * 0.8, f.y);
      sprite.material.opacity = Math.max(0, Math.min(1, f.life / f.maxLife));
    }
    for (const [f, sprite] of maps.floaters) {
      if (live.has(f)) continue;
      layers.fx.remove(sprite);
      sprite.material.map.dispose();
      sprite.material.dispose();
      maps.floaters.delete(f);
    }
    // projectiles
    for (let i = 0; i < s.projectiles.length; i++) {
      const p = s.projectiles[i];
      let mesh = projectiles[i];
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.075, 7, 6),
          new THREE.MeshBasicMaterial({ color: '#ffd27a' }),
        );
        layers.fx.add(mesh);
        projectiles.push(mesh);
      }
      const k = 1 - p.life / p.max;
      const fx = p.x + (p.tx - p.x) * k;
      const fz = p.y + (p.ty - p.y) * k;
      mesh.position.set(fx, elevationAt(s, fx, fz) + 0.8 + Math.sin(k * Math.PI) * 0.35, fz);
      mesh.visible = true;
    }
    for (let i = s.projectiles.length; i < projectiles.length; i++) projectiles[i].visible = false;
  }


  // ---------------------------------------------------------------- work parties
  // Villagers are simulated as a count inside each building, but the world should
  // show them working: small 3D workers walk from their building to the resource
  // node it exploits (forest, wildlife, lake, mine), harvest for a while and carry
  // the load home. Presentation only — the engine stays authoritative.
  const WORK_NODE = {
    woodcutter: { terrain: ['forest', 'wildlife'], tool: 'axe' },
    hunter: { terrain: ['wildlife', 'forest'], tool: 'bow' },
    fishery: { terrain: ['lake'], tool: 'rod' },
    mine: { terrain: ['mountain', 'iron'], tool: 'pick' },
    ironmine: { terrain: ['iron'], tool: 'pick' },
  };
  const ONSITE_WORK = {
    farm: 'sickle', brewery: 'sickle', forge: 'pick', market: 'rod',
    tradingpost: 'rod', altar: 'rod', barracks: 'axe', townhall: 'axe', tower: 'axe',
  };
  const CYCLE = 11;   // seconds for one full work round trip

  function findWorkNode(s, clan, tile, terrains) {
    let best = null;
    let bestScore = -1e9;
    for (const t of s.tiles) {
      if (!terrains.includes(t.terrain)) continue;
      const d = Math.abs(t.q - tile.q) + Math.abs(t.q + t.r - tile.q - tile.r) + Math.abs(t.r - tile.r);
      const score = (t.owner === clan ? 6 : t.owner == null ? 0 : -20) - d * 1.5
        + (t.depositMax > 0 && t.deposit > 0 ? 3 : 0);
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  function syncWorkers(s) {
    const seen = new Set();
    for (const tile of s.tiles) {
      const { x, z } = tileTo3D(tile);
      const groundY = tileElevation(tile);
      for (const b of tile.buildings) {
        if (!b.done || !(b.workers > 0)) continue;
        const plan = WORK_NODE[b.type];
        const onSite = ONSITE_WORK[b.type];
        if (!plan && !onSite) continue;
        seen.add(b.id);
        const clan = s.clans[b.clan];
        const tool = plan ? plan.tool : onSite;
        const count = Math.min(b.workers, 3);
        let entry = maps.workers.get(b.id);
        if (!entry || entry.count !== count || entry.tool !== tool) {
          if (entry) { layers.workers.remove(entry.group); disposeGroup(entry.group); }
          const group = new THREE.Group();
          group.userData.buildingId = b.id;
          const party = [];
          for (let i = 0; i < count; i++) {
            const w = buildVillagerMesh(clan.color, clan.banner, tool);
            const load = w.getObjectByName('load');
            group.add(w);
            party.push({ group: w, parts: w.userData.parts, load, seed: (b.id * 7.31 + i * 2.77) % 100 });
          }
          entry = { group, party, count, tool, nodeId: null, node: null, retarget: 0 };
          layers.workers.add(group);
          maps.workers.set(b.id, entry);
        }
        // pick the resource node this building works from (refreshed rarely)
        entry.retarget -= 1;
        if (plan && (entry.retarget <= 0 || !entry.node || entry.node.terrain !== undefined && entry.node.depositMax > 0 && entry.node.deposit <= 0)) {
          const node = findWorkNode(s, b.clan, tile, plan.terrain);
          entry.node = node;
          entry.retarget = 120;   // ~2 s at 60 fps
        }
        entry.group.userData.nodeId = entry.node ? entry.node.id : null;
        const nodeX = entry.node ? entry.node.x : x;
        const nodeZ = entry.node ? entry.node.y : z;
        const nodeY = entry.node ? tileElevation(entry.node) : groundY;
        for (let i = 0; i < entry.party.length; i++) {
          const w = entry.party[i];
          const phase = (((time + w.seed) % CYCLE) + CYCLE) % CYCLE / CYCLE;
          const side = (i - (entry.party.length - 1) / 2) * 0.34;
          // 0-0.34 walk out · 0.34-0.58 work · 0.58-0.9 walk home · 0.9-1 rest
          let t = 0;
          let working = false;
          let carrying = false;
          if (phase < 0.34) t = phase / 0.34;
          else if (phase < 0.58) { t = 1; working = true; }
          else if (phase < 0.9) { t = 1 - (phase - 0.58) / 0.32; carrying = true; }
          else { t = 0; }
          const px = x + (nodeX - x) * t + side * 0.18;
          const pz = z + (nodeZ - z) * t + side * 0.18;
          const py = groundY + (nodeY - groundY) * t;
          w.group.position.set(px, py, pz);
          const heading = Math.atan2(nodeX - x, nodeZ - z) + (t < 0.5 && phase >= 0.58 ? Math.PI : 0);
          w.group.rotation.y = heading;
          const parts = w.parts;
          const walking = !working;
          const bob = Math.sin(time * 9 + w.seed);
          parts.body.position.y = walking ? Math.abs(bob) * 0.05 : 0;
          parts.armL.rotation.x = walking ? bob * 0.5 : -0.3;
          parts.armR.rotation.x = walking ? -bob * 0.5 : 0;
          if (working) {
            // chopping / digging / reaping beat
            const beat = Math.sin(time * 7 + w.seed) * 0.9;
            parts.weapon.rotation.x = -0.9 + beat * 0.55;
            parts.body.rotation.x = beat * 0.08;
          } else {
            parts.weapon.rotation.x *= 0.7;
            parts.body.rotation.x = 0;
          }
          if (w.load) w.load.visible = carrying;
        }
      }
    }
    for (const [id, entry] of maps.workers) {
      if (seen.has(id)) continue;
      layers.workers.remove(entry.group);
      disposeGroup(entry.group);
      maps.workers.delete(id);
    }
  }

  // ---------------------------------------------------------------- seasons
  const SNOW = new THREE.Color('#eaf2fb');
  const SEASON_TINT = {
    spring: new THREE.Color('#b9d489'),
    summer: new THREE.Color('#f4e3a6'),
    autumn: new THREE.Color('#dfae6d'),
    winter: new THREE.Color('#cfe0f0'),
  };
  function syncSeason(s) {
    const season = SEASONS[seasonIndexOf(s)];
    const winter = winterAmount(s) || 0;
    const key = `${season.key}|${winter.toFixed(2)}`;
    if (key === lastSeasonKey) return;
    lastSeasonKey = key;
    paintSky(season.key, winter);
    const tint = SEASON_TINT[season.key];
    // one material carries the whole terrain: tint the seasons, whiten it as the
    // snow settles in
    if (terrainMesh) {
      const c = new THREE.Color('#ffffff');
      c.lerp(tint, 0.16);
      c.lerp(SNOW, winter * 0.62);
      terrainMesh.material.color.copy(c);
    }
    const frozen = season.key === 'winter';
    hemi.intensity = frozen ? 0.66 : 0.85;
    sun.intensity = frozen ? 1.15 : 1.65;
    sun.color.set(frozen ? '#e8f0ff' : '#fff4de');
    scene.fog.color.set(frozen ? '#bccfe2' : '#a8c3d6');
    if (waterMesh) {
      waterMesh.material.opacity = frozen ? 0.92 : 0.88;
      waterMesh.material.color.set(frozen ? '#8fb4cb' : '#3f87ab');
      waterMesh.material.roughness = frozen ? 0.35 : 0.12;
    }
  }

  // ---------------------------------------------------------------- picking
  function screenToTile(s, sx, sy) {
    return pickTileFromScreen(s, rig, camera, sx, sy, canvas._w, canvas._h);
  }

  // ---------------------------------------------------------------- draw
  function draw(s, ui, dt) {
    if (!built || state !== s) { state = s; buildWorld(s); }
    if (signature !== `${terrainSignature(s)}|${scatterSignature(s)}`) {
      // buildings appeared or vanished: rebuild terrain pads and the scatter
      buildWorld(s);
    }
    time += dt;
    size();
    // the camera looks at the ground under its target, and eases towards the
    // pose the player asked for
    rig.target.y = elevationAt(s, rig.target.x, rig.target.z);
    rigStep(rig, dt);
    const focus = rig.smooth && rig.now ? rig.now : rig.target;
    syncSeason(s);
    syncTerritory(s);
    syncBuildings(s);
    syncUnits(s, ui, dt);
    syncWorkers(s);
    syncHighlights(s, ui);
    syncMarkers(s, ui);
    syncEffects(s);
    swayTrees(dt);
    if (waterMesh) {
      // slow drift so the sea and the lakes are alive
      const map = waterMesh.material.map;
      if (map) { map.offset.x = (time * 0.012) % 1; map.offset.y = (time * 0.007) % 1; }
    }

    // keep the shadow camera on the action
    sun.position.set(focus.x + 15, 30, focus.z + 11);
    sun.target.position.set(focus.x, focus.y, focus.z);
    sun.target.updateMatrixWorld();
    sky.position.set(focus.x, focus.y, focus.z);
    applyRig(rig, camera);
    renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------- camera
  function clampTarget() {
    rig.target.x = Math.max(-34, Math.min(34, rig.target.x));
    rig.target.z = Math.max(-34, Math.min(34, rig.target.z));
  }
  function panBy(dxPx, dyPx) {
    const scale = rig.distance * 0.0017;
    const cosY = Math.cos(rig.yaw);
    const sinY = Math.sin(rig.yaw);
    rig.target.x -= (dxPx * cosY - dyPx * sinY) * scale;
    rig.target.z -= (dxPx * sinY + dyPx * cosY) * scale;
    clampTarget();
  }
  function zoomAt(sx, sy, factor) {
    const before = screenToGround(rig, camera, sx, sy, canvas._w, canvas._h);
    rig.distance = Math.max(rig.minDistance, Math.min(rig.maxDistance, rig.distance / factor));
    const after = screenToGround(rig, camera, sx, sy, canvas._w, canvas._h);
    if (before && after) {
      rig.target.x += before.x - after.x;
      rig.target.z += before.z - after.z;
      clampTarget();
    }
  }

  return {
    kind: '3d',
    scene,
    layers,
    camera,
    renderer,
    rig,
    draw,
    size,
    screenToTile,
    groundToScreen: (x, z, elevation = 0) => groundToScreen(rig, camera, x, z, canvas._w, canvas._h, elevation),
    centerOn: (x, z) => { rig.target.x = x; rig.target.z = z; clampTarget(); },
    panBy,
    zoomAt,
    rotateBy: (rad) => { rig.yaw += rad; },
    tiltBy: (rad) => { rig.pitch = Math.max(rig.minPitch, Math.min(rig.maxPitch, rig.pitch + rad)); },
    setZoom: (d) => { rig.distance = Math.max(rig.minDistance, Math.min(rig.maxDistance, d)); },
    getZoom: () => rig.distance,
    getTarget: () => ({ ...rig.target }),
    resize: size,
    dispose() {
      for (const l of Object.values(layers)) disposeGroup(l);
      renderer.dispose();
    },
  };
}
