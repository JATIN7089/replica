// ============================================================================
// Northhold — the rival jarl's brain. Heuristic, but he does hold grudges.
// ============================================================================
import * as E from './engine.js';
import {
  BUILDINGS, UNITS, TRAINABLE, BLESSINGS, BLESSING_IDS, DIFFICULTY, WARCHIEF_FAME,
} from './data.js';

const BLESSING_PRIORITY = [
  'sagas', 'abundance', 'hardwood', 'festival', 'ironwill', 'masonry',
  'fertility', 'coinage', 'cartography', 'swiftness', 'runes', 'hearth',
];

// terrain preference per building type
const TERRAIN_SCORE = {
  farm: { fertile: 4, plains: 0 },
  hunter: { wildlife: 3, forest: 1, plains: 0 },
  woodcutter: { forest: 3, wildlife: 1, plains: 0 },
  fishery: { lake: 0 },
  mine: { mountain: 0 },
  ironmine: { iron: 0 },
  brewery: { fertile: 1, plains: 0, wildlife: 0 },
  altar: { ruins: 3, mountain: 1, plains: 0 },
};

function myTiles(state, clanId) {
  return state.tiles.filter((t) => t.owner === clanId);
}
function buildingsOfType(state, clanId, type) {
  return E.buildingsOf(state, clanId, type);
}

function assignWorkers(state, clan) {
  // Idle villagers do nothing — fill jobs in priority order (food first, then wood,
  // then the rest) and keep a single villager in reserve for training.
  const order = ['hunter', 'farm', 'fishery', 'woodcutter', 'mine', 'ironmine',
    'altar', 'market', 'tradingpost', 'forge', 'brewery', 'tower', 'barracks'];
  const byType = {};
  for (const b of E.allBuildings(state, clan.id)) {
    if (!b.done) continue;
    const def = BUILDINGS[b.type];
    if (!def.slots) continue;
    (byType[b.type] = byType[b.type] || []).push(b);
  }
  const famine = clan.res.food < 40;
  let pool = famine ? clan.villagers.idle : Math.max(0, clan.villagers.idle - 1);
  // trainers only matter while something is being trained
  for (const t of order) {
    const list = byType[t] || [];
    for (const b of list) {
      const max = BUILDINGS[b.type].slots || 0;
      const tile = E.tileById(state, b.tileId);
      const dry = BUILDINGS[b.type].deposit && tile.depositMax > 0 && tile.deposit <= 0;
      const want = (b.type === 'tower' && pool < 1) || (b.type === 'barracks' && clan.training.length === 0) ? 0 : max;
      let target = dry ? 0 : want;
      if (t === 'brewery' && clan.happiness >= 62) target = 0;
      if (target > (b.workers || 0)) {
        const add = Math.min(target - (b.workers || 0), pool);
        for (let i = 0; i < add; i++) if (E.assignWorker(state, b.id, 1).ok) pool--;
      } else if (target < (b.workers || 0)) {
        E.assignWorker(state, b.id, -1);
      }
    }
  }
}

function pickBuildTile(state, clan, type) {
  const def = BUILDINGS[type];
  const prefs = TERRAIN_SCORE[type] || {};
  const th = buildingsOfType(state, clan.id, 'townhall')[0];
  const thTile = th ? E.tileById(state, th.tileId) : state.starts[clan.id];
  let best = null, bestScore = -1e9;
  for (const t of myTiles(state, clan.id)) {
    if (t.buildings.length >= 3) continue;
    if (def.terrain !== '*' && !def.terrain.includes(t.terrain)) continue;
    const mineOnTile = t.buildings.filter((b) => b.clan === clan.id).length;
    let score = (prefs[t.terrain] || 0) * 2 - mineOnTile * 1.6;
    // reserve resource tiles for the buildings that need them
    const extractive = type === 'mine' || type === 'ironmine' || type === 'fishery';
    if (t.terrain === 'mountain' && type !== 'mine') score -= 6;
    if (t.terrain === 'iron' && type !== 'ironmine') score -= 6;
    if (t.terrain === 'fertile' && type !== 'farm' && !extractive) score -= 1.5;
    const d = E.hexDist(t, thTile);
    if (type === 'house' || type === 'farm') score -= d * 0.4;
    if (type === 'tower' || type === 'barracks') score += d * 0.15;
    if (t.captureProgress > 0) score -= 3; // contested, avoid
    score += state.rng() * 0.4;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

function pickColonizeTile(state, clan) {
  const owned = myTiles(state, clan.id);
  const enemyTiles = new Set(myTiles(state, 1 - clan.id).map((t) => t.id));
  const seen = new Set();
  let best = null, bestScore = -1e9;
  // when stone/iron is missing, steer the frontier toward the nearest deposit
  let depositTarget = null;
  if (clan.res.stone < 40) {
    let bestD = 1e9;
    for (const t of state.tiles) {
      if (t.owner !== null || t.terrain !== 'mountain') continue;
      const d = E.hexDist(t, state.starts[clan.id]);
      if (d < bestD) { bestD = d; depositTarget = t; }
    }
  }
  for (const t of owned) {
    for (const n of E.neighborsOf(t, state)) {
      if (n.owner !== null || seen.has(n.id)) continue;
      seen.add(n.id);
      const chk = E.canColonize(state, n, clan);
      if (!chk.ok) continue;
      let score = 0;
      const starved = {
        wood: clan.res.wood < 60,
        stone: clan.res.stone < 40,
        food: clan.res.food < 80,
      };
      if (n.terrain === 'forest') score += starved.wood ? 5 : 3;
      if (n.terrain === 'wildlife') score += starved.food ? 4 : 3;
      if (n.terrain === 'fertile') score += 4;
      if (n.terrain === 'mountain' || n.terrain === 'iron') score += starved.stone ? 6 : 2;
      if (n.terrain === 'ruins') score += 1.5;
      if (n.terrain === 'lake') score -= 2;
      if (depositTarget) score -= E.hexDist(n, depositTarget) * 1.1; // head for the hills
      const nearEnemy = E.neighborsOf(n, state).some((x) => enemyTiles.has(x.id));
      if (nearEnemy) score += 2.5;
      if (n.terrain === 'lake') score -= 1;
      const th = state.starts[clan.id];
      score -= E.hexDist(n, th) * 0.15;
      score += state.rng() * 0.4;
      if (score > bestScore) { bestScore = score; best = n; }
    }
  }
  return best;
}

function desiredBuildOrder(state, clan) {
  const c = (t) => buildingsOfType(state, clan.id, t).length;
  const owned = myTiles(state, clan.id);
  const canPlace = (type) => !!pickBuildTile(state, clan, type);
  const list = [];
  const pop = E.totalPop(state, clan);
  const cap = E.popCap(state, clan);
  const year = E.yearOf(state);

  // 1. an economy baseline first — wood and food before comfort
  const wTarget = Math.min(4, 1 + Math.floor(pop / 6));   // jobs must keep up with mouths
  const fTarget = Math.min(5, 1 + Math.floor(pop / 5));
  const farmTarget = Math.min(4, 1 + Math.floor(pop / 8));
  if (c('woodcutter') < 1) list.push('woodcutter');
  if (c('hunter') < 1) list.push('hunter');
  if (c('woodcutter') < 2) list.push('woodcutter');
  if (c('hunter') < 2) list.push('hunter');
  if (c('farm') < 1 && canPlace('farm')) list.push('farm');
  if (c('fishery') < 1 && canPlace('fishery')) list.push('fishery');
  // 2. only now spend wood on houses (the clan already has a woodcutter)
  const workSlots = (c('woodcutter') + c('hunter') + c('farm') + c('fishery') + c('mine')) * 2;
  if (c('woodcutter') >= 1 && c('house') < 2 && cap - pop <= 2 && workSlots >= pop) list.push('house');
  if (c('fishery') < 1 && canPlace('fishery')) list.push('fishery');
  if (c('altar') < 1 && year >= 1) list.push('altar');
  if (c('market') < 1 && clan.res.krown < 140) list.push('market');
  if (c('mine') < 1 && clan.res.stone < 70 && canPlace('mine')) list.push('mine');
  if (c('barracks') < 1 && pop >= 7) list.push('barracks');
  if (c('brewery') < 1 && clan.happiness < 58) list.push('brewery');
  if (c('woodcutter') < wTarget) list.push('woodcutter');
  if (c('hunter') < fTarget) list.push('hunter');
  if (c('fishery') < Math.min(3, fTarget) && canPlace('fishery')) list.push('fishery');
  if (c('farm') < farmTarget && canPlace('farm')) list.push('farm');
  if (c('tradingpost') < 1 && c('market') >= 1) list.push('tradingpost');
  if (c('forge') < 1 && c('barracks') >= 1) list.push('forge');
  if (workSlots >= pop && c('house') < Math.min(8, 1 + Math.floor(pop / 3))) list.push('house');
  if (c('ironmine') < 1 && c('forge') >= 1) list.push('ironmine');
  if (c('altar') < 2) list.push('altar');
  if (c('tower') < 1 && year >= 1) list.push('tower');
  if (c('house') < 5) list.push('house');
  if (c('tower') < 2) list.push('tower');
  if (c('mine') < 2) list.push('mine');
  if (c('barracks') < 2) list.push('barracks');
  return list.filter((t) => BUILDINGS[t]);
}

function manageBuildings(state, clan) {
  const order = desiredBuildOrder(state, clan);
  for (const type of order) {
    const tile = pickBuildTile(state, clan, type);
    if (!tile) continue;
    const chk = E.canBuild(state, tile, clan, type);
    if (!chk.ok) continue;
    if (E.build(state, tile.id, type, clan.id).ok) return true;
  }
  return false;
}

function manageExpansion(state, clan) {
  const c = (t) => buildingsOfType(state, clan.id, t).length;
  const tiles = myTiles(state, clan.id).length;
  const ready = c('woodcutter') >= 1 && c('hunter') >= 1;
  const cramped = tiles < 3;
  if (clan.res.food < 40 && !cramped) return false; // hold the line while the stores are low
  if (!ready && !cramped) return false;
  if (tiles >= 22) return false; // leave the map to the player to fight over
  const buffer = (ready ? 60 : 45) + tiles * 1.2; // must feed everyone it already holds
  if (clan.res.food < buffer) return false;
  const tile = pickColonizeTile(state, clan);
  if (!tile) return false;
  if (E.colonize(state, tile.id, clan.id).ok) return true;
  return false;
}

function manageTraining(state, clan) {
  const diff = DIFFICULTY[state.difficulty];
  const band = E.warbandOf(state, clan.id);
  const cap = E.warbandCap(state, clan);
  const pop = E.totalPop(state, clan);
  const garrison = 2; // always keep a couple of defenders home
  const targetBand = Math.min(cap, garrison + Math.floor(pop / 3));
  const hasWarchief = state.units.some((u) => u.clan === clan.id && u.type === 'warchief');
  if (!hasWarchief && clan.fame >= WARCHIEF_FAME + 40 && E.canTrain(state, clan, 'warchief').ok) {
    E.trainUnit(state, 'warchief', clan.id);
    return true;
  }
  if (clan.res.food < 70) return false; // feed the clan before forging swords
  if (band + clan.training.filter((t) => UNITS[t.type].warband).length >= targetBand) return false;
  let type = 'warrior';
  const forge = buildingsOfType(state, clan.id, 'forge').length;
  if (forge && clan.res.iron > 10 && state.rng() < 0.4) type = 'shield';
  else if (forge && state.rng() < 0.5) type = 'axe';
  if (E.canTrain(state, clan, type).ok) { E.trainUnit(state, type, clan.id); return true; }
  if (E.canTrain(state, clan, 'warrior').ok) { E.trainUnit(state, 'warrior', clan.id); return true; }
  return false;
}

function manageMilitary(state, clan) {
  const diff = DIFFICULTY[state.difficulty];
  const myUnits = state.units.filter((u) => u.clan === clan.id);
  const warband = myUnits.filter((u) => UNITS[u.type].warband || UNITS[u.type].hero);
  const scouts = myUnits.filter((u) => u.type === 'scout');
  const enemyUnits = state.units.filter((u) => u.clan !== clan.id);

  // explore ruins with scouts
  for (const s of scouts) {
    const st = E.tileById(state, s.tileId);
    if (st.terrain === 'ruins' && !st.ruinLooted) continue;
    if (s.destTileId != null) {
      const dt = E.tileById(state, s.destTileId);
      if (dt && !(dt.terrain === 'ruins' && !dt.ruinLooted) && s.order === 'move') { s.destTileId = null; s.path = []; }
      else if (dt) continue;
    }
    const ruins = state.tiles
      .filter((t) => t.terrain === 'ruins' && !t.ruinLooted && (t.owner == null || t.owner === clan.id))
      .map((t) => ({ t, d: E.hexDist(E.tileById(state, s.tileId), t) }))
      .sort((a, b) => a.d - b.d)[0];
    if (ruins) E.commandMove(state, [s.id], ruins.t.id);
  }

  // defend: enemy standing on our land
  const myLand = new Set(myTiles(state, clan.id).map((t) => t.id));
  const threat = enemyUnits.find((u) => myLand.has(u.tileId));
  if (threat) {
    const ids = warband.map((u) => u.id);
    if (ids.length) E.commandAttack(state, ids, threat.id, null, threat.tileId);
    return;
  }
  // enemy near our town hall
  const th = buildingsOfType(state, clan.id, 'townhall')[0];
  if (th) {
    const thTile = E.tileById(state, th.tileId);
    const near = enemyUnits.filter((u) => E.hexDist(E.tileById(state, u.tileId), thTile) <= 2);
    if (near.length) {
      const ids = warband.map((u) => u.id);
      if (ids.length) E.commandAttack(state, ids, near[0].id, null, near[0].tileId);
      return;
    }
  }

  // attack if we have the numbers
  const diff_aggro = diff.aggro;
  if (warband.length >= diff_aggro + 2) {
    // pick the juiciest enemy target: nearest enemy building.
    const enemyBuildings = [];
    for (const t of state.tiles) {
      for (const b of t.buildings) if (b.clan !== clan.id) enemyBuildings.push({ b, t });
    }
    if (enemyBuildings.length) {
      const ref = E.tileById(state, warband[0].tileId);
      enemyBuildings.sort((a, b) => {
        const pa = E.hexDist(ref, a.t) + (a.b.type === 'townhall' ? -3 : 0) + (a.b.type === 'house' ? 1 : 0);
        const pb = E.hexDist(ref, b.t) + (b.b.type === 'townhall' ? -3 : 0) + (b.b.type === 'house' ? 1 : 0);
        return pa - pb;
      });
      const { b, t } = enemyBuildings[0];
      const ids = warband.filter((u) => !UNITS[u.type].hero || warband.length > 6).map((u) => u.id);
      clampAwayFromHome(state, clan, warband);
      if (ids.length) E.commandAttack(state, ids, null, b.id, t.id);
      return;
    }
  }
  // otherwise gather near our border, but never wander off early
  if (warband.length) {
    const rally = clan.ai.rallyTile != null ? E.tileById(state, clan.ai.rallyTile) : null;
    const risky = warband.every((u) => u.order === 'attack');
    if (rally && !risky) {
      for (const u of warband) {
        if (u.destTileId === rally.id) continue;
        E.commandMove(state, [u.id], rally.id);
      }
    } else if (!rally) {
      // rally on the frontier tile closest to the enemy
      const enemy = state.starts[1 - clan.id];
      const frontier = myTiles(state, clan.id).sort((a, b) => E.hexDist(a, enemy) - E.hexDist(b, enemy))[0];
      if (frontier) clan.ai.rallyTile = frontier.id;
    }
  }
}

function clampAwayFromHome(state, clan, warband) {
  // keep at least the garrison home when attacked is not the case
  const garrison = 2;
  const th = buildingsOfType(state, clan.id, 'townhall')[0];
  if (!th || warband.length <= garrison) return;
  const home = E.tileById(state, th.tileId);
  const sorted = warband.slice().sort((a, b) => E.hexDist(E.tileById(state, a.tileId), home) - E.hexDist(E.tileById(state, b.tileId), home));
  for (const u of sorted.slice(0, garrison)) {
    if (u.order === 'attack') { u.order = 'hold'; u.targetUnitId = null; u.targetBuildingId = null; u.destTileId = null; u.path = []; }
  }
}

export function aiStep(state, dt) {
  const clan = state.clans.find((c) => c.isAI);
  if (!clan || clan.dead) return;
  if (state.time.ended) return;
  const diff = DIFFICULTY[state.difficulty];
  assignWorkers(state, clan);

  // blessings: take them, they are free-ish
  if (clan.pendingBlessing) {
    const choices = clan.pendingBlessing.choices;
    const pickId = BLESSING_PRIORITY.find((p) => choices.includes(p)) || choices[0];
    E.grantBlessing(state, clan, pickId);
  }
  if (!clan.pendingBlessing && clan.res.lore >= 40 && clan.blessings.length < 5) E.offerBlessing(state, clan);

  clan.ai.timer -= dt;
  if (clan.ai.timer > 0) { manageMilitary(state, clan); return; }
  clan.ai.timer = diff.decMag;

  manageTraining(state, clan);
  const built = manageBuildings(state, clan);
  const spareRoom = myTiles(state, clan.id).some((t) => t.buildings.length < 3);
  if (!built && (!spareRoom || clan.res.food > 120)) manageExpansion(state, clan);
  else if (!built) manageExpansion(state, clan);
  manageMilitary(state, clan);
}
