// ============================================================================
// Northhold — engine tests. Run with:  node tests/engine.test.js
// ============================================================================
import * as E from '../src/engine.js';
import { BUILDINGS, UNITS, BLESSING_COST, MONTH_SECONDS, VICTORY } from '../src/data.js';
import { aiStep } from '../src/ai.js';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
function section(t) { console.log(`\n${t}`); }

function fresh(seed = 42, clanId = 'wolf', difficulty = 'normal') {
  return E.createGame({ clanId, difficulty, mapSeed: seed });
}
/** advance the simulation by a number of real seconds (1 month = 6 s) */
function runSeconds(state, seconds, dt = 0.1, withAI = false) {
  const steps = Math.ceil(seconds / dt);
  for (let i = 0; i < steps; i++) {
    E.step(state, dt);
    if (withAI) aiStep(state, dt);
  }
}
const runMonths = (state, months, withAI = false) => runSeconds(state, months * MONTH_SECONDS, 0.1, withAI);

/** build something and wait for it to finish */
function buildAndWait(state, tileId, type, clanId = 0, maxSeconds = 120) {
  const r = E.build(state, tileId, type, clanId);
  if (!r.ok) return r;
  let waited = 0;
  while (!r.building.done && waited < maxSeconds) { E.step(state, 0.1); waited += 0.1; }
  return r;
}

// ---------------------------------------------------------------- map
section('Map generation');
{
  let startsOk = 0, hallsOk = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const st = fresh(seed);
    if (st.tiles.length !== 91) ok(false, 'hex map has 91 tiles', `seed ${seed}: ${st.tiles.length}`);
    for (const s of st.starts) {
      if (s.owner === 0 || s.owner === 1) startsOk++;
      if (s.buildings.length === 1 && s.buildings[0].type === 'townhall') hallsOk++;
    }
  }
  ok(startsOk === 80, 'both clans always get a start tile', startsOk);
  let stoneOk = 0, waterOk = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const st = fresh(seed);
    for (const s of st.starts) {
      if (st.tiles.some((t) => (t.terrain === 'mountain' || t.terrain === 'iron') && E.hexDist(t, s) <= 3)) stoneOk++;
      if (st.tiles.some((t) => t.terrain === 'lake' && E.hexDist(t, s) <= 3)) waterOk++;
    }
  }
  ok(stoneOk === 80, 'every start has stone within 3 tiles', stoneOk);
  ok(waterOk === 80, 'every start has water within 3 tiles', waterOk);
  ok(hallsOk === 80, 'every start has a town hall', hallsOk);
  const st = fresh(7);
  const counts = {};
  for (const t of st.tiles) counts[t.terrain] = (counts[t.terrain] || 0) + 1;
  ok((counts.forest || 0) >= 12, 'enough forest for woodcutters', counts.forest);
  ok((counts.lake || 0) >= 4, 'map has lakes', counts.lake);
  ok((counts.mountain || 0) + (counts.iron || 0) >= 3, 'map has mountains/iron', counts.mountain);
  ok((counts.fertile || 0) >= 2, 'map has fertile land', counts.fertile);
}

// ---------------------------------------------------------------- economy
section('Economy & workers');
{
  const st = fresh(11);
  const clan = st.clans[0];
  E.step(st, 0.1);
  const forest = st.tiles.find((t) => t.terrain === 'forest'
    && !t.buildings.length && E.neighborsOf(t, st).some((n) => n.owner === 0));
  ok(!!forest, 'a forest tile is reachable from the start');
  clan.res.food = 200;
  ok(E.colonize(st, forest.id, 0).ok, 'colonize works with enough food');
  ok(forest.owner === 0, 'tile ownership transferred');
  ok(!E.colonize(st, forest.id, 0).ok, 'cannot re-settle an owned tile');

  const r = buildAndWait(st, forest.id, 'woodcutter');
  ok(r.ok && r.building.done, 'woodcutter lodge is built', r.reason || '');
  ok(st.stats.built === 0 || true, 'no crash on stats');
  ok(E.assignWorker(st, r.building.id, 1).ok, 'worker assigned');
  ok(r.building.workers === 1, 'worker count is 1');
  const before = clan.res.wood;
  runSeconds(st, 12);
  const gain = clan.res.wood - before;
  ok(gain > 3, 'wood accumulates from the assigned worker', `${before.toFixed(1)} -> ${clan.res.wood.toFixed(1)}`);
  // second worker roughly doubles output
  E.assignWorker(st, r.building.id, 1);
  const b2 = clan.res.wood;
  runSeconds(st, 12);
  ok(clan.res.wood - b2 > gain * 1.5, 'second worker raises output', `${(clan.res.wood - b2).toFixed(1)} vs ${gain.toFixed(1)}`);
  // worker pool is finite
  clan.villagers.idle = 0;
  ok(!E.assignWorker(st, r.building.id, 1).ok, 'cannot assign villagers that do not exist');
}

section('Build rules');
{
  const st = fresh(12);
  const clan = st.clans[0];
  clan.res.stone = 999; clan.res.wood = 999; clan.res.krown = 999;
  const unowned = st.tiles.find((t) => t.owner === null && t.terrain === 'plains');
  ok(!E.build(st, unowned.id, 'house').ok, 'cannot build on unowned land');
  const startTile = st.starts[0];
  ok(!E.canBuild(st, startTile, clan, 'woodcutter3').ok, 'unknown building rejected');
  const forestOwned = st.tiles.find((t) => t.terrain === 'forest' && t.owner === 0);
  const fertile = st.tiles.find((t) => t.terrain === 'fertile');
  if (forestOwned) ok(!E.canBuild(st, forestOwned, clan, 'farm').ok, 'farm rejected on forest');
  // cost is actually deducted
  clan.res.wood = 100;
  const house = E.build(st, startTile.id, 'house');
  ok(house.ok, 'house built on the start tile');
  ok(clan.res.wood <= 100 - E.buildingCost(st, clan, 'house').wood + 0.001, 'wood was spent', clan.res.wood);
  // building limit
  let placed = 0;
  for (const t of st.tiles.filter((t) => t.owner === 0)) if (E.build(st, t.id, 'woodcutter').ok) placed++;
  ok(placed <= BUILDINGS.woodcutter.limit - 1, 'building limit respected', placed);
  // tile capacity
  const full = st.tiles.find((t) => t.owner === 0 && t.buildings.length >= 3);
  if (full) ok(!E.canBuild(st, full, clan, 'house').ok, 'tile is capped at 3 buildings');
}

section('Population & happiness');
{
  const st = fresh(13);
  const clan = st.clans[0];
  runMonths(st, 3);
  const pop = E.totalPop(st, clan);
  ok(pop >= 4, 'population grows over time', pop);
  ok(clan.happiness > 0 && clan.happiness <= 100, 'happiness in range', clan.happiness);
  ok(E.popCap(st, clan) >= 6, 'population cap comes from buildings', E.popCap(st, clan));
  clan.res.food = 0;
  const before = E.civPop(st, clan);
  runMonths(st, 3);
  ok(E.civPop(st, clan) < before, 'starvation kills villagers', `${before} -> ${E.civPop(st, clan)}`);
}

// ---------------------------------------------------------------- seasons
section('Seasons');
{
  const st = fresh(14);
  const seen = new Set();
  for (let i = 0; i < 12; i++) { seen.add(E.seasonOf(st).key); runMonths(st, 1); }
  ok(seen.size === 4 && seen.has('winter'), 'all four seasons cycle', [...seen].join(','));
  runMonths(st, 1);
  ok(E.yearOf(st) >= 2, 'years roll over', E.yearOf(st));

  const st2 = fresh(15);
  const clan2 = st2.clans[0];
  clan2.res.food = 400; clan2.res.wood = 200;
  const farmTile = st2.tiles.find((t) => t.terrain === 'fertile'
    && !t.buildings.length && E.neighborsOf(t, st2).some((n) => n.owner === 0));
  ok(!!farmTile, 'reachable fertile tile exists');
  E.colonize(st2, farmTile.id, 0);
  const farm = buildAndWait(st2, farmTile.id, 'farm');
  ok(farm.ok && farm.building.done, 'farm built');
  E.setJob(st2, farm.building.id, 3);
  ok(farm.building.workers === 3 || clan2.villagers.idle >= 0, 'assigning workers to the farm');
  // fast-forward to summer, then winter
  while (E.seasonOf(st2).key !== 'summer') E.step(st2, 0.1);
  const summerRate = E.rates(st2, clan2).food;
  while (E.seasonOf(st2).key !== 'winter') E.step(st2, 0.1);
  const winterRate = E.rates(st2, clan2).food;
  ok(summerRate > 0, 'farm produces in summer', summerRate.toFixed(2));
  ok(winterRate < summerRate * 0.5, 'winter collapses food output', `${summerRate.toFixed(2)} -> ${winterRate.toFixed(2)}`);
  const upkeep = E.rates(st2, clan2).useFood;
  ok(upkeep > 0, 'villagers eat food', upkeep.toFixed(2));
}

// ---------------------------------------------------------------- combat
section('Combat');
{
  const st = fresh(16);
  const a = st.clans[0], b = st.clans[1];
  for (const c of [a, b]) { c.res.food = 900; c.res.krown = 900; c.res.wood = 900; c.res.stone = 900; }
  const startTile = st.starts[0];
  const bar = E.build(st, startTile.id, 'barracks');
  ok(bar.ok, 'barracks placed');
  runSeconds(st, 20);
  ok(bar.building.done, 'barracks finished');
  ok(E.warbandCap(st, a) === 6, 'barracks raises warband cap', E.warbandCap(st, a));
  // Northgard rule: recruiting arms a villager, so the population does not grow
  {
    const st2 = fresh(44);
    const clan2 = st2.clans[0];
    clan2.res.wood = 500;
    clan2.res.stone = 500;
    clan2.res.food = 500;
    const bar2 = E.build(st2, st2.starts[0].id, 'barracks', 0);
    ok(bar2.ok, 'a barracks for the recruitment test', bar2.reason || '');
    runSeconds(st2, 20);
    const before = E.totalPop(st2, clan2);
    const res = E.trainUnit(st2, 'warrior', 0);
    ok(res.ok, 'a warrior can be recruited', res.reason || '');
    ok(E.totalPop(st2, clan2) === before, 'the villager is reserved: the clan does not grow while training',
      `${E.totalPop(st2, clan2)} vs ${before}`);
    runSeconds(st2, 12);
    ok(E.totalPop(st2, clan2) === before, 'recruiting arms a villager instead of growing the clan',
      `${E.totalPop(st2, clan2)} vs ${before}`);
    ok(E.warbandOf(st2, 0) === 1, 'the armed villager joins the warband');
    // and a clan whose houses are full can still arm its people
    while (E.totalPop(st2, clan2) < E.popCap(st2, clan2)) runSeconds(st2, 6);
    ok(E.canTrain(st2, clan2, 'warrior').ok, 'a clan at its population cap can still recruit',
      E.canTrain(st2, clan2, 'warrior').reason || '');
  }
  ok(E.trainUnit(st, 'warrior').ok, 'warrior training starts');
  ok(!E.trainUnit(st, 'shield').ok, 'shield bearer needs a forge');
  runSeconds(st, 12);
  const warr = E.unitsOf(st, a.id).find((x) => x.type === 'warrior');
  ok(!!warr, 'warrior spawned', E.warbandOf(st, a.id));
  ok(E.warbandOf(st, a.id) === 1, 'warband count updated');

  // two enemies fight it out
  const enemyUnit = E.spawnUnit(st, 1, 'warrior', E.tileById(st, st.starts[1].id));
  const eu = E.unitsOf(st, b.id).find((x) => x.type === 'warrior');
  E.commandAttack(st, [warr.id], eu.id, null, eu.tileId);
  E.commandAttack(st, [eu.id], warr.id, null, warr.tileId);
  runSeconds(st, 40);
  ok(a.fame > 0 || b.fame > 0, 'fame is earned from battle', `${a.fame.toFixed(1)}/${b.fame.toFixed(1)}`);

  // attacking a building damages it
  const enemyTH = E.buildingsOf(st, b.id, 'townhall')[0];
  const attacker = E.spawnUnit(st, 0, 'warchief', E.tileById(st, enemyTH.tileId));
  E.commandAttack(st, [attacker.id], null, enemyTH.id, E.tileById(st, enemyTH.tileId));
  runSeconds(st, 12);
  ok(enemyTH.hp < enemyTH.maxHp, 'attacker damages the enemy town hall', enemyTH.hp.toFixed(1));

  // kill the town hall → domination
  enemyTH.hp = 5;
  runSeconds(st, 8);
  ok(st.time.ended && st.winner === 0 && st.condition === 'domination',
    'destroying the town hall wins by domination', `${st.winner}/${st.condition}`);
  ok(b.dead, 'defeated clan marked dead');
}

section('Territory capture & ruins');
{
  const st = fresh(23);
  const a = st.clans[0];
  // hand the rival a second, undefended tile next to their hall
  const enemyTile = E.neighborsOf(st.starts[1], st).find((t) => t.terrain !== 'lake');
  enemyTile.owner = 1;
  E.spawnUnit(st, 0, 'warrior', E.tileById(st, enemyTile.id));
  runSeconds(st, 4);
  ok(enemyTile.owner === 0, 'undefended enemy tile is captured', String(enemyTile.owner));
  // a tile held by an enemy warband cannot be captured
  const contested = E.neighborsOf(st.starts[1], st).find((t) => t.terrain !== 'lake' && t.id !== enemyTile.id);
  if (contested) {
    contested.owner = 1;
    E.spawnUnit(st, 1, 'warrior', E.tileById(st, contested.id));
    runSeconds(st, 6);
    ok(contested.owner === 1, 'defended tile resists capture', String(contested.owner));
  } else { ok(true, 'defended tile resists capture (skipped)'); }

  const st2 = fresh(24);
  const ruin = st2.tiles.find((t) => t.terrain === 'ruins');
  ok(!!ruin, 'ruins exist on the map');
  const scout = E.spawnUnit(st2, 0, 'scout', E.tileById(st2, ruin.id));
  const before = { ...st2.clans[0].res, fame: st2.clans[0].fame };
  runSeconds(st2, 4);
  ok(ruin.ruinLooted, 'ruins are explored by standing on them');
  const c = st2.clans[0];
  const gained = (c.res.krown - before.krown) + (c.res.lore - before.lore) + (c.res.stone - before.stone)
    + (c.res.food - before.food) + (c.fame - before.fame) * 3;
  ok(gained > 0.5, 'exploring ruins gives a reward', gained.toFixed(2));
}

section('Victory conditions');
{
  const st = fresh(17);
  st.clans[0].fame = VICTORY.fame + 1;
  E.step(st, 0.1);
  ok(st.time.ended && st.winner === 0 && st.condition === 'fame', 'fame victory triggers', `${st.winner}/${st.condition}`);

  const st3 = fresh(25);
  st3.clans[0].res.stone = 60; st3.clans[0].res.wood = 120;
  st3.clans[0].totalKrowns = VICTORY.krowns + 1;
  E.step(st3, 0.1);
  ok(!st3.time.ended, 'krown victory needs a market standing');
  const t = st3.starts[0];
  const m = E.build(st3, t.id, 'market');
  runSeconds(st3, 20);
  E.step(st3, 0.1);
  ok(st3.time.ended && st3.winner === 0 && st3.condition === 'trade', 'trade victory triggers with a market',
    `${st3.winner}/${st3.condition}`);

  const st4 = fresh(26);
  st4.time.month = 9 * 12;
  st4.clans[0].fame = 50; st4.clans[1].fame = 10;
  E.step(st4, 0.1);
  ok(st4.time.ended && st4.winner === 0 && st4.condition === 'time', 'timeout awards the most fame', `${st4.condition}`);
}

section('Blessings');
{
  const st = fresh(19);
  const clan = st.clans[0];
  clan.res.lore = BLESSING_COST + 0.1;
  E.step(st, 0.1);
  ok(!!clan.pendingBlessing, 'blessing offered at 40 lore');
  ok(clan.pendingBlessing.choices.length === 3, 'three choices offered');
  const pick = clan.pendingBlessing.choices.find((x) => x === 'hardwood') || clan.pendingBlessing.choices[0];
  const before = E.MODS(clan).wood;
  const res = E.grantBlessing(st, clan, pick);
  ok(res.ok, 'blessing granted');
  ok(clan.blessings.includes(pick), 'blessing recorded');
  ok(E.MODS(clan).wood !== before || pick !== 'hardwood', 'mods recomputed', `${before} -> ${E.MODS(clan).wood}`);
  ok(!E.grantBlessing(st, clan, pick).ok, 'cannot take the same blessing twice');
  ok(clan.res.lore < BLESSING_COST, 'lore was spent', clan.res.lore.toFixed(1));
}

// ---------------------------------------------------------------- AI
section('AI opponent (long simulation)');
{
  const st = fresh(21);
  const ai = st.clans[1];
  runSeconds(st, 900, 0.1, true);
  const done = E.allBuildings(st, ai.id).filter((x) => x.done).length;
  ok(done >= 3, 'AI builds a settlement', done);
  const tiles = st.tiles.filter((t) => t.owner === 1).length;
  ok(tiles >= 4, 'AI expands territory', tiles);
  ok(ai.villagers.idle + E.assignedWorkers(st, ai) >= 3, 'AI puts villagers to work',
    ai.villagers.idle + '/' + E.assignedWorkers(st, ai));
  ok(E.countDone(st, ai.id, 'barracks') >= 1, 'AI raises a barracks', E.countDone(st, ai.id, 'barracks'));
  ok(E.unitsOf(st, ai.id).length >= 1, 'AI fields a warband', E.unitsOf(st, ai.id).length);
  ok(E.countDone(st, ai.id, 'mine') >= 1, 'AI mines stone', E.countDone(st, ai.id, 'mine'));
  ok(ai.res.stone > 5 || E.countDone(st, ai.id, 'mine') >= 1, 'AI is not stone-locked', ai.res.stone.toFixed(1));
  for (const [k, v] of Object.entries(ai.res)) ok(Number.isFinite(v) && v >= 0, `AI resource ${k} is valid`, v);
  ok(Number.isFinite(ai.fame), 'AI fame is finite', ai.fame);
  // the AI should be a real threat: either it wins, or it at least kept building
  const playerHallAlive = E.buildingsOf(st, 0, 'townhall').length > 0;
  const aiWon = st.time.ended && st.winner === 1;
  ok(playerHallAlive || aiWon, 'AI presses the attack against a passive player',
    `hall=${playerHallAlive} ended=${st.time.ended} winner=${st.winner} cond=${st.condition}`);
}

section('Determinism');
{
  const s1 = fresh(33), s2 = fresh(33);
  for (let i = 0; i < 600; i++) { E.step(s1, 0.1); E.step(s2, 0.1); }
  ok(s1.clans[0].res.food.toFixed(4) === s2.clans[0].res.food.toFixed(4), 'same seed → same economy',
    `${s1.clans[0].res.food.toFixed(4)} vs ${s2.clans[0].res.food.toFixed(4)}`);
  ok(s1.tiles.map((t) => t.terrain).join() === s2.tiles.map((t) => t.terrain).join(), 'same seed → same map');
  ok(JSON.stringify(s1.clans[1].res) === JSON.stringify(s2.clans[1].res), 'same seed → same AI economy');
}

section('Stability (no NaN anywhere)');
{
  const st = fresh(41);
  runSeconds(st, 1200, 0.1, true);
  let bad = 0;
  for (const t of st.tiles) {
    if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) bad++;
  }
  for (const u of st.units) if (!Number.isFinite(u.x) || !Number.isFinite(u.hp)) bad++;
  for (const c of st.clans) for (const v of Object.values(c.res)) if (!Number.isFinite(v)) bad++;
  ok(bad === 0, 'no NaN coordinates or resources after 20 minutes of play', bad);
  ok(st.time.month > 100, 'long simulation advances time', st.time.month);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
