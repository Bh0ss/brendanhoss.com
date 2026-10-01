#!/usr/bin/env node
// Diorama asset pipeline (W1).
//
//   node scripts/optimize-assets.mjs [--src ~/Documents/brendanhoss-art/build]
//   node scripts/optimize-assets.mjs --check        (npm run assets -- --check)
//
// --check: fast and non-writing (no Blender exports, no toktx). Validates public/assets/v1 against
// manifest.json (every file present at its recorded size, nothing stale, per-model triangles and
// KTX2 texture sizes re-read from the GLBs), the decoders in public/ against node_modules, the
// generated trim-layout.js against the manifest, and the byte budgets (with the current dist/
// shell). Exits non-zero on any failure.
//
// A normal run builds everything into a temporary staging directory and checks every budget there
// first: public/assets/v1, the decoders, trim-layout.js and manifest.json are only touched when all
// of them pass (manifest.json last, written atomically), so a failed run never leaves a half-written
// asset set or manifest.
//
// Reads the Blender exports in <src>/glb (+ <src>/tex for the HDRI and LUT, + <id>.meta.json
// sidecars), and writes public/assets/v1/<id>.<tier>.glb, env.*.hdr, grade.cube and manifest.json.
// Geometry: dedup -> prune -> weld -> simplify -> quantize -> instance -> UV quantize -> meshopt.
//   gltf-transform's quantize() leaves TEXCOORD_0 as float on primitives whose material carries no
//   texture (building GLBs bind the shared library at runtime), so those UVs are quantized here to
//   normalized int16 with the scale stored in the primitive's extras (`uvScale`; the runtime
//   rescales in materials.js floatGeometry()).
// Textures: resize + KTX2 via toktx (UASTC for normals and hero albedo, ETC1S for the rest).
// Lite: half-resolution textures, normal maps removed, more aggressive simplify.
// Streaming: every asset belongs to a pack. `core` blocks the first diorama frame; landmark packs
// stream in route order (src/diorama/stream.js); `masonry` is a dependency of the brick/stone packs.
// Also copies the three.js basis transcoder -> public/basis/ and the meshopt decoder -> public/meshopt/.
//
// Budgets (whole site, per tier) - exits non-zero on ANY overrun:
//   core  = core-pack assets + decoders                     lite <= 3 MB, full <= 6 MB
//   total = every diorama asset + decoders + site shell     lite <= 8 MB, full <= 18 MB
//           (dist JS/CSS/HTML + fonts, from the last `npm run build`) + the music bed
//   any single asset <= 20k triangles, any texture <= 2048 px.
// Draw calls (lite <= 150, full <= 300) are measured in the browser (see HANDOFF.md, metrics).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { NodeIO, ImageUtils } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, quantize, instance, meshopt, resample, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const argSrc = process.argv.indexOf('--src');
const SRC = argSrc > 0 ? process.argv[argSrc + 1] : path.join(os.homedir(), 'Documents/brendanhoss-art/build');
const OUT = path.join(ROOT, 'public/assets/v1');
const CHECK = process.argv.includes('--check');

// id -> source glb, pack, texture caps, which albedo gets UASTC ("hero").
const ASSETS = [
  // core: the first frame (the green, the town filler, the player, the land)
  { id: 'buildings-matlib', pack: 'core', max: 2048, normalMax: 1024, caps: { M_Shingle: 512, M_Siding: 512 }, allSlotCaps: { M_Shingle: 512 } },
  { id: 'terrain-matlib', pack: 'core', max: 512, normalMax: 256 },
  { id: 'avatar', pack: 'core', max: 512, normalMax: 256, heroAlbedo: /M_Avatar/, skinned: true },
  { id: 'nature', pack: 'core', max: 512, normalMax: 256 },
  { id: 'props', pack: 'core', max: 512, normalMax: 256 },
  { id: 'green', pack: 'core' },
  { id: 'houses', pack: 'core' },
  // shared by the brick / stone landmarks
  { id: 'masonry-matlib', pack: 'masonry', max: 1024, normalMax: 512, allSlotCaps: { M_Ashlar: 1024 } },
  // landmark packs (route order is in the manifest)
  { id: 'lm_gateway', pack: 'gateway', landmark: 'gateway' },
  { id: 'lm_uconn', pack: 'uconn', landmark: 'uconn' },
  { id: 'lm_lambda', pack: 'lambda', landmark: 'lambda' },
  { id: 'lm_story', pack: 'story', landmark: 'story' },
  { id: 'lm_yale', pack: 'yale', landmark: 'yale' },
  { id: 'lm_catalyst', pack: 'catalyst', landmark: 'catalyst' },
  { id: 'office_veoci', pack: 'veoci_se', landmark: 'veoci_se' },
  { id: 'lighthouse', pack: 'contact', landmark: 'contact' },
  { id: 'dock', pack: 'contact', landmark: 'contact' },
  { id: 'sailboat_a', pack: 'contact', landmark: 'contact' },
  { id: 'sailboat_b', pack: 'contact', landmark: 'contact' },
];
const PACKS = {
  core: { deps: [] },
  masonry: { deps: [] },
  gateway: { deps: ['masonry'] }, uconn: { deps: ['masonry'] }, lambda: { deps: ['masonry'] }, story: { deps: [] },
  yale: { deps: ['masonry'] }, catalyst: { deps: ['masonry'] }, veoci_se: { deps: [] }, contact: { deps: [] },
};
const ROUTE_ORDER = ['gateway', 'uconn', 'lambda', 'story', 'yale', 'catalyst', 'veoci_se', 'contact'];

// Budgets (bytes / triangles / px), whole site per tier.
const MB = 1024 * 1024;
const BUDGET = {
  coreBytes: { full: 6 * MB, lite: 3 * MB },
  totalBytes: { full: 18 * MB, lite: 8 * MB },
  assetTris: 20000,
  textureMax: 2048,
  draws: { full: 300, lite: 150 },
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready; await MeshoptEncoder.ready; await MeshoptDecoder.ready;
io.registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const errors = [];
const f2 = (b) => (b / MB).toFixed(2);

// ── shared by the build and --check ──────────────────────────────────────────
// Decoders (loaded only in diorama mode): node_modules source -> public/ destination.
const LIBS = path.join(ROOT, 'node_modules/three/examples/jsm/libs');
const DECODERS = [
  [path.join(LIBS, 'basis/basis_transcoder.js'), 'public/basis/basis_transcoder.js'],
  [path.join(LIBS, 'basis/basis_transcoder.wasm'), 'public/basis/basis_transcoder.wasm'],
  [path.join(LIBS, 'meshopt_decoder.module.js'), 'public/meshopt/meshopt_decoder.module.js'],
];
const decoderBytes = DECODERS.reduce((s, [from]) => s + fs.statSync(from).size, 0);

// Site shell: what every visitor downloads besides the diorama (dist from the last build).
function shellParts() {
  const DIST = path.join(ROOT, 'dist');
  const sz = (f) => (fs.existsSync(f) ? fs.statSync(f).size : 0);
  const parts = {};
  if (fs.existsSync(path.join(DIST, 'index.html'))) {
    parts.html = sz(path.join(DIST, 'index.html'));
    parts.jsCss = fs.readdirSync(path.join(DIST, 'assets')).filter((f) => /\.(js|css)$/.test(f)).reduce((a, f) => a + sz(path.join(DIST, 'assets', f)), 0);
  } else {
    console.warn('WARN: dist/ missing - site shell JS/CSS not counted; run `npm run build` first');
  }
  parts.fonts = fs.readdirSync(path.join(ROOT, 'public/fonts')).reduce((a, f) => a + sz(path.join(ROOT, 'public/fonts', f)), 0);
  parts.music = sz(path.join(ROOT, 'public/beach-lofi.mp3'));
  return parts;
}
function budgetErrors(core, all, shell) {
  const out = [];
  for (const tier of ['full', 'lite']) {
    if (core[tier] > BUDGET.coreBytes[tier]) out.push(`core payload ${tier}: ${f2(core[tier])} MB > ${f2(BUDGET.coreBytes[tier])} MB`);
    const site = all[tier] + shell;
    if (site > BUDGET.totalBytes[tier]) out.push(`site total ${tier}: ${f2(site)} MB > ${f2(BUDGET.totalBytes[tier])} MB`);
  }
  return out;
}
function countTris(doc) {
  let t = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    t += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return Math.round(t);
}
// The triangle cap is per model: multi-building files (houses, green) are checked per named mesh.
function modelTris(doc, meta, tris) {
  const maxMesh = Math.max(...doc.getRoot().listMeshes().map((m) => m.listPrimitives().reduce((a, p) => a + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0)));
  return meta && Object.keys(meta).length > 1 && typeof Object.values(meta)[0] === 'object' ? maxMesh : tris;
}
const trimLayoutSource = (rows) =>
  '// GENERATED by scripts/optimize-assets.mjs from the art build\'s trim_layout.json. Do not edit.\n' +
  '// Trim-sheet rows as [v0, v1] in glTF UV space (v down, not flipped by GLTFLoader).\n' +
  `export const TRIM_ROWS = ${JSON.stringify(rows, null, 1)};\n`;
// Files a manifest references in public/assets/v1 (basenames).
function referenced(man) {
  const ref = new Set(['manifest.json']);
  for (const a of man.assets) for (const t of Object.values(a.tiers)) ref.add(path.basename(t.url));
  for (const f of Object.values(man.files)) for (const t of Object.values(f.tiers)) ref.add(path.basename(t.url));
  return ref;
}
const OUTPUT_EXT = /\.(glb|hdr|cube|ktx2)$/;

// ── --check: validate what's on disk, write nothing ──────────────────────────
if (CHECK) {
  const t0 = Date.now();
  const manPath = path.join(OUT, 'manifest.json');
  if (!fs.existsSync(manPath)) { console.error('FAIL: public/assets/v1/manifest.json missing: run npm run assets'); process.exit(1); }
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  const core = { full: 0, lite: 0 }, all = { full: 0, lite: 0 };
  // every pipeline asset is in the manifest, in its pack
  for (const spec of ASSETS) {
    const e = man.assets.find((a) => a.id === spec.id);
    if (!e) errors.push(`manifest: asset ${spec.id} missing`);
    else if (e.pack !== spec.pack) errors.push(`manifest: ${spec.id} in pack ${e.pack}, pipeline says ${spec.pack}`);
  }
  if (JSON.stringify(man.routeOrder) !== JSON.stringify(ROUTE_ORDER)) errors.push('manifest: routeOrder differs from the pipeline');
  for (const k of Object.keys(PACKS)) if (!man.packs?.[k]) errors.push(`manifest: pack ${k} missing`);
  // assets: present at their recorded size; triangles and texture sizes re-read from the GLB
  for (const a of man.assets) for (const [tier, t] of Object.entries(a.tiers)) {
    const f = path.join(OUT, path.basename(t.url));
    if (!fs.existsSync(f)) { errors.push(`${a.id}.${tier}: ${path.basename(f)} missing`); continue; }
    const bytes = fs.statSync(f).size;
    if (bytes !== t.bytes) errors.push(`${a.id}.${tier}: ${bytes} bytes on disk, manifest says ${t.bytes}`);
    if (a.pack === 'core') core[tier] += bytes;
    all[tier] += bytes;
    const doc = await io.read(f);
    const tris = countTris(doc);
    if (tris !== t.tris) errors.push(`${a.id}.${tier}: ${tris} tris, manifest says ${t.tris}`);
    const per = modelTris(doc, a.meta, tris);
    if (per > BUDGET.assetTris) errors.push(`${a.id}.${tier}: ${Math.round(per)} tris > ${BUDGET.assetTris}`);
    for (const tex of doc.getRoot().listTextures()) {
      const img = tex.getImage();
      if (tex.getMimeType() !== 'image/ktx2' || !img || img.length < 28) { errors.push(`${a.id}.${tier}: texture "${tex.getName()}" is not KTX2`); continue; }
      const dv = new DataView(img.buffer, img.byteOffset, img.byteLength);
      const w = dv.getUint32(20, true), h = dv.getUint32(24, true);   // KTX2 header: pixelWidth, pixelHeight
      if (Math.max(w, h) > BUDGET.textureMax) errors.push(`${a.id}.${tier}: texture ${w}x${h} > ${BUDGET.textureMax}`);
    }
  }
  for (const [key, f] of Object.entries(man.files)) for (const [tier, t] of Object.entries(f.tiers)) {
    const p = path.join(OUT, path.basename(t.url));
    if (!fs.existsSync(p)) { errors.push(`${key}.${tier}: ${path.basename(p)} missing`); continue; }
    const bytes = fs.statSync(p).size;
    if (bytes !== t.bytes) errors.push(`${key}.${tier}: ${bytes} bytes on disk, manifest says ${t.bytes}`);
    core[tier] += bytes; all[tier] += bytes;
  }
  // nothing stale in the asset directory
  const ref = referenced(man);
  for (const f of fs.readdirSync(OUT)) if (!ref.has(f)) errors.push(`stale file in public/assets/v1: ${f}`);
  // decoders match node_modules (a three upgrade needs \`npm run assets\` to refresh them)
  for (const [from, to] of DECODERS) {
    const dst = path.join(ROOT, to);
    if (!fs.existsSync(dst)) errors.push(`${to} missing`);
    else if (!fs.readFileSync(dst).equals(fs.readFileSync(from))) errors.push(`${to} differs from ${path.relative(ROOT, from)}`);
  }
  for (const t of ['full', 'lite']) { core[t] += decoderBytes; all[t] += decoderBytes; }
  // the generated trim rows match the manifest
  const tlFile = path.join(ROOT, 'src/diorama/trim-layout.js');
  if (!man.trimRows) errors.push('manifest: trimRows missing');
  else if (!fs.existsSync(tlFile) || fs.readFileSync(tlFile, 'utf8') !== trimLayoutSource(man.trimRows)) errors.push('src/diorama/trim-layout.js does not match manifest.trimRows');
  const parts = shellParts();
  const shell = Object.values(parts).reduce((a, b) => a + b, 0);
  errors.push(...budgetErrors(core, all, shell));
  console.log(`checked ${man.assets.length} assets (${ref.size - 1} files) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`core payload : full ${f2(core.full)} MB / ${f2(BUDGET.coreBytes.full)}, lite ${f2(core.lite)} MB / ${f2(BUDGET.coreBytes.lite)}`);
  console.log(`site total   : full ${f2(all.full + shell)} MB / ${f2(BUDGET.totalBytes.full)}, lite ${f2(all.lite + shell)} MB / ${f2(BUDGET.totalBytes.lite)}   (shell ${f2(shell)} MB)`);
  if (errors.length) { console.error('\nCHECK FAILURES:\n  ' + errors.join('\n  ')); process.exit(1); }
  console.log('OK: assets match the manifest; all budgets met');
  process.exit(0);
}

// ── build: everything into a staging directory, budgets checked before publishing ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-ktx-'));
const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-assets-'));

function slotsOf(doc, tex) {
  const slots = new Set();
  for (const m of doc.getRoot().listMaterials()) {
    if (m.getBaseColorTexture() === tex) slots.add('baseColor');
    if (m.getEmissiveTexture() === tex) slots.add('emissive');
    if (m.getNormalTexture() === tex) slots.add('normal');
    if (m.getMetallicRoughnessTexture() === tex) slots.add('orm');
    if (m.getOcclusionTexture() === tex) slots.add('orm');
  }
  return slots;
}
function materialNamesOf(doc, tex) {
  return doc.getRoot().listMaterials().filter((m) =>
    [m.getBaseColorTexture(), m.getNormalTexture(), m.getMetallicRoughnessTexture(), m.getOcclusionTexture()].includes(tex)).map((m) => m.getName());
}

function toKTX2(doc, spec, tier) {
  const basisu = doc.createExtension(KHRTextureBasisu).setRequired(true);
  let i = 0;
  for (const tex of doc.getRoot().listTextures()) {
    const slots = slotsOf(doc, tex);
    const img = tex.getImage();
    const mime = tex.getMimeType();
    const ext = mime === 'image/jpeg' ? '.jpg' : '.png';
    const inFile = path.join(tmp, `${spec.id}-${tier}-${i}${ext}`);
    const outFile = path.join(tmp, `${spec.id}-${tier}-${i++}.ktx2`);
    fs.writeFileSync(inFile, img);
    const [w, h] = ImageUtils.getSize(img, mime);
    let cap = (slots.has('normal') || (slots.has('orm') && !slots.has('baseColor'))) ? (spec.normalMax ?? spec.max ?? 1024) : (spec.max ?? 1024);
    for (const [mat, c] of Object.entries(spec.caps ?? {})) if (materialNamesOf(doc, tex).includes(mat) && slots.has('normal')) cap = Math.min(cap, c);
    for (const [mat, c] of Object.entries(spec.allSlotCaps ?? {})) if (materialNamesOf(doc, tex).includes(mat)) cap = Math.min(cap, c);
    if (tier === 'lite') cap = Math.max(128, cap / 2);
    const scale = Math.min(1, cap / Math.max(w, h));
    // block-compressed formats need multiple-of-four dimensions (the kit's Flowers card is 512x498)
    const r4 = (v) => Math.max(4, Math.round(v / 4) * 4);
    const nw = r4(w * scale), nh = r4(h * scale);
    const isNormal = slots.has('normal');
    const isColor = slots.has('baseColor') || slots.has('emissive');
    const hero = isColor && spec.heroAlbedo && materialNamesOf(doc, tex).some((n) => spec.heroAlbedo.test(n));
    const args = ['--t2', '--genmipmap', '--assign_oetf', isColor ? 'srgb' : 'linear'];
    if (nw !== w || nh !== h) args.push('--resize', `${nw}x${nh}`);
    if (isNormal || (hero && tier === 'full')) args.push('--encode', 'uastc', '--uastc_quality', '2', '--uastc_rdo_l', '4', '--zcmp', '19');
    else args.push('--encode', 'etc1s', '--clevel', '2', '--qlevel', isColor ? '192' : '128');
    args.push(outFile, inFile);
    execFileSync('toktx', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    tex.setImage(fs.readFileSync(outFile)).setMimeType('image/ktx2');
    if (process.env.VERBOSE) console.log(`   ${spec.id}.${tier} ${[...slots].join('+').padEnd(10)} ${nw}x${nh} ${isNormal || (hero && tier === 'full') ? 'uastc' : 'etc1s'} ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB  [${materialNamesOf(doc, tex).join(',')}]`);
    if (Math.max(nw, nh) > BUDGET.textureMax) errors.push(`${spec.id}.${tier}: texture ${nw}x${nh} > ${BUDGET.textureMax}`);
  }
  if (!doc.getRoot().listTextures().length) basisu.dispose();
}

function stripNormals(doc) {
  for (const m of doc.getRoot().listMaterials()) {
    const t = m.getNormalTexture();
    if (t) m.setNormalTexture(null);
  }
}

// Normalized-int16 UVs for texture-less primitives (library-bound buildings). Returns bytes saved.
function quantizeLibraryUVs(doc) {
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const m = prim.getMaterial();
    const textured = m && (m.getBaseColorTexture() || m.getNormalTexture() || m.getMetallicRoughnessTexture());
    const uv = prim.getAttribute('TEXCOORD_0');
    if (textured || !uv || uv.getComponentType() !== 5126) continue;
    const src = uv.getArray();
    let max = 1e-6;
    for (let i = 0; i < src.length; i++) max = Math.max(max, Math.abs(src[i]));
    const out = new Int16Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = Math.round((src[i] / max) * 32767);
    const acc = doc.createAccessor().setType('VEC2').setArray(out).setNormalized(true).setBuffer(uv.getBuffer());
    prim.setAttribute('TEXCOORD_0', acc);
    prim.setExtras({ ...(prim.getExtras() || {}), uvScale: max });
    if (!uv.listParents().some((p) => p !== doc.getRoot() && p.propertyType !== 'Root')) uv.dispose();
  }
}

const manifest = { version: 1, generated: new Date().toISOString(), units: 'site units (1.75 per metre)', assets: [], files: {} };
const totals = { full: 0, lite: 0 };          // core
const allAssets = { full: 0, lite: 0 };       // every diorama asset

for (const spec of ASSETS) {
  const src = path.join(SRC, 'glb', `${spec.id}.glb`);
  if (!fs.existsSync(src)) { errors.push(`missing source ${src}`); continue; }
  const metaPath = path.join(SRC, 'glb', `${spec.id}.meta.json`);
  const entry = { id: spec.id, pack: spec.pack, landmark: spec.landmark ?? null, tiers: {} };
  if (fs.existsSync(metaPath)) entry.meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  for (const tier of ['full', 'lite']) {
    const doc = await io.read(src);
    const isLib = spec.id.endsWith('matlib');
    await doc.transform(dedup(), prune({ keepLeaves: isLib, keepAttributes: true }), weld());
    if (!isLib && (!spec.skinned || tier === 'lite')) {
      // lite: the avatar and the kit trees are the densest meshes; they get the deepest cut
      const ratio = tier === 'lite' ? (spec.skinned || spec.id === 'nature' ? 0.45 : 0.7) : 1.0;
      const error = tier === 'lite' ? 0.004 : 0.0008;
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: true }));
    }
    if (spec.skinned) await doc.transform(resample());
    if (tier === 'lite') stripNormals(doc);
    await doc.transform(prune({ keepLeaves: isLib, keepAttributes: true }));
    toKTX2(doc, spec, tier);
    await doc.transform(
      quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14 }),
      instance({ min: 2 }),
    );
    quantizeLibraryUVs(doc);
    await doc.transform(prune({ keepLeaves: isLib, keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const file = `${spec.id}.${tier}.glb`;
    await io.write(path.join(STAGE, file), doc);
    const bytes = fs.statSync(path.join(STAGE, file)).size;
    const tris = countTris(doc);
    entry.tiers[tier] = { url: `/assets/v1/${file}`, bytes, tris };
    if (spec.pack === 'core') totals[tier] += bytes;
    allAssets[tier] += bytes;
    const perModel = modelTris(doc, entry.meta, tris);
    if (perModel > BUDGET.assetTris) errors.push(`${spec.id}.${tier}: ${Math.round(perModel)} tris > ${BUDGET.assetTris}`);
    console.log(`${file.padEnd(32)} ${(bytes / 1024).toFixed(0).padStart(6)} KB  ${String(tris).padStart(6)} tris`);
  }
  manifest.assets.push(entry);
}

// Environment (IBL only; 512x256 full, 256x128 lite) + the grade LUT (shared).
for (const [key, name, from, tiers] of [
  ['env', 'env.full.hdr', 'tex/bell_park_pier_512.hdr', ['full']],
  ['env', 'env.lite.hdr', 'tex/bell_park_pier_256.hdr', ['lite']],
  ['grade', 'grade.cube', 'tex/golden-hour.cube', ['full', 'lite']],
]) {
  const s = path.join(SRC, from);
  if (!fs.existsSync(s)) { errors.push(`missing ${s}`); continue; }
  fs.copyFileSync(s, path.join(STAGE, name));
  const bytes = fs.statSync(path.join(STAGE, name)).size;
  manifest.files[key] = manifest.files[key] || { tiers: {} };
  for (const t of tiers) { manifest.files[key].tiers[t] = { url: `/assets/v1/${name}`, bytes }; totals[t] += bytes; allAssets[t] += bytes; }
}
for (const t of ['full', 'lite']) { totals[t] += decoderBytes; allAssets[t] += decoderBytes; }

const parts = shellParts();
const shell = Object.values(parts).reduce((a, b) => a + b, 0);

manifest.packs = Object.fromEntries(Object.entries(PACKS).map(([k, v]) => [k, { deps: v.deps, assets: ASSETS.filter((a) => a.pack === k).map((a) => a.id) }]));
manifest.routeOrder = ROUTE_ORDER;
manifest.totals = { coreBytes: totals, assetBytes: allAssets, decoderBytes, shellBytes: parts, siteBytes: { full: allAssets.full + shell, lite: allAssets.lite + shell } };
manifest.budgets = BUDGET;
errors.push(...budgetErrors(totals, allAssets, shell));
// Trim-sheet row bands for runtime shaders (glass / lit-interior effects in index.js), generated
// from the art lane's trim_layout.json so a re-laid sheet can never silently desync the shader.
{
  const tl = path.join(SRC, 'tex/trim_layout.json');
  if (fs.existsSync(tl)) {
    const rows = JSON.parse(fs.readFileSync(tl, 'utf8'));
    manifest.trimRows = Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, [+r.v0.toFixed(4), +r.v1.toFixed(4)]]));
  } else errors.push(`missing ${tl}`);
}

console.log(`core payload : full ${f2(totals.full)} MB / 6, lite ${f2(totals.lite)} MB / 3   (incl. decoders ${(decoderBytes / 1024).toFixed(0)} KB)`);
console.log(`site total   : full ${f2(allAssets.full + shell)} MB / 18, lite ${f2(allAssets.lite + shell)} MB / 8   (shell ${f2(shell)} MB: ${Object.entries(parts).map(([k, v]) => `${k} ${(v / 1024).toFixed(0)} KB`).join(', ')})`);
fs.rmSync(tmp, { recursive: true, force: true });
if (errors.length) {
  // nothing published: public/assets/v1, the decoders, trim-layout.js and manifest.json are as they were
  fs.rmSync(STAGE, { recursive: true, force: true });
  console.error('\nBUDGET / PIPELINE FAILURES (nothing written):\n  ' + errors.join('\n  '));
  process.exit(1);
}

// ── publish: assets, decoders, trim rows, then the manifest (atomically), then prune ──
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(STAGE)) fs.copyFileSync(path.join(STAGE, f), path.join(OUT, f));
fs.rmSync(STAGE, { recursive: true, force: true });
for (const [from, to] of DECODERS) { fs.mkdirSync(path.dirname(path.join(ROOT, to)), { recursive: true }); fs.copyFileSync(from, path.join(ROOT, to)); }
fs.writeFileSync(path.join(ROOT, 'src/diorama/trim-layout.js'), trimLayoutSource(manifest.trimRows));
fs.writeFileSync(path.join(OUT, 'manifest.json.tmp'), JSON.stringify(manifest, null, 1));
fs.renameSync(path.join(OUT, 'manifest.json.tmp'), path.join(OUT, 'manifest.json'));
// Prune outputs the manifest no longer references (a renamed or retired asset, the old env.hdr), so
// public/assets/v1 ships exactly what the runtime can ask for. Flat directory, known extensions, one
// file at a time; skipped on a manifest that looks empty.
{
  const ref = referenced(manifest);
  if (ref.size >= 10) {
    for (const f of fs.readdirSync(OUT)) {
      if (ref.has(f) || !OUTPUT_EXT.test(f)) continue;
      fs.unlinkSync(path.join(OUT, f));
      console.log(`pruned stale ${f}`);
    }
  }
}
console.log('OK: all budgets met');
