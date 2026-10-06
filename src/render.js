// ============================================================================
// Northhold — canvas renderer (terrain art, units, effects, minimap)
// ============================================================================
import {
  TERRAIN, BUILDINGS, UNITS, SEASONS, MONTH_SECONDS, MONTHS_PER_SEASON,
} from './data.js';
import {
  hexCorners, hexToWorld, worldToHex, MAP_RADIUS, winterAmount, seasonIndexOf,
  tileById, hexDist,
} from './engine.js';

const SQ3 = Math.sqrt(3);
export const cam = { x: 0, y: 0, zoom: 46, minZoom: 24, maxZoom: 120 };

const snow = [];
for (let i = 0; i < 90; i++) {
  snow.push({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random(), v: 0.02 + Math.random() * 0.05 });
}
let snowDrift = 0;

export const HEX_SIZE = 1;

export function setupCanvas(canvas, minimap) {
  let mapCanvas = canvas;
  let ctx = canvas.getContext('2d');
  let mctx = minimap.getContext('2d');
  let minimapEl = minimap;

  function resize() {
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const w = mapCanvas.clientWidth || (mapCanvas.parentElement && mapCanvas.parentElement.clientWidth) || 960;
    const h = mapCanvas.clientHeight || (mapCanvas.parentElement && mapCanvas.parentElement.clientHeight) || 600;
    mapCanvas.width = Math.floor(w * dpr);
    mapCanvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mapCanvas._w = w;
    mapCanvas._h = h;
    if (minimapEl) {
      minimapEl.width = Math.floor(minimapEl.clientWidth * dpr);
      minimapEl.height = Math.floor(minimapEl.clientHeight * dpr);
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      minimapEl._w = minimapEl.clientWidth;
      minimapEl._h = minimapEl.clientHeight;
    }
  }

  /** point the surface at a new canvas element (used when switching renderers) */
  function rebind(nextCanvas) {
    mapCanvas = nextCanvas;
    ctx = nextCanvas.getContext('2d');
    resize();
  }

  resize();
  window.addEventListener('resize', resize);

  const surfaces = {
    resize,
    rebind,
    get canvas() { return mapCanvas; },
    get ctx() { return ctx; },
    get mctx() { return mctx; },
    get minimap() { return minimapEl; },
  };
  return surfaces;
}

export function worldToScreen(wx, wy) {
  return { x: wx * cam.zoom + cam.x, y: wy * cam.zoom + cam.y };
}
export function screenToWorld(sx, sy) {
  return { x: (sx - cam.x) / cam.zoom, y: (sy - cam.y) / cam.zoom };
}
export function screenToTile(sx, sy, state) {
  const w = screenToWorld(sx, sy);
  const h = worldToHex(w.x, w.y, HEX_SIZE);
  return state.tileByKey.get(h.q + ',' + h.r) || null;
}
export function centerOn(wx, wy, canvas) {
  cam.x = canvas._w / 2 - wx * cam.zoom;
  cam.y = canvas._h / 2 - wy * cam.zoom;
}
export function clampCam(canvas) {
  const R = MAP_RADIUS + 2;
  const lim = R * SQ3 * cam.zoom;
  cam.x = Math.max(-lim, Math.min(canvas._w + lim, cam.x));
  cam.y = Math.max(-lim, Math.min(canvas._h + lim, cam.y));
}

// --- deterministic noise for decoration -------------------------------------
function hash(n) {
  n = (n << 13) ^ n;
  return ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 0x7fffffff;
}

function hexPath(ctx, cx, cy, size) {
  const pts = hexCorners(cx, cy, size);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 6; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function lighten(hex, amt) {
  const c = hex.replace('#', '');
  const r = Math.min(255, parseInt(c.slice(0, 2), 16) + amt);
  const g = Math.min(255, parseInt(c.slice(2, 4), 16) + amt);
  const b = Math.min(255, parseInt(c.slice(4, 6), 16) + amt);
  return `rgb(${r},${g},${b})`;
}
export function alpha(hex, a) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// --- terrain decoration -----------------------------------------------------
function decorate(ctx, t, size) {
  const h = hash(t.id * 977 + 13);
  const sx = t.x * cam.zoom + cam.x;
  const sy = t.y * cam.zoom + cam.y;
  const r = size;
  switch (t.terrain) {
    case 'forest': {
      for (let i = 0; i < 3; i++) {
        const hh = hash(t.id * 131 + i * 37);
        const hx = sx + (hh - 0.5) * r * 1.0;
        const hy = sy + (hash(t.id * 77 + i * 11) - 0.5) * r * 0.9 + r * 0.08;
        const s = r * (0.28 + hh * 0.12);
        ctx.fillStyle = '#25482c';
        ctx.beginPath();
        ctx.moveTo(hx, hy - s);
        ctx.lineTo(hx + s * 0.62, hy + s * 0.5);
        ctx.lineTo(hx - s * 0.62, hy + s * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#7a5a3a';
        ctx.fillRect(hx - s * 0.06, hy + s * 0.4, s * 0.14, s * 0.3);
      }
      break;
    }
    case 'plains': {
      ctx.strokeStyle = 'rgba(255,240,180,0.16)';
      ctx.lineWidth = Math.max(1, r * 0.035);
      for (let i = 0; i < 4; i++) {
        const hh = hash(t.id * 313 + i * 29);
        const hx = sx + (hh - 0.5) * r * 1.1;
        const hy = sy + (hash(t.id * 57 + i * 43) - 0.5) * r * 0.85;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + r * 0.05, hy - r * 0.14);
        ctx.stroke();
      }
      break;
    }
    case 'fertile': {
      ctx.fillStyle = 'rgba(226,214,120,0.75)';
      for (let i = 0; i < 5; i++) {
        const hh = hash(t.id * 211 + i * 61);
        const hx = sx + (hh - 0.5) * r * 1.15;
        const hy = sy + (hash(t.id * 91 + i * 17) - 0.5) * r * 0.95;
        ctx.fillRect(hx, hy - r * 0.16, r * 0.045, r * 0.16);
      }
      break;
    }
    case 'wildlife': {
      ctx.fillStyle = 'rgba(235,225,190,0.55)';
      for (let i = 0; i < 3; i++) {
        const hh = hash(t.id * 401 + i * 23);
        const hx = sx + (hh - 0.5) * r * 1.1;
        const hy = sy + (hash(t.id * 79 + i * 53) - 0.5) * r * 0.9;
        ctx.beginPath();
        ctx.arc(hx, hy, r * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
      if (t.wild > 0) {
        ctx.fillStyle = '#c8a06a';
        const s = r * 0.3;
        ctx.beginPath();
        ctx.ellipse(sx - r * 0.25, sy + r * 0.25, s * 0.5, s * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#8a6a45';
        ctx.beginPath();
        ctx.moveTo(sx - r * 0.25, sy + r * 0.1);
        ctx.lineTo(sx - r * 0.33, sy - r * 0.05);
        ctx.lineTo(sx - r * 0.28, sy + r * 0.1);
        ctx.lineTo(sx - r * 0.19, sy - r * 0.05);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'lake': {
      ctx.strokeStyle = 'rgba(210,240,255,0.35)';
      ctx.lineWidth = Math.max(1, r * 0.04);
      for (let i = 0; i < 3; i++) {
        const hh = hash(t.id * 191 + i * 71);
        const hx = sx + (hh - 0.5) * r * 0.9;
        const hy = sy + (hash(t.id * 43 + i * 31) - 0.5) * r * 0.9;
        ctx.beginPath();
        ctx.moveTo(hx - r * 0.12, hy);
        ctx.quadraticCurveTo(hx, hy - r * 0.06, hx + r * 0.12, hy);
        ctx.stroke();
      }
      break;
    }
    case 'mountain': {
      ctx.fillStyle = '#8d8b95';
      ctx.beginPath();
      ctx.moveTo(sx - r * 0.45, sy + r * 0.4);
      ctx.lineTo(sx - r * 0.05, sy - r * 0.42);
      ctx.lineTo(sx + r * 0.34, sy + r * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e6e8ee';
      ctx.beginPath();
      ctx.moveTo(sx - r * 0.16, sy - r * 0.24);
      ctx.lineTo(sx - r * 0.05, sy - r * 0.42);
      ctx.lineTo(sx + r * 0.06, sy - r * 0.22);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'iron': {
      ctx.fillStyle = '#8f9bb0';
      for (let i = 0; i < 3; i++) {
        const hh = hash(t.id * 771 + i * 47);
        const hx = sx + (hh - 0.5) * r * 0.9;
        const hy = sy + (hash(t.id * 33 + i * 13) - 0.5) * r * 0.8;
        ctx.beginPath();
        ctx.moveTo(hx, hy - r * 0.13);
        ctx.lineTo(hx + r * 0.13, hy);
        ctx.lineTo(hx, hy + r * 0.13);
        ctx.lineTo(hx - r * 0.13, hy);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'ruins': {
      ctx.fillStyle = '#cfc3a6';
      ctx.fillRect(sx - r * 0.36, sy - r * 0.1, r * 0.16, r * 0.5);
      ctx.fillRect(sx + r * 0.16, sy - r * 0.22, r * 0.16, r * 0.62);
      ctx.fillRect(sx - r * 0.36, sy - r * 0.2, r * 0.7, r * 0.12);
      if (!t.ruinLooted) {
        ctx.fillStyle = 'rgba(240,220,140,0.85)';
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 420 + t.id);
        ctx.globalAlpha = 0.45 + pulse * 0.5;
        ctx.beginPath();
        ctx.arc(sx, sy - r * 0.36, r * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      break;
    }
    default:
      break;
  }
}

// --- buildings --------------------------------------------------------------
function drawBar(ctx, x, y, w, h, frac, color, bg = 'rgba(0,0,0,0.55)') {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function buildingSprite(ctx, b, t, camZ, state) {
  const def = BUILDINGS[b.type];
  const sx = t.x * camZ + cam.x;
  const sy = t.y * camZ + cam.y;
  const r = camZ;
  const size = r * 0.62;
  // base plate
  ctx.save();
  const grad = ctx.createLinearGradient(sx, sy - size * 0.6, sx, sy + size * 0.6);
  grad.addColorStop(0, 'rgba(30,25,20,0.72)');
  grad.addColorStop(1, 'rgba(20,16,12,0.9)');
  ctx.fillStyle = grad;
  roundRect(ctx, sx - size * 0.62, sy - size * 0.52, size * 1.24, size * 1.1, size * 0.22);
  ctx.fill();
  ctx.strokeStyle = alpha(state.clans[b.clan].banner, b.flash > 0 ? 1 : 0.75);
  ctx.lineWidth = Math.max(1.4, r * 0.05);
  ctx.stroke();
  if (b.flash > 0) {
    ctx.fillStyle = 'rgba(255,220,180,0.35)';
    roundRect(ctx, sx - size * 0.62, sy - size * 0.52, size * 1.24, size * 1.1, size * 0.22);
    ctx.fill();
  }
  // roof accent
  ctx.fillStyle = alpha(state.clans[b.clan].color, 0.5);
  ctx.beginPath();
  ctx.moveTo(sx - size * 0.62, sy - size * 0.52);
  ctx.lineTo(sx, sy - size * 0.86);
  ctx.lineTo(sx + size * 0.62, sy - size * 0.52);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // icon
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fs = size * (def.slots ? 0.95 : 0.85);
  ctx.font = `${fs}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
  ctx.globalAlpha = b.done ? 1 : 0.55;
  ctx.fillText(def.icon, sx, sy + size * 0.06);
  ctx.globalAlpha = 1;

  if (!b.done) {
    // construction progress ring
    const p = 1 - b.build / def.build;
    ctx.strokeStyle = 'rgba(255,214,140,0.9)';
    ctx.lineWidth = Math.max(2, r * 0.06);
    ctx.beginPath();
    ctx.arc(sx, sy, size * 0.78, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
    ctx.font = `${size * 0.5}px sans-serif`;
    ctx.fillText('🔨', sx + size * 0.62, sy - size * 0.6);
  } else {
    // workers
    const max = def.slots || 0;
    if (max > 0) {
      const w = b.workers || 0;
      for (let i = 0; i < max; i++) {
        ctx.beginPath();
        ctx.arc(sx - size * 0.34 + i * size * 0.34, sy + size * 0.52, size * 0.09, 0, Math.PI * 2);
        ctx.fillStyle = i < w ? '#ffd98a' : 'rgba(255,255,255,0.28)';
        ctx.fill();
      }
    }
  }
  // hp bar when hurt
  if (b.done && b.hp < b.maxHp - 0.5) {
    drawBar(ctx, sx - size * 0.62, sy - size * 0.95, size * 1.24, Math.max(3, r * 0.075), b.hp / b.maxHp, '#8ad07a');
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// --- units ------------------------------------------------------------------
function drawUnit(ctx, u, camZ, state, selected) {
  const def = UNITS[u.type];
  const sx = u.x * camZ + cam.x;
  const sy = u.y * camZ + cam.y;
  const r = camZ;
  const rad = r * (def.hero ? 0.3 : 0.24);
  const clan = state.clans[u.clan];
  ctx.save();
  if (selected) {
    ctx.beginPath();
    ctx.arc(sx, sy, rad * 1.55, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffe9a8';
    ctx.lineWidth = Math.max(1.5, r * 0.05);
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // shadow
  ctx.beginPath();
  ctx.ellipse(sx, sy + rad * 0.75, rad * 0.95, rad * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  // body
  ctx.beginPath();
  ctx.arc(sx, sy, rad, 0, Math.PI * 2);
  ctx.fillStyle = u.flash > 0 ? '#ffffff' : clan.color;
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, r * 0.04);
  ctx.strokeStyle = 'rgba(15,12,10,0.8)';
  ctx.stroke();
  // helmet arc
  ctx.beginPath();
  ctx.arc(sx, sy, rad * 0.98, Math.PI * 1.05, Math.PI * 1.95);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = Math.max(1, r * 0.035);
  ctx.stroke();
  // icon
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${rad * 1.3}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
  ctx.fillText(def.icon, sx, sy + rad * 0.08);
  // attack lunge
  if (u.attackAnim > 0) {
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = Math.max(1.5, r * 0.05);
    ctx.beginPath();
    ctx.arc(sx, sy, rad * 1.35, u.facing > 0 ? -0.6 : 2.4, u.facing > 0 ? 0.6 : 3.7);
    ctx.stroke();
  }
  ctx.restore();
  // hp
  if (u.hp < u.maxHp - 0.5) {
    drawBar(ctx, sx - rad, sy - rad * 1.85, rad * 2, Math.max(3, r * 0.07), u.hp / u.maxHp, '#e07070');
  }
}

// --- main draw --------------------------------------------------------------
export function draw(ctx, state, canvas, ui, dt) {
  const w = canvas._w, h = canvas._h;
  const season = SEASONS[seasonIndexOf(state)];
  const winter = winterAmount(state);
  ctx.clearRect(0, 0, w, h);
  // background
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, winter > 0.3 ? '#2a3448' : '#20303a');
  bg.addColorStop(1, winter > 0.3 ? '#131a26' : '#101b1c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // ---- terrain
  for (const t of state.tiles) {
    const sx = t.x * cam.zoom + cam.x;
    const sy = t.y * cam.zoom + cam.y;
    if (sx < -cam.zoom * 2 || sy < -cam.zoom * 2 || sx > w + cam.zoom * 2 || sy > h + cam.zoom * 2) continue;
    const td = TERRAIN[t.terrain];
    const base = hash(t.id * 17) > 0.5 ? td.color : td.alt;
    hexPath(ctx, sx, sy, cam.zoom * 0.985);
    ctx.fillStyle = winter > 0.25 ? mix(base, '#e8f2ff', winter * 0.55) : base;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    decorate(ctx, t, cam.zoom);
  }

  // ---- territory tint
  for (const t of state.tiles) {
    if (t.owner == null) continue;
    const sx = t.x * cam.zoom + cam.x;
    const sy = t.y * cam.zoom + cam.y;
    if (sx < -cam.zoom * 2 || sy < -cam.zoom * 2 || sx > w + cam.zoom * 2 || sy > h + cam.zoom * 2) continue;
    const clan = state.clans[t.owner];
    hexPath(ctx, sx, sy, cam.zoom * 0.985);
    ctx.fillStyle = alpha(clan.color, t.captureProgress > 0 ? 0.3 : 0.19);
    ctx.fill();
  }

  // ---- borders (drawn per shared edge)
  for (const t of state.tiles) {
    const sx = t.x * cam.zoom + cam.x;
    const sy = t.y * cam.zoom + cam.y;
    if (sx < -cam.zoom * 2 || sy < -cam.zoom * 2 || sx > w + cam.zoom * 2 || sy > h + cam.zoom * 2) continue;
    const corners = hexCorners(sx, sy, cam.zoom * 0.985);
    const dirs = [[[1, 0], 0], [[1, -1], 3], [[0, -1], 4], [[-1, 0], 1], [[-1, 1], 2], [[0, 1], 5]];
    for (const [[dq, dr], cIdx] of dirs) {
      const n = state.tileByKey.get((t.q + dq) + ',' + (t.r + dr));
      const nOwner = n ? n.owner : null; // off-map edges have no owner
      if (nOwner === t.owner) continue;
      const a = corners[cIdx], b2 = corners[(cIdx + 1) % 6];
      if (t.owner != null) {
        ctx.strokeStyle = alpha(state.clans[t.owner].banner, 0.85);
        ctx.lineWidth = Math.max(2, cam.zoom * 0.075);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b2[0], b2[1]);
        ctx.stroke();
      } else if (nOwner != null) {
        ctx.strokeStyle = alpha(state.clans[nOwner].banner, 0.85);
        ctx.lineWidth = Math.max(2, cam.zoom * 0.075);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b2[0], b2[1]);
        ctx.stroke();
      }
    }
    if (t.captureProgress > 0 && t.captureClan != null) {
      ctx.strokeStyle = alpha(state.clans[t.captureClan].color, 0.9);
      ctx.lineWidth = Math.max(3, cam.zoom * 0.1);
      const pts = hexCorners(sx, sy, cam.zoom * 0.9);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 6; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      drawBar(ctx, sx - cam.zoom * 0.35, sy - cam.zoom * 0.62, cam.zoom * 0.7, cam.zoom * 0.08, t.captureProgress / 1.4, '#ff9a6a');
    }
  }

  // ---- build / colonize highlights
  if (ui.highlightTiles && ui.highlightTiles.size) {
    for (const id of ui.highlightTiles) {
      const t = tileById(state, id);
      if (!t) continue;
      const sx = t.x * cam.zoom + cam.x;
      const sy = t.y * cam.zoom + cam.y;
      hexPath(ctx, sx, sy, cam.zoom * 0.9);
      ctx.fillStyle = alpha(ui.highlightColor || '#ffd98a', 0.22);
      ctx.fill();
      ctx.strokeStyle = alpha(ui.highlightColor || '#ffd98a', 0.85);
      ctx.lineWidth = Math.max(1.5, cam.zoom * 0.05);
      ctx.stroke();
      if (ui.highlightCosts && ui.highlightCosts.has(id)) {
        ctx.font = `${Math.max(10, cam.zoom * 0.26)}px system-ui,sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(ui.highlightCosts.get(id), sx, sy + cam.zoom * 0.6);
      }
    }
  }

  // ---- hover
  if (ui.hoverTile && !ui.highlightTiles?.size) {
    const t = ui.hoverTile;
    const sx = t.x * cam.zoom + cam.x, sy = t.y * cam.zoom + cam.y;
    hexPath(ctx, sx, sy, cam.zoom * 0.9);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = Math.max(1.5, cam.zoom * 0.045);
    ctx.stroke();
  }

  // ---- buildings
  for (const t of state.tiles) {
    for (const b of t.buildings) buildingSprite(ctx, b, t, cam.zoom, state);
  }

  // ---- units: orders first (below units), then bodies
  for (const u of state.units) {
    if (!ui.selectedUnits?.has(u.id)) continue;
    if (u.destTileId != null || u.targetUnitId != null || u.targetBuildingId != null) {
      const tx = u.destTileId != null ? tileById(state, u.destTileId) : null;
      let ex, ey;
      if (tx) { ex = tx.x; ey = tx.y; }
      else if (u.targetUnitId != null) {
        const tu = state.unitById.get(u.targetUnitId);
        if (!tu) continue;
        ex = tu.x; ey = tu.y;
      } else {
        const tb = state.buildingsById.get(u.targetBuildingId);
        if (!tb) continue;
        const tt = tileById(state, tb.tileId);
        ex = tt.x; ey = tt.y;
      }
      ctx.strokeStyle = 'rgba(255,230,160,0.75)';
      ctx.lineWidth = Math.max(1.2, cam.zoom * 0.035);
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(u.x * cam.zoom + cam.x, u.y * cam.zoom + cam.y);
      ctx.lineTo(ex * cam.zoom + cam.x, ey * cam.zoom + cam.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(ex * cam.zoom + cam.x, ey * cam.zoom + cam.y, cam.zoom * 0.1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,230,160,0.8)';
      ctx.fill();
    }
  }
  for (const u of state.units) {
    drawUnit(ctx, u, cam.zoom, state, ui.selectedUnits?.has(u.id));
  }

  // ---- selected building ring
  if (ui.selectedBuildingId != null) {
    const b = state.buildingsById.get(ui.selectedBuildingId);
    if (b) {
      const t = tileById(state, b.tileId);
      hexPath(ctx, t.x * cam.zoom + cam.x, t.y * cam.zoom + cam.y, cam.zoom * 0.92);
      ctx.strokeStyle = '#ffe9a8';
      ctx.lineWidth = Math.max(1.5, cam.zoom * 0.05);
      ctx.stroke();
    }
  }

  // ---- projectiles
  for (const p of state.projectiles) {
    const k = 1 - p.life / p.max;
    const x = (p.x + (p.tx - p.x) * k) * cam.zoom + cam.x;
    const y = (p.y + (p.ty - p.y) * k) * cam.zoom + cam.y;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.5, cam.zoom * 0.05), 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
  }

  // ---- floaters
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of state.floaters) {
    const a = Math.max(0, Math.min(1, f.life / f.maxLife));
    const x = f.x * cam.zoom + cam.x;
    const y = f.y * cam.zoom + cam.y;
    const size = Math.max(11, cam.zoom * 0.26 * (f.size || 1));
    ctx.globalAlpha = a;
    ctx.font = `700 ${size}px system-ui,"Segoe UI",sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText(f.text, x, y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, x, y);
    ctx.globalAlpha = 1;
  }

  // ---- snow
  if (winter > 0.15) {
    snowDrift += dt;
    ctx.fillStyle = `rgba(255,255,255,${0.35 + winter * 0.45})`;
    for (const s of snow) {
      const x = ((s.x + snowDrift * s.v * 0.06) % 1) * w;
      const y = ((s.y + snowDrift * s.v * 0.12) % 1) * h;
      ctx.beginPath();
      ctx.arc(x, y, s.s * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- season vignette
  if (season.key === 'winter') {
    ctx.fillStyle = `rgba(200,225,255,${0.06 * winter})`;
    ctx.fillRect(0, 0, w, h);
  }
}

function mix(a, b, k) {
  const pa = a.replace('#', ''), pb = b.replace('#', '');
  const out = [];
  for (let i = 0; i < 3; i++) {
    const va = parseInt(pa.slice(i * 2, i * 2 + 2), 16);
    const vb = parseInt(pb.slice(i * 2, i * 2 + 2), 16);
    out.push(Math.round(va + (vb - va) * k));
  }
  return `rgb(${out[0]},${out[1]},${out[2]})`;
}

// --- minimap ----------------------------------------------------------------
export function drawMinimap(mctx, state, minimap) {
  const w = minimap._w, h = minimap._h;
  if (!w || !h) return;
  mctx.clearRect(0, 0, w, h);
  mctx.fillStyle = '#101820';
  mctx.fillRect(0, 0, w, h);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const t of state.tiles) {
    minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
    minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
  }
  const pad = 0.9;
  const sx = w / (maxX - minX + pad * 2);
  const sy = h / (maxY - minY + pad * 2);
  const s = Math.min(sx, sy) * 0.62;
  const ox = w / 2 - ((minX + maxX) / 2) * s;
  const oy = h / 2 - ((minY + maxY) / 2) * s;
  minimap._map = { s, ox, oy };
  for (const t of state.tiles) {
    mctx.fillStyle = TERRAIN[t.terrain].color;
    mctx.fillRect(t.x * s + ox - s * 0.55, t.y * s + oy - s * 0.55, s * 1.1, s * 1.1);
  }
  for (const t of state.tiles) {
    if (t.owner == null) continue;
    mctx.fillStyle = alpha(state.clans[t.owner].color, 0.55);
    mctx.fillRect(t.x * s + ox - s * 0.55, t.y * s + oy - s * 0.55, s * 1.1, s * 1.1);
  }
  for (const u of state.units) {
    mctx.fillStyle = state.clans[u.clan].banner;
    mctx.beginPath();
    mctx.arc(u.x * s + ox, u.y * s + oy, Math.max(1.6, s * 0.16), 0, Math.PI * 2);
    mctx.fill();
  }
}
