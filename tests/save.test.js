// ============================================================================
// Northhold — save/load tests.  node tests/save.test.js
// ============================================================================
import * as E from '../src/engine.js';
import { serialize, deserialize, SAVE_VERSION } from '../src/save.js';
import { aiStep } from '../src/ai.js';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
function section(t) { console.log(`\n${t}`); }
const run = (st, seconds, dt = 0.1, withAI = true) => {
  const steps = Math.ceil(seconds / dt);
  for (let i = 0; i < steps; i++) { E.step(st, dt); if (withAI) aiStep(st, dt); }
};

section('Round trip');
{
  const st = E.createGame({ clanId: 'stag', difficulty: 'hard', mapSeed: 77 });
  run(st, 240);
  const json = JSON.stringify(serialize(st));
  const back = deserialize(JSON.parse(json));
  ok(back.tiles.length === st.tiles.length, 'every tile survives', `${back.tiles.length}/${st.tiles.length}`);
  ok(back.units.length === st.units.length, 'every unit survives', `${back.units.length}/${st.units.length}`);
  const bCount = (s) => s.tiles.reduce((n, t) => n + t.buildings.length, 0);
  ok(bCount(back) === bCount(st), 'every building survives', `${bCount(back)}/${bCount(st)}`);
  ok(back.clans.length === 2, 'both clans survive');
  ok(back.clanState ?? true, 'clans intact');
  for (const k of ['food', 'wood', 'krown', 'stone', 'iron', 'lore']) {
    ok(Math.abs(back.clans[0].res[k] - st.clans[0].res[k]) < 1e-9, `${k} survives exactly`,
      `${back.clans[0].res[k]} vs ${st.clans[0].res[k]}`);
  }
  ok(back.clans[0].fame === st.clans[0].fame, 'fame survives');
  ok(back.difficulty === 'hard', 'difficulty survives');
  ok(back.clans[1].clanId === st.clans[1].clanId, 'the rival clan identity survives');
  ok(back.time.month === st.time.month, 'time survives', `${back.time.month} vs ${st.time.month}`);
  ok(json.length < 400000, 'save files stay small', Math.round(json.length / 1024) + ' KB');
  // derived maps must be rebuilt, not restored blindly
  ok(back.tileById.size === back.tiles.length, 'tileById rebuilt');
  ok(back.tileByKey.size === back.tiles.length, 'tileByKey rebuilt');
  ok(back.units.every((u) => back.tileById.get(u.tileId)), 'every unit points at a real tile');
  ok([...back.buildingsById.values()].every((b) => back.tileById.get(b.tileId)), 'every building points at a real tile');
  ok(back.tiles.every((t) => Number.isFinite(t.x) && Number.isFinite(t.y)), 'world coordinates recomputed');
}

section('Reloaded game continues identically (determinism)');
{
  const a = E.createGame({ clanId: 'raven', difficulty: 'normal', mapSeed: 909 });
  run(a, 200);
  const snapshot = JSON.parse(JSON.stringify(serialize(a)));
  const b = deserialize(snapshot);
  // both timelines advance from the same moment
  run(a, 200);
  run(b, 200);
  for (const k of ['food', 'wood', 'krown', 'stone', 'iron', 'lore']) {
    ok(Math.abs(a.clans[0].res[k] - b.clans[0].res[k]) < 1e-6, `player ${k} matches after reload`,
      `${a.clans[0].res[k].toFixed(4)} vs ${b.clans[0].res[k].toFixed(4)}`);
  }
  ok(Math.abs(a.clans[1].res.food - b.clans[1].res.food) < 1e-6, 'AI food matches after reload',
    `${a.clans[1].res.food.toFixed(4)} vs ${b.clans[1].res.food.toFixed(4)}`);
  ok(a.clans[0].fame === b.clans[0].fame && a.clans[1].fame === b.clans[1].fame, 'fame tracked identically');
  ok(a.tiles.filter((t) => t.owner === 1).length === b.tiles.filter((t) => t.owner === 1).length,
    'territory tracked identically');
  ok(a.units.length === b.units.length, 'unit counts match', `${a.units.length}/${b.units.length}`);
  ok(a.tiles.map((t) => t.buildings.length).join() === b.tiles.map((t) => t.buildings.length).join(),
    'buildings tracked identically');
  ok(JSON.stringify(a.clans[0].blessings) === JSON.stringify(b.clans[0].blessings), 'blessings match');
}

section('Mid-combat save');
{
  const st = E.createGame({ clanId: 'wolf', difficulty: 'normal', mapSeed: 303 });
  for (const c of st.clans) { c.res.food = 900; c.res.krown = 900; c.res.wood = 900; c.res.stone = 900; }
  const bar = E.build(st, st.starts[0].id, 'barracks').building;
  run(st, 20, 0.1, false);
  ok(bar.done, 'barracks ready for the assault');
  const hero = E.spawnUnit(st, 0, 'warchief', E.tileById(st, st.starts[0].id));
  const enemyTH = E.buildingsOf(st, 1, 'townhall')[0];
  const enemyTile = E.tileById(st, enemyTH.tileId);
  E.commandAttack(st, [hero.id], null, enemyTH.id, enemyTile.id);
  run(st, 20, 0.1, false);
  ok(hero.hp > 0, 'the warchief survives the march');
  ok(enemyTH.hp < enemyTH.maxHp, 'the enemy hall is taking damage', enemyTH.hp.toFixed(1));
  const back = deserialize(JSON.parse(JSON.stringify(serialize(st))));
  const u2 = back.unitById.get(hero.id);
  ok(!!u2, 'the attacking hero survives the round trip');
  if (u2) {
    ok(u2.targetBuildingId === hero.targetBuildingId, 'attack orders survive', `${u2.targetBuildingId}`);
    ok(u2.path.length === hero.path.length, 'queued movement survives', `${u2.path.length} vs ${hero.path.length}`);
    ok(Math.abs(u2.hp - hero.hp) < 1e-9, 'wounded units keep their wounds');
  }
  const b2 = back.buildingsById.get(enemyTH.id);
  ok(!!b2 && Math.abs(b2.hp - enemyTH.hp) < 1e-9, 'damaged buildings keep their damage');
  ok(back.time.ended === st.time.ended, 'a finished game stays finished');
}

section('Bad input');
{
  const bad = [
    [null, 'null'],
    [{}, 'empty object'],
    [{ v: 99, tiles: [], clans: [], units: [] }, 'future version'],
  ];
  for (const [data, label] of bad) {
    let threw = false;
    try { deserialize(data); } catch { threw = true; }
    ok(threw, `deserialize rejects ${label}`);
  }
  const st = E.createGame({ clanId: 'wolf', difficulty: 'normal', mapSeed: 5 });
  const data = serialize(st);
  ok(data.v === SAVE_VERSION, 'saves carry a format version');
  // a file with a missing optional section must still load
  delete data.stats;
  delete data.log;
  const recovered = deserialize(data);
  ok(recovered.stats.kills === 0, 'missing stats section is defaulted');
  ok(Array.isArray(recovered.log), 'missing log is defaulted');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
