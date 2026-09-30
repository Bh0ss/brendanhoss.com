import * as THREE from 'three';
import { SKY, GROUND, BUILD, NATURE, SUN_DIR, MATERIALS, part, paint, seeded, blobField, LAYOUT_SEED } from './palette.js';
import { createPath } from './path.js';
import { ROUTE, LANDMARKS } from '../data.js';
import { outlineGroup } from './outline.js';

// Builds the evocative-New-England shoreline town: a central green with a
// gazebo + benches + flagpole, a white-steeple church, lampposts + flowers
// along the paths, a rocky point with a lighthouse, sailboats on the Sound, and
// scattered trees/bushes. Every mesh uses a shared material from palette.js and
// every "random" choice comes from a seeded PRNG, so the town is the same
// composed place on every load.
// Returns the scene group + collision data + animated handles (trees, boats).

const SHORE_Z = 44;

// Hand-composed camera views. The harbor ending looks straight out to sea (south,
// toward the low sun) instead of along the beach; landmarks.js uses the same
// approach point so the nav arrows land on this composition.
export const VIEW_OVERRIDES = { contact: { x: 12, z: 35 } };

// ── Ground: a vertex-painted plane — grass variation, the town green, a dune
// fringe and an organic, wavy sand shoreline (replaces three separate meshes).
const GROUND_VIS = 240;
function makeGround() {
  const SEG = 160;
  const geo = new THREE.PlaneGeometry(GROUND_VIS * 2, GROUND_VIS * 2, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const grass = new THREE.Color(GROUND.grass), deep = new THREE.Color(GROUND.grassDeep);
  const green = new THREE.Color(GROUND.green), sand = new THREE.Color(GROUND.sand);
  const wet = new THREE.Color(0xd9c49e), dune = new THREE.Color(0xc4c486);
  const c = new THREE.Color();
  const col = new Float32Array(pos.count * 3);
  const ss = THREE.MathUtils.smoothstep;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const n = (Math.sin(x * 0.08) * Math.cos(z * 0.07) + Math.sin((x + z) * 0.05) + 0.5 * Math.sin(x * 0.21 - z * 0.17)) * 0.4 + 0.5;
    c.copy(grass).lerp(deep, THREE.MathUtils.clamp(n, 0, 1) * 0.75);
    // the town green: brighter, soft edge
    c.lerp(green, 1 - ss(Math.hypot(x, z), 15.5, 18.5));
    // wavy shoreline: dune grass → dry sand → wet sand under the swash
    const edge = 36.5 + Math.sin(x * 0.09) * 1.6 + Math.sin(x * 0.23 + 1.3) * 0.7;
    c.lerp(dune, ss(z, edge - 4, edge - 1) * 0.55);
    c.lerp(sand, ss(z, edge - 1, edge + 0.6));
    c.lerp(wet, ss(z, SHORE_Z + 0.5, SHORE_Z + 4));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, MATERIALS.ground);
  m.receiveShadow = true;
  return m;
}

function gableRoof(w, d, h, color) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, h); shape.lineTo(-w / 2, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  return part(geo, color, { ao: 0.18 });
}

function building(rng, { w, d, h, wall, roof, roofH = null, door = true }) {
  const g = new THREE.Group();
  const body = part(new THREE.BoxGeometry(w, h, d), wall, { ao: 0.16 });
  body.position.y = h / 2;
  g.add(body);
  const rH = roofH ?? Math.min(w, d) * 0.5;
  const roofMesh = gableRoof(w + 0.5, d + 0.5, rH, roof);
  roofMesh.position.y = h; g.add(roofMesh);

  const eave = part(new THREE.BoxGeometry(w + 0.6, 0.25, d + 0.6), BUILD.white, { cast: false });
  eave.position.y = h; g.add(eave);

  for (const sx of [-1, 1]) {
    const frame = part(new THREE.BoxGeometry(0.78, 0.98, 0.12), BUILD.white, { cast: false, ao: 0 });
    frame.position.set(sx * w * 0.27, h * 0.56, d / 2 + 0.02); g.add(frame);
    const lit = rng() < 0.55;
    const win = part(new THREE.BoxGeometry(0.56, 0.76, 0.16), lit ? BUILD.windowLit : BUILD.glass,
      lit ? { mat: 'glow', intensity: 2.4 } : { cast: false });
    win.position.set(sx * w * 0.27, h * 0.56, d / 2 + 0.04); g.add(win);
  }
  if (door) {
    const dr = part(new THREE.BoxGeometry(0.9, 1.6, 0.12), BUILD.trim, { cast: false });
    dr.position.set(0, 0.8, d / 2 + 0.02); g.add(dr);
    const step = part(new THREE.BoxGeometry(1.4, 0.2, 0.6), BUILD.plinth, { cast: false });
    step.position.set(0, 0.1, d / 2 + 0.35); g.add(step);
  }
  const chim = part(new THREE.BoxGeometry(0.7, 1.6, 0.7), BUILD.brick);
  chim.position.set(w * 0.28, h + rH * 0.6, 0); g.add(chim);

  g.userData.footprint = Math.max(w, d) / 2;
  return g;
}

function roundTree(rng, { maple = false } = {}) {
  const g = new THREE.Group();
  const h = rng.range(2.4, 4.2);
  const trunk = part(new THREE.CylinderGeometry(0.22, 0.34, h, 6), NATURE.trunk, { receive: false });
  trunk.position.y = h / 2; g.add(trunk);
  const crown = new THREE.Group(); crown.position.y = h + 0.2;
  const greens = maple ? [NATURE.maple, NATURE.mapleB, NATURE.maple] : [NATURE.foliageA, NATURE.foliageB, NATURE.foliageC];
  const blobs = 3 + ((rng() * 2) | 0);
  for (let i = 0; i < blobs; i++) {
    const r = rng.range(1.1, 1.8);
    const f = part(new THREE.IcosahedronGeometry(r, 0), greens[i % greens.length], { ao: 0.22 });
    f.position.set(rng.range(-0.7, 0.7), i * 0.7, rng.range(-0.7, 0.7));
    crown.add(f);
  }
  g.add(crown);
  g.userData = { crown, phase: rng() * Math.PI * 2 };
  return g;
}

function pine(rng) {
  const g = new THREE.Group();
  const h = rng.range(3, 5);
  const trunk = part(new THREE.CylinderGeometry(0.18, 0.28, h * 0.5, 6), NATURE.trunk, { receive: false });
  trunk.position.y = h * 0.25; g.add(trunk);
  const crown = new THREE.Group(); crown.position.y = h * 0.45;
  for (let i = 0; i < 3; i++) {
    const c = part(new THREE.ConeGeometry(1.6 - i * 0.4, 1.8, 7), i % 2 ? NATURE.foliageB : 0x679655, { ao: 0.3 });
    c.position.y = i * 1.1; crown.add(c);
  }
  g.add(crown);
  g.userData = { crown, phase: rng() * Math.PI * 2 };
  return g;
}

function bush(rng) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const r = rng.range(0.5, 0.9);
    const b = part(new THREE.IcosahedronGeometry(r, 0), i % 2 ? NATURE.foliageB : NATURE.foliageC, { ao: 0.3 });
    b.position.set(rng.range(-0.5, 0.5), r * 0.7, rng.range(-0.5, 0.5)); g.add(b);
  }
  return g;
}

const FLOWER_COLS = [0xff8a7a, 0xffd56b, 0xff9ed6, 0xfff3c0, 0x9ad0ff];
function flowers(rng, n = 6) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const stem = part(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 4), 0x5b9e46, { cast: false, receive: false, ao: 0 });
    const head = part(new THREE.IcosahedronGeometry(0.14, 0), FLOWER_COLS[i % FLOWER_COLS.length], { cast: false, ao: 0 });
    head.position.y = 0.25;
    const f = new THREE.Group(); f.add(stem, head);
    f.position.set(rng.range(-1.2, 1.2), 0.2, rng.range(-1.2, 1.2));
    g.add(f);
  }
  return g;
}

function lamppost() {
  const g = new THREE.Group();
  const pole = part(new THREE.CylinderGeometry(0.1, 0.14, 3.4, 8), 0x3f4148, { ao: 0 });
  pole.position.y = 1.7; g.add(pole);
  const lamp = part(new THREE.IcosahedronGeometry(0.32, 1), 0xffd28a, { mat: 'glow', intensity: 3.2 });
  lamp.position.y = 3.5; g.add(lamp);
  const cap = part(new THREE.ConeGeometry(0.34, 0.26, 8), 0x3f4148, { cast: false, ao: 0 });
  cap.position.y = 3.85; g.add(cap);
  g.userData.footprint = 0.4;
  return g;
}

function bench() {
  const g = new THREE.Group();
  const seat = part(new THREE.BoxGeometry(2.2, 0.16, 0.7), BUILD.trim);
  seat.position.y = 0.6; g.add(seat);
  const back = part(new THREE.BoxGeometry(2.2, 0.6, 0.14), BUILD.trim);
  back.position.set(0, 0.95, -0.28); g.add(back);
  for (const sx of [-1, 1]) {
    const leg = part(new THREE.BoxGeometry(0.16, 0.6, 0.6), 0x4a4038, { cast: false });
    leg.position.set(sx * 0.9, 0.3, 0); g.add(leg);
  }
  return g;
}

function rock(rng, s = 1) {
  const m = part(new THREE.DodecahedronGeometry(s, 0), rng() < 0.5 ? NATURE.rock : NATURE.rockDark, { ao: 0.3 });
  m.rotation.set(rng(), rng(), rng());
  m.scale.y = 0.7;
  return m;
}

function lighthouse(rng) {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const r = rock(rng, rng.range(1.4, 2.4)); r.position.set(rng.range(-2, 2), 0.3, rng.range(-2, 2)); g.add(r);
  }
  const tower = part(new THREE.CylinderGeometry(1.4, 2.0, 9, 16), BUILD.white, { ao: 0.15 });
  tower.position.y = 4.8; g.add(tower);
  for (const y of [3.0, 6.2]) {
    const band = part(new THREE.CylinderGeometry(1.62, 1.78, 1.1, 16), 0xd65a45, { cast: false, ao: 0 });
    band.position.y = y; g.add(band);
  }
  const gallery = part(new THREE.CylinderGeometry(1.7, 1.7, 0.4, 16), 0x3f4148, { ao: 0 });
  gallery.position.y = 9.4; g.add(gallery);
  // Lantern: emissive + bloom only (the old 30-intensity point light cost every
  // fragment in the scene for a glow that didn't read in daylight).
  const lantern = part(new THREE.CylinderGeometry(1.1, 1.1, 1.4, 12), 0xffd98a, { mat: 'glow', intensity: 3.6 });
  lantern.position.y = 10.3; lantern.userData.noOutline = true; g.add(lantern);
  const cap = part(new THREE.ConeGeometry(1.4, 1.4, 12), 0x39363a, { ao: 0 });
  cap.position.y = 11.6; g.add(cap);
  g.userData.footprint = 2.4;
  return g;
}

function sailboat(hullCol = 0xc0503f) {
  const g = new THREE.Group();
  const hull = part(new THREE.CapsuleGeometry(0.7, 2.6, 4, 8), hullCol, { ao: 0.25 });
  hull.rotation.z = Math.PI / 2; hull.scale.set(1, 1, 0.6); hull.position.y = 0.3; g.add(hull);
  const deck = part(new THREE.BoxGeometry(3.0, 0.2, 0.9), 0xb58a62, { cast: false }); deck.position.y = 0.55; g.add(deck);
  const mast = part(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), 0x6b5640, { ao: 0 }); mast.position.y = 2.4; g.add(mast);
  const sailGeo = new THREE.BufferGeometry();
  sailGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 3.4, 0, 1.8, 0.2, 0], 3));
  sailGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0], 2));
  sailGeo.computeVertexNormals();
  const sail = part(sailGeo, 0xfbf3e4, { mat: 'toonDS', ao: 0 });
  sail.position.set(0.05, 0.7, 0); g.add(sail);
  return g;
}

// A little Thimble Island: rocky mound + a pine or two, sits in the Sound.
function island(rng, s = 1) {
  const g = new THREE.Group();
  const base = part(new THREE.DodecahedronGeometry(3 * s, 0), NATURE.rock, { ao: 0.2 });
  base.scale.y = 0.45; base.position.y = 0.3 * s; g.add(base);
  const grass = part(new THREE.DodecahedronGeometry(2.4 * s, 0), NATURE.hill, { cast: false, ao: 0 });
  grass.scale.y = 0.5; grass.position.y = 1.0 * s; g.add(grass);
  const n = 1 + ((rng() * 2) | 0);
  for (let i = 0; i < n; i++) {
    const p = pine(rng); p.scale.setScalar(0.6 * s);
    p.position.set(rng.range(-1.5, 1.5) * s, 1.0 * s, rng.range(-1.5, 1.5) * s);
    g.add(p);
  }
  return g;
}

// Clear camera corridors: a capsule from `a` to `b` of radius `r` where no tree
// or bush may stand, so every nav-arrow view and the opening shot are unblocked.
function segDist(x, z, a, b) {
  const vx = b.x - a.x, vz = b.z - a.z;
  const t = THREE.MathUtils.clamp(((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz), 0, 1);
  return Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t));
}

export function buildWorld(scene) {
  const rng = seeded(LAYOUT_SEED);
  const group = new THREE.Group();
  scene.add(group);
  const obstacles = [];
  const anchors = [];
  const trees = [];
  const boats = [];
  const blobs = [];

  // ── Sky dome: zenith → horizon gradient, warm glow lobe around a visible
  // sun disc. At the horizon line it resolves to exactly the fog colour, so
  // fogged ground/water meets the sky without a seam.
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(SKY.top) },
      uHorizon: { value: new THREE.Color(SKY.horizon) },
      uGlow: { value: new THREE.Color(SKY.glow) },
      uSunCol: { value: new THREE.Color(SKY.sun) },
      uSun: { value: SUN_DIR.clone() },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uHorizon, uGlow, uSunCol, uSun; varying vec3 vP;
      void main(){
        vec3 d = normalize(vP);
        float h = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.55, pow(h, 0.8)));
        float s = max(dot(d, uSun), 0.0);
        float lift = smoothstep(0.0, 0.06, h);                 // horizon == fog colour
        col = mix(col, uGlow, (pow(s, 6.0) * 0.55 + pow(s, 40.0) * 0.35) * lift);
        col += uSunCol * (smoothstep(0.9990, 0.9994, s) * 5.0 + pow(s, 400.0) * 1.2) * lift;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), skyMat);
  sky.renderOrder = -1;
  group.add(sky);
  // Fog = the horizon haze. Near keeps the buildings (r<=61) + trees (r<=70)
  // crisp; far fully hides the ground edge (240).
  scene.fog = new THREE.Fog(SKY.fog, 55, 215);   // a little aerial perspective on the far town

  // ── Ground (grass + green + beach in one painted mesh) ────────────────────
  group.add(makeGround());

  // dock — planks ride ~0.2 above the LOCAL water surface, which rises offshore
  for (let i = 0; i < 6; i++) {
    const pz = SHORE_Z + 4 + i * 2.2;
    const waterMean = 0.05 + 0.5 * Math.max(0, Math.min(1, (pz - (SHORE_Z + 5)) / 9));
    const py = Math.max(0.16, waterMean + 0.2);
    const plank = part(new THREE.BoxGeometry(3, 0.3, 2), 0xa27a58, { ao: 0.2 });
    plank.position.set(10, py, pz); group.add(plank);
  }
  for (const z of [SHORE_Z + 5, SHORE_Z + 14]) for (const sx of [-1.3, 1.3]) {
    const post = part(new THREE.CylinderGeometry(0.16, 0.16, 1.6, 6), 0x5a4636, { ao: 0.3 });
    post.position.set(10 + sx, 0.4, z); group.add(post);
  }

  // shoreline rocks — kept out of the harbor view's foreground
  for (let i = 0; i < 16; i++) {
    const x = rng.range(-70, 70), z = SHORE_Z + rng.range(1, 3.5), s = rng.range(0.6, 1.7);
    if (Math.abs(x - 11) < 7) continue;
    const r = rock(rng, s);
    r.position.set(x, 0.1, z); group.add(r);
  }

  // lighthouse on a point to the west of the beach
  const lh = lighthouse(rng); lh.position.set(-44, 0, SHORE_Z + 6); group.add(lh); outlineGroup(lh, 1.9);
  obstacles.push({ x: -44, z: SHORE_Z + 6, r: lh.userData.footprint });
  anchors.push({ id: 'lighthouse', label: 'Lighthouse', x: -40, z: SHORE_Z - 2 });

  // sailboats — hand-placed so the harbor ending frames them over the sun path
  const BOATS = [
    { x: 2, z: 70, ry: 0.5, c: 0xc0503f },
    { x: 26, z: 62, ry: 2.4, c: 0x3f6f9a },
    { x: -20, z: 92, ry: 1.2, c: 0xf2e6d0 },
    { x: 46, z: 104, ry: 2.9, c: 0xc0503f },
  ];
  for (const bd of BOATS) {
    const b = sailboat(bd.c);
    b.position.set(bd.x, 0, bd.z);
    b.rotation.y = bd.ry;
    // baseY floats the hull on the offshore water surface (mean sea level ~0.5)
    b.userData = { phase: rng() * Math.PI * 2, baseY: 0.5 };
    group.add(b); boats.push(b);
  }

  // the harbor ending's foreground: a bench facing the Sound
  const hb = bench(); hb.position.set(21, 0, 37.5); hb.rotation.y = -0.25; group.add(hb);
  obstacles.push({ x: 21, z: 37.5, r: 1.2 });
  blobs.push({ x: 21, z: 37.5, r: 1.5, sz: 0.55, rot: 0.25 });

  // Thimble Islands — hand-placed across the Sound for a layered horizon
  const ISLES = [[-62, 122, 2.2], [-16, 148, 1.6], [30, 132, 2.8], [80, 158, 2.0], [-112, 170, 3.2], [118, 120, 1.8], [6, 205, 3.4]];
  for (const [x, z, s] of ISLES) {
    const isl = island(rng, s);
    isl.position.set(x, 0.1, z);
    isl.rotation.y = rng() * Math.PI;
    group.add(isl);
  }
  // a long low far-shore ridge on the horizon
  for (let i = 0; i < 5; i++) {
    const hill = part(new THREE.DodecahedronGeometry(rng.range(26, 42), 0), NATURE.hill, { cast: false, receive: false, ao: 0.1 });
    hill.scale.set(1.4, 0.32, 1);
    hill.position.set(-150 + i * 75 + rng.range(0, 30), 1, SHORE_Z + 260 + rng.range(0, 30));
    group.add(hill);
  }

  // ── Gazebo + flagpole + benches on the green ─────────────────────────────
  const gz = gazebo(); group.add(gz); outlineGroup(gz, 1.9);
  obstacles.push({ x: 0, z: 0, r: gz.userData.footprint });
  blobs.push({ x: 0, z: 0, r: 4.6 });

  const pole = part(new THREE.CylinderGeometry(0.1, 0.1, 8, 8), 0xe6dfd0, { ao: 0 });
  pole.position.set(9, 4, -6); group.add(pole);
  const flag = part(new THREE.PlaneGeometry(2.2, 1.3), 0xd6483f, { mat: 'toonDS', ao: 0 });
  flag.position.set(10.1, 7.2, -6); group.add(flag);
  blobs.push({ x: 9, z: -6, r: 0.8 });

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bn = bench(); bn.position.set(Math.cos(a) * 9, 0, Math.sin(a) * 9); bn.rotation.y = -a + Math.PI / 2; group.add(bn);
    blobs.push({ x: bn.position.x, z: bn.position.z, r: 1.5, sz: 0.55, rot: -bn.rotation.y });
  }

  // ── Church (scenery), off the trail to the west ──────────────────────────
  const ch = church(rng); ch.position.set(-58, 0, -4); ch.rotation.y = 1.1; group.add(ch); outlineGroup(ch, 1.9);
  obstacles.push({ x: -58, z: -4, r: 6 });
  blobs.push({ x: -58, z: -4, r: 5.6, sz: 9.2 / 5.6, rot: -1.1 });

  // ── Memory-lane path (re-skinned onto the shared ground material) ────────
  const path = createPath(ROUTE);
  paint(path.mesh.geometry, GROUND.path, { ao: 0 });
  path.mesh.material.dispose();
  path.mesh.material = MATERIALS.ground;
  group.add(path.mesh);

  // flower beds on the green (kept off the path)
  for (let i = 0, n = 0; i < 20 && n < 5; i++) {
    const x = rng.range(-13, 13), z = rng.range(-13, 13);
    if (Math.hypot(x, z) < 5.5 || path.nearPath(x, z, 4)) continue;
    const f = flowers(rng); f.position.set(x, 0, z); group.add(f); n++;
  }

  const LAMP_N = 8;
  for (let i = 1; i < LAMP_N; i++) {
    const t = i / LAMP_N;
    const p = path.besideAt(t, (i % 2 === 0 ? 1 : -1) * 4.3);
    const lp = lamppost(); lp.position.set(p.x, 0, p.z); group.add(lp);
    obstacles.push({ x: p.x, z: p.z, r: lp.userData.footprint });
    blobs.push({ x: p.x, z: p.z, r: 0.7 });
  }

  // ── Camera corridors (opening shot + every landmark approach view) ───────
  const corridors = [];
  {
    const sd = path.startDir();
    const sp = { x: 0, z: 6 };                           // spawn (intro approach)
    corridors.push({ a: { x: sp.x - sd.x * 3, z: sp.z - sd.z * 3 }, b: { x: sp.x - sd.x * 32, z: sp.z - sd.z * 32 }, r: 6 });
  }
  for (const lm of LANDMARKS) {
    if (lm.kind === 'intro') continue;
    const [lx, lz] = lm.pos;
    let dx, dz;
    const ov = VIEW_OVERRIDES[lm.id];
    if (ov) { dx = ov.x - lx; dz = ov.z - lz; }
    else {
      let best = Infinity, nx = lx, nz = lz;
      for (const s of path.samples) { const d = Math.hypot(s.x - lx, s.z - lz); if (d < best) { best = d; nx = s.x; nz = s.z; } }
      dx = nx - lx; dz = nz - lz;
    }
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    corridors.push({ a: { x: lx + dx * 7, z: lz + dz * 7 }, b: { x: lx + dx * 36, z: lz + dz * 36 }, r: 4.5 });
  }
  const inCorridor = (x, z) => corridors.some((c) => segDist(x, z, c.a, c.b) < c.r);

  // ── Trees + bushes (organic; off the path, landmarks, green, and views) ──
  function clearOf(x, z, treeClear) {
    if (path.nearPath(x, z, treeClear)) return false;
    for (const lm of LANDMARKS) if (Math.hypot(x - lm.pos[0], z - lm.pos[1]) < 9) return false;
    if (Math.hypot(x, z) < 7) return false;
    if (inCorridor(x, z)) return false;
    if (z > 24 && Math.abs(x - 12) < 36) return false;   // open meadow + beach at the harbor ending
    return true;
  }
  const addTree = (t, x, z, s) => {
    t.position.set(x, 0, z); t.scale.setScalar(s);
    group.add(t); trees.push(t);
    obstacles.push({ x, z, r: 0.85 });
    blobs.push({ x, z, r: 2.3 * s });
  };
  // a loose ring framing the green
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    const r = rng.range(15, 19);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!clearOf(x, z, 5)) continue;
    addTree(roundTree(rng, { maple: i === 4 }), x, z, 1);
  }
  // scattered woods
  let placed = 0, tries = 0;
  while (placed < 48 && tries < 600) {
    tries++;
    const a = rng() * Math.PI * 2, r = rng.range(18, 70);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z > SHORE_Z - 8) continue;
    if (!clearOf(x, z, 4.5)) continue;
    const kind = rng();
    const t = kind < 0.38 ? pine(rng) : roundTree(rng, { maple: kind > 0.93 });
    addTree(t, x, z, rng.range(0.8, 1.4));
    placed++;
  }
  // bushes + a few extra flower clumps
  let bp = 0, bt = 0;
  while (bp < 20 && bt < 300) {
    bt++;
    const a = rng() * Math.PI * 2, r = rng.range(14, 68);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z > SHORE_Z - 8) continue;
    if (!clearOf(x, z, 3.2)) continue;
    if (rng() < 0.25) { const f = flowers(rng, 4); f.position.set(x, 0, z); group.add(f); }
    else { const b = bush(rng); b.position.set(x, 0, z); group.add(b); blobs.push({ x, z, r: 1.4 }); }
    bp++;
  }

  // One merged mesh for every contact blob in the town (one draw call).
  group.add(blobField(blobs));

  function clampFn(pos) {
    const r = Math.hypot(pos.x, pos.z);
    const maxR = 62;
    if (r > maxR) { pos.x *= maxR / r; pos.z *= maxR / r; }
    if (pos.z > SHORE_Z) pos.z = SHORE_Z;
  }

  return { group, obstacles, anchors, clampFn, trees, boats, shoreZ: SHORE_Z, path };
}

// ── kept near bottom for readability ──────────────────────────────────────
function church(rng) {
  const g = new THREE.Group();
  g.add(building(rng, { w: 7, d: 13, h: 6, wall: BUILD.white, roof: BUILD.roofSlate, roofH: 3.2, door: true }));
  const tower = part(new THREE.BoxGeometry(3.2, 11, 3.2), BUILD.white, { ao: 0.14 });
  tower.position.set(0, 5.5, -6.6); g.add(tower);
  const louver = part(new THREE.BoxGeometry(1.4, 2, 0.2), BUILD.trim, { cast: false });
  louver.position.set(0, 8.5, -4.95); g.add(louver);
  const spire = part(new THREE.ConeGeometry(2.4, 5.5, 4), BUILD.roofSlate, { ao: 0.1 });
  spire.position.set(0, 13.8, -6.6); spire.rotation.y = Math.PI / 4; g.add(spire);
  g.userData.footprint = 7;
  return g;
}

function gazebo() {
  const g = new THREE.Group();
  const base = part(new THREE.CylinderGeometry(3, 3.2, 0.5, 8), BUILD.trim, { cast: false });
  base.position.y = 0.25; g.add(base);
  const deck = part(new THREE.CylinderGeometry(2.85, 2.85, 0.06, 8), 0xc9a47e, { cast: false, ao: 0 });
  deck.position.y = 0.52; g.add(deck);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const post = part(new THREE.CylinderGeometry(0.12, 0.12, 3, 6), BUILD.white, { ao: 0 });
    post.position.set(Math.cos(a) * 2.6, 2, Math.sin(a) * 2.6); g.add(post);
  }
  const ring = part(new THREE.TorusGeometry(2.6, 0.1, 6, 16), BUILD.white, { ao: 0 });
  ring.rotation.x = Math.PI / 2; ring.position.y = 3.4; g.add(ring);
  const roof = part(new THREE.ConeGeometry(3.7, 2.3, 8), BUILD.roofTerracotta, { ao: 0.2 });
  roof.position.y = 4.7; g.add(roof);
  const finial = part(new THREE.SphereGeometry(0.25, 8, 8), 0xe6dfd0, { ao: 0 });
  finial.position.y = 5.9; g.add(finial);
  g.userData.footprint = 3.2;
  return g;
}
