import * as THREE from 'three';
import { shoreZ } from './terrain.js';
import { lawnColJS } from './lawn.js';
import { NO_FLIP_NORMAL } from './materials.js';

// Instanced grass in square chunks (one InstancedMesh per chunk, frustum-culled by its bounds,
// far chunks switched off). Each instance is a TUFT of thin blades, coloured from the same
// lawn field as the terrain underneath (lawn.js), so the ground carries the colour and the
// blades add fuzz and tip light, never gaps.
//
//   lawn:   mown, ~6-9 cm (0.10-0.16 units at 1.75 u/m), dense
//   edges:  path margins a little longer and drier; beach margin gets tall, straw dune grass
//   lite:   the ground texture does the work; blades only in a soft near-field ring round the
//           player (shrunk to nothing past it), so there is never a sparse field of spikes.

const CHUNK = 16;

// A tuft: `n` tapered blades (5 verts / 3 tris each) around a small disc, leaning outward.
function tuftGeometry(n, seed = 7) {
  let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const pos = [], nrm = [], hh = [], idx = [];
  for (let b = 0; b < n; b++) {
    const a = b * 2.39996 + r() * 0.8;
    const rad = 0.02 + r() * 0.06;
    const ox = Math.cos(a) * rad, oz = Math.sin(a) * rad;
    const face = a + Math.PI / 2 + (r() - 0.5) * 1.2;          // blade plane roughly tangential
    const fx = Math.cos(face), fz = Math.sin(face);
    const lean = 0.12 + r() * 0.22, lx = Math.cos(a) * lean, lz = Math.sin(a) * lean;
    const tall = 0.72 + r() * 0.28;
    const w = 0.022 + r() * 0.01;
    const base = pos.length / 3;
    const pts = [[-w, 0], [w, 0], [-w * 0.62, 0.45], [w * 0.62, 0.45], [0, 1]];
    for (const [u, v] of pts) {
      const y = v * tall;
      pos.push(ox + fx * u + lx * v * v, y, oz + fz * u + lz * v * v);
      // normals lean hard toward +Y: blades shade like the ground they sit on
      nrm.push(Math.cos(a) * 0.22, 0.95, Math.sin(a) * 0.22);
      hh.push(v);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('h', new THREE.Float32BufferAttribute(hh, 1));
  g.setIndex(idx);
  return g;
}

export function createGrass({ lite, terrain, region, exclude, rng }) {
  const density = lite ? 11 : 17;            // tufts per square unit at full coverage
  const bladesPerTuft = 3;
  const group = new THREE.Group(); group.name = 'dio-grass';
  const uniforms = {
    uTime: { value: 0 },
    uPlayer: { value: new THREE.Vector3(0, 0, 0) },
    uFade: { value: lite ? new THREE.Vector2(13, 21) : new THREE.Vector2(46, 62) },
  };
  const Mat = lite ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial;
  const mat = new Mat({ color: 0xffffff, side: THREE.DoubleSide, ...(lite ? {} : { roughness: 0.82, metalness: 0 }) });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float h; attribute vec3 iVar;     // value, dryness, (unused)
        attribute vec3 iLawn;                       // lawnCol() at the root, baked per tuft (lawn.js)
        uniform float uTime; uniform vec3 uPlayer; uniform vec2 uFade;
        varying float vH; varying vec3 vLawn; varying float vDry;`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        vH = h; vDry = iVar.y;
        vec4 wRoot = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vLawn = iLawn * iVar.x;
        mat3 gIm = mat3(instanceMatrix);
        float hI = length(gIm[1]);                      // this tuft's height (world units)
        // near-field ring (lite) / far fade (full): blades shrink into the ground, no popping
        float dP = length(wRoot.xz - uPlayer.xz);
        float fade = 1.0 - smoothstep(uFade.x, uFade.y, dP);
        transformed *= fade;
        float ph = dot(wRoot.xz, vec2(0.21, 0.17));
        float gust = sin(uTime * 1.3 + wRoot.x * 0.06 + wRoot.z * 0.03) * 0.5 + 0.5;
        float sway = (sin(uTime * 2.1 + ph) * 0.35 + gust * 0.55) * h * h;
        vec2 away = wRoot.xz - uPlayer.xz; float d = length(away);
        float push = (1.0 - smoothstep(0.4, 1.4, d)) * h * h;
        // bend scales with the blade's own height, so a lawn barely stirs and dune grass sways
        vec3 wb = (vec3(0.30, 0.0, 0.13) * sway + vec3(away.x, 0.0, away.y) / max(d, 0.001) * push * 0.6) * hI;
        wb.y -= (sway * 0.08 + push * 0.3) * hI;
        transformed += inverse(gIm) * wb * fade;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_fragment_begin>', NO_FLIP_NORMAL)
      .replace('#include <common>', `#include <common>
        varying float vH; varying vec3 vLawn; varying float vDry;
        // lite blades are Lambert, which gets no scene.environment IBL while the (Standard) ground
        // does: GRASS_GAIN stands in for that missing ambient so blades match the ground
        #define GRASS_ROOT ${lite ? '0.85' : '0.66'}
        #define GRASS_GAIN ${lite ? '1.5' : '1.0'}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // root sits at the ground's own colour (a touch darker: occlusion), tips catch the light
        float t = pow(vH, 0.85);
        vec3 c = vLawn * mix(GRASS_ROOT, 1.38, t);
        vec3 tipWarm = vec3(1.16, 1.10, 0.78);           // sun-bleached tip, stronger on dry grass
        c *= mix(vec3(1.0), tipWarm, t * t * (0.35 + 0.65 * vDry));
        diffuseColor.rgb *= c * GRASS_GAIN;`);
  };
  mat.customProgramCacheKey = () => 'dio-grass6-' + (lite ? 'l' : 'f');

  const geo = tuftGeometry(bladesPerTuft);
  const chunks = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let total = 0;
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let cz = region.z0; cz < region.z1; cz += CHUNK) {
    for (let cx = region.x0; cx < region.x1; cx += CHUNK) {
      const mats = [], vars = [], lawn = []; const lc = [0, 0, 0];
      const n = Math.round(CHUNK * CHUNK * density);
      for (let i = 0; i < n; i++) {
        const x = cx + rng() * CHUNK, z = cz + rng() * CHUNK;
        const g = terrain.grassAt(x, z);
        const ds = z - shoreZ(x);                          // <0 land, 0 = grass/sand edge
        // dune margin: a ragged band either side of the grass edge, clumped by noise
        const dune = ss(-5.5, -1.5, ds) * (1 - ss(1.2, 2.6, ds));
        const clump = terrain.clumpAt(x, z);
        const isDune = dune > 0.05 && rng() < dune * clump * 1.6;
        if (!isDune) { if (g < 0.2 || rng() > g) continue; }
        if (exclude(x, z)) continue;
        const pd = terrain.pathDist(x, z);
        const edge = ss(4.4, 3.2, pd) * g;                 // just outside the path splat
        let hgt, dry, sx;
        if (isDune) { hgt = 0.45 + rng() * 0.45; dry = 0.45 + rng() * 0.3; sx = 0.9; }
        else {
          hgt = (0.12 + rng() * 0.07) * (1 + edge * 1.0);
          dry = edge * 0.18 + ss(0.6, 0.25, g) * 0.25;     // thinning lawn near sand/rock is drier
          sx = 1.0;
        }
        if (lite) hgt *= 1.12;
        q.setFromAxisAngle(up, rng() * Math.PI * 2);
        s.set(sx, hgt, sx);
        p.set(x, terrain.heightAt(x, z) - 0.01, z);
        m4.compose(p, q, s);
        mats.push(m4.clone());
        vars.push(0.9 + rng() * 0.2, dry, 0);
        lawnColJS(x, z, dry, lc); lawn.push(lc[0], lc[1], lc[2]);
      }
      if (!mats.length) continue;
      const im = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.geometry = geo.clone();
      im.geometry.setAttribute('iVar', new THREE.InstancedBufferAttribute(new Float32Array(vars), 3));
      im.geometry.setAttribute('iLawn', new THREE.InstancedBufferAttribute(new Float32Array(lawn), 3));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.receiveShadow = !lite; im.castShadow = false;
      im.userData.center = new THREE.Vector2(cx + CHUNK / 2, cz + CHUNK / 2);
      group.add(im); chunks.push(im); total += mats.length;
    }
  }
  // chunk switch-off sits just past the shader fade (a chunk's centre is up to ~11 u from its edge)
  let maxDist = uniforms.uFade.value.y + 12;
  const _c = new THREE.Vector2();
  function update(t, player) {
    uniforms.uTime.value = t;
    uniforms.uPlayer.value.copy(player);
    _c.set(player.x, player.z);
    for (const c of chunks) c.visible = c.userData.center.distanceTo(_c) < maxDist;
  }
  // full tier on a slow device (flag.js probe -> index.js reduceQuality): the lite near-field ring
  function setNearField() { uniforms.uFade.value.set(13, 21); maxDist = uniforms.uFade.value.y + 12; }
  return { group, update, setNearField, count: total, blades: total * bladesPerTuft, chunks };
}
