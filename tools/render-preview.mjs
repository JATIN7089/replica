// ============================================================================
// Northhold — offline scene preview (development tool, not part of the game).
//
// The game renders through WebGL, which a headless sandbox cannot run. This tool
// loads the *real* scene graph (the same three.js objects the game builds), walks
// it and rasterises it with a small software renderer into a PNG. It is a
// geometry/material/layout check — not a pixel-accurate WebGL screenshot — so we
// can see what the world actually looks like while building it.
//
//   node tools/render-preview.mjs [--out file.png] [--yaw 0.8] [--pitch 0.95]
//        [--distance 26] [--seed 11] [--months 3] [--width 1280] [--height 720]
// ============================================================================
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// ---------------------------------------------------------------- args
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
const OUT = args.out || 'preview-3d.png';
const W = Number(args.width || 1280);
const H = Number(args.height || 720);
const SEED = Number(args.seed || 11);
const MONTHS = Number(args.months || 3);
const DIFFICULTY = args.difficulty || 'normal';
const YAW = Number(args.yaw || 0.78);
const PITCH = Number(args.pitch || 0.95);
const DISTANCE = Number(args.distance || 30);
const CAM_AT = args.center === 'player' ? 'player' : 'map';

// ---------------------------------------------------------------- dom shim
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement;
Object.defineProperty(dom.window.HTMLCanvasElement.prototype, 'clientWidth', { get() { return W; } });
Object.defineProperty(dom.window.HTMLCanvasElement.prototype, 'clientHeight', { get() { return H; } });
dom.window.HTMLCanvasElement.prototype.getContext = function (kind) {
  if (kind !== '2d') return null;
  const grad = { addColorStop() {} };
  return new Proxy({ canvas: this, createLinearGradient: () => grad, createRadialGradient: () => grad, measureText: () => ({ width: 12 }) }, {
    get(t, p) { if (p in t) return t[p]; if (typeof p === 'symbol' || p === 'then') return undefined; return () => {}; },
    set(t, p, v) { t[p] = v; return true; },
  });
};

const THREE = await import('../vendor/three.module.min.js');
const E = await import('../src/engine.js');
const { aiStep } = await import('../src/ai.js');
const { createRenderer3D } = await import('../src/render3d.js');

// ---------------------------------------------------------------- build the world
const canvas = document.createElement('canvas');
const gl = { setPixelRatio() {}, setSize() {}, render() {}, shadowMap: {}, dispose() {} };
const r3d = createRenderer3D(canvas, { rendererFactory: () => gl });
const state = E.createGame({ clanId: 'wolf', difficulty: DIFFICULTY, mapSeed: SEED });
const ui = { selectedUnits: new Set(), selectedBuildingId: null, highlightTiles: new Set(), highlightCosts: new Map(), hoverTile: null, mode: 'select' };

const steps = Math.round((MONTHS * 6) / 0.05);
for (let i = 0; i < steps; i++) { E.step(state, 0.05); aiStep(state, 0.05); r3d.draw(state, ui, 0.05); }

const start = state.starts[0];
const focus = CAM_AT === 'player' ? { x: start.x, z: start.y } : { x: 0, z: 0 };
r3d.centerOn(focus.x, focus.z);
r3d.rig.yaw = YAW;
r3d.rig.pitch = PITCH;
r3d.rig.distance = DISTANCE;
for (let i = 0; i < 240; i++) r3d.draw(state, ui, 1 / 60);   // settle the eased camera
const camera = r3d.camera;

// ---------------------------------------------------------------- showcase
// `--mode buildings`: lay every building out on the ground near the focus so the
// whole catalogue can be reviewed side by side.
if (args.mode === 'buildings') {
  const { buildBuildingMesh } = await import('../src/buildings3d.js');
  const { BUILDINGS } = await import('../src/data.js');
  const { elevationAt } = await import('../src/terrain3d.js');
  const types = Object.keys(BUILDINGS);
  const cols = Number(args.cols || 5);
  r3d.layers.scatter.visible = false;   // review the models, not the woods
  types.forEach((type, i) => {
    const cx = focus.x + ((i % cols) - (cols - 1) / 2) * 1.25;
    const cz = focus.z + (Math.floor(i / cols) - 1.1) * 1.25;
    const g = buildBuildingMesh(type, state.clans[0].color, state.clans[0].banner, true);
    g.position.set(cx, elevationAt(state, cx, cz) + 0.02, cz);
    r3d.scene.add(g);
  });
}

// ---------------------------------------------------------------- gather drawables
const sunDir = new THREE.Vector3();
{
  const sun = r3d.scene.children.find((o) => o.isDirectionalLight);
  sunDir.copy(sun.position).normalize();
}
const fog = r3d.scene.fog || null;

const drawables = [];
r3d.scene.updateMatrixWorld(true);
function visibleInTree(obj) {
  let o = obj;
  while (o) { if (!o.visible) return false; o = o.parent; }
  return true;
}
r3d.scene.traverse((obj) => {
  if (!visibleInTree(obj)) return;
  if (obj.name === 'sky') return; // the gradient background stands in for it
  if (obj.isMesh || obj.isInstancedMesh) {
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (!mat || mat.visible === false) return;
    const instanced = obj.isInstancedMesh ? obj.count : 1;
    for (let i = 0; i < instanced; i++) {
      const m = new THREE.Matrix4();
      if (obj.isInstancedMesh) m.multiplyMatrices(obj.matrixWorld, new THREE.Matrix4().fromArray(obj.instanceMatrix.array, i * 16));
      else m.copy(obj.matrixWorld);
      drawables.push({ obj, mat, matrix: m });
    }
  }
});

// ---------------------------------------------------------------- software raster
const color = new Uint8Array(W * H * 3);
const depth = new Float32Array(W * H).fill(Infinity);
const { position: camPos } = camera;

function skyColor(y) {
  const k = Math.max(0, Math.min(1, y / H));
  // top of frame → horizon colour, bottom → warmer haze
  const top = [0.42, 0.62, 0.82];
  const horizon = [0.78, 0.84, 0.87];
  const c = top.map((v, i) => v + (horizon[i] - v) * Math.pow(k, 0.75));
  return c.map((v) => Math.round(255 * v));
}
for (let y = 0; y < H; y++) {
  const [r, g, b] = skyColor(y);
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    color[i] = r; color[i + 1] = g; color[i + 2] = b;
  }
}

const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const n0 = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
const view = new THREE.Vector3(), ndc = new THREE.Vector3();
const viewMatrix = new THREE.Matrix4();
const projScreen = new THREE.Matrix4();

function sampleTexture(tex, u, v) {
  if (!tex || !tex.image || !tex.image.data) return null;
  const { width: tw, height: th, data } = tex.image;
  let x = Math.floor(((u % 1) + 1) % 1 * tw);
  let y = Math.floor(((v % 1) + 1) % 1 * th);
  x = Math.min(tw - 1, Math.max(0, x));
  y = Math.min(th - 1, Math.max(0, y));
  const i = (y * tw + x) * 4;
  return [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
}

let vertAlpha = null;
let vertColor = null;
function shade(mat, worldPos, normal, uv, vertColor, eye) {
  let base = [mat.color ? mat.color.r : 1, mat.color ? mat.color.g : 1, mat.color ? mat.color.b : 1];
  if (vertColor) base = base.map((c, i) => c * vertColor[i]);
  const alpha = (mat.opacity != null ? mat.opacity : 1) * (vertAlpha != null ? vertAlpha : 1);
  if (mat.map) {
    const t = sampleTexture(mat.map, uv[0] * (mat.map.repeat ? mat.map.repeat.x : 1), uv[1] * (mat.map.repeat ? mat.map.repeat.y : 1));
    if (t) base = base.map((c, i) => c * t[i]);
  }
  const unlit = mat.isMeshBasicMaterial || mat.emissive && !mat.isMeshStandardMaterial && !mat.isMeshLambertMaterial && !mat.isMeshPhongMaterial && mat.emissiveIntensity >= 1;
  if (unlit && !mat.emissive) {
    return { rgb: base.map((c) => Math.max(0, Math.min(255, c * 255))), alpha };
  }
  const n = normal.clone().normalize();
  const lambert = Math.max(0, n.dot(sunDir)) * 0.85 + 0.55;   // sun + ambient/sky
  const spec = 0;
  let out = base.map((c) => c * lambert + spec);
  if (mat.emissive && mat.emissiveIntensity) {
    out = out.map((c, i) => c + [mat.emissive.r, mat.emissive.g, mat.emissive.b][i] * mat.emissiveIntensity * 0.6);
  }
  if (fog) {
    const d = eye.distanceTo(worldPos);
    const k = Math.max(0, Math.min(1, (d - fog.near) / (fog.far - fog.near)));
    out = out.map((c, i) => c * (1 - k) + ((fog.color.r || 0.6) * 255) * 0 + [fog.color.r, fog.color.g, fog.color.b][i] * 255 * k);
  }
  out = out.map((c) => Math.max(0, Math.min(255, c * 255)));
  return { rgb: out, alpha };
}

projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

let triangles = 0;
const opaqueTris = [];
const transparentTris = [];
for (const { obj, mat, matrix } of drawables) {
  const geom = obj.geometry;
  const pos = geom.getAttribute('position');
  if (!pos) continue;
  const colAttr = geom.getAttribute('color');
  const uvAttr = geom.getAttribute('uv');
  const idx = geom.getIndex();
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const camDir = camera.getWorldDirection(new THREE.Vector3());
  const bucket = mat.transparent ? transparentTris : opaqueTris;
  for (let t = 0; t < triCount; t++) {
    const ia = idx ? idx.getX(t * 3) : t * 3;
    const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    v0.fromBufferAttribute(pos, ia); v1.fromBufferAttribute(pos, ib); v2.fromBufferAttribute(pos, ic);
    v0.applyMatrix4(matrix); v1.applyMatrix4(matrix); v2.applyMatrix4(matrix);
    view.copy(v0).sub(camPos);
    const z0 = view.dot(camDir);
    view.copy(v1).sub(camPos);
    const z1 = view.dot(camDir);
    view.copy(v2).sub(camPos);
    const z2 = view.dot(camDir);
    if (z0 < 0.35 || z1 < 0.35 || z2 < 0.35) continue;
    const p0 = v0.clone().applyMatrix4(projScreen);
    const p1 = v1.clone().applyMatrix4(projScreen);
    const p2 = v2.clone().applyMatrix4(projScreen);
    const sx0 = (p0.x * 0.5 + 0.5) * W, sy0 = (1 - (p0.y * 0.5 + 0.5)) * H;
    const sx1 = (p1.x * 0.5 + 0.5) * W, sy1 = (1 - (p1.y * 0.5 + 0.5)) * H;
    const sx2 = (p2.x * 0.5 + 0.5) * W, sy2 = (1 - (p2.y * 0.5 + 0.5)) * H;
    const minX = Math.max(0, Math.floor(Math.min(sx0, sx1, sx2)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(sx0, sx1, sx2)));
    const minY = Math.max(0, Math.floor(Math.min(sy0, sy1, sy2)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(sy0, sy1, sy2)));
    if (maxX < minX || maxY < minY) continue;
    const area = (sx1 - sx0) * (sy2 - sy0) - (sx2 - sx0) * (sy1 - sy0);
    if (Math.abs(area) < 1e-6) continue;

    const e1 = v1.clone().sub(v0), e2 = v2.clone().sub(v0);
    const n = e1.cross(e2).normalize();
    if (n.y < 0) n.negate();
    vertColor = null;
    vertAlpha = null;
    if (colAttr) {
      vertColor = [
        (colAttr.getX(ia) + colAttr.getX(ib) + colAttr.getX(ic)) / 3,
        (colAttr.getY(ia) + colAttr.getY(ib) + colAttr.getY(ic)) / 3,
        (colAttr.getZ(ia) + colAttr.getZ(ib) + colAttr.getZ(ic)) / 3,
      ];
      if (colAttr.itemSize === 4) vertAlpha = (colAttr.getW(ia) + colAttr.getW(ib) + colAttr.getW(ic)) / 3;
    }
    const uv = uvAttr
      ? [(uvAttr.getX(ia) + uvAttr.getX(ib) + uvAttr.getX(ic)) / 3, (uvAttr.getY(ia) + uvAttr.getY(ib) + uvAttr.getY(ic)) / 3]
      : [0, 0];
    const centroid = v0.clone().add(v1).add(v2).multiplyScalar(1 / 3);
    const shaded = shade(mat, centroid, n, uv, vertColor, camPos);
    bucket.push({
      sx: [sx0, sx1, sx2], sy: [sy0, sy1, sy2], z: [z0, z1, z2],
      area, rgb: shaded.rgb, alpha: shaded.alpha,
      doubleSided: mat.side === THREE.DoubleSide,
      minX, maxX, minY, maxY, dist: camPos.distanceTo(centroid),
    });
    triangles++;
  }
}

function rasterise(tri, blend) {
  const { sx, sy, z, area } = tri;
  const facing = area > 0;
  for (let y = tri.minY; y <= tri.maxY; y++) {
    for (let x = tri.minX; x <= tri.maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      let w0 = ((sx[1] - px) * (sy[2] - py) - (sx[2] - px) * (sy[1] - py)) / area;
      let w1 = ((sx[2] - px) * (sy[0] - py) - (sx[0] - px) * (sy[2] - py)) / area;
      let w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) {
        if (!tri.doubleSided) continue;
        w0 = -w0; w1 = -w1; w2 = -w2;
        const sum = w0 + w1 + w2;
        if (sum <= 0) continue;
        w0 /= sum; w1 /= sum; w2 /= sum;
      }
      const depthVal = 1 / (w0 / z[0] + w1 / z[1] + w2 / z[2]);
      const di = y * W + x;
      if (blend) {
        if (depthVal > depth[di] + 0.05) continue;      // transparent things respect opaque depth
        const a = Math.max(0, Math.min(1, tri.alpha));
        if (a <= 0.003) continue;
        const i3 = di * 3;
        color[i3] = color[i3] * (1 - a) + tri.rgb[0] * a;
        color[i3 + 1] = color[i3 + 1] * (1 - a) + tri.rgb[1] * a;
        color[i3 + 2] = color[i3 + 2] * (1 - a) + tri.rgb[2] * a;
      } else {
        if (depthVal >= depth[di]) continue;
        depth[di] = depthVal;
        const i3 = di * 3;
        color[i3] = tri.rgb[0]; color[i3 + 1] = tri.rgb[1]; color[i3 + 2] = tri.rgb[2];
      }
    }
  }
}

for (const tri of opaqueTris) rasterise(tri, false);
transparentTris.sort((a, b) => b.dist - a.dist);
for (const tri of transparentTris) rasterise(tri, true);

// ---------------------------------------------------------------- PNG out
function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  Buffer.from(color.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 6 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(OUT, png);
console.log(`preview → ${OUT}  (${W}×${H}, ${drawables.length} drawables, ${triangles} triangles rasterised)`);
