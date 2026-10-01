import * as THREE from 'three';
import { seeded } from '../town/palette.js';
import { DEBUG, QA } from './flag.js';
import { createLoaders, loadManifest, loadGLB, loadEnv, loadLUT, loaded } from './assets.js';
import { normalizeMaterial, namedParts, instanced, regrade, volumetricNormals } from './materials.js';
import { createTerrain, heightAt, shoreZ, POINT, WATER_Y } from './terrain.js';
import { createWater, waveAt, foamRing } from './water.js';
import { createGrass } from './grass.js';
import { createDioramaPost } from './post.js';
import { attachAvatar } from './avatar.js';
import { createShadowRig } from './shadows.js';
import { createPerf } from './perf.js';
import { createTownBuild } from './town-build.js';
import { TRIM_ROWS } from './trim-layout.js';
import { createSky } from './sky.js';
import { createScatter, seeThrough } from './scatter.js';
import { createIslands } from './islands.js';

// The diorama renderer: the whole shoreline town rendered stylised-real (terrain, water, sky,
// buildings, nature scatter, grass, avatar, post stack), attached to an existing Town without
// changing its public behaviour: cards, prompts, nav arrows, deep links and render parking all
// still run through Town. Boot, fallback and the frame-time probe live in flag.js; the buildings,
// town filler, harbor and pack streaming in town-build.js.

// Buildings, town filler, harbor set and pack streaming: town-build.js (art / asset lane).
const TONE = { agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping };

// Resolves with { update, setMinResolution, reduceQuality, dispose }. Throws on any failure; a failure
// before the scene is committed first releases what it holds (the KTX2 worker pool, the PMREM target)
// so the classic town carries on clean.
export async function attachDiorama(town) {
  const res = { loaders: null, env: null };
  const dispose = () => {
    res.loaders?.ktx2.dispose(); res.loaders = null;
    res.env?.then((rt) => rt.dispose(), () => {}); res.env = null;
  };
  try {
    return { ...(await build(town, res)), dispose };
  } catch (err) {
    if (!town._dioCommitted) dispose();
    throw err;
  }
}

async function build(town, res) {
  const { renderer, scene, camera } = town;
  const lite = town.lite;
  const tier = lite ? 'lite' : 'full';
  const params = new URLSearchParams(location.search);
  const rng = seeded(0xd10a);
  const t0 = performance.now();

  // ── renderer ────────────────────────────────────────────────────────────
  // Neutral (Khronos PBR Neutral) over AgX: AgX washed the golden hour out and greyed the
  // signature blue; Neutral keeps both (A/B at ?tm=agx).
  const tm = params.get('tm') || 'neutral';
  renderer.toneMapping = TONE[tm] ?? THREE.NeutralToneMapping;
  renderer.toneMappingExposure = tm === 'neutral' ? 1.1 : 1.16;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;

  // ── load everything in parallel ─────────────────────────────────────────
  const loaders = res.loaders = await createLoaders(renderer);
  const manifest = await loadManifest();
  const L = (id) => loadGLB(loaders, manifest, id, tier);
  // core assets only; the green / houses are core too (town-build.js), landmarks stream
  // (the green and the houses load here too, so any core failure lands before the scene commits)
  res.env = loadEnv(renderer, manifest, tier);
  const [envRT, lut, blib, tlib, avatar, nature, props, green, houses] = await Promise.all([
    res.env, loadLUT(manifest, tier),
    L('buildings-matlib'), L('terrain-matlib'), L('avatar'), L('nature'), L('props'), L('green'), L('houses'),
  ]);

  // ── light: IBL for ambient + reflections; the classic sky dome stays the background ─────
  // COMMITTED: from the first scene mutation on, a failure can't hand the classic town back in
  // place (the sky dome swap below, the classic town hidden in town-build.js), so flag.js reloads
  // into it instead. Everything above is loading only; flag.js snapshots renderer + lights.
  town._dioCommitted = true;
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.95;
  scene.environmentRotation.set(0, -1.9, 0);   // puts the HDRI's low sun roughly behind the key light
  let sun = null, hemi = null;
  scene.traverse((o) => { if (o.isDirectionalLight) sun = o; if (o.isHemisphereLight) hemi = o; });
  // fill lifted so sun-averted walls (the Veoci front) read as a lit building, not a dark box
  if (hemi) hemi.intensity = 0.8;
  if (sun) { sun.intensity = 2.7; sun.shadow.radius = 3; sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.035; }

  const world = town.world;

  // ── sky + haze: the camera-riding dome replaces the classic fixed one ──────
  for (const o of world.group.children) if (o.renderOrder === -1 && o.material?.isShaderMaterial) o.visible = false;
  const sky = createSky({ scene, camera, sunDir: town.sunDir, lite });

  // ── material library ─────────────────────────────────────────────────────
  const lib = {};
  blib.scene.traverse((o) => { if (o.isMesh) lib[o.material.name] = normalizeMaterial(o.material); });
  const tmats = {};
  tlib.scene.traverse((o) => { if (o.isMesh) tmats[o.material.name] = o.material; });
  for (const m of Object.values(tmats)) {
    for (const k of ['map', 'normalMap']) if (m[k]) { m[k].wrapS = m[k].wrapT = THREE.RepeatWrapping; m[k].anisotropy = 8; m[k].needsUpdate = true; }
  }
  for (const m of Object.values(lib)) {
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) { m[k].wrapS = m[k].wrapT = THREE.RepeatWrapping; m[k].needsUpdate = true; }
    if (lite) { m.normalMap = null; m.needsUpdate = true; }
  }

  if (lib.M_Trim) glassTrim(lib.M_Trim);

  // ── the town: classic hidden, core buildings placed, landmark packs queued ─────
  const built = createTownBuild({ town, scene, loaders, manifest, tier, lite, lib, heightAt, WATER_Y, POINT, waveAt, foamRing, rng });

  // ── terrain + water ─────────────────────────────────────────────────────
  const T = (n) => ({ map: tmats[n]?.map, normalMap: lite ? null : tmats[n]?.normalMap });
  const terrain = createTerrain({ lite, path: world.path, textures: { grass: T('T_Grass'), sand: T('T_Sand'), wetsand: T('T_WetSand'), path: T('T_Path') } });
  scene.add(terrain.mesh);
  const water = createWater({ lite, heightTex: terrain.heightTex });
  scene.add(water.group);

  await built.core({ props, green, houses });

  // ── nature + props (instanced) ──────────────────────────────────────────
  const np = namedParts(nature.scene);
  const pp = namedParts(props.scene);
  for (const parts of [...Object.values(np), ...Object.values(pp)]) for (const p of parts) {
    normalizeMaterial(p.material, { tint: 0.05 });
    if (lite && p.material.normalMap) { p.material.normalMap = null; p.material.needsUpdate = true; }
    if (p.material.alphaTest === 0 && p.material.transparent) { p.material.transparent = false; p.material.alphaTest = 0.5; }
    p.material.side = p.material.alphaTest > 0 ? THREE.DoubleSide : p.material.side;
  }
  // Quaternius foliage is cartoon-bright (leaf texture has zero blue); pull it to New England
  // summer greens, grey the orange bark, and calm the photo-scan rocks' contrast so the two kits
  // meet in the middle. Leaf cards get crown-volume normals.
  const FOLIAGE = /leaves|leaf|flowers/i;
  const done = new Set();
  for (const parts of Object.values(np)) for (const p of parts) {
    const m = p.material, n = m.name;
    if (FOLIAGE.test(n)) volumetricNormals(p.geometry, /pine/i.test(n) ? 0.6 : 0.75);
    if (done.has(m)) continue; done.add(m);
    if (FOLIAGE.test(n)) { m.alphaTest = 0.45; m.roughness = 0.85; }
    if (/flowers/i.test(n)) regrade(m, { flat: true, noFlip: true, mul: [1, 1, 1], key: 'flw' });                     // hue per instance (scatter.js)
    else if (/pine/i.test(n)) regrade(m, { sat: 0.5, con: 0.9, noFlip: true, mul: [0.62, 0.78, 0.95], key: 'pine' });  // white-pine blue-green
    else if (/leaves/i.test(n)) regrade(m, { sat: 0.66, con: 0.9, noFlip: true, mul: [0.8, 0.84, 0.8], key: 'lvs' });  // summer maple / oak green (W2: less blue)
    else if (/bark/i.test(n)) regrade(m, { sat: 0.22, con: 0.9, mul: [0.56, 0.54, 0.52], key: 'bark' });  // grey-brown
  }
  for (const parts of Object.values(pp)) for (const p of parts) {
    const m = p.material;
    if (done.has(m) || !/rock/i.test(m.name)) continue; done.add(m);
    regrade(m, { sat: 0.8, con: 0.72, mul: [1.08, 1.06, 1.02], key: 'rock' });
    if (m.normalScale) m.normalScale.multiplyScalar(0.7);
    m.roughness = Math.max(m.roughness, 0.8);
  }
  const blocked = (x, z, pad = 0) => {
    if (terrain.pathDist(x, z) < 3.6 + pad) return true;
    if (built.blocked(x, z, pad)) return true;
    for (const it of town.landmarks.interactables) if (Math.hypot(x - it.approach.x, z - it.approach.z) < 3 + pad) return true;
    return false;
  };
  const M = (x, y, z, s, yaw) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));
  // ── trees, shrubs, the woods and the far treeline (scatter.js) ───────────
  const scatter = createScatter({ np, lite, rng, renderer, town, pathDist: terrain.pathDist, blocked, samples: world.path.samples, footprints: built.footprints });
  const islands = createIslands({ rng, lite });
  scene.add(islands.mesh);
  scatter.addCards(islands.pines.map((p) => ({ x: p.x, y: p.y, z: p.z, s: p.s, v: 3, c: new THREE.Color(0.8, 0.86, 0.84) })));
  scatter.buildCards();
  scene.add(scatter.group);
  // after the atlas bake: trees between the follow camera and the player dissolve
  const stDone = new Set();
  for (const k of ['commontree_3', 'commontree_5', 'pine_2']) for (const p of np[k] || []) if (!stDone.has(p.material)) { stDone.add(p.material); seeThrough(p.material, { cam: camera.position, player: town.player.position }); }
  const treeObs = scatter.trunks;

  // rocks: a scatter along the tide line and a heap on the lighthouse point
  const rockLists = { rock1: [], rock2: [], rock3: [], rock4: [], rock5: [] };
  for (let i = 0; i < (lite ? 18 : 34); i++) {
    const onPoint = i % 3 === 0;
    let x, z;
    if (onPoint) { const a = rng() * 6.28, r = 3.5 + rng() * 6; x = POINT.x + Math.cos(a) * r; z = POINT.z + Math.sin(a) * r; }
    else { x = -40 + rng() * 115; z = shoreZ(x) + 3 + rng() * 5; if (Math.abs(x - 12) < 7) continue; }
    const k = 'rock' + (1 + (i % 5));
    rockLists[k].push(M(x, heightAt(x, z) - 0.2, z, onPoint ? 0.45 + rng() * 0.5 : 0.25 + rng() * 0.35, rng() * 6.28));
  }
  for (const [k, list] of Object.entries(rockLists)) if (list.length && pp[k]) scene.add(instanced(pp[k], list));
  // ── grass ───────────────────────────────────────────────────────────────
  const grass = createGrass({
    lite, terrain, rng,
    region: { x0: -40, x1: 80, z0: 14, z1: 56 },   // lite draws only a near-field ring of it (grass.js)
    exclude: (x, z) => blocked(x, z, -1.2) || treeObs.some((o) => Math.hypot(o.x - x, o.z - z) < 1.2),
  });
  scene.add(grass.group);
  // AO pass diet (post.js): blades and the classic landmark furniture (signs, rings, beacons)
  // add draw calls to GTAO's re-render but no visible occlusion at its 2.4-unit radius
  grass.group.userData.noAO = true;
  town.landmarks.group.userData.noAO = true;

  // ── the avatar ──────────────────────────────────────────────────────────
  const av = attachAvatar(town.player, avatar, { lite });
  if (!lite) town.blob.visible = false;

  // ── post + LUT ──────────────────────────────────────────────────────────
  const post = createDioramaPost(renderer, scene, camera, { lite });
  post.setLut(lut.texture3D, lut.size);
  town.post = post;

  // ── shadows + performance ───────────────────────────────────────────────
  const shadows = createShadowRig({ renderer, scene, sun, lite });
  const perf = createPerf({ town, post, lite, debug: DEBUG });

  const setupMs = performance.now() - t0;

  // ── per-frame ───────────────────────────────────────────────────────────
  const pos = town.player.position;
  // ── masonry grade: the masonry library streams in with the first brick landmark ──
  // UConn, the Lambda mill and the Gateway hall share one M_Brick. Its hue sat at ~20 deg, so in
  // the warm key it went orange (the mill) and in the cool fill it went brown (Gateway, UConn):
  // three bricks. Pulled toward a true colonial red (~12 deg) with a touch less chroma, lit and
  // shaded faces read as the same brick. Yale's ashlar is lifted a little out of the mud.
  let masonryDone = false;
  function gradeMasonry() {
    if (masonryDone || !lib.M_Brick) return;
    regrade(lib.M_Brick, { sat: 0.9, con: 0.96, mul: [1.04, 0.84, 0.82], key: 'brick' });
    if (lib.M_Ashlar) regrade(lib.M_Ashlar, { sat: 0.85, con: 0.92, mul: [1.12, 1.1, 1.06], key: 'ashlar' });
    masonryDone = true;
  }

  function update(dt, t) {
    perf.beginFrame();
    gradeMasonry();
    pos.y = heightAt(pos.x, pos.z);
    if (lite) town.blob.position.y = pos.y + 0.04;
    av.update(dt);
    const wet = water.update(dt, t);
    terrain.uniforms.uWetLine.value = wet;
    grass.update(t, pos);
    built.update(dt, t);
    shadows.update(pos, town.player.velocity);
    post.beforeRender(camera.position.distanceTo(pos));
  }

  // Frame-time fallback, full tier (flag.js): lite settings on the full build. GTAO off, the lite
  // grass ring, a lower DPR cap with dynamic resolution on.
  let quality = 'full';
  function reduceQuality() {
    if (quality === 'reduced') return;
    quality = 'reduced';
    if (post.gtao) post.gtao.enabled = false;
    grass.setNearField();
    perf.reduce();
  }

  // QA / metrics hooks (?qa=1 or ?debug=1 only).
  if (QA) window.__diorama = {
    tier, tm, setupMs, scene, town,
    cam: () => ({ pos: camera.position.toArray().map((v) => +v.toFixed(2)), fov: camera.fov, aspect: +camera.aspect.toFixed(3), pitch: town.camPitch, dist: town.camDist, yaw: town.camYaw, player: pos.toArray().map((v) => +v.toFixed(2)) }),
    census() {
      const out = { classicWorld: 0, classicLandmarks: 0, diorama: 0, grass: 0, shadowCasters: 0, byName: {} };
      scene.traverseVisible((o) => {
        if (!o.isMesh && !o.isSprite) return;
        let cat = 'diorama';
        for (let q = o; q; q = q.parent) { if (q === world.group) { cat = 'classicWorld'; break; } if (q === town.landmarks.group) { cat = 'classicLandmarks'; break; } if (q === grass.group) { cat = 'grass'; break; } }
        out[cat]++; if (o.castShadow) out.shadowCasters++;
        const k = cat + ':' + (o.name || o.geometry?.type || '?'); out.byName[k] = (out.byName[k] || 0) + 1;
      });
      return out;
    },
    stats: () => ({ ...perf.stats(), tier, quality, payloadBytes: loaded.bytes, files: loaded.files, grassBlades: grass.blades, grassTufts: grass.count }),
    measure: (ms) => perf.measure(ms),
    pose({ x, z, yaw, pitch, dist, face }) {
      const p = town.player;
      p.position.set(x, heightAt(x, z), z); p.moveTarget = null; p.velocity.set(0, 0, 0);
      if (face !== undefined) { p.heading = face; p.group.rotation.y = face; }
      if (yaw !== undefined) town.camYaw = yaw;
      if (pitch !== undefined) town.camPitch = pitch;
      if (dist !== undefined) town.camDist = dist;
      town._lift = 0;
      town._updateCamera(1, true);
      shadows.force();
    },
    landmarkPose(id, extra = {}) {
      const it = town.landmarks.interactables.find((i) => i.id === id);
      const face = Math.atan2(it.x - it.approach.x, it.z - it.approach.z);
      this.pose({ x: it.approach.x, z: it.approach.z, face, yaw: face + (it.viewYaw || 0), pitch: it.viewPitch ?? town.camPitchDefault, dist: it.viewDist ?? town.camDistDefault, ...extra });
      if (extra.dist === undefined && extra.pitch === undefined) { town._lift = it.viewLift || 0; town._liftHold = true; town._updateCamera(1, true); }   // the hop's framing
      return { x: it.approach.x, z: it.approach.z, face };
    },
    walk(on, speed = 9.5) {   // fake a walking state for mid-walk captures
      const p = town.player;
      if (on) { p.velocity.set(Math.sin(p.heading) * speed, 0, Math.cos(p.heading) * speed); } else p.velocity.set(0, 0, 0);
    },
  };
  return { update, setMinResolution: () => perf.setMinScale(), reduceQuality };
}

// Trim-sheet glass and lit-interior rows (UV bands from the art lane's trim_layout.json; glTF v
// is not flipped by GLTFLoader). The office faces away from the sun and looks DOWN at its glass
// from the follow cam, so the real reflection is mostly ground: fake the sky a camera at street
// level would see (Fresnel-weighted), and let the interior glow warm, so the office reads as a
// welcoming, occupied building at golden hour. Also brightens the house windows (same rows).
function glassTrim(m) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      #ifdef USE_MAP
      {
        float tv = vMapUv.y - floor(vMapUv.y);
        float gGlass = step(${TRIM_ROWS.glass[0]}, tv) * step(tv, ${TRIM_ROWS.glass[1]});
        float gInt = step(${TRIM_ROWS.interior[0]}, tv) * step(tv, ${TRIM_ROWS.interior[1]});
        if (gGlass + gInt > 0.0) {
          float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
          vec3 sky = mix(vec3(0.95, 0.74, 0.52), vec3(0.42, 0.62, 0.9), 0.72);
          totalEmissiveRadiance += gGlass * sky * (0.12 + 0.55 * fres);
          totalEmissiveRadiance += gInt * (diffuseColor.rgb * vec3(1.8, 1.3, 0.8) * 0.42 + sky * (0.04 + 0.4 * fres));
        }
      }
      #endif`);
  };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => (key ? key() : '') + '-glass';
  m.needsUpdate = true;
}
