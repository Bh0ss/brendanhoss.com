import * as THREE from 'three';
import { LAWN_GLSL } from './lawn.js';

// Heightmapped diorama terrain. Inland (the unconverted town) stays at y=0 so the classic
// buildings still sit on it; toward the Sound the land lifts into a low grass bank, then a
// beach slopes UNDER the water line and on down to a sea floor, so the water's depth is real
// (water.js reads the same heightmap). A rocky point carries the lighthouse.
//
// The splat map (R grass, G dry sand, B rock/shingle, A path) is computed here from height,
// distance-to-shore and distance-to-trail; wet sand is dynamic (it tracks the swash) and is
// done in the shader from height alone.

export const WATER_Y = 0;
export const DOMAIN = { x0: -160, z0: -120, size: 320 };   // square, world units
const HM = 512;          // heightmap texels (for the water shader; 0.6 u/texel keeps the foam isolines smooth)
const SPLAT = 512;       // splat texels

// organic shoreline: z of the grass edge as a function of x
export function shoreZ(x) {
  return 44 + 2.5 * Math.sin(x * 0.05) + 1.5 * Math.sin(x * 0.13 + 1.0);
}

// cheap deterministic value noise
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z) {
  return vnoise(x, z) * 0.55 + vnoise(x * 2.03, z * 2.03) * 0.3 + vnoise(x * 4.1, z * 4.1) * 0.15;
}
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Rocky point for the lighthouse, west of the harbor.
export const POINT = { x: -13, z: 63, r: 8 };

// ── the country beyond the town (W2) ────────────────────────────────────────
// Everything past the house ring: a mown-field margin, then woodland climbing into low rolling
// hills that fade into the haze. `rr` is a noisy radius about the green, so the woods' edge and
// the hills wander instead of drawing a circle. Inside rr < 100 every term here is exactly 0, so
// no building, path or landmark moves.
export const TOWN_C = { x: 0, z: -8 };
function ringR(x, z) { return Math.hypot(x - TOWN_C.x, z - TOWN_C.z) + (fbm(x * 0.018 + 5.2, z * 0.018 - 3.1) - 0.5) * 44; }
// coastal fade for the fbm detail: at the domain's east / west edges heightAt is purely analytic,
// so the far ring (and the water's analytic depth outside the heightmap) meets it exactly
const edgeFade = (x) => 1 - ss(126, 158, Math.abs(x));
export function hillAt(x, z) {
  const d = z - shoreZ(x), rr = ringR(x, z);
  const inland = ss(-10, -70, d);
  if (inland <= 0 || rr < 118) return 0;
  const swell = ss(118, 300, rr) * 15 + ss(210, 620, rr) * 36;
  const body = 0.5 + 0.95 * fbm(x * 0.0085 + 3.3, z * 0.0085 - 7.1);
  const knobs = (fbm(x * 0.03 + 9.0, z * 0.03 + 1.7) - 0.5) * 9 * ss(130, 240, rr);
  return inland * (swell * body + knobs);
}
// (forest, field): forest 0..1 is woodland floor (under the tree scatter and treeline cards);
// field 0..1 is the rougher, less-mown meadow margin between the houses and the woods
export function wildAt(x, z) {
  const d = z - shoreZ(x), rr = ringR(x, z);
  const coast = ss(-5, -22, d);
  // clearings and hill farms: open meadow islands in the woods (the treeline cards skip them too)
  const clear = Math.max(ss(0.53, 0.6, fbm(x * 0.011 - 4, z * 0.011 + 9)) * ss(135, 170, rr), ss(0.6, 0.66, fbm(x * 0.03 + 12, z * 0.03 - 6)) * ss(125, 150, rr));
  const forest = ss(108, 124, rr) * coast * (1 - clear) * (0.75 + 0.25 * ss(0.35, 0.6, fbm(x * 0.05, z * 0.05)));
  const field = ss(88, 112, rr) * (0.55 + 0.45 * coast);
  return [forest, field];
}

export function heightAt(x, z) {
  const d = z - shoreZ(x);               // + seaward of the grass edge
  const ef = edgeFade(x);
  let h;
  if (d < 0) {
    // land: flat town; a gentle rolling bank only in the last ~14 units before the beach
    const bank = ss(-16, -2, d);
    const roll = (fbm(x * 0.06, z * 0.06) - 0.5) * 0.9 * ef;
    h = bank * (0.45 + roll * 0.6) + hillAt(x, z);
  } else {
    // beach: from the bank top, down through the water line (~d=6.5) to the sea floor
    const top = 0.45 + (fbm(x * 0.06, (z - d) * 0.06) - 0.5) * 0.54 * ef;
    const beach = top - d * 0.075;                         // ~4% grade: a wide, readable swash zone
    const shelf = -0.04 * d - 0.012 * Math.max(0, d - 14) * Math.max(0, d - 14) / 2;
    h = d < 10 ? beach : Math.min(beach, shelf + (top - 0.4));
    h = Math.max(h, -9);
    h += (fbm(x * 0.2, z * 0.2) - 0.5) * 0.12 * ss(8, 20, d) * ef;   // ripples on the sea floor
  }
  // the rocky point
  const pr = Math.hypot(x - POINT.x, z - POINT.z);
  const bump = Math.exp(-(pr * pr) / (2 * POINT.r * POINT.r));
  h = Math.max(h, h + bump * 4.6 - 0.2 * bump);
  return h;
}

// GLSL twin of heightAt() with every fbm term at zero: exactly heightAt() wherever the edge fade
// has removed them (|x| >= 158) and the hills don't reach the water. The water shader uses it
// outside the heightmap's domain.
export const FAR_HEIGHT_GLSL = /* glsl */`
  float shoreZf(float x){ return 44.0 + 2.5 * sin(x * 0.05) + 1.5 * sin(x * 0.13 + 1.0); }
  float farTerrainH(vec2 xz){
    float d = xz.y - shoreZf(xz.x);
    if (d < 0.0) return smoothstep(-16.0, -2.0, d) * 0.45;
    float beach = 0.45 - d * 0.075;
    float e = max(0.0, d - 14.0);
    float shelf = -0.04 * d - 0.006 * e * e;
    float h = d < 10.0 ? beach : min(beach, shelf + 0.05);
    return max(h, -9.0);
  }
`;

// Approximate distance to the trail (for the path splat + grass exclusion).
function pathField(samples) {
  const N = SPLAT, cell = DOMAIN.size / N;
  const f = new Float32Array(N * N).fill(99);
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    const R = 7;
    const minx = Math.floor((Math.min(a.x, b.x) - R - DOMAIN.x0) / cell), maxx = Math.ceil((Math.max(a.x, b.x) + R - DOMAIN.x0) / cell);
    const minz = Math.floor((Math.min(a.z, b.z) - R - DOMAIN.z0) / cell), maxz = Math.ceil((Math.max(a.z, b.z) + R - DOMAIN.z0) / cell);
    const vx = b.x - a.x, vz = b.z - a.z, L = vx * vx + vz * vz || 1;
    for (let zi = Math.max(0, minz); zi <= Math.min(N - 1, maxz); zi++) {
      const pz = DOMAIN.z0 + (zi + 0.5) * cell;
      for (let xi = Math.max(0, minx); xi <= Math.min(N - 1, maxx); xi++) {
        const px = DOMAIN.x0 + (xi + 0.5) * cell;
        const t = Math.min(1, Math.max(0, ((px - a.x) * vx + (pz - a.z) * vz) / L));
        const d = Math.hypot(px - (a.x + vx * t), pz - (a.z + vz * t));
        const k = zi * N + xi;
        if (d < f[k]) f[k] = d;
      }
    }
  }
  return f;
}

export function createTerrain({ lite, path, textures }) {
  // ── mesh (CPU displaced) ──────────────────────────────────────────────────
  const SEG = lite ? 176 : 320;
  const geo = new THREE.PlaneGeometry(DOMAIN.size, DOMAIN.size, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  geo.translate(DOMAIN.x0 + DOMAIN.size / 2, 0, DOMAIN.z0 + DOMAIN.size / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  geo.deleteAttribute('uv');
  geo.setAttribute('aWild', wildAttr(pos));

  // ── heightmap texture (half float, linear-filterable in WebGL2) ──────────
  const hm = new Uint16Array(HM * HM);
  for (let zi = 0; zi < HM; zi++) for (let xi = 0; xi < HM; xi++) {
    const x = DOMAIN.x0 + (xi + 0.5) / HM * DOMAIN.size, z = DOMAIN.z0 + (zi + 0.5) / HM * DOMAIN.size;
    hm[zi * HM + xi] = THREE.DataUtils.toHalfFloat(heightAt(x, z));
  }
  const heightTex = new THREE.DataTexture(hm, HM, HM, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.magFilter = heightTex.minFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.needsUpdate = true;

  // ── splat ─────────────────────────────────────────────────────────────────
  const pf = pathField(path.samples);
  const sp = new Uint8Array(SPLAT * SPLAT * 4);
  for (let zi = 0; zi < SPLAT; zi++) for (let xi = 0; xi < SPLAT; xi++) {
    const x = DOMAIN.x0 + (xi + 0.5) / SPLAT * DOMAIN.size, z = DOMAIN.z0 + (zi + 0.5) / SPLAT * DOMAIN.size;
    const d = z - shoreZ(x);
    const n = fbm(x * 0.15, z * 0.15);
    const h = heightAt(x, z);
    let sand = ss(-2.5 + n * 2.5, 1.5 + n * 2.0, d);
    const pr = Math.hypot(x - POINT.x, z - POINT.z);
    const rock = ss(POINT.r * 1.15, POINT.r * 0.6, pr) * (1 - ss(1.4, 2.4, h)) * ss(-0.6, 0.3, h) * (0.55 + 0.45 * n);
    const knoll = ss(POINT.r, POINT.r * 0.45, pr) * ss(1.1, 1.9, h);   // grassy top of the point
    sand *= 1 - knoll;
    const pw = pf[zi * SPLAT + xi];
    const wobble = (fbm(x * 0.4, z * 0.4) - 0.5) * 1.6;
    let pth = ss(3.3 + wobble, 1.7 + wobble, pw) * (1 - sand);
    let grass = Math.max(0, 1 - sand - pth - rock);
    sand = Math.max(0, sand - rock);
    const s = grass + sand + rock + pth || 1;
    const k = (zi * SPLAT + xi) * 4;
    sp[k] = 255 * grass / s; sp[k + 1] = 255 * sand / s; sp[k + 2] = 255 * rock / s; sp[k + 3] = 255 * pth / s;
  }
  const splatTex = new THREE.DataTexture(sp, SPLAT, SPLAT, THREE.RGBAFormat);
  splatTex.magFilter = splatTex.minFilter = THREE.LinearFilter;
  splatTex.needsUpdate = true;

  // grass density query used by grass.js (0..1)
  const grassAt = (x, z) => {
    const xi = Math.floor((x - DOMAIN.x0) / DOMAIN.size * SPLAT), zi = Math.floor((z - DOMAIN.z0) / DOMAIN.size * SPLAT);
    if (xi < 0 || zi < 0 || xi >= SPLAT || zi >= SPLAT) return 0;
    return sp[(zi * SPLAT + xi) * 4] / 255;
  };
  // tuft clumping for dune grass (0..1, patchy)
  const clumpAt = (x, z) => ss(0.42, 0.72, fbm(x * 0.32 + 40, z * 0.32 - 12));
  const pathDist = (x, z) => {
    const xi = Math.floor((x - DOMAIN.x0) / DOMAIN.size * SPLAT), zi = Math.floor((z - DOMAIN.z0) / DOMAIN.size * SPLAT);
    if (xi < 0 || zi < 0 || xi >= SPLAT || zi >= SPLAT) return 99;
    return pf[zi * SPLAT + xi];
  };

  // ── the far ring: the same ground, out to the haze (shares the material) ─────
  const farGeo = createFarGeometry(lite);

  // ── material: MeshStandardMaterial + splat blending ──────────────────────
  const T = textures;   // { grass:{map,normalMap}, sand, wetsand, path }
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  const uniforms = {
    uSplat: { value: splatTex },
    uDomain: { value: new THREE.Vector3(DOMAIN.x0, DOMAIN.z0, DOMAIN.size) },
    uGrass: { value: T.grass.map }, uSand: { value: T.sand.map }, uWet: { value: T.wetsand.map }, uPath: { value: T.path.map },
    uGrassN: { value: T.grass.normalMap || null }, uSandN: { value: T.sand.normalMap || null },
    uWetN: { value: T.wetsand.normalMap || null }, uPathN: { value: T.path.normalMap || null },
    uWetLine: { value: 0.5 },       // world height of the highest recent swash (water.js drives it)
    uWaterY: { value: WATER_Y },
    uGrassTint: { value: new THREE.Color(0x9cc06a) },
  };
  const useNormals = !lite && T.grass.normalMap && T.sand.normalMap;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.defines = shader.defines || {};
    if (useNormals) shader.defines.TERRAIN_NORMALS = 1;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWild;\nvarying vec3 vTW;\nvarying vec3 vTN;\nvarying vec2 vWild;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n vTN = normalize(mat3(modelMatrix) * objectNormal);\n vWild = aWild;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTW; varying vec3 vTN; varying vec2 vWild;
        uniform sampler2D uSplat, uGrass, uSand, uWet, uPath;
        #ifdef TERRAIN_NORMALS
        uniform sampler2D uGrassN, uSandN, uWetN, uPathN;
        #endif
        uniform vec3 uDomain; uniform float uWetLine, uWaterY; uniform vec3 uGrassTint;
        ${LAWN_GLSL}
        float tNoise(vec2 p){ return lwNoise(p); }
        vec4 gW; float gWet;`)
      .replace('#include <map_fragment>', `
        vec2 suv = (vTW.xz - uDomain.xy) / uDomain.z;
        #ifdef TERRAIN_FAR
        vec4 w = vec4(1.0, 0.0, 0.0, 0.0);
        #else
        vec4 w = texture2D(uSplat, suv);
        #endif
        // outside the splat's domain (the far ring): grass and beach from the shoreline alone
        if (any(lessThan(suv, vec2(0.0))) || any(greaterThan(suv, vec2(1.0)))) {
          float sd = vTW.z - (44.0 + 2.5 * sin(vTW.x * 0.05) + 1.5 * sin(vTW.x * 0.13 + 1.0));
          float sn = tNoise(vTW.xz * 0.15);
          float sa = smoothstep(-2.5 + sn * 2.5, 1.5 + sn * 2.0, sd);
          w = vec4(1.0 - sa, sa, 0.0, 0.0);
        }
        // macro variation breaks up tiling: two octaves of value noise
        float mac = tNoise(vTW.xz * 0.045) * 0.6 + tNoise(vTW.xz * 0.13) * 0.4;
        vec2 uvG = vTW.xz / 4.2, uvS = vTW.xz / 5.0, uvP = vTW.xz / 3.4;
        // grass layer: colour from the shared lawn field; the photo texture only lends detail
        // (its luminance around its own mean), so its brown patches never show through
        #ifdef TERRAIN_FAR
        float gDet = 1.0;     // the far ring: 160+ units out, texture detail is sub-pixel; colour only
        #else
        vec3 gt = texture2D(uGrass, uvG).rgb;
        vec3 gAvg = textureLod(uGrass, vec2(0.5), 12.0).rgb;
        float gDet = clamp(mix(1.0, dot(gt, vec3(0.3, 0.59, 0.11)) / max(dot(gAvg, vec3(0.3, 0.59, 0.11)), 0.02), 0.85), 0.55, 1.5);
        #endif
        float gDry = smoothstep(0.02, 0.45, w.g) * 0.45;          // lawn thins and yellows into the dune
        gDry += vWild.y * 0.16;                                    // the unmown meadow past the houses
        vec3 cg = lawnCol(vTW.xz, gDry) * gDet * mix(0.94, 1.05, mac);
        // woodland floor under the trees and treeline cards: shaded canopy green, never lawn
        {
          float fn = tNoise(vTW.xz * 0.09 + 17.0) * 0.6 + tNoise(vTW.xz * 0.31) * 0.4;
          vec3 wood = mix(vec3(0.028, 0.052, 0.020), vec3(0.060, 0.098, 0.034), fn);
          wood = mix(wood, vec3(0.040, 0.060, 0.042), smoothstep(0.62, 0.8, tNoise(vTW.xz * 0.05 + 40.0)) * 0.6);   // pine stands, bluer
          cg = mix(cg, wood, vWild.x);
        }
        #ifdef TERRAIN_FAR
        vec3 cs = textureLod(uSand, vec2(0.5), 12.0).rgb * mix(0.95, 1.05, mac) * vec3(1.12, 1.07, 0.98);
        vec3 cwT = cs * 0.7;
        #else
        vec3 cs = texture2D(uSand, uvS).rgb * mix(0.95, 1.05, mac) * vec3(1.12, 1.07, 0.98);
        vec3 cwT = texture2D(uWet, uvS * 0.9).rgb;
        #endif
        // wet sand: the SAME sand, darker and a touch cooler (no separate brown band)
        vec3 cw = mix(cs * vec3(0.64, 0.64, 0.67), cwT * 0.9, 0.25);
        #ifdef TERRAIN_FAR
        vec3 cp = vec3(0.0);
        #else
        vec3 cp = texture2D(uPath, uvP).rgb * vec3(1.02, 1.0, 0.95);
        #endif
        // granite on the point: warm/cool grey mottling, dark joints, a little lichen, wet at the foot
        float rn = tNoise(vTW.xz * 1.3) * 0.55 + tNoise(vTW.xz * 4.1 + 9.0) * 0.45;
        float joint = smoothstep(0.08, 0.0, abs(tNoise(vTW.xz * 0.9 + 3.0) - 0.5)) * 0.35;
        vec3 cr = mix(vec3(0.20, 0.19, 0.18), vec3(0.40, 0.37, 0.33), rn) * (1.0 - joint);
        cr = mix(cr, vec3(0.30, 0.31, 0.14), smoothstep(0.7, 0.9, tNoise(vTW.xz * 0.6 + 21.0)) * 0.4 * smoothstep(0.6, 1.6, vTW.y));
        // wetness: below the water line always wet; above it, the band the swash has reached
        gWet = 1.0 - smoothstep(uWetLine - 0.02, uWetLine + 0.35, vTW.y);
        cr = mix(cr, cr * 0.6, gWet);
        float sandW = w.g;
        vec3 sandCol = mix(cs, cw, gWet);
        vec3 col = cg * w.r + sandCol * sandW + cr * w.b + cp * w.a;
        col *= 1.0 - 0.04 * w.r * w.g * 4.0;
        // under the water: the bed darkens and cools with depth (the water adds the turquoise)
        float under = uWaterY - vTW.y;
        col *= mix(vec3(1.0), vec3(0.72, 0.86, 0.9), smoothstep(0.0, 2.5, under));
        gW = w;
        diffuseColor.rgb *= col;`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness;
        roughnessFactor = gW.r * 0.95 + gW.g * mix(0.9, 0.38, gWet) + gW.b * mix(0.78, 0.4, gWet) + gW.a * 0.92;`);
    if (useNormals) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
        #ifdef TERRAIN_NORMALS
        {
          vec3 ng = texture2D(uGrassN, uvG).xyz * 2.0 - 1.0;
          vec3 ns = texture2D(uSandN, uvS).xyz * 2.0 - 1.0;
          vec3 nw = texture2D(uWetN, uvS * 0.9).xyz * 2.0 - 1.0;
          vec3 np = texture2D(uPathN, uvP).xyz * 2.0 - 1.0;
          vec3 nt = normalize(ng * gW.r + mix(ns, nw, gWet) * (gW.g + gW.b) + np * gW.a + vec3(0.0, 0.0, 0.001));
          nt.xy *= 0.8;
          vec3 N = normalize(vTN);
          vec3 Tn = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
          vec3 Bn = cross(Tn, N);
          vec3 nW = normalize(Tn * nt.x - Bn * nt.y + N * nt.z);
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }
        #endif`);
    }
  };
  mat.customProgramCacheKey = () => 'dio-terrain3-' + (useNormals ? 'n' : 'l');

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'dio-terrain';
  // the far ring gets a colour-only twin of the material (no splat / detail / normal lookups)
  const farMat = mat.clone();
  farMat.onBeforeCompile = (shader, r) => { mat.onBeforeCompile(shader, r); shader.defines.TERRAIN_FAR = 1; delete shader.defines.TERRAIN_NORMALS; };
  farMat.customProgramCacheKey = () => 'dio-terrain3-far';
  const far = new THREE.Mesh(farGeo, farMat);
  far.name = 'dio-terrain-far';
  far.userData.noAO = true;
  far.receiveShadow = true;
  mesh.add(far);
  return { mesh, far, heightTex, splatTex, uniforms, grassAt, pathDist, heightAt, clumpAt };
}

function wildAttr(pos) {
  const a = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { const w = wildAt(pos.getX(i), pos.getZ(i)); a[i * 2] = w[0]; a[i * 2 + 1] = w[1]; }
  return new THREE.BufferAttribute(a, 2);
}

// Grid coordinates: `inner` spacing across [lo, hi], then steps that grow geometrically outward
// to +-`reach`, so the ring is dense where it meets the town and coarse in the haze.
function axis(lo, hi, inner, reachLo, reachHi, step0, grow, bands = []) {
  const out = [];
  for (let v = lo; v < hi - 1e-6;) { out.push(v); const b = bands.find((q) => v >= q[0] && v < q[1]); v += b ? b[2] : inner; }
  out.push(hi);
  for (let v = hi, s = step0; v < reachHi;) { v += s; s *= grow; out.push(Math.min(v, reachHi)); }
  for (let v = lo, s = step0; v > reachLo;) { v -= s; s *= grow; out.unshift(Math.max(v, reachLo)); }
  return out;
}

// The far ring: a non-uniform grid around the heightmapped square, with the square itself cut
// out. Its inner border tucks 3 units under the main terrain and 0.25 below it, so the seam
// (the two meshes' different edge tessellation) is covered from every camera above the ground.
// Seaward it stops at z=112: past that the water is deep, opaque and analytic (water.js).
function createFarGeometry(lite) {
  const R = 1150, X0 = DOMAIN.x0, X1 = DOMAIN.x0 + DOMAIN.size, Z0 = DOMAIN.z0, Z1 = DOMAIN.z0 + DOMAIN.size;
  const k = lite ? 1.6 : 1;
  const xs = axis(X0, X1, 6 * k, -R, R, 3 * k, lite ? 1.16 : 1.1);
  const zs = axis(Z0, 112, 5 * k, -R, 112, 3 * k, lite ? 1.16 : 1.1, [[22, 72, 2 * k]]);
  const zc = zs.filter((z) => z <= 112);
  const nx = xs.length, nz = zc.length;
  const pos = new Float32Array(nx * nz * 3);
  const IN = 3;   // tuck width
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = xs[i], z = zc[j], o = (j * nx + i) * 3;
    const inside = x > X0 + 1e-3 && x < X1 - 1e-3 && z > Z0 + 1e-3 && z < Z1 - 1e-3;
    pos[o] = x; pos[o + 1] = heightAt(x, z) - (inside ? 0.25 : 0); pos[o + 2] = z;
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const cx0 = xs[i], cx1 = xs[i + 1], cz0 = zc[j], cz1 = zc[j + 1];
    if (cx0 >= X0 + IN && cx1 <= X1 - IN && cz0 >= Z0 + IN && cz1 <= Z1 - IN) continue;   // under the main terrain
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('aWild', wildAttr(g.attributes.position));
  g.computeBoundingSphere();
  return g;
}
