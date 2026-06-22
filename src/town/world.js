import * as THREE from 'three';
import { SKY, GROUND, BUILD, NATURE } from './palette.js';

// Builds the evocative-New-England town: a central green with a gazebo, a
// white-steeple church, a main street of shops, scattered houses and trees,
// and a southern shoreline onto the Sound. Returns the scene group plus the
// collision data the Player needs.
//
// Phase 1 ships placeholder buildings; `anchors` records the footprint of the
// "important" structures so Phase 2 can attach career chapters to them.

const LAND_RADIUS = 72;
const SHORE_Z = 44;      // land ends (player clamp); sand/water lie south of it

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true, ...opts });
}

// Triangular-prism gable roof: ridge runs along the building depth (z).
function gableRoof(w, d, h, color) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.lineTo(-w / 2, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  const m = new THREE.Mesh(geo, mat(color));
  m.castShadow = true;
  return m;
}

function building({ w, d, h, wall, roof, roofH = null }) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(wall));
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const roofMesh = gableRoof(w + 0.4, d + 0.4, roofH ?? Math.min(w, d) * 0.5, roof);
  roofMesh.position.y = h;
  g.add(roofMesh);
  // a couple of windows for charm
  const win = mat(0x6fa8b8, { emissive: 0x223a44, emissiveIntensity: 0.25 });
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.1), win);
    m.position.set(sx * w * 0.28, h * 0.55, d / 2 + 0.02);
    g.add(m);
  }
  g.userData.footprint = Math.max(w, d) / 2;
  return g;
}

function tree() {
  const g = new THREE.Group();
  const h = 2.2 + Math.random() * 1.6;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, h, 6), mat(NATURE.trunk));
  trunk.position.y = h / 2;
  trunk.castShadow = true;
  g.add(trunk);
  const blobs = 2 + (Math.random() * 2 | 0);
  const greens = [NATURE.foliageA, NATURE.foliageB, NATURE.foliageC];
  for (let i = 0; i < blobs; i++) {
    const r = 1.1 + Math.random() * 0.7;
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(greens[i % greens.length]));
    f.position.set((Math.random() - 0.5) * 1.2, h + 0.2 + i * 0.7, (Math.random() - 0.5) * 1.2);
    f.castShadow = true;
    g.add(f);
  }
  return g;
}

function church() {
  const g = new THREE.Group();
  const nave = building({ w: 7, d: 12, h: 6, wall: BUILD.white, roof: BUILD.roofSlate, roofH: 3 });
  g.add(nave);
  // tower
  const tower = new THREE.Mesh(new THREE.BoxGeometry(3.2, 11, 3.2), mat(BUILD.white));
  tower.position.set(0, 5.5, -6.2);
  tower.castShadow = true;
  g.add(tower);
  // spire
  const spire = new THREE.Mesh(new THREE.ConeGeometry(2.4, 5, 4), mat(BUILD.roofSlate));
  spire.position.set(0, 13.5, -6.2);
  spire.rotation.y = Math.PI / 4;
  spire.castShadow = true;
  g.add(spire);
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
    post.position.set(Math.cos(a) * 2.6, 2, Math.sin(a) * 2.6);
    post.castShadow = true; g.add(post);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 2.2, 8), mat(BUILD.roofTerracotta));
  roof.position.y = 4.6; roof.castShadow = true; g.add(roof);
  g.userData.footprint = 3.2;
  return g;
}

function pathStrip(x1, z1, x2, z2, width = 3) {
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const geo = new THREE.PlaneGeometry(width, len);
  const m = new THREE.Mesh(geo, mat(GROUND.path, { flatShading: false }));
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

  // ── Sky dome (vertical gradient) ────────────────────────────────────────
  const skyGeo = new THREE.SphereGeometry(400, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top: { value: new THREE.Color(SKY.top) },
      bottom: { value: new THREE.Color(SKY.horizon) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
      void main(){ float t = clamp((normalize(vP).y*0.5+0.5),0.0,1.0); gl_FragColor = vec4(mix(bottom, top, smoothstep(0.0,0.7,t)),1.0); }`,
  });
  group.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(SKY.fog, 90, 320);

  // ── Ground + town green + shoreline + water ─────────────────────────────
  const ground = new THREE.Mesh(new THREE.CircleGeometry(LAND_RADIUS + 2, 48), mat(GROUND.grass, { flatShading: false }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const green = new THREE.Mesh(new THREE.CircleGeometry(16, 40), mat(GROUND.green, { flatShading: false }));
  green.rotation.x = -Math.PI / 2;
  green.position.y = 0.01;
  green.receiveShadow = true;
  group.add(green);

  // sand strip + water to the south
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(200, 26), mat(GROUND.sand, { flatShading: false }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.005, SHORE_Z + 10);
  sand.receiveShadow = true;
  group.add(sand);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 200, 1, 1),
    new THREE.MeshStandardMaterial({ color: GROUND.water, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.92, flatShading: false })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.06, SHORE_Z + 110);
  group.add(water);

  // a little dock reaching into the Sound
  for (let i = 0; i < 5; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 2), mat(BUILD.trim));
    plank.position.set(8, 0.15, SHORE_Z + 4 + i * 2.2);
    plank.castShadow = true; plank.receiveShadow = true;
    group.add(plank);
  }

  // ── Gazebo on the green ──────────────────────────────────────────────────
  const gz = gazebo();
  group.add(gz);
  obstacles.push({ x: 0, z: 0, r: gz.userData.footprint });

  // ── Church to the north ──────────────────────────────────────────────────
  const ch = church();
  ch.position.set(-2, 0, -34);
  group.add(ch);
  obstacles.push({ x: -2, z: -30, r: 6 });
  anchors.push({ id: 'church', label: 'Church', x: -2, z: -28 });

  // ── A main street of shops to the east + houses to the west ──────────────
  const shopRoofs = [BUILD.roofTerracotta, BUILD.roofSlate, BUILD.roofDark];
  const shopWalls = [BUILD.cream, BUILD.brick, BUILD.sage, BUILD.blue];
  let idx = 0;
  for (let i = 0; i < 5; i++) {
    const z = -16 + i * 9;
    const b = building({ w: 6, d: 6, h: 4 + (i % 2), wall: shopWalls[i % shopWalls.length], roof: shopRoofs[i % shopRoofs.length] });
    b.position.set(34, 0, z);
    b.rotation.y = -Math.PI / 2;
    group.add(b);
    obstacles.push({ x: 34, z, r: b.userData.footprint });
    anchors.push({ id: `shop${idx}`, label: `Shop ${idx + 1}`, x: 30, z });
    idx++;
  }
  for (let i = 0; i < 4; i++) {
    const z = -12 + i * 10;
    const b = building({ w: 7, d: 6, h: 4, wall: shopWalls[(i + 1) % shopWalls.length], roof: shopRoofs[i % shopRoofs.length] });
    b.position.set(-34, 0, z);
    b.rotation.y = Math.PI / 2;
    group.add(b);
    obstacles.push({ x: -34, z, r: b.userData.footprint });
    anchors.push({ id: `house${i}`, label: `House ${i + 1}`, x: -30, z });
  }

  // ── Paths: green → church, green → main street, green → shore ────────────
  group.add(pathStrip(0, -10, -2, -26, 4));
  group.add(pathStrip(6, 0, 30, 0, 4));
  group.add(pathStrip(-6, 0, -30, 0, 4));
  group.add(pathStrip(0, 12, 6, SHORE_Z, 4));

  // ── Trees: ring around the green + scattered across the grass ────────────
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const t = tree();
    const x = Math.cos(a) * 13, z = Math.sin(a) * 13;
    t.position.set(x, 0, z);
    group.add(t);
    obstacles.push({ x, z, r: 0.9 });
  }
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 22 + Math.random() * 44;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z > SHORE_Z - 4) continue;          // keep trees off the beach
    if (Math.abs(x) > 28 && Math.abs(x) < 40 && z > -20 && z < 30) continue; // keep streets clear
    const t = tree();
    t.position.set(x, 0, z);
    t.scale.setScalar(0.8 + Math.random() * 0.5);
    group.add(t);
    obstacles.push({ x, z, r: 0.8 });
  }

  // Player stays on land: inside the radius and north of the shoreline.
  function clampFn(pos) {
    const r = Math.hypot(pos.x, pos.z);
    if (r > LAND_RADIUS) { pos.x *= LAND_RADIUS / r; pos.z *= LAND_RADIUS / r; }
    if (pos.z > SHORE_Z) pos.z = SHORE_Z;
  }

  return { group, obstacles, anchors, clampFn, water };
}
