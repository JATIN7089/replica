// ============================================================================
// Northhold — save / load.
// Serialises the whole simulation state to plain JSON (localStorage or file).
// Loading rebuilds every derived map, so a save resumes the exact same game —
// the RNG state is stored too, which keeps a reloaded timeline deterministic.
// ============================================================================
import {
  BUILDINGS, UNITS, CLANS, DIFFICULTY, START_RESOURCES,
} from './data.js';
import {
  mulberry32, hexToWorld, recomputeMods, addLog,
} from './engine.js';

export const SAVE_VERSION = 2;
export const SAVE_KEY = 'northhold.save.v1';
export const SAVE_AUTO_KEY = 'northhold.autosave.v1';

const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
};

// ---------------------------------------------------------------- serialise
export function serialize(state) {
  return {
    v: SAVE_VERSION,
    at: Date.now(),
    seed: state.seed,
    rng: typeof state.rng.snapshot === 'function' ? state.rng.snapshot() : 0,
    difficulty: state.difficulty,
    playerClan: state.playerClan,
    winner: state.winner,
    condition: state.condition,
    stats: { ...state.stats },
    time: { ...state.time, paused: false },
    starts: state.starts.map((t) => ({ q: t.q, r: t.r })),
    seq: {
      log: state.logSeq, unit: state.nextUnitId, building: state.nextBuildingId,
    },
    log: state.log.slice(-40).map((l) => ({ ...l })),
    clans: state.clans.map((c) => ({
      id: c.id, clanId: c.clanId, isAI: c.isAI, name: c.name,
      color: c.color, banner: c.banner,
      res: { ...c.res },
      totalKrowns: c.totalKrowns, fame: c.fame, happiness: c.happiness,
      villagers: { ...c.villagers },
      training: c.training.map((t) => ({ ...t })),
      blessings: [...c.blessings], pendingBlessing: c.pendingBlessing ? { choices: [...c.pendingBlessing.choices] } : null,
      smithBonus: c.smithBonus, starveTimer: c.starveTimer, growth: c.growth,
      prodMul: c.prodMul, dead: c.dead,
      ai: c.ai ? { ...c.ai } : null,
    })),
    tiles: state.tiles.map((t) => ({
      q: t.q, r: t.r, terrain: t.terrain, owner: t.owner,
      deposit: t.deposit, depositMax: t.depositMax, depositKind: t.depositKind, ruinLooted: t.ruinLooted,
      wild: t.wild, captureClan: t.captureClan, captureProgress: t.captureProgress,
      exploreProgress: t.exploreProgress,
      buildings: t.buildings.map((b) => pick(b,
        ['id', 'type', 'clan', 'hp', 'maxHp', 'done', 'build', 'workers', 'flash', 'cd'])),
    })),
    units: state.units.map((u) => ({
      ...pick(u, ['id', 'clan', 'type', 'tileId', 'x', 'y', 'hp', 'maxHp', 'cd', 'flash',
        'hitTimer', 'attackAnim', 'destTileId', 'targetUnitId', 'targetBuildingId',
        'facing', 'order', 'homeTileId']),
      path: [...(u.path || [])],
    })),
  };
}

// ---------------------------------------------------------------- deserialise
export function deserialize(data) {
  if (!data || typeof data !== 'object') throw new Error('Save data is empty');
  if (!data.tiles || !data.clans || !data.units) throw new Error('Save data is incomplete');
  if (data.v > SAVE_VERSION) throw new Error(`Save was written by a newer version (v${data.v})`);

  const rng = mulberry32(num(data.seed, 1));
  if (typeof rng.restore === 'function') rng.restore(num(data.rng, num(data.seed, 1)));

  const state = {
    seed: num(data.seed, 1),
    rng,
    difficulty: DIFFICULTY[data.difficulty] ? data.difficulty : 'normal',
    playerClan: data.playerClan === 1 ? 1 : 0,
    tiles: [],
    tileByKey: new Map(),
    tileById: new Map(),
    starts: [],
    units: [],
    unitById: new Map(),
    buildingsById: new Map(),
    projectiles: [],
    floaters: [],
    log: Array.isArray(data.log) ? data.log.map((l) => ({ ...l })) : [],
    toasts: [],
    logSeq: num(data.seq?.log, 1),
    nextUnitId: num(data.seq?.unit, 1),
    nextBuildingId: num(data.seq?.building, 1),
    winner: data.winner ?? null,
    condition: data.condition ?? null,
    stats: { kills: 0, losses: 0, tiles: 0, built: 0, ...(data.stats || {}) },
    autoPause: 0,
    time: {
      t: 0, month: 0, monthProgress: 0, speed: 1, paused: false, ended: false,
      ...(data.time || {}),
      paused: false,
    },
    clans: [],
  };

  // tiles (world coordinates are derived, never trusted from the file)
  for (const td of data.tiles) {
    const w = hexToWorld(td.q, td.r, 1);
    const tile = {
      id: state.tiles.length, q: td.q, r: td.r, x: w.x, y: w.y,
      terrain: td.terrain || 'plains', owner: td.owner ?? null,
      buildings: [], deposit: num(td.deposit), depositMax: num(td.depositMax),
      depositKind: td.depositKind || (td.terrain === 'iron' ? 'iron' : td.terrain === 'mountain' ? 'stone' : null),
      ruinLooted: !!td.ruinLooted, wild: num(td.wild),
      captureClan: td.captureClan ?? null, captureProgress: num(td.captureProgress),
      exploreProgress: num(td.exploreProgress),
    };
    state.tiles.push(tile);
    state.tileById.set(tile.id, tile);
    state.tileByKey.set(tile.q + ',' + tile.r, tile);
  }

  // clans
  for (const cd of data.clans) {
    const base = CLANS[cd.clanId] || CLANS.wolf;
    const clan = {
      id: num(cd.id), clanId: cd.clanId || 'wolf', isAI: !!cd.isAI,
      name: cd.name || base.name, color: cd.color || base.color, banner: cd.banner || base.banner,
      res: { ...START_RESOURCES, ...(cd.res || {}) },
      totalKrowns: num(cd.totalKrowns), fame: num(cd.fame),
      happiness: num(cd.happiness, 60),
      villagers: { idle: num(cd.villagers?.idle), ...(cd.villagers || {}) },
      training: (cd.training || []).map((t) => ({
        type: t.type, remaining: num(t.remaining), total: num(t.total, 1), tileId: t.tileId ?? null,
      })),
      blessings: [...(cd.blessings || [])].filter((b) => typeof b === 'string'),
      pendingBlessing: cd.pendingBlessing?.choices ? { choices: [...cd.pendingBlessing.choices] } : null,
      smithBonus: num(cd.smithBonus), starveTimer: num(cd.starveTimer), growth: num(cd.growth),
      prodMul: num(cd.prodMul, 1), dead: !!cd.dead,
      mods: null,
      ai: cd.ai
        ? { timer: num(cd.ai.timer, 2), mode: cd.ai.mode || 'build', targetTile: cd.ai.targetTile ?? null, rallyTile: cd.ai.rallyTile ?? null }
        : { timer: 2 },
    };
    state.clans.push(clan);
  }
  // the clan of the start tiles — a fallback if the file lost it
  const byClanTile = state.tiles.filter((t) => t.owner !== null);
  for (const tile of byClanTile) {
    const clan = state.clans[tile.owner];
    if (clan && tile.buildings === undefined) tile.buildings = [];
  }
  // starts: the real start tiles matter — the AI measures distances from them
  const savedStarts = Array.isArray(data.starts) ? data.starts : null;
  for (let i = 0; i < state.clans.length; i++) {
    const s = savedStarts && savedStarts[i];
    const tile = s ? state.tileByKey.get(s.q + ',' + s.r) : null;
    state.starts.push(tile || state.tiles.find((t) => t.owner === i) || state.tiles[Math.floor(state.tiles.length / 2)]);
  }
  if (!savedStarts) {
    // older saves: fall back to the clan's town hall tile
    for (let i = 0; i < state.clans.length; i++) {
      const th = state.tiles.find((t) => t.owner === i && t.buildings.some((b) => b.type === 'townhall' && b.clan === i));
      if (th) state.starts[i] = th;
    }
  }

  // buildings
  let maxBuildingId = 1;
  for (const td of data.tiles) {
    const tile = state.tileByKey.get(td.q + ',' + td.r);
    if (!tile) continue;
    for (const bd of td.buildings || []) {
      const def = BUILDINGS[bd.type];
      if (!def) continue;
      const b = {
        id: num(bd.id, maxBuildingId), type: bd.type, tileId: tile.id,
        clan: num(bd.clan), hp: num(bd.hp, def.hp), maxHp: num(bd.maxHp, def.hp),
        done: !!bd.done, build: num(bd.build), workers: num(bd.workers), flash: 0, cd: num(bd.cd),
      };
      maxBuildingId = Math.max(maxBuildingId, b.id + 1);
      tile.buildings.push(b);
      state.buildingsById.set(b.id, b);
    }
  }
  state.nextBuildingId = Math.max(num(data.seq?.building, 1), maxBuildingId);

  // units
  let maxUnitId = 1;
  for (const ud of data.units) {
    const def = UNITS[ud.type];
    if (!def) continue;
    const tile = state.tileById.get(ud.tileId) || state.tiles[0];
    const u = {
      id: num(ud.id, maxUnitId), clan: num(ud.clan), type: ud.type,
      tileId: tile.id, x: num(ud.x, tile.x), y: num(ud.y, tile.y),
      hp: num(ud.hp, def.hp), maxHp: num(ud.maxHp, def.hp),
      cd: num(ud.cd), flash: 0, hitTimer: 0, attackAnim: 0,
      destTileId: ud.destTileId ?? null,
      targetUnitId: ud.targetUnitId ?? null,
      targetBuildingId: ud.targetBuildingId ?? null,
      facing: num(ud.facing, 1), order: ud.order || 'hold',
      homeTileId: ud.homeTileId ?? tile.id,
      path: Array.isArray(ud.path) ? ud.path.filter((id) => state.tileById.has(id)) : [],
    };
    maxUnitId = Math.max(maxUnitId, u.id + 1);
    state.units.push(u);
    state.unitById.set(u.id, u);
  }
  state.nextUnitId = Math.max(num(data.seq?.unit, 1), maxUnitId);

  // derived stats + modifiers
  recomputeMods(state, state.clans[0]);
  if (state.clans[1]) recomputeMods(state, state.clans[1]);
  state.stats.tiles = state.tiles.filter((t) => t.owner === state.playerClan).length;
  return state;
}

// ---------------------------------------------------------------- storage
export function saveToStorage(state, key = SAVE_KEY) {
  const json = JSON.stringify(serialize(state));
  try {
    localStorage.setItem(key, json);
    return { ok: true, bytes: json.length };
  } catch (err) {
    return { ok: false, reason: err?.message || 'localStorage is unavailable' };
  }
}

export function readSaveFromStorage(key = SAVE_KEY) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function hasSave(key = SAVE_KEY) {
  return !!readSaveFromStorage(key);
}

export function clearSave(key = SAVE_KEY) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export function saveInfo(key = SAVE_KEY) {
  const data = readSaveFromStorage(key);
  if (!data) return null;
  const player = data.clans?.[data.playerClan ?? 0];
  const months = num(data.time?.month);
  return {
    at: num(data.at),
    clan: player?.name || 'Unknown clan',
    year: Math.floor(months / 12) + 1,
    month: (months % 12) + 1,
    difficulty: DIFFICULTY[data.difficulty]?.name || data.difficulty || '—',
    ended: !!data.time?.ended,
  };
}

// ---------------------------------------------------------------- files
export function saveFileName(state) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `northhold-${state.clans[state.playerClan].clanId}-y${Math.floor(state.time.month / 12) + 1}-${stamp}.json`;
}

export function downloadSave(state) {
  const blob = new Blob([JSON.stringify(serialize(state), null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = saveFileName(state);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function readSaveFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

export function autosave(state) {
  return saveToStorage(state, SAVE_AUTO_KEY);
}
