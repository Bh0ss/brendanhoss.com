import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Memory Lane look: golden hour on the Connecticut shoreline.
//
// One colour language, a handful of shared materials, and every mesh painted by
// VERTEX COLOUR rather than by its own material. Why vertex colours instead of a
// palette texture: every shape is a code-built primitive with no authored UVs,
// so vertex colours give the same "one shared material" result with no texture
// fetch, and they survive BufferGeometryUtils.mergeGeometries/InstancedMesh
// untouched (the performance lane can merge everything that shares `toon`).
//
// Light model (see stylise()):
//   • key light banded through a soft 64-texel toon ramp (soft steps, so the
//     terminator doesn't alias on the lite tier),
//   • cool hemisphere fill left smooth (it's the "sky bounce"),
//   • warm rim on the sun side for the toy-like edge,
//   • fake baked AO: per-vertex darkening toward each part's base + bottom
//     faces (paint), and a world-height contact term in the shader.
// All colours are hex ints in sRGB; THREE.Color converts to linear.
// ─────────────────────────────────────────────────────────────────────────────

// Low golden-hour sun over the Sound (south-west, ~30° up). The sky dome, water
// sparkle and shadow light all read from this one vector.
export const SUN_DIR = new THREE.Vector3(-0.52, 0.5, 0.69).normalize();

export const SKY = {
  top: 0x7fb0d6,      // clear late-afternoon blue at the zenith
  horizon: 0xf4d9bd,  // peach-cream haze; also the fog colour (seamless horizon)
  glow: 0xffbe7a,     // warm lobe around the sun
  sun: 0xfff0d2,      // sun disc
  fog: 0xf4d9bd,
};

export const LIGHT = {
  sun: 0xffca92,      // warm key
  hemiSky: 0xabc9e8,  // cool fill from above
  hemiGround: 0x9c8c62, // warm grass bounce
};

export const GROUND = {
  grass: 0xa4c07a,
  grassDeep: 0x8fae68,
  green: 0xafcd84,    // the town green, a touch brighter so it reads as "the centre"
  path: 0xecdcbc,     // pale sandy stone
  sand: 0xf0dcb8,     // warm beach
  water: 0x7cc2c6,
  waterDeep: 0x3d7d9b,
};

export const BUILD = {
  cream: 0xf5e8cf,
  white: 0xf8f0e0,        // off-white, never pure
  brick: 0xcc7f63,
  stone: 0xe4d4b6,        // warm limestone
  sage: 0xb7cba4,
  blue: 0xb4cadb,
  glassTech: 0x9fc4d4,
  glass: 0x93b6c6,        // unlit windows: cool, picks up the blue fill
  windowLit: 0xffc983,    // lit windows: warm lamp light (emissive)
  roofTerracotta: 0xc97c63,
  roofSlate: 0x6f8199,
  roofDark: 0x66707f,
  roofCopper: 0x7fb7a4,   // verdigris
  trim: 0x7a5f4a,
  plinth: 0xd9cbad,
  outline: 0x33262a,      // warm near-black contour, never pure black
};

export const NATURE = {
  trunk: 0x8a6446,
  foliageA: 0x86ad5e,
  foliageB: 0x74a055,
  foliageC: 0x9cc070,
  maple: 0xe2a35e,        // the odd early-autumn maple: a warm accent, seeded
  mapleB: 0xd98450,
  rock: 0x9a9690,
  rockDark: 0x8e8983,
  hill: 0x78a468,
};

export const CHAR = {
  skin: 0xecc09a,
  shirt: 0x4f94e4,   // signature blue
  shirtDark: 0x3a7cd0,
  pants: 0x3f4c66,
  shoes: 0x3a3438,
  hair: 0x5a3f2e,
  eye: 0x2a2428,
};

// ── Seeded PRNG (mulberry32). The town layout is composed, not rolled per load.
// QA hook: ?seed=<int> previews another layout without a rebuild.
const _seedParam = typeof location !== 'undefined' ? parseInt(new URLSearchParams(location.search).get('seed'), 10) : NaN;
export const LAYOUT_SEED = Number.isFinite(_seedParam) ? _seedParam : 1987;
export function seeded(seed = LAYOUT_SEED) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.pick = (arr) => arr[(r() * arr.length) | 0];
  return r;
}

// ── Toon ramp: soft 3-step key-light banding over N·L. Sampled at N·L*0.5+0.5,
// so the left half (facing away from the sun) is 0 — back faces get fill only.
function makeRamp() {
  const N = 64, data = new Uint8Array(N * 4);
  const s = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < N; i++) {
    const ndl = (i + 0.5) / N * 2 - 1;
    const v = 0.52 * s(-0.02, 0.06, ndl) + 0.48 * s(0.30, 0.40, ndl);
    const b = Math.round(v * 255);
    data.set([b, b, b, 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
const RAMP = makeRamp();

// Stylise a MeshToonMaterial: warm sun-side rim + world-height contact AO.
function stylise(material, { rim = 0.32, ao = 0.7, aoHeight = 1.6, key }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uRimColor = { value: new THREE.Color(0xffe2b8) };
    shader.uniforms.uAoMin = { value: ao };
    shader.uniforms.uAoHeight = { value: aoHeight };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vAoY;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 aoW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          aoW = instanceMatrix * aoW;
        #endif
        vAoY = (modelMatrix * aoW).y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vAoY;
        uniform float uRim, uAoMin, uAoHeight;
        uniform vec3 uRimColor;`)
      .replace('#include <opaque_fragment>', `
        {
          // contact AO: darken toward the ground plane (fake bake, costs nothing)
          float aoK = mix(uAoMin, 1.0, smoothstep(0.0, uAoHeight, vAoY));
          outgoingLight *= aoK;
          // rim: grazing edges, strongest on the side facing the sun
          vec3 vDir = normalize(vViewPosition);
          float rimF = smoothstep(0.62, 1.0, 1.0 - saturate(dot(normal, vDir)));
          float sunSide = 0.35;
          #if NUM_DIR_LIGHTS > 0
            sunSide = 0.25 + 0.75 * saturate(dot(normal, directionalLights[0].direction) * 0.5 + 0.5);
          #endif
          outgoingLight += uRimColor * diffuseColor.rgb * rimF * sunSide * uRim;
        }
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'ml-' + key;
  return material;
}

// ── The shared materials. Keep this list short: every mesh uses one of these.
export const MATERIALS = {
  // Buildings, props, trees, rocks, player — everything solid.
  toon: stylise(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: RAMP }), { key: 'toon' }),
  // Thin double-sided parts (sails, flag).
  toonDS: stylise(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: RAMP, side: THREE.DoubleSide }), { key: 'toonDS', rim: 0.15 }),
  // Ground, green, sand, path: no rim, no height AO (they ARE the ground).
  ground: stylise(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: RAMP, side: THREE.DoubleSide }), { key: 'ground', rim: 0, ao: 1 }),
  // Emissive: lit windows, lamps, lantern, beacon orbs. Vertex colour is HDR
  // (>1) so only these cross the bloom threshold on the full tier.
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }),
  // Soft emissive (beacon rings / shafts) — transparent, no depth write.
  glowSoft: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, fog: false }),
  glowFaint: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.08, depthWrite: false, fog: false, side: THREE.DoubleSide }),
};

const _c = new THREE.Color();
/**
 * Write a colour attribute onto a geometry. Baked AO: a gentle vertical
 * gradient across the part (base darker than top) and darker down-facing faces.
 * `intensity` > 1 makes an HDR colour for the glow material.
 */
export function paint(geo, hex, { ao = 0.12, intensity = 1, jitter = 0 } = {}) {
  _c.set(hex).multiplyScalar(intensity);
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const minY = geo.boundingBox.min.y, spanY = Math.max(1e-4, geo.boundingBox.max.y - minY);
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let k = 1 - ao * (1 - (pos.getY(i) - minY) / spanY);
    if (nrm && ao > 0 && nrm.getY(i) < -0.5) k *= 0.78;
    if (jitter) k *= 1 + jitter * (Math.sin(i * 12.9898) * 0.5);
    col[i * 3] = _c.r * k; col[i * 3 + 1] = _c.g * k; col[i * 3 + 2] = _c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** A mesh on a shared material, painted. The only way meshes get made. */
export function part(geo, hex, { mat = 'toon', cast = true, receive = true, ...opts } = {}) {
  if (mat === 'glow' || mat === 'glowSoft' || mat === 'glowFaint') { opts.ao = 0; cast = false; receive = false; }
  paint(geo, hex, opts);
  // Details under ~0.35 units are 1–2 shadow-map texels: not worth a shadow draw.
  if (cast) { if (!geo.boundingSphere) geo.computeBoundingSphere(); if (geo.boundingSphere.radius < 0.35) cast = false; }
  const m = new THREE.Mesh(geo, MATERIALS[mat]);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

// ── Soft contact blob (shared texture) — used for merged blob-shadow decals.
let _blobTex = null;
export function blobTexture() {
  if (_blobTex) return _blobTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, 'rgba(40,30,34,0.42)');
  g.addColorStop(0.45, 'rgba(40,30,34,0.24)');
  g.addColorStop(1, 'rgba(40,30,34,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  _blobTex = new THREE.CanvasTexture(c);
  _blobTex.colorSpace = THREE.SRGBColorSpace;
  return _blobTex;
}

/**
 * Build ONE mesh of ground-contact blobs from a list of {x, z, r, sx?, sz?, rot?}.
 * One draw call for every blob in the town.
 */
export function blobField(list, y = 0.035) {
  const pos = [], uv = [], idx = [];
  for (const b of list) {
    const sx = (b.sx ?? 1) * b.r, sz = (b.sz ?? 1) * b.r, cr = Math.cos(b.rot || 0), sr = Math.sin(b.rot || 0);
    const base = pos.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const lx = (u - 0.5) * 2 * sx, lz = (v - 0.5) * 2 * sz;
      pos.push(b.x + lx * cr - lz * sr, y, b.z + lx * sr + lz * cr);
      uv.push(u, v);
    }
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: blobTexture(), transparent: true, depthWrite: false, fog: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  m.renderOrder = 1;
  m.frustumCulled = false;
  return m;
}
