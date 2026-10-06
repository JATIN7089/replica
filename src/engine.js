// ============================================================================
// Northhold — game engine. Pure logic, no DOM. Safe to run in Node.
// ============================================================================
import {
  MONTH_SECONDS, SEASONS, MONTHS_PER_SEASON, YEAR_MONTHS, TIMEOUT_YEARS,
  TERRAIN, COLONIZE_COST, TERRAIN_COLONIZE_EXTRA, BUILDINGS_PER_TILE,
  BUILDINGS, BUILD_ORDER, UNITS, TRAINABLE, BASE_WARBAND_CAP, WARCHIEF_FAME,
  CLANS, AI_COLOR, AI_BANNER, AI_NAMES, DIFFICULTY, START_RESOURCES,
  FOOD_PER_CIV, KROWN_UPKEEP, BUILD_SPAWN_SECONDS, STARVE_GRACE,
  VICTORY, BLESSINGS, BLESSING_IDS, BLESSING_COST, MAX_BLESSINGS,
} from './data.js';

export const MAP_RADIUS = 5;
const SPEED_UNIT = Math.sqrt(3); // distance between neighbouring tile centres
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// --- RNG --------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  const fn = function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // snapshot/restore let a saved game resume the exact same timeline
  fn.snapshot = () => a;
  fn.restore = (value) => { a = (value >>> 0); };
  return fn;
}
export function pick(arr, rng) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
export function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- Hex helpers ------------------------------------------------------------
export const hexKey = (q, r) => q + ',' + r;
export function hexDist(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}
export function hexToWorld(q, r, size = 1) {
  return { x: size * Math.sqrt(3) * (q + r / 2), y: size * 1.5 * r };
}
export function worldToHex(x, y, size = 1) {
  const q = (Math.sqrt(3) / 3 * x - y / 3) / size;
  const r = (2 / 3 * y) / size;
  return hexRound(q, r);
}
function hexRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}
export function neighborsOf(tile, state) {
  const out = [];
  for (const [dq, dr] of DIRS) {
    const t = state.tileByKey.get(hexKey(tile.q + dq, tile.r + dr));
    if (t) out.push(t);
  }
  return out;
}
export function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    pts.push([cx + size * Math.cos(a), cy + size * Math.sin(a)]);
  }
  return pts;
}

// --- Map generation ---------------------------------------------------------
function createTile(id, q, r) {
  const w = hexToWorld(q, r, 1);
  return {
    id, q, r, x: w.x, y: w.y,
    terrain: 'plains', owner: null, buildings: [],
    deposit: 0, depositMax: 0, ruinLooted: false, wild: 0,
    captureClan: null, captureProgress: 0, exploreProgress: 0,
  };
}

function generateMap(rng) {
  const tiles = [];
  const tileByKey = new Map();
  let id = 0;
  for (let q = -MAP_RADIUS; q <= MAP_RADIUS; q++) {
    for (let r = Math.max(-MAP_RADIUS, -q - MAP_RADIUS); r <= Math.min(MAP_RADIUS, -q + MAP_RADIUS); r++) {
      const t = createTile(id++, q, r);
      tiles.push(t);
      tileByKey.set(hexKey(q, r), t);
    }
  }
  const starts = [
    tileByKey.get(hexKey(-MAP_RADIUS + 1, 0)),
    tileByKey.get(hexKey(MAP_RADIUS - 1, 0)),
  ];
  const tileAt = (q, r) => tileByKey.get(hexKey(q, r));
  const startDist = (t) => Math.min(hexDist(t, starts[0]), hexDist(t, starts[1]));

  // grow a blob of terrain from a start tile
  const blobOnce = (startTile, size, terrain, skipStarts) => {
    const frontier = [startTile];
    const seen = new Set([startTile.id]);
    let placed = 0;
    const overwritable = (t) => t.terrain === 'plains' || t.terrain === 'wildlife';
    while (frontier.length && placed < size) {
      const i = Math.floor(rng() * frontier.length);
      const t = frontier.splice(i, 1)[0];
      if (startDist(t) < skipStarts || !overwritable(t)) continue;
      t.terrain = terrain;
      placed++;
      for (const [dq, dr] of shuffled(DIRS, rng)) {
        const n = tileAt(t.q + dq, t.r + dr);
        if (n && !seen.has(n.id)) { seen.add(n.id); frontier.push(n); }
      }
    }
    return placed;
  };
  // keeps the map varied but guarantees every terrain actually appears
  const blob = (startTile, size, terrain, { skipStarts = 2 } = {}) => {
    let placed = blobOnce(startTile, size, terrain, skipStarts);
    if (placed < Math.min(2, size)) placed += blobOnce(randomTileRaw(0), size, terrain, 1);
    if (placed < Math.min(2, size)) blobOnce(randomTileRaw(0), size, terrain, 0);
  };
  const randomTileRaw = (minStartDist) => {
    for (let i = 0; i < 200; i++) {
      const t = tiles[Math.floor(rng() * tiles.length)];
      if (t && startDist(t) >= minStartDist && t.terrain === 'plains') return t;
    }
    return tiles[Math.floor(rng() * tiles.length)];
  };
  const randomTile = (minStartDist = 1) => {
    for (let i = 0; i < 200; i++) {
      const t = tiles[Math.floor(rng() * tiles.length)];
      if (startDist(t) >= minStartDist) return t;
    }
    return tiles[Math.floor(tiles.length / 2)];
  };

  // Lakes (impassable, fishery)
  blob(randomTile(3), 5, 'lake', { skipStarts: 2 });
  blob(randomTile(3), 4, 'lake', { skipStarts: 2 });
  // Mountains + iron
  const mtn = randomTile(2);
  blob(mtn, 5, 'mountain', { skipStarts: 2 });
  for (const n of neighborsOf(mtn, { tileByKey })) {
    if (n.terrain === 'mountain' && rng() < 0.55) n.terrain = 'iron';
  }
  // Forests
  blob(randomTile(2), 9, 'forest', { skipStarts: 1 });
  blob(randomTile(2), 7, 'forest', { skipStarts: 1 });
  blob(randomTile(2), 6, 'forest', { skipStarts: 1 });
  // Fertile land
  blob(randomTile(2), 4, 'fertile', { skipStarts: 2 });
  blob(randomTile(2), 5, 'fertile', { skipStarts: 2 });
  // Wildlands
  blob(randomTile(2), 3, 'wildlife', { skipStarts: 2 });
  blob(randomTile(2), 2, 'wildlife', { skipStarts: 2 });

  // Ruins
  for (let i = 0; i < 4; i++) {
    const t = randomTile(2);
    if (t.terrain === 'plains' || t.terrain === 'wildlife' || t.terrain === 'forest') t.terrain = 'ruins';
  }

  // Guarantee each start has wood/food nearby and is solid ground
  for (const s of starts) {
    s.terrain = 'plains';
    const ring = shuffled(neighborsOf(s, { tileByKey }), rng);
    for (const n of ring) if (n.terrain === 'lake' || n.terrain === 'ruins') n.terrain = 'plains';
    // guarantee two forest tiles and one fertile tile around every start
    let forests = ring.filter((n) => n.terrain === 'forest').length;
    for (const n of ring) {
      if (forests >= 2) break;
      if (n.terrain === 'plains' || n.terrain === 'wildlife') { n.terrain = 'forest'; forests++; }
    }
    if (!ring.some((n) => n.terrain === 'fertile')) {
      const spot = ring.find((n) => n.terrain === 'plains' || n.terrain === 'forest' || n.terrain === 'wildlife');
      if (spot) spot.terrain = 'fertile';
    }
  }

  // Fair access to stone, iron and water: every start gets them within a short march.
  const plainish = (t) => t.terrain === 'plains' || t.terrain === 'forest' || t.terrain === 'wildlife';
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const other = starts[1 - i];
    const farFromOther = (a, b) => hexDist(b, other) - hexDist(a, other);
    // 1. stone: a mountain within 3 tiles
    if (!tiles.some((t) => t.terrain === 'mountain' && hexDist(t, s) <= 3)) {
      const cand = tiles
        .filter((t) => [2, 3].includes(hexDist(t, s)) && plainish(t))
        .sort((a, b) => farFromOther(a, b))[0];
      if (cand) { cand.terrain = 'mountain'; cand.deposit = 'stone'; }
    }
    // 2. iron: a second mountain (never eat the only stone source)
    if (!tiles.some((t) => t.terrain === 'iron' && hexDist(t, s) <= 4)) {
      const mountains = tiles
        .filter((t) => t.terrain === 'mountain' && hexDist(t, s) <= 4)
        .sort((a, b) => hexDist(a, s) - hexDist(b, s));
      if (mountains.length >= 2) {
        mountains[mountains.length - 1].terrain = 'iron';
        mountains[mountains.length - 1].deposit = 'iron';
      } else {
        const cand = tiles
          .filter((t) => [3, 4].includes(hexDist(t, s)) && plainish(t))
          .sort((a, b) => farFromOther(a, b))[0];
        if (cand) { cand.terrain = 'iron'; cand.deposit = 'iron'; }
      }
    }
    // 3. water: a lake within 3 tiles for fisheries
    if (!tiles.some((t) => t.terrain === 'lake' && hexDist(t, s) <= 3)) {
      const cand = tiles
        .filter((t) => hexDist(t, s) === 3 && plainish(t))
        .sort((a, b) => farFromOther(a, b))[0];
      if (cand) cand.terrain = 'lake';
    }
  }

  // Deposits & wildlife decorations
  for (const t of tiles) {
    if (t.terrain === 'mountain') { t.deposit = 'stone'; t.depositMax = 200 + Math.floor(rng() * 120); }
    if (t.terrain === 'iron') { t.deposit = 'iron'; t.depositMax = 120 + Math.floor(rng() * 80); }
    if (t.terrain === 'wildlife') t.wild = 2 + Math.floor(rng() * 2);
    if (t.terrain === 'forest' && rng() < 0.35) t.wild = 1;
  }
  return { tiles, tileByKey, starts };
}

// --- Clan state -------------------------------------------------------------
function createClan(state, id, clanId, isAI) {
  const base = CLANS[clanId];
  const diff = DIFFICULTY[state.difficulty];
  return {
    id, clanId, isAI,
    name: isAI ? AI_NAMES[clanId] : base.name,
    color: isAI ? AI_COLOR : base.color,
    banner: isAI ? AI_BANNER : base.banner,
    res: { ...START_RESOURCES },
    totalKrowns: 0,
    fame: 0,
    happiness: 60,
    villagers: { idle: 3 },
    training: [],
    blessings: [],
    pendingBlessing: null,
    smithBonus: 0,
    starveTimer: 0,
    growth: 0,
    prodMul: isAI ? diff.prod : 1,
    dead: false,
    ai: { timer: 2, mode: 'build', targetTile: null, rallyTile: null },
  };
}

export function recomputeMods(state, clan) {
  const base = CLANS[clan.clanId];
  const m = {
    food: 1, wood: 1, krown: 1, stone: 1, iron: 1, lore: 1,
    warriorDmg: 1, warriorHp: 1, colonize: 1, buildCost: 1, buildHp: 1,
    growth: 1, happy: 0, fame: 1, unitSpeed: 1, warbandFood: 1,
    farmFood: 1, hunterFood: 1, loreFlat: 0, scoutCost: 1, winterEase: 0,
  };
  for (const [k, v] of Object.entries(base.mods || {})) {
    if (k === 'happy' || k === 'loreFlat') m[k] += v;
    else m[k] *= v;
  }
  for (const bid of clan.blessings) {
    const b = BLESSINGS[bid];
    if (!b) continue;
    for (const [k, v] of Object.entries(b.mods || {})) {
      if (k === 'happy' || k === 'loreFlat') m[k] += v;
      else m[k] *= v;
    }
  }
  clan.mods = m;
  return m;
}

// --- Derived queries --------------------------------------------------------
export const MODS = (clan) => clan.mods;

export function buildingsOf(state, clanId, type = null) {
  const out = [];
  for (const t of state.tiles) {
    if (t.owner !== clanId) continue;
    for (const b of t.buildings) {
      if (b.clan === clanId && (!type || b.type === type)) out.push(b);
    }
  }
  return out;
}
export function buildingsOn(tile, clanId = null) {
  return tile.buildings.filter((b) => clanId === null || b.clan === clanId);
}
export function countDone(state, clanId, type) {
  let n = 0;
  for (const t of state.tiles) {
    if (t.owner !== clanId) continue;
    for (const b of t.buildings) if (b.clan === clanId && b.type === type && b.done) n++;
  }
  return n;
}
export function countBuilding(state, clanId, type) {
  let n = 0;
  for (const t of state.tiles) {
    if (t.owner !== clanId) continue;
    for (const b of t.buildings) if (b.clan === clanId && b.type === type) n++;
  }
  return n;
}
export function allBuildings(state, clanId) {
  const out = [];
  for (const t of state.tiles) for (const b of t.buildings) if (b.clan === clanId) out.push(b);
  return out;
}
export function assignedWorkers(state, clan) {
  let n = 0;
  for (const b of allBuildings(state, clan.id)) n += b.workers || 0;
  return n;
}
export function trainingCount(clan) {
  return clan.training.reduce((s, t) => s + 1, 0);
}
export function civPop(state, clan) {
  return clan.villagers.idle + assignedWorkers(state, clan) + trainingCount(clan);
}
export function warbandOf(state, clanId) {
  return state.units.filter((u) => u.clan === clanId && UNITS[u.type].warband).length;
}
export function unitsOf(state, clanId) {
  return state.units.filter((u) => u.clan === clanId);
}
export function popCap(state, clan) {
  let cap = 0;
  for (const b of allBuildings(state, clan.id)) {
    if (!b.done) continue;
    cap += BUILDINGS[b.type].popCap || 0;
  }
  return cap;
}
export function totalPop(state, clan) {
  return civPop(state, clan) + unitsOf(state, clan.id).filter((u) => !UNITS[u.type].hero).length;
}
export function warbandCap(state, clan) {
  let cap = BASE_WARBAND_CAP;
  for (const b of allBuildings(state, clan.id)) {
    if (b.done) cap += BUILDINGS[b.type].warbandCap || 0;
  }
  return cap + Math.floor(clan.fame / 60);
}

export function seasonIndexOf(state) {
  return Math.floor(state.time.month / MONTHS_PER_SEASON) % 4;
}
export function seasonOf(state) { return SEASONS[seasonIndexOf(state)]; }
export function monthOfSeason(state) { return state.time.month % MONTHS_PER_SEASON; }
export function yearOf(state) { return Math.floor(state.time.month / YEAR_MONTHS) + 1; }

// Season blend 0..1 for how deep into winter we are (used by the renderer)
export function winterAmount(state) {
  const si = seasonIndexOf(state);
  const prog = (state.time.month % MONTHS_PER_SEASON + state.time.monthProgress / MONTH_SECONDS) / MONTHS_PER_SEASON;
  if (si === 3) return Math.min(1, 0.35 + prog * 0.65);
  if (si === 0) return Math.max(0, 0.35 - prog * 0.35);
  return 0;
}

// --- Rates ------------------------------------------------------------------
const FARM_SEASON = { spring: 1.1, summer: 1.4, autumn: 1.25, winter: 0.22 };

export function rates(state, clan) {
  const m = MODS(clan);
  const season = seasonOf(state);
  const out = {
    food: 0, wood: 0, krown: 0, stone: 0, iron: 0, lore: 0,
    useFood: 0, useKrown: 0, useWood: 0,
  };
  for (const t of state.tiles) {
    if (t.owner !== clan.id) continue;
    for (const b of t.buildings) {
      if (b.clan !== clan.id || !b.done) continue;
      const def = BUILDINGS[b.type];
      if (def.rate > 0 && b.workers > 0) {
        let r = def.rate * b.workers * clan.prodMul;
        if (def.res === 'food') {
          if (def.seasonal) r *= FARM_SEASON[season.key];
          else r *= season.foodMul;
          if (def.id === 'farm') {
            if (t.terrain === 'fertile') r *= def.fertileBonus;
            r *= m.farmFood;
          }
          if (def.id === 'hunter') {
            if (t.terrain === 'wildlife') r *= def.wildBonus;
            r *= m.hunterFood;
          }
          if (def.id === 'fishery') r *= Math.max(0.85, season.foodMul);
          r *= m.food;
        } else if (def.res && m[def.res]) {
          r *= m[def.res];
        }
        if (def.deposit && t.depositMax > 0 && t.deposit <= 0) r = 0;
        if (def.res === 'food' && b.type === 'hunter' && t.wild <= 0) r *= 0.6;
        out[def.res] += r;
      }
      if (def.smith && b.workers > 0) {
        // handled in step (smithBonus)
      }
    }
  }
  out.lore += m.loreFlat * clan.prodMul;
  const warband = state.units.filter((u) => u.clan === clan.id);
  let foodUse = civPop(state, clan) * FOOD_PER_CIV + trainingCount(clan) * FOOD_PER_CIV;
  for (const u of warband) foodUse += (UNITS[u.type].upkFood || 0.3) * m.warbandFood;
  const winterEase = 1 - Math.min(0.8, m.winterEase);
  if (season.foodUse) foodUse *= 1 + (season.foodUse - 1) * winterEase;
  out.useFood = foodUse;
  const finished = allBuildings(state, clan.id).filter((b) => b.done).length;
  out.useKrown = finished * KROWN_UPKEEP;
  out.useWood = 0;
  out.netFood = out.food - out.useFood;
  out.netKrown = out.krown - out.useKrown;
  return out;
}

// --- Small helpers ----------------------------------------------------------
export function addLog(state, msg, clanId = null, kind = 'info') {
  state.log.push({ t: state.time.month, msg, clanId, kind, id: state.logSeq++ });
  if (state.log.length > 90) state.log.splice(0, state.log.length - 90);
}
export function addToast(state, msg, kind = 'info') {
  state.toasts.push({ msg, kind, life: 5.5 });
  if (state.toasts.length > 5) state.toasts.shift();
}
export function addFloater(state, x, y, text, color = '#fff', size = 1) {
  state.floaters.push({ x, y, text, color, life: 1.3, maxLife: 1.3, size });
  if (state.floaters.length > 90) state.floaters.shift();
}
export function addProjectile(state, from, to, color) {
  state.projectiles.push({ x: from.x, y: from.y, tx: to.x, ty: to.y, color, life: 0.28, max: 0.28 });
}

export function tileById(state, id) { return state.tileById.get(id); }
export function clanState(state, id) { return state.clans[id]; }

export function hasEnemyOnTile(state, tile, clanId) {
  return state.units.some((u) => u.tileId === tile.id && u.clan !== clanId);
}

// --- Construction / building ------------------------------------------------
export function canBuild(state, tile, clan, type) {
  const def = BUILDINGS[type];
  if (!def) return { ok: false, reason: 'Unknown building' };
  if (tile.owner !== clan.id) return { ok: false, reason: 'Not your land' };
  if (def.terrain !== '*' && !def.terrain.includes(tile.terrain)) {
    return { ok: false, reason: `Needs ${def.terrain.map((t) => TERRAIN[t].name).join(' / ')}` };
  }
  if (tile.buildings.length >= BUILDINGS_PER_TILE) return { ok: false, reason: 'Tile is full (3/3)' };
  if (countBuilding(state, clan.id, type) >= (def.limit || 99)) return { ok: false, reason: 'Limit reached' };
  if (def.unique && countBuilding(state, clan.id, type) >= 1) return { ok: false, reason: 'Already built' };
  const cost = buildingCost(state, clan, type);
  for (const [k, v] of Object.entries(cost)) {
    if ((clan.res[k] || 0) < v) return { ok: false, reason: `Need ${Math.ceil(v - (clan.res[k] || 0))} more ${k}` };
  }
  return { ok: true, cost };
}

export function buildingCost(state, clan, type) {
  const def = BUILDINGS[type];
  const m = MODS(clan);
  const cost = {};
  for (const [k, v] of Object.entries(def.cost || {})) {
    cost[k] = k === 'wood' ? Math.round(v * m.buildCost) : v;
  }
  return cost;
}

function makeBuilding(state, type, tile, clan, done = false) {
  const def = BUILDINGS[type];
  const clanMods = MODS(clan);
  const hp = Math.round(def.hp * (clanMods.buildHp || 1));
  const b = {
    id: state.nextBuildingId++, type, tileId: tile.id, clan: clan.id,
    hp, maxHp: hp, done, build: done ? 0 : def.build, workers: 0, flash: 0,
  };
  if (!done) b.hp = Math.max(24, Math.round(hp * 0.35));
  state.buildingsById.set(b.id, b);
  return b;
}

export function placeStart(state) {
  for (let i = 0; i < 2; i++) {
    const clan = state.clans[i];
    const tile = state.starts[i];
    tile.owner = i;
    const th = makeBuilding(state, 'townhall', tile, clan, true);
    tile.buildings.push(th);
    // a free scout to explore
    spawnUnit(state, i, 'scout', tile);
  }
}

export function build(state, tileId, type, clanId = state.playerClan) {
  const tile = tileById(state, tileId);
  if (!tile) return { ok: false, reason: 'bad tile' };
  if (tile.owner !== clanId) return { ok: false, reason: 'not your land' };
  const clan = state.clans[clanId];
  if (!clan) return { ok: false, reason: 'not your land' };
  const check = canBuild(state, tile, clan, type);
  if (!check.ok) return check;
  for (const [k, v] of Object.entries(check.cost)) clan.res[k] -= v;
  const b = makeBuilding(state, type, tile, clan, false);
  tile.buildings.push(b);
  addFloater(state, tile.x, tile.y - 0.35, '🔨', '#ffe0a0', 0.95);
  return { ok: true, building: b };
}

// --- Workers ----------------------------------------------------------------
export function assignWorker(state, buildingId, delta) {
  const b = state.buildingsById.get(buildingId);
  if (!b) return { ok: false };
  const clan = state.clans[b.clan];
  const def = BUILDINGS[b.type];
  const max = b.type === 'townhall' ? 0 : def.slots || 0;
  const tile = tileById(state, b.tileId);
  if (delta > 0) {
    if (!b.done) return { ok: false, reason: 'Still under construction' };
    if (!def.slots) return { ok: false, reason: `${def.name} needs no workers` };
    if ((b.workers || 0) >= max) return { ok: false, reason: 'All jobs are taken' };
    if (clan.villagers.idle <= 0) return { ok: false, reason: 'No idle villagers' };
    if (def.deposit && tile.depositMax > 0 && tile.deposit <= 0) return { ok: false, reason: 'Deposit is exhausted' };
    clan.villagers.idle--;
    b.workers = (b.workers || 0) + 1;
  } else {
    if (!b.workers) return { ok: false };
    b.workers--;
    clan.villagers.idle++;
  }
  return { ok: true };
}

export function setJob(state, buildingId, count) {
  const b = state.buildingsById.get(buildingId);
  if (!b) return { ok: false };
  let guard = 12;
  while (guard-- > 0) {
    const cur = b.workers || 0;
    if (cur === count) break;
    const r = assignWorker(state, buildingId, cur < count ? 1 : -1);
    if (!r.ok) break;
  }
  return { ok: true };
}

// --- Expansion --------------------------------------------------------------
export function colonizeCost(state, clan, tile) {
  const m = MODS(clan);
  const extra = TERRAIN_COLONIZE_EXTRA[tile.terrain] || 0;
  return Math.round((COLONIZE_COST + extra) * m.colonize);
}

export function canColonize(state, tile, clan) {
  if (tile.owner !== null) return { ok: false, reason: 'Already claimed' };
  const adj = neighborsOf(tile, state).some((n) => n.owner === clan.id);
  if (!adj) return { ok: false, reason: 'Must border your land' };
  if (hasEnemyOnTile(state, tile, clan.id)) return { ok: false, reason: 'Enemy warriors are here' };
  const cost = colonizeCost(state, clan, tile);
  if (clan.res.food < cost) return { ok: false, reason: `Need ${Math.ceil(cost - clan.res.food)} more food` };
  return { ok: true, cost };
}

export function colonize(state, tileId, clanId) {
  const tile = tileById(state, tileId);
  const clan = state.clans[clanId];
  if (!tile || !clan) return { ok: false };
  const check = canColonize(state, tile, clan);
  if (!check.ok) return check;
  clan.res.food -= check.cost;
  tile.owner = clanId;
  gainFame(state, clan, 2);
  addFloater(state, tile.x, tile.y - 0.3, '⛳', clan.banner, 0.9);
  if (clanId === state.playerClan) addToast(state, `Settled ${TERRAIN[tile.terrain].name} (−${check.cost} food)`, 'good');
  return { ok: true };
}

export function gainFame(state, clan, amount) {
  if (!amount) return;
  const gained = amount * (clan.mods.fame || 1) * (clan.isAI ? DIFFICULTY[state.difficulty].fameMul : 1);
  clan.fame += gained;
}

// --- Training ---------------------------------------------------------------
export function canTrain(state, clan, type) {
  const def = UNITS[type];
  if (!def) return { ok: false, reason: 'Unknown unit' };
  if (type === 'warchief') {
    if (clan.fame < WARCHIEF_FAME) return { ok: false, reason: `Needs ${WARCHIEF_FAME} Fame` };
    if (state.units.some((u) => u.clan === clan.id && u.type === 'warchief')) return { ok: false, reason: 'Your Warchief already rides' };
    return { ok: true, cost: {} };
  }
  if (def.requires && countDone(state, clan.id, def.requires) < 1) {
    return { ok: false, reason: `Requires ${BUILDINGS[def.requires].name}` };
  }
  const hasBarracks = countDone(state, clan.id, 'barracks') > 0;
  if (def.warband && !hasBarracks && type !== 'scout') return { ok: false, reason: 'Requires a Barracks' };
  if (def.warband && warbandOf(state, clan.id) + clan.training.filter((t) => UNITS[t.type].warband).length >= warbandCap(state, clan)) {
    return { ok: false, reason: 'Warband is at capacity' };
  }
  if (totalPop(state, clan) >= popCap(state, clan)) return { ok: false, reason: 'No room — build a House' };
  if (civPop(state, clan) < 1) return { ok: false, reason: 'Needs a villager to recruit' };
  const m = MODS(clan);
  const cost = {};
  for (const [k, v] of Object.entries(def.cost || {})) cost[k] = k === 'food' && type === 'scout' ? Math.round(v * m.scoutCost) : v;
  for (const [k, v] of Object.entries(cost)) {
    if ((clan.res[k] || 0) < v) return { ok: false, reason: `Need ${Math.ceil(v - (clan.res[k] || 0))} more ${k}` };
  }
  return { ok: true, cost };
}

export function trainUnit(state, type, clanId = state.playerClan) {
  const clan = state.clans[clanId];
  const check = canTrain(state, clan, type);
  if (!check.ok) return check;
  const def = UNITS[type];
  for (const [k, v] of Object.entries(check.cost)) clan.res[k] -= v;
  // consume a villager
  if (type !== 'warchief') {
    if (clan.villagers.idle > 0) clan.villagers.idle--;
    else {
      const b = allBuildings(state, clan.id).find((x) => x.workers > 0);
      if (b) b.workers--;
    }
  }
  const home = allBuildings(state, clan.id).find((b) => b.done && BUILDINGS[b.type].train) || allBuildings(state, clan.id)[0];
  clan.training.push({ type, remaining: def.train, total: def.train, tileId: home ? home.tileId : state.starts[clanId].id });
  return { ok: true };
}

function finishTraining(state) {
  for (const clan of state.clans) {
    for (let i = clan.training.length - 1; i >= 0; i--) {
      const t = clan.training[i];
      if (t.remaining > 0) continue;
      clan.training.splice(i, 1);
      const tile = tileById(state, t.tileId) || state.starts[clan.id];
      spawnUnit(state, clan.id, t.type, tile);
      if (clan.id === state.playerClan) addToast(state, `${UNITS[t.type].name} is ready`, 'good');
    }
  }
}

export function spawnUnit(state, clanId, type, tile) {
  const def = UNITS[type];
  const clan = state.clans[clanId];
  const hp = Math.round(def.hp * (def.warband ? clan.mods.warriorHp : 1));
  const unit = {
    id: state.nextUnitId++, clan: clanId, type, tileId: tile.id,
    x: tile.x, y: tile.y, hp, maxHp: hp, cd: 0, flash: 0, hitTimer: 0, attackAnim: 0,
    destTileId: null, path: [], targetUnitId: null, targetBuildingId: null,
    facing: 1, order: 'hold', homeTileId: tile.id,
  };
  state.units.push(unit);
  state.unitById.set(unit.id, unit);
  return unit;
}

// --- Units: movement & combat ----------------------------------------------
function passable(state, tile) { return !TERRAIN[tile.terrain].water; }

function findPath(state, from, to, maxNodes = 900) {
  if (from.id === to.id) return [];
  const prev = new Map();
  const seen = new Set([from.id]);
  const queue = [from];
  let nodes = 0;
  while (queue.length && nodes++ < maxNodes) {
    const cur = queue.shift();
    for (const n of neighborsOf(cur, state)) {
      if (seen.has(n.id) || !passable(state, n)) continue;
      seen.add(n.id);
      prev.set(n.id, cur.id);
      if (n.id === to.id) {
        const path = [];
        let id = n.id;
        while (id !== from.id) { path.push(id); id = prev.get(id); }
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return [];
}

export function commandMove(state, unitIds, tileId) {
  const tile = tileById(state, tileId);
  if (!tile) return { ok: false };
  let moved = 0;
  const spots = unitIds.length;
  for (const uid of unitIds) {
    const u = state.unitById.get(uid);
    if (!u) continue;
    const from = tileById(state, u.tileId);
    u.path = passable(state, tile) ? findPath(state, from, tile) : [];
    u.destTileId = tileId;
    u.targetUnitId = null;
    u.targetBuildingId = null;
    u.order = 'move';
    moved++;
    if (!u.path.length && from.id !== tileId) { u.path = []; u.destTileId = null; }
  }
  return { ok: moved > 0, moved };
}

export function commandAttack(state, unitIds, targetUnitId = null, targetBuildingId = null, tileId = null) {
  for (const uid of unitIds) {
    const u = state.unitById.get(uid);
    if (!u) continue;
    u.targetUnitId = targetUnitId;
    u.targetBuildingId = targetBuildingId;
    u.destTileId = tileId;
    u.order = 'attack';
    u.path = [];
  }
}

function attackDamage(state, attacker) {
  const def = UNITS[attacker.type];
  const clan = state.clans[attacker.clan];
  let dmg = def.dmg * (clan.mods.warriorDmg || 1) * (1 + (clan.smithBonus || 0));
  return dmg;
}

function damageBuilding(state, building, amount, attackerClanId) {
  building.hp -= amount;
  building.flash = 0.25;
  const tile = tileById(state, building.tileId);
  addFloater(state, tile.x + (Math.random() - 0.5) * 0.3, tile.y - 0.35, Math.round(amount), '#ffd07a', 0.8);
  if (building.hp <= 0) {
    const idx = tile.buildings.indexOf(building);
    if (idx >= 0) tile.buildings.splice(idx, 1);
    state.buildingsById.delete(building.id);
    const def = BUILDINGS[building.type];
    addLog(state, `${def.name} destroyed`, attackerClanId, 'war');
    if (attackerClanId != null) gainFame(state, state.clans[attackerClanId], 10);
    addFloater(state, tile.x, tile.y, '💥', '#ff9a6a', 1.1);
    if (building.type === 'townhall') {
      const owner = state.clans[building.clan];
      owner.dead = true;
      endGame(state, attackerClanId, 'domination');
    }
    if (attackerClanId === state.playerClan) addToast(state, `You destroyed a ${def.name}!`, 'good');
    else if (building.clan === state.playerClan) addToast(state, `Your ${def.name} was destroyed!`, 'bad');
  }
}

function killUnit(state, unit, killerClanId) {
  unit.dead = true;
  const tile = tileById(state, unit.tileId);
  addFloater(state, unit.x, unit.y - 0.2, '☠️', '#ff8a8a', 1);
  if (killerClanId != null && killerClanId !== unit.clan) {
    gainFame(state, state.clans[killerClanId], 5);
    if (killerClanId === state.playerClan) addToast(state, `Your warband slew a ${UNITS[unit.type].name}`, 'good');
    if (unit.clan === state.playerClan) addToast(state, `You lost a ${UNITS[unit.type].name}`, 'bad');
  }
}

export function endGame(state, winner, condition) {
  if (state.time.ended) return;
  state.time.ended = true;
  state.winner = winner;
  state.condition = condition;
  if (winner === state.playerClan) addLog(state, 'Victory!', winner, 'good');
  else addLog(state, 'Defeat…', winner, 'bad');
}

function checkVictory(state) {
  if (state.time.ended) return;
  for (const clan of state.clans) {
    if (clan.dead) continue;
    if (clan.fame >= VICTORY.fame) return endGame(state, clan.id, 'fame');
    const hasTrade = countDone(state, clan.id, 'market') + countDone(state, clan.id, 'tradingpost') > 0;
    if (hasTrade && clan.totalKrowns >= VICTORY.krowns) return endGame(state, clan.id, 'trade');
  }
  if (state.time.month >= TIMEOUT_YEARS * YEAR_MONTHS) {
    const a = state.clans[0].fame, b = state.clans[1].fame;
    endGame(state, a >= b ? 0 : 1, 'time');
  }
}

export function holdUnit(state, id) {
  const u = state.unitById.get(id);
  if (!u) return { ok: false };
  u.order = 'hold';
  u.path = [];
  u.destTileId = null;
  u.targetUnitId = null;
  u.targetBuildingId = null;
  return { ok: true };
}

export function demolish(state, buildingId, clanId = state.playerClan) {
  const b = state.buildingsById.get(buildingId);
  if (!b || b.clan !== clanId) return { ok: false, reason: 'Not yours' };
  if (b.type === 'townhall') return { ok: false, reason: 'You cannot tear down your own hall' };
  const clan = state.clans[clanId];
  const tile = tileById(state, b.tileId);
  const cost = BUILDINGS[b.type].cost || {};
  if (cost.wood) clan.res.wood += Math.round(cost.wood * 0.5);
  if (cost.stone) clan.res.stone += Math.round(cost.stone * 0.5);
  if (b.workers) clan.villagers.idle += b.workers;
  const i = tile.buildings.indexOf(b);
  if (i >= 0) tile.buildings.splice(i, 1);
  state.buildingsById.delete(b.id);
  if (clanId === state.playerClan) addToast(state, `${BUILDINGS[b.type].name} demolished`, 'info');
  return { ok: true };
}

// --- Blessings --------------------------------------------------------------
export function grantBlessing(state, clan, id) {
  if (!BLESSINGS[id] || clan.blessings.includes(id)) return { ok: false };
  clan.blessings.push(id);
  clan.res.lore -= BLESSING_COST;
  clan.pendingBlessing = null;
  recomputeMods(state, clan);
  if (clan.id === state.playerClan) {
    addToast(state, `Blessing: ${BLESSINGS[id].name}`, 'good');
    state.autoPause = Math.max(0, (state.autoPause || 0) - 1);
  }
  addLog(state, `${clan.name} received the blessing of ${BLESSINGS[id].name}`, clan.id, 'lore');
  return { ok: true };
}

export function offerBlessing(state, clan) {
  if (clan.pendingBlessing || clan.blessings.length >= MAX_BLESSINGS) return;
  if (clan.res.lore < BLESSING_COST) return;
  const pool = BLESSING_IDS.filter((b) => !clan.blessings.includes(b));
  if (!pool.length) return;
  const choices = shuffled(pool, state.rng).slice(0, 3);
  clan.pendingBlessing = { choices };
  if (clan.id === state.playerClan) state.autoPause = (state.autoPause || 0) + 1;
}

// --- Main step --------------------------------------------------------------
export function createGame({ seed = 1234, clanId = 'wolf', difficulty = 'normal', mapSeed = null } = {}) {
  const s = mapSeed == null ? Math.floor(Math.random() * 1e9) : mapSeed;
  const rng = mulberry32(s);
  const map = generateMap(rng);
  const state = {
    seed: s,
    rng,
    difficulty,
    playerClan: 0,
    tiles: map.tiles,
    tileByKey: map.tileByKey,
    tileById: new Map(map.tiles.map((t) => [t.id, t])),
    starts: map.starts,
    units: [],
    unitById: new Map(),
    buildingsById: new Map(),
    projectiles: [],
    floaters: [],
    log: [],
    toasts: [],
    logSeq: 1,
    nextUnitId: 1,
    nextBuildingId: 1,
    winner: null,
    condition: null,
    stats: { kills: 0, losses: 0, tiles: 0, built: 0 },
    autoPause: 0,
    time: { t: 0, month: 0, monthProgress: 0, speed: 1, paused: false, ended: false },
    clans: [],
  };
  const allClanIds = Object.keys(CLANS);
  const aiClanId = pick(allClanIds.filter((c) => c !== clanId), rng);
  state.clans.push(createClan(state, 0, clanId, false));
  state.clans.push(createClan(state, 1, aiClanId, true));
  recomputeMods(state, state.clans[0]);
  recomputeMods(state, state.clans[1]);
  placeStart(state);
  const diff = DIFFICULTY[difficulty];
  if (diff.startBonus) {
    state.clans[1].res.food += diff.startBonus;
    state.clans[1].res.wood += diff.startBonus;
  }
  addLog(state, `${state.clans[1].name} has landed on these shores.`, 1, 'war');
  addLog(state, 'Settle, build, and raise your fame.', 0, 'info');
  return state;
}

export function step(state, dtRaw) {
  if (state.time.ended) { updateFx(state, dtRaw); return; }
  const paused = state.time.paused || (state.autoPause || 0) > 0;
  const dt = Math.min(0.25, dtRaw) * (paused ? 0 : state.time.speed);
  if (dt <= 0) { updateFx(state, dtRaw); return; }
  state.time.t += dt;
  state.time.monthProgress += dt;
  if (state.time.monthProgress >= MONTH_SECONDS) {
    state.time.monthProgress -= MONTH_SECONDS;
    state.time.month++;
    onMonth(state);
  }

  updateEconomy(state, dt);
  updateConstruction(state, dt);
  updateTraining(state, dt);
  updateUnits(state, dt);
  updateTowers(state, dt);
  updateTiles(state, dt);
  updateFx(state, dtRaw);
  checkVictory(state);
}

function onMonth(state) {
  const season = seasonOf(state);
  if (state.time.month % MONTHS_PER_SEASON === 0) {
    addLog(state, `${season.name} arrives (year ${yearOf(state)})`, null, 'season');
    if (season.key === 'winter') addToast(state, '❄️ Winter is here — food production collapses', 'bad');
    else if (season.key === 'spring') addToast(state, '🌱 Spring returns', 'good');
  }
}

function updateEconomy(state, dt) {
  const perSec = dt / MONTH_SECONDS;
  for (const clan of state.clans) {
    if (clan.dead) continue;
    const r = rates(state, clan);
    clan.res.food += (r.food - r.useFood) * perSec;
    clan.res.wood += r.wood * perSec;
    clan.res.krown += (r.krown - r.useKrown) * perSec;
    clan.totalKrowns += r.krown * perSec;
    clan.res.stone += r.stone * perSec;
    clan.res.iron += r.iron * perSec;
    clan.res.lore += r.lore * perSec;
    for (const k of ['food', 'wood', 'krown', 'stone', 'iron', 'lore']) {
      if (clan.res[k] < 0) clan.res[k] = 0;
    }
    // mining depletes deposits
    for (const b of allBuildings(state, clan.id)) {
      const def = BUILDINGS[b.type];
      if (b.done && def.deposit && b.workers > 0) {
        const tile = tileById(state, b.tileId);
        if (tile && tile.depositMax > 0) {
          tile.deposit = Math.max(0, tile.deposit - def.rate * b.workers * perSec * 1.0);
        }
      }
      if (b.done && def.smith && b.workers > 0) {
        const need = (def.consume?.iron || 0) * b.workers * perSec;
        if (clan.res.iron >= need) {
          clan.res.iron -= need;
          clan.smithBonus = Math.min(0.3, (clan.smithBonus || 0) + 0.06 * perSec * b.workers);
        }
      }
      if (b.flash > 0) b.flash = Math.max(0, b.flash - dt);
    }

    // starvation
    if (clan.res.food <= 0.01 && (r.food - r.useFood) < 0) {
      clan.starveTimer += dt;
      if (clan.starveTimer > STARVE_GRACE) {
        clan.starveTimer = 0;
        loseVillager(state, clan);
      }
      if (clan.starveTimer > STARVE_GRACE * 1.7 && state.units.some((u) => u.clan === clan.id && UNITS[u.type].warband)) {
        const u = state.units.find((x) => x.clan === clan.id && UNITS[x.type].warband);
        killUnit(state, u, null);
        addLog(state, 'Starvation: a warrior has deserted', clan.id, 'bad');
      }
    } else {
      clan.starveTimer = Math.max(0, clan.starveTimer - dt * 2);
    }

    // happiness
    const cap = popCap(state, clan);
    const pop = totalPop(state, clan);
    const season = seasonOf(state);
    let happy = 50 + (clan.mods.happy || 0);
    for (const b of allBuildings(state, clan.id)) {
      if (!b.done) continue;
      const def = BUILDINGS[b.type];
      if (def.happy) happy += def.happy;
      if (b.type === 'house') happy += pop < cap ? 2 : -5;
    }
    happy += season.happiness;
    if (clan.res.food > 60) happy += 5;
    else if (clan.res.food < 12) happy -= 18;
    const band = warbandOf(state, clan.id);
    if (band > 6) happy -= (band - 6) * 1.5;
    if (countDone(state, clan.id, 'brewery') === 0 && season.key === 'winter') happy -= 4;
    happy = Math.max(0, Math.min(100, happy));
    clan.happiness += (happy - clan.happiness) * Math.min(1, dt * 0.25);

    // population growth
    if (pop < cap && clan.res.food > 5 && clan.happiness > 35 && clan.villagers.idle + assignedWorkers(state, clan) < cap) {
      const houses = countBuilding(state, clan.id, 'house');
      const spawnSec = Math.max(8, BUILD_SPAWN_SECONDS * (1 - 0.05 * houses));
      clan.growth += dt * (clan.mods.growth || 1) / spawnSec;
      if (clan.growth >= 1) {
        clan.growth -= 1;
        clan.villagers.idle++;
        if (clan.id === state.playerClan) addToast(state, 'A new villager joins the clan', 'good');
      }
    }

    // lore → blessings
    if (!clan.pendingBlessing && clan.res.lore >= BLESSING_COST && clan.blessings.length < MAX_BLESSINGS) {
      offerBlessing(state, clan);
    }
  }
}

function loseVillager(state, clan) {
  if (clan.villagers.idle > 0) clan.villagers.idle--;
  else {
    const b = allBuildings(state, clan.id).find((x) => x.workers > 0);
    if (b) b.workers--;
    else return;
  }
  addFloater(state, state.starts[clan.id].x, state.starts[clan.id].y, '💀', '#ff8a8a', 1);
  if (clan.id === state.playerClan) addToast(state, 'A villager starved to death!', 'bad');
  addLog(state, `${clan.name}: a villager starved`, clan.id, 'bad');
  clan.happiness = Math.max(0, clan.happiness - 6);
}

function updateConstruction(state, dt) {
  for (const t of state.tiles) {
    for (const b of t.buildings) {
      if (b.done) continue;
      b.build -= dt;
      const def = BUILDINGS[b.type];
      if (b.build <= 0) {
        b.done = true;
        b.hp = b.maxHp;
        const clan = state.clans[b.clan];
        gainFame(state, clan, def.fame || 3);
        if (b.clan === state.playerClan) {
          addToast(state, `${def.name} completed`, 'good');
          state.stats.built++;
        }
        addLog(state, `${BUILDINGS[b.type].name} raised`, b.clan, 'build');
      }
    }
  }
}

function updateTraining(state, dt) {
  for (const clan of state.clans) {
    for (const t of clan.training) t.remaining -= dt;
  }
  finishTraining(state);
}

function updateUnits(state, dt) {
  const toKill = [];
  for (const u of state.units) {
    if (u.dead) continue;
    const def = UNITS[u.type];
    const clan = state.clans[u.clan];
    const spd = def.speed * (clan.mods.unitSpeed || 1) * SPEED_UNIT;
    u.cd = Math.max(0, u.cd - dt);
    u.flash = Math.max(0, u.flash - dt);
    u.attackAnim = Math.max(0, u.attackAnim - dt);
    if (u.hitTimer > 0) u.hitTimer -= dt;
    const myTile = tileById(state, u.tileId);

    // --- pick / validate target
    let target = u.targetUnitId != null ? state.unitById.get(u.targetUnitId) : null;
    if (target && (target.dead || target.hp <= 0)) { target = null; u.targetUnitId = null; }
    let bTarget = u.targetBuildingId != null ? state.buildingsById.get(u.targetBuildingId) : null;
    if (bTarget && bTarget.hp <= 0) { bTarget = null; u.targetBuildingId = null; }

    // auto-acquire nearby enemies (warband + scouts defend themselves)
    if (!target) {
      const aggro = u.order === 'hold' ? 3.2 : 2.2;
      let best = null, bestD = 1e9;
      for (const e of state.units) {
        if (e.dead || e.clan === u.clan) continue;
        const et = tileById(state, e.tileId);
        const d = hexDist(myTile, et);
        if (d <= aggro && d < bestD) { best = e; bestD = d; }
      }
      if (best) { target = best; if (u.order === 'hold') u.targetUnitId = best.id; }
    }
    if (!target && !bTarget && u.order === 'attack') {
      // ordered to attack a tile → attack whatever is there
      const t = u.destTileId != null ? tileById(state, u.destTileId) : null;
      if (t) {
        const enemyUnit = state.units.find((e) => !e.dead && e.clan !== u.clan && e.tileId === t.id);
        if (enemyUnit) target = enemyUnit;
        else {
          const eb = t.buildings.find((b) => b.clan !== u.clan);
          if (eb) bTarget = eb;
        }
      }
    }
    // enemies standing on my tile are always engaged
    if (!target) {
      const onTile = state.units.find((e) => !e.dead && e.clan !== u.clan && e.tileId === myTile.id);
      if (onTile) target = onTile;
    }

    const distTo = (t) => hexDist(myTile, tileById(state, t.tileId));

    if (target) {
      const d = distTo(target);
      if (d <= def.range) {
        if (u.cd <= 0) {
          u.cd = def.cd;
          u.attackAnim = 0.18;
          u.facing = tileById(state, target.tileId).x >= myTile.x ? 1 : -1;
          const dmg = attackDamage(state, u);
          target.hp -= dmg;
          target.flash = 0.2;
          if (def.range > 1) addProjectile(state, { x: u.x, y: u.y }, { x: target.x, y: target.y }, '#ffd27a');
          addFloater(state, target.x + (Math.random() - 0.5) * 0.25, target.y - 0.25, Math.round(dmg), '#ffd07a', 0.75);
          if (target.hp <= 0) {
            target.dead = true;
            toKill.push(target);
            gainFame(state, clan, 5);
            if (u.clan === state.playerClan) state.stats.kills++;
            else if (target.clan === state.playerClan) state.stats.losses++;
            addFloater(state, target.x, target.y - 0.2, '☠️', '#ff8a8a', 1);
            if (u.clan === state.playerClan) addToast(state, `You slew a ${UNITS[target.type].name}`, 'good');
            else addToast(state, `You lost a ${UNITS[target.type].name}`, 'bad');
          }
        }
      } else if (u.order !== 'hold' || d <= 3.2) {
        // chase
        const tt = tileById(state, target.tileId);
        if (u.path.length === 0 || tileById(state, u.path[u.path.length - 1]).id !== tt.id) {
          u.path = findPath(state, myTile, tt);
          u.destTileId = tt.id;
        }
      }
    } else if (bTarget) {
      const bt = tileById(state, bTarget.tileId);
      const d = hexDist(myTile, bt);
      if (d <= Math.max(1, def.range)) {
        if (u.cd <= 0) {
          u.cd = def.cd * (def.range > 1 ? 1 : 0.9);
          u.attackAnim = 0.18;
          const dmg = attackDamage(state, u) * (def.range > 1 ? 0.85 : 1) * 0.9;
          if (def.range > 1) addProjectile(state, { x: u.x, y: u.y }, { x: bt.x, y: bt.y }, '#ffd27a');
          damageBuilding(state, bTarget, dmg, u.clan);
        }
      } else {
        if (u.path.length === 0 || tileById(state, u.path[u.path.length - 1]).id !== bt.id) {
          u.path = findPath(state, myTile, bt);
          u.destTileId = bt.id;
        }
      }
    } else if (u.destTileId != null) {
      const dt2 = tileById(state, u.destTileId);
      if (!dt2) { u.destTileId = null; u.order = 'hold'; }
      else if (myTile.id === dt2.id) {
        u.order = 'hold';
        u.destTileId = null;
        u.path = [];
      } else if (u.path.length === 0) {
        u.path = findPath(state, myTile, dt2);
        if (u.path.length === 0) { u.destTileId = null; u.order = 'hold'; }
      }
    }

    // --- movement along path
    if (u.path.length) {
      const next = tileById(state, u.path[0]);
      if (!passable(state, next)) { u.path = []; }
      else {
        const dx = next.x - u.x, dy = next.y - u.y;
        const len = Math.hypot(dx, dy);
        const stepLen = spd * dt;
        if (len <= stepLen) {
          u.x = next.x; u.y = next.y; u.tileId = next.id; u.path.shift();
          if (u.path.length === 0 && u.order === 'move') { u.order = 'hold'; u.destTileId = null; }
        } else {
          u.x += (dx / len) * stepLen;
          u.y += (dy / len) * stepLen;
          u.facing = dx >= 0 ? 1 : -1;
        }
      }
    }
  }

  for (const u of toKill) {
    const i = state.units.indexOf(u);
    if (i >= 0) state.units.splice(i, 1);
    state.unitById.delete(u.id);
  }
}

function updateTowers(state, dt) {
  for (const t of state.tiles) {
    for (const b of t.buildings) {
      if (!b.done) continue;
      const def = BUILDINGS[b.type];
      const range = def.tower ? def.tower.range : (b.type === 'townhall' ? 1 : 0);
      const dmg = def.tower ? def.tower.dmg * (b.workers > 0 ? 1 : 0.55) : (b.type === 'townhall' ? 4 : 0);
      if (!range || !dmg) continue;
      b.cd = Math.max(0, (b.cd || 0) - dt);
      if (b.cd > 0) continue;
      let best = null, bestD = 1e9;
      for (const e of state.units) {
        if (e.dead || e.clan === b.clan) continue;
        const et = tileById(state, e.tileId);
        const d = hexDist(t, et);
        if (d <= range && d < bestD) { best = e; bestD = d; }
      }
      if (best) {
        b.cd = 1.1;
        best.hp -= dmg;
        best.flash = 0.2;
        addProjectile(state, { x: t.x, y: t.y }, { x: best.x, y: best.y }, '#9fe0ff');
        if (best.hp <= 0) {
          best.dead = true;
          gainFame(state, state.clans[b.clan], 5);
          const i = state.units.indexOf(best);
          if (i >= 0) state.units.splice(i, 1);
          state.unitById.delete(best.id);
          addFloater(state, best.x, best.y, '☠️', '#ff8a8a', 1);
        }
      }
    }
  }
}

function updateTiles(state, dt) {
  for (const t of state.tiles) {
    const unitsHere = state.units.filter((u) => u.tileId === t.id);
    // ruins exploration
    if (t.terrain === 'ruins' && !t.ruinLooted && unitsHere.length) {
      t.exploreProgress += dt;
      if (t.exploreProgress >= 1.6) {
        t.ruinLooted = true;
        t.exploreProgress = 0;
        const u = unitsHere[0];
        const owner = t.owner != null ? t.owner : u.clan;
        const clan = state.clans[owner];
        const roll = state.rng();
        let text;
        if (roll < 0.3) { clan.res.krown += 80; text = '+80 krowns'; }
        else if (roll < 0.55) { clan.res.lore += 18; text = '+18 lore'; }
        else if (roll < 0.75) { clan.res.stone += 25; text = '+25 stone'; }
        else if (roll < 0.9) { clan.res.food += 70; text = '+70 food'; }
        else { gainFame(state, clan, 25); text = '+25 fame'; }
        addFloater(state, t.x, t.y - 0.3, '✨ ' + text, '#e8d27a', 0.9);
        addLog(state, `Ruins explored: ${text}`, owner, 'lore');
        if (owner === state.playerClan) addToast(state, `Ruins explored: ${text}`, 'good');
      }
    } else if (t.exploreProgress > 0) t.exploreProgress = Math.max(0, t.exploreProgress - dt * 2);

    // capture
    if (t.owner != null) {
      const isFighter = (u) => UNITS[u.type].warband === 1;
      const enemy = unitsHere.find((u) => isFighter(u) && u.clan !== t.owner);
      const defenders = unitsHere.some((u) => isFighter(u) && u.clan === t.owner)
        || t.buildings.some((b) => b.clan === t.owner && b.done);
      if (enemy && !defenders) {
        if (t.captureClan !== enemy.clan) { t.captureClan = enemy.clan; t.captureProgress = 0; }
        t.captureProgress += dt;
        if (t.captureProgress >= 1.4) {
          const old = t.owner;
          t.owner = enemy.clan;
          t.captureProgress = 0;
          t.captureClan = null;
          gainFame(state, state.clans[enemy.clan], 3);
          addLog(state, `Land captured from ${state.clans[old].name}`, enemy.clan, 'war');
          if (enemy.clan === state.playerClan) addToast(state, 'You captured enemy land!', 'good');
          else if (old === state.playerClan) addToast(state, 'The enemy seized your land!', 'bad');
        }
      } else if (t.captureProgress > 0) {
        t.captureProgress = 0;
        t.captureClan = null;
      }
    }
  }
}

function updateFx(state, dt) {
  for (let i = state.floaters.length - 1; i >= 0; i--) {
    const f = state.floaters[i];
    f.life -= dt;
    f.y -= dt * 0.35;
    if (f.life <= 0) state.floaters.splice(i, 1);
  }
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    p.life -= dt;
    if (p.life <= 0) state.projectiles.splice(i, 1);
  }
  for (let i = state.toasts.length - 1; i >= 0; i--) {
    state.toasts[i].life -= dt;
    if (state.toasts[i].life <= 0) state.toasts.splice(i, 1);
  }
}

// --- Misc public helpers ----------------------------------------------------
export function exploredRewardText() { return '✨'; }

export function humanSummary(state) {
  const c = state.clans[state.playerClan];
  return `${c.name} · ${Math.round(c.fame)} fame · ${totalPop(state, c)}/${popCap(state, c)} pop`;
}
