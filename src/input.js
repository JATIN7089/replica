// ============================================================================
// Northhold — input: selection, orders, camera, minimap
// ============================================================================
import * as E from './engine.js';
import { UNITS, BUILDINGS } from './data.js';

export function attachInput(app) {
  const { minimap, view } = app;
  // input is bound to the stage, not the canvas: the view may swap canvas
  // elements when the renderer changes, and the listeners must survive that
  const canvas = app.stage || app.canvas;
  const screenToTile = (sx, sy, state) => view.screenToTile(sx, sy, state);
  const worldToScreen = (x, y, elevation) => view.worldToScreen(x, y, elevation);
  const centerOn = (x, y) => view.centerOn(x, y);
  const state = () => app.state;
  const ui = app.ui;
  const pointers = new Map();
  let dragStart = null;
  let boxSel = null;
  let panning = false;
  let pinchDist = 0;
  let lastPan = { x: 0, y: 0 };
  let rotating = null;
  let moved = false;
  const keys = new Set();

  const localPos = (e) => {
    const r = view.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function unitAt(sx, sy, filter = null) {
    let best = null, bestD = 1e9;
    for (const u of state().units) {
      if (filter && !filter(u)) continue;
      const p = worldToScreen(u.x, u.y);
      const rad = view.pickRadius() * (UNITS[u.type].hero ? 1.15 : 1);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < rad && d < bestD) { best = u; bestD = d; }
    }
    return best;
  }
  function buildingAt(sx, sy, filter = null) {
    const t = screenToTile(sx, sy, state());
    if (!t) return null;
    for (const b of t.buildings) {
      if (filter && !filter(b)) continue;
      const p = worldToScreen(t.x, t.y);
      const r = view.pickRadius() * 2.1;
      if (Math.abs(p.x - sx) < r && Math.abs(p.y - sy) < r * 0.85) return b;
    }
    return null;
  }

  function selectOnly(ids) {
    ui.selectedUnits = new Set(ids);
    ui.selectedBuildingId = null;
    ui.mode = 'select';
  }
  function clearSelection() {
    ui.selectedUnits = new Set();
    ui.selectedBuildingId = null;
    ui.mode = 'select';
    ui.buildType = null;
  }

  function issueOrder(tile, enemyUnit, enemyBuilding) {
    const ids = [...ui.selectedUnits];
    if (!ids.length) return false;
    const st = state();
    const myUnits = ids.filter((id) => st.unitById.get(id));
    if (!myUnits.length) return false;
    if (enemyUnit) {
      E.commandAttack(st, myUnits, enemyUnit.id, null, enemyUnit.tileId);
      E.addFloater(st, enemyUnit.x, enemyUnit.y, '⚔️', '#ff9a6a', 0.9);
      return true;
    }
    if (enemyBuilding) {
      E.commandAttack(st, myUnits, null, enemyBuilding.id, enemyBuilding.tileId);
      E.addFloater(st, tile.x, tile.y, '⚔️', '#ff9a6a', 0.9);
      return true;
    }
    if (tile) {
      const r = E.commandMove(st, myUnits, tile.id);
      if (r.ok) E.addFloater(st, tile.x, tile.y, '➤', '#ffe9a8', 0.8);
      return r.ok;
    }
    return false;
  }

  function tap(sx, sy, shift) {
    const st = state();
    if (st.time.ended) return;
    const tile = screenToTile(sx, sy, st);

    // build / colonize modes take precedence
    if (ui.mode === 'colonize') {
      if (tile) {
        const r = E.colonize(st, tile.id, st.playerClan);
        if (!r.ok && r.reason) E.addToast(st, r.reason, 'bad');
      }
      ui.mode = 'select';
      return;
    }
    if (ui.mode === 'build' && ui.buildType) {
      if (tile) {
        const r = E.build(st, tile.id, ui.buildType);
        if (!r.ok && r.reason) E.addToast(st, r.reason, 'bad');
        else if (r.ok) {
          // keep building the same type if shift, else exit
          if (!shift) { ui.mode = 'select'; ui.buildType = null; }
        }
      } else if (!shift) { ui.mode = 'select'; ui.buildType = null; }
      return;
    }
    if (ui.mode === 'move') {
      issueOrder(tile, unitAt(sx, sy, (u) => u.clan !== st.playerClan), null);
      ui.mode = 'select';
      return;
    }

    const enemyU = unitAt(sx, sy, (u) => u.clan !== st.playerClan);
    const ownU = unitAt(sx, sy, (u) => u.clan === st.playerClan);

    // if we have a selection, tapping ground/enemy gives an order
    if (ui.selectedUnits.size > 0) {
      if (ownU && !enemyU) {
        // selecting another own unit
        if (shift) ui.selectedUnits.add(ownU.id);
        else selectOnly([ownU.id]);
        return;
      }
      if (enemyU) { issueOrder(tile, enemyU, null); return; }
      const eb = buildingAt(sx, sy, (b) => b.clan !== st.playerClan);
      if (eb) { issueOrder(tile, null, eb); return; }
      if (tile) { issueOrder(tile, null, null); return; }
      return;
    }

    if (ownU) { selectOnly([ownU.id]); return; }
    const ownB = buildingAt(sx, sy, (b) => b.clan === st.playerClan);
    if (ownB) {
      ui.selectedBuildingId = ownB.id;
      ui.selectedUnits = new Set();
      return;
    }
    clearSelection();
  }

  // --- pointer events
  canvas.addEventListener('pointerdown', (e) => {
    // pointer capture belongs to the element under the pointer (the map canvas,
    // which is an element of the stage that listens for input)
    try { view.canvas.setPointerCapture?.(e.pointerId); } catch { /* unsupported */ }
    pointers.set(e.pointerId, e);
    const p = localPos(e);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      boxSel = null;
      dragStart = null;
      return;
    }
    if (e.button === 1 && view.isWorld3D && e.ctrlKey) {
      rotating = { x: p.x, y: p.y };
      return;
    }
    if (e.button === 1 || (e.button === 0 && (e.shiftKey && e.altKey)) || app.spaceDown) {
      panning = true;
      lastPan = { x: p.x, y: p.y };
      dragStart = { x: p.x, y: p.y };
      return;
    }
    if (e.button === 2) return; // context handled below
    dragStart = { x: p.x, y: p.y, shift: e.shiftKey, button: e.button };
    moved = false;
  });

  canvas.addEventListener('pointermove', (e) => {
    pointers.set(e.pointerId, e);
    const p = localPos(e);
    const st = state();
    ui.hoverTile = screenToTile(p.x, p.y, st);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchDist > 0) {
        const factor = d / pinchDist;
        zoomAt(view.canvas._w / 2, view.canvas._h / 2, factor);
      }
      pinchDist = d;
      return;
    }
    if (rotating) {
      view.rotateBy((p.x - rotating.x) * 0.006);
      view.tiltBy((p.y - rotating.y) * 0.004);
      rotating = { x: p.x, y: p.y };
      return;
    }
    if (panning && dragStart) {
      view.panBy(p.x - lastPan.x, p.y - lastPan.y);
      lastPan = { x: p.x, y: p.y };
      return;
    }
    if (dragStart && (e.buttons & 1)) {
      const d = Math.hypot(p.x - dragStart.x, p.y - dragStart.y);
      if (d > 9) {
        moved = true;
        boxSel = {
          x0: Math.min(dragStart.x, p.x), y0: Math.min(dragStart.y, p.y),
          x1: Math.max(dragStart.x, p.x), y1: Math.max(dragStart.y, p.y),
        };
      }
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    const p = localPos(e);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (rotating) { rotating = null; return; }
    if (panning) { panning = false; dragStart = null; return; }
    if (e.button === 2) return;
    if (boxSel) {
      const st = state();
      const ids = [];
      for (const u of st.units) {
        if (u.clan !== st.playerClan) continue;
        const q = worldToScreen(u.x, u.y);
        if (q.x >= boxSel.x0 && q.x <= boxSel.x1 && q.y >= boxSel.y0 && q.y <= boxSel.y1) ids.push(u.id);
      }
      if (ids.length) selectOnly(ids);
      boxSel = null;
      dragStart = null;
      return;
    }
    if (dragStart) {
      const wasDrag = moved;
      dragStart = null;
      if (!wasDrag) tap(p.x, p.y, e.shiftKey);
    }
  });

  canvas.addEventListener('pointercancel', () => { pointers.clear(); panning = false; rotating = null; dragStart = null; boxSel = null; });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const p = localPos(e);
    const st = state();
    const tile = screenToTile(p.x, p.y, st);
    const enemyU = unitAt(p.x, p.y, (u) => u.clan !== st.playerClan);
    if (ui.selectedUnits.size === 0) {
      // right-click: inspect
      const ownU = unitAt(p.x, p.y, (u) => u.clan === st.playerClan);
      if (ownU) selectOnly([ownU.id]);
      else {
        const ownB = buildingAt(p.x, p.y, (b) => b.clan === st.playerClan);
        if (ownB) { ui.selectedBuildingId = ownB.id; ui.selectedUnits = new Set(); }
      }
      return;
    }
    if (enemyU) { issueOrder(tile, enemyU, null); return; }
    const eb = buildingAt(p.x, p.y, (b) => b.clan !== st.playerClan);
    if (eb) { issueOrder(tile, null, eb); return; }
    if (tile) issueOrder(tile, null, null);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = localPos(e);
    zoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 0.89);
  }, { passive: false });

  const zoomAt = (sx, sy, factor) => view.zoomAt(sx, sy, factor);

  // --- minimap
  function minimapToWorld(e) {
    const r = minimap.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const m = minimap._map;
    if (!m) return null;
    return { x: (x - m.ox) / m.s, y: (y - m.oy) / m.s };
  }
  let miniDown = false;
  minimap.addEventListener('pointerdown', (e) => { miniDown = true; jump(e); });
  minimap.addEventListener('pointermove', (e) => { if (miniDown) jump(e); });
  window.addEventListener('pointerup', () => { miniDown = false; });
  function jump(e) {
    const w = minimapToWorld(e);
    if (!w) return;
    centerOn(w.x, w.y);
  }

  // --- keyboard
  window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    keys.add(e.key.toLowerCase());
    const st = state();
    if (e.key === ' ') { e.preventDefault(); app.togglePause(); }
    if (e.key === 'Escape') {
      if (app.escapePressed) app.escapePressed();
      else {
        ui.mode = 'select'; ui.buildType = null;
        ui.selectedBuildingId = null;
        ui.selectedUnits = new Set();
        app.closeModals && app.closeModals();
      }
    }
    if (e.key === '1') app.setSpeed(1);
    if (e.key === '2') app.setSpeed(2);
    if (e.key === '3') app.setSpeed(3);
    if (e.key.toLowerCase() === 'c') { ui.mode = 'colonize'; ui.buildType = null; }
    if (e.key.toLowerCase() === 'm') { ui.mode = 'move'; }
    if (e.key.toLowerCase() === 'q') view.rotateBy(-0.18);
    if (e.key.toLowerCase() === 'e') view.rotateBy(0.18);
    if (e.key.toLowerCase() === 'r') view.tiltBy(0.08);
    if (e.key.toLowerCase() === 'f') view.tiltBy(-0.08);
    if (e.key.toLowerCase() === 'h') {
      const th = E.buildingsOf(state(), st.playerClan, 'townhall')[0];
      if (th) centerOn(E.tileById(st, th.tileId).x, E.tileById(st, th.tileId).y, canvas);
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const mine = st.units.filter((u) => u.clan === st.playerClan);
      if (mine.length) {
        const next = mine[(mine.findIndex((u) => ui.selectedUnits.has(u.id)) + 1) % mine.length];
        selectOnly([next.id]);
        centerOn(next.x, next.y, canvas);
      }
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  function updateCamera(dt) {
    let dx = 0, dy = 0;
    if (keys.has('w') || keys.has('arrowup')) dy -= 1;
    if (keys.has('s') || keys.has('arrowdown')) dy += 1;
    if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
    if (keys.has('d') || keys.has('arrowright')) dx += 1;
    if (!dx && !dy) return;
    const len = Math.hypot(dx, dy) || 1;
    // speed scales with the zoom level so panning feels the same at any height
    const speed = view.isWorld3D ? view.getZoom() * 1.5 : 0;
    view.panBy(-(dx / len) * speed * dt, -(dy / len) * speed * dt);
  }

  return {
    updateCamera,
    getBox: () => boxSel,
    zoomBy: (f) => view.zoomBy(f),
    rotateBy: (r) => view.rotateBy(r),
    tiltBy: (r) => view.tiltBy(r),
    centerHome: () => {
      const st = state();
      const th = E.buildingsOf(st, st.playerClan, 'townhall')[0];
      if (th) {
        const t = E.tileById(st, th.tileId);
        centerOn(t.x, t.y, canvas);
      }
    },
  };
}
