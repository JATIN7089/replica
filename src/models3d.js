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
export function hexPrismGeometry(radius, height, topScale = 1) {
  const c = hexCornersXZ(radius);
  const top = c.map(([x, z]) => [x * topScale, height, z * topScale]);
  const bottom = c.map(([x, z]) => [x, 0, z]);
  const verts = [];
  const push = (p) => verts.push(p[0], p[1], p[2]);
  // sides
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    push(bottom[i]); push(top[i]); push(top[j]);
    push(bottom[i]); push(top[j]); push(bottom[j]);
  }
  // top fan
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    push([0, height, 0]); push(top[i]); push(top[j]);
  }
  // bottom fan
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    push([0, 0, 0]); push(bottom[j]); push(bottom[i]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

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
export function buildTileMesh(tile) {
  const group = new THREE.Group();
  group.name = `tile-${tile.id}`;
  const kind = tile.terrain;
  const isWater = kind === 'lake';
  const isPeak = kind === 'mountain' || kind === 'iron';
  const base = new THREE.Color();
  switch (kind) {
    case 'forest': base.set('#3f6b45'); break;
    case 'fertile': base.set('#8f9c47'); break;
    case 'wildlife': base.set('#527449'); break;
    case 'lake': base.set('#24506b'); break;
    case 'mountain': base.set('#6f6d78'); break;
    case 'iron': base.set('#5d5b66'); break;
    case 'ruins': base.set('#7f6c56'); break;
    default: base.set('#6f8c4a');
  }
  // slight per-tile variation keeps the field from looking like a spreadsheet
  const variance = ((tile.id * 2654435761) % 1000) / 1000;
  base.offsetHSL(0, 0, (variance - 0.5) * 0.05);

  const slabMat = new THREE.MeshStandardMaterial({
    color: base, roughness: isWater ? 0.5 : 0.95, flatShading: true,
  });
  const height = isPeak ? MOUNTAIN_HEIGHT : isWater ? TILE_HEIGHT * 0.7 : TILE_HEIGHT;
  const slab = new THREE.Mesh(hexPrismGeometry(HEX_RADIUS * 0.99, height, isPeak ? 0.55 : 1), slabMat);
  slab.receiveShadow = true;
  slab.name = 'slab';
  group.add(slab);

  if (isWater) {
    const water = new THREE.Mesh(hexPrismGeometry(HEX_RADIUS * 0.92, 0.06, 1), MAT.water());
    water.position.y = height + 0.02;
    water.name = 'water';
    group.add(water);
  }
  if (isPeak) {
    const peakMat = kind === 'iron' ? MAT.ironOre() : MAT.stone();
    const peak = cone(0.42, 0.62, peakMat, 0, height + 0.24, 0);
    peak.rotation.y = variance * Math.PI;
    peak.castShadow = true;
    group.add(peak);
    const snowCap = cone(0.2, 0.26, MAT.snow(), 0, height + 0.45, 0);
    snowCap.rotation.y = variance * Math.PI;
    group.add(snowCap);
  }
  group.userData.terrainTop = height;
  return group;
}

export function buildDecorations(tile) {
  const group = new THREE.Group();
  const r = (n) => {
    const v = Math.sin(tile.id * 12.9898 + n * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  switch (tile.terrain) {
    case 'forest': {
      const count = 3 + Math.floor(r(1) * 2);
      for (let i = 0; i < count; i++) {
        const a = r(i + 2) * Math.PI * 2;
        const d = 0.15 + r(i + 9) * 0.5;
        const scale = 0.75 + r(i + 5) * 0.5;
        group.add(tree(scale, r(i + 3), TILE_HEIGHT, Math.cos(a) * d, Math.sin(a) * d));
      }
      break;
    }
    case 'plains':
    case 'fertile':
    case 'wildlife': {
      const count = tile.terrain === 'fertile' ? 6 : 4;
      for (let i = 0; i < count; i++) {
        const a = r(i + 4) * Math.PI * 2;
        const d = 0.2 + r(i + 7) * 0.55;
        const tuft = cone(0.045, tile.terrain === 'fertile' ? 0.2 : 0.14, MAT.leaf(0.08 - r(i) * 0.16),
          Math.cos(a) * d, TILE_HEIGHT + 0.05, Math.sin(a) * d, 4);
        group.add(tuft);
      }
      if (tile.terrain === 'wildlife' && tile.wild > 0) {
        group.add(deer(r(21) * Math.PI * 2));
      }
      break;
    }
    case 'ruins': {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + r(i) * 0.6;
        const d = 0.42;
        const h = 0.35 + r(i + 3) * 0.35;
        const pillar = box(0.14, h, 0.14, MAT.stone(), Math.cos(a) * d, TILE_HEIGHT + h / 2, Math.sin(a) * d);
        pillar.rotation.y = r(i + 8) * 0.5;
        pillar.castShadow = true;
        group.add(pillar);
      }
      const lintel = box(0.5, 0.1, 0.14, MAT.stone(), 0, TILE_HEIGHT + 0.55, -0.42);
      group.add(lintel);
      break;
    }
    case 'mountain':
    case 'iron': {
      for (let i = 0; i < 3; i++) {
        const a = r(i + 11) * Math.PI * 2;
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1 + r(i + 2) * 0.08, 0), MAT.darkStone());
        rock.position.set(Math.cos(a) * 0.5, 0.02, Math.sin(a) * 0.5);
        group.add(rock);
      }
      break;
    }
    case 'lake': {
      for (let i = 0; i < 3; i++) {
        const a = r(i + 13) * Math.PI * 2;
        const reed = cyl(0.012, 0.012, 0.22, MAT.leaf(-0.05),
          Math.cos(a) * 0.55, TILE_HEIGHT * 0.7 + 0.12, Math.sin(a) * 0.55, 4);
        group.add(reed);
      }
      break;
    }
    default: break;
  }
  return group;
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

// ---------------------------------------------------------------- buildings
export function buildBuildingMesh(type, clanColor = '#e09a3a', bannerColor = '#f0b757', done = true) {
  const g = new THREE.Group();
  const cloth = MAT.cloth(clanColor);
  const banner = MAT.cloth(bannerColor);
  const wood = MAT.wood();
  const dark = MAT.darkWood();
  const thatch = MAT.thatch();

  switch (type) {
    case 'townhall': {
      const hall = new THREE.Group();
      hall.add(box(0.86, 0.34, 0.6, wood, 0, 0.17, 0));
      hall.add(gableRoof(0.86, 0.6, 0.34, thatch, 0, 0.34, 0));
      hall.add(box(0.16, 0.24, 0.02, dark, 0, 0.12, 0.31));
      for (const sx of [-1, 1]) {
        const post = cyl(0.035, 0.04, 0.5, dark, sx * 0.5, 0.25, 0, 6);
        hall.add(post);
        const bannerMesh = box(0.16, 0.26, 0.02, banner, sx * 0.5, 0.42, 0.04);
        hall.add(bannerMesh);
      }
      g.add(hall);
      break;
    }
    case 'house':
      g.add(box(0.56, 0.26, 0.42, wood, 0, 0.13, 0));
      g.add(gableRoof(0.56, 0.42, 0.26, thatch, 0, 0.26, 0));
      g.add(box(0.12, 0.18, 0.02, dark, 0, 0.09, 0.22));
      break;
    case 'woodcutter': {
      g.add(box(0.44, 0.22, 0.34, wood, -0.12, 0.11, 0));
      g.add(gableRoof(0.44, 0.34, 0.2, thatch, -0.12, 0.22, 0));
      for (let i = 0; i < 3; i++) {
        const log = cyl(0.045, 0.045, 0.4, dark, 0.3, 0.045 + i * 0.09, -0.05, 6);
        log.rotation.z = Math.PI / 2;
        log.rotation.y = i * 0.2;
        g.add(log);
      }
      g.add(chopBlock(dark, 0.3, 0.02, 0.24));
      break;
    }
    case 'hunter': {
      g.add(box(0.42, 0.2, 0.32, wood, 0, 0.1, 0));
      g.add(gableRoof(0.42, 0.32, 0.18, thatch, 0, 0.2, 0));
      for (let i = 0; i < 3; i++) {
        const p = cyl(0.012, 0.012, 0.22, MAT.wood(), -0.28 + i * 0.05, 0.11, 0.22, 4);
        g.add(p);
      }
      // drying rack with a pelt
      g.add(box(0.3, 0.03, 0.03, dark, 0.12, 0.28, 0.24));
      g.add(box(0.02, 0.28, 0.02, dark, -0.02, 0.14, 0.24));
      g.add(box(0.02, 0.28, 0.02, dark, 0.26, 0.14, 0.24));
      g.add(box(0.2, 0.16, 0.01, MAT.cloth('#a5886a'), 0.12, 0.19, 0.24));
      break;
    }
    case 'farm': {
      const soil = new THREE.MeshStandardMaterial({ color: '#6a5233', roughness: 1, flatShading: true });
      g.add(box(0.8, 0.05, 0.7, soil, 0, 0.03, 0));
      for (let row = -1; row <= 1; row++) {
        g.add(box(0.74, 0.07, 0.07, MAT.leaf(0.16), 0, 0.07, row * 0.2));
      }
      g.add(box(0.12, 0.05, 0.7, MAT.leaf(0.1), 0.4, 0.06, 0));
      g.add(box(0.12, 0.05, 0.7, MAT.leaf(0.1), -0.4, 0.06, 0));
      break;
    }
    case 'fishery': {
      const deck = box(0.6, 0.06, 0.44, wood, 0, 0.14, 0);
      g.add(deck);
      for (const [sx, sz] of [[-0.26, -0.18], [0.26, -0.18], [-0.26, 0.18], [0.26, 0.18]]) {
        g.add(cyl(0.025, 0.03, 0.16, dark, sx, 0.08, sz, 6));
      }
      g.add(box(0.4, 0.2, 0.3, wood, -0.05, 0.28, 0));
      g.add(gableRoof(0.4, 0.3, 0.18, thatch, -0.05, 0.38, 0));
      // little boat + net
      const boat = new THREE.Group();
      const hull = cyl(0.12, 0.06, 0.36, dark, 0, 0.06, 0, 6);
      hull.rotation.z = Math.PI / 2;
      boat.add(hull);
      boat.position.set(0.34, 0.02, 0.16);
      boat.rotation.y = 0.6;
      g.add(boat);
      break;
    }
    case 'mine':
    case 'ironmine': {
      const rockMat = type === 'ironmine' ? MAT.ironOre() : MAT.darkStone();
      const mound = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), rockMat);
      mound.position.set(-0.16, 0.16, -0.06);
      mound.scale.set(1, 0.7, 1);
      mound.castShadow = true;
      g.add(mound);
      g.add(box(0.32, 0.26, 0.06, wood, 0.22, 0.13, 0.2));
      g.add(box(0.1, 0.24, 0.08, dark, 0.22, 0.12, 0.22));
      for (const sx of [-1, 1]) g.add(box(0.05, 0.3, 0.05, dark, 0.22 + sx * 0.16, 0.15, 0.2));
      g.add(box(0.42, 0.05, 0.05, dark, 0.22, 0.3, 0.2));
      if (type === 'ironmine') {
        for (let i = 0; i < 4; i++) {
          const ore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), MAT.ironOre());
          ore.position.set(-0.3 + i * 0.08, 0.05, 0.28 + (i % 2) * 0.08);
          g.add(ore);
        }
      }
      break;
    }
    case 'forge': {
      g.add(box(0.46, 0.24, 0.36, MAT.darkStone(), 0, 0.12, 0));
      g.add(gableRoof(0.46, 0.36, 0.2, MAT.darkWood(), 0, 0.24, 0));
      const chimney = cyl(0.07, 0.09, 0.42, MAT.darkStone(), 0.14, 0.4, -0.08, 6);
      chimney.castShadow = true;
      g.add(chimney);
      const fire = sph(0.07, MAT.ember(), 0.14, 0.62, -0.08, 6);
      g.add(fire);
      g.add(box(0.14, 0.1, 0.1, MAT.metal(), -0.24, 0.06, 0.22));
      g.add(box(0.1, 0.12, 0.1, MAT.wood(), -0.34, 0.06, 0.22));
      break;
    }
    case 'market': {
      for (let s = 0; s < 2; s++) {
        const z = -0.16 + s * 0.32;
        g.add(box(0.5, 0.06, 0.22, wood, 0, 0.14, z));
        for (const sx of [-1, 1]) g.add(cyl(0.02, 0.02, 0.28, dark, sx * 0.22, 0.14, z, 5));
        g.add(box(0.52, 0.04, 0.26, MAT.cloth(s ? '#c9553f' : '#4f7fc0'), 0, 0.3, z));
        g.add(box(0.08, 0.08, 0.08, MAT.gold(), -0.1, 0.2, z));
        g.add(box(0.09, 0.07, 0.09, MAT.leaf(0.1), 0.12, 0.19, z));
      }
      break;
    }
    case 'brewery': {
      g.add(box(0.44, 0.24, 0.36, wood, 0, 0.12, 0));
      g.add(gableRoof(0.44, 0.36, 0.2, thatch, 0, 0.24, 0));
      for (let i = 0; i < 3; i++) {
        const barrel = cyl(0.07, 0.07, 0.18, MAT.wood(), 0.28, 0.09 + (i === 2 ? 0.18 : 0), -0.06 + i * 0.14, 7);
        g.add(barrel);
      }
      g.add(cyl(0.02, 0.02, 0.5, dark, -0.26, 0.25, 0.18, 5));
      g.add(sph(0.06, MAT.gold(), -0.26, 0.5, 0.18, 6));
      break;
    }
    case 'altar': {
      const stoneMat = MAT.stone();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const stone = box(0.1, 0.26 + (i % 3) * 0.06, 0.1, stoneMat,
          Math.cos(a) * 0.42, 0.13, Math.sin(a) * 0.42);
        stone.rotation.y = a;
        stone.castShadow = true;
        g.add(stone);
      }
      g.add(cyl(0.14, 0.16, 0.06, MAT.darkStone(), 0, 0.03, 0, 6));
      const flame = sph(0.09, MAT.ember(), 0, 0.16, 0, 7);
      g.add(flame);
      g.add(sph(0.13, MAT.cloth('#f0d27a'), 0, 0.19, 0, 6));
      break;
    }
    case 'barracks': {
      g.add(box(0.66, 0.3, 0.5, wood, 0, 0.15, 0));
      g.add(gableRoof(0.66, 0.5, 0.28, MAT.darkWood(), 0, 0.3, 0));
      g.add(box(0.14, 0.2, 0.02, dark, 0, 0.1, 0.26));
      // shield wall along the front
      for (let i = 0; i < 4; i++) {
        const shield = cyl(0.07, 0.07, 0.03, MAT.cloth(i % 2 ? clanColor : bannerColor), -0.24 + i * 0.16, 0.14, 0.32, 10);
        shield.rotation.x = Math.PI / 2;
        g.add(shield);
      }
      g.add(cyl(0.02, 0.02, 0.6, dark, 0.34, 0.3, 0.2, 5));
      g.add(box(0.14, 0.24, 0.02, banner, 0.34, 0.52, 0.2));
      break;
    }
    case 'tower': {
      const body = cyl(0.2, 0.26, 0.85, wood, 0, 0.42, 0, 7);
      body.castShadow = true;
      g.add(body);
      g.add(cyl(0.3, 0.28, 0.08, MAT.darkWood(), 0, 0.89, 0, 7));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(box(0.07, 0.12, 0.07, MAT.darkWood(), Math.cos(a) * 0.26, 0.99, Math.sin(a) * 0.26));
      }
      g.add(cone(0.3, 0.24, MAT.thatch(), 0, 1.16, 0, 7));
      g.add(box(0.12, 0.2, 0.02, banner, 0.3, 0.6, 0));
      break;
    }
    case 'tradingpost': {
      g.add(box(0.46, 0.24, 0.36, wood, 0, 0.12, 0));
      g.add(gableRoof(0.46, 0.36, 0.22, thatch, 0, 0.24, 0));
      g.add(box(0.16, 0.16, 0.16, MAT.darkWood(), 0.3, 0.08, -0.18));
      g.add(box(0.14, 0.14, 0.14, MAT.darkWood(), 0.3, 0.08, 0.06));
      g.add(cyl(0.02, 0.02, 0.55, dark, -0.28, 0.28, 0.2, 5));
      g.add(box(0.18, 0.12, 0.02, MAT.cloth('#3f7f8f'), -0.28, 0.44, 0.2));
      break;
    }
    default: {
      g.add(box(0.4, 0.24, 0.36, wood, 0, 0.12, 0));
      g.add(gableRoof(0.4, 0.36, 0.2, thatch, 0, 0.24, 0));
    }
  }

  // clan pennant on everything, so ownership reads at a glance
  const pennant = box(0.1, 0.16, 0.015, banner, 0.32, 0.42, -0.24);
  g.add(pennant);

  if (!done) {
    // scaffolding instead of a finished building
    const scaffoldMat = new THREE.MeshStandardMaterial({
      color: '#c8b48a', transparent: true, opacity: 0.55, roughness: 1, flatShading: true,
    });
    const scaffold = new THREE.Group();
    scaffold.add(box(0.9, 0.02, 0.66, scaffoldMat, 0, 0.02, 0));
    for (const [sx, sz] of [[-0.42, -0.3], [0.42, -0.3], [-0.42, 0.3], [0.42, 0.3]]) {
      scaffold.add(box(0.045, 0.5, 0.045, scaffoldMat, sx, 0.25, sz));
    }
    scaffold.add(box(0.9, 0.04, 0.045, scaffoldMat, 0, 0.42, -0.3));
    scaffold.add(box(0.9, 0.04, 0.045, scaffoldMat, 0, 0.42, 0.3));
    scaffold.name = 'scaffold';
    g.add(scaffold);
  }
  return g;
}

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
