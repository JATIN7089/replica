// ============================================================================
// Northhold — bootstrap, game loop and glue between engine, renderer and HUD
// ============================================================================
import * as E from './engine.js';
import { CLANS, DIFFICULTY } from './data.js';
import { createView } from './view.js';
import { attachInput } from './input.js';
import { createUI } from './ui.js';
import { aiStep } from './ai.js';
import {
  saveToStorage, readSaveFromStorage, deserialize, hasSave, saveInfo, clearSave,
  downloadSave, readSaveFile, autosave, SAVE_KEY, SAVE_AUTO_KEY,
} from './save.js';

const stage = document.querySelector('main');
const canvas = document.getElementById('map');
const minimap = document.getElementById('minimap');
const view = createView(canvas, minimap);
const surfaces = view.surfaces;

const app = {
  canvas,
  stage,
  minimap,
  view,
  get mapCanvas() { return view.canvas; },
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
  // cosmetic: a slight camera punch so speed changes are felt
  view.setZoom(view.getZoom() * (n > 1 ? 1.015 : 1));
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
app.escapePressed = () => {
  if (ui.isHelpOpen()) { ui.showHelp(false); return; }
  if (ui.isPauseOpen()) { app.closePauseMenu(); return; }
  if (app.ui.mode !== 'select' || app.ui.selectedUnits.size || app.ui.selectedBuildingId != null) {
    app.ui.mode = 'select';
    app.ui.buildType = null;
    app.ui.selectedUnits = new Set();
    app.ui.selectedBuildingId = null;
    return;
  }
  app.openPauseMenu();
};

// ---------------- new game / loading ----------------
let autosaveMonth = 12;

function adoptState(state, { toast = null, selectHall = true } = {}) {
  app.state = state;
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
  ui.showPause(false);
  const th = E.buildingsOf(state, state.playerClan, 'townhall')[0];
  const tile = th ? E.tileById(state, th.tileId) : state.starts[state.playerClan];
  view.defaultZoom();
  view.centerOn(tile.x, tile.y);
  if (selectHall) app.ui.selectedBuildingId = th ? th.id : null;
  state.time.paused = false;
  setSpeed(state.time.speed || 1);
  autosaveMonth = (Math.floor(scene.year(state)) + 1) * 12;
  if (toast) E.addToast(state, toast, 'good');
  refreshContinue();
}

const scene = {
  year: (st) => E.yearOf(st),
};

function newGame({ clanId, difficulty }) {
  const state = E.createGame({ clanId, difficulty, mapSeed: Math.floor(Math.random() * 1e9) });
  adoptState(state, {
    toast: `${CLANS[clanId].name} has made landfall — ${DIFFICULTY[difficulty].name} difficulty`,
  });
}

function loadFromData(data, label = 'Save') {
  try {
    const state = deserialize(data);
    adoptState(state, { toast: `${label} loaded — ${state.clans[state.playerClan].name}, year ${E.yearOf(state)}` });
    return true;
  } catch (err) {
    E.addToast(app.state, `Could not load: ${err.message}`, 'bad');
    return false;
  }
}

function refreshContinue() {
  const manual = saveInfo(SAVE_KEY);
  const auto = saveInfo(SAVE_AUTO_KEY);
  if (manual) ui.refreshContinue({ ...manual, auto: false });
  else if (auto) ui.refreshContinue({ ...auto, auto: true });
  else ui.refreshContinue(null);
}

syncRendererUI();
const startChooser = ui.buildStartScreen((cfg) => newGame(cfg));
document.getElementById('btnStart').onclick = () => newGame(startChooser.get());
document.getElementById('btnAgain').onclick = () => {
  document.getElementById('gameOver').classList.remove('show');
  document.getElementById('startScreen').classList.add('show');
};
document.getElementById('btnHelp').onclick = () => ui.showHelp(true);
document.getElementById('btnHowTo').onclick = () => ui.showHelp(true);
document.getElementById('btnCloseHelp').onclick = () => ui.showHelp(false);
document.getElementById('btnContinue').onclick = () => {
  const data = readSaveFromStorage(SAVE_KEY) || readSaveFromStorage(SAVE_AUTO_KEY);
  if (!data) { E.addToast(app.state, 'No save found', 'bad'); refreshContinue(); return; }
  loadFromData(data, 'Save');
};

// ---------------- pause menu ----------------
function openPauseMenu() {
  if (!app.state) return;
  app.state.time.paused = true;
  syncSpeedButtons();
  ui.pauseInfo = null;
  document.getElementById('pauseInfo').textContent = ui.pauseSummary(app.state);
  const manual = saveInfo(SAVE_KEY);
  const auto = saveInfo(SAVE_AUTO_KEY);
  const parts = [];
  if (manual) parts.push(`manual save: ${manual.clan}, year ${manual.year}`);
  if (auto) parts.push(`autosave: year ${auto.year}`);
  ui.setSaveStatus(parts.length ? `On this device — ${parts.join(' · ')}` : 'No save on this device yet.');
  syncRendererUI();
  ui.showPause(true);
}
function closePauseMenu() {
  ui.showPause(false);
  if (app.state && !app.state.time.ended) { app.state.time.paused = false; syncSpeedButtons(); }
}
app.openPauseMenu = openPauseMenu;
app.closePauseMenu = closePauseMenu;

document.getElementById('btnMenu').onclick = () => openPauseMenu();
document.getElementById('btnResume').onclick = () => closePauseMenu();
document.getElementById('btnHelp2').onclick = () => ui.showHelp(true);
document.getElementById('btnRestart').onclick = () => {
  ui.showPause(false);
  document.getElementById('startScreen').classList.add('show');
  refreshContinue();
};
document.getElementById('btnSave').onclick = () => {
  if (!app.state) return;
  const r = saveToStorage(app.state, SAVE_KEY);
  ui.setSaveStatus(r.ok
    ? `Saved (${(r.bytes / 1024).toFixed(0)} KB) — year ${E.yearOf(app.state)}.`
    : `Could not save: ${r.reason}`, r.ok ? 'ok' : 'bad');
  if (r.ok) { E.addToast(app.state, '💾 Game saved', 'good'); refreshContinue(); }
};
document.getElementById('btnLoad').onclick = () => {
  const data = readSaveFromStorage(SAVE_KEY) || readSaveFromStorage(SAVE_AUTO_KEY);
  if (!data) { ui.setSaveStatus('No save found on this device.', 'bad'); return; }
  loadFromData(data, 'Save');
};
document.getElementById('btnExport').onclick = () => {
  if (!app.state) return;
  try {
    downloadSave(app.state);
    ui.setSaveStatus('Exported a save file to your downloads.', 'ok');
  } catch (err) {
    ui.setSaveStatus(`Export failed: ${err.message}`, 'bad');
  }
};
const importInput = document.getElementById('importFile');
document.getElementById('btnImport').onclick = () => importInput.click();
importInput.onchange = async () => {
  const file = importInput.files && importInput.files[0];
  if (!file) return;
  try {
    const data = await readSaveFile(file);
    if (loadFromData(data, 'Imported game')) ui.setSaveStatus(`Imported ${file.name}.`, 'ok');
    else ui.setSaveStatus('That file is not a Northhold save.', 'bad');
  } catch (err) {
    ui.setSaveStatus(`Could not read the file: ${err.message}`, 'bad');
  } finally {
    importInput.value = '';
  }
};

// ---------------- camera buttons (touch friendly) ----------------
function bindHold(id, fn, stepMs = 40) {
  const el = document.getElementById(id);
  if (!el) return;
  let timer = null;
  const start = (e) => {
    e.preventDefault();
    fn();
    timer = setInterval(fn, stepMs);
  };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  el.addEventListener('pointerdown', start);
  for (const evt of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(evt, stop);
  el.addEventListener('click', (e) => e.preventDefault());
}
bindHold('btnRotL', () => view.rotateBy(-0.09));
bindHold('btnRotR', () => view.rotateBy(0.09));
bindHold('btnZoomIn', () => view.zoomBy(1.06));
bindHold('btnZoomOut', () => view.zoomBy(0.94));
document.getElementById('btnCamReset').onclick = () => {
  if (view.kind === '3d' && view.threeD) {
    view.threeD.rig.yaw = Math.PI * 0.25;
    view.threeD.rig.pitch = 0.92;
  }
  app.ui.mode = 'select';
};

// ---------------- renderer switch ----------------
function setRenderer(kind) {
  if (kind === '3d') {
    const r = view.use3D();
    if (!r.ok) {
      E.addToast(app.state, `3D unavailable: ${r.reason}`, 'bad');
      return;
    }
    E.addToast(app.state, '3D view enabled', 'good');
  } else {
    view.use2D();
    E.addToast(app.state, 'Classic 2D view', 'good');
  }
  view.defaultZoom();
  const st = app.state;
  if (st) {
    const th = E.buildingsOf(st, st.playerClan, 'townhall')[0];
    const tile = th ? E.tileById(st, th.tileId) : st.starts[st.playerClan];
    view.centerOn(tile.x, tile.y);
  }
  syncRendererUI();
}
function syncRendererUI() {
  const label = document.getElementById('rendererLabel');
  if (label) {
    label.textContent = view.kind === '3d' ? '3D' : '2D';
  }
  const note = document.getElementById('rendererNote');
  if (note) {
    note.textContent = view.kind === '3d'
      ? 'Rendering the world with WebGL (three.js). Q/E rotate, R/F tilt, wheel zooms.'
      : `Classic canvas renderer${view.fallbackReason ? ` — ${view.fallbackReason}` : ''}.`;
  }
  const to3d = document.getElementById('btnUse3D');
  const to2d = document.getElementById('btnUse2D');
  if (to3d) to3d.disabled = view.kind === '3d';
  if (to2d) to2d.disabled = view.kind === '2d';
}
document.getElementById('btnUse3D').onclick = () => setRenderer('3d');
document.getElementById('btnUse2D').onclick = () => setRenderer('2d');
app.setRenderer = setRenderer;

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
    if (!st.time.ended && st.time.month >= autosaveMonth) {
      autosaveMonth = st.time.month + 12;
      const res = autosave(st);
      if (res.ok) E.addToast(st, '💾 Autosaved', 'good');
    }
    E.step(st, rawDt);
    input.updateCamera(rawDt);
    updateHighlights();
    view.draw(st, app.ui, rawDt);
    view.drawMinimap(st);
    ui.update(rawDt);
    // keep the speed buttons honest (auto-pause from altar events)
    acc += rawDt;
    if (acc > 0.4) { acc = 0; syncSpeedButtons(); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// debug hook (used by the headless smoke tests)
window.__northhold = {
  app, E, ui, view, surfaces, newGame, setSpeed, togglePause, loadFromData, setRenderer,
  openPauseMenu, closePauseMenu, refreshContinue, save: { saveToStorage, readSaveFromStorage, saveInfo, clearSave, SAVE_KEY, SAVE_AUTO_KEY },
};
