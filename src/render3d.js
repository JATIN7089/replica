// ============================================================================
// Northhold — 3D world renderer (three.js r169, vendored).
// Draws the hex map, terrain, decorations, buildings, units and effects in
// three dimensions with an RTS camera rig. This module only reads game state.
// ============================================================================
import * as THREE from '../vendor/three.module.min.js';
import { BUILDINGS, SEASONS } from './data.js';
import { hexToWorld, tileById, seasonIndexOf, winterAmount } from './engine.js';
import {
  buildTileMesh, buildDecorations, buildBuildingMesh, buildUnitMesh,
  hexRingGeometry, HEX_RADIUS, TILE_HEIGHT,
} from './models3d.js';

// ---------------------------------------------------------------- hex → 3D
export function hexTo3D(x, z) {
  // game space is 2D: tile.x / tile.y (see engine.hexToWorld) → ground plane
  return { x, z };
}
export function tileTo3D(tile) {
  const w = hexToWorld(tile.q, tile.r, 1);
  return { x: w.x, z: w.y };
}

// ---------------------------------------------------------------- camera rig
export function createCameraRig(overrides = {}) {
  return {
    target: { x: 0, z: 0 },
    distance: 26,
    yaw: Math.PI * 0.25,
    pitch: 0.92,
    minDistance: 7,
    maxDistance: 72,
    minPitch: 0.5,
    maxPitch: 1.45,
    ...overrides,
  };
}
export const CAM = createCameraRig({ distance: 26 });

export function rigEye(rig) {
  const cosP = Math.cos(rig.pitch);
  return {
    x: rig.target.x + Math.sin(rig.yaw) * cosP * rig.distance,
    y: Math.sin(rig.pitch) * rig.distance,
    z: rig.target.z + Math.cos(rig.yaw) * cosP * rig.distance,
  };
}

export function applyRig(rig, camera) {
  const eye = rigEye(rig);
  camera.position.set(eye.x, eye.y, eye.z);
  camera.lookAt(rig.target.x, 0, rig.target.z);
  camera.updateMatrixWorld();
}

const _raycaster = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit = new THREE.Vector3();

/** Screen css pixels → point on the ground plane (y = 0). */
export function screenToGround(rig, camera, sx, sy, width, height) {
  applyRig(rig, camera);
  _raycaster.setFromCamera(new THREE.Vector2((sx / width) * 2 - 1, -(sy / height) * 2 + 1), camera);
  if (!_raycaster.ray.intersectPlane(_plane, _hit)) return null;
  return { x: _hit.x, z: _hit.z };
}

/** Ground point → screen css pixels. */
export function groundToScreen(rig, camera, x, z, width, height, elevation = 0) {
  applyRig(rig, camera);
  const v = new THREE.Vector3(x, elevation, z).project(camera);
  return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height, behind: v.z > 1 };
}

// ---------------------------------------------------------------- text
const textCache = new Map();
function textCanvas(text, color, size) {
  const key = `${text}|${color}|${size}`;
  let canvas = textCache.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    ctx.font = `bold ${size}px system-ui, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(text, 80, 40);
    ctx.fillStyle = color;
    ctx.fillText(text, 80, 40);
    textCache.set(key, canvas);
    if (textCache.size > 240) textCache.delete(textCache.keys().next().value);
  }
  return canvas;
}

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.isMesh || o.isSprite || o.isLine) {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.map && m.map.isCanvasTexture) m.map.dispose();
        m.dispose();
      }
    }
  });
}

/** Is WebGL usable here? (jsdom and locked-down browsers say no.) */
export function webglAvailable(canvas = null) {
  try {
    if (canvas) return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Screen point → hex tile. Pure maths: usable in tests without WebGL. */
export function pickTileFromScreen(state, rig, camera, sx, sy, width, height) {
  const hit = screenToGround(rig, camera, sx, sy, width, height);
  if (!hit) return null;
  const r = Math.round(hit.z / 1.5);
  const q = Math.round(hit.x / Math.sqrt(3) - r / 2);
  let best = null;
  let bestD = Infinity;
  for (let dq = -1; dq <= 1; dq++) {
    for (let dr = -1; dr <= 1; dr++) {
      const t = state.tileByKey.get(`${q + dq},${r + dr}`);
      if (!t) continue;
      const d = (t.x - hit.x) ** 2 + (t.y - hit.z) ** 2;
      if (d < bestD) { best = t; bestD = d; }
    }
  }
  return best;
}

// ---------------------------------------------------------------- renderer
/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ rendererFactory?: (canvas: HTMLCanvasElement) => any }} [opts]
 *   rendererFactory lets tests swap in a fake GL backend so the whole 3D
 *   pipeline (scene building, syncing, effects) can be exercised without a GPU.
 */
export function createRenderer3D(canvas, opts = {}) {
  const renderer = opts.rendererFactory
    ? opts.rendererFactory(canvas)
    : new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  if (renderer.setPixelRatio) {
    renderer.setPixelRatio(Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
  }
  if (renderer.shadowMap) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 400);
  const rig = createCameraRig();

  // --- sky dome, painted with a canvas gradient (original art)
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 8;
  skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d');
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(200, 20, 14),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  scene.add(sky);
  scene.fog = new THREE.Fog('#93b0c4', 42, 150);

  function paintSky(seasonKey, winter) {
    const g = skyCtx.createLinearGradient(0, 0, 0, 256);
    const bands = {
      winter: ['#1b2a42', '#4a6486', '#c9d9ea'],
      summer: ['#123a63', '#5fa4cf', '#d8ecf3'],
      autumn: ['#22314c', '#8b7d68', '#e3cba4'],
      spring: ['#17364f', '#6f9fb9', '#dcecef'],
    }[seasonKey] || ['#17364f', '#6f9fb9', '#dcecef'];
    g.addColorStop(0, bands[0]);
    g.addColorStop(winter > 0.35 ? 0.45 : 0.62, bands[1]);
    g.addColorStop(1, bands[2]);
    skyCtx.fillStyle = g;
    skyCtx.fillRect(0, 0, 8, 256);
    skyTex.needsUpdate = true;
  }

  // --- lights
  const hemi = new THREE.HemisphereLight('#e2eef8', '#39412f', 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4de', 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  const SPAN = 15;
  sun.shadow.camera.left = -SPAN;
  sun.shadow.camera.right = SPAN;
  sun.shadow.camera.top = SPAN;
  sun.shadow.camera.bottom = -SPAN;
  sun.shadow.bias = -0.0011;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  scene.add(new THREE.AmbientLight('#ffffff', 0.22));

  // --- world layers
  const layers = {
    terrain: new THREE.Group(),
    decor: new THREE.Group(),
    territory: new THREE.Group(),
    buildings: new THREE.Group(),
    units: new THREE.Group(),
    fx: new THREE.Group(),
  };
  scene.add(layers.terrain, layers.decor, layers.territory, layers.buildings, layers.units, layers.fx);

  const maps = {
    tiles: new Map(),        // tileId → { slab, decor, base }
    territory: new Map(),    // tileId → ring
    buildings: new Map(),    // buildingId → { group, type, clan, built, flash }
    units: new Map(),        // unitId → { group, parts, hpBar, prev }
    highlights: new Map(),   // tileId → ring
    markers: new Map(),      // unitId → { line, dot }
    floaters: new Map(),     // floater → sprite
  };
  const projectiles = [];
  let hoverRing = null;
  let state = null;
  let time = 0;
  let built = false;
  let lastSeasonKey = '';

  const ringGeo = hexRingGeometry(HEX_RADIUS * 0.86, HEX_RADIUS * 0.99, TILE_HEIGHT + 0.014);
  const unitRingGeo = hexRingGeometry(0.26, 0.34, 0.006);

  function size() {
    const w = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 960;
    const h = canvas.clientHeight || (canvas.parentElement && canvas.parentElement.clientHeight) || 600;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    canvas._w = w;
    canvas._h = h;
    return { w, h };
  }
  size();

  // ---------------------------------------------------------------- build
  function buildWorld(s) {
    disposeGroup(layers.terrain);
    disposeGroup(layers.decor);
    layers.terrain.clear();
    layers.decor.clear();
    maps.tiles.clear();
    for (const tile of s.tiles) {
      const { x, z } = tileTo3D(tile);
      const mesh = buildTileMesh(tile);
      mesh.position.set(x, 0, z);
      layers.terrain.add(mesh);
      const decor = buildDecorations(tile);
      decor.position.set(x, 0, z);
      layers.decor.add(decor);
      const slab = mesh.getObjectByName('slab');
      maps.tiles.set(tile.id, { group: mesh, slab, decor, base: slab.material.color.clone() });
    }
    built = true;
    lastSeasonKey = '';
  }

  function syncTerritory(s) {
    const wanted = new Set();
    for (const tile of s.tiles) {
      if (tile.owner == null) continue;
      wanted.add(tile.id);
      const clan = s.clans[tile.owner];
      let ring = maps.territory.get(tile.id);
      if (!ring) {
        ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
          color: clan.color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
        }));
        const { x, z } = tileTo3D(tile);
        ring.position.set(x, 0, z);
        maps.territory.set(tile.id, ring);
        layers.territory.add(ring);
      }
      ring.material.color.set(clan.color);
      ring.material.opacity = tile.captureProgress > 0 ? 0.9 : 0.5;
    }
    for (const [id, ring] of maps.territory) {
      if (wanted.has(id)) continue;
      layers.territory.remove(ring);
      ring.material.dispose();
      maps.territory.delete(id);
    }
  }

  function syncBuildings(s) {
    const seen = new Set();
    for (const tile of s.tiles) {
      const { x, z } = tileTo3D(tile);
      for (const b of tile.buildings) {
        seen.add(b.id);
        let entry = maps.buildings.get(b.id);
        if (!entry || entry.type !== b.type || entry.clan !== b.clan) {
          if (entry) { layers.buildings.remove(entry.group); disposeGroup(entry.group); }
          const clan = s.clans[b.clan];
          const group = buildBuildingMesh(b.type, clan.color, clan.banner, b.done);
          group.userData.buildingId = b.id;
          group.position.set(x, TILE_HEIGHT, z);
          group.rotation.y = ((b.id * 37) % 9) * 0.13 - 0.55;
          layers.buildings.add(group);
          entry = { group, type: b.type, clan: b.clan, built: b.done ? 1 : 0, flash: 0 };
          maps.buildings.set(b.id, entry);
        }
        // grow while under construction
        const def = BUILDINGS[b.type];
        const target = b.done ? 1 : 1 - Math.max(0, b.build) / Math.max(0.001, def.build || 1);
        entry.built += (target - entry.built) * 0.15;
        entry.group.scale.setScalar(b.done ? 1 : 0.45 + entry.built * 0.6);
        const scaffold = entry.group.getObjectByName('scaffold');
        if (scaffold) scaffold.visible = !b.done;
        // damage flash
        if ((b.flash > 0) !== (entry.flash > 0)) {
          entry.flash = b.flash > 0 ? 1 : 0;
          entry.group.traverse((o) => {
            if (o.isMesh && o.material && o.material.emissive) {
              o.material = o.material.clone();
              o.material.emissive = new THREE.Color(entry.flash ? '#ff5f2e' : '#000000');
              o.material.emissiveIntensity = entry.flash ? 0.85 : 1;
            }
          });
        }
      }
    }
    for (const [id, entry] of maps.buildings) {
      if (seen.has(id)) continue;
      layers.buildings.remove(entry.group);
      disposeGroup(entry.group);
      maps.buildings.delete(id);
    }
  }

  function makeHpBar() {
    const group = new THREE.Group();
    group.position.y = 1.02;
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.46, 0.075),
      new THREE.MeshBasicMaterial({ color: '#12100e', transparent: true, opacity: 0.8, depthWrite: false }),
    );
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.05),
      new THREE.MeshBasicMaterial({ color: '#7fd07a', transparent: true, depthWrite: false }),
    );
    fill.position.z = 0.004;
    group.add(bg, fill);
    group.renderOrder = 5;
    return { group, fill };
  }

  function syncUnits(s, ui) {
    const seen = new Set();
    for (const u of s.units) {
      seen.add(u.id);
      let entry = maps.units.get(u.id);
      if (!entry || entry.type !== u.type || entry.clan !== u.clan) {
        if (entry) { layers.units.remove(entry.group); disposeGroup(entry.group); }
        const clan = s.clans[u.clan];
        const group = buildUnitMesh(u.type, clan.color, clan.banner);
        group.userData.unitId = u.id;
        layers.units.add(group);
        entry = { group, type: u.type, clan: u.clan, parts: group.userData.parts, hpBar: null, prev: { x: u.x, y: u.y } };
        maps.units.set(u.id, entry);
      }
      // unit world coordinates are already in the same 2D space as tiles
      entry.group.position.set(u.x, TILE_HEIGHT, u.y);
      const dx = u.x - entry.prev.x;
      const dy = u.y - entry.prev.y;
      entry.prev.x = u.x;
      entry.prev.y = u.y;

      const parts = entry.parts;
      if (parts) {
        const moving = Math.hypot(dx, dy) > 0.0015;
        const bob = moving ? Math.sin(time * 11 + u.id * 0.7) : Math.sin(time * 2 + u.id) * 0.2;
        parts.body.position.y = moving ? Math.abs(bob) * 0.06 : 0;
        parts.armL.rotation.x = moving ? bob * 0.6 : 0;
        parts.armR.rotation.x = moving ? -bob * 0.6 : 0;
        if (moving) {
          const heading = Math.atan2(dx, dy);
          parts.body.rotation.y += angleDelta(parts.body.rotation.y, heading) * 0.2;
        } else if (u.facing < 0) {
          parts.body.rotation.y += angleDelta(parts.body.rotation.y, Math.PI * 0.5) * 0.05;
        }
        if (u.attackAnim > 0) {
          parts.weapon.rotation.x = -1.25;
        } else {
          parts.weapon.rotation.x *= 0.75;
        }
        parts.body.rotation.z = u.attackAnim > 0 ? 0.1 : 0;
      }

      const ring = entry.group.getObjectByName('selectRing');
      if (ring) {
        ring.material.opacity = ui.selectedUnits && ui.selectedUnits.has(u.id) ? 0.95 : 0;
        ring.rotation.y = time * 0.5;
      }
      if (u.hp < u.maxHp - 0.5) {
        if (!entry.hpBar) { entry.hpBar = makeHpBar(); entry.group.add(entry.hpBar.group); }
        entry.hpBar.group.visible = true;
        const frac = Math.max(0, u.hp / u.maxHp);
        entry.hpBar.fill.scale.x = frac;
        entry.hpBar.fill.position.x = -(1 - frac) * 0.2;
        entry.hpBar.group.quaternion.copy(camera.quaternion);
      } else if (entry.hpBar) {
        entry.hpBar.group.visible = false;
      }
    }
    for (const [id, entry] of maps.units) {
      if (seen.has(id)) continue;
      layers.units.remove(entry.group);
      disposeGroup(entry.group);
      maps.units.delete(id);
    }
  }

  function angleDelta(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function syncHighlights(s, ui) {
    const wanted = ui.highlightTiles instanceof Set ? ui.highlightTiles : new Set();
    const color = ui.highlightColor || '#ffd98a';
    for (const id of wanted) {
      if (maps.highlights.has(id)) continue;
      const tile = tileById(s, id);
      if (!tile) continue;
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false,
      }));
      const { x, z } = tileTo3D(tile);
      ring.position.set(x, 0, z);
      maps.highlights.set(id, ring);
      layers.fx.add(ring);
    }
    for (const [id, ring] of maps.highlights) {
      if (wanted.has(id)) { ring.material.color.set(color); continue; }
      layers.fx.remove(ring);
      ring.material.dispose();
      maps.highlights.delete(id);
    }
    if (ui.hoverTile) {
      if (!hoverRing) {
        hoverRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
          color: '#ffffff', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false,
        }));
        layers.fx.add(hoverRing);
      }
      const { x, z } = tileTo3D(ui.hoverTile);
      hoverRing.position.set(x, 0, z);
      hoverRing.visible = true;
    } else if (hoverRing) {
      hoverRing.visible = false;
    }
  }

  function syncMarkers(s, ui) {
    const wanted = new Map();
    for (const id of ui.selectedUnits || []) {
      const u = s.unitById.get(id);
      if (!u) continue;
      let target = null;
      if (u.destTileId != null) {
        const t = tileById(s, u.destTileId);
        if (t) target = t;
      } else if (u.targetUnitId != null) {
        const tu = s.unitById.get(u.targetUnitId);
        if (tu) target = { x: tu.x, y: tu.y };
      } else if (u.targetBuildingId != null) {
        const b = s.buildingsById.get(u.targetBuildingId);
        if (b) { const t = tileById(s, b.tileId); if (t) target = t; }
      }
      if (target) wanted.set(id, { unit: u, target });
    }
    for (const [id, m] of maps.markers) {
      if (wanted.has(id)) continue;
      layers.fx.remove(m.line, m.dot);
      m.line.geometry.dispose();
      m.line.material.dispose();
      m.dot.geometry.dispose();
      m.dot.material.dispose();
      maps.markers.delete(id);
    }
    for (const [id, { unit, target }] of wanted) {
      let m = maps.markers.get(id);
      if (!m) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
          new THREE.LineDashedMaterial({
            color: '#ffe9a8', dashSize: 0.28, gapSize: 0.2, transparent: true, opacity: 0.9, depthWrite: false,
          }),
        );
        const dot = new THREE.Mesh(
          new THREE.RingGeometry(0.11, 0.19, 14),
          new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
        );
        dot.rotation.x = -Math.PI / 2;
        layers.fx.add(line, dot);
        m = { line, dot };
        maps.markers.set(id, m);
      }
      const from = { x: unit.x, z: unit.y };
      const to = { x: target.x, z: target.y };
      const pos = m.line.geometry.attributes.position;
      pos.setXYZ(0, from.x, TILE_HEIGHT + 0.1, from.z);
      pos.setXYZ(1, to.x, TILE_HEIGHT + 0.1, to.z);
      pos.needsUpdate = true;
      m.line.computeLineDistances();
      m.dot.position.set(to.x, TILE_HEIGHT + 0.06, to.z);
    }
  }

  function syncEffects(s) {
    const live = new Set();
    for (const f of s.floaters) {
      live.add(f);
      let sprite = maps.floaters.get(f);
      if (!sprite) {
        const tex = new THREE.CanvasTexture(textCanvas(f.text, f.color, Math.round(46 * (f.size || 1))));
        tex.colorSpace = THREE.SRGBColorSpace;
        sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
        sprite.scale.set(1.2, 0.6, 1);
        layers.fx.add(sprite);
        maps.floaters.set(f, sprite);
      }
      sprite.position.set(f.x, 1.05 + (f.maxLife - f.life) * 0.8, f.y);
      sprite.material.opacity = Math.max(0, Math.min(1, f.life / f.maxLife));
    }
    for (const [f, sprite] of maps.floaters) {
      if (live.has(f)) continue;
      layers.fx.remove(sprite);
      sprite.material.map.dispose();
      sprite.material.dispose();
      maps.floaters.delete(f);
    }
    // projectiles
    for (let i = 0; i < s.projectiles.length; i++) {
      const p = s.projectiles[i];
      let mesh = projectiles[i];
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.075, 7, 6),
          new THREE.MeshBasicMaterial({ color: '#ffd27a' }),
        );
        layers.fx.add(mesh);
        projectiles.push(mesh);
      }
      const k = 1 - p.life / p.max;
      mesh.position.set(p.x + (p.tx - p.x) * k, 0.8 + Math.sin(k * Math.PI) * 0.35, p.y + (p.ty - p.y) * k);
      mesh.visible = true;
    }
    for (let i = s.projectiles.length; i < projectiles.length; i++) projectiles[i].visible = false;
  }

  // ---------------------------------------------------------------- seasons
  const SNOW = new THREE.Color('#eaf2fb');
  const SEASON_TINT = {
    spring: new THREE.Color('#b9d489'),
    summer: new THREE.Color('#f4e3a6'),
    autumn: new THREE.Color('#dfae6d'),
    winter: new THREE.Color('#cfe0f0'),
  };
  function syncSeason(s) {
    const season = SEASONS[seasonIndexOf(s)];
    const winter = winterAmount(s) || 0;
    const key = `${season.key}|${winter.toFixed(2)}`;
    if (key === lastSeasonKey) return;
    lastSeasonKey = key;
    paintSky(season.key, winter);
    const tint = SEASON_TINT[season.key];
    for (const [id, entry] of maps.tiles) {
      const tile = tileById(s, id);
      if (!tile) continue;
      const c = entry.base.clone();
      if (tile.terrain !== 'lake') {
        c.lerp(tint, 0.12);
        c.lerp(SNOW, winter * 0.68);
      }
      entry.slab.material.color.copy(c);
    }
    const frozen = season.key === 'winter';
    hemi.intensity = frozen ? 0.62 : 0.8;
    sun.intensity = frozen ? 1.1 : 1.6;
    scene.fog.color.set(frozen ? '#bccfe2' : '#93b0c4');
    for (const [, entry] of maps.tiles) {
      const water = entry.group.getObjectByName('water');
      if (water) water.material.opacity = frozen ? 0.96 : 0.82;
    }
  }

  // ---------------------------------------------------------------- picking
  function screenToTile(s, sx, sy) {
    return pickTileFromScreen(s, rig, camera, sx, sy, canvas._w, canvas._h);
  }

  // ---------------------------------------------------------------- draw
  function draw(s, ui, dt) {
    if (!built || state !== s) { state = s; buildWorld(s); }
    time += dt;
    size();
    syncSeason(s);
    syncTerritory(s);
    syncBuildings(s);
    syncUnits(s, ui);
    syncHighlights(s, ui);
    syncMarkers(s, ui);
    syncEffects(s);

    // keep the shadow camera on the action
    sun.position.set(rig.target.x + 15, 26, rig.target.z + 11);
    sun.target.position.set(rig.target.x, 0, rig.target.z);
    sun.target.updateMatrixWorld();
    sky.position.set(rig.target.x, 0, rig.target.z);
    applyRig(rig, camera);
    renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------- camera
  function clampTarget() {
    rig.target.x = Math.max(-34, Math.min(34, rig.target.x));
    rig.target.z = Math.max(-34, Math.min(34, rig.target.z));
  }
  function panBy(dxPx, dyPx) {
    const scale = rig.distance * 0.0017;
    const cosY = Math.cos(rig.yaw);
    const sinY = Math.sin(rig.yaw);
    rig.target.x -= (dxPx * cosY - dyPx * sinY) * scale;
    rig.target.z -= (dxPx * sinY + dyPx * cosY) * scale;
    clampTarget();
  }
  function zoomAt(sx, sy, factor) {
    const before = screenToGround(rig, camera, sx, sy, canvas._w, canvas._h);
    rig.distance = Math.max(rig.minDistance, Math.min(rig.maxDistance, rig.distance / factor));
    const after = screenToGround(rig, camera, sx, sy, canvas._w, canvas._h);
    if (before && after) {
      rig.target.x += before.x - after.x;
      rig.target.z += before.z - after.z;
      clampTarget();
    }
  }

  return {
    kind: '3d',
    scene,
    layers,
    camera,
    renderer,
    rig,
    draw,
    size,
    screenToTile,
    groundToScreen: (x, z, elevation = 0) => groundToScreen(rig, camera, x, z, canvas._w, canvas._h, elevation),
    centerOn: (x, z) => { rig.target.x = x; rig.target.z = z; clampTarget(); },
    panBy,
    zoomAt,
    rotateBy: (rad) => { rig.yaw += rad; },
    tiltBy: (rad) => { rig.pitch = Math.max(rig.minPitch, Math.min(rig.maxPitch, rig.pitch + rad)); },
    setZoom: (d) => { rig.distance = Math.max(rig.minDistance, Math.min(rig.maxDistance, d)); },
    getZoom: () => rig.distance,
    getTarget: () => ({ ...rig.target }),
    resize: size,
    dispose() {
      for (const l of Object.values(layers)) disposeGroup(l);
      renderer.dispose();
    },
  };
}
