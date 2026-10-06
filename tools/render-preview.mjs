// ============================================================================
// Northhold — offline visual checkpoint (development tool).
//
// This renders the same three.js scene and the same CPU rasterizer used by the
// no-WebGL browser fallback, then writes a PNG without a GPU or native canvas.
//
//   node tools/render-preview.mjs [--out file.png] [--yaw 0.8] [--pitch 0.95]
//        [--distance 26] [--seed 11] [--months 3] [--width 1280] [--height 720]
//        [--mode buildings|units] [--cols 5]
// ============================================================================
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

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

// Minimal DOM: model constructors use canvas textures, but the preview itself
// writes directly from the returned RGBA buffer through the Node PNG encoder.
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

const E = await import('../src/engine.js');
const { aiStep } = await import('../src/ai.js');
const { createRenderer3D } = await import('../src/render3d.js');
const { rasterizeScene } = await import('../src/raster3d.js');

const canvas = document.createElement('canvas');
const fakeRenderer = {
  shadowMap: {}, setPixelRatio() {}, setSize() {}, render() {}, dispose() {},
};
const world = createRenderer3D(canvas, { rendererFactory: () => fakeRenderer });
const state = E.createGame({ clanId: 'wolf', difficulty: DIFFICULTY, mapSeed: SEED });
const ui = {
  selectedUnits: new Set(), selectedBuildingId: null, highlightTiles: new Set(),
  highlightCosts: new Map(), hoverTile: null, mode: 'select',
};
const steps = Math.round((MONTHS * 6) / 0.05);
for (let i = 0; i < steps; i++) {
  E.step(state, 0.05);
  aiStep(state, 0.05);
  world.draw(state, ui, 0.05);
}

const start = state.starts[0];
const focus = args.mode === 'units' || CAM_AT === 'player'
  ? { x: start.x, z: start.y }
  : { x: 0, z: 0 };
world.centerOn(focus.x, focus.z);
world.rig.yaw = YAW;
world.rig.pitch = PITCH;
world.rig.distance = DISTANCE;
for (let i = 0; i < 240; i++) world.draw(state, ui, 1 / 60);

if (args.mode === 'buildings') {
  const { buildBuildingMesh } = await import('../src/buildings3d.js');
  const { BUILDINGS } = await import('../src/data.js');
  const { elevationAt } = await import('../src/terrain3d.js');
  const types = Object.keys(BUILDINGS);
  const cols = Number(args.cols || 5);
  world.layers.scatter.visible = false;
  types.forEach((type, i) => {
    const x = focus.x + ((i % cols) - (cols - 1) / 2) * 1.25;
    const z = focus.z + (Math.floor(i / cols) - 1.1) * 1.25;
    const building = buildBuildingMesh(type, state.clans[0].color, state.clans[0].banner, true);
    building.position.set(x, elevationAt(state, x, z) + 0.02, z);
    world.scene.add(building);
  });
} else if (args.mode === 'units') {
  const { buildUnitMesh } = await import('../src/models3d.js');
  const { elevationAt } = await import('../src/terrain3d.js');
  const roles = ['warrior', 'axe', 'shield', 'scout', 'warchief'];
  const offsets = [[-1.05, -0.58], [0, -0.58], [1.05, -0.58], [-0.52, 0.58], [0.52, 0.58]];
  const clan = state.clans[0];
  world.layers.scatter.visible = false;
  world.layers.buildings.visible = false;
  world.layers.units.visible = false;
  world.layers.workers.visible = false;
  world.layers.fx.visible = false;
  roles.forEach((role, i) => {
    const [dx, dz] = offsets[i];
    const x = focus.x + dx;
    const z = focus.z + dz;
    const unit = buildUnitMesh(role, clan.color, clan.banner);
    unit.position.set(x, elevationAt(state, x, z) + 0.015, z);
    unit.rotation.y = -0.12;
    world.scene.add(unit);
  });
}

const frame = rasterizeScene(world.scene, world.camera, { width: W, height: H });
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
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  const dst = y * (W * 3 + 1);
  raw[dst] = 0;
  for (let x = 0; x < W; x++) {
    const from = (y * W + x) * 4;
    const to = dst + 1 + x * 3;
    raw[to] = frame.data[from];
    raw[to + 1] = frame.data[from + 1];
    raw[to + 2] = frame.data[from + 2];
  }
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
console.log(`preview → ${OUT} (${W}×${H}, ${frame.stats.triangles} CPU triangles, ${frame.stats.pixels} fragments)`);
world.dispose();
