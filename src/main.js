// ============================================================================
// Northhold — bootstrap, game loop and glue between engine, renderer and HUD
// ============================================================================
import * as E from './engine.js';
import { CLANS, DIFFICULTY } from './data.js';
import { setupCanvas, draw, drawMinimap, cam, centerOn, screenToWorld } from './render.js';
import { attachInput } from './input.js';
import { createUI } from './ui.js';
import { aiStep } from './ai.js';

const canvas = document.getElementById('map');
const minimap = document.getElementById('minimap');
const surfaces = setupCanvas(canvas, minimap);

const app = {
  canvas,
  minimap,
  state: null,
  smooth: {},
  ui: {
    mode: 'select',
    buildType: null,
    selectedUnits: new Set(),
    selectedBuildingId: null,
    hoverTile: null,
    highlightTiles: new Set(),
    highlightCosts: new Map(),
    highlightColor: '#ffd98a',
  },
};

const ui = createUI(app);
const input = attachInput(app);

// ---------------- effects for state changes ----------------
function setSpeed(n) {
  if (!app.state) return;
  app.state.time.speed = n;
  app.state.time.paused = false;
  syncSpeedButtons();
  // cosmetic: slight camera punch so speed changes are felt
  cam.zoom = Math.max(cam.minZoom, Math.min(cam.maxZoom, cam.zoom * (n > 1 ? 1.012 : 1)));
}
function togglePause() {
  if (!app.state) return;
  app.state.time.paused = !app.state.time.paused;
  syncSpeedButtons();
}
function syncSpeedButtons() {
  const st = app.state;
  const s = st ? st.time.speed : 1;
  const paused = st ? st.time.paused : false;
  document.getElementById('btnSpeed1').classList.toggle('active', !paused && s === 1);
  document.getElementById('btnSpeed2').classList.toggle('active', !paused && s === 2);
  document.getElementById('btnSpeed3').classList.toggle('active', !paused && s === 3);
  document.getElementById('btnPause').textContent = paused ? '▶' : '⏸';
  document.getElementById('btnPause').classList.toggle('active', paused);
}

app.setSpeed = setSpeed;
app.togglePause = togglePause;
app.closeModals = () => ui.hideModals();

// ---------------- new game ----------------
function newGame({ clanId, difficulty }) {
  app.state = E.createGame({
    clanId,
    difficulty,
    mapSeed: Math.floor(Math.random() * 1e9),
  });
  app.ui.selectedUnits = new Set();
  app.ui.selectedBuildingId = null;
  app.ui.mode = 'select';
  app.ui.buildType = null;
  app.ui.hoverTile = null;
  app.ui.highlightTiles = new Set();
  app.ui.highlightCosts = new Map();
  app.smooth = {};
  ui.buildChips();
  ui.resetSignatures();
  document.getElementById('startScreen').classList.remove('show');
  document.getElementById('gameOver').classList.remove('show');
  const th = E.buildingsOf(app.state, 0, 'townhall')[0];
  const tile = th ? E.tileById(app.state, th.tileId) : app.state.starts[0];
  cam.zoom = window.innerWidth < 720 ? 34 : 46;
  centerOn(tile.x, tile.y, canvas);
  app.ui.selectedBuildingId = th ? th.id : null;
  setSpeed(1);
  E.addToast(app.state, `${CLANS[clanId].name} has made landfall — ${DIFFICULTY[difficulty].name} difficulty`, 'good');
}

const startChooser = ui.buildStartScreen((cfg) => newGame(cfg));
document.getElementById('btnStart').onclick = () => newGame(startChooser.get());
document.getElementById('btnAgain').onclick = () => {
  document.getElementById('gameOver').classList.remove('show');
  document.getElementById('startScreen').classList.add('show');
};
document.getElementById('btnHelp').onclick = () => ui.showHelp(true);
document.getElementById('btnHowTo').onclick = () => ui.showHelp(true);
document.getElementById('btnCloseHelp').onclick = () => ui.showHelp(false);
document.getElementById('btnPause').onclick = () => togglePause();
document.getElementById('btnSpeed1').onclick = () => setSpeed(1);
document.getElementById('btnSpeed2').onclick = () => setSpeed(2);
document.getElementById('btnSpeed3').onclick = () => setSpeed(3);

// ---------------- highlights for build / settle modes ----------------
function updateHighlights() {
  const st = app.state;
  const uiS = app.ui;
  uiS.highlightTiles = new Set();
  uiS.highlightCosts = new Map();
  if (!st || st.time.ended) return;
  if (uiS.mode === 'colonize') {
    const clan = st.clans[st.playerClan];
    for (const t of st.tiles) {
      const c = E.canColonize(st, t, clan);
      if (c.ok) {
        uiS.highlightTiles.add(t.id);
        uiS.highlightCosts.set(t.id, `🍖${c.cost}`);
      }
    }
    uiS.highlightColor = '#7fc4ff';
  } else if (uiS.mode === 'build' && uiS.buildType) {
    const clan = st.clans[st.playerClan];
    const cost = E.buildingCost(st, clan, uiS.buildType);
    const txt = Object.entries(cost).map(([k, v]) => `${k === 'wood' ? '🪵' : k === 'stone' ? '🪨' : '🪙'}${v}`).join(' ');
    let any = false;
    for (const t of st.tiles) {
      if (E.canBuild(st, t, clan, uiS.buildType).ok) {
        uiS.highlightTiles.add(t.id);
        uiS.highlightCosts.set(t.id, txt);
        any = true;
      }
    }
    uiS.highlightColor = any ? '#ffd98a' : '#e07070';
  } else if (uiS.mode === 'move') {
    uiS.highlightColor = '#a8e0ff';
    for (const t of st.tiles) uiS.highlightTiles.add(t.id);
  }
}

// ---------------- main loop ----------------
let last = performance.now();
let acc = 0;
function frame(now) {
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const st = app.state;
  if (st) {
    const running = !st.time.paused && !(st.autoPause > 0) && !st.time.ended;
    const gameDt = running ? rawDt * st.time.speed : 0;
    if (gameDt > 0) aiStep(st, gameDt);
    E.step(st, rawDt);
    input.updateCamera(rawDt);
    updateHighlights();
    draw(surfaces.ctx, st, canvas, app.ui, rawDt);
    drawMinimap(surfaces.mctx, st, minimap);
    ui.update(rawDt);
    // keep the speed buttons honest (auto-pause from altar events)
    acc += rawDt;
    if (acc > 0.4) { acc = 0; syncSpeedButtons(); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// debug hook (used by the headless smoke tests)
window.__northhold = { app, E, ui, surfaces, newGame, setSpeed, togglePause };
