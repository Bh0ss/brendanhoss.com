import * as THREE from 'three';

// Sun shadow rig. PCFSoft; the ortho frustum follows the player and is snapped to whole shadow
// texels in light space, so the shadow edges don't crawl as you walk.
//   full: 2048 map, re-rendered every frame (boats, grass-free, avatar all animate)
//   lite: 1024 map, re-rendered only when the player has moved (plus a blob under the avatar)
export function createShadowRig({ renderer, scene, sun, lite }) {
  const size = lite ? 1024 : 2048;
  const half = lite ? 34 : 42;
  sun.castShadow = true;
  sun.shadow.mapSize.set(size, size);
  sun.shadow.map?.dispose(); sun.shadow.map = null;
  const cam = sun.shadow.camera;
  cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
  cam.near = 1; cam.far = 220;
  cam.updateProjectionMatrix();
  scene.add(sun.target);
  const dir = sun.position.clone().normalize();             // Town placed it at sunDir * 80
  const texel = (2 * half) / size;
  // light-space basis
  const zAxis = dir.clone();
  const xAxis = new THREE.Vector3(0, 1, 0).cross(zAxis).normalize();
  const yAxis = zAxis.clone().cross(xAxis).normalize();
  const c = new THREE.Vector3();
  if (lite) { renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true; }
  let last = new THREE.Vector3(Infinity, 0, 0);
  let frames = 0;
  function place(p) {
    const lx = Math.round(p.dot(xAxis) / texel) * texel;
    const ly = Math.round(p.dot(yAxis) / texel) * texel;
    const lz = p.dot(zAxis);
    c.copy(xAxis).multiplyScalar(lx).addScaledVector(yAxis, ly).addScaledVector(zAxis, lz);
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(dir, 90);
    sun.target.updateMatrixWorld();
  }
  function update(p) {
    frames++;
    if (!lite) { place(p); return; }
    if (p.distanceToSquared(last) > 0.0025 || frames < 8) {
      place(p); last.copy(p); renderer.shadowMap.needsUpdate = true;
    }
  }
  function force() { last.set(Infinity, 0, 0); frames = 0; }
  return { update, force };
}
