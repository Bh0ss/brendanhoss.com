import * as THREE from 'three';
import { SKY, GROUND, BUILD, NATURE } from './palette.js';

// Builds the evocative-New-England shoreline town: a central green with a
// gazebo + benches + flagpole, a white-steeple church, a main street of shops,
// houses behind picket fences, lampposts + flowers along the paths, a rocky
// point with a lighthouse, sailboats on the Sound, and scattered trees/bushes.
// Returns the scene group + collision data + animated handles (trees, boats).

const LAND_RADIUS = 74;
const SHORE_Z = 44;

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, flatShading: true, ...opts });
}

// ── Ground with gentle per-vertex color variation (kills the "flat demo" look)
function makeGround() {
  const geo = new THREE.CircleGeometry(LAND_RADIUS + 3, 96);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colA = new THREE.Color(GROUND.grass);
  const colB = new THREE.Color(0x7fae5c);
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const n = (Math.sin(x * 0.08) * Math.cos(z * 0.07) + Math.sin((x + z) * 0.05)) * 0.5 + 0.5;
    const edge = Math.min(1, Math.hypot(x, z) / (LAND_RADIUS + 3));
    const c = colA.clone().lerp(colB, n * 0.7).multiplyScalar(1 - edge * 0.12);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  m.receiveShadow = true;
  return m;
}

function gableRoof(w, d, h, color) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, h); shape.lineTo(-w / 2, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  const m = new THREE.Mesh(geo, mat(color));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function building({ w, d, h, wall, roof, roofH = null, door = true }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(wall));
  body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  const rH = roofH ?? Math.min(w, d) * 0.5;
  const roofMesh = gableRoof(w + 0.5, d + 0.5, rH, roof);
  roofMesh.position.y = h; g.add(roofMesh);

  // trim board along the eaves
  const eave = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.25, d + 0.6), mat(BUILD.white));
  eave.position.y = h; g.add(eave);

  // windows (two front, framed)
  const glass = mat(0x9fc6d4, { emissive: 0x2a4650, emissiveIntensity: 0.3, flatShading: false });
  for (const sx of [-1, 1]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.98, 0.12), mat(BUILD.white));
    frame.position.set(sx * w * 0.27, h * 0.56, d / 2 + 0.02); g.add(frame);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.76, 0.16), glass);
    win.position.set(sx * w * 0.27, h * 0.56, d / 2 + 0.04); g.add(win);
  }
  // door + step
  if (door) {
    const dr = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.12), mat(BUILD.trim));
    dr.position.set(0, 0.8, d / 2 + 0.02); g.add(dr);
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 0.6), mat(0xcfc3a6));
    step.position.set(0, 0.1, d / 2 + 0.35); step.receiveShadow = true; g.add(step);
  }
  // chimney
  const chim = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.6, 0.7), mat(BUILD.brick));
  chim.position.set(w * 0.28, h + rH * 0.6, 0); chim.castShadow = true; g.add(chim);

  g.userData.footprint = Math.max(w, d) / 2;
  return g;
}

function roundTree() {
  const g = new THREE.Group();
  const h = 2.4 + Math.random() * 1.8;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, h, 6), mat(NATURE.trunk));
  trunk.position.y = h / 2; trunk.castShadow = true; g.add(trunk);
  const crown = new THREE.Group(); crown.position.y = h + 0.2;
  const greens = [NATURE.foliageA, NATURE.foliageB, NATURE.foliageC];
  const blobs = 3 + (Math.random() * 2 | 0);
  for (let i = 0; i < blobs; i++) {
    const r = 1.1 + Math.random() * 0.7;
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(greens[i % greens.length]));
    f.position.set((Math.random() - 0.5) * 1.4, i * 0.7, (Math.random() - 0.5) * 1.4);
    f.castShadow = true; crown.add(f);
  }
  g.add(crown);
  g.userData = { crown, phase: Math.random() * Math.PI * 2 };
  return g;
}

function pine() {
  const g = new THREE.Group();
  const h = 3 + Math.random() * 2;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, h * 0.5, 6), mat(NATURE.trunk));
  trunk.position.y = h * 0.25; trunk.castShadow = true; g.add(trunk);
  const crown = new THREE.Group(); crown.position.y = h * 0.45;
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(1.6 - i * 0.4, 1.8, 7), mat(i % 2 ? NATURE.foliageB : NATURE.foliageA));
    c.position.y = i * 1.1; c.castShadow = true; crown.add(c);
  }
  g.add(crown);
  g.userData = { crown, phase: Math.random() * Math.PI * 2 };
  return g;
}

function bush() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const r = 0.5 + Math.random() * 0.4;
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(i % 2 ? NATURE.foliageB : NATURE.foliageC));
    b.position.set((Math.random() - 0.5), r * 0.7, (Math.random() - 0.5)); b.castShadow = true; g.add(b);
  }
  return g;
}

function flowers(n = 6) {
  const g = new THREE.Group();
  const cols = [0xff7e7e, 0xffd56b, 0xff9ed6, 0xfff3c0, 0x9ad0ff];
  for (let i = 0; i < n; i++) {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 4), mat(0x5b9e46));
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), mat(cols[i % cols.length], { emissiveIntensity: 0.1 }));
    head.position.y = 0.25;
    const f = new THREE.Group(); f.add(stem, head);
    f.position.set((Math.random() - 0.5) * 2.4, 0.2, (Math.random() - 0.5) * 2.4);
    g.add(f);
  }
  return g;
}

function lamppost() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 3.4, 8), mat(0x3a3f44));
  pole.position.y = 1.7; pole.castShadow = true; g.add(pole);
  const lamp = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), mat(0xfff1c2, { emissive: 0xffce6b, emissiveIntensity: 0.9 }));
  lamp.position.y = 3.5; g.add(lamp);
  g.userData.footprint = 0.4;
  return g;
}

function bench() {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 0.7), mat(BUILD.trim));
  seat.position.y = 0.6; seat.castShadow = true; g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 0.14), mat(BUILD.trim));
  back.position.set(0, 0.95, -0.28); g.add(back);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.6), mat(0x4a4038));
    leg.position.set(sx * 0.9, 0.3, 0); g.add(leg);
  }
  return g;
}

function picketFence(len, segs = 8) {
  const g = new THREE.Group();
  const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.08), mat(BUILD.white));
  rail.position.y = 0.7; g.add(rail);
  for (let i = 0; i <= segs; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.08), mat(BUILD.white));
    p.position.set(-len / 2 + (i / segs) * len, 0.5, 0); g.add(p);
  }
  return g;
}

function rock(s = 1) {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mat(0x8b8f93));
  m.rotation.set(Math.random(), Math.random(), Math.random());
  m.scale.y = 0.7; m.castShadow = true; m.receiveShadow = true;
  return m;
}

function lighthouse() {
  const g = new THREE.Group();
  // rocky base
  for (let i = 0; i < 6; i++) {
    const r = rock(1.4 + Math.random()); r.position.set((Math.random() - 0.5) * 4, 0.3, (Math.random() - 0.5) * 4); g.add(r);
  }
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.0, 9, 16), mat(BUILD.white, { flatShading: false }));
  tower.position.y = 4.8; tower.castShadow = true; g.add(tower);
  // red bands
  for (const y of [3.0, 6.2]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.62, 1.78, 1.1, 16), mat(0xd5503f, { flatShading: false }));
    band.position.y = y; g.add(band);
  }
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.4, 16), mat(0x3a3f44));
  gallery.position.y = 9.4; g.add(gallery);
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.4, 12), mat(0xfff1c2, { emissive: 0xffd76b, emissiveIntensity: 1.1, flatShading: false }));
  lantern.position.y = 10.3; g.add(lantern);
  const beam = new THREE.PointLight(0xffe9a8, 30, 60, 2); beam.position.y = 10.3; g.add(beam);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.4, 12), mat(0x2f3338));
  cap.position.y = 11.6; g.add(cap);
  g.userData.footprint = 2.4;
  return g;
}

function sailboat() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 2.6, 4, 8), mat(0xb24a3c, { flatShading: false }));
  hull.rotation.z = Math.PI / 2; hull.scale.set(1, 1, 0.6); hull.position.y = 0.3; hull.castShadow = true; g.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.2, 0.9), mat(BUILD.trim)); deck.position.y = 0.55; g.add(deck);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), mat(0x6b5640)); mast.position.y = 2.4; g.add(mast);
  const sailGeo = new THREE.BufferGeometry();
  sailGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 3.4, 0, 1.8, 0.2, 0], 3));
  sailGeo.computeVertexNormals();
  const sail = new THREE.Mesh(sailGeo, mat(0xf3ede0, { side: THREE.DoubleSide, flatShading: false }));
  sail.position.set(0.05, 0.7, 0); g.add(sail);
  return g;
}

// A little Thimble-Island: rocky mound + a pine or two, sits in the Sound.
function island(s = 1) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.DodecahedronGeometry(3 * s, 0), mat(0x8b8f93));
  base.scale.y = 0.45; base.position.y = 0.3 * s; base.castShadow = true; g.add(base);
  const grass = new THREE.Mesh(new THREE.DodecahedronGeometry(2.4 * s, 0), mat(0x7fae5c));
  grass.scale.y = 0.5; grass.position.y = 1.0 * s; g.add(grass);
  const n = 1 + (Math.random() * 2 | 0);
  for (let i = 0; i < n; i++) {
    const p = pine(); p.scale.setScalar(0.6 * s);
    p.position.set((Math.random() - 0.5) * 3 * s, 1.0 * s, (Math.random() - 0.5) * 3 * s);
    g.add(p);
  }
  return g;
}

function pathStrip(x1, z1, x2, z2, width = 4) {
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len), mat(GROUND.path, { flatShading: false, roughness: 1 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set((x1 + x2) / 2, 0.02, (z1 + z2) / 2);
  m.rotation.z = -Math.atan2(dz, dx) + Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

export function buildWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const obstacles = [];
  const anchors = [];
  const trees = [];
  const boats = [];

  // ── Sky dome (vertical gradient) + fog ──────────────────────────────────
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(SKY.top) }, bottom: { value: new THREE.Color(SKY.horizon) } },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
      void main(){ float t = clamp(normalize(vP).y*0.5+0.5,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, smoothstep(0.0,0.65,t)),1.0); }`,
  });
  group.add(new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), skyMat));
  scene.fog = new THREE.Fog(SKY.fog, 95, 340);

  // ── Ground + green + shore ───────────────────────────────────────────────
  group.add(makeGround());

  const green = new THREE.Mesh(new THREE.CircleGeometry(17, 48), mat(GROUND.green, { flatShading: false, roughness: 1 }));
  green.rotation.x = -Math.PI / 2; green.position.y = 0.012; green.receiveShadow = true; group.add(green);

  const sand = new THREE.Mesh(new THREE.PlaneGeometry(240, 30), mat(GROUND.sand, { flatShading: false, roughness: 1 }));
  sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0.006, SHORE_Z + 6); sand.receiveShadow = true; group.add(sand);

  // dock
  for (let i = 0; i < 6; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 2), mat(BUILD.trim));
    plank.position.set(10, 0.16, SHORE_Z + 4 + i * 2.2); plank.castShadow = true; plank.receiveShadow = true; group.add(plank);
  }
  for (const z of [SHORE_Z + 5, SHORE_Z + 14]) for (const sx of [-1.3, 1.3]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.6, 6), mat(0x5a4636));
    post.position.set(10 + sx, 0.4, z); group.add(post);
  }

  // shoreline rocks
  for (let i = 0; i < 14; i++) {
    const r = rock(0.6 + Math.random() * 1.1);
    r.position.set(-70 + Math.random() * 140, 0.1, SHORE_Z + 1 + Math.random() * 2.5); group.add(r);
  }

  // lighthouse on a point to the west of the beach
  const lh = lighthouse(); lh.position.set(-44, 0, SHORE_Z + 6); group.add(lh);
  obstacles.push({ x: -44, z: SHORE_Z + 6, r: lh.userData.footprint });
  anchors.push({ id: 'lighthouse', label: 'Lighthouse', x: -40, z: SHORE_Z - 2 });

  // sailboats on the Sound
  for (let i = 0; i < 4; i++) {
    const b = sailboat();
    b.position.set(-50 + i * 28 + Math.random() * 8, 0, SHORE_Z + 26 + Math.random() * 40);
    b.rotation.y = Math.random() * Math.PI;
    b.userData = { phase: Math.random() * Math.PI * 2, baseY: 0 };
    group.add(b); boats.push(b);
  }

  // Thimble Islands scattered across the Sound
  for (let i = 0; i < 7; i++) {
    const isl = island(1.4 + Math.random() * 2.2);
    isl.position.set((Math.random() - 0.5) * 240, 0.1, SHORE_Z + 70 + Math.random() * 150);
    isl.rotation.y = Math.random() * Math.PI;
    group.add(isl);
  }
  // a long low far-shore ridge on the horizon
  for (let i = 0; i < 5; i++) {
    const hill = new THREE.Mesh(new THREE.DodecahedronGeometry(26 + Math.random() * 16, 0), mat(0x6f9e5a, { flatShading: true }));
    hill.scale.set(1.4, 0.32, 1);
    hill.position.set(-150 + i * 75 + Math.random() * 30, 1, SHORE_Z + 260 + Math.random() * 30);
    group.add(hill);
  }

  // ── Gazebo + flagpole + benches on the green ─────────────────────────────
  const gz = gazebo(); group.add(gz);
  obstacles.push({ x: 0, z: 0, r: gz.userData.footprint });

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 8, 8), mat(0xddd6c8));
  pole.position.set(9, 4, -6); pole.castShadow = true; group.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), mat(0xd6483f, { side: THREE.DoubleSide }));
  flag.position.set(10.1, 7.2, -6); group.add(flag);

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bn = bench(); bn.position.set(Math.cos(a) * 9, 0, Math.sin(a) * 9); bn.rotation.y = -a + Math.PI / 2; group.add(bn);
  }
  for (let i = 0; i < 5; i++) { const f = flowers(); f.position.set((Math.random() - 0.5) * 26, 0, (Math.random() - 0.5) * 26); group.add(f); }

  // ── Church to the north ──────────────────────────────────────────────────
  const ch = church(); ch.position.set(-2, 0, -36); group.add(ch);
  obstacles.push({ x: -2, z: -32, r: 6 });
  anchors.push({ id: 'church', label: 'Church', x: -2, z: -28 });

  // ── Main street of shops (east) + houses behind fences (west) ────────────
  const shopRoofs = [BUILD.roofTerracotta, BUILD.roofSlate, BUILD.roofDark];
  const shopWalls = [BUILD.cream, BUILD.brick, BUILD.sage, BUILD.blue];
  let idx = 0;
  for (let i = 0; i < 5; i++) {
    const z = -16 + i * 9.5;
    const b = building({ w: 6, d: 6, h: 4 + (i % 2), wall: shopWalls[i % shopWalls.length], roof: shopRoofs[i % shopRoofs.length] });
    b.position.set(36, 0, z); b.rotation.y = -Math.PI / 2; group.add(b);
    obstacles.push({ x: 36, z, r: b.userData.footprint });
    anchors.push({ id: `shop${idx}`, label: `Shop ${idx + 1}`, x: 31, z }); idx++;
  }
  for (let i = 0; i < 4; i++) {
    const z = -12 + i * 11;
    const b = building({ w: 7, d: 6, h: 4, wall: shopWalls[(i + 1) % shopWalls.length], roof: shopRoofs[i % shopRoofs.length] });
    b.position.set(-36, 0, z); b.rotation.y = Math.PI / 2; group.add(b);
    obstacles.push({ x: -36, z, r: b.userData.footprint });
    const fence = picketFence(8); fence.position.set(-30, 0, z); fence.rotation.y = Math.PI / 2; group.add(fence);
    const fl = flowers(4); fl.position.set(-31, 0, z); group.add(fl);
    anchors.push({ id: `house${i}`, label: `House ${i + 1}`, x: -31, z });
  }

  // ── Paths + lampposts ────────────────────────────────────────────────────
  group.add(pathStrip(0, -10, -2, -28, 4.5));
  group.add(pathStrip(6, 0, 31, 0, 4.5));
  group.add(pathStrip(-6, 0, -31, 0, 4.5));
  group.add(pathStrip(2, 13, 9, SHORE_Z, 4.5));
  for (const [x, z] of [[8, -8], [-8, -8], [16, 2], [-16, 2], [6, 20], [-6, 20]]) {
    const lp = lamppost(); lp.position.set(x, 0, z); group.add(lp);
    obstacles.push({ x, z, r: lp.userData.footprint });
  }

  // ── Trees + bushes ───────────────────────────────────────────────────────
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const t = roundTree(); const x = Math.cos(a) * 14, z = Math.sin(a) * 14;
    t.position.set(x, 0, z); group.add(t); trees.push(t);
    obstacles.push({ x, z, r: 0.9 });
  }
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 22 + Math.random() * 46;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z > SHORE_Z - 5) continue;
    if (Math.abs(x) > 28 && Math.abs(x) < 42 && z > -22 && z < 34) continue;
    const t = Math.random() < 0.35 ? pine() : roundTree();
    t.position.set(x, 0, z); t.scale.setScalar(0.8 + Math.random() * 0.5);
    group.add(t); trees.push(t);
    obstacles.push({ x, z, r: 0.8 });
  }
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 48;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z > SHORE_Z - 5) continue;
    const b = bush(); b.position.set(x, 0, z); group.add(b);
  }

  function clampFn(pos) {
    const r = Math.hypot(pos.x, pos.z);
    if (r > LAND_RADIUS) { pos.x *= LAND_RADIUS / r; pos.z *= LAND_RADIUS / r; }
    if (pos.z > SHORE_Z) pos.z = SHORE_Z;
  }

  return { group, obstacles, anchors, clampFn, trees, boats, shoreZ: SHORE_Z };
}

// ── kept near bottom for readability ──────────────────────────────────────
function church() {
  const g = new THREE.Group();
  g.add(building({ w: 7, d: 13, h: 6, wall: BUILD.white, roof: BUILD.roofSlate, roofH: 3.2, door: true }));
  const tower = new THREE.Mesh(new THREE.BoxGeometry(3.2, 11, 3.2), mat(BUILD.white));
  tower.position.set(0, 5.5, -6.6); tower.castShadow = true; g.add(tower);
  const louver = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2, 0.2), mat(BUILD.trim));
  louver.position.set(0, 8.5, -4.95); g.add(louver);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(2.4, 5.5, 4), mat(BUILD.roofSlate));
  spire.position.set(0, 13.8, -6.6); spire.rotation.y = Math.PI / 4; spire.castShadow = true; g.add(spire);
  g.userData.footprint = 7;
  return g;
}

function gazebo() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 0.5, 8), mat(BUILD.trim));
  base.position.y = 0.25; base.receiveShadow = true; g.add(base);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3, 6), mat(BUILD.white));
    post.position.set(Math.cos(a) * 2.6, 2, Math.sin(a) * 2.6); post.castShadow = true; g.add(post);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.1, 6, 16), mat(BUILD.white));
  ring.rotation.x = Math.PI / 2; ring.position.y = 3.4; g.add(ring);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.7, 2.3, 8), mat(BUILD.roofTerracotta));
  roof.position.y = 4.7; roof.castShadow = true; g.add(roof);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), mat(0xddd6c8));
  finial.position.y = 5.9; g.add(finial);
  g.userData.footprint = 3.2;
  return g;
}
