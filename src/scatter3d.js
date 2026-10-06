// ============================================================================
// Northhold — natural scatter.
//
// The hex grid is a *gameplay* structure; the world must not show it. This
// module decides where vegetation, rocks and resource props go, with clustered,
// deterministic, tile-seeded placement that deliberately spills across tile
// borders so forests read as continuous woodland rather than one clump per cell.
//
// Placement is pure data (no three.js objects), so the renderer can feed it
// straight into InstancedMeshes and the tests can assert on it.
// ============================================================================
import { HEX_RADIUS } from './models3d.js';

/** Deterministic 0..1 noise from a few integers. */
function rng(...seeds) {
  let h = 2166136261;
  for (const s of seeds) {
    h ^= Math.floor(s * 1000) | 0;
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const pick = (list, r) => list[Math.min(list.length - 1, Math.floor(r * list.length))];

/** Tile centres that carry a building (or belong to a built-up tile). */
function builtTiles(state) {
  const set = new Set();
  for (const t of state.tiles) if (t.buildings.length) set.add(t.id);
  return set;
}

function tooCloseToBuilding(state, x, z, radius = 0.62) {
  for (const t of state.tiles) {
    if (!t.buildings.length) continue;
    if (Math.hypot(t.x - x, t.y - z) < radius) return true;
  }
  return false;
}

/**
 * Cluster centres inside (and slightly beyond) a tile: 1-3 clumps, biased away
 * from the tile centre so the woods look like they grew, not like a stamp.
 */
function clusters(tile, count, seed) {
  const out = [];
  for (let c = 0; c < count; c++) {
    const a = rng(tile.id, c, seed, 1) * Math.PI * 2;
    const d = 0.25 + rng(tile.id, c, seed, 2) * 0.85;
    out.push({ x: tile.x + Math.cos(a) * d, z: tile.y + Math.sin(a) * d, spread: 0.32 + rng(tile.id, c, seed, 3) * 0.34 });
  }
  return out;
}

const TERRAIN_SCATTER = {
  forest: { clusters: 2, perCluster: [4, 6], kinds: ['pine', 'fir', 'broadleaf', 'birch'], weights: [0.45, 0.3, 0.2, 0.05] },
  wildlife: { clusters: 2, perCluster: [1, 3], kinds: ['broadleaf', 'birch', 'pine'], weights: [0.5, 0.3, 0.2] },
  fertile: { clusters: 1, perCluster: [1, 3], kinds: ['broadleaf', 'birch'], weights: [0.6, 0.4] },
  plains: { clusters: 1, perCluster: [0, 1], kinds: ['pine', 'birch', 'broadleaf'], weights: [0.4, 0.3, 0.3] },
  ruins: { clusters: 1, perCluster: [1, 2], kinds: ['pine'], weights: [1] },
  mountain: { clusters: 2, perCluster: [1, 3], kinds: ['fir'], weights: [1] },
  iron: { clusters: 1, perCluster: [1, 2], kinds: ['fir'], weights: [1] },
};

function weightedKind(spec, r) {
  let acc = 0;
  for (let i = 0; i < spec.kinds.length; i++) {
    acc += spec.weights[i];
    if (r <= acc) return spec.kinds[i];
  }
  return spec.kinds[spec.kinds.length - 1];
}

/**
 * Everything the world scatters on its own: forests, rock formations, ore,
 * ruins and farm/log props. Deterministic for a given state.
 */
export function buildScatter(state) {
  const trees = [];
  const rocks = [];
  const ore = [];
  const ruins = [];
  const props = [];
  const animals = [];
  const built = builtTiles(state);

  for (const tile of state.tiles) {
    // ---- vegetation
    const spec = TERRAIN_SCATTER[tile.terrain];
    if (spec) {
      const clumps = clusters(tile, spec.clusters, 17);
      for (let c = 0; c < clumps.length; c++) {
        const clump = clumps[c];
        const n = Math.round(spec.perCluster[0] + rng(tile.id, c, 5) * (spec.perCluster[1] - spec.perCluster[0]));
        for (let i = 0; i < n; i++) {
          const a = rng(tile.id, c, i, 7) * Math.PI * 2;
          const d = Math.sqrt(rng(tile.id, c, i, 8)) * clump.spread;
          const x = clump.x + Math.cos(a) * d;
          const z = clump.z + Math.sin(a) * d;
          if (Math.hypot(x - tile.x, z - tile.y) > HEX_RADIUS * 1.25) continue;   // stay near the tile
          if (tooCloseToBuilding(state, x, z)) continue;
          const kind = weightedKind(spec, rng(tile.id, c, i, 9));
          trees.push({
            kind,
            x,
            z,
            rot: rng(tile.id, c, i, 10) * Math.PI * 2,
            scale: 0.42 + rng(tile.id, c, i, 11) * 0.42,
            tileId: tile.id,
          });
          // saplings sprout next to a parent tree: woodland regeneration, and it
          // keeps the canopy reading as clumps instead of evenly spaced dots
          if (rng(tile.id, c, i, 12) < 0.45) {
            const sa = rng(tile.id, c, i, 13) * Math.PI * 2;
            const sd = 0.14 + rng(tile.id, c, i, 14) * 0.18;
            const sx = x + Math.cos(sa) * sd;
            const sz = z + Math.sin(sa) * sd;
            if (Math.hypot(sx - tile.x, sz - tile.y) <= HEX_RADIUS * 1.25 && !tooCloseToBuilding(state, sx, sz)) {
              trees.push({
                kind,
                x: sx,
                z: sz,
                rot: rng(tile.id, c, i, 15) * Math.PI * 2,
                scale: 0.22 + rng(tile.id, c, i, 16) * 0.2,
                tileId: tile.id,
              });
            }
          }
        }
      }
    }

    // ---- rocky ground
    if (tile.terrain === 'mountain' || tile.terrain === 'iron') {
      const n = tile.terrain === 'mountain' ? 3 + Math.round(rng(tile.id, 21) * 3) : 2 + Math.round(rng(tile.id, 22) * 2);
      for (let i = 0; i < n; i++) {
        const a = rng(tile.id, i, 23) * Math.PI * 2;
        const d = 0.15 + rng(tile.id, i, 24) * 0.7;
        rocks.push({
          kind: rng(tile.id, i, 25) > 0.55 ? 'crag' : rng(tile.id, i, 26) > 0.5 ? 'boulder' : 'slab',
          x: tile.x + Math.cos(a) * d,
          z: tile.y + Math.sin(a) * d,
          rot: rng(tile.id, i, 27) * Math.PI * 2,
          scale: 0.6 + rng(tile.id, i, 28) * 0.8,
          tileId: tile.id,
        });
      }
      if (tile.depositKind === 'stone' && tile.depositMax > 0) {
        rocks.push({ kind: 'boulder', x: tile.x, z: tile.y + 0.35, rot: rng(tile.id, 31) * 3, scale: 1.15, tileId: tile.id });
      }
    }
    // iron reads as dark ore-bearing rock, not as a marker on the ground
    if (tile.depositKind === 'iron' && tile.depositMax > 0) {
      ore.push({ x: tile.x, z: tile.y, rot: rng(tile.id, 32) * Math.PI * 2, scale: 1, tileId: tile.id });
    }
    // boulders on broken ground anywhere on the island
    if (tile.terrain !== 'lake' && tile.terrain !== 'mountain' && tile.terrain !== 'iron') {
      const n = rng(tile.id, 33) < 0.16 ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const a = rng(tile.id, i, 35) * Math.PI * 2;
        const d = 0.2 + rng(tile.id, i, 36) * 0.6;
        const x = tile.x + Math.cos(a) * d;
        const z = tile.y + Math.sin(a) * d;
        if (tooCloseToBuilding(state, x, z)) continue;
        rocks.push({
          kind: rng(tile.id, i, 37) > 0.5 ? 'slab' : 'boulder',
          x, z,
          rot: rng(tile.id, i, 38) * Math.PI * 2,
          scale: 0.34 + rng(tile.id, i, 39) * 0.4,
          tileId: tile.id,
        });
      }
    }

    // ---- ruins
    if (tile.terrain === 'ruins') {
      const n = 3 + Math.round(rng(tile.id, 41) * 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng(tile.id, i, 42) * 0.5;
        const d = 0.3 + rng(tile.id, i, 43) * 0.42;
        ruins.push({
          kind: pick(['pillar', 'wall', 'rubble', 'rubble'], rng(tile.id, i, 44)),
          x: tile.x + Math.cos(a) * d,
          z: tile.y + Math.sin(a) * d,
          rot: rng(tile.id, i, 45) * Math.PI * 2,
          scale: 0.85 + rng(tile.id, i, 46) * 0.4,
          tileId: tile.id,
        });
      }
    }

    // ---- wildlife
    if (tile.terrain === 'wildlife' && tile.wild > 0) {
      animals.push({ x: tile.x + (rng(tile.id, 51) - 0.5) * 0.7, z: tile.y + (rng(tile.id, 52) - 0.5) * 0.7,
        rot: rng(tile.id, 53) * Math.PI * 2, tileId: tile.id });
    }
  }

  // ---- what the clan has put on the land
  for (const tile of state.tiles) {
    for (const b of tile.buildings) {
      if (b.type === 'farm') {
        props.push({ kind: 'farm', x: tile.x + 0.15, z: tile.y + 0.2, rot: rng(b.id, 61) * 0.5, scale: 1, tileId: tile.id });
      } else if (b.type === 'woodcutter' && b.done) {
        props.push({ kind: 'logs', x: tile.x + 0.55, z: tile.y - 0.35, rot: rng(b.id, 62) * Math.PI * 2, scale: 1, tileId: tile.id });
      }
    }
  }

  return { trees, rocks, ore, ruins, props, animals, built };
}

/** Changes whenever the scatter should be rebuilt (buildings coming and going). */
export function scatterSignature(state) {
  let s = `${state.tiles.length}`;
  for (const t of state.tiles) s += `|${t.id}:${t.buildings.length}:${t.depositMax > 0 ? 1 : 0}`;
  return s;
}

/** Group placements per variant kind so the renderer can use one InstancedMesh each. */
export function groupByKind(list) {
  const groups = new Map();
  for (const item of list) {
    if (!groups.has(item.kind)) groups.set(item.kind, []);
    groups.get(item.kind).push(item);
  }
  return groups;
}
