// ============================================================================
// Northhold — renderer adapter.
// The game has one world renderer and two backends: WebGL and a CPU rasterizer.
// Both render the same continuous 3D scene; the gameplay hexes are never drawn
// as a second, tiled 2D world.
// ============================================================================
import { createRenderer3D, webglAvailable, screenToGround } from './render3d.js';
import { createRaster3DRenderer, drawMinimap } from './raster3d.js';

function setupSurfaces(minimap) {
  let mctx = minimap.getContext('2d');
  if (!mctx) throw new Error('2D canvas context unavailable for the minimap');
  function resize() {
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const w = minimap.clientWidth || 220;
    const h = minimap.clientHeight || 160;
    minimap.width = Math.floor(w * dpr);
    minimap.height = Math.floor(h * dpr);
    mctx = minimap.getContext('2d');
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    minimap._w = w;
    minimap._h = h;
  }
  resize();
  return {
    resize,
    get mctx() { return mctx; },
    get minimap() { return minimap; },
  };
}

/**
 * @param {HTMLCanvasElement} canvas map surface
 * @param {HTMLCanvasElement} minimap always-2D navigation surface
 */
export function createView(canvas, minimap) {
  let mapCanvas = canvas;
  const surfaces = setupSurfaces(minimap);
  const api = {
    kind: 'raster3d',
    fallbackReason: null,
    threeD: null,
    surfaces,
    get canvas() { return mapCanvas; },
    get isWorld3D() { return !!api.threeD; },
  };

  function freshCanvas() {
    const next = document.createElement('canvas');
    next.id = mapCanvas.id || 'map';
    next.className = mapCanvas.className;
    next.setAttribute('aria-label', mapCanvas.getAttribute('aria-label') || 'game world');
    return next;
  }

  function install(createRenderer) {
    const next = freshCanvas();
    const renderer = createRenderer(next);
    const previous = api.threeD;
    mapCanvas.replaceWith(next);
    mapCanvas = next;
    api.threeD = renderer;
    api.kind = renderer.kind || '3d';
    if (previous) {
      try { previous.dispose(); } catch { /* a failed driver cleanup must not strand the new renderer */ }
    }
    return renderer;
  }

  function makeWebGL() {
    if (!webglAvailable()) throw new Error('WebGL is not available in this browser');
    const renderer = install((next) => createRenderer3D(next));
    api.fallbackReason = null;
    return renderer;
  }

  function makeRaster3D() {
    return install((next) => createRenderer3D(next, {
      rendererFactory: (surface) => createRaster3DRenderer(surface),
    }));
  }

  // Prefer WebGL, but always keep a playable 3D world when the browser has no
  // GPU context. The software path is also selectable for visual diagnosis.
  try {
    if (webglAvailable()) makeWebGL();
    else {
      api.fallbackReason = 'WebGL is not available; using the CPU 3D rasterizer';
      makeRaster3D();
    }
  } catch (err) {
    api.fallbackReason = `${err?.message || 'WebGL failed to start'}; using the CPU 3D rasterizer`;
    makeRaster3D();
  }

  api.use3D = () => {
    if (api.kind === '3d') return { ok: true };
    try {
      makeWebGL();
      return { ok: true };
    } catch (err) {
      api.fallbackReason = err?.message || 'WebGL failed to start';
      return { ok: false, reason: api.fallbackReason };
    }
  };
  api.useRaster3D = () => {
    if (api.kind === 'raster3d') return { ok: true };
    try {
      makeRaster3D();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err?.message || 'CPU rasterizer failed to start' };
    }
  };

  api.resize = () => {
    if (api.threeD) api.threeD.size();
    surfaces.resize();
  };
  api.draw = (state, ui, dt) => {
    if (api.threeD) api.threeD.draw(state, ui, dt);
  };
  api.drawMinimap = (state) => drawMinimap(surfaces.mctx, state, minimap);

  // Picking and camera operations are shared by both 3D backends.
  api.screenToTile = (sx, sy, state) => api.threeD?.screenToTile(state, sx, sy) || null;
  api.worldToScreen = (x, y, elevation = 0.45) => {
    if (!api.threeD) return { x: 0, y: 0 };
    const p = api.threeD.groundToScreen(x, y, elevation);
    return { x: p.x, y: p.y };
  };
  api.centerOn = (x, y) => api.threeD?.centerOn(x, y);
  api.panBy = (dxPx, dyPx) => api.threeD?.panBy(dxPx, dyPx);
  api.zoomAt = (sx, sy, factor) => api.threeD?.zoomAt(sx, sy, factor);
  api.zoomBy = (factor) => api.zoomAt(mapCanvas._w / 2, mapCanvas._h / 2, factor);
  api.rotateBy = (rad) => api.threeD?.rotateBy(rad);
  api.tiltBy = (rad) => api.threeD?.tiltBy(rad);
  api.setZoom = (v) => api.threeD?.setZoom(v);
  api.getZoom = () => api.threeD?.getZoom() ?? 26;
  api.defaultZoom = () => {
    const small = (typeof window !== 'undefined' ? window.innerWidth : 1280) < 720;
    api.setZoom(small ? 36 : 26);
  };
  api.screenToWorld = (sx, sy) => {
    if (!api.threeD) return null;
    const hit = screenToGround(api.threeD.rig, api.threeD.camera, sx, sy, mapCanvas._w, mapCanvas._h);
    return hit ? { x: hit.x, y: hit.z } : null;
  };
  api.pickRadius = () => {
    const distance = api.getZoom();
    return Math.max(16, Math.min(46, 900 / Math.max(1, distance)));
  };

  if (typeof window !== 'undefined') window.addEventListener('resize', api.resize);
  return api;
}
