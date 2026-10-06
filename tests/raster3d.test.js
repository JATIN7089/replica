// Northhold CPU 3D rasterizer tests. No DOM, GPU, or WebGL context is used.
import * as THREE from '../vendor/three.module.min.js';
import { createRaster3DRenderer, rasterizeScene } from '../src/raster3d.js';

let pass = 0;
let fail = 0;
function ok(condition, label, detail = '') {
  if (condition) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

console.log('\nCPU 3D rasterizer');
const width = 96, height = 64;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, width / height, 0.1, 80);
camera.position.set(0, 0, 8);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(5, 4), new THREE.MeshBasicMaterial({ color: '#c02b35' }));
scene.add(ground);
const nearer = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ color: '#248bd0' }));
nearer.position.z = 1;
scene.add(nearer);
const frame = rasterizeScene(scene, camera, { width, height });
const center = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
ok(frame.stats.triangles >= 4, 'submits scene triangles to the CPU pipeline', frame.stats.triangles);
ok(frame.stats.pixels > width * height * 0.2, 'fills visible geometry into the framebuffer', frame.stats.pixels);
ok(frame.data[center + 2] > frame.data[center] * 0.8, 'depth buffer keeps the nearer blue surface in front',
  `${frame.data[center]},${frame.data[center + 1]},${frame.data[center + 2]}`);
ok(frame.data[3] === 255, 'writes an opaque sky background');

const targetContext = {
  lastFrame: null,
  writes: 0,
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
  putImageData(image) { this.lastFrame = image; this.writes++; },
  drawImage() {}, save() {}, restore() {}, beginPath() {}, stroke() {}, moveTo() {}, lineTo() {},
  setLineDash() {},
};
const requestedContexts = [];
const canvas = {
  width: 0, height: 0, clientWidth: width, clientHeight: height,
  getContext(kind) { requestedContexts.push(kind); return kind === '2d' ? targetContext : null; },
};
const backend = createRaster3DRenderer(canvas, { maxWidth: width, maxHeight: height, maxPixels: width * height, maxFps: 0 });
backend.setSize(width, height);
backend.render(scene, camera);
ok(targetContext.writes === 1 && backend.lastStats?.triangles >= 4, 'exposes a renderer-compatible 2D-canvas backend');
ok(requestedContexts.every((kind) => kind === '2d'), 'does not request a WebGL context', requestedContexts.join(','));
ok(canvas._w === width && canvas._h === height, 'keeps CSS-space dimensions for pointer input');
backend.dispose();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
