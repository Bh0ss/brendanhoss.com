import * as THREE from 'three';
import { BUILD } from './palette.js';

// Inverted-hull outlines, fixed two ways:
//
// 1. Cracks. BoxGeometry/Extrude have split normals at every corner, so pushing
//    each vertex along its own face normal tore the hull open at the corners.
//    The hull now extrudes along a SMOOTHED normal (average of all normals that
//    share a position), stored on a sibling geometry that shares the parent's
//    position/index buffers — no vertex data is copied and the parent geometry
//    is untouched (still mergeable with everything else on MATERIALS.toon).
//
// 2. Shimmer. The old hull used a fixed world-space thickness, so distant
//    contours went sub-pixel and crawled. The extrusion is now done in CLIP
//    space: a constant width in CSS pixels, tapering to ~55% with distance so
//    the far town doesn't turn into a busy line drawing. Fog still fades it.
//
// Why not a screen-space depth/normal edge pass: it needs an extra full-scene
// normal/depth render (≈ doubles scene draw calls) plus a fullscreen Sobel —
// too expensive for the lite tier, and the hull already gives the look.

const RES = { value: new THREE.Vector2(innerWidth, innerHeight) };
addEventListener('resize', () => RES.value.set(innerWidth, innerHeight));

const _cache = new Map();
function outlineMaterial(px) {
  if (_cache.has(px)) return _cache.get(px);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uPx: { value: px }, uColor: { value: new THREE.Color(BUILD.outline) } },
    ]),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      attribute vec3 outlineNormal;
      uniform float uPx;
      uniform vec2 uRes;
      void main() {
        vec4 mvPosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        vec4 clip = projectionMatrix * mvPosition;
        vec3 nView = normalize(normalMatrix * outlineNormal);
        vec2 dir = (projectionMatrix * vec4(nView, 0.0)).xy;
        float l = length(dir);
        dir = l > 1e-5 ? dir / l : vec2(0.0);
        float dist = -mvPosition.z;
        float px = uPx * mix(1.0, 0.55, smoothstep(25.0, 110.0, dist));
        clip.xy += dir * px * 2.0 / uRes * clip.w;
        // nudge back a hair so the hull never z-fights the front faces
        clip.z += 0.0004 * clip.w;
        gl_Position = clip;
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
  m.uniforms.uRes = RES;
  _cache.set(px, m);
  return m;
}

// Smoothed normals keyed by quantised position. Cached per source geometry.
const _hullCache = new WeakMap();
function hullGeometry(src) {
  if (_hullCache.has(src)) return _hullCache.get(src);
  const pos = src.attributes.position, nrm = src.attributes.normal;
  const acc = new Map();
  const key = (i) => `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    let a = acc.get(k);
    if (!a) { a = [0, 0, 0]; acc.set(k, a); }
    a[0] += nrm.getX(i); a[1] += nrm.getY(i); a[2] += nrm.getZ(i);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const a = acc.get(key(i));
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = a[0] / l; out[i * 3 + 1] = a[1] / l; out[i * 3 + 2] = a[2] / l;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', pos);                  // shared buffer, not a copy
  g.setAttribute('outlineNormal', new THREE.BufferAttribute(out, 3));
  if (src.index) g.setIndex(src.index);
  g.boundingSphere = src.boundingSphere;
  _hullCache.set(src, g);
  return g;
}

// Outline one mesh in place (adds a child twin). `px` = contour width in CSS px.
export function addOutline(mesh, px = 1.6) {
  if (!mesh.isMesh || !mesh.geometry || !mesh.geometry.attributes.normal) return;
  try {
    const o = new THREE.Mesh(hullGeometry(mesh.geometry), outlineMaterial(px));
    o.castShadow = false; o.receiveShadow = false;
    o.userData.isOutline = true;
    o.matrixAutoUpdate = false; // coincident with parent
    mesh.add(o);
  } catch (_) { /* outline is cosmetic — never break the scene */ }
}

// Outline every reasonably-sized mesh in a group (skips tiny detail meshes so
// windows/finials don't get busy contours, and skips emissive/transparent bits).
export function outlineGroup(group, px = 1.6, minRadius = 0.45) {
  // Collect first — adding outline children *during* traverse would recurse.
  const targets = [];
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry || o.userData.isOutline || o.userData.noOutline) return;
    if (o.material && (o.material.transparent || o.material.isMeshBasicMaterial)) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    if (o.geometry.boundingSphere && o.geometry.boundingSphere.radius < minRadius) return;
    targets.push(o);
  });
  for (const m of targets) addOutline(m, px);
}
