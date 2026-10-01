import * as THREE from 'three';
import { instanced } from './materials.js';
import { heightAt, shoreZ, wildAt, fbm, TOWN_C, DOMAIN } from './terrain.js';
import { bakeTreeAtlas, createCards, CARD_VARIANTS } from './treeline.js';

// Nature scatter (W2): a New England town under its trees.
//
//   lane      big shade trees in rows along both sides of the lane
//   yards     shade trees in the gaps between the houses of the outer ring
//   green     a few specimen trees on the green itself
//   shore     the existing scatter between the shore houses and the harbor
//   woods     pine and mixed clusters behind the houses, thickening into the woods' edge
//   shrubs    flowering foundation plantings: hydrangea (blue, white) and beach rose
//   treeline  impostor cards from the woods' edge up into the hills and the islands' pines
//
// The kit (Stylized Nature) only has Common, Twisted, Dead and Pine families and the core asset
// carries commontree_3 / commontree_5 / pine_2 / bush_common. The Common trees become the shade
// trees: scaled to 2-3 storeys (the kit's commontree_3 is 16.5 units tall at 1:1, ~9.4 m) and
// widened 30% so the crown reads as a maple or oak, not a poplar.
//
// Everything is instanced (one InstancedMesh per primitive per kind). Every candidate is checked
// against `blocked` (buildings, yards, lamps, benches, the lane, every landmark's approach) and
// every landmark's follow-camera corridor, so no view or sign is covered. Trees that do end up
// between the camera and the player while walking dissolve (screen-door) instead of filling the
// frame: see seeThrough().

const TAU = Math.PI * 2;
const ss01 = (v, a, b) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const M = (x, y, z, s, yaw, widen = 1) => new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromAxisAngle(Y, yaw), _s.set(s * widen, s, s * widen));

export function createScatter({ np, lite, rng, renderer, town, pathDist, blocked, samples, camera, player, footprints = [] }) {
  const group = new THREE.Group(); group.name = 'dio-scatter';
  const L = town.landmarks.interactables;

  // ── camera corridors: approach -> follow camera (pitch 0.45..0.6, dist up to 42) + approach -> building
  const segD = (x, z, a, b) => { const vx = b.x - a.x, vz = b.z - a.z; const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz || 1))); return Math.hypot(x - a.x - vx * t, z - a.z - vz * t); };
  const corridors = [];
  for (const it of L) {
    const f = it.id === 'intro' ? -1.816 : Math.atan2(it.x - it.approach.x, it.z - it.approach.z);
    const a = { x: it.approach.x, z: it.approach.z };
    corridors.push({ a, b: { x: a.x - Math.sin(f) * 40, z: a.z - Math.cos(f) * 40 }, w: 9 });
    corridors.push({ a, b: { x: it.x, z: it.z }, w: 11 });   // the whole facade, not just the door
  }
  // and the whole front of every landmark: full facade width + 3, out 18 units from the wall
  const fronts = L.map((it) => it._rect).filter(Boolean);
  const inFront = (x, z, pad = 0) => fronts.some((r) => {
    const dx = x - r.x, dz = z - r.z, fx = Math.sin(r.face), fz = Math.cos(r.face);
    const along = dx * fx + dz * fz, across = dx * fz - dz * fx;
    return Math.abs(across) < r.hw + 3 + pad && along > r.front - 1 && along < r.front + 18 + pad;
  });
  const inCorridor = (x, z, pad = 0) => inFront(x, z, pad) || corridors.some((c) => segD(x, z, c.a, c.b) < c.w + pad);
  const onLand = (x, z, m = 4) => z < shoreZ(x) - m;
  const ok = (x, z, pad) => onLand(x, z) && !blocked(x, z, pad) && !inCorridor(x, z);

  // ── placements ───────────────────────────────────────────────────────────
  // one set: town and woods share each kind's InstancedMesh (fewer draws in every pass)
  const town3 = { commontree_3: [], commontree_5: [], pine_2: [] };
  const wood3 = town3;
  const tint3 = new Map();                                               // list -> colours
  const trunks = [];                                                     // for spacing + obstacles
  const far = (x, z, d) => trunks.every((t) => Math.hypot(t.x - x, t.z - z) >= d);
  // summer greens: maples lean yellow-green, oaks deeper, a few blue-green; value +-12%
  const leafTint = (kind) => {
    const v = 0.9 + rng() * 0.22, h = rng();
    if (kind === 'pine_2') return new THREE.Color(v * 0.96, v, v * 1.02);
    if (h < 0.3) return new THREE.Color(v * 1.1, v * 1.04, v * 0.82);   // sugar maple / linden: warmer
    if (h < 0.75) return new THREE.Color(v, v, v * 0.92);
    return new THREE.Color(v * 0.86, v * 0.95, v * 0.98);                // oak: deeper, cooler
  };
  const put = (set, kind, x, z, s, { widen = 1.3, obstacle = true, sink = 0.25 } = {}) => {
    const list = set[kind];
    list.push(M(x, heightAt(x, z) - sink, z, s, rng() * TAU, widen));
    if (!tint3.has(list)) tint3.set(list, []);
    tint3.get(list).push(leafTint(kind));
    trunks.push({ x, z });
    if (obstacle) town.world.obstacles.push({ x, z, r: 1.1 });
  };
  const shade = () => (rng() < 0.62 ? 'commontree_3' : 'commontree_5');
  const shadeScale = (k) => (k === 'commontree_3' ? 0.86 + rng() * 0.26 : 1.12 + rng() * 0.3);   // 14-18 units

  // lane: both sides of the lane, a tree every ~12-14 units
  {
    const step = lite ? 19 : 12.5, off = 7.2;
    let acc = step * 0.5;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      acc += Math.hypot(b.x - a.x, b.z - a.z);
      if (acc < step) continue;
      acc = 0;
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      for (const side of [-1, 1]) {
        const j = (rng() - 0.5) * 2.5;
        const x = b.x + (-dz / l) * off * side + (dx / l) * j, z = b.z + (dx / l) * off * side + (dz / l) * j;
        if (pathDist(x, z) < 5.4 || !ok(x, z, 1.2) || !far(x, z, 9)) continue;
        const k = shade(); put(town3, k, x, z, shadeScale(k));
      }
    }
  }
  // green: a few specimen trees, kept well inside the lane and out of every view
  {
    let n = 0;
    for (let t = 0; t < 400 && n < (lite ? 3 : 4); t++) {
      const a = rng() * TAU, r = 10 + rng() * 26;
      const x = 4 + Math.cos(a) * r, z = -14 + Math.sin(a) * r;
      if (pathDist(x, z) < 11 || !ok(x, z, 3) || !far(x, z, 16) || Math.hypot(x, z) < 12) continue;
      put(town3, 'commontree_3', x, z, 1.0 + rng() * 0.18, { widen: 1.45 }); n++;
    }
  }
  // yards: gaps between the ring houses (r 50..100 about the green)
  {
    let n = 0;
    for (let t = 0; t < 2400 && n < (lite ? 10 : 24); t++) {
      const a = rng() * TAU, r = 52 + rng() * 46;
      const x = TOWN_C.x + Math.cos(a) * r, z = TOWN_C.z + Math.sin(a) * r * 0.9;
      if (pathDist(x, z) < 6 || !ok(x, z, 2.2) || !far(x, z, 10)) continue;
      const k = rng() < 0.18 ? 'pine_2' : shade();
      put(town3, k, x, z, k === 'pine_2' ? 1.0 + rng() * 0.3 : shadeScale(k), { widen: k === 'pine_2' ? 0.85 : 1.3 }); n++;
    }
  }
  // shore: between the shore houses and the harbor / Veoci (the W0 scatter, grown up)
  {
    let n = 0;
    for (let t = 0; t < 1200 && n < (lite ? 8 : 14); t++) {
      const x = -60 + rng() * 140, z = 6 + rng() * 36;
      if (z > shoreZ(x) - 8 || pathDist(x, z) < 6 || !ok(x, z, 2.5) || !far(x, z, 9)) continue;
      const k = rng() < 0.3 ? 'pine_2' : shade();
      put(town3, k, x, z, k === 'pine_2' ? 0.85 + rng() * 0.3 : shadeScale(k) * 0.9, { widen: k === 'pine_2' ? 0.85 : 1.3 }); n++;
    }
  }
  // woods: clusters behind the houses (r 88..132), thickening into the woods' edge
  {
    let n = 0;
    for (let t = 0; t < 6000 && n < (lite ? 26 : 80); t++) {
      const a = rng() * TAU, r = 86 + rng() * 48;
      const x = TOWN_C.x + Math.cos(a) * r, z = TOWN_C.z + Math.sin(a) * r;
      if (x < DOMAIN.x0 + 4 || x > DOMAIN.x0 + DOMAIN.size - 4 || z < DOMAIN.z0 + 4) continue;
      const clump = fbm(x * 0.045 + 2, z * 0.045 - 5), [forest] = wildAt(x, z);
      if (clump < 0.46 - forest * 0.25 || !onLand(x, z, 14) || blocked(x, z, 3) || inCorridor(x, z) || !far(x, z, 6.5)) continue;
      const k = rng() < 0.42 + 0.2 * (1 - clump) ? 'pine_2' : shade();
      put(wood3, k, x, z, k === 'pine_2' ? 1.05 + rng() * 0.45 : shadeScale(k), { widen: k === 'pine_2' ? 0.8 : 1.3, obstacle: false }); n++;
    }
  }

  // ── build the 3D trees ───────────────────────────────────────────────────
  const leafy = (p) => /leaves|leaf/i.test(p.material.name);
  for (const [k, list] of Object.entries(town3)) {
    if (!list.length || !np[k]) continue;
    const g = instanced(np[k], list, { colors: tint3.get(list), colorIf: leafy });
    g.name = 'dio-trees-' + k;
    group.add(g);
  }

  // shrubs: foundation plantings round every building, plus the shore roses
  {
    const mats = [], leaf = [], flw = [];
    const FLOWER = [[0.26, 0.36, 0.7], [0.3, 0.42, 0.78], [0.78, 0.78, 0.72], [0.52, 0.27, 0.34], [0.44, 0.34, 0.64]];   // hydrangea blues, white, rose, lavender
    const fps = footprints;                       // building footprints (town-build.js), after the core build
    const add = (x, z, s, fl) => {
      mats.push(M(x, heightAt(x, z) - 0.1, z, s, rng() * TAU));
      const v = 0.9 + rng() * 0.2; leaf.push(new THREE.Color(v, v, v * 0.92));
      flw.push(new THREE.Color(...FLOWER[fl]));
    };
    const target = lite ? 22 : 56;
    for (let t = 0, n = 0; t < 3000 && n < target && fps.length; t++) {
      const r = fps[Math.floor(rng() * fps.length)];
      const fx = Math.sin(r.face), fz = Math.cos(r.face), rx = fz, rz = -fx;
      // a spot hugging the wall: along a side or the front corners (never the door)
      const side = rng();
      let along, across;
      if (side < 0.5) { along = -r.back + rng() * (r.back + r.front); across = (rng() < 0.5 ? -1 : 1) * (r.hw + 1.6 + rng() * 0.8); }
      else { across = (rng() < 0.5 ? -1 : 1) * (r.hw * (0.45 + rng() * 0.5)); along = r.front + 1.4 + rng() * 0.6; }
      const x = r.x + fx * along + rx * across, z = r.z + fz * along + rz * across;
      if (!onLand(x, z, 3) || pathDist(x, z) < 4.2 || blocked(x, z, -0.6) || inCorridor(x, z, -5)) continue;
      if (mats.some((m) => Math.hypot(m.elements[12] - x, m.elements[14] - z) < 2.6)) continue;
      add(x, z, 0.55 + rng() * 0.35, Math.floor(rng() * 3) === 0 ? 2 : (rng() < 0.5 ? 0 : (rng() < 0.6 ? 1 : 4))); n++;
    }
    // beach roses on the bank above the harbor
    for (let t = 0, n = 0; t < 800 && n < (lite ? 10 : 18); t++) {
      const x = -50 + rng() * 125, z = shoreZ(x) - 3 - rng() * 9;
      if (pathDist(x, z) < 4.6 || blocked(x, z, 1) || inCorridor(x, z, -4)) continue;
      add(x, z, 0.6 + rng() * 0.45, 3); n++;
    }
    const parts = np.bush_common || [];
    const lp = parts.filter(leafy), fp = parts.filter((p) => !leafy(p));
    if (mats.length) {
      if (lp.length) group.add(instanced(lp, mats, { colors: leaf }));
      if (fp.length) group.add(instanced(fp, mats, { colors: flw }));
    }
  }

  // ── treeline cards: the woods' edge, up the hills, into the haze ─────────
  const atlas = bakeTreeAtlas(renderer, np);
  const cards = [];
  // wider spread than the 3D trees: from far off, species read as patches of different greens
  const cardTint = (pine, x, z) => {
    const patch = fbm(x * 0.04 + 3, z * 0.04 - 8) - 0.5, v = (0.84 + rng() * 0.26) * (1 + patch * 0.35), h = rng() - 0.5 + patch;
    return pine ? new THREE.Color(v * 0.92, v, v * 1.02) : new THREE.Color(v * (1 + h * 0.22), v * (1 + h * 0.05), v * (1 - h * 0.3));
  };
  {
    // jittered polar rings: spacing grows with distance (and the cards with it), so the density
    // on screen stays roughly even while the count stays small
    const R0 = 118, R1 = lite ? 500 : 680;
    for (let r = R0; r < R1;) {
      const sp = (lite ? 2.1 : 1) * (6 + (r - R0) * 0.05);   // lite: under half the cards, each a little bigger
      const n = Math.floor(TAU * r / sp);
      for (let i = 0; i < n; i++) {
        const a = (i + rng() * 0.8) / n * TAU, rj = r + (rng() - 0.5) * sp;
        const x = TOWN_C.x + Math.cos(a) * rj, z = TOWN_C.z + Math.sin(a) * rj;
        const [forest] = wildAt(x, z);
        if (forest < 0.5 || !onLand(x, z, 18)) continue;
        if (r < 150 && (trunks.some((t) => Math.hypot(t.x - x, t.z - z) < 5) || inCorridor(x, z) || blocked(x, z, 4))) continue;
        if (r > 140 && rng() < ss01(fbm(x * 0.022 - 17, z * 0.022 + 4), 0.45, 0.62) * 0.7) continue;   // open woodland
        const pineZone = fbm(x * 0.02 + 30, z * 0.02) > 0.52;
        const v = pineZone ? (rng() < 0.7 ? 3 : Math.floor(rng() * 3)) : (rng() < 0.15 ? 3 : Math.floor(rng() * 3));
        const s = (0.95 + rng() * 0.4) * (1 + (r - R0) / 700) * (lite ? 1.15 : 1);
        cards.push({ x, y: heightAt(x, z) - 2.2 * s, z, s, v, c: cardTint(v === 3, x, z) });   // sunk: trunks hide in the understorey
      }
      r += sp * 0.9;
    }
  }
  return { group, cards, atlas, trunks, addCards: (list) => cards.push(...list), buildCards: () => { const m = createCards(atlas, cards); group.add(m); return m; }, variants: CARD_VARIANTS };
}

// Trees between the follow camera and the player dissolve (screen-door, 4x4 Bayer-free IGN) so a
// street-tree canopy never fills the frame while walking. Shadows are untouched.
export function seeThrough(material, { cam, player }) {
  const prev = material.onBeforeCompile;
  const u = { stCam: { value: cam }, stPlayer: { value: player } };
  material.onBeforeCompile = (shader, r) => {
    prev?.call(material, shader, r);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 sw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          sw = instanceMatrix * sw;
          #endif
          vStW = (modelMatrix * sw).xyz; }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 stCam, stPlayer; varying vec3 vStW;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          vec3 P = stPlayer + vec3(0.0, 2.2, 0.0), v = P - stCam;
          float L2 = max(dot(v, v), 1e-3), L = sqrt(L2);
          float t = clamp(dot(vStW - stCam, v) / L2, 0.0, 1.0);
          float d = length(vStW - (stCam + v * t));
          float R = mix(7.0, 3.2, t);
          float fade = (1.0 - smoothstep(R * 0.55, R, d)) * (1.0 - smoothstep(L - 5.0, L - 2.5, t * L));
          fade = max(fade, 1.0 - smoothstep(5.0, 10.0, length(vStW - stCam)));
          float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (ign < fade * 0.97) discard;
        }`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (key ? key() : '') + '-st';
  material.needsUpdate = true;
  return material;
}
