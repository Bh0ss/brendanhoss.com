import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm } from './terrain.js';

// The Thimble Islands (W2): a scatter of low pink-granite humps off to the south-east, scrub on
// their crowns, a cottage on the bigger ones, pines as treeline cards. One merged mesh with
// vertex colours (one draw); fog carries them into the haze. Branford's real islands are exactly
// this: granite knobs, a few summer cottages, pitch pine.
export const ISLANDS = [
  // x, z, radius, height, cottage
  [78, 118, 11, 4.2, true], [101, 131, 6, 2.6, false], [118, 112, 8, 3.4, true], [96, 152, 14, 5.2, true],
  [138, 140, 7, 3.0, false], [152, 118, 5, 2.2, false], [132, 176, 10, 4.0, true], [172, 150, 12, 4.6, false],
  [196, 178, 7, 2.8, true], [60, 150, 4.5, 2.0, false], [214, 132, 9, 3.6, false], [160, 204, 13, 4.4, true],
];
const GRANITE = new THREE.Color(0x9a8578), GRANITE_DK = new THREE.Color(0x5f5250), SCRUB = new THREE.Color(0x56703a), SCRUB_DK = new THREE.Color(0x344a26);
const WALL = new THREE.Color(0xe9e4da), ROOF = new THREE.Color(0x4d4a4c);

function paint(g, fn) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), col); c.set([col.r, col.g, col.b], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g;
}

export function createIslands({ rng, lite }) {
  const geos = [], pines = [];
  for (const [x, z, r, h, cottage] of ISLANDS) {
    const g = new THREE.SphereGeometry(1, lite ? 12 : 18, lite ? 6 : 9, 0, Math.PI * 2, 0, Math.PI * 0.62).toNonIndexed();
    const p = g.attributes.position;
    const sq = 0.7 + rng() * 0.5, rot = rng() * 6.28;
    for (let i = 0; i < p.count; i++) {
      let px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
      const n = fbm(px * 2.2 + x, pz * 2.2 + z);
      const k = 0.8 + n * 0.45;
      px *= r * k; pz *= r * k * sq;
      const cx = px * Math.cos(rot) - pz * Math.sin(rot), cz = px * Math.sin(rot) + pz * Math.cos(rot);
      p.setXYZ(i, x + cx, (py - 0.45) * h * 1.8 * (0.85 + n * 0.3), z + cz);
    }
    g.computeVertexNormals();
    paint(g, (px, py, pz, col) => {
      const t = THREE.MathUtils.smoothstep(py, h * 0.35, h * 0.62);
      const n = fbm(px * 0.5, pz * 0.5);
      col.copy(GRANITE_DK).lerp(GRANITE, THREE.MathUtils.smoothstep(py, -0.2, 0.9) * (0.6 + n * 0.5));
      col.lerp(SCRUB_DK.clone().lerp(SCRUB, n), t);
    });
    geos.push(g);
    // pitch pines on the crown
    const np = Math.round(r * (lite ? 0.35 : 0.6));
    for (let i = 0; i < np; i++) {
      const a = rng() * 6.28, d = Math.sqrt(rng()) * r * 0.55;
      pines.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, y: h * 0.55, s: 0.45 + rng() * 0.35 });
    }
    if (cottage) {
      const w = 2.6 + rng() * 1.2, d = 3.4 + rng() * 1.4, hh = 2.2, yaw = rng() * 3.14, cy = h * 0.72;
      const body = paint(new THREE.BoxGeometry(w, hh, d).toNonIndexed(), (a, b, c, col) => col.copy(WALL));
      const roof = new THREE.CylinderGeometry(0.01, w * 0.62, 1.6, 4, 1).toNonIndexed();   // hip roof
      roof.rotateY(Math.PI / 4); roof.scale(1, 1, d / w); roof.translate(0, hh / 2 + 0.8, 0);
      paint(roof, (a, b, c, col) => col.copy(ROOF));
      for (const q of [body, roof]) { q.rotateY(yaw); q.translate(x + r * 0.15, cy + hh / 2 - 0.2, z - r * 0.1); q.computeVertexNormals(); }
      geos.push(body, roof);
    }
  }
  for (const g of geos) { if (!g.attributes.normal) g.computeVertexNormals(); }
  const merged = mergeGeometries(geos.map((g) => { const o = new THREE.BufferGeometry(); for (const k of ['position', 'normal', 'color']) o.setAttribute(k, g.attributes[k]); return o; }));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = 'dio-islands';
  mesh.userData.noAO = true;
  mesh.castShadow = false; mesh.receiveShadow = false;
  return { mesh, pines };
}
