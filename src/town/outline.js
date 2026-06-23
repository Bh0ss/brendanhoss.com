import * as THREE from 'three';
import { BUILD } from './palette.js';

// Inverted-hull outlines — Abeto's defining "handcrafted" trait. Each outlined
// mesh gets a BackSide twin whose verts are pushed out along their normals by a
// constant amount, drawn behind the original so a dark contour peeks around it.
// Fog-aware so distant outlines fade with everything else.

const _cache = new Map();

function outlineMaterial(thickness) {
  if (_cache.has(thickness)) return _cache.get(thickness);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uThickness: { value: thickness }, uColor: { value: new THREE.Color(BUILD.outline) } },
    ]),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      uniform float uThickness;
      void main() {
        vec3 transformed = position + normal * uThickness;
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uColor;
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
        #include <fog_fragment>
      }`,
  });
  _cache.set(thickness, m);
  return m;
}

// Outline one mesh in place (adds a child twin).
export function addOutline(mesh, thickness = 0.05) {
  if (!mesh.isMesh || !mesh.geometry) return;
  try {
    const o = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness));
    o.castShadow = false; o.receiveShadow = false;
    o.userData.isOutline = true;
    o.matrixAutoUpdate = false; // coincident with parent
    mesh.add(o);
  } catch (_) { /* outline is cosmetic — never break the scene */ }
}

// Outline every reasonably-sized mesh in a group (skips tiny detail meshes so
// windows/finials don't get busy contours).
export function outlineGroup(group, thickness = 0.05, minRadius = 0.45) {
  // Collect first — adding outline children *during* traverse would make the
  // traversal recurse into the new meshes forever (stack overflow).
  const targets = [];
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry || o.userData.isOutline) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    if (o.geometry.boundingSphere && o.geometry.boundingSphere.radius < minRadius) return;
    targets.push(o);
  });
  for (const m of targets) addOutline(m, thickness);
}
