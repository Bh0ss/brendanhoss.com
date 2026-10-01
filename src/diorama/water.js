import * as THREE from 'three';
import { DOMAIN, WATER_Y, FAR_HEIGHT_GLSL } from './terrain.js';
import { LAWN_GLSL } from './lawn.js';

// Stylised-real Sound. One Gerstner wave set drives BOTH the water vertex shader and the JS
// that floats the boats (waveAt), so hulls ride exactly the surface you see.
// Depth is analytic: waterY - terrainHeight (the terrain's heightmap texture), which drives the
// shallow->deep tint, opacity, the foam band and the shore swash. The terrain shader reads the
// swash envelope (wetLine) to paint the wet-sand band.

export const WAVES = [
  // dir (toward shore is -z), wavelength, amplitude, steepness
  { d: [0.12, -1], L: 15, A: 0.13, Q: 0.55 },
  { d: [-0.38, -1], L: 9.5, A: 0.085, Q: 0.5 },
  { d: [0.62, -0.78], L: 5.6, A: 0.045, Q: 0.45 },
  { d: [-0.8, -0.6], L: 3.3, A: 0.024, Q: 0.4 },
].map((w) => {
  const l = Math.hypot(w.d[0], w.d[1]);
  const k = 2 * Math.PI / w.L;
  return { dx: w.d[0] / l, dz: w.d[1] / l, k, c: Math.sqrt(9.8 / k) * 0.8, A: w.A, Q: w.Q };
});
const SWASH_AMP = 0.2;
export function swash(t) {
  // quick run-up, slow retreat
  const s = 0.5 + 0.5 * Math.sin(t * 0.85);
  return Math.pow(s, 1.8);
}

// Height + normal of the (deep-water) surface at x,z (Gerstner, horizontal shift ignored).
const _n = new THREE.Vector3();
export function waveAt(x, z, t, amp = 1) {
  let y = 0, nx = 0, nz = 0;
  for (const w of WAVES) {
    const f = w.k * (w.dx * x + w.dz * z) - w.c * w.k * t;
    const a = w.A * amp;
    y += a * Math.sin(f);
    const wa = w.k * a * Math.cos(f);
    nx -= w.dx * wa; nz -= w.dz * wa;
  }
  _n.set(nx, 1, nz).normalize();
  return { y: WATER_Y + y, normal: _n };
}

const GLSL_WAVES = /* glsl */`
  uniform float uTime, uSwash, uWaterY;
  uniform vec4 uW[4];   // dir.xy, k, c
  uniform vec2 uWA[4];  // amplitude, steepness
  uniform sampler2D uHeight; uniform vec3 uDomain;
  // manual bilinear: identical on every GPU whether or not it filters half-float textures
  // (a nearest-filtered heightmap is what made the Wave 0 foam band a grid of squares)
  ${FAR_HEIGHT_GLSL}
  float terrainH(vec2 xz){
    vec2 uv = (xz - uDomain.xy) / uDomain.z;
    // outside the heightmap: the analytic coast (the far ring's terrain is the same function there)
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return farTerrainH(xz);
    ivec2 sz = textureSize(uHeight, 0);
    vec2 t = uv * vec2(sz) - 0.5;
    vec2 i = floor(t), f = t - i; ivec2 b = ivec2(i), mx = sz - 1;
    float h00 = texelFetch(uHeight, clamp(b, ivec2(0), mx), 0).r;
    float h10 = texelFetch(uHeight, clamp(b + ivec2(1, 0), ivec2(0), mx), 0).r;
    float h01 = texelFetch(uHeight, clamp(b + ivec2(0, 1), ivec2(0), mx), 0).r;
    float h11 = texelFetch(uHeight, clamp(b + ivec2(1, 1), ivec2(0), mx), 0).r;
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  }
`;

export function createWater({ lite, heightTex, envIntensity = 1 }) {
  const uniforms = {
    uTime: { value: 0 }, uSwash: { value: 0 }, uWaterY: { value: WATER_Y },
    uW: { value: WAVES.map((w) => new THREE.Vector4(w.dx, w.dz, w.k, w.c)) },
    uWA: { value: WAVES.map((w) => new THREE.Vector2(w.A, w.Q)) },
    uHeight: { value: heightTex },
    uDomain: { value: new THREE.Vector3(DOMAIN.x0, DOMAIN.z0, DOMAIN.size) },
    uShallow: { value: new THREE.Color(0x74d8cb) },   // clear turquoise over sand
    uMid: { value: new THREE.Color(0x1f9cb4) },
    uDeep: { value: new THREE.Color(0x0e4a7c) },      // Long Island Sound blue further out
    uFoam: { value: new THREE.Color(0xf6f8f4) },
  };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.09, metalness: 0.0, transparent: true, envMapIntensity: envIntensity * 0.8,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        ${GLSL_WAVES}
        varying vec3 vWW; varying float vDepth0; varying float vCrest;`)
      .replace('#include <beginnormal_vertex>', `
        vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
        float depth0 = uWaterY - terrainH(wp0.xz);
        float amp = smoothstep(0.05, 2.2, depth0);            // waves die in the shallows
        vec3 disp = vec3(0.0); vec3 nrm = vec3(0.0, 1.0, 0.0); float crest = 0.0;
        for (int i = 0; i < 4; i++) {
          vec2 D = uW[i].xy; float k = uW[i].z; float c = uW[i].w;
          float A = uWA[i].x * amp; float Q = uWA[i].y;
          float f = k * dot(D, wp0.xz) - c * k * uTime;
          float cf = cos(f), sf = sin(f);
          disp.xz += Q * A * D * cf;
          disp.y += A * sf;
          // normals at 60% of the true slope: a calm harbour, not a chop (geometry unchanged, so
          // the boats still ride the surface you see)
          nrm.xz -= D * k * A * cf * 0.6;
          nrm.y -= Q * k * A * sf * 0.6;
          crest += sf * uWA[i].x;
        }
        // shore swash: the water line runs up the beach and drains back
        float shore = 1.0 - smoothstep(0.0, 1.4, depth0);
        disp.y += uSwash * ${SWASH_AMP.toFixed(3)} * shore;
        vec3 objectNormal = normalize(nrm);
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(1.0, 0.0, 0.0);
        #endif
        vDepth0 = depth0; vCrest = crest;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position) + disp;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${GLSL_WAVES}
        uniform vec3 uShallow, uMid, uDeep, uFoam;
        varying vec3 vWW; varying float vDepth0; varying float vCrest;
        ${LAWN_GLSL}
        float aaStep(float e, float v){ float w = max(fwidth(v), 1e-4); return smoothstep(e - w, e + w, v); }
        float gFoam;`)
      .replace('#include <map_fragment>', `
        float depth = vWW.y - terrainH(vWW.xz);                    // analytic water depth
        if (depth < -0.05) discard;
        vec3 col = mix(uShallow, uMid, smoothstep(0.1, 2.0, depth));
        col = mix(col, uDeep, smoothstep(2.0, 7.5, depth));
        // foam, all fine-grained and anti-aliased (fwidth) so it never pixelates:
        //  - a thin bright line right at the water's edge, broken by noise
        //  - lacy spent surf trailing seaward of it, drifting with the swash
        vec2 fp = vWW.xz;
        float lace = lwFbm(fp * 2.6 + vec2(uTime * 0.21, uTime * 0.07));
        float fine = lwNoise(mat2(0.8, -0.6, 0.6, 0.8) * fp * 7.5 - vec2(0.0, uTime * 0.3));
        float wob = lwNoise(fp * 0.7 + uTime * 0.05);
        float line = (1.0 - smoothstep(0.0, 0.05 + 0.06 * wob, depth)) * (0.7 + 0.3 * fine);
        float band = 1.0 - smoothstep(0.03, 0.22 + 0.14 * wob, depth);
        float trail = band * aaStep(0.6, lace * 0.75 + fine * 0.35) * 0.75;
        float surf = smoothstep(0.62, 0.92, sin(vDepth0 * 3.2 + uTime * 1.3) * 0.5 + 0.5) * (1.0 - smoothstep(0.25, 1.1, vDepth0));
        surf *= aaStep(0.62, lace * 0.6 + fine * 0.5) * 0.4;
        gFoam = clamp(max(line, trail) + surf, 0.0, 1.0);
        col = mix(col, uFoam, gFoam);
        // clear in the shallows (the sand reads through), opaque past ~2.5 u; the edge fades to
        // nothing so the wet sand slides under the water instead of meeting a hard lip
        float alpha = mix(0.2, 1.0, smoothstep(0.0, 2.6, depth));
        alpha = max(alpha, gFoam * 0.92);
        alpha *= smoothstep(-0.03, 0.06, depth);
        diffuseColor = vec4(col, alpha);`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = mix(roughness, 0.85, gFoam);`);
  };
  mat.customProgramCacheKey = () => 'dio-water3';

  // near grid: dense enough for the swash, from just inshore of the beach out past the boats
  const near = new THREE.PlaneGeometry(280, 110, lite ? 150 : 260, lite ? 60 : 100);
  near.rotateX(-Math.PI / 2); near.translate(0, WATER_Y, 38 + 55);
  const meshNear = new THREE.Mesh(near, mat);
  // far: coarse, out past the fog to the horizon (the sky below the horizon is the fog colour)
  const far = new THREE.PlaneGeometry(2400, 1150, 48, 24);
  far.rotateX(-Math.PI / 2); far.translate(0, WATER_Y, 148 + 575);
  const meshFar = new THREE.Mesh(far, mat);
  // side strips (east/west of the near grid): the coast runs on to the haze both ways
  const sideG = new THREE.PlaneGeometry(1060, 110, 96, 16);
  sideG.rotateX(-Math.PI / 2);
  const w = sideG.clone(); w.translate(-140 - 530, WATER_Y, 93);
  const e = sideG.clone(); e.translate(140 + 530, WATER_Y, 93);
  const sides = new THREE.Mesh(mergeGeos([w, e]), mat);
  for (const m of [meshNear, meshFar, sides]) { m.receiveShadow = true; m.frustumCulled = false; m.renderOrder = 1; m.name = 'dio-water'; }
  const group = new THREE.Group(); group.add(meshNear, meshFar, sides);

  let wet = 0;
  function update(dt, t) {
    uniforms.uTime.value = t;
    const s = swash(t);
    uniforms.uSwash.value = s;
    wet = Math.max(s, wet - dt * 0.035);        // sand stays dark a while after the wave drains
    return WATER_Y + SWASH_AMP * wet;          // -> terrain uWetLine
  }
  return { group, material: mat, uniforms, update };
}

function mergeGeos(list) {
  const pos = [], idx = [], nrm = [], uv = [];
  let base = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); uv.push(u.getX(i), u.getY(i)); }
    const ix = g.index.array; for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base);
    base += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Foam ring that sits on the water around a floating hull (elongated along the hull).
export function foamRing(length = 14, beam = 5) {
  const geo = new THREE.RingGeometry(0.62, 1.0, 48, 1);
  geo.rotateX(-Math.PI / 2);
  geo.scale(length * 0.62, 1, beam * 0.8);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: `#include <common>
      #include <fog_pars_vertex>
      varying vec2 vP; varying float vR;
      void main(){ vP = position.xz; vR = length(uv - 0.5) * 2.0;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <fog_pars_fragment>
      uniform float uTime; varying vec2 vP; varying float vR;
      float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      void main(){
        float r = clamp((vR - 0.62) / 0.38, 0.0, 1.0);
        float band = smoothstep(0.0, 0.25, r) * (1.0 - smoothstep(0.35, 1.0, r));
        float k = n(vP * 1.3 + uTime * 0.6) * 0.6 + n(vP * 3.1 - uTime * 0.4) * 0.4;
        float a = band * smoothstep(0.35, 0.75, k) * 0.85;
        gl_FragColor = vec4(vec3(0.96, 0.97, 0.95), a);
        #include <fog_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 2;
  return m;
}
