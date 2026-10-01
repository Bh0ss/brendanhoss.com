import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { LUTCubeLoader } from 'three/addons/loaders/LUTCubeLoader.js';

// Asset loading for the diorama: manifest-driven, tiered (full | lite), KTX2 + meshopt.
// Decoders live in public/ (copied by scripts/optimize-assets.mjs) and are fetched only here.
//
// Failures are loud on purpose: GLTFLoader swallows a texture that fails to decode (the mesh loads
// untextured), so loadGLB checks every texture resolved, and createLoaders fetches the KTX2
// transcoder up front. A throw here before the scene is committed sends the site to the classic
// town (flag.js).

export async function createLoaders(renderer) {
  const ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
  try {
    const [{ MeshoptDecoder }] = await Promise.all([
      import(/* @vite-ignore */ `${location.origin}/meshopt/meshopt_decoder.module.js`),
      ktx2.init(),                                 // transcoder JS + wasm: rejects if either fails
    ]);
    await MeshoptDecoder.ready;
    const gltf = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
    return { gltf, ktx2 };
  } catch (err) {
    ktx2.dispose();                                // its worker pool, on the way to the classic town
    throw err;
  }
}

export async function loadManifest() {
  const r = await fetch('/assets/v1/manifest.json');
  if (!r.ok) throw new Error('diorama manifest missing: run npm run assets');
  return r.json();
}

// Byte accounting for the debug HUD / metrics (what this page actually downloaded).
export const loaded = { bytes: 0, files: [] };
function note(url, bytes) { loaded.bytes += bytes; loaded.files.push({ url, bytes }); }

// Load progress for the preloader: bytes received / bytes expected (from the manifest) over every
// load started while a listener is attached (the core set, plus a deep-linked landmark's pack).
let progressCb = null;
const prog = { expected: 0, got: new Map() };
export function onLoadProgress(cb) { progressCb = cb; if (!cb) { prog.expected = 0; prog.got.clear(); } }
function track(url, bytes) {
  if (!progressCb) return undefined;
  prog.expected += bytes; prog.got.set(url, 0);
  return (e) => {
    if (!progressCb) return;
    prog.got.set(url, Math.min(bytes, e.loaded || 0));
    let got = 0; for (const v of prog.got.values()) got += v;
    progressCb(prog.expected ? got / prog.expected : 0);
  };
}
function finish(url, bytes) {
  if (!progressCb || !prog.got.has(url)) return;
  prog.got.set(url, bytes);
  let got = 0; for (const v of prog.got.values()) got += v;
  progressCb(prog.expected ? got / prog.expected : 0);
}

export async function loadGLB(loaders, manifest, id, tier) {
  const a = manifest.assets.find((x) => x.id === id);
  if (!a) throw new Error('unknown asset ' + id);
  const t = a.tiers[tier];
  note(t.url, t.bytes);
  const gltf = await loaders.gltf.loadAsync(t.url, track(t.url, t.bytes));
  finish(t.url, t.bytes);
  const n = gltf.parser.json.textures?.length || 0;
  if (n) {
    const tex = await Promise.all(Array.from({ length: n }, (_, i) => gltf.parser.getDependency('texture', i).catch(() => null)));
    const bad = tex.filter((x) => !x).length;
    if (bad) throw new Error(`${id}: ${bad} of ${n} textures failed to decode`);
  }
  return gltf;
}

// Returns the PMREM render target (scene.environment = rt.texture); the caller disposes it.
export async function loadEnv(renderer, manifest, tier) {
  const f = manifest.files.env.tiers[tier];
  note(f.url, f.bytes);
  const hdr = await new RGBELoader().loadAsync(f.url, track(f.url, f.bytes));
  finish(f.url, f.bytes);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  try { return pmrem.fromEquirectangular(hdr); } finally { hdr.dispose(); pmrem.dispose(); }
}

export async function loadLUT(manifest, tier) {
  const f = manifest.files.grade.tiers[tier];
  note(f.url, f.bytes);
  const lut = await new LUTCubeLoader().loadAsync(f.url, track(f.url, f.bytes));
  finish(f.url, f.bytes);
  return lut;
}
