// ============================================================================
// Northhold — stylized low-poly buildings (original geometry, no assets).
//
// Nordic settlement architecture: stone footings, tarred timber walls with
// corner posts, shingled gable roofs with eaves, doors, windows, smoke holes
// and clan banners. Everything is built from primitives so the whole game ships
// without a single external model or texture.
//
// `buildBuildingMesh(type, clanColor, bannerColor, done)` keeps the same
// contract the renderer already uses: a Group whose parts are named, with a
// 'scaffold' part that is only visible while the building is under construction.
// ============================================================================
import * as THREE from '../vendor/three.module.min.js';
import { MAT, prim, mergeMesh } from './models3d.js';

const { box, cyl, cone, sph, gableRoof } = prim;

// ---------------------------------------------------------------- palette
function palettes(clanColor, bannerColor) {
  return {
    clan: MAT.cloth(clanColor),
    banner: MAT.cloth(bannerColor),
    log: new THREE.MeshStandardMaterial({ color: '#a87f4f', roughness: 0.92, flatShading: true }),
    logDark: new THREE.MeshStandardMaterial({ color: '#8a6237', roughness: 0.95, flatShading: true }),
    plank: new THREE.MeshStandardMaterial({ color: '#b8925f', roughness: 0.9, flatShading: true }),
    roof: new THREE.MeshStandardMaterial({ color: '#8f857a', roughness: 0.95, flatShading: true }),
    roofWarm: new THREE.MeshStandardMaterial({ color: '#9c7f61', roughness: 0.95, flatShading: true }),
    thatch: new THREE.MeshStandardMaterial({ color: '#c8a768', roughness: 1, flatShading: true }),
    stone: new THREE.MeshStandardMaterial({ color: '#b3b0a7', roughness: 1, flatShading: true }),
    stoneDark: new THREE.MeshStandardMaterial({ color: '#96938b', roughness: 1, flatShading: true }),
    iron: new THREE.MeshStandardMaterial({ color: '#7d8590', roughness: 0.5, metalness: 0.5, flatShading: true }),
    gold: MAT.gold(),
    glass: new THREE.MeshStandardMaterial({ color: '#f4d79a', emissive: new THREE.Color('#d99a3c'), emissiveIntensity: 0.35, roughness: 0.6 }),
    snow: MAT.snow(),
  };
}

// ---------------------------------------------------------------- modules
/** Stone footing under a building so it meets the ground cleanly. */
function footing(w, d, h = 0.1) {
  const g = new THREE.Group();
  g.add(box(w, h, d, MAT.stone(), 0, h / 2, 0));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(box(0.1, h * 1.5, 0.1, MAT.darkStone(), sx * (w / 2 - 0.05), h * 0.75, sz * (d / 2 - 0.05)));
  }
  return g;
}

/** Timber walls with visible corner posts and a top beam. */
function walls(w, h, d, P, { posts = true } = {}) {
  const g = new THREE.Group();
  g.add(box(w, h, d, P.log, 0, h / 2, 0));
  // horizontal log courses
  const courses = Math.max(2, Math.round(h / 0.09));
  for (let i = 1; i < courses; i++) {
    const y = (h / courses) * i;
    g.add(box(w * 1.01, 0.012, d * 1.01, P.logDark, 0, y, 0));
  }
  if (posts) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      g.add(box(0.07, h * 1.06, 0.07, P.logDark, sx * (w / 2), h * 0.53, sz * (d / 2)));
    }
  }
  g.add(box(w * 1.04, 0.05, d * 1.04, P.logDark, 0, h + 0.02, 0));
  return g;
}

/** Door with frame; returned facing +z. */
function door(P, w = 0.14, h = 0.22) {
  const g = new THREE.Group();
  g.add(box(w + 0.03, h + 0.03, 0.02, P.logDark, 0, h / 2, 0));
  g.add(box(w, h, 0.02, P.plank, 0, h / 2, 0.012));
  g.add(sph(0.012, P.iron, w * 0.3, h * 0.5, 0.03, 6));
  return g;
}

/** Window with a warm glow and a cross frame. */
function window_(P, size = 0.08) {
  const g = new THREE.Group();
  g.add(box(size + 0.02, size + 0.02, 0.02, P.logDark, 0, 0, 0));
  g.add(box(size, size, 0.02, P.glass, 0, 0, 0.012));
  g.add(box(size, 0.012, 0.024, P.logDark, 0, 0, 0.016));
  g.add(box(0.012, size, 0.024, P.logDark, 0, 0, 0.016));
  return g;
}

/** Banner on a pole: the clan's claim on the skyline. */
function bannerPole(P, height = 0.6) {
  const g = new THREE.Group();
  g.add(cyl(0.014, 0.018, height, P.logDark, 0, height / 2, 0, 6));
  const cloth = box(0.11, 0.2, 0.012, P.banner, 0.07, height - 0.13, 0);
  g.add(cloth);
  g.add(box(0.16, 0.02, 0.02, P.logDark, 0.06, height - 0.01, 0));
  return g;
}

/** Chimney with a stone cap. */
function chimney(P, x, z, h = 0.32) {
  const g = new THREE.Group();
  g.add(box(0.09, h, 0.09, P.stoneDark, x, h / 2, z));
  g.add(box(0.13, 0.03, 0.13, P.stone, x, h + 0.01, z));
  return g;
}

/** Central hearth smoke hole ring, for the great hall. */
function smokeRing(P, x, y, z) {
  return box(0.14, 0.03, 0.14, P.stoneDark, x, y, z);
}

function roofGable(P, w, d, h, opts = {}) {
  const g = new THREE.Group();
  const r = gableRoof(w, d, h, opts.material || P.roof, 0, 0, 0, opts.overhang ?? 0.07);
  g.add(r);
  // ridge beam
  g.add(box(w + (opts.overhang ?? 0.07) * 2 + 0.02, 0.03, 0.035, P.logDark, 0, h + 0.015, 0));
  // gable ends
  for (const sz of [-1, 1]) {
    const tri = new THREE.Mesh(new THREE.CylinderGeometry(0.001, d / 2, h, 3), opts.gableMaterial || P.logDark);
    tri.rotation.y = Math.PI / 4;
    tri.position.set(sz * w * 0.0, 0, 0);
    // (triangular gable planes are handled by the roof geometry itself)
    tri.visible = false;
    g.add(tri);
  }
  return g;
}

/** Roof shingle rows: gives the roof texture instead of one flat slope. */
function shingles(P, w, d, h, count = 4) {
  const g = new THREE.Group();
  for (let i = 1; i <= count; i++) {
    const k = i / (count + 1);
    const y = h * k;
    const width = w * (1 - k) + 0.06;
    const depth = d * (1 - k) + 0.06;
    g.add(box(width, 0.014, depth, P.roofWarm, 0, y, 0));
  }
  return g;
}

// ---------------------------------------------------------------- catalogue
/**
 * All fifteen buildings, each a small composition of the modules above.
 * Scale guide: a House is ~0.6 world units wide (a tile is ~1.7 across).
 */
export function buildBuildingMesh(type, clanColor = '#e09a3a', bannerColor = '#f0b757', done = true) {
  const P = palettes(clanColor, bannerColor);
  const g = new THREE.Group();
  g.userData.type = type;

  switch (type) {
    // ------------------------------------------------------------ town hall
    case 'townhall': {
      const w = 0.78, d = 0.56, h = 0.34;
      g.add(footing(w + 0.08, d + 0.08));
      g.add(walls(w, h, d, P));
      g.add(roofGable(P, w, d, 0.3, { material: P.roof, overhang: 0.1 }));
      g.add(shingles(P, w, d, 0.3, 4));
      g.add(smokeRing(P, 0, h + 0.31, 0));
      const dr = door(P, 0.18, 0.26);
      dr.position.set(0, 0, d / 2 + 0.02);
      g.add(dr);
      for (const sx of [-1, 1]) {
        const win = window_(P, 0.09);
        win.position.set(sx * 0.26, 0.2, d / 2 + 0.02);
        g.add(win);
        const post = bannerPole(P, 0.62);
        post.position.set(sx * (w / 2 + 0.06), 0, d / 2 - 0.06);
        g.add(post);
      }
      g.add(chimney(P, w / 2 - 0.12, -d / 2 + 0.1, 0.42));
      // carved prow beasts on the gable ends
      for (const sz of [-1, 1]) {
        const beast = new THREE.Group();
        beast.add(cyl(0.02, 0.025, 0.16, P.logDark, 0, 0.08, 0, 5));
        beast.add(box(0.05, 0.05, 0.1, P.logDark, 0, 0.18, 0.02));
        beast.position.set(0, h + 0.28, sz * (d / 2 + 0.02));
        g.add(beast);
      }
      break;
    }

    // ---------------------------------------------------------------- house
    case 'house': {
      const w = 0.5, d = 0.4, h = 0.24;
      g.add(footing(w + 0.05, d + 0.05, 0.08));
      g.add(walls(w, h, d, P));
      g.add(roofGable(P, w, d, 0.2, { material: P.thatch, overhang: 0.06 }));
      g.add(shingles(P, w, d, 0.2, 2));
      const dr = door(P, 0.13, 0.19);
      dr.position.set(-0.08, 0, d / 2 + 0.02);
      g.add(dr);
      const win = window_(P, 0.07);
      win.position.set(0.14, 0.15, d / 2 + 0.02);
      g.add(win);
      g.add(chimney(P, w / 2 - 0.09, -d / 2 + 0.08, 0.28));
      break;
    }

    // ------------------------------------------------------------- woodcutter
    case 'woodcutter': {
      g.add(footing(0.42, 0.32, 0.07));
      g.add(walls(0.36, 0.2, 0.28, P));
      g.add(roofGable(P, 0.36, 0.28, 0.16, { material: P.roof, overhang: 0.05 }));
      const dr = door(P, 0.11, 0.16);
      dr.position.set(0, 0, 0.15);
      g.add(dr);
      // saw pit, log pile and chopping block
      const logPile = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const log = cyl(0.04, 0.04, 0.34, P.log, 0.28, 0.045 + i * 0.075, -0.02 + (i % 2) * 0.06, 6);
        log.rotation.z = Math.PI / 2;
        logPile.add(log);
      }
      g.add(logPile);
      g.add(cyl(0.09, 0.1, 0.07, P.log, -0.24, 0.035, 0.2, 7));
      g.add(box(0.08, 0.1, 0.02, P.iron, -0.24, 0.12, 0.2));
      break;
    }

    // ---------------------------------------------------------------- hunter
    case 'hunter': {
      g.add(footing(0.4, 0.34, 0.07));
      g.add(walls(0.34, 0.22, 0.28, P));
      g.add(roofGable(P, 0.34, 0.28, 0.17, { material: P.thatch, overhang: 0.05 }));
      const dr = door(P, 0.1, 0.16);
      dr.position.set(0, 0, 0.15);
      g.add(dr);
      // drying rack with pelts
      const rack = new THREE.Group();
      for (const sx of [-1, 1]) rack.add(cyl(0.012, 0.014, 0.3, P.logDark, sx * 0.14, 0.15, 0, 5));
      rack.add(box(0.32, 0.02, 0.02, P.logDark, 0, 0.3, 0));
      rack.add(box(0.1, 0.14, 0.01, P.plank, -0.08, 0.22, 0));
      rack.add(box(0.09, 0.12, 0.01, P.log, 0.08, 0.23, 0));
      rack.position.set(-0.28, 0, 0.14);
      g.add(rack);
      g.add(cone(0.05, 0.12, P.log, 0.3, 0.06, 0.18, 6));
      break;
    }

    // ----------------------------------------------------------------- farm
    case 'farm': {
      const soil = new THREE.MeshStandardMaterial({ color: '#6b5335', roughness: 1, flatShading: true });
      const cropMat = new THREE.MeshStandardMaterial({ color: '#c9a94e', roughness: 1, flatShading: true });
      const cropMat2 = new THREE.MeshStandardMaterial({ color: '#a8b84e', roughness: 1, flatShading: true });
      // barn
      g.add(footing(0.34, 0.28, 0.07));
      g.add(walls(0.28, 0.2, 0.22, P));
      g.add(roofGable(P, 0.28, 0.22, 0.17, { material: P.roofWarm, overhang: 0.05 }));
      const dr = door(P, 0.14, 0.15);
      dr.position.set(0, 0, 0.12);
      g.add(dr);
      // field: raised furrows with crops along them
      const field = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const row = box(0.5, 0.05, 0.06, soil, 0, 0.025, 0);
        row.position.set(0, 0.025, i * 0.085);
        row.rotation.y = 0.08;
        field.add(row);
        for (let k = 0; k < 5; k++) {
          const plant = k % 2
            ? cone(0.022, 0.09, cropMat, 0, 0.09, 0, 4)
            : box(0.03, 0.07, 0.03, cropMat2, 0, 0.08, 0);
          plant.position.set(-0.2 + k * 0.1, 0.08, i * 0.085);
          plant.rotation.y = k;
          field.add(plant);
        }
      }
      field.position.set(0.06, 0, 0.22);
      field.rotation.y = -0.12;
      g.add(field);
      // scarecrow watching the field
      const scare = new THREE.Group();
      scare.add(cyl(0.012, 0.014, 0.34, P.log, 0, 0.17, 0, 5));
      scare.add(box(0.26, 0.02, 0.02, P.log, 0, 0.26, 0));
      scare.add(box(0.12, 0.14, 0.08, P.thatch, 0, 0.19, 0));
      scare.add(sph(0.05, P.thatch, 0, 0.34, 0, 6));
      scare.add(cone(0.06, 0.06, P.logDark, 0, 0.4, 0, 6));
      scare.position.set(-0.3, 0, 0.3);
      g.add(scare);
      break;
    }

    // -------------------------------------------------------------- fishery
    case 'fishery': {
      g.add(footing(0.38, 0.3, 0.07));
      g.add(walls(0.32, 0.2, 0.24, P));
      g.add(roofGable(P, 0.32, 0.24, 0.16, { material: P.roofWarm, overhang: 0.06 }));
      // drying rack of fish + a little jetty
      const rack = new THREE.Group();
      for (const sx of [-1, 1]) rack.add(cyl(0.012, 0.014, 0.26, P.logDark, sx * 0.16, 0.13, 0, 5));
      rack.add(box(0.36, 0.018, 0.018, P.logDark, 0, 0.26, 0));
      for (let i = -1; i <= 1; i++) {
        const fish = box(0.03, 0.09, 0.01, P.iron, i * 0.1, 0.2, 0);
        rack.add(fish);
      }
      rack.position.set(0.3, 0, -0.12);
      g.add(rack);
      const jetty = new THREE.Group();
      for (let i = 0; i < 3; i++) jetty.add(box(0.34, 0.02, 0.06, P.plank, 0, 0.06, i * 0.08));
      for (const sx of [-1, 1]) jetty.add(cyl(0.014, 0.016, 0.2, P.logDark, sx * 0.16, 0.02, 0.08, 5));
      jetty.position.set(-0.02, 0, 0.3);
      g.add(jetty);
      break;
    }

    // ------------------------------------------------------------ stone mine
    case 'mine':
    case 'ironmine': {
      const ore = type === 'ironmine';
      const rock = new THREE.MeshStandardMaterial({ color: '#6e6b66', roughness: 1, flatShading: true });
      const rockLight = new THREE.MeshStandardMaterial({ color: '#807d76', roughness: 1, flatShading: true });
      // the hillside the adit is cut into
      const hill = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const s2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2 + i * 0.03, 0), i % 2 ? rock : rockLight);
        const a = -0.9 + i * 0.85;
        s2.position.set(Math.cos(a) * 0.22, 0.1 + (i % 2) * 0.05, -0.16 + Math.sin(a) * 0.1);
        s2.rotation.set(i * 0.3, a, i * 0.2);
        hill.add(s2);
      }
      g.add(hill);
      // timber portal + dark adit
      const dark = new THREE.MeshStandardMaterial({ color: '#231f1c', roughness: 1 });
      g.add(box(0.3, 0.03, 0.24, P.logDark, 0, 0.015, 0.16));
      for (const sx of [-1, 1]) g.add(cyl(0.026, 0.028, 0.32, P.log, sx * 0.13, 0.16, 0.16, 6));
      g.add(box(0.34, 0.035, 0.06, P.log, 0, 0.33, 0.16));
      g.add(box(0.2, 0.24, 0.04, dark, 0, 0.14, 0.13));
      // rails and a cart full of ore
      for (const sx of [-1, 1]) g.add(box(0.02, 0.02, 0.34, P.logDark, sx * 0.08, 0.02, 0.34));
      const cart = new THREE.Group();
      cart.add(box(0.18, 0.1, 0.14, P.log, 0, 0.09, 0));
      cart.add(box(0.13, 0.05, 0.09, ore ? MAT.ironOre() : rockLight, 0, 0.16, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const wheel = cyl(0.03, 0.03, 0.02, P.iron, sx * 0.075, 0.03, sz * 0.05, 8);
        wheel.rotation.z = Math.PI / 2;
        cart.add(wheel);
      }
      cart.position.set(0, 0, 0.42);
      g.add(cart);
      // pick, lantern and spoil heap
      g.add(cyl(0.01, 0.012, 0.3, P.log, -0.22, 0.15, 0.3, 5));
      g.add(box(0.1, 0.02, 0.02, P.iron, -0.22, 0.29, 0.3));
      g.add(sph(0.03, MAT.ember(), 0.22, 0.16, 0.3, 6));
      g.add(cyl(0.012, 0.014, 0.14, P.logDark, 0.22, 0.07, 0.3, 5));
      for (let i = 0; i < 3; i++) {
        const spoil = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05 + i * 0.012, 0), i % 2 ? rock : rockLight);
        spoil.position.set(-0.3 + i * 0.1, 0.035, -0.3);
        spoil.rotation.set(i * 0.4, i * 1.1, 0.2);
        g.add(spoil);
      }
      if (ore) {
        for (let i = 0; i < 3; i++) {
          const vein = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), MAT.ironOre());
          vein.position.set(-0.1 + i * 0.1, 0.1, -0.26);
          vein.rotation.set(i * 0.6, i * 0.9, 0.2);
          g.add(vein);
        }
      }
      break;
    }

    // ---------------------------------------------------------------- forge
    case 'forge': {
      g.add(footing(0.44, 0.36, 0.08));
      g.add(walls(0.38, 0.24, 0.3, P, { posts: true }));
      g.add(roofGable(P, 0.38, 0.3, 0.2, { material: P.roof, overhang: 0.07 }));
      // forge chimney with an ember glow
      g.add(box(0.12, 0.5, 0.12, P.stoneDark, -0.14, 0.25, -0.1));
      g.add(box(0.16, 0.04, 0.16, P.stone, -0.14, 0.51, -0.1));
      const fire = box(0.1, 0.06, 0.06, MAT.ember(), -0.14, 0.3, -0.04);
      g.add(fire);
      // anvil and quench barrel
      const anvil = new THREE.Group();
      anvil.add(box(0.04, 0.06, 0.04, P.logDark, 0, 0.03, 0));
      anvil.add(box(0.11, 0.03, 0.05, P.iron, 0, 0.075, 0));
      anvil.add(box(0.05, 0.02, 0.05, P.iron, -0.05, 0.095, 0));
      anvil.position.set(0.28, 0, 0.14);
      g.add(anvil);
      g.add(cyl(0.07, 0.07, 0.14, P.log, 0.3, 0.07, -0.16, 7));
      break;
    }

    // --------------------------------------------------------------- market
    case 'market': {
      // open stalls with striped awnings
      for (let i = 0; i < 3; i++) {
        const stall = new THREE.Group();
        const awning = box(0.26, 0.02, 0.24, i % 2 ? P.banner : P.clan, 0, 0.24, 0);
        awning.rotation.z = 0.12;
        stall.add(awning);
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          stall.add(cyl(0.012, 0.014, 0.24, P.logDark, sx * 0.11, 0.12, sz * 0.1, 5));
        }
        stall.add(box(0.24, 0.05, 0.16, P.plank, 0, 0.09, 0));
        stall.add(box(0.08, 0.05, 0.06, P.gold, -0.05, 0.13, 0));
        stall.add(box(0.06, 0.04, 0.05, P.stone, 0.06, 0.12, 0));
        const a = (i / 3) * Math.PI * 2;
        stall.position.set(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22);
        stall.rotation.y = -a + Math.PI / 2;
        g.add(stall);
      }
      g.add(box(0.3, 0.06, 0.3, P.plank, 0, 0.03, 0));
      break;
    }

    // -------------------------------------------------------------- brewery
    case 'brewery': {
      g.add(footing(0.4, 0.34, 0.08));
      g.add(walls(0.34, 0.22, 0.28, P));
      g.add(roofGable(P, 0.34, 0.28, 0.18, { material: P.thatch, overhang: 0.06 }));
      const dr = door(P, 0.12, 0.17);
      dr.position.set(0, 0, 0.15);
      g.add(dr);
      // copper kettles and barrels
      g.add(cyl(0.09, 0.1, 0.18, MAT.gold(), 0.28, 0.09, 0.06, 8));
      g.add(cyl(0.03, 0.03, 0.1, MAT.metal(), 0.28, 0.22, 0.06, 6));
      for (let i = 0; i < 3; i++) {
        const barrel = cyl(0.06, 0.055, 0.14, P.log, -0.28 + (i % 2) * 0.12, 0.07, 0.14 + Math.floor(i / 2) * 0.12, 7);
        g.add(barrel);
        g.add(cyl(0.062, 0.062, 0.012, P.iron, -0.28 + (i % 2) * 0.12, 0.1, 0.14 + Math.floor(i / 2) * 0.12, 7));
      }
      break;
    }

    // ---------------------------------------------------------------- altar
    case 'altar': {
      // a stone ring around a carved idol — no roof, it is a holy place
      const ring = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07, 0), i % 2 ? P.stone : P.stoneDark);
        stone.position.set(Math.cos(a) * 0.34, 0.075, Math.sin(a) * 0.34);
        stone.rotation.set(0.2, a, 0.1);
        ring.add(stone);
      }
      g.add(ring);
      g.add(cyl(0.2, 0.24, 0.08, P.stone, 0, 0.04, 0, 8));
      const idol = new THREE.Group();
      idol.add(cyl(0.07, 0.09, 0.26, P.logDark, 0, 0.13, 0, 7));
      idol.add(box(0.2, 0.03, 0.04, P.logDark, 0, 0.24, 0));
      idol.add(sph(0.06, P.stone, 0, 0.3, 0, 7));
      idol.add(cone(0.035, 0.07, MAT.gold(), 0, 0.38, 0, 6));
      g.add(idol);
      // offerings
      g.add(cyl(0.05, 0.05, 0.04, MAT.gold(), 0.16, 0.02, 0.16, 7));
      g.add(box(0.06, 0.02, 0.04, MAT.ember(), -0.18, 0.01, 0.12));
      break;
    }

    // -------------------------------------------------------------- barracks
    case 'barracks': {
      const w = 0.6, d = 0.44, h = 0.28;
      g.add(footing(w + 0.06, d + 0.06, 0.09));
      g.add(walls(w, h, d, P));
      g.add(roofGable(P, w, d, 0.24, { material: P.roof, overhang: 0.08 }));
      g.add(shingles(P, w, d, 0.24, 3));
      const dr = door(P, 0.16, 0.22);
      dr.position.set(0, 0, d / 2 + 0.02);
      g.add(dr);
      // shield wall along the front, weapon rack, training dummies
      for (let i = -2; i <= 2; i++) {
        if (i === 0) continue;
        const shield = cyl(0.07, 0.07, 0.02, i % 2 ? P.clan : P.banner, i * 0.11, 0.16, d / 2 + 0.03, 10);
        shield.rotation.x = Math.PI / 2;
        g.add(shield);
        g.add(sph(0.018, P.iron, i * 0.11, 0.16, d / 2 + 0.045, 6));
      }
      const rack = new THREE.Group();
      rack.add(box(0.02, 0.3, 0.02, P.logDark, 0, 0.15, 0));
      for (let i = 0; i < 3; i++) {
        const spear = cyl(0.008, 0.01, 0.42, P.log, 0.06, 0.21, -0.02 + i * 0.03, 5);
        spear.rotation.z = 0.16;
        rack.add(spear);
      }
      rack.position.set(-0.38, 0, 0.05);
      g.add(rack);
      const dummy = new THREE.Group();
      dummy.add(cyl(0.02, 0.024, 0.34, P.log, 0, 0.17, 0, 6));
      dummy.add(box(0.2, 0.02, 0.02, P.log, 0, 0.26, 0));
      dummy.add(sph(0.05, P.thatch, 0, 0.34, 0, 6));
      dummy.position.set(0.36, 0, 0.16);
      g.add(dummy);
      break;
    }

    // ----------------------------------------------------------------- tower
    case 'tower': {
      g.add(box(0.34, 0.12, 0.34, P.stoneDark, 0, 0.06, 0));
      g.add(cyl(0.15, 0.19, 0.52, P.stone, 0, 0.32, 0, 8));
      // battlements
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.add(box(0.07, 0.09, 0.07, P.stoneDark, Math.cos(a) * 0.14, 0.62, Math.sin(a) * 0.14));
      }
      g.add(cyl(0.13, 0.13, 0.05, P.plank, 0, 0.6, 0, 8));
      // roof cone and banner
      g.add(cone(0.19, 0.22, P.roof, 0, 0.78, 0, 8));
      const pole = bannerPole(P, 0.3);
      pole.position.set(0, 0.88, 0);
      g.add(pole);
      // a ballista on the platform
      g.add(box(0.05, 0.04, 0.22, P.logDark, 0.06, 0.66, 0.04));
      break;
    }

    // ---------------------------------------------------------- trading post
    case 'tradingpost': {
      g.add(footing(0.36, 0.3, 0.08));
      g.add(walls(0.3, 0.2, 0.24, P));
      g.add(roofGable(P, 0.3, 0.24, 0.16, { material: P.roofWarm, overhang: 0.06 }));
      const dr = door(P, 0.12, 0.16);
      dr.position.set(0, 0, 0.13);
      g.add(dr);
      // a jetty, crates and the clan banner flying over the water
      const jetty = new THREE.Group();
      for (let i = 0; i < 4; i++) jetty.add(box(0.4, 0.02, 0.07, P.plank, 0, 0.05, i * 0.09));
      for (const sx of [-1, 1]) jetty.add(cyl(0.014, 0.016, 0.22, P.logDark, sx * 0.19, 0, 0.14, 5));
      jetty.position.set(0, 0, 0.24);
      g.add(jetty);
      for (let i = 0; i < 3; i++) {
        g.add(box(0.1, 0.1, 0.1, P.plank, -0.26 + (i % 2) * 0.11, 0.05, -0.2 + Math.floor(i / 2) * 0.11));
      }
      const pole = bannerPole(P, 0.5);
      pole.position.set(0.3, 0, 0.16);
      g.add(pole);
      break;
    }

    default: {
      g.add(footing(0.4, 0.32, 0.07));
      g.add(walls(0.34, 0.22, 0.28, P));
      g.add(roofGable(P, 0.34, 0.28, 0.18, { material: P.roof, overhang: 0.06 }));
      break;
    }
  }

  // ---- construction state: rope, planks and a partial frame
  const scaffold = new THREE.Group();
  scaffold.name = 'scaffold';
  scaffold.visible = !done;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    scaffold.add(cyl(0.012, 0.014, 0.42, P.logDark, sx * 0.24, 0.21, sz * 0.2, 5));
  }
  scaffold.add(box(0.52, 0.02, 0.02, P.logDark, 0, 0.4, -0.2));
  scaffold.add(box(0.02, 0.02, 0.44, P.logDark, 0.24, 0.34, 0));
  scaffold.add(box(0.3, 0.05, 0.2, P.plank, -0.1, 0.44, 0.06));
  g.add(scaffold);

  g.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return g;
}
