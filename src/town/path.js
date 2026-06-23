import * as THREE from 'three';
import { GROUND } from './palette.js';

// The "memory lane": a smooth Catmull-Rom curve through the route waypoints,
// rendered as a slightly-irregular ribbon so it reads hand-laid rather than
// gridded. Exposes the curve for spawning the player at the trailhead, placing
// props along it, and keeping trees off it.

export function createPath(waypoints, { width = 5.2 } = {}) {
  const pts = waypoints.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);

  const N = Math.max(60, waypoints.length * 14);
  const up = new THREE.Vector3(0, 1, 0);
  const positions = [];
  const uvs = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t); tan.y = 0; tan.normalize();
    const side = new THREE.Vector3().crossVectors(tan, up).normalize();
    const hw = (width / 2) * (0.82 + 0.22 * Math.sin(t * 26) + 0.1 * Math.sin(t * 11));
    const l = p.clone().addScaledVector(side, hw);
    const r = p.clone().addScaledVector(side, -hw);
    positions.push(l.x, 0.03, l.z, r.x, 0.03, r.z);
    uvs.push(0, t * N * 0.12, 1, t * N * 0.12);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const idx = [];
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    idx.push(a, b, c, b, d, c);
  }
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ color: GROUND.path, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 0;

  // sample points for clearance tests + prop placement
  const samples = [];
  for (let i = 0; i <= N; i++) samples.push(curve.getPointAt(i / N));

  return {
    mesh, curve, samples,
    startPos() { return curve.getPointAt(0.012); },
    startDir() { const t = curve.getTangentAt(0.012); t.y = 0; return t.normalize(); },
    pointAt(t) { return curve.getPointAt(THREE.MathUtils.clamp(t, 0, 1)); },
    // offset point: `t` along, `off` perpendicular (left +)
    besideAt(t, off) {
      const p = curve.getPointAt(THREE.MathUtils.clamp(t, 0, 1));
      const tan = curve.getTangentAt(THREE.MathUtils.clamp(t, 0, 1)); tan.y = 0; tan.normalize();
      const side = new THREE.Vector3().crossVectors(tan, up).normalize();
      return p.addScaledVector(side, off);
    },
    nearPath(x, z, clear) {
      for (const s of samples) if (Math.hypot(s.x - x, s.z - z) < clear) return true;
      return false;
    },
  };
}
