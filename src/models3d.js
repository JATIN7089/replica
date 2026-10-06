// ============================================================================
// Northhold — procedural 3D models (original low-poly geometry, no assets).
// Every terrain piece, building and unit is built from primitives here, so the
// whole game ships without a single external model or texture file.
// ============================================================================
import * as THREE from '../vendor/three.module.min.js';

export const HEX_RADIUS = 1;          // world units, matches the engine's hex size
export const TILE_HEIGHT = 0.16;      // default tile slab thickness
export const MOUNTAIN_HEIGHT = 0.85;

// ---------------------------------------------------------------- primitives
const DUMMY = new THREE.Object3D();

export function hexCornersXZ(radius) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return pts;
}

/** Flat-topped hexagonal prism sitting on y = 0 (bottom) up to y = height. */

/** Flat hexagonal ring used for territory borders and selection highlights. */
export function hexRingGeometry(inner, outer, y = 0) {
  const a = hexCornersXZ(inner);
  const b = hexCornersXZ(outer);
  const verts = [];
  const push = (p) => verts.push(p[0], y, p[1]);
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    push(a[i]); push(b[i]); push(b[j]);
    push(a[i]); push(b[j]); push(a[j]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

export const prim = {};

export const MAT = {
  stone: () => new THREE.MeshStandardMaterial({ color: '#8b8f99', roughness: 0.95, flatShading: true }),
  darkStone: () => new THREE.MeshStandardMaterial({ color: '#5b5f6b', roughness: 1, flatShading: true }),
  ironOre: () => new THREE.MeshStandardMaterial({ color: '#7d8798', roughness: 0.65, metalness: 0.35, flatShading: true }),
  snow: () => new THREE.MeshStandardMaterial({ color: '#eef4fb', roughness: 0.9, flatShading: true }),
  wood: () => new THREE.MeshStandardMaterial({ color: '#6b4a2f', roughness: 0.9, flatShading: true }),
  darkWood: () => new THREE.MeshStandardMaterial({ color: '#4a3524', roughness: 0.9, flatShading: true }),
  thatch: () => new THREE.MeshStandardMaterial({ color: '#8a6a3a', roughness: 1, flatShading: true }),
  cloth: (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true }),
  metal: () => new THREE.MeshStandardMaterial({ color: '#b9c0cb', roughness: 0.35, metalness: 0.75, flatShading: true }),
  leaf: (shade = 0) => new THREE.MeshStandardMaterial({
    color: new THREE.Color('#2f5d33').offsetHSL(0, 0, shade), roughness: 0.95, flatShading: true,
  }),
  gold: () => new THREE.MeshStandardMaterial({ color: '#d8b449', roughness: 0.4, metalness: 0.6, flatShading: true }),
  ember: () => new THREE.MeshStandardMaterial({
    color: '#ff9a3c', emissive: new THREE.Color('#ff7a18'), emissiveIntensity: 1.4, roughness: 0.6,
  }),
  water: () => new THREE.MeshStandardMaterial({
    color: '#2f6f92', transparent: true, opacity: 0.82, roughness: 0.25, metalness: 0.1,
  }),
  skin: () => new THREE.MeshStandardMaterial({ color: '#d9a77c', roughness: 0.85, flatShading: true }),
};

const box = (w, h, d, material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
};
const cyl = (rt, rb, h, material, x = 0, y = 0, z = 0, seg = 8) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  return m;
};
const cone = (r, h, material, x = 0, y = 0, z = 0, seg = 7) => {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), material);
  m.position.set(x, y, z);
  return m;
};
const sph = (r, material, x = 0, y = 0, z = 0, seg = 8) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(4, seg / 2)), material);
  m.position.set(x, y, z);
  return m;
};
/** gabled roof: two slanted slabs */
function gableRoof(width, depth, height, material, x = 0, y = 0, z = 0, overhang = 0.12) {
  const g = new THREE.Group();
  const slabW = width / 2 + overhang;
  const slope = Math.atan2(height, width / 2);
  const len = Math.sqrt((width / 2) ** 2 + height ** 2) + overhang * 0.4;
  for (const side of [-1, 1]) {
    const slab = box(slabW, 0.07, depth + overhang, material);
    slab.position.set(side * (slabW / 2) * Math.cos(slope * 0.02), height / 2, 0);
    slab.rotation.z = -side * slope;
    g.add(slab);
  }
  g.position.set(x, y, z);
  return g;
}

// ---------------------------------------------------------------- terrain
Object.assign(prim, { box, cyl, cone, sph, gableRoof, hexCornersXZ });

/** Merge a Group's meshes into one geometry (used for instanced scatter props). */
export const mergeMesh = (group) => mergeMeshes(
  (() => {
    const out = [];
    group.traverse((o) => { if (o.isMesh) out.push(o); });
    return out;
  })(),
  { jitter: 0.02 },
);

// ---------------------------------------------------------------- instancing
/**
 * Merge a list of meshes into one non-indexed geometry with a `color` attribute,
 * so a whole tree (trunk + branches + foliage) can be drawn as a single
 * InstancedMesh. Materials are baked into vertex colours.
 */
export function mergeMeshes(meshes, opts = {}) {
  const positions = [];
  const normals = [];
  const colors = [];
  const tmp = new THREE.Color();
  for (const mesh of meshes) {
    if (!mesh) continue;
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrix);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    tmp.copy(mat.color || new THREE.Color('#ffffff'));
    // per-face colour jitter keeps big surfaces from looking flat
    for (let i = 0; i < pos.count; i += 3) {
      const j = (Math.sin(i * 12.9898 + (opts.seed || 0)) * 43758.5453) % 1;
      const k = 1 + j * (opts.jitter || 0.12);
      for (let v = 0; v < 3; v++) {
        positions.push(pos.getX(i + v), pos.getY(i + v), pos.getZ(i + v));
        if (nor) normals.push(nor.getX(i + v), nor.getY(i + v), nor.getZ(i + v));
        colors.push(tmp.r * k, tmp.g * k, tmp.b * k);
      }
    }
    geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length) out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  else out.computeVertexNormals();
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  out.computeBoundingSphere();
  return out;
}

const vMesh = (geometry, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color }));
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.scale.set(sx, sy, sz);
  m.updateMatrix();
  return m;
};

/**
 * Tree variants, each one merged geometry so forests draw as ~3 instanced meshes.
 * Every tree has a trunk, a few branches and layered foliage.
 */
export function buildTreeVariants() {
  const variants = [];
  const trunkGeo = new THREE.CylinderGeometry(1, 1.35, 1, 6);
  const coneGeo = new THREE.ConeGeometry(1, 1, 7);

  // --- pine: broad layered canopy
  variants.push({
    id: 'pine',
    height: 1.9,
    radius: 0.62,
    geometry: mergeMeshes([
      vMesh(trunkGeo, '#5a4028', 0, 0.28, 0, 0, 0, 0, 0.055, 0.56, 0.055),
      vMesh(trunkGeo, '#6b4a2f', 0.12, 0.5, 0.05, 0, 0, 0.6, 0.03, 0.34, 0.03),
      vMesh(trunkGeo, '#6b4a2f', -0.1, 0.52, -0.06, 0.5, 0, -0.6, 0.03, 0.3, 0.03),
      vMesh(coneGeo, '#2f5734', 0, 0.95, 0, 0, 0.4, 0, 0.6, 0.78, 0.6),
      vMesh(coneGeo, '#356240', 0, 1.32, 0, 0, 1.1, 0, 0.46, 0.62, 0.46),
      vMesh(coneGeo, '#3c6d47', 0, 1.66, 0, 0, 1.9, 0, 0.3, 0.5, 0.3),
    ], { seed: 1 }),
    sway: 0.03,
  });

  // --- fir: tall and narrow
  variants.push({
    id: 'fir',
    height: 2.3,
    radius: 0.5,
    geometry: mergeMeshes([
      vMesh(trunkGeo, '#4f3822', 0, 0.4, 0, 0, 0, 0, 0.05, 0.8, 0.05),
      vMesh(coneGeo, '#2a4f31', 0, 1.0, 0, 0, 0.3, 0, 0.5, 0.9, 0.5),
      vMesh(coneGeo, '#316038', 0, 1.5, 0, 0, 1.0, 0, 0.4, 0.72, 0.4),
      vMesh(coneGeo, '#38703f', 0, 1.94, 0, 0, 1.7, 0, 0.27, 0.55, 0.27),
      vMesh(coneGeo, '#3d7a45', 0, 2.24, 0, 0, 2.4, 0, 0.16, 0.36, 0.16),
    ], { seed: 2 }),
    sway: 0.035,
  });

  // --- broadleaf: trunk, two branches and rounded canopies
  const blobGeo = new THREE.IcosahedronGeometry(1, 0);
  variants.push({
    id: 'broadleaf',
    height: 1.7,
    radius: 0.7,
    geometry: mergeMeshes([
      vMesh(trunkGeo, '#6d5133', 0, 0.4, 0, 0, 0, 0, 0.07, 0.8, 0.07),
      vMesh(trunkGeo, '#7a5c3a', 0.16, 0.78, 0.08, 0, 0, 0.75, 0.035, 0.42, 0.035),
      vMesh(trunkGeo, '#7a5c3a', -0.14, 0.82, -0.1, 0, 0, -0.7, 0.035, 0.4, 0.035),
      vMesh(blobGeo, '#3e6b39', 0.02, 1.12, 0.02, 0, 0.5, 0, 0.52, 0.42, 0.5),
      vMesh(blobGeo, '#456f3c', -0.3, 1.0, -0.2, 0, 1.4, 0, 0.34, 0.3, 0.34),
      vMesh(blobGeo, '#4a7a42', 0.32, 1.24, -0.14, 0, 2.3, 0, 0.3, 0.26, 0.3),
      vMesh(blobGeo, '#527f45', 0.1, 1.4, 0.1, 0, 3.1, 0, 0.26, 0.22, 0.26),
    ], { seed: 3 }),
    sway: 0.045,
  });

  // --- dead/birch accent: thin pale trunk, sparse canopy
  variants.push({
    id: 'birch',
    height: 1.45,
    radius: 0.36,
    geometry: mergeMeshes([
      vMesh(trunkGeo, '#9c9083', 0, 0.38, 0, 0, 0, 0, 0.045, 0.76, 0.045),
      vMesh(blobGeo, '#7d9a4e', 0, 0.96, 0, 0, 0.8, 0, 0.36, 0.3, 0.36),
      vMesh(blobGeo, '#88a457', 0.18, 1.12, 0.06, 0, 1.9, 0, 0.26, 0.22, 0.26),
      vMesh(blobGeo, '#93ad60', -0.1, 1.28, -0.12, 0, 2.7, 0, 0.22, 0.18, 0.22),
    ], { seed: 4 }),
    sway: 0.05,
  });

  return variants;
}

/** Rock formations: boulder clusters with varied facets, snow-capped peaks. */
export function buildRockVariants() {
  const variants = [];
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const dode = new THREE.DodecahedronGeometry(1, 0);

  variants.push({
    id: 'boulder',
    height: 0.9,
    radius: 0.55,
    geometry: mergeMeshes([
      vMesh(ico, '#6f6f6b', 0, 0.3, 0, 0.3, 0.4, 0.2, 0.5, 0.36, 0.48),
      vMesh(ico, '#7a7a75', 0.42, 0.2, 0.16, 0.6, 1.1, 0.4, 0.3, 0.24, 0.3),
      vMesh(ico, '#63635f', -0.32, 0.16, -0.22, 0, 2.1, 0.5, 0.24, 0.2, 0.26),
    ], { seed: 5, jitter: 0.16 }),
    sway: 0,
  });

  variants.push({
    id: 'crag',
    height: 1.9,
    radius: 0.75,
    geometry: mergeMeshes([
      vMesh(dode, '#5f5f5d', 0, 0.5, 0, 0.2, 0.5, 0.1, 0.62, 0.62, 0.6),
      vMesh(dode, '#6b6b67', 0.1, 1.15, 0.05, 0.4, 1.2, 0.2, 0.44, 0.5, 0.42),
      vMesh(ico, '#eeeeee', 0.1, 1.55, 0.05, 0, 0.7, 0, 0.3, 0.2, 0.28),   // snow cap
      vMesh(ico, '#575757', -0.45, 0.3, 0.3, 0.5, 2.4, 0.3, 0.26, 0.2, 0.26),
    ], { seed: 6, jitter: 0.14 }),
    sway: 0,
  });

  variants.push({
    id: 'slab',
    height: 0.55,
    radius: 0.6,
    geometry: mergeMeshes([
      vMesh(new THREE.BoxGeometry(1.1, 0.32, 0.9), '#73736e', 0, 0.16, 0, 0, 0.4, 0.06, 1, 1, 1),
      vMesh(new THREE.BoxGeometry(0.7, 0.26, 0.6), '#65655f', 0.5, 0.12, 0.28, 0, 0.9, -0.08, 1, 1, 1),
      vMesh(new THREE.BoxGeometry(0.5, 0.2, 0.5), '#7d7d78', -0.4, 0.1, -0.3, 0, 1.6, 0.1, 1, 1, 1),
    ], { seed: 7, jitter: 0.1 }),
    sway: 0,
  });

  return variants;
}

/** Iron ore: dark host rock shot through with bright ore veins. */
export function buildOreVariant() {
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const oct = new THREE.OctahedronGeometry(1, 0);
  return {
    id: 'ore',
    height: 1.2,
    radius: 0.62,
    geometry: mergeMeshes([
      vMesh(ico, '#4f4a4e', 0, 0.34, 0, 0.2, 0.6, 0.2, 0.55, 0.42, 0.52),
      vMesh(ico, '#5a545a', 0.4, 0.22, 0.3, 0.4, 1.4, 0.2, 0.3, 0.24, 0.3),
      vMesh(oct, '#c9713a', 0.18, 0.5, 0.18, 0.3, 0.7, 0.4, 0.13, 0.17, 0.13),
      vMesh(oct, '#d98a45', -0.22, 0.42, -0.12, 0.5, 1.7, 0.2, 0.11, 0.14, 0.11),
      vMesh(oct, '#b8632f', 0.02, 0.62, -0.3, 0.2, 2.6, 0.5, 0.09, 0.12, 0.09),
    ], { seed: 8, jitter: 0.1 }),
    sway: 0,
  };
}

/** Ruins: broken walls, pillars and rubble for the ruins tiles. */
export function buildRuinVariants() {
  const variants = [];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(0.5, 0.55, 1, 7);
  variants.push({
    id: 'pillar',
    height: 1.1,
    radius: 0.4,
    geometry: mergeMeshes([
      vMesh(boxGeo, '#8a8172', 0, 0.42, 0, 0, 0, 0, 0.34, 0.84, 0.34),
      vMesh(boxGeo, '#978d7d', 0, 0.9, 0, 0, 0.5, 0, 0.44, 0.12, 0.44),
    ], { seed: 9 }),
    sway: 0,
  });
  variants.push({
    id: 'wall',
    height: 0.7,
    radius: 0.9,
    geometry: mergeMeshes([
      vMesh(boxGeo, '#8a8172', 0, 0.3, 0, 0, 0.2, 0, 1.5, 0.6, 0.28),
      vMesh(boxGeo, '#9a9182', 0.5, 0.62, 0, 0, 0.2, 0, 0.5, 0.18, 0.28),
      vMesh(boxGeo, '#7f776a', -0.25, 0.1, 0.35, 0, 0.6, 0.1, 0.4, 0.2, 0.4),
    ], { seed: 10, jitter: 0.12 }),
    sway: 0,
  });
  variants.push({
    id: 'rubble',
    height: 0.35,
    radius: 0.5,
    geometry: mergeMeshes([
      vMesh(boxGeo, '#837a6c', 0, 0.1, 0, 0.1, 0.4, 0.1, 0.3, 0.2, 0.26),
      vMesh(boxGeo, '#8d8475', 0.25, 0.09, 0.2, 0, 1.1, 0, 0.22, 0.18, 0.2),
      vMesh(boxGeo, '#79705f', -0.2, 0.07, -0.15, 0.2, 2.0, 0.1, 0.2, 0.14, 0.18),
    ], { seed: 11, jitter: 0.14 }),
    sway: 0,
  });
  variants.push({
    id: 'arch',
    height: 1.35,
    radius: 0.7,
    geometry: mergeMeshes([
      vMesh(cylGeo, '#8a8172', -0.5, 0.5, 0, 0, 0, 0, 0.5, 1, 0.5),
      vMesh(cylGeo, '#8a8172', 0.5, 0.5, 0, 0, 0, 0, 0.5, 1, 0.5),
      vMesh(boxGeo, '#978d7d', 0, 1.15, 0, 0, 0, 0, 1.6, 0.24, 0.36),
    ], { seed: 12 }),
    sway: 0,
  });
  return variants;
}

/**
 * Farm: tilled rows and a scarecrow-ish marker, dropped on fertile tiles that
 * feed the clan. Wood: felled logs and a stump stack.
 */
export function buildPlotVariant(kind) {
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
  if (kind === 'farm') {
    const parts = [];
    for (let i = -2; i <= 2; i++) {
      parts.push(vMesh(boxGeo, i % 2 ? '#5d4630' : '#6b5138', 0, 0.03, i * 0.26, 0, 0, 0, 1.5, 0.08, 0.18));
    }
    parts.push(vMesh(cylGeo, '#8d6f3f', 0.6, 0.35, -0.5, 0, 0, 0, 0.07, 0.7, 0.07));
    parts.push(vMesh(cylGeo, '#8d6f3f', 0.6, 0.6, -0.5, 0, 0, Math.PI / 2, 0.05, 0.36, 0.05));
    return { id: 'farm', height: 0.7, radius: 0.9, geometry: mergeMeshes(parts, { seed: 13, jitter: 0.1 }), sway: 0 };
  }
  return {
    id: 'logs',
    height: 0.4,
    radius: 0.5,
    geometry: mergeMeshes([
      vMesh(cylGeo, '#7a5a38', 0.2, 0.12, 0.1, Math.PI / 2, 0.3, 0, 0.26, 0.9, 0.26),
      vMesh(cylGeo, '#6b4d30', 0.24, 0.36, 0.08, Math.PI / 2, 0.2, 0, 0.24, 0.82, 0.24),
      vMesh(cylGeo, '#7f5f3c', -0.3, 0.14, -0.15, Math.PI / 2, 1.2, 0, 0.22, 0.6, 0.22),
    ], { seed: 14, jitter: 0.1 }),
    sway: 0,
  };
}

function tree(scale = 1, shade = 0.5, y = 0, x = 0, z = 0) {
  const g = new THREE.Group();
  const trunk = cyl(0.05 * scale, 0.07 * scale, 0.22 * scale, MAT.wood(), 0, 0.11 * scale, 0, 6);
  const lower = cone(0.24 * scale, 0.42 * scale, MAT.leaf(shade * 0.12 - 0.06), 0, 0.42 * scale, 0, 7);
  const upper = cone(0.17 * scale, 0.32 * scale, MAT.leaf(shade * 0.1 - 0.02), 0, 0.66 * scale, 0, 7);
  [trunk, lower, upper].forEach((m) => { m.castShadow = true; g.add(m); });
  g.position.set(x, y, z);
  g.rotation.y = shade * Math.PI;
  return g;
}

function deer(rot = 0) {
  const g = new THREE.Group();
  const body = cyl(0.06, 0.07, 0.2, MAT.wood(), 0, 0.14, 0, 6);
  body.rotation.z = Math.PI / 2;
  const head = sph(0.05, MAT.wood(), 0.12, 0.2, 0);
  const antler1 = cyl(0.01, 0.01, 0.12, MAT.wood(), 0.13, 0.29, 0.04, 4);
  const antler2 = cyl(0.01, 0.01, 0.12, MAT.wood(), 0.13, 0.29, -0.04, 4);
  [body, head, antler1, antler2].forEach((m) => g.add(m));
  g.position.y = TILE_HEIGHT;
  g.rotation.y = rot;
  return g;
}

export function buildDeerMesh(rot = 0) { return deer(rot); }

// ---------------------------------------------------------------- buildings
// (the building catalogue lives in buildings3d.js)

function chopBlock(darkWood, x, y, z) {
  const g = new THREE.Group();
  g.add(cyl(0.12, 0.13, 0.14, darkWood, 0, 0.07, 0, 7));
  const axe = new THREE.Group();
  axe.add(cyl(0.012, 0.014, 0.24, MAT.wood(), 0, 0.12, 0, 5));
  axe.add(box(0.06, 0.07, 0.015, MAT.metal(), 0.05, 0.22, 0));
  axe.rotation.z = -0.5;
  axe.position.set(0.06, 0.1, 0);
  g.add(axe);
  g.position.set(x, y, z);
  return g;
}

// ---------------------------------------------------------------- units
const UNIT_STYLE = {
  warrior: { weapon: 'sword', shield: true, helmet: 'round' },
  axe: { weapon: 'axe', shield: false, helmet: 'round' },
  shield: { weapon: 'spear', shield: true, bigShield: true, helmet: 'nasal' },
  scout: { weapon: 'bow', shield: false, helmet: 'hood' },
  warchief: { weapon: 'sword', shield: true, helmet: 'horned', hero: true },
};

/**
 * A worker: the clan's villagers, as 3D bodies with the tool of their trade.
 * Work parties walk from their building to a resource node and back, so resource
 * gathering is visible in the world instead of being an abstract number.
 */
const WORK_TOOLS = {
  wood: 'axe', stone: 'pick', iron: 'pick', food: 'sickle', fish: 'rod', lore: 'rod',
};
export function workToolFor(res, type) {
  if (type === 'farm' || type === 'brewery') return 'sickle';
  if (type === 'woodcutter') return 'axe';
  if (type === 'hunter') return 'bow';
  if (type === 'mine' || type === 'ironmine') return 'pick';
  if (type === 'fishery') return 'rod';
  return WORK_TOOLS[res] || 'axe';
}

export function buildVillagerMesh(clanColor = '#c9b184', bannerColor = '#f0b757', tool = 'axe') {
  const g = new THREE.Group();
  const tunic = MAT.cloth(clanColor);
  const trim = MAT.cloth(bannerColor);
  const body = new THREE.Group();
  body.name = 'body';
  const torso = cyl(0.105, 0.13, 0.26, tunic, 0, 0.33, 0, 6);
  torso.castShadow = true;
  body.add(torso);
  body.add(cyl(0.125, 0.125, 0.045, trim, 0, 0.21, 0, 6));      // belt
  const head = sph(0.09, MAT.skin(), 0, 0.5, 0, 6);
  head.name = 'head';
  head.castShadow = true;
  body.add(head);
  body.add(sph(0.1, trim, 0, 0.54, 0, 6));                        // cap
  const armL = cyl(0.032, 0.032, 0.2, tunic, -0.13, 0.34, 0, 5);
  const armR = cyl(0.032, 0.032, 0.2, tunic, 0.13, 0.34, 0, 5);
  armL.name = 'armL';
  armR.name = 'armR';
  body.add(armL, armR);
  for (const side of [-1, 1]) {
    const leg = cyl(0.038, 0.034, 0.2, MAT.cloth('#4b3a2a'), side * 0.055, 0.1, 0, 5);
    leg.name = side < 0 ? 'legL' : 'legR';
    body.add(leg);
  }
  const weapon = new THREE.Group();
  weapon.name = 'weapon';
  if (tool === 'axe') {
    weapon.add(cyl(0.012, 0.014, 0.26, MAT.wood(), 0, 0.06, 0, 5));
    weapon.add(box(0.07, 0.1, 0.018, MAT.metal(), 0.045, 0.17, 0));
  } else if (tool === 'pick') {
    weapon.add(cyl(0.012, 0.014, 0.28, MAT.wood(), 0, 0.06, 0, 5));
    weapon.add(box(0.16, 0.03, 0.02, MAT.metal(), 0, 0.2, 0));
  } else if (tool === 'sickle') {
    weapon.add(cyl(0.011, 0.013, 0.16, MAT.wood(), 0, 0.04, 0, 5));
    weapon.add(box(0.09, 0.025, 0.016, MAT.metal(), 0.045, 0.12, 0));
  } else if (tool === 'bow') {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.01, 4, 8, Math.PI * 1.1), MAT.wood());
    bow.rotation.y = Math.PI / 2;
    weapon.add(bow);
  } else {
    weapon.add(cyl(0.008, 0.01, 0.34, MAT.wood(), 0, 0.12, 0, 4));
  }
  weapon.position.set(0.17, 0.34, 0.02);
  weapon.rotation.z = tool === 'pick' ? -0.35 : -0.2;
  body.add(weapon);
  // the load a worker carries home from the resource node (hidden until it does)
  const load = box(0.14, 0.12, 0.1, tool === 'pick' ? MAT.stone() : MAT.wood(), 0, 0.42, -0.16);
  load.name = 'load';
  load.visible = false;
  body.add(load);
  g.add(body);
  g.userData.parts = { body, head, armL, armR, weapon };
  g.userData.style = { tool, worker: true };
  return g;
}

/** Low-poly Viking. Returns a group with named parts for animation. */
export function buildUnitMesh(type, clanColor = '#e09a3a', bannerColor = '#f0b757') {
  const style = UNIT_STYLE[type] || UNIT_STYLE.warrior;
  const g = new THREE.Group();
  const tunic = MAT.cloth(clanColor);
  const trim = MAT.cloth(bannerColor);
  const metal = MAT.metal();
  const scale = style.hero ? 1.18 : 1;

  const body = new THREE.Group();
  body.name = 'body';
  const torso = body.add ? null : null;
  const torsoMesh = cyl(0.13, 0.16, 0.3, tunic, 0, 0.34, 0, 7);
  torsoMesh.castShadow = true;
  body.add(torsoMesh);
  body.add(cyl(0.155, 0.155, 0.05, trim, 0, 0.2, 0, 7));           // belt
  const head = sph(0.105, MAT.skin(), 0, 0.55, 0, 7);
  head.name = 'head';
  head.castShadow = true;
  body.add(head);
  // helmet
  if (style.helmet === 'horned') {
    body.add(sph(0.12, metal, 0, 0.58, 0, 7));
    for (const s of [-1, 1]) {
      const horn = cone(0.035, 0.16, MAT.cloth('#f2e2c0'), s * 0.11, 0.66, 0, 5);
      horn.rotation.z = s * 0.7;
      body.add(horn);
    }
  } else if (style.helmet === 'nasal') {
    body.add(sph(0.115, metal, 0, 0.57, 0, 7));
    body.add(box(0.02, 0.07, 0.02, metal, 0, 0.53, 0.1));
  } else if (style.helmet === 'hood') {
    body.add(sph(0.125, MAT.cloth('#4c5a4a'), 0, 0.57, 0, 7));
  } else {
    body.add(sph(0.115, metal, 0, 0.58, 0, 7));
  }
  // arms
  const armL = cyl(0.045, 0.045, 0.24, tunic, -0.17, 0.36, 0, 6);
  const armR = cyl(0.045, 0.045, 0.24, tunic, 0.17, 0.36, 0, 6);
  armL.name = 'armL';
  armR.name = 'armR';
  body.add(armL, armR);
  // legs
  for (const s of [-1, 1]) {
    const leg = cyl(0.05, 0.045, 0.22, MAT.cloth('#4b3a2a'), s * 0.07, 0.11, 0, 6);
    leg.name = s < 0 ? 'legL' : 'legR';
    body.add(leg);
  }
  // weapon
  const weapon = new THREE.Group();
  weapon.name = 'weapon';
  if (style.weapon === 'sword') {
    weapon.add(cyl(0.012, 0.015, 0.1, MAT.darkWood(), 0, 0.0, 0, 5));
    weapon.add(box(0.03, 0.28, 0.012, metal, 0, 0.18, 0));
  } else if (style.weapon === 'axe') {
    weapon.add(cyl(0.014, 0.016, 0.34, MAT.wood(), 0, 0.1, 0, 5));
    const blade = box(0.1, 0.12, 0.02, metal, 0.06, 0.24, 0);
    weapon.add(blade);
  } else if (style.weapon === 'spear') {
    weapon.add(cyl(0.012, 0.014, 0.5, MAT.wood(), 0, 0.2, 0, 5));
    weapon.add(cone(0.03, 0.1, metal, 0, 0.48, 0, 5));
  } else if (style.weapon === 'bow') {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 4, 10, Math.PI * 1.1), MAT.wood());
    bow.rotation.y = Math.PI / 2;
    bow.rotation.z = 0.4;
    weapon.add(bow);
    weapon.add(box(0.005, 0.24, 0.005, MAT.cloth('#e8e0cc'), 0, 0.0, 0.09));
  }
  if (style.weapon !== 'bow') {
    weapon.position.set(0.24, 0.34, 0.03);
    weapon.rotation.z = style.weapon === 'spear' ? 0.12 : -0.25;
  } else {
    weapon.position.set(0.2, 0.4, 0.06);
  }
  body.add(weapon);
  // shield
  if (style.shield) {
    const radius = style.bigShield ? 0.17 : 0.13;
    const shield = cyl(radius, radius, 0.03, tunic, -0.2, 0.36, 0.06, 12);
    shield.rotation.z = Math.PI / 2;
    shield.rotation.y = 0.25;
    const boss = sph(0.04, metal, -0.2, 0.36, 0.09, 6);
    body.add(shield, boss);
    const rim = cyl(radius * 1.02, radius * 1.02, 0.012, trim, -0.2, 0.36, 0.045, 12);
    rim.rotation.z = Math.PI / 2;
    rim.rotation.y = 0.25;
    body.add(rim);
  }
  body.scale.setScalar(scale);
  g.add(body);

  // selection / hover ring lives outside the body so it never animates
  const ring = new THREE.Mesh(hexRingGeometry(0.24, 0.32, 0.005), new THREE.MeshBasicMaterial({
    color: '#ffe9a8', transparent: true, opacity: 0, side: THREE.DoubleSide,
  }));
  ring.name = 'selectRing';
  g.add(ring);

  g.userData.parts = { body, head, armL, armR, weapon };
  g.userData.style = style;
  return g;
}

/** Simple deer/wolf-like creature for neutral wildlife (used by events later). */
export function buildBlockMesh(w = 0.3, h = 0.3, d = 0.3, color = '#8a7a63') {
  const m = box(w, h, d, MAT.cloth(color), 0, h / 2, 0);
  m.castShadow = true;
  return m;
}

export { box as makeBox, cyl as makeCyl, cone as makeCone, sph as makeSphere, gableRoof };
