import * as THREE from 'three';
import { loadGLB } from './assets.js';
import { normalizeMaterial, bindLibrary, mergeByMaterial, namedParts, instanced, floatGeometry } from './materials.js';
import { createStreamer } from './stream.js';
import { parsePath } from '../routes.js';
import { QA } from './flag.js';

// The diorama town (W1): every building in diorama mode, the town filler, and the harbor set.
//
//   core (blocks the first frame)  the green (bandstand, benches, lamps), the white steepled
//                                  church facing it, 13 clapboard / colonial houses, picket fences,
//                                  fieldstone walls, lampposts along the lane
//   landmark packs (streamed)      one building per career chapter, placed on its classic
//                                  landmark node; the harbor pack (lighthouse, dock, boats)
//
// The classic town is hidden wholesale except the sky dome (clouds and birds live in Town's
// atmosphere, outside world.group). Classic landmark buildings stay visible as placeholders
// until their pack attaches. Signs, beacons, cards, prompts, ‹ › hops and deep links keep
// running through Town: this module only re-seats each landmark node onto its new building.
//
// Units: site units (1.75 per metre). Buildings face +Z in model space (the entrance), so a
// landmark model takes its node's rotation directly.

// ── layout (verified clear of the lane, every landmark's camera corridor, and each other) ──────
const TAU = Math.PI * 2;
const toGreen = (x, z) => Math.atan2(-x, -z);
export const FILLER = [
  // the shore road: four houses between the lane and the Sound, fronts to the green
  { v: 'house_colonial', x: -6, z: 26, face: Math.PI, yard: true },
  { v: 'house_cape', x: -22, z: 23.5, face: Math.PI - 0.2, yard: true },
  { v: 'house_farm', x: -38, z: 19.5, face: Math.PI - 0.45, yard: true },
  { v: 'house_saltbox', x: -53, z: 10, face: Math.PI - 0.9, yard: true },
  // the outer ring beyond the lane: backdrop to the landmarks, all facing into town
  { v: 'house_greek', x: -70, z: -36 }, { v: 'house_saltbox', x: -26, z: -70 }, { v: 'house_colonial', x: 22, z: -68 },
  { v: 'house_cape', x: 77, z: -32 }, { v: 'house_farm', x: -72, z: 8 }, { v: 'house_greek', x: 81, z: 4 },
  { v: 'house_cape', x: -58, z: -62 }, { v: 'house_colonial', x: 52, z: -66 }, { v: 'house_farm', x: -76, z: -12 },
  { v: 'house_saltbox', x: 72, z: -52 },
].map((h) => ({ ...h, face: h.face ?? toGreen(h.x, h.z) }));
export const CHURCH = { x: 12, z: -27, face: toGreen(12, -27) };
const GAZEBO = { x: 0, z: 0, face: Math.PI / 2, s: 0.75 };   // steps face east, clear of the spawn at (0, 6)
const HARBOR = { dock: { x: 12, z: 45.2 }, bench: { x: 21, z: 37.5, face: Math.PI - 0.25 } };
const BOATS = [
  { id: 'sailboat_a', x: -3, z: 73, yaw: 0.9 },       // the daysailer, framed from the harbor view
  { id: 'sailboat_b', x: 27, z: 67, yaw: 2.6 },       // the work skiff
];
const OCEAN_BUOYS = [[5, 62], [19, 80], [-12, 85]];
// Hero features: landmarks whose tower / stack is the point of the building. Their guided hop fits
// the whole silhouette (heroView) instead of capping the roofline at 1.5x the eave (viewFor).
const HERO = new Set(['yale', 'lambda']);
const PACK_OF = { gateway: 'lm_gateway', uconn: 'lm_uconn', lambda: 'lm_lambda', story: 'lm_story', yale: 'lm_yale', catalyst: 'lm_catalyst', veoci_se: 'office_veoci' };

// Library colour variants: tints of the one clapboard / shingle map set (no extra textures).
const SIDING = { M_Siding_Yellow: 0xf0dc98, M_Siding_Blue: 0xa2b6c8, M_Siding_Red: 0x93372a, M_Siding_Grey: 0x4a4e55 };
const SHINGLE = { M_Shingle_Dark: 0x8d8e96 };

const M4 = (x, y, z, yaw, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));
const segDist = (x, z, a, b) => { const vx = b.x - a.x, vz = b.z - a.z; const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz || 1))); return Math.hypot(x - a.x - vx * t, z - a.z - vz * t); };

// Oriented footprint: centre, facing (entrance direction), half-width, front / back extents.
function rect(x, z, face, hw, front, back) { return { x, z, face, hw, front, back }; }
function inRect(r, x, z, pad) {
  const dx = x - r.x, dz = z - r.z;
  const fx = Math.sin(r.face), fz = Math.cos(r.face);
  const along = dx * fx + dz * fz, across = dx * fz - dz * fx;
  return Math.abs(across) < r.hw + pad && along < r.front + pad && along > -r.back - pad;
}
// Circle obstacles covering a rectangle (the player collides with circles only).
function rectObstacles(r) {
  const rad = Math.min(r.hw, (r.front + r.back) / 2) + 0.3;
  const cx = r.x + Math.sin(r.face) * (r.front - r.back) / 2, cz = r.z + Math.cos(r.face) * (r.front - r.back) / 2;
  const span = Math.max(0, r.hw - rad), rx = Math.cos(r.face), rz = -Math.sin(r.face);
  const n = Math.max(1, Math.ceil(span / rad) * 2 + 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : -span + (2 * span * i) / (n - 1);
    out.push({ x: cx + rx * t, z: cz + rz * t, r: rad, dio: true });
  }
  return out;
}
// The fence panel (green.glb) carries its post at x = 0: cut that post (and its cap) out as its own
// geometry, for the closing post at the end of each run. Triangles wholly within |x| < 0.2.
function postParts(parts) {
  const out = [];
  for (const p of parts) {
    const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry;
    const pos = g.attributes.position, keep = [];
    for (let t = 0; t < pos.count; t += 3) {
      let ok = true;
      for (let k = 0; k < 3; k++) if (Math.abs(pos.getX(t + k)) > 0.2) { ok = false; break; }
      if (ok) keep.push(t);
    }
    if (!keep.length) continue;
    const ng = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      const n = attr.itemSize, arr = new Float32Array(keep.length * 3 * n);
      keep.forEach((t, j) => { for (let k = 0; k < 3; k++) for (let c = 0; c < n; c++) arr[(j * 3 + k) * n + c] = attr.getComponent(t + k, c); });
      ng.setAttribute(name, new THREE.BufferAttribute(arr, n));
    }
    out.push({ geometry: ng, material: p.material });
  }
  return out;
}
// model-space bounds -> half width, front (+z) and back extents
function extents(obj) {
  const b = new THREE.Box3().setFromObject(obj);
  return { hw: Math.max(-b.min.x, b.max.x), front: b.max.z, back: -b.min.z, h: b.max.y };
}
// Model-space silhouette points for hero framing: the body box corners up to the main roof, plus the
// highest vertex in each 2.5-unit plan cell above it (the tower, stack, cupola tops).
function silhouette(model, e, roofH) {
  const pts = [];
  for (const x of [-e.hw, e.hw]) for (const z of [-e.back, e.front]) for (const y of [0, roofH]) pts.push([x, y, z]);
  const cells = new Map(), v = new THREE.Vector3();
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.y <= roofH) continue;
      const k = Math.floor(v.x / 2.5) + ',' + Math.floor(v.z / 2.5), c = cells.get(k);
      if (!c || v.y > c[1]) cells.set(k, [v.x, v.y, v.z]);
    }
  });
  return pts.concat([...cells.values()]);
}
// Camera collider: a footprint rect raised into an oriented box (base y0, height h) for the follow
// camera's collision cast (Town._collideCamera). rad is the broad-phase radius round the centre.
function camBox(r, y0, h) {
  return { x: r.x, z: r.z, face: r.face, hw: r.hw, front: r.front, back: r.back, y0: y0 - 0.5, y1: y0 + h, rad: Math.hypot(r.hw, Math.max(r.front, r.back)) };
}

export function createTownBuild({ town, scene, loaders, manifest, tier, lite, lib, heightAt, WATER_Y, POINT, waveAt, foamRing, rng }) {
  const world = town.world;
  const lms = town.landmarks;
  const L = (id) => loadGLB(loaders, manifest, id, tier);
  const assetMeta = Object.fromEntries(manifest.assets.map((a) => [a.id, a.meta || {}]));
  const idx = (id) => lms.interactables.findIndex((it) => it.id === id);
  const nodeOf = (id) => lms.group.children[idx(id)];
  const footprints = [];          // rects, for blocked()
  const posts = [];               // small round things (lamps, benches) for blocked()
  const camColliders = town.camColliders || (town.camColliders = []);   // buildings only: no trees, fences, lamps
  const kick = () => town._kick?.();

  // ── the classic town goes, except the sky dome ────────────────────────────
  // The scene is already committed (index.js sets town._dioCommitted before its first mutation):
  // a failure from here on reloads into the classic town (flag.js).
  world.path.mesh.visible = false;
  town.water.mesh.visible = false;
  for (const o of world.group.children) if (o.renderOrder !== -1) o.visible = false;
  for (const t of world.trees) t.visible = false;
  for (const b of world.boats) b.visible = false;
  const lmBlobs = lms.group.children[lms.group.children.length - 1];
  if (lmBlobs && !lmBlobs.isGroup) lmBlobs.visible = false;          // classic contact-shadow field
  const lmSpot = new Set(lms.interactables.map((it) => `${it.x},${it.z}`));
  for (let i = world.obstacles.length - 1; i >= 0; i--) {
    const ob = world.obstacles[i];
    if (!lmSpot.has(`${ob.x},${ob.z}`)) world.obstacles.splice(i, 1);  // trees, lamps, benches, gazebo, church, lighthouse
  }
  // Signs are depth-less transparent boards in the classic town; the depth-aware DOF would blur
  // them as if they were the background behind them. Give them depth (cut on alpha).
  lms.group.traverse((o) => {
    if (o.isMesh && o.renderOrder === 3 && o.material?.map) { o.material.depthWrite = true; o.material.alphaTest = 0.5; o.material.needsUpdate = true; }
  });

  // ── library colour variants + lamp glow ───────────────────────────────────
  const variant = (base, name, hex) => {
    if (!lib[base] || lib[name]) return;
    const m = lib[base].clone(); m.name = name;
    m.color.setHex(hex);
    lib[name] = m;
  };
  for (const [n, c] of Object.entries(SIDING)) variant('M_Siding', n, c);
  for (const [n, c] of Object.entries(SHINGLE)) variant('M_Shingle', n, c);
  lib.M_LampGlow = new THREE.MeshStandardMaterial({ name: 'M_LampGlow', color: 0xffe6b8, emissive: 0xffc070, emissiveIntensity: lite ? 1.6 : 2.6, roughness: 0.4 });

  // ── landmark footprints known up front (from pack metadata), so the scatter avoids them ──
  for (const [id, asset] of Object.entries(PACK_OF)) {
    const it = lms.interactables[idx(id)];
    const node = nodeOf(id);
    const m = Object.values(assetMeta[asset] || {})[0];
    const w = m?.w ?? 15, d = m?.d ?? 11.5;
    it._rect = rect(it.x, it.z, node.rotation.y, w / 2, d / 2 + 1, d / 2);
    footprints.push(it._rect);
  }

  // ── placement helpers ─────────────────────────────────────────────────────
  function placeStatic(obj, x, z, face, y = heightAt(x, z)) {
    const g = new THREE.Group(); g.add(obj);
    g.position.set(x, y, z); g.rotation.y = face;
    return g;
  }
  const obstacles = (arr) => { for (const o of arr) world.obstacles.push(o); };

  // ── core: the green, the church, the houses, street furniture ────────────
  async function buildCore(pre = {}) {
    const [green, houses] = await Promise.all([pre.green || L('green'), pre.houses || L('houses')]);
    bindLibrary(green.scene, lib); bindLibrary(houses.scene, lib);
    const G = Object.fromEntries(green.scene.children.map((n) => [n.name.toLowerCase(), n]));
    const H = Object.fromEntries(houses.scene.children.map((n) => [n.name, n]));
    const statics = [];
    // church facing the green, bandstand in its middle
    {
      const e = extents(G.church);
      statics.push(placeStatic(G.church.clone(), CHURCH.x, CHURCH.z, CHURCH.face));
      const r = rect(CHURCH.x, CHURCH.z, CHURCH.face, e.hw, e.front, e.back);
      footprints.push(r); obstacles(rectObstacles(r));
      // nave to the ridge (the bbox runs up the steeple, which would box in the whole footprint)
      // (top: the steeple's height, for hero framing's foreground test)
      camColliders.push(Object.assign(camBox(r, heightAt(CHURCH.x, CHURCH.z), Math.min(e.h, assetMeta.green?.church?.ridge ?? e.h)), { top: heightAt(CHURCH.x, CHURCH.z) + e.h }));
    }
    {
      const e = extents(G.gazebo), k = GAZEBO.s;
      const gz = placeStatic(G.gazebo.clone(), GAZEBO.x, GAZEBO.z, GAZEBO.face); gz.scale.setScalar(k);
      statics.push(gz);
      footprints.push(rect(0, 0, GAZEBO.face, e.hw * k, (e.front + 1.2) * k, e.back * k));
      world.obstacles.push({ x: 0, z: 0, r: e.hw * k * 0.95, dio: true });
      // The Green's beacon hung inside the bandstand roof: move it out over the entrance steps.
      // Its doormat ring would sit under the bandstand, and the spawn is on the prompt anyway: off.
      const intro = lms.interactables[idx('intro')];
      if (intro) {
        const out = (e.front + 1.6) * k;
        seatBeacon(intro.beacon, GAZEBO.x + Math.sin(GAZEBO.face) * out, heightAt(GAZEBO.x, GAZEBO.z) + e.h * k + 2.2, GAZEBO.z + Math.cos(GAZEBO.face) * out);
        const ring = intro.beacon.userData.markerRing; if (ring) ring.visible = false;
        intro.beacon.userData.markerRing = null;
      }
    }
    const yards = [];
    for (const h of FILLER) {
      const src = H[h.v]; if (!src) continue;
      const e = extents(src);
      statics.push(placeStatic(src.clone(), h.x, h.z, h.face));
      const r = rect(h.x, h.z, h.face, e.hw, e.front, e.back);
      footprints.push(r); obstacles(rectObstacles(r));
      camColliders.push(camBox(r, heightAt(h.x, h.z), e.h));
      if (h.yard) yards.push({ h, e });
    }
    // The green's hop (Town.gotoLandmark) looks at the bandstand from the spawn, which put the follow
    // camera inside the shore-road colonial behind it, and camera collision then pulled the view in
    // tight. Swing the hop's camera to the nearest yaw with a clear line at the default distance.
    {
      const intro = lms.interactables[idx('intro')];
      if (intro && town._castCamera) {
        const ax = intro.approach.x, az = intro.approach.z, py = heightAt(ax, az), heading = Math.atan2(intro.x - ax, intro.z - az);
        const pitch = town.camPitchDefault ?? 0.48, d = town.camDistDefault ?? 25, horiz = Math.cos(pitch) * d, vert = Math.sin(pitch) * d + 2 - 2.4;
        for (let i = 0; i <= 16; i++) {
          const yaw = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.1;
          if (town._castCamera(ax, py + 2.4, az, -Math.sin(heading + yaw) * horiz, vert, -Math.cos(heading + yaw) * horiz, 2.2) < 1) continue;
          intro.viewDist = d; intro.viewLift = 0; intro.viewYaw = yaw;
          break;
        }
      }
    }
    const merged = mergeByMaterial(statics);
    merged.name = 'dio-town-core';
    scene.add(merged);

    // instanced street furniture
    const gp = namedParts(green.scene);
    for (const parts of Object.values(gp)) for (const p of parts) p.material = lib[p.material.name?.replace(/\.\d+$/, '')] || p.material;
    const fenceM = [], postM = [], wallM = [], lampM = [];
    // Picket fences on the lot lines of each shore-road yard: one straight run across the front
    // with a gate at the front walk, and a return down each side to the house. Panels follow the
    // ground (sheared, so pickets stay plumb), every panel starts on its own post, and each run
    // ends on a closing post. Built in world space from each lot's corners.
    const FENCE = (assetMeta.green?.fence?.w) || 4.2;
    const GATE = 1.35;                                            // half-width of the gate opening
    const hv = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0), qd = new THREE.Quaternion();
    const toWorld = (h, lx, lz) => { const c = Math.cos(h.face), sn = Math.sin(h.face); return { x: h.x + lx * c + lz * sn, z: h.z - lx * sn + lz * c }; };
    const panelM = (ax, az, bx, bz, stretch = 1) => {
      const len = Math.hypot(bx - ax, bz - az), ya = heightAt(ax, az) - 0.06, yb = heightAt(bx, bz) - 0.06;
      const shear = new THREE.Matrix4().set(len / FENCE * stretch, 0, 0, 0, (yb - ya) / FENCE, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
      qd.setFromAxisAngle(yAxis, Math.atan2(-(bz - az), bx - ax));
      return new THREE.Matrix4().compose(hv.set(ax, ya, az), qd, new THREE.Vector3(1, 1, 1)).multiply(shear);
    };
    const postAt = (x, z, yaw = 0) => postM.push(M4(x, heightAt(x, z) - 0.06, z, yaw));
    const run = (pts) => {                                        // pts: world polyline, first point is a post
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k], b = pts[k + 1];
        const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / FENCE));
        for (let i = 0; i < n; i++) {
          const p0 = { x: a.x + (b.x - a.x) * i / n, z: a.z + (b.z - a.z) * i / n };
          const p1 = { x: a.x + (b.x - a.x) * (i + 1) / n, z: a.z + (b.z - a.z) * (i + 1) / n };
          fenceM.push(panelM(p0.x, p0.z, p1.x, p1.z));
        }
      }
      const e = pts[pts.length - 1]; postAt(e.x, e.z);
    };
    // The shore-road yards are ~2 units apart, so each lot's own fence would cross its neighbour's.
    // Instead one straight-run street fence follows the row: a vertex at each house's front walk
    // (so it bends gently with the shore road), a gate at every walk, and a return to the house at
    // both ends of the row. FILLER lists the yards in row order (local +x points to the next).
    const lot = yards.map(({ h, e }) => {
      const zf = e.front + 3.2, xw = e.hw + 0.3;
      const W = (lx, lz) => toWorld(h, lx, lz);
      footprints.push(rect(h.x, h.z, h.face, e.hw + 0.8, zf + 0.4, -0.5 + 0.4));
      return { h, W, zf, xw, walk: W(0, zf) };
    });
    if (lot.length) {
      const first = lot[0], last = lot[lot.length - 1];
      const line = [first.W(-first.xw, first.zf), ...lot.map((l) => l.walk), last.W(last.xw, last.zf)];
      const dir = (a, b) => { const l = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: (b.x - a.x) / l, z: (b.z - a.z) / l }; };
      let cur = [first.W(-first.xw, 0.5), line[0]];
      lot.forEach((l, i) => {
        const k = i + 1, a = dir(line[k - 1], line[k]), b = dir(line[k], line[k + 1]);
        const gl = { x: l.walk.x - a.x * GATE, z: l.walk.z - a.z * GATE }, gr = { x: l.walk.x + b.x * GATE, z: l.walk.z + b.z * GATE };
        cur.push(gl); run(cur);
        cur = [gr];
        // the gate: hinged on the far gate post, standing open into the yard (toward the house)
        const into = { x: l.h.x - l.walk.x, z: l.h.z - l.walk.z }, il = Math.hypot(into.x, into.z) || 1, sw = 1.15, len = 2 * GATE * 0.94;
        const bx = -b.x * Math.cos(sw) + (into.x / il) * Math.sin(sw), bz = -b.z * Math.cos(sw) + (into.z / il) * Math.sin(sw);
        fenceM.push(panelM(gr.x, gr.z, gr.x + bx * len, gr.z + bz * len));
      });
      cur.push(line[line.length - 1], last.W(last.xw, 0.5)); run(cur);
    }
    // fieldstone walls: a broken ring of field edges beyond the lane
    const WALL = (assetMeta.green?.stonewall?.w) || 5.25;
    const ringR = 67;
    for (let a = -Math.PI; a < Math.PI; a += WALL / ringR * 1.02) {
      const x = Math.cos(a) * ringR, z = Math.sin(a) * ringR;
      if (z > 30) continue;                                              // the shore
      if (Math.sin(a * 3.1) > 0.55) continue;                            // gaps: field gates
      if (footprints.some((r) => inRect(r, x, z, 3))) continue;
      wallM.push(M4(x, heightAt(x, z), z, -(a + Math.PI / 2)));
    }
    if (lite) wallM.splice(0, wallM.length, ...wallM.filter((_, i) => i % 2 === 0));
    // lampposts: along the lane (alternate sides) and round the green
    const path = world.path;
    // doorsteps: the strip from each landmark's facade out past its landing spot stays clear
    const doorsteps = lms.interactables.filter((it) => it._rect).map((it) => rect(it.x, it.z, it._rect.face, Math.min(it._rect.hw, 6), it._rect.front + 11, 0));
    const lamp = (x, z) => {
      if (footprints.some((r) => inRect(r, x, z, 1.2))) return;
      if (doorsteps.some((r) => inRect(r, x, z, 1.5))) return;
      if (posts.some((p) => Math.hypot(p.x - x, p.z - z) < 8)) return;
      lampM.push(M4(x, heightAt(x, z), z, 0)); posts.push({ x, z, r: 0.6 });
      world.obstacles.push({ x, z, r: 0.35, dio: true });
    };
    const N = lite ? 14 : 20;
    for (let i = 1; i < N; i++) { const p = path.besideAt(i / N, (i % 2 ? 1 : -1) * 4.3); lamp(p.x, p.z); }
    for (let k = 0; k < 4; k++) { const a = TAU * k / 4 + Math.PI / 4; lamp(Math.cos(a) * 13.5, Math.sin(a) * 13.5); }
    if (gp.fence && fenceM.length) {
      scene.add(instanced(gp.fence, fenceM));
      const post = postParts(gp.fence);
      if (post.length && postM.length) scene.add(instanced(post, postM));
    }
    if (gp.stonewall && wallM.length) scene.add(instanced(gp.stonewall, wallM));
    if (gp.lamppost && lampM.length) scene.add(instanced(gp.lamppost, lampM, { castShadow: !lite }));
    return { fences: fenceM.length, fencePosts: postM.length, walls: wallM.length, lamps: lampM.length };
  }

  // benches on the green (+ the harbor bench) come from props.glb, recoloured park green
  function placeBenches(pp) {
    if (!pp.bench) return;
    const list = [];
    for (let k = 0; k < 4; k++) {
      const a = TAU * k / 4 + Math.PI / 4 + 0.35, r = 9.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (world.path.nearPath(x, z, 4)) continue;
      list.push(M4(x, heightAt(x, z), z, Math.atan2(-x, -z)));
      world.obstacles.push({ x, z, r: 1.2, dio: true }); posts.push({ x, z, r: 1.6 });
    }
    const b = HARBOR.bench;
    list.push(M4(b.x, heightAt(b.x, b.z), b.z, b.face)); world.obstacles.push({ x: b.x, z: b.z, r: 1.3, dio: true }); posts.push({ x: b.x, z: b.z, r: 1.8 });
    scene.add(instanced(pp.bench, list));
  }

  // ── landmark packs ────────────────────────────────────────────────────────
  // Re-seat a landmark node (sign, beacon, marker, collision, approach) onto its new building.
  function reseat(id, e, meta, pts) {
    const it = lms.interactables[idx(id)];
    const node = nodeOf(id);
    const y = heightAt(it.x, it.z);
    node.position.y = y;
    // Sign over the entrance, below the eave, a little proud of the facade: readable in the
    // default follow-cam frame however tall the building (the Veoci sign used to sit above it).
    // capped at 7.5: higher boards collide with the HUD on a 375 px phone at the default pitch
    const signY = Math.min(meta.signY ?? THREE.MathUtils.clamp(e.h * 0.55, 5.5, 9), 7.5);
    const sign = node.children.find((c) => c.isGroup && c.children[0]?.renderOrder === 3);
    if (sign) { sign.children[0].position.y = signY; sign.position.z = e.front + 1.2; }
    // Beacon: over the entrance, just above the sign board (6.2 x 2.1, centred on signY), proud
    // of the facade like the sign, so it never sits in or on a roof however the roof is shaped.
    seatBeacon(it.beacon, 0, signY + 2.75, e.front + 1.2);
    // collision: circles along the footprint; the node's own obstacle becomes the middle one
    const r = rect(it.x, it.z, node.rotation.y, e.hw, e.front, e.back);
    it._rect = r;
    const fi = footprints.findIndex((f) => f === it._rectPre); if (fi >= 0) footprints.splice(fi, 1);
    footprints.push(r);
    // camera box to the main roof (the tower / stack / cupola at the bbox top is too thin to box the
    // whole footprint in). The bbox front runs out over the steps and portico into the lane, so the box
    // stops short of that stoop strip: a box over it (even one raised over the visitor's head) catches
    // every rising camera cast while the visitor walks the lane along the facade.
    const roofH = Math.min(e.h, (meta.h ?? e.h) * 1.4), stoop = Math.min(5, e.front * 0.4);
    camColliders.push(Object.assign(camBox(rect(it.x, it.z, r.face, e.hw, e.front - stoop, e.back), y, roofH), { lm: id }));
    const circles = rectObstacles(r);
    const ob = world.obstacles.find((o) => o.x === it.x && o.z === it.z && !o.dio);
    if (ob) ob.r = 0.01;                                                               // superseded by the circles below
    obstacles(circles);
    it.collide = Math.min(e.front, e.hw) + 0.4;
    it.interact = e.front + 11;
    // approach: straight out from the entrance, clear of porticos and steps
    // far enough out that the default follow camera frames the whole facade and its roofline
    const want = e.front + 7.5;
    const dx = Math.sin(node.rotation.y), dz = Math.cos(node.rotation.y);
    const old = { x: it.approach.x, z: it.approach.z };
    if (id !== 'contact') { it.approach.x = it.x + dx * want; it.approach.z = it.z + dz * want; }
    // the guided hop's framing (Town.gotoLandmark): the whole building reads at the default pitch. A
    // hero view may also slide the landing spot along the facade (v.shift, along the node's +x).
    const v = HERO.has(id) && pts ? heroView(it, node, pts, () => viewFor(e, meta, want)) : viewFor(e, meta, want);
    it.viewDist = v.dist; it.viewLift = v.lift; it.viewYaw = v.yaw || 0; it.viewPitch = v.pitch; it._view = v;   // _view: QA
    const shift = v.shift || 0;
    if (shift) { it.approach.x += dz * shift; it.approach.z -= dx * shift; }
    // a visitor who hopped here before the pack arrived stands on the old (placeholder) spot,
    // which may now be inside the building: move them to the new doorstep, camera and all
    const p = town.player.position;
    if (Math.hypot(p.x - old.x, p.z - old.z) < 1.0 && (old.x !== it.approach.x || old.z !== it.approach.z)) {
      p.x = it.approach.x; p.z = it.approach.z; p.y = heightAt(p.x, p.z);
      town.player.moveTarget = null; town.player.velocity.set(0, 0, 0);
      // and give them the new building's hop framing (Town.gotoLandmark)
      const heading = Math.atan2(it.x - p.x, it.z - p.z);
      town.player.heading = heading; town.player.group.rotation.y = heading;
      town.camPitch = it.viewPitch ?? town.camPitchDefault; town.camDist = it.viewDist; town.camYaw = heading + it.viewYaw;
      town._lift = it.viewLift || 0; town._liftHold = true;
      town._updateCamera?.(1, true);
    }
    // marker: a doormat ring where the ‹ › hop lands the visitor, not a moat round the building
    const ring = it.beacon.userData.markerRing;
    if (ring) {
      ring.geometry.dispose(); ring.geometry = new THREE.RingGeometry(1.7, 2.2, 48);
      ring.position.set(shift, 0.08, want);
      it._ringAt = { x: it.approach.x, z: it.approach.z };
    }
  }

  // Hero hop framing: search follow distance, a small yaw off the facade axis and a slightly lower
  // pitch for the nearest view
  // that fits the whole silhouette (towers and stacks included) between the visitor's feet (held just
  // above the prompt pill, like viewFor) and the top HUD, edge to edge on desktop (on a portrait phone
  // most of the width), with the camera's line to the visitor clear of every building box, so the
  // follow-cam collision never pulls the hop in. Points are projected through a copy of the real
  // camera, so it is exact for the current aspect. Other buildings standing in front of the hero (the
  // church from the Lambda doorstep) cost their share of the frame. No fit: the least overflow.
  function heroView(it, node, pts, fallback) {
    const t0 = performance.now();
    const cam = town.camera.clone();
    const c = Math.cos(node.rotation.y), sn = Math.sin(node.rotation.y);
    const gy = heightAt(it.x, it.z);
    const world = pts.map(([x, y, z]) => new THREE.Vector3(it.x + x * c + z * sn, gy + y, it.z - x * sn + z * c));
    const pitch0 = town.camPitchDefault ?? 0.48;
    const [dMin, dMax] = town._camRange || [12, 48];
    const FEET = -0.64, TOP = 0.86, SIDE = town.mobile ? 1.0 : 0.94, BODY = town.mobile ? 1.3 : 0.94;
    const feet = new THREE.Vector3(), q = new THREE.Vector3(), look = new THREE.Vector3();
    let ax = 0, az = 0, py = 0;
    const cast = (dx, dy, dz) => (town._castCamera ? town._castCamera(ax, py + 2.4, az, dx, dy, dz, 2.2) : 1);
    // the core buildings, plus every other landmark from its pack metadata (loaded or not: the framing
    // must not depend on the streaming order)
    const lmBoxes = Object.entries(PACK_OF).filter(([lid]) => lid !== it.id).map(([lid, asset]) => {
      const o = lms.interactables[idx(lid)], m = Object.values(assetMeta[asset] || {})[0] || {};
      return o?._rect && camBox(o._rect, heightAt(o.x, o.z), Math.min(m.top ?? 12, (m.h ?? 12) * 1.4));
    }).filter(Boolean);
    const others = camColliders.filter((b) => !b.lm).concat(lmBoxes).map((b) => {
      const fx = Math.sin(b.face), fz = Math.cos(b.face), corners = [];
      for (const a of [-b.hw, b.hw]) for (const l of [-b.back, b.front]) for (const y of [b.y0, b.top ?? b.y1]) corners.push(new THREE.Vector3(b.x + a * fz + l * fx, y, b.z - a * fx + l * fz));
      return { b, corners };
    });
    const centre = new THREE.Vector3(it.x, gy, it.z);
    // Buildings nearer the camera than the hero: the share of the hero's own screen box they cover
    // (a neighbour beside the hero is fine; one cutting across it is not), plus a little for the frame.
    const hb = [0, 0, 0, 0];
    const intrusion = () => {
      const ha = Math.max(1e-3, (Math.min(1, hb[1]) - Math.max(-1, hb[0])) * (Math.min(1, hb[3]) - Math.max(-1, hb[2])));
      const far = cam.position.distanceTo(centre);
      let sum = 0;
      for (const { b, corners } of others) {
        if (Math.hypot(b.x - cam.position.x, b.z - cam.position.z) > far) continue;
        let x0 = 1, x1 = -1, y0 = 1, y1 = -1, any = false;
        for (const p of corners) {
          q.copy(p).project(cam);
          if (q.z > 1 || q.z < -1) continue;                       // behind the camera: off frame
          x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); any = true;
        }
        if (!any) continue;
        const w = Math.max(0, Math.min(1, x1) - Math.max(-1, x0)), h = Math.max(0, Math.min(1, y1) - Math.max(-1, y0));
        const ow = Math.max(0, Math.min(x1, hb[1], 1) - Math.max(x0, hb[0], -1)), oh = Math.max(0, Math.min(y1, hb[3], 1) - Math.max(y0, hb[2], -1));
        sum += (ow * oh) / ha + 0.8 * (w * h) / 4;
      }
      return sum;
    };
    let best = null;
    const maxShift = Math.min(9, Math.max(0, pts[7]?.[0] ?? 0) * 0.7);     // stay in front of the facade
    for (const shift of [0, -3, 3, -6, 6, -9, 9]) {
      if (Math.abs(shift) > maxShift + 1e-6) continue;
      ax = it.approach.x + c * shift; az = it.approach.z - sn * shift; py = heightAt(ax, az);
      feet.set(ax, py, az);
      const heading = Math.atan2(it.x - ax, it.z - az);
    for (const pitch of [pitch0, pitch0 - 0.07, pitch0 - 0.14, pitch0 - 0.21]) for (let yi = 0; yi <= 20; yi++) {
      const yaw = (yi % 2 ? 1 : -1) * Math.ceil(yi / 2) * 0.1;
      for (let d = Math.max(dMin, town.camDistDefault ?? 24); d <= dMax + 1e-6; d += 1) {
        const base = d + Math.abs(yaw) * 14 + (pitch0 - pitch) * 60 + Math.abs(shift) * 1.5;
        if (best && best.cost < base) break;                              // only gets dearer with distance
        const horiz = Math.cos(pitch) * d, vert = Math.sin(pitch) * d;
        cam.position.set(ax - Math.sin(heading + yaw) * horiz, py + vert + 2, az - Math.cos(heading + yaw) * horiz);
        if (cast(cam.position.x - ax, cam.position.y - py - 2.4, cam.position.z - az) < 1) continue;   // a building in the way
        // look lift that holds the feet at FEET (feet sink down the frame as the look rises)
        let lo = -10, hi = 40, lift = 0;
        for (let k = 0; k < 16; k++) {
          lift = (lo + hi) / 2;
          cam.lookAt(look.set(ax, py + 2.4 + lift, az)); cam.updateMatrixWorld();
          if (q.copy(feet).project(cam).y > FEET) lo = lift; else hi = lift;
        }
        let over = 0;
        hb[0] = hb[2] = 9; hb[1] = hb[3] = -9;
        world.forEach((w, i) => {
          q.copy(w).project(cam);
          hb[0] = Math.min(hb[0], q.x); hb[1] = Math.max(hb[1], q.x); hb[2] = Math.min(hb[2], q.y); hb[3] = Math.max(hb[3], q.y);
          if (q.z > 1) { over += 9; return; }
          over += Math.max(0, q.y - TOP) + Math.max(0, Math.abs(q.x) - (i < 8 ? BODY : SIDE));
        });
        if (best && over > 0 && best.cost < 1000 + over * 100 + base) continue;
        const intr = intrusion();
        const cost = (over > 0 ? 1000 + over * 100 : 0) + intr * 500 + base;
        if (!best || cost < best.cost) best = { cost, dist: d, lift: +lift.toFixed(2), yaw, pitch: +pitch.toFixed(2), shift, over: +over.toFixed(3), intr: +intr.toFixed(3) };
      }
    }
    }
    if (best) best.ms = +(performance.now() - t0).toFixed(1);
    return best || fallback();
  }

  // Hop framing for a building seen from its landing spot (`want` units out from its centre): the
  // follow distance and a look lift (Town._lift) that together fit the visitor's feet and the whole
  // building (facade eave, and the ridge / cupola / tower top, capped at 1.5x the eave) inside the
  // frame, clear of the HUD: the prompt pill and arrows at the bottom, the brand and buttons on top.
  // Phones (portrait) also widen out until most of the facade's width reads.
  function viewFor(e, meta, want) {
    const pitch = town.camPitchDefault ?? 0.48, fov = THREE.MathUtils.degToRad(town.camera.fov);
    const half = fov / 2, below = half * 0.66, above = half * 0.84;
    const hHalf = Math.atan(Math.tan(half) * Math.max(0.3, town.camera.aspect));
    const eave = Math.min(meta.h ?? e.h, e.h), roof = Math.min(meta.top ?? e.h, eave * 1.5);   // e.h is the bbox: towers, stacks
    const [dMin, dMax] = town._camRange || [12, 48];
    const wFit = town.mobile ? 0.72 : 1.0;                          // share of the facade width to fit
    for (let d = Math.max(dMin, town.camDistDefault ?? 24); d <= dMax; d += 0.5) {
      const horiz = Math.cos(pitch) * d, cy = Math.sin(pitch) * d + 2;
      const feet = Math.atan2(-cy, horiz);
      const top = Math.max(Math.atan2(eave - cy, want - e.front + horiz), Math.atan2(roof - cy, want + horiz));
      const look = feet + below;
      const wide = Math.atan2(e.hw * wFit, want - e.front + horiz) < hHalf * 0.94;
      if (top <= look + above && wide) return { dist: d, lift: +(cy + Math.tan(look) * horiz - 2.4).toFixed(2) };
    }
    const horiz = Math.cos(pitch) * dMax, cy = Math.sin(pitch) * dMax + 2;
    return { dist: dMax, lift: +(cy + Math.tan(Math.atan2(-cy, horiz) + below) * horiz - 2.4).toFixed(2) };
  }

  // Beacon placement. The classic shaft (a 5-unit light column under the orb) would run down
  // through the sign board, so it is shortened to a short glow stub.
  function seatBeacon(b, x, y, z) {
    b.position.set(x, y, z);
    const shaft = b.children.find((c) => c.geometry?.type === 'CylinderGeometry');
    if (shaft) { shaft.scale.set(0.7, 0.26, 0.7); shaft.position.y = -0.95; }
  }

  let masonry = null;
  async function ensureMasonry() {
    if (!masonry) masonry = L('masonry-matlib').then((g) => {
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const m = normalizeMaterial(o.material);
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) { m[k].wrapS = m[k].wrapT = THREE.RepeatWrapping; m[k].anisotropy = 8; m[k].needsUpdate = true; }
        if (lite) { m.normalMap = null; m.needsUpdate = true; }
        lib[m.name] = m;
      });
    });
    return masonry;
  }

  const harbor = { boats: [], buoys: null };
  async function loadPack(id) {
    const deps = manifest.packs?.[id]?.deps || [];
    if (deps.includes('masonry')) await ensureMasonry();
    if (id === 'contact') return loadHarbor();
    const asset = PACK_OF[id];
    const gltf = await L(asset);
    bindLibrary(gltf.scene, lib);
    const it = lms.interactables[idx(id)];
    const node = nodeOf(id);
    const model = gltf.scene.children.length === 1 ? gltf.scene.children[0] : gltf.scene;
    const meta = Object.values(assetMeta[asset] || {})[0] || {};
    it._rectPre = it._rect;
    const e = extents(model);                            // model space, before placement
    const pts = HERO.has(id) ? silhouette(model, e, Math.min(e.h, (meta.h ?? e.h) * 1.4)) : null;
    const placed = placeStatic(model, it.x, it.z, node.rotation.y);
    const merged = mergeByMaterial([placed]);
    merged.name = 'dio-lm-' + id;
    scene.add(merged);
    swapIn(node, merged, e);
    reseat(id, e, meta, pts);
    kick();
  }

  // Placeholder -> building. Off screen, behind a card, or under reduced motion: an instant swap.
  // On screen: the classic building sinks away while the new one rises into place (0.55 s), so a
  // streamed landmark settles in rather than popping.
  const swaps = [];
  // Lite re-renders its shadow map only when the visitor moves (shadows.js): a building that
  // streams in (or finishes rising) under a standing visitor needs one forced update to cast.
  const refreshShadows = () => { town.renderer.shadowMap.needsUpdate = true; };
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere();
  function swapIn(node, merged, e) {
    const olds = node.children.filter((c) => c.userData?.size || (c.isMesh && c.geometry?.type === 'BoxGeometry'));
    const cam = town.camera;
    cam.updateMatrixWorld(); pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(pv);
    sph.set(new THREE.Vector3(node.position.x, heightAt(node.position.x, node.position.z) + e.h / 2, node.position.z), Math.max(e.hw, e.front, e.h / 2) * 1.2);
    const visible = frustum.intersectsSphere(sph) && cam.position.distanceTo(sph.center) < 140;
    if (!visible || town._holds?.size || town.reducedMotion || !town.running) { for (const o of olds) o.visible = false; refreshShadows(); return; }
    const drop = e.h + 1;
    merged.position.y = -drop;
    swaps.push({ merged, olds: olds.map((o) => [o, o.position.y]), drop, t: 0 });
  }
  function stepSwaps(dt) {
    for (let i = swaps.length - 1; i >= 0; i--) {
      const s = swaps[i];
      s.t += dt;
      const k = Math.min(1, s.t / 0.55), rise = 1 - Math.pow(1 - k, 3);          // ease-out
      s.merged.position.y = -s.drop * (1 - rise);
      const kOld = Math.min(1, s.t / 0.35);
      for (const [o, y0] of s.olds) { o.position.y = y0 - s.drop * kOld * kOld; if (kOld >= 1) { o.visible = false; o.position.y = y0; } }
      if (k >= 1) { s.merged.position.y = 0; swaps.splice(i, 1); refreshShadows(); }
    }
    // a card or the reading view parked the loop mid-swap: finish it so the still frame is whole
    if (swaps.length && town._holds?.size) { for (const s of swaps) s.t = 1; stepSwaps(0); }
  }

  async function loadHarbor() {
    const [lighthouse, dock, boatA, boatB] = await Promise.all([L('lighthouse'), L('dock'), L('sailboat_a'), L('sailboat_b')]);
    for (const g of [lighthouse, dock, boatA, boatB]) bindLibrary(g.scene, lib);
    // lighthouse on the rocky point: a harbor light, not a sea-coast tower (keeps it in frame)
    lighthouse.scene.scale.setScalar(0.62);
    const statics = [placeStatic(lighthouse.scene, POINT.x, POINT.z, 0, heightAt(POINT.x, POINT.z) - 0.3),
                     placeStatic(dock.scene, HARBOR.dock.x, HARBOR.dock.z, 0, WATER_Y + 1.05)];
    const merged = mergeByMaterial(statics); merged.name = 'dio-lm-contact';
    scene.add(merged);
    world.obstacles.push({ x: POINT.x, z: POINT.z, r: 3.2, dio: true });
    // the harbor signpost: the classic post, in weathered wood
    const cnode = nodeOf('contact');
    cnode.position.y = heightAt(cnode.position.x, cnode.position.z) - 0.1;
    const wood = new THREE.MeshStandardMaterial({ color: 0x7d705f, roughness: 0.92 });
    for (const c of cnode.children) if (c.isMesh && c.geometry.type === 'BoxGeometry') { c.material = wood; c.castShadow = true; }
    // boats float on the shared swell, each with a foam ring
    for (const [b, gl] of [[BOATS[0], boatA], [BOATS[1], boatB]]) {
      gl.scene.traverse((o) => { if (o.isMesh) { o.geometry = floatGeometry(o.geometry); o.castShadow = true; o.receiveShadow = true; } });
      const root = new THREE.Group(); root.add(gl.scene);
      root.position.set(b.x, 0, b.z);
      const ring = foamRing(14, 5.5); ring.rotation.y = b.yaw; ring.position.set(b.x, 0.03, b.z);
      scene.add(root, ring);
      harbor.boats.push({ ...b, root, ring, ph: rng() * 6 });
    }
    refreshShadows();
    kick();
  }

  // ── streaming ─────────────────────────────────────────────────────────────
  const routeOrder = manifest.routeOrder || Object.keys(PACK_OF).concat('contact');
  const streamer = createStreamer({
    routeOrder,
    load: loadPack,
    // Town's nav index counts the intro (the green) as 0, and LANDMARKS are in route order
    currentIndex: () => (town._navIndex ?? 0) - 1,
  });
  // a hop (‹ › or deep link) pulls its pack to the front of the queue
  const hop = town.gotoLandmark.bind(town);
  town.gotoLandmark = (delta) => {
    const n = lms.interactables.length;
    const next = (((town._navIndex ?? 0) + delta) % n + n) % n;
    const id = lms.interactables[next]?.id;
    if (id && streamer.state.has(id)) streamer.request(id);
    hop(delta);
    streamer.poke();
  };
  let lastNav = town._navIndex;
  const route = parsePath(location.pathname);
  const deepLink = route.type === 'landmark' && streamer.state.has(route.id) ? route.id : null;

  // ── per-frame: bob the harbor ─────────────────────────────────────────────
  const tmpQ = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4(), qYaw = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(1.1, 1.1, 1.1);
  // Doormat rings: full strength within ~14 units of the visitor, gone beyond ~26 (from across the
  // green they were clutter). landmarks.update() writes the pulsing opacity first each frame; this
  // scales it, so the pulse stays.
  const pl = town.player.position;
  function fadeRings() {
    for (const it of lms.interactables) {
      const ring = it.beacon?.userData.markerRing, at = it._ringAt;
      if (!ring || !at) continue;
      const f = 1 - THREE.MathUtils.smoothstep(Math.hypot(pl.x - at.x, pl.z - at.z), 14, 26);
      ring.material.opacity *= f;
      ring.visible = f > 0.01;
    }
  }

  function update(dt, t) {
    if (town._navIndex !== lastNav) { lastNav = town._navIndex; streamer.poke(); }
    fadeRings();
    if (swaps.length) stepSwaps(dt);
    for (const b of harbor.boats) {
      const w = waveAt(b.x, b.z, t);
      b.root.position.y = w.y;
      tmpQ.setFromUnitVectors(up, w.normal);
      qYaw.setFromAxisAngle(up, b.yaw + Math.sin(t * 0.21 + b.ph) * 0.06);
      b.root.quaternion.copy(tmpQ).multiply(qYaw);
      b.ring.position.y = w.y + 0.04;
      b.ring.material.uniforms.uTime.value = t + b.ph;
    }
    if (harbor.buoys) {
      OCEAN_BUOYS.forEach(([x, z], i) => {
        const w = waveAt(x, z, t);
        tmpQ.setFromUnitVectors(up, w.normal);
        m4.compose(v3.set(x, w.y - 0.5, z), tmpQ, s3);
        for (const im of harbor.buoys.children) im.setMatrixAt(i, m4);
      });
      for (const im of harbor.buoys.children) im.instanceMatrix.needsUpdate = true;
    }
  }

  // Is (x, z) taken by a building, yard, lamp or bench? For the nature scatter and grass.
  function blocked(x, z, pad = 0) {
    for (const r of footprints) if (inRect(r, x, z, pad + 1.0)) return true;
    for (const p of posts) if (Math.hypot(p.x - x, p.z - z) < p.r + pad) return true;
    if (Math.abs(x - HARBOR.dock.x) < 5 + pad && z > 40) return true;
    return false;
  }

  let coreInfo = null;
  return {
    blocked,
    update,
    streamer,
    footprints,                   // building footprints (filled by core()); the shrub scatter hugs them
    /** Build the core set (and a deep-linked landmark's pack); resolves before the first frame. */
    async core({ props, green, houses }) {
      const pp = props ? namedParts(props.scene) : {};
      const [info] = await Promise.all([buildCore({ green, houses }), deepLink ? streamer.request(deepLink) : null]);
      coreInfo = info;
      placeBenches(pp);
      if (pp.buoy) {
        harbor.buoys = instanced(pp.buoy, OCEAN_BUOYS.map(([x, z]) => M4(x, 0, z, 0, 1.1)));
        scene.add(harbor.buoys);
      }
      streamer.start();
      // QA hooks (?qa=1 or ?debug=1 only)
      if (QA) window.__dioTown = {
        streamer, deepLink, info: coreInfo, footprints,
        loadAll: () => { for (const id of routeOrder) streamer.request(id); return streamer.all(); },
        // QA only: a free camera for wide shots (Town clamps its follow distance at 42)
        freeCam(pos, look) {
          const cam = town.camera, orig = town._updateCamera, fog = scene.fog, f0 = fog && [fog.near, fog.far], far0 = cam.far;
          const d = Math.hypot(pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]);
          if (fog) { fog.near = f0[0] + d * 0.9; fog.far = f0[1] + d * 1.4; }
          cam.far = Math.max(far0, d * 4); cam.updateProjectionMatrix();
          town._updateCamera = () => { cam.position.set(...pos); cam.lookAt(...look); };
          town._updateCamera(); town._kick?.();
          return () => { town._updateCamera = orig; if (fog) { fog.near = f0[0]; fog.far = f0[1]; } cam.far = far0; cam.updateProjectionMatrix(); };
        },
      };
      return info;
    },
  };
}
