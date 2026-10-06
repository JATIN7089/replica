// ============================================================================
// Northhold — CPU 3D rasterizer.
//
// The compatibility renderer draws the same three.js scene as WebGL. It does
// not draw a second, hex-shaped version of the map: terrain, props, buildings,
// units and soft ground washes all pass through this small software pipeline.
// It intentionally trades shader/shadow-map detail for broad browser support.
// ============================================================================
import * as THREE from '../vendor/three.module.min.js';
import { TERRAIN } from './data.js';

const TAU = Math.PI * 2;
const LOD_CACHE = new WeakMap();
const SRGB_LUT = (() => {
  const lut = new Uint8Array(8193);
  for (let i = 0; i < lut.length; i++) {
    const x = i / 1024;
    const y = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    lut[i] = Math.round(Math.max(0, Math.min(1, y)) * 255);
  }
  return lut;
})();

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const srgbByte = (linear) => SRGB_LUT[Math.round(clamp(linear, 0, 8) * 1024)];
const edge = (ax, ay, bx, by, px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);

function background(data, width, height) {
  // A quiet Nordic sky gradient under the geometry (the WebGL scene's painted
  // sky dome is represented as a 2D background in this backend).
  const top = [21, 48, 75];
  const horizon = [128, 164, 184];
  const lower = [151, 177, 189];
  for (let y = 0; y < height; y++) {
    const t = y / Math.max(1, height - 1);
    const k = Math.pow(clamp(t / 0.78, 0, 1), 0.8);
    const end = t < 0.78 ? horizon : lower;
    const local = t < 0.78 ? k : (t - 0.78) / 0.22;
    const from = t < 0.78 ? top : horizon;
    const r = Math.round(from[0] + (end[0] - from[0]) * local);
    const g = Math.round(from[1] + (end[1] - from[1]) * local);
    const b = Math.round(from[2] + (end[2] - from[2]) * local);
    let p = y * width * 4;
    for (let x = 0; x < width; x++, p += 4) {
      data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
    }
  }
}

function terrainLod(geometry) {
  const grid = geometry.userData?.rasterGrid;
  if (!grid || !grid.cols || !grid.rows || grid.stride <= 1) return null;
  let cache = LOD_CACHE.get(geometry);
  if (!cache) { cache = new Map(); LOD_CACHE.set(geometry, cache); }
  if (cache.has(grid.stride)) return cache.get(grid.stride);

  const coordinates = (size, stride) => {
    const out = [];
    for (let n = 0; n < size - 1; n += stride) out.push(n);
    if (out[out.length - 1] !== size - 1) out.push(size - 1);
    return out;
  };
  const xs = coordinates(grid.cols, grid.stride);
  const ys = coordinates(grid.rows, grid.stride);
  const sourceIds = new Uint32Array(xs.length * ys.length);
  for (let j = 0; j < ys.length; j++) {
    for (let i = 0; i < xs.length; i++) sourceIds[j * xs.length + i] = ys[j] * grid.cols + xs[i];
  }
  const indices = new Uint32Array((xs.length - 1) * (ys.length - 1) * 6);
  let at = 0;
  for (let j = 0; j < ys.length - 1; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      const a = j * xs.length + i;
      const b = a + 1;
      const c = a + xs.length;
      const d = c + 1;
      indices[at++] = a; indices[at++] = c; indices[at++] = b;
      indices[at++] = b; indices[at++] = c; indices[at++] = d;
    }
  }
  const result = { sourceIds, indices };
  cache.set(grid.stride, result);
  return result;
}

function texturePixels(texture) {
  const image = texture?.image;
  if (!image?.data || !image.width || !image.height) return null;
  return { data: image.data, width: image.width, height: image.height };
}

function textureIndex(texture, uv, pixels) {
  let u = uv[0] * (texture.repeat?.x ?? 1) + (texture.offset?.x ?? 0);
  let v = uv[1] * (texture.repeat?.y ?? 1) + (texture.offset?.y ?? 0);
  if (texture.wrapS === THREE.RepeatWrapping) u -= Math.floor(u);
  else u = clamp(u, 0, 0.999999);
  if (texture.wrapT === THREE.RepeatWrapping) v -= Math.floor(v);
  else v = clamp(v, 0, 0.999999);
  const x = Math.min(pixels.width - 1, Math.floor(u * pixels.width));
  const y = Math.min(pixels.height - 1, Math.floor(v * pixels.height));
  return (y * pixels.width + x) * 4;
}

/** Rasterise a three.js scene into an RGBA byte buffer (no DOM or WebGL needed). */
export function rasterizeScene(scene, camera, options = {}) {
  const width = Math.max(1, Math.floor(options.width || 640));
  const height = Math.max(1, Math.floor(options.height || 360));
  const pixelCount = width * height;
  const pixels = options.data?.length === pixelCount * 4
    ? options.data
    : new Uint8ClampedArray(pixelCount * 4);
  const depth = options.depth?.length === pixelCount
    ? options.depth
    : new Float32Array(pixelCount);
  depth.fill(Infinity);
  background(pixels, width, height);

  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const vp = viewProjection.elements;
  const fog = scene.fog;
  const fogColor = fog?.color || null;
  const fogNear = fog?.near || 0;
  const fogFar = fog?.far || 1;
  const light = new THREE.Vector3(0.39, 0.84, 0.37).normalize();
  const lightDir = [light.x, light.y, light.z];
  const cameraPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const stats = { triangles: 0, pixels: 0, drawCalls: 0 };

  function project(x, y, z) {
    const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
    const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
    const cz = vp[2] * x + vp[6] * y + vp[10] * z + vp[14];
    const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    if (!(cw > 0.05)) return null;
    const invW = 1 / cw;
    const ndcX = cx * invW;
    const ndcY = cy * invW;
    const ndcZ = cz * invW;
    return {
      x: (ndcX * 0.5 + 0.5) * width,
      y: (1 - (ndcY * 0.5 + 0.5)) * height,
      z: ndcZ * 0.5 + 0.5,
      invW,
      viewDepth: cw,
    };
  }

  function drawGeometry(object, modelMatrix, material, geometry, instanceColor = null) {
    if (!material || material.visible === false) return;
    const position = geometry.getAttribute('position');
    if (!position) return;
    const lod = object.name === 'terrain' ? terrainLod(geometry) : null;
    const sourceIds = lod?.sourceIds || null;
    const vertexCount = sourceIds ? sourceIds.length : position.count;
    const geometryIndex = lod?.indices || geometry.getIndex();
    const indexCount = geometryIndex ? (lod ? geometryIndex.length : geometryIndex.count) : vertexCount;
    const triangleCount = Math.floor(indexCount / 3);
    if (!triangleCount) return;

    const mvp = new THREE.Matrix4().multiplyMatrices(viewProjection, modelMatrix).elements;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(modelMatrix).elements;
    const normalAttr = geometry.getAttribute('normal');
    const colorAttr = material.vertexColors ? geometry.getAttribute('color') : null;
    const uvAttr = geometry.getAttribute('uv');
    const tex = texturePixels(material.map);
    const materialColor = material.color || { r: 1, g: 1, b: 1 };
    const baseR = materialColor.r * (instanceColor?.r ?? 1);
    const baseG = materialColor.g * (instanceColor?.g ?? 1);
    const baseB = materialColor.b * (instanceColor?.b ?? 1);
    const emissive = material.emissive || { r: 0, g: 0, b: 0 };
    const emissiveScale = material.emissiveIntensity || 0;
    const unlit = material.isMeshBasicMaterial || material.isLineBasicMaterial;
    const lightScale = unlit ? 0 : 0.54;
    const directScale = unlit ? 0 : 0.48;
    const count = vertexCount;

    const sx = new Float32Array(count);
    const sy = new Float32Array(count);
    const sz = new Float32Array(count);
    const iw = new Float32Array(count);
    const vr = new Float32Array(count);
    const vg = new Float32Array(count);
    const vb = new Float32Array(count);
    const va = new Float32Array(count);
    const vl = new Float32Array(count);

    const pe = position.array;
    const ps = position.itemSize;
    const ce = colorAttr?.array;
    const cs = colorAttr?.itemSize || 0;
    const ne = normalAttr?.array;
    const ns = normalAttr?.itemSize || 0;
    const ue = uvAttr?.array;
    const us = uvAttr?.itemSize || 0;
    const tx = modelMatrix.elements;
    for (let i = 0; i < count; i++) {
      const si = sourceIds ? sourceIds[i] : i;
      const pi = si * ps;
      const x = pe[pi], y = pe[pi + 1], z = pe[pi + 2];
      const wx = tx[0] * x + tx[4] * y + tx[8] * z + tx[12];
      const wy = tx[1] * x + tx[5] * y + tx[9] * z + tx[13];
      const wz = tx[2] * x + tx[6] * y + tx[10] * z + tx[14];
      const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
      const cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
      const cz = mvp[2] * x + mvp[6] * y + mvp[10] * z + mvp[14];
      const cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
      if (!(cw > 0.05)) { sx[i] = NaN; continue; }
      const invW = 1 / cw;
      sx[i] = (cx * invW * 0.5 + 0.5) * width;
      sy[i] = (1 - (cy * invW * 0.5 + 0.5)) * height;
      sz[i] = cz * invW * 0.5 + 0.5;
      iw[i] = invW;

      let cr = ce && cs >= 3 ? ce[si * cs] : 1;
      let cg = ce && cs >= 3 ? ce[si * cs + 1] : 1;
      let cb = ce && cs >= 3 ? ce[si * cs + 2] : 1;
      let alpha = ce && cs >= 4 ? ce[si * cs + 3] : 1;
      if (tex && ue && us >= 2) {
        const ti = textureIndex(material.map, [ue[si * us], ue[si * us + 1]], tex);
        cr *= tex.data[ti] / 255;
        cg *= tex.data[ti + 1] / 255;
        cb *= tex.data[ti + 2] / 255;
        alpha *= tex.data[ti + 3] / 255;
      }
      vr[i] = baseR * cr;
      vg[i] = baseG * cg;
      vb[i] = baseB * cb;
      va[i] = alpha;

      let illumination = 1;
      if (!unlit) {
        let nx = 0, ny = 1, nz = 0;
        if (ne && ns >= 3) {
          const ni = si * ns;
          const ox = ne[ni], oy = ne[ni + 1], oz = ne[ni + 2];
          nx = normalMatrix[0] * ox + normalMatrix[3] * oy + normalMatrix[6] * oz;
          ny = normalMatrix[1] * ox + normalMatrix[4] * oy + normalMatrix[7] * oz;
          nz = normalMatrix[2] * ox + normalMatrix[5] * oy + normalMatrix[8] * oz;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
        }
        illumination = lightScale + directScale * Math.max(0, nx * lightDir[0] + ny * lightDir[1] + nz * lightDir[2]);
      }
      vl[i] = illumination;
      // Keep the world coordinates live in the loop above for the matrix math;
      // this touch also prevents engines from treating them as dead temporaries.
      void wx; void wy; void wz;
    }

    const readIndex = (i) => geometryIndex
      ? (lod ? geometryIndex[i] : geometryIndex.getX(i))
      : i;
    const depthWrite = material.depthWrite !== false;
    const opacity = material.opacity == null ? 1 : material.opacity;
    const triV = new Int32Array(3);
    for (let t = 0; t < triangleCount; t++) {
      stats.triangles++;
      triV[0] = readIndex(t * 3);
      triV[1] = readIndex(t * 3 + 1);
      triV[2] = readIndex(t * 3 + 2);
      const a = triV[0], b = triV[1], c = triV[2];
      if (!Number.isFinite(sx[a]) || !Number.isFinite(sx[b]) || !Number.isFinite(sx[c])) continue;
      const z0 = sz[a], z1 = sz[b], z2 = sz[c];
      if ((z0 < 0 && z1 < 0 && z2 < 0) || (z0 > 1 && z1 > 1 && z2 > 1)) continue;
      const x0 = sx[a], y0 = sy[a], x1 = sx[b], y1 = sy[b], x2 = sx[c], y2 = sy[c];
      const area = edge(x0, y0, x1, y1, x2, y2);
      if (Math.abs(area) < 1e-5) continue;
      let minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      let maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
      let minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      let maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
      if (maxX < minX || maxY < minY) continue;
      const invArea = 1 / area;
      for (let py = minY; py <= maxY; py++) {
        const fy = py + 0.5;
        for (let px = minX; px <= maxX; px++) {
          const fx = px + 0.5;
          const w0 = edge(x1, y1, x2, y2, fx, fy) * invArea;
          const w1 = edge(x2, y2, x0, y0, fx, fy) * invArea;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5) continue;
          const zVal = w0 * z0 + w1 * z1 + w2 * z2;
          if (zVal < 0 || zVal > 1) continue;
          const pixel = py * width + px;
          if (zVal >= depth[pixel]) continue;
          const q0 = w0 * iw[a], q1 = w1 * iw[b], q2 = w2 * iw[c];
          const qSum = q0 + q1 + q2;
          if (qSum <= 1e-10) continue;
          const invQ = 1 / qSum;
          const alpha = clamp(opacity * (q0 * va[a] + q1 * va[b] + q2 * va[c]) * invQ, 0, 1);
          if (alpha <= 0.002) continue;

          let r = (q0 * vr[a] + q1 * vr[b] + q2 * vr[c]) * invQ;
          let g = (q0 * vg[a] + q1 * vg[b] + q2 * vg[c]) * invQ;
          let blue = (q0 * vb[a] + q1 * vb[b] + q2 * vb[c]) * invQ;
          const illumination = (q0 * vl[a] + q1 * vl[b] + q2 * vl[c]) * invQ;
          r = r * illumination + emissive.r * emissiveScale;
          g = g * illumination + emissive.g * emissiveScale;
          blue = blue * illumination + emissive.b * emissiveScale;
          const viewDepth = 1 / qSum;
          if (fogColor && fogFar > fogNear) {
            const fogAmount = clamp((viewDepth - fogNear) / (fogFar - fogNear), 0, 1);
            r = r * (1 - fogAmount) + fogColor.r * fogAmount;
            g = g * (1 - fogAmount) + fogColor.g * fogAmount;
            blue = blue * (1 - fogAmount) + fogColor.b * fogAmount;
          }
          const offset = pixel * 4;
          const sr = srgbByte(r), sg = srgbByte(g), sb = srgbByte(blue);
          if (alpha < 0.999) {
            const remain = 1 - alpha;
            pixels[offset] = pixels[offset] * remain + sr * alpha;
            pixels[offset + 1] = pixels[offset + 1] * remain + sg * alpha;
            pixels[offset + 2] = pixels[offset + 2] * remain + sb * alpha;
          } else {
            pixels[offset] = sr; pixels[offset + 1] = sg; pixels[offset + 2] = sb;
          }
          if (depthWrite) depth[pixel] = zVal;
          stats.pixels++;
        }
      }
    }
    stats.drawCalls++;
  }

  const instanceMatrix = new THREE.Matrix4();
  const modelMatrix = new THREE.Matrix4();
  function visit(object, parentVisible = true) {
    if (!parentVisible || !object.visible) return;
    if (object.name !== 'sky' && (object.isMesh || object.isInstancedMesh)) {
      const geometry = object.geometry;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const material = materials[0];
      if (geometry && material && material.visible !== false) {
        if (object.isInstancedMesh && object.instanceMatrix?.array) {
          const count = Math.min(object.count, object.instanceMatrix.count || object.count);
          for (let i = 0; i < count; i++) {
            instanceMatrix.fromArray(object.instanceMatrix.array, i * 16);
            modelMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
            const color = object.instanceColor
              ? { r: object.instanceColor.getX(i), g: object.instanceColor.getY(i), b: object.instanceColor.getZ(i) }
              : null;
            drawGeometry(object, modelMatrix, material, geometry, color);
          }
        } else {
          drawGeometry(object, object.matrixWorld, material, geometry);
        }
      }
    }
    for (const child of object.children || []) visit(child, true);
  }
  visit(scene, true);

  return { width, height, data: pixels, depth, stats };
}

function projectWorld(viewProjection, x, y, z, width, height) {
  const e = viewProjection.elements;
  const cx = e[0] * x + e[4] * y + e[8] * z + e[12];
  const cy = e[1] * x + e[5] * y + e[9] * z + e[13];
  const cz = e[2] * x + e[6] * y + e[10] * z + e[14];
  const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
  if (!(cw > 0.05)) return null;
  const inv = 1 / cw;
  return {
    x: (cx * inv * 0.5 + 0.5) * width,
    y: (1 - (cy * inv * 0.5 + 0.5)) * height,
    z: cz * inv * 0.5 + 0.5,
    viewDepth: cw,
  };
}

function cssColor(color) {
  if (!color) return '#ffffff';
  const hex = color.getHexString ? color.getHexString(THREE.SRGBColorSpace) : 'ffffff';
  return `#${hex}`;
}

/** Draw the lightweight 2D-only elements (floating text and order lines). */
export function drawRasterOverlays(ctx, scene, camera, width, height) {
  if (!ctx || !ctx.drawImage) return;
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const fov = camera.isPerspectiveCamera ? camera.fov * Math.PI / 180 : Math.PI / 3;
  const focal = height / (2 * Math.tan(fov / 2));
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const world = new THREE.Vector3();

  function visit(object, parentVisible = true) {
    if (!parentVisible || !object.visible) return;
    if (object.isSprite) {
      const image = object.material?.map?.image;
      if (image && image.width && image.height) {
        world.setFromMatrixPosition(object.matrixWorld);
        const projected = projectWorld(vp, world.x, world.y, world.z, width, height);
        if (projected && projected.x > -width && projected.x < width * 2 && projected.y > -height && projected.y < height * 2) {
          object.getWorldScale(s);
          const pxPerUnit = focal / Math.max(0.1, projected.viewDepth);
          const sw = Math.max(1, s.x * pxPerUnit);
          const sh = Math.max(1, s.y * pxPerUnit);
          ctx.save();
          ctx.globalAlpha = clamp(object.material.opacity ?? 1, 0, 1);
          ctx.drawImage(image, projected.x - sw / 2, projected.y - sh / 2, sw, sh);
          ctx.restore();
        }
      }
    } else if (object.isLine || object.isLineSegments) {
      const attr = object.geometry?.getAttribute('position');
      const material = object.material;
      if (attr && material) {
        ctx.save();
        ctx.globalAlpha = clamp(material.opacity ?? 1, 0, 1);
        ctx.strokeStyle = cssColor(material.color);
        ctx.lineWidth = Math.max(1, material.linewidth || 1.5);
        const dashScale = focal / 18;
        if (material.isLineDashedMaterial && ctx.setLineDash) {
          ctx.setLineDash([material.dashSize * dashScale, material.gapSize * dashScale]);
        }
        ctx.beginPath();
        let drawn = false;
        const segments = object.isLineSegments;
        for (let i = 0; i < attr.count; i++) {
          if (segments && i % 2 === 0) { if (drawn) ctx.stroke(); ctx.beginPath(); drawn = false; }
          p.fromBufferAttribute(attr, i).applyMatrix4(object.matrixWorld);
          const projected = projectWorld(vp, p.x, p.y, p.z, width, height);
          if (!projected) { drawn = false; if (segments) ctx.beginPath(); continue; }
          if (!drawn) { ctx.moveTo(projected.x, projected.y); drawn = true; }
          else ctx.lineTo(projected.x, projected.y);
          if (segments) { ctx.stroke(); ctx.beginPath(); drawn = false; }
        }
        if (drawn) ctx.stroke();
        ctx.restore();
      }
    }
    for (const child of object.children || []) visit(child, true);
  }
  visit(scene, true);
}

/** Create a three.js-renderer-compatible backend for browsers without WebGL. */
export function createRaster3DRenderer(canvas, options = {}) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context || !context.createImageData || !context.putImageData) {
    throw new Error('2D canvas context unavailable for software 3D rendering');
  }
  const maxWidth = options.maxWidth || 768;
  const maxHeight = options.maxHeight || 512;
  const maxPixels = options.maxPixels || 280000;
  const maxFps = options.maxFps == null ? 18 : options.maxFps;
  let width = 1, height = 1, cssWidth = 1, cssHeight = 1;
  let imageData = null;
  let depth = null;
  let lastFrameAt = -Infinity;
  let pixelRatio = 1;
  let disposed = false;

  const renderer = {
    kind: 'raster3d',
    domElement: canvas,
    outputColorSpace: THREE.SRGBColorSpace,
    shadowMap: null,
    lastStats: null,
    setPixelRatio(value) { pixelRatio = Math.max(1, Math.min(2, value || 1)); },
    setSize(w, h) {
      cssWidth = Math.max(1, Math.round(w));
      cssHeight = Math.max(1, Math.round(h));
      const rawW = cssWidth * pixelRatio;
      const rawH = cssHeight * pixelRatio;
      const scale = Math.min(1, maxWidth / rawW, maxHeight / rawH, Math.sqrt(maxPixels / (rawW * rawH)));
      const nextW = Math.max(1, Math.round(rawW * scale));
      const nextH = Math.max(1, Math.round(rawH * scale));
      canvas._w = cssWidth;
      canvas._h = cssHeight;
      if (nextW !== width || nextH !== height || !imageData) {
        width = nextW; height = nextH;
        canvas.width = width;
        canvas.height = height;
        imageData = context.createImageData(width, height);
        depth = new Float32Array(width * height);
        lastFrameAt = -Infinity;
      }
    },
    render(scene, camera) {
      if (disposed) return;
      const clock = () => globalThis.performance?.now ? globalThis.performance.now() : Date.now();
      const now = clock();
      if (maxFps > 0 && now - lastFrameAt < 1000 / maxFps) return;
      const frame = rasterizeScene(scene, camera, { width, height, data: imageData.data, depth });
      renderer.lastStats = frame.stats;
      context.putImageData(imageData, 0, 0);
      drawRasterOverlays(context, scene, camera, width, height);
      // Throttle from completion time, not start time: if a device is slow, it
      // must not immediately try to render again on the very next animation frame.
      lastFrameAt = clock();
    },

    dispose() { disposed = true; imageData = null; depth = null; },
    getSize() { return { width: cssWidth, height: cssHeight }; },
    getBufferSize() { return { width, height }; },
  };
  const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 960;
  const h = canvas.clientHeight || canvas.parentElement?.clientHeight || 600;
  renderer.setSize(w, h);
  return renderer;
}

// The minimap is intentionally an organic, top-down read of the continuous
// island. It keeps tile centres useful for navigation without drawing a hex grid.
export function drawMinimap(ctx, state, minimap) {
  const width = minimap?._w || minimap?.clientWidth || 0;
  const height = minimap?._h || minimap?.clientHeight || 0;
  if (!ctx || !width || !height || !state?.tiles?.length) return;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0d1720';
  ctx.fillRect(0, 0, width, height);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const tile of state.tiles) {
    minX = Math.min(minX, tile.x); maxX = Math.max(maxX, tile.x);
    minY = Math.min(minY, tile.y); maxY = Math.max(maxY, tile.y);
  }
  const pad = 1.2;
  const scale = Math.min(width / (maxX - minX + pad * 2), height / (maxY - minY + pad * 2)) * 0.84;
  const ox = width / 2 - ((minX + maxX) / 2) * scale;
  const oy = height / 2 - ((minY + maxY) / 2) * scale;
  minimap._map = { s: scale, ox, oy };

  const point = (x, y) => ({ x: x * scale + ox, y: y * scale + oy });
  const radius = Math.max(3, scale * 0.94);
  for (const tile of state.tiles) {
    const p = point(tile.x, tile.y);
    const terrain = TERRAIN[tile.terrain];
    const gradient = ctx.createRadialGradient(p.x - radius * 0.22, p.y - radius * 0.3, radius * 0.08, p.x, p.y, radius);
    gradient.addColorStop(0, terrain.alt || terrain.color);
    gradient.addColorStop(1, terrain.color);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, TAU);
    ctx.fill();
  }
  for (const tile of state.tiles) {
    if (tile.owner == null) continue;
    const p = point(tile.x, tile.y);
    const r = radius * 1.2;
    const color = state.clans[tile.owner].color;
    const wash = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    wash.addColorStop(0, `${color}72`);
    wash.addColorStop(0.55, `${color}3e`);
    wash.addColorStop(1, `${color}00`);
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.fill();
  }
  for (const tile of state.tiles) {
    for (const building of tile.buildings) {
      const p = point(tile.x, tile.y);
      ctx.fillStyle = state.clans[building.clan].banner;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1, scale * 0.13), 0, TAU);
      ctx.fill();
    }
  }
  for (const unit of state.units) {
    const p = point(unit.x, unit.y);
    ctx.fillStyle = state.clans[unit.clan].banner;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1.6, scale * 0.19), 0, TAU);
    ctx.fill();
  }
}
