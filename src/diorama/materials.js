import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// normalizeMaterial(): the one gate every imported PBR material passes through, so assets from
// three different sources (Poly Haven scans, Quaternius kits, our own trim sheet) sit in one
// light. Clamps roughness/metalness into a believable band and tints albedo slightly toward the
// site's golden-hour palette.
const WARM = new THREE.Color(0xfff1dc);
export function normalizeMaterial(m, { tint = 0.07, minRough = 0.28, maxMetal = 0.85, envIntensity = 1 } = {}) {
  if (!m || !m.isMeshStandardMaterial) return m;
  m.roughness = THREE.MathUtils.clamp(m.roughness, minRough, 1);
  m.metalness = THREE.MathUtils.clamp(m.metalness, 0, maxMetal);
  m.color.lerp(WARM.clone().multiply(m.color), tint);
  m.envMapIntensity = envIntensity;
  if (m.map) m.map.anisotropy = 8;
  // no fog-less or emissive surprises from kits
  m.fog = true;
  return m;
}

// regrade(): pull a kit material toward the scene's realism band, in the shader, after the
// albedo map is sampled: saturation, contrast about a mid grey, and a colour multiplier.
// `flat` ignores the map's RGB (keeps its alpha) and uses `mul` as the colour: for cutout
// textures whose RGB did not survive compression (the kit's Flowers card renders black).
// Double-sided cards (grass, leaves): keep the geometric normal on back faces instead of
// flipping it, so the far side of a card is lit like the near side rather than going black.
export const NO_FLIP_NORMAL = THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '');

export function regrade(m, { sat = 1, con = 1, mul = [1, 1, 1], flat = false, noFlip = false, key = '' } = {}) {
  if (!m) return m;
  const u = { rgSat: { value: sat }, rgCon: { value: con }, rgMul: { value: new THREE.Vector3(...mul) } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    if (noFlip) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', NO_FLIP_NORMAL);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float rgSat, rgCon; uniform vec3 rgMul;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 c = diffuseColor.rgb;
          ${flat ? 'c = rgMul;' : `float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, rgSat);
          c = 0.18 * pow(max(c, vec3(1e-4)) / 0.18, vec3(rgCon));
          c *= rgMul;`}
          diffuseColor.rgb = c;
        }`);
  };
  m.customProgramCacheKey = () => 'rg-' + (flat ? 'f' : 'n') + (noFlip ? 'x' : '') + key;
  m.needsUpdate = true;
  return m;
}

// Foliage cards shade like a volume: bend each leaf normal toward "out from the crown centre",
// so a tree reads as one lit mass with a soft terminator, not a confetti of randomly lit cards.
export function volumetricNormals(geo, amount = 0.75) {
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3());
  const size = geo.boundingBox.getSize(new THREE.Vector3());
  const p = geo.attributes.position, n = geo.attributes.normal;
  const v = new THREE.Vector3(), o = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set((p.getX(i) - c.x) / size.x, (p.getY(i) - c.y) / size.y + 0.15, (p.getZ(i) - c.z) / size.z).normalize();
    o.set(n.getX(i), n.getY(i), n.getZ(i));
    o.lerp(v, amount).normalize();
    n.setXYZ(i, o.x, o.y, o.z);
  }
  n.needsUpdate = true;
  return geo;
}

// Library binding: building GLBs carry material NAMES only; bind them to the shared library.
export function bindLibrary(root, lib) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const out = list.map((m) => lib[m.name.replace(/\.\d+$/, '')] || m);
    o.material = Array.isArray(o.material) ? out : out[0];
  });
}

// Convert (possibly quantized / normalized) attributes to plain float so geometries can be
// transformed and merged. Only position / normal / uv are kept.
export function floatGeometry(g) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = g.getAttribute(name);
    if (!a) continue;
    const n = a.itemSize, arr = new Float32Array(a.count * n);
    // library-bound buildings ship int16 UVs normalised by a per-primitive scale (optimize-assets.mjs)
    const k = name === 'uv' ? (g.userData?.uvScale ?? 1) : 1;
    for (let i = 0; i < a.count; i++) {
      arr[i * n] = a.getX(i) * k;
      if (n > 1) arr[i * n + 1] = a.getY(i) * k;
      if (n > 2) arr[i * n + 2] = a.getZ(i) * k;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
  if (g.index) out.setIndex(Array.from(g.index.array));
  else {
    const idx = []; for (let i = 0; i < out.attributes.position.count; i++) idx.push(i); out.setIndex(idx);
  }
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  if (!out.getAttribute('uv')) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  return out;
}

// Merge every static mesh under `roots` into one mesh per material (draw-call discipline).
export function mergeByMaterial(roots, { castShadow = true, receiveShadow = true } = {}) {
  const buckets = new Map();
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const g = floatGeometry(o.geometry);
      g.applyMatrix4(o.matrixWorld);
      const m = o.material;
      if (!buckets.has(m)) buckets.set(m, []);
      buckets.get(m).push(g);
    });
  }
  const group = new THREE.Group(); group.name = 'dio-merged';
  for (const [m, geos] of buckets) {
    const g = mergeGeometries(geos, false);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
    mesh.name = 'merged:' + m.name;
    group.add(mesh);
  }
  return group;
}

// Collect named meshes from a GLB scene: name -> [{geometry, material}] (multi-primitive safe),
// geometry baked into the node's local transform (so instancing can use it directly).
export function namedParts(gltfScene) {
  const out = {};
  gltfScene.updateWorldMatrix(true, true);
  for (const node of gltfScene.children) {
    const parts = [];
    node.traverse((o) => {
      if (!o.isMesh) return;
      const g = floatGeometry(o.geometry);   // quantized attributes would clamp when transformed
      g.applyMatrix4(o.matrixWorld);
      parts.push({ geometry: g, material: o.material });
    });
    out[node.name.toLowerCase()] = parts;
  }
  return out;
}

// One InstancedMesh per primitive of a named part.
// `colors` (optional, one THREE.Color per instance) tints the parts `colorIf(part)` accepts.
export function instanced(parts, matrices, { castShadow = true, receiveShadow = true, colors = null, colorIf = () => true } = {}) {
  const group = new THREE.Group();
  for (const p of parts) {
    const im = new THREE.InstancedMesh(p.geometry, p.material, matrices.length);
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    if (colors && colorIf(p)) colors.forEach((c, i) => im.setColorAt(i, c));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = castShadow; im.receiveShadow = receiveShadow;
    group.add(im);
  }
  return group;
}
