// ============================================================================
// Northhold — view adapter.
// The game is drawn either by the 3D renderer (WebGL/three.js) or by the 2D
// canvas renderer used as an automatic fallback (no WebGL, or the player asks
// for it). Everything else — input, camera controls, minimap — talks to this
// adapter, so both renderers are interchangeable.
// ============================================================================
import * as R2D from './render.js';
import { createRenderer3D, webglAvailable, screenToGround } from './render3d.js';

/**
 * @param {HTMLCanvasElement} canvas   the map canvas
 * @param {HTMLCanvasElement} minimap  the (always 2D) minimap canvas
 * A canvas that has already handed out a 2D context can never host a WebGL
 * context, so switching renderers swaps in a brand new canvas element with the
 * same id/class. Input is attached to the parent element, so it survives.
 */
export function createView(canvas, minimap) {
  let mapCanvas = canvas;
  const surfaces = R2D.setupCanvas(mapCanvas, minimap);
  const api = {
    kind: '2d',
    fallbackReason: null,
    threeD: null,
    surfaces,
    get canvas() { return mapCanvas; },
  };

  function freshCanvas() {
    const next = document.createElement('canvas');
    next.id = mapCanvas.id || 'map';
    next.className = mapCanvas.className;
    next.setAttribute('aria-label', mapCanvas.getAttribute('aria-label') || 'game map');
    return next;
  }

  /** Build a renderer on a fresh canvas; only swap it into the page on success. */
  function makeThreeD() {
    // probe first: constructing three's WebGLRenderer without a context only
    // logs an ugly console error and throws a generic message
    if (!webglAvailable()) throw new Error('WebGL is not available in this browser');
    const next = freshCanvas();
    const r = createRenderer3D(next);
    mapCanvas.replaceWith(next);
    mapCanvas = next;
    api.threeD = r;
    api.kind = '3d';
    surfaces.rebind(next);
    return r;
  }
  function make2D() {
    const next = freshCanvas();
    const ctx = next.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    mapCanvas.replaceWith(next);
    mapCanvas = next;
    api.threeD = null;
    api.kind = '2d';
    surfaces.rebind(next);
    return next;
  }

  try {
    if (webglAvailable()) makeThreeD();
    else api.fallbackReason = 'WebGL is not available in this browser';
  } catch (err) {
    api.threeD = null;
    api.fallbackReason = err?.message || 'WebGL failed to start';
  }

  // ---------------------------------------------------------------- switching
  api.use3D = () => {
    if (api.kind === '3d') return { ok: true };
    try {
      makeThreeD();
      return { ok: true };
    } catch (err) {
      api.kind = '2d';
      api.threeD = null;
      api.fallbackReason = err?.message || 'WebGL failed to start';
      return { ok: false, reason: api.fallbackReason };
    }
  };
  api.use2D = () => {
    if (api.threeD) {
      try { api.threeD.dispose(); } catch { /* ignore */ }
      api.threeD = null;
      try {
        make2D();     // a WebGL canvas cannot hand out a 2D context either
      } catch (err) {
        api.kind = '2d';
        api.fallbackReason = err?.message;
      }
    }
    api.kind = '2d';
    return { ok: true };
  };

  // ---------------------------------------------------------------- frames
  api.resize = () => {
    if (api.kind === '3d' && api.threeD) api.threeD.size();
    else surfaces.resize();
  };
  api.draw = (state, ui, dt) => {
    if (api.kind === '3d' && api.threeD) api.threeD.draw(state, ui, dt);
    else R2D.draw(surfaces.ctx, state, mapCanvas, ui, dt);
  };
  api.drawMinimap = (state) => R2D.drawMinimap(surfaces.mctx, state, minimap);

  // ---------------------------------------------------------------- picking
  api.screenToTile = (sx, sy, state) => {
    if (api.kind === '3d' && api.threeD) return api.threeD.screenToTile(state, sx, sy);
    return R2D.screenToTile(sx, sy, state);
  };
  /** world (tile space) → css pixels; used for unit/building hit tests */
  api.worldToScreen = (x, y, elevation = 0.45) => {
    if (api.kind === '3d' && api.threeD) {
      const p = api.threeD.groundToScreen(x, y, elevation);
      return { x: p.x, y: p.y };
    }
    return R2D.worldToScreen(x, y);
  };

  // ---------------------------------------------------------------- camera
  api.centerOn = (x, y) => {
    if (api.kind === '3d' && api.threeD) api.threeD.centerOn(x, y);
    else R2D.centerOn(x, y, mapCanvas);
  };
  api.panBy = (dxPx, dyPx) => {
    if (api.kind === '3d' && api.threeD) {
      api.threeD.panBy(dxPx, dyPx);
      return;
    }
    R2D.cam.x += dxPx;
    R2D.cam.y += dyPx;
    R2D.clampCam(mapCanvas);
  };
  api.zoomAt = (sx, sy, factor) => {
    if (api.kind === '3d' && api.threeD) {
      api.threeD.zoomAt(sx, sy, factor);
      return;
    }
    const before = R2D.screenToWorld(sx, sy);
    R2D.cam.zoom = Math.max(R2D.cam.minZoom, Math.min(R2D.cam.maxZoom, R2D.cam.zoom * factor));
    const after = R2D.screenToWorld(sx, sy);
    R2D.cam.x += (after.x - before.x) * R2D.cam.zoom;
    R2D.cam.y += (after.y - before.y) * R2D.cam.zoom;
    R2D.clampCam(mapCanvas);
  };
  api.zoomBy = (factor) => api.zoomAt(mapCanvas._w / 2, mapCanvas._h / 2, factor);
  api.rotateBy = (rad) => { if (api.kind === '3d' && api.threeD) api.threeD.rotateBy(rad); };
  api.tiltBy = (rad) => { if (api.kind === '3d' && api.threeD) api.threeD.tiltBy(rad); };
  api.setZoom = (v) => {
    if (api.kind === '3d' && api.threeD) api.threeD.setZoom(v);
    else R2D.cam.zoom = Math.max(R2D.cam.minZoom, Math.min(R2D.cam.maxZoom, v));
  };
  api.getZoom = () => (api.kind === '3d' && api.threeD ? api.threeD.getZoom() : R2D.cam.zoom);
  /** default zoom level when a game starts */
  api.defaultZoom = () => {
    const small = (typeof window !== 'undefined' ? window.innerWidth : 1280) < 720;
    if (api.kind === '3d' && api.threeD) api.threeD.setZoom(small ? 36 : 26);
    else R2D.cam.zoom = small ? 34 : 46;
  };
  /** map floor hit for callers that need raw ground coordinates */
  api.screenToWorld = (sx, sy) => {
    if (api.kind === '3d' && api.threeD) {
      const hit = screenToGround(api.threeD.rig, api.threeD.camera, sx, sy, mapCanvas._w, mapCanvas._h);
      return hit ? { x: hit.x, y: hit.z } : null;
    }
    return R2D.screenToWorld(sx, sy);
  };
  /** clickable radius (css pixels) for units and buildings */
  api.pickRadius = () => {
    if (api.kind === '3d' && api.threeD) {
      const d = api.threeD.getZoom();
      return Math.max(16, Math.min(46, 900 / Math.max(1, d)));
    }
    return R2D.cam.zoom * 0.32;
  };

  return api;
}
