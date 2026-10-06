// ============================================================================
// Northhold — continuous 3D terrain.
//
// The simulation is a hex grid, but the *world* must not look like one. This
// module turns the hex data into a single continuous height field:
//   * `terrainHeightAt(state, x, z)` — the real ground surface, a smooth blend of
//     the neighbouring tiles' elevations plus fBm detail, so slopes are rounded
//     instead of stepped;
//   * `buildTerrainMesh` — one mesh for the whole island (no per-tile prisms),
//     with vertex colours blending grass / dirt / rock / sand / snow and an
//     ambient-occlusion-ish darkening in the hollows;
//   * `buildWaterMesh` — a single animated water surface at the water line;
//   * `buildTerritoryMesh` — a soft, irregular ground wash + glowing frontier
//     instead of hexagonal outlines.
//
// Everything is deterministic and pure (no DOM, no GPU), so the renderer, the
// picking maths and the tests all agree on where the ground is.
// ============================================================================
import * as THREE from '../vendor/three.module.min.js';
import { hexToWorld } from './engine.js';

// ---------------------------------------------------------------- constants
/** Water surface height. Lake beds and the surrounding sea sit below it. */
export const WATER_LEVEL = 0.07;
/** Deepest point of the sea floor / map edge. */
export const BASE_Y = -1.15;
/** How far the terrain extends beyond the outermost tiles (island shore). */
export const SHORE_DROP = 3.4;
/** How far the open sea reaches past the island (the horizon is fogged out). */
export const SEA_MARGIN = 22;
/** Grid resolution of the terrain mesh, in world units. */
export const TERRAIN_STEP = 0.32;

// ---------------------------------------------------------------- noise
function hash2(x, y) {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return v - Math.floor(v);
}

function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const n00 = hash2(xi, yi);
  const n10 = hash2(xi + 1, yi);
  const n01 = hash2(xi, yi + 1);
  const n11 = hash2(xi + 1, yi + 1);
  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
}

export function fbm(x, y, octaves = 3) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

// ---------------------------------------------------------------- hex sampling
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const hexRound = (q, r) => {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
};

/**
 * Flat reference height for a tile: the *base* of the surface before blending
 * and detail. Lakes dip below the water line, mountains rise well above it.
 */
export function tileElevation(tile) {
  if (tile.terrain === 'lake') return WATER_LEVEL - 0.82 + valueNoise(tile.q * 0.7 + 31, tile.r * 0.7 - 12) * 0.16;
  if (tile.terrain === 'mountain' || tile.terrain === 'iron') {
    return 1.05 + valueNoise(tile.q * 0.5 + 40, tile.r * 0.5 - 17) * 0.6;
  }
  return 0.26 + fbm(tile.q * 0.34 + 7, tile.r * 0.34 + 3, 2) * 0.42;
}

/** Tile under a world position (mirrors engine.worldToHex, size 1). */
export function worldToTile(state, x, z) {
  const q = (Math.sqrt(3) / 3) * x - z / 3;
  const r = (2 / 3) * z;
  const { q: rq, r: rr } = hexRound(q, r);
  return state.tileByKey.get(`${rq},${rr}`) || null;
}

/** Nearest tile to a point, even one outside the map (used for the shore). */
function nearestTile(state, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const t of state.tiles) {
    const d = (t.x - x) ** 2 + (t.y - z) ** 2;
    if (d < bestD) { bestD = d; best = t; }
  }
  return best ? { tile: best, dist: Math.sqrt(bestD) } : null;
}

// ---------------------------------------------------------------- height field
// The ground is baked once per game into two regular grids, both of which only
// depend on distance (never on which hex a point happens to belong to), so the
// world stays a single smooth surface with no steps at hex borders:
//   heights - every tile splats a gaussian bump of its own elevation; the sum is
//             normalised, which reads as rounded hills and valleys.
//   shore   - a 1..0 mask that is 1 across the island and fades past the outer
//             ring, letting the coast dive to the sea floor.
export const FIELD_STEP = 0.25;
const FIELD_MARGIN = 7.5;
const FIELD_SIGMA = 1.3;
const FIELD_RANGE = 3.6;
const SHORE_START = 0.9;   // distance from a tile centre where the shore begins
const SHORE_END = 3.4;     // ... and where the ground has reached the sea
const fieldCache = new WeakMap();

const smoothstep = (edge0, edge1, v) => {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export function heightFieldFor(state) {
  const cached = fieldCache.get(state);
  if (cached) return cached;
  const ext = mapExtent(state, FIELD_MARGIN);
  const cols = Math.ceil((ext.maxX - ext.minX) / FIELD_STEP) + 1;
  const rows = Math.ceil((ext.maxZ - ext.minZ) / FIELD_STEP) + 1;
  const cells = cols * rows;
  const acc = new Float32Array(cells);
  const norm = new Float32Array(cells);
  const dist = new Float32Array(cells).fill(Infinity);
  const sigma2 = FIELD_SIGMA * FIELD_SIGMA;
  const floor = Math.exp(-(FIELD_RANGE * FIELD_RANGE) / sigma2);
  const radius = FIELD_RANGE;
  const nearRadius = SHORE_END + 1.4; // plus the coastline wobble
  for (const tile of state.tiles) {
    const e = tileElevation(tile);
    const ci = (tile.x - ext.minX) / FIELD_STEP;
    const cj = (tile.y - ext.minZ) / FIELD_STEP;
    const ri = Math.ceil(radius / FIELD_STEP);
    const rn = Math.ceil(nearRadius / FIELD_STEP);
    for (let dj = -rn; dj <= rn; dj++) {
      const j = Math.round(cj) + dj;
      if (j < 0 || j >= rows) continue;
      const dz = (j - cj) * FIELD_STEP;
      for (let di = -rn; di <= rn; di++) {
        const i = Math.round(ci) + di;
        if (i < 0 || i >= cols) continue;
        const dx = (i - ci) * FIELD_STEP;
        const d2 = dx * dx + dz * dz;
        if (d2 > nearRadius * nearRadius) continue;
        const idx = j * cols + i;
        const d = Math.sqrt(d2);
        if (d < dist[idx]) dist[idx] = d;
        if (Math.abs(di) > ri || Math.abs(dj) > ri) continue;
        const w = Math.exp(-d2 / sigma2) - floor;
        if (w <= 0) continue;
        acc[idx] += w * e;
        norm[idx] += w;
      }
    }
  }
  const heights = new Float32Array(cells).fill(BASE_Y);
  const shore = new Float32Array(cells);
  for (let j = 0; j < rows; j++) {
    const z = ext.minZ + j * FIELD_STEP;
    for (let i = 0; i < cols; i++) {
      const x = ext.minX + i * FIELD_STEP;
      const idx = j * cols + i;
      heights[idx] = norm[idx] > 1e-6 ? acc[idx] / norm[idx] : BASE_Y;
      // Two noise octaves push the coastline out into headlands and pull it back
      // into bays. Biased seaward: the mask must never eat into the outer ring of
      // gameplay tiles, or land would be drawn under water.
      const wobble = (fbm(x * 0.11 + 3, z * 0.11 - 9, 2) - 0.34) * 2.6
        + (fbm(x * 0.31 - 5, z * 0.31 + 2, 2) - 0.5) * 0.8;
      shore[idx] = 1 - smoothstep(SHORE_START, SHORE_END + Math.max(-0.6, wobble), dist[idx]);
    }
  }
  const field = { ext, cols, rows, heights, shore, step: FIELD_STEP };
  fieldCache.set(state, field);
  return field;
}

/** Bilinear sample of one of the baked grids; null outside the field. */
function sampleField(field, grid, x, z) {
  const fx = (x - field.ext.minX) / field.step;
  const fz = (z - field.ext.minZ) / field.step;
  if (fx < 0 || fz < 0 || fx > field.cols - 1 || fz > field.rows - 1) return null;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fz);
  const i1 = Math.min(field.cols - 1, i0 + 1);
  const j1 = Math.min(field.rows - 1, j0 + 1);
  const tx = fx - i0;
  const tz = fz - j0;
  const h00 = grid[j0 * field.cols + i0];
  const h10 = grid[j0 * field.cols + i1];
  const h01 = grid[j1 * field.cols + i0];
  const h11 = grid[j1 * field.cols + i1];
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

/**
 * The world's ground surface at a point, in world units. A tile pins the surface
 * to its own elevation at its centre (so flats, lake beds and ridges sit where
 * the gameplay grid says they do), the gaussian field carries that elevation
 * smoothly between tiles, and the shore mask takes the ground down to the sea
 * floor past the outer ring. Small fBm detail adds rolling ground; building
 * tiles get a flattened pad. Returns null only when the state has no tiles.
 */
export function terrainHeightAt(state, x, z) {
  const field = heightFieldFor(state);
  const blur = sampleField(field, field.heights, x, z);
  if (blur === null) return state.tiles.length ? BASE_Y : null; // open sea
  const shore = sampleField(field, field.shore, x, z);
  const tile = worldToTile(state, x, z);
  let h = blur;
  let centrePin = 0;
  if (tile) {
    const dc = Math.hypot(tile.x - x, tile.y - z);
    centrePin = 1 - smoothstep(0, 0.84, dc);
    const pin = centrePin * shore;
    if (pin > 0) h = h * (1 - pin) + tileElevation(tile) * pin;
  }
  h = h * shore + BASE_Y * (1 - shore);
  // Shoreline meander: the waterline is where the ground crosses the water
  // level, so nudging the ground where tiles *meet* turns hex edges into bays
  // and headlands. Weighted by (1 - centrePin) so tile centres keep their exact
  // elevation and gameplay stays predictable.
  h += (fbm(x * 0.9 + 5, z * 0.9 - 2, 2) - 0.5) * 0.45 * (1 - centrePin) * shore;
  // one amplitude everywhere: the noise must not change with the tile underfoot
  // or the hex borders would show up as tiny creases
  h += (fbm(x * 0.32 + 11, z * 0.32 - 4, 2) - 0.5) * 0.26 * shore;
  if (tile && tile.buildings.length) {
    const d = Math.hypot(tile.x - x, tile.y - z);
    const pad = 1 - smoothstep(0.3, 0.8, d);
    h = h * (1 - pad) + (tileElevation(tile) + 0.02) * pad;
  }
  return h;
}

/** Ground height under a point (kept for units, effects and markers). */
export function elevationAt(state, x, z) {
  return terrainHeightAt(state, x, z) ?? WATER_LEVEL;
}

export function elevationOf(state, tileId) {
  const tile = state.tileById.get(tileId);
  return tile ? tileElevation(tile) : WATER_LEVEL;
}

/** Axis-aligned bounds of the map, padded for the shore. */
export function mapExtent(state, pad = 2.2) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of state.tiles) {
    if (t.x < minX) minX = t.x;
    if (t.x > maxX) maxX = t.x;
    if (t.y < minZ) minZ = t.y;
    if (t.y > maxZ) maxZ = t.y;
  }
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}

/** Signature that changes whenever the terrain surface would change. */
export function terrainSignature(state) {
  let s = `${state.tiles.length}`;
  let built = 0;
  for (const t of state.tiles) built += t.buildings.length * (t.id + 1);
  return `${s}:${built}`;
}

// ---------------------------------------------------------------- palettes
const P = {
  grass: new THREE.Color('#78a053'),
  grassDry: new THREE.Color('#9aa863'),
  forestFloor: new THREE.Color('#4d7440'),
  fertile: new THREE.Color('#96a057'),
  dirt: new THREE.Color('#6b5a41'),
  mud: new THREE.Color('#4d4433'),
  rock: new THREE.Color('#82807a'),
  rockDark: new THREE.Color('#6a6862'),
  sand: new THREE.Color('#c2b189'),
  snow: new THREE.Color('#e8eef5'),
  ore: new THREE.Color('#5a4a44'),
  ruin: new THREE.Color('#6f6552'),
  lakeBed: new THREE.Color('#465463'),
};

function terrainKindColor(kind, out) {
  switch (kind) {
    case 'lake': out.copy(P.lakeBed); break;
    case 'forest': out.copy(P.forestFloor); break;
    case 'fertile': out.copy(P.fertile); break;
    case 'wildlife': out.copy(P.grassDry); break;
    case 'mountain': out.copy(P.rock); break;
    case 'iron': out.copy(P.ore); break;
    case 'ruins': out.copy(P.ruin); break;
    default: out.copy(P.grass); break;
  }
  return out;
}

// ---------------------------------------------------------------- detail textures
const texCache = new Map();

function noiseTexture(size, opts = {}) {
  const key = `${size}|${opts.seed || 1}|${opts.contrast || 1}|${opts.tint || ''}|${opts.grain || ''}`;
  if (texCache.has(key)) return texCache.get(key);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let v = 0.5;
      let amp = 0.5;
      let freq = 1 / size;
      for (let o = 0; o < 4; o++) {
        v += (valueNoise(x * freq * size * 0.5 + (opts.seed || 0) * 13, y * freq * size * 0.5 + (opts.seed || 0) * 7) - 0.5) * amp;
        amp *= 0.55;
        freq *= 2.1;
      }
      if (opts.grain) v += (hash2(x * 3.1 + (opts.seed || 0), y * 1.7) - 0.5) * opts.grain;
      v = 0.5 + (v - 0.5) * (opts.contrast || 1);
      const c = Math.max(0, Math.min(1, v));
      const g = Math.round(150 + c * 105);
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  texCache.set(key, tex);
  return tex;
}

/** Subtle grainy detail for terrain materials (tiled). */
export function groundDetailTexture() {
  const tex = noiseTexture(128, { seed: 3, contrast: 0.55, grain: 0.3, base: 178 });
  tex.repeat.set(42, 42);
  return tex;
}

/** Ripple pattern for the water surface (scrolled at runtime). */
export function waterTexture() {
  const tex = noiseTexture(96, { seed: 9, contrast: 0.7, grain: 0.15, base: 205 });
  tex.repeat.set(12, 12);
  return tex;
}

/** Stone grain for rocks. */
export function rockTexture() {
  const tex = noiseTexture(96, { seed: 17, contrast: 0.7, grain: 0.45, base: 186 });
  tex.repeat.set(3, 3);
  return tex;
}

// ---------------------------------------------------------------- terrain mesh
/**
 * One continuous mesh for the whole island. Vertex colours carry the material
 * blend (grass → dirt → rock → sand → snow) so there is no per-tile flat fill.
 */
export function buildTerrainMesh(state, { pad = 3.6 } = {}) {
  const ext = mapExtent(state, pad);
  const cols = Math.ceil((ext.maxX - ext.minX) / TERRAIN_STEP) + 1;
  const rows = Math.ceil((ext.maxZ - ext.minZ) / TERRAIN_STEP) + 1;
  const count = cols * rows;
  const heights = new Float32Array(count);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      const x = ext.minX + i * TERRAIN_STEP;
      const z = ext.minZ + j * TERRAIN_STEP;
      const h = terrainHeightAt(state, x, z) ?? BASE_Y;
      heights[idx] = h;
      pos[idx * 3] = x;
      pos[idx * 3 + 1] = h;
      pos[idx * 3 + 2] = z;
      uv[idx * 2] = x / 6;
      uv[idx * 2 + 1] = z / 6;
    }
  }

  // normals from the height grid (central differences) → slope + shading + AO
  const normal = new Float32Array(count * 3);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      const hl = heights[j * cols + Math.max(0, i - 1)];
      const hr = heights[j * cols + Math.min(cols - 1, i + 1)];
      const hd = heights[Math.max(0, j - 1) * cols + i];
      const hu = heights[Math.min(rows - 1, j + 1) * cols + i];
      const nx = (hl - hr) / (2 * TERRAIN_STEP);
      const nz = (hd - hu) / (2 * TERRAIN_STEP);
      const len = Math.hypot(nx, 1, nz);
      normal[idx * 3] = nx / len;
      normal[idx * 3 + 1] = 1 / len;
      normal[idx * 3 + 2] = nz / len;
    }
  }

  const colors = new Float32Array(count * 3);
  const tmp = new THREE.Color();
  const tmp2 = new THREE.Color();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      const x = ext.minX + i * TERRAIN_STEP;
      const z = ext.minZ + j * TERRAIN_STEP;
      const h = heights[idx];
      // blended terrain kind around this point (same kernel as the height field)
      tmp.setRGB(0, 0, 0);
      let wsum = 0;
      const self = worldToTile(state, x, z);
      const cands = self ? [self] : [];
      if (self) {
        for (const [dq, dr] of DIRS) {
          const n = state.tileByKey.get(`${self.q + dq},${self.r + dr}`);
          if (n) cands.push(n);
        }
      } else {
        const near = nearestTile(state, x, z);
        if (near) cands.push(near.tile);
      }
      for (const t of cands) {
        const d = Math.hypot(t.x - x, t.y - z);
        const w = (t === self ? 1 / 0.25 : 1 / (0.25 + d ** 3)) * (self ? 1 : 1 / (1 + d));
        terrainKindColor(t.terrain, tmp2);
        tmp.r += tmp2.r * w;
        tmp.g += tmp2.g * w;
        tmp.b += tmp2.b * w;
        wsum += w;
      }
      if (wsum > 0) { tmp.r /= wsum; tmp.g /= wsum; tmp.b /= wsum; }

      // slope → exposed rock; hollows → dirt; low ground near water → sand
      const slope = 1 - normal[idx * 3 + 1];
      const rockMix = Math.min(1, Math.max(0, (slope - 0.22) / 0.5));
      tmp.lerp(P.rockDark, rockMix * 0.7);

      const wetness = 1 - Math.min(1, Math.max(0, (h - WATER_LEVEL) / 0.3));
      tmp.lerp(P.sand, wetness * 0.6);
      tmp.lerp(P.mud, Math.max(0, rockMix) * 0.06);

      // patchy variation so large areas are never one flat colour
      const patch = fbm(x * 0.55 + 21, z * 0.55 - 8, 3);
      const fine = fbm(x * 2.6 - 3, z * 2.6 + 6, 2);
      tmp.offsetHSL((patch - 0.5) * 0.03, (patch - 0.5) * 0.2, (patch - 0.5) * 0.13 + (fine - 0.5) * 0.06);

      // grass accent on gentle land, dirt on worn parts
      if (h > WATER_LEVEL + 0.3 && slope < 0.3) {
        tmp.lerp(P.grass, (patch - 0.35) * 0.25);
      }

      // high ground catches snow
      const snowMix = Math.min(1, Math.max(0, (h - 1.22) / 0.45));
      tmp.lerp(P.snow, snowMix * 0.7);

      // ambient occlusion: darken hollows and the foot of cliffs
      let hollow = 0;
      for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = Math.min(cols - 1, Math.max(0, i + dq));
        const nj = Math.min(rows - 1, Math.max(0, j + dr));
        hollow += Math.max(0, heights[nj * cols + ni] - h);
      }
      const ao = 1 - Math.min(0.38, hollow * 0.16);
      tmp.multiplyScalar(ao);

      colors[idx * 3] = tmp.r;
      colors[idx * 3 + 1] = tmp.g;
      colors[idx * 3 + 2] = tmp.b;
    }
  }

  const index = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: groundDetailTexture(),
    roughness: 0.96,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.baseColor = mat.color.clone();
  return mesh;
}

// ---------------------------------------------------------------- water
/** One animated water surface for the whole island and the surrounding sea. */
export function buildWaterMesh(state, { sea = SEA_MARGIN } = {}) {
  const ext = mapExtent(state, 2.2 + sea);
  const w = ext.maxX - ext.minX;
  const d = ext.maxZ - ext.minZ;
  const geo = new THREE.PlaneGeometry(w, d, Math.ceil(w / 2.5), Math.ceil(d / 2.5));
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: '#3f87ab',
    map: waterTexture(),
    transparent: true,
    opacity: 0.76,
    roughness: 0.08,
    metalness: 0.18,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.position.set((ext.minX + ext.maxX) / 2, WATER_LEVEL, (ext.minZ + ext.maxZ) / 2);
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * The sea bed, draped over the same height field as the island so the shore
 * shelf slopes away into deep water. Coloured by depth: warm sand in the
 * shallows, cold slate far out. Without it the translucent water would blend
 * against the sky and the world would end in a visible seam.
 */
export function buildSeaFloorMesh(state, { sea = SEA_MARGIN } = {}) {
  const ext = mapExtent(state, 2.2 + sea);
  const step = 2.2;
  const cols = Math.ceil((ext.maxX - ext.minX) / step) + 1;
  const rows = Math.ceil((ext.maxZ - ext.minZ) / step) + 1;
  const pos = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  const shallow = new THREE.Color('#a9ac8a');
  const deep = new THREE.Color('#55798c');
  const tmp = new THREE.Color();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = ext.minX + i * step;
      const z = ext.minZ + j * step;
      const idx = j * cols + i;
      const h = Math.max(BASE_Y, Math.min(WATER_LEVEL - 0.02, terrainHeightAt(state, x, z) ?? BASE_Y));
      pos[idx * 3] = x;
      pos[idx * 3 + 1] = h;
      pos[idx * 3 + 2] = z;
      const depth = Math.min(1, Math.max(0, (WATER_LEVEL - h) / 1.1));
      tmp.lerpColors(shallow, deep, Math.pow(depth, 0.7));
      colors[idx * 3] = tmp.r;
      colors[idx * 3 + 1] = tmp.g;
      colors[idx * 3 + 2] = tmp.b;
    }
  }
  const index = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'seafloor';
  return mesh;
}

// ---------------------------------------------------------------- territory
export function ownershipSignature(state) {
  let s = '';
  for (const t of state.tiles) s += t.owner == null ? '.' : t.owner;
  return s;
}

/**
 * Territory as a geographic region: a soft ground wash that follows the terrain,
 * fading out at the frontier, with a brighter rim where two realms meet. No hex
 * outlines anywhere.
 */
export function buildTerritoryMesh(state) {
  const owned = state.tiles.filter((t) => t.owner != null);
  if (!owned.length) return null;
  const ext = mapExtent(state, 1.4);
  const step = TERRAIN_STEP * 1.15;
  const cols = Math.ceil((ext.maxX - ext.minX) / step) + 1;
  const rows = Math.ceil((ext.maxZ - ext.minZ) / step) + 1;
  const pos = [];
  const col = [];
  const index = [];
  const grid = new Int32Array(cols * rows).fill(-1);
  const weights = new Float32Array(cols * rows * state.clans.length);
  const tint = new Float32Array(cols * rows * 3);
  const alpha = new Float32Array(cols * rows);

  // clan colours are desaturated for the ground wash: the realm should read as a
  // tinted region, never as a painted hex or a saturated blob
  const clanColors = state.clans.map((c) => new THREE.Color(c.color).offsetHSL(0.02, -0.45, 0.1));
  const glow = new THREE.Color('#cfe9ff');

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const gi = j * cols + i;
      const x = ext.minX + i * step;
      const z = ext.minZ + j * step;
      const self = worldToTile(state, x, z);
      const h = terrainHeightAt(state, x, z);
      if (h == null) continue;
      pos.push(x, h + 0.025, z);
      grid[gi] = pos.length / 3 - 1;

      // blend tile ownership with the same kernel the height field uses, so the
      // region edge follows the terrain instead of the hex lattice
      const cands = self ? [self] : [nearestTile(state, x, z)?.tile].filter(Boolean);
      if (self) {
        for (const [dq, dr] of DIRS) {
          const n = state.tileByKey.get(`${self.q + dq},${self.r + dr}`);
          if (n) cands.push(n);
        }
      }
      let total = 0;
      for (const t of cands) {
        const d = Math.hypot(t.x - x, t.y - z);
        const w = (t === self ? 1 / 0.25 : 1 / (0.25 + d ** 3));
        if (t.owner != null) {
          weights[gi * state.clans.length + t.owner] += w;
          total += w;
        }
      }
      if (total <= 0) {
        alpha[gi] = 0;
        col.push(0, 0, 0);        // no tint; alpha 0 keeps it invisible
        continue;
      }
      for (let c = 0; c < state.clans.length; c++) weights[gi * state.clans.length + c] /= total;
      let best = 0;
      let bestW = 0;
      let second = 0;
      for (let c = 0; c < state.clans.length; c++) {
        const w = weights[gi * state.clans.length + c];
        if (w > bestW) { second = bestW; bestW = w; best = c; } else if (w > second) second = w;
      }
      const c3 = clanColors[best];
      tint[gi * 3] = c3.r;
      tint[gi * 3 + 1] = c3.g;
      tint[gi * 3 + 2] = c3.b;
      // the frontier is where the leading realm is only just ahead
      const frontier = Math.max(0, 1 - (bestW - second) * 2.6);
      const col3 = c3.clone().lerp(glow, frontier * 0.3);
      col.push(col3.r, col3.g, col3.b);
      // alpha: soft wash inside the realm, brighter rim at the frontier
      const reach = Math.min(1, bestW / 0.62);
      alpha[gi] = 0.075 * reach + 0.2 * frontier * reach;
    }
  }
  if (!pos.length) return null;

  // indexed quads for every cell whose corners all exist
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = grid[j * cols + i];
      const b = grid[j * cols + i + 1];
      const c = grid[(j + 1) * cols + i];
      const d = grid[(j + 1) * cols + i + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      if (alpha[j * cols + i] + alpha[j * cols + i + 1] + alpha[(j + 1) * cols + i] + alpha[(j + 1) * cols + i + 1] <= 0.02) continue;
      index.push(a, c, b, b, c, d);
    }
  }
  if (!index.length) return null;

  // 4-component vertex colours carry the per-vertex alpha (three.js USE_COLOR_ALPHA)
  const colour4 = new Float32Array((pos.length / 3) * 4);
  for (let v = 0; v < pos.length / 3; v++) {
    colour4[v * 4] = col[v * 3];
    colour4[v * 4 + 1] = col[v * 3 + 1];
    colour4[v * 4 + 2] = col[v * 3 + 2];
    colour4[v * 4 + 3] = alpha[v];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colour4, 4));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'territory';
  mesh.renderOrder = 2;
  return mesh;
}

/**
 * Bend an existing geometry (a hex ring, a marker quad) so its vertices follow
 * the terrain surface. `worldX/worldZ` is where the mesh will be positioned.
 */
export function drapeGeometry(state, geometry, worldX, worldZ, offset = 0.02) {
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + worldX;
    const z = pos.getZ(i) + worldZ;
    pos.setY(i, (terrainHeightAt(state, x, z) ?? WATER_LEVEL) + offset);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Small helper used by the renderer: nearest tile distance for shore effects. */
export function distanceToMapCenter(state, x, z) {
  return Math.hypot(x, z);
}

export { hexToWorld };
