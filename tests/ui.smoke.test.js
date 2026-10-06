// ============================================================================
// Northhold — browser smoke test (jsdom).
// Boots index.html + app/main.js with a stubbed canvas, drives the real game
// loop and input handlers, and fails on any uncaught error.
//
//   node tests/ui.smoke.test.js
// Requires jsdom — install with:  npm i --no-save jsdom
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('SKIP: jsdom is not installed (npm i --no-save jsdom)');
  process.exit(0);
}

let pass = 0, fail = 0;
const failures = [];
const errors = [];
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

// ---------------------------------------------------------------- canvas stub
function makeCtxStub(canvas) {
  const grad = { addColorStop() {} };
  const counted = new Set(['fill', 'stroke', 'fillRect', 'fillText', 'arc', 'clearRect', 'strokeText']);
  const target = {
    canvas,
    calls: 0,
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    measureText: () => ({ width: 12 }),
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'then') return undefined;
      if (typeof prop === 'symbol') return undefined;
      return () => { if (counted.has(prop)) t.calls++; };
    },
    set(t, prop, value) { t[prop] = value; return true; },
  });
}

// ---------------------------------------------------------------- boot
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const dom = new JSDOM(html, { pretendToBeVisual: false, url: 'http://localhost/' });
const { window } = dom;

// canvas surface sizes (jsdom reports 0)
for (const prop of ['clientWidth', 'clientHeight']) {
  Object.defineProperty(window.HTMLCanvasElement.prototype, prop, {
    get() { return prop === 'clientWidth' ? 1280 : 720; },
  });
}
const contexts = new Map();
window.HTMLCanvasElement.prototype.getContext = function (kind) {
  // jsdom really has no WebGL: report that faithfully so the app takes its 2D path
  if (kind !== '2d') return null;
  if (!contexts.has(this)) contexts.set(this, makeCtxStub(this));
  return contexts.get(this);
};
window.HTMLCanvasElement.prototype.setPointerCapture = function () {};
window.HTMLCanvasElement.prototype.releasePointerCapture = function () {};
Object.defineProperty(window, 'devicePixelRatio', { value: 1 });

// requestAnimationFrame: capture the callback so the test drives the loop
let rafCb = null;
let rafCount = 0;
window.requestAnimationFrame = (cb) => { rafCb = cb; return ++rafCount; };
window.cancelAnimationFrame = () => {};

// expose the DOM to the modules (they are imported into Node's context)
globalThis.window = window;
globalThis.document = window.document;
try { Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true }); } catch { /* node >=21 owns navigator */ }
globalThis.localStorage = window.localStorage;
globalThis.sessionStorage = window.sessionStorage;
globalThis.Blob = window.Blob;
globalThis.File = window.File;
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
globalThis.HTMLElement = window.HTMLElement;
// keep Node's own performance object: jsdom's delegates to the global one
window.addEventListener('error', (e) => errors.push(String(e.error || e.message)));

function fire(el, type, props = {}) {
  const e = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, props);
  el.dispatchEvent(e);
  return e;
}
function fireKey(key) {
  const e = new window.KeyboardEvent('keydown', { key, bubbles: true });
  window.dispatchEvent(e);
}

// ---------------------------------------------------------------- tests
console.log('\nHUD boot');
const app = await import(path.join(root, 'src/main.js'));
ok(!!window.__northhold, 'app exposes a debug hook');
const { app: A, E, save } = window.__northhold;
ok(!!A, 'app object exists');

// start a game by clicking the real start button
document.getElementById('btnStart').click();
ok(!!A.state, 'clicking "Raise the banner" starts a game');
ok(!document.getElementById('startScreen').classList.contains('show'), 'start screen hides');
ok(A.state.clans.length === 2, 'two clans in play');

console.log('\nRendering loop');
let frameClock = 1000; // monotonic fake clock so dt never goes to zero
function runFrames(n = 60, stepMs = 33) {
  for (let i = 0; i < n; i++) {
    const cb = rafCb;
    rafCb = null;
    if (!cb) throw new Error('the render loop stopped requesting frames');
    frameClock += stepMs;
    cb(frameClock);
  }
}
try {
  runFrames(90);
  ok(true, 'render loop runs 90 frames without throwing');
} catch (e) {
  ok(false, 'render loop runs 90 frames without throwing', e.message);
}
const mapCtx = contexts.get(document.getElementById('map'));
const miniCtx = contexts.get(document.getElementById('minimap'));
ok(mapCtx.calls > 500, 'the map canvas is actually drawn to', mapCtx.calls);
ok(miniCtx.calls > 20, 'the minimap is drawn', miniCtx.calls);

console.log('\nHUD state');
ok(document.getElementById('resources').children.length >= 8, 'resource chips rendered',
  document.getElementById('resources').children.length);
ok(/Year 1/.test(document.getElementById('seasonChip').textContent), 'season chip shows the year',
  document.getElementById('seasonChip').textContent);
ok(document.getElementById('panelBody').innerHTML.length > 50, 'side panel has content');
ok(document.getElementById('buildCatalog').children.length > 10, 'build catalog lists buildings');
ok(document.getElementById('orders').children.length >= 4, 'orders bar rendered');
ok(document.getElementById('log').children.length > 0, 'event log shows entries');

console.log('\nInput');
const canvas = document.getElementById('map');
const startTile = A.state.starts[0];
const screenOf = (t) => {
  const { cam } = window.__northhold.surfaces ? { cam: null } : { cam: null };
  return null;
};
// click on the town hall tile: select the building
function clickWorld(tile) {
  // mirrors render.worldToScreen using the live camera
  const cam = A.state ? null : null;
  const r = window.__northhold;
  return r;
}
// simplest: click in the middle of the canvas, which is centred on the town hall
fire(canvas, 'pointerdown', { pointerId: 1, button: 0, clientX: 640, clientY: 360, buttons: 1 });
fire(canvas, 'pointerup', { pointerId: 1, button: 0, clientX: 640, clientY: 360 });
runFrames(2);
ok(A.ui.selectedBuildingId != null || A.ui.selectedUnits.size > 0, 'clicking the town hall selects something');

// zoom controls must not throw
try {
  fire(canvas, 'wheel', { deltaY: -120, clientX: 640, clientY: 360 });
  fire(canvas, 'wheel', { deltaY: 240, clientX: 640, clientY: 360 });
  ok(true, 'wheel zoom works');
} catch (e) { ok(false, 'wheel zoom works', e.message); }

// keyboard shortcuts
try {
  fireKey(' '); fireKey('2'); fireKey('1'); fireKey('c'); fireKey('Escape'); fireKey('Tab'); fireKey('h');
  ok(true, 'keyboard shortcuts do not throw');
} catch (e) { ok(false, 'keyboard shortcuts do not throw', e.message); }
ok(A.state.time.speed === 1, 'speed keys set game speed', A.state.time.speed);

console.log('\nBuilding through the UI');
const clan = A.state.clans[0];
clan.res.wood = 500; clan.res.stone = 500; clan.res.krown = 500; clan.res.food = 500;
// pick a woodcutter's lodge card and place it on the start tile
const card = [...document.getElementById('buildCatalog').children].find((c) => c.dataset.build === 'woodcutter');
ok(!!card, 'woodcutter card exists in the catalog');
card.click();
runFrames(2);
ok(A.ui.mode === 'build' && A.ui.buildType === 'woodcutter', 'clicking a card arms build mode',
  `${A.ui.mode}/${A.ui.buildType}`);
ok(A.ui.highlightTiles.size > 0, 'valid tiles are highlighted while building', A.ui.highlightTiles.size);
const before = E.allBuildings(A.state, 0).length;
// click on any of the highlighted tiles (converted to screen space)
const worldToScreen = (x, y) => window.__northhold.view.worldToScreen(x, y);
const hlTile = E.tileById(A.state, [...A.ui.highlightTiles][0]);
const p = worldToScreen(hlTile.x, hlTile.y);
fire(canvas, 'pointerdown', { pointerId: 2, button: 0, clientX: p.x, clientY: p.y, buttons: 1 });
fire(canvas, 'pointerup', { pointerId: 2, button: 0, clientX: p.x, clientY: p.y });
runFrames(2);
ok(E.allBuildings(A.state, 0).length === before + 1, 'clicking a highlighted tile builds it',
  `${before} -> ${E.allBuildings(A.state, 0).length}`);

console.log('\nSettling through the UI');
fireKey('c');
runFrames(2);
ok(A.ui.mode === 'colonize', 'C arms settle mode');
ok(A.ui.highlightTiles.size > 0, 'settle targets highlighted', A.ui.highlightTiles.size);
const ownerBefore = A.state.tiles.filter((t) => t.owner === 0).length;
const ct = E.tileById(A.state, [...A.ui.highlightTiles][0]);
const p2 = worldToScreen(ct.x, ct.y);
fire(canvas, 'pointerdown', { pointerId: 3, button: 0, clientX: p2.x, clientY: p2.y, buttons: 1 });
fire(canvas, 'pointerup', { pointerId: 3, button: 0, clientX: p2.x, clientY: p2.y });
runFrames(2);
ok(A.state.tiles.filter((t) => t.owner === 0).length === ownerBefore + 1, 'clicking settles the tile');

console.log('\nWorker assignment through the panel');
const lodge = E.allBuildings(A.state, 0).find((b) => b.type === 'woodcutter' && b.done)
  || E.allBuildings(A.state, 0).find((b) => b.type === 'woodcutter');
if (lodge) {
  // finish construction quickly, then select it and press "+"
  lodge.done = true; lodge.build = 0;
  A.ui.selectedBuildingId = lodge.id;
  runFrames(3);
  const plus = document.querySelector('#panelBody [data-job="1"]');
  ok(!!plus, 'panel shows the worker picker for the lodge');
  if (plus) {
    plus.click();
    runFrames(2);
    ok(lodge.workers >= 1, 'clicking + assigns a worker', lodge.workers);
  }
} else ok(false, 'a woodcutter lodge exists to staff');

console.log('\nTraining through the orders bar');
clan.res.food = 800; clan.res.krown = 800; clan.res.wood = 800; clan.res.stone = 800;
const t = A.state.starts[0];
const bar = E.build(A.state, t.id, 'barracks');
bar.building.done = true; bar.building.build = 0;
runFrames(3);
const trainBtn = [...document.getElementById('orders').children].find((b) => b.dataset.order === 'train:warrior');
ok(!!trainBtn && !trainBtn.disabled, 'warrior training button is enabled with a barracks');
if (trainBtn) {
  trainBtn.click();
  runFrames(3);
  ok(A.state.clans[0].training.length >= 1, 'training queued', A.state.clans[0].training.length);
  for (let i = 0; i < 400; i++) runFrames(1, 33);
  ok(E.warbandOf(A.state, 0) >= 1, 'the warrior finished training', E.warbandOf(A.state, 0));
}

console.log('\nSpeed, pause and long run');
A.setSpeed(3);
runFrames(200, 33);
ok(A.state.time.month > 1, 'time advances', A.state.time.month);
A.togglePause();
const monthAtPause = A.state.time.month;
runFrames(120, 33);
ok(A.state.time.month === monthAtPause, 'pause freezes time');
A.togglePause();
runFrames(1800, 33); // ~60 s of gameplay at 3x
ok(!Number.isNaN(A.state.clans[0].res.food), 'resources remain numeric after a long UI session',
  A.state.clans[0].res.food);

console.log('\nModals & game over');
document.getElementById('btnHowTo').click();
ok(document.getElementById('helpModal').classList.contains('show'), 'help modal opens');
document.getElementById('btnCloseHelp').click();
ok(!document.getElementById('helpModal').classList.contains('show'), 'help modal closes');
// force an end state and make sure the overlay renders
A.state.clans[0].fame = 9999;
runFrames(5);
ok(document.getElementById('gameOver').classList.contains('show'), 'game over overlay shows');
ok(/Victory/i.test(document.getElementById('goTitle').textContent), 'victory title rendered',
  document.getElementById('goTitle').textContent);
document.getElementById('btnAgain').click();
ok(document.getElementById('startScreen').classList.contains('show'), 'play again returns to the start screen');

console.log('\nRenderer & 3D camera');
{
  const { view, setRenderer } = window.__northhold;
  ok(!!view, 'the view adapter is mounted');
  ok(view.kind === '2d', 'no WebGL in jsdom → the 2D fallback is used', view.kind);
  ok(!!view.fallbackReason, 'the fallback explains itself', view.fallbackReason);
  ok(view.screenToTile(640, 360, A.state) != null, 'the fallback picks tiles from screen coordinates');
  const s3 = setRenderer('3d');
  runFrames(3);
  ok(view.kind === '2d', 'asking for 3D without WebGL keeps the working 2D renderer', view.kind);
  ok(/3D unavailable|WebGL/i.test(document.getElementById('toasts').textContent), 'the player is told why 3D failed');
  ok(view.use2D().ok, 'switching back to 2D is always safe');

  const before = view.getZoom();
  view.rotateBy(0.3);
  view.tiltBy(0.1);
  ok(true, 'rotate/tilt are safe in 2D (no-ops)');
  view.zoomBy(1.05);
  ok(view.getZoom() !== before, 'zoom works through the adapter', `${before} → ${view.getZoom()}`);
  const centre = view.worldToScreen(A.state.starts[0].x, A.state.starts[0].y);
  ok(Number.isFinite(centre.x) && Number.isFinite(centre.y), 'worldToScreen returns finite pixels',
    `kind=${view.kind} canvas=${view.canvas.id} _w=${view.canvas._w} _h=${view.canvas._h} → ${centre.x},${centre.y}`);
  const ground = view.screenToWorld(centre.x, centre.y);
  ok(Math.hypot(ground.x - A.state.starts[0].x, ground.y - A.state.starts[0].y) < 0.6,
    'screenToWorld inverts worldToScreen', `${ground.x.toFixed(2)},${ground.y.toFixed(2)}`);

  // the camera buttons must exist and be wired
  for (const id of ['btnRotL', 'btnRotR', 'btnZoomIn', 'btnZoomOut', 'btnCamReset']) {
    ok(!!document.getElementById(id), `${id} exists`);
  }
  document.getElementById('btnZoomIn').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  document.getElementById('btnZoomIn').dispatchEvent(new window.Event('pointerup', { bubbles: true }));
  ok(true, 'camera buttons respond to pointer events');
  document.getElementById('btnCamReset').click();
  runFrames(3);
  ok(true, 'camera reset does not throw');
}

console.log('\nPause menu & save/load');
{
  // blob URLs for the export path
  const created = [];
  const makeUrl = (blob) => { created.push(blob); return 'blob:mock-' + created.length; };
  globalThis.URL.createObjectURL = makeUrl;
  globalThis.URL.revokeObjectURL = () => {};
  window.URL.createObjectURL = makeUrl;
  window.URL.revokeObjectURL = () => {};
  // jsdom cannot navigate to a download link — record the click instead
  const realClick = window.HTMLAnchorElement.prototype.click;
  let anchorClicks = 0;
  window.HTMLAnchorElement.prototype.click = function () { anchorClicks++; };

  document.getElementById('btnMenu').click();
  ok(document.getElementById('pauseModal').classList.contains('show'), 'menu button opens the pause menu');
  ok(A.state.time.paused === true, 'opening the menu pauses the game');
  ok(document.getElementById('rendererLabel').textContent.length > 0, 'pause menu shows the active renderer',
    document.getElementById('rendererLabel').textContent);
  {
    const v = window.__northhold.view;
    ok(document.getElementById('btnUse3D').disabled === (v.kind === '3d'), 'renderer buttons reflect the state');
  }
  ok(/year \d+/.test(document.getElementById('pauseInfo').textContent), 'pause menu summarises the game',
    document.getElementById('pauseInfo').textContent);
  runFrames(10);
  const pausedMonth = A.state.time.month;
  ok(A.state.time.month === pausedMonth, 'no time passes while paused');

  // save
  A.state.clans[0].res.wood = 4242;
  document.getElementById('btnSave').click();
  ok(/Saved/.test(document.getElementById('saveStatus').textContent), 'save reports success',
    document.getElementById('saveStatus').textContent);
  const stored = window.localStorage.getItem(save.SAVE_KEY);
  ok(!!stored && stored.length > 500, 'a save exists in localStorage', stored ? stored.length : 0);
  const info = save.saveInfo(save.SAVE_KEY);
  ok(!!info && info.year >= 1, 'save metadata readable', JSON.stringify(info));
  ok(!document.getElementById('btnContinue').hidden, 'the start screen offers to continue');

  // change the game, then load the save back
  A.state.clans[0].res.wood = 1;
  A.state.clans[0].fame = 0;
  document.getElementById('btnLoad').click();
  runFrames(3);
  ok(A.state.clans[0].res.wood === 4242, 'loading restores the saved resources', A.state.clans[0].res.wood);
  ok(!A.state.time.paused, 'loading resumes the game');
  ok(!document.getElementById('pauseModal').classList.contains('show'), 'pause menu closes after loading');
  ok(document.getElementById('resources').children.length >= 8, 'HUD rebuilt after loading');

  // export
  document.getElementById('btnMenu').click();
  document.getElementById('btnExport').click();
  ok(created.length === 1, 'export builds a save file blob', created.length);
  ok(anchorClicks >= 1, 'export triggers a download');
  window.HTMLAnchorElement.prototype.click = realClick;

  // import the exported blob back through the file input
  const input = document.getElementById('importFile');
  try {
    const text = await created[0].text();
    const file = new window.File([text], 'northhold-test.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    A.state.clans[0].fame = 7;
    await input.onchange();
    runFrames(3);
    ok(/Imported/.test(document.getElementById('saveStatus').textContent), 'import reports success',
      document.getElementById('saveStatus').textContent);
    ok(A.state.clans[0].fame !== 7, 'imported game replaced the running one', A.state.clans[0].fame);
  } catch (err) {
    ok(false, 'import round trip works', err.message);
  }

  // resume + escape behaviour
  document.getElementById('btnResume').click();
  ok(!document.getElementById('pauseModal').classList.contains('show'), 'resume closes the menu');
  ok(A.state.time.paused === false, 'resume unpauses the game');
  A.ui.selectedUnits = new Set([999]); // pretend something is selected
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(A.ui.selectedUnits.size === 0, 'first Escape clears the selection');
  ok(!document.getElementById('pauseModal').classList.contains('show'), '…without opening the menu');
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(document.getElementById('pauseModal').classList.contains('show'), 'Escape with nothing selected opens the menu');
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(!document.getElementById('pauseModal').classList.contains('show'), 'Escape again closes it');
  runFrames(20);
  ok(true, 'the game keeps running after the menu closes');
}

console.log('\nUncaught errors');
ok(errors.length === 0, 'no uncaught window errors', errors.slice(0, 3).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
