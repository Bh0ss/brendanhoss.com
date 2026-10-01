import * as THREE from 'three';

// Far woods as impostor cards (W2). The kit's own trees are baked once at load into a small atlas
// (albedo + crown normals, four views), and every tree past the town's 3D rows is one
// camera-facing quad that samples it. The cards use MeshStandardMaterial, so the IBL, sun, fog
// and grade that light the 3D trees light them too: at the woods' edge the two are the same tree.
//
// No payload: the atlas is rendered from geometry already in the core `nature` asset.

const CELL_W = 256, CELL_H = 384, ASPECT = CELL_H / CELL_W;

// variants: [part name, yaw, crown widening]
export const CARD_VARIANTS = [['commontree_3', 0, 1.3], ['commontree_3', 1.7, 1.3], ['commontree_5', 0.8, 1.3], ['pine_2', 0, 0.8]];

export function bakeTreeAtlas(renderer, np) {
  const n = CARD_VARIANTS.length;
  const mk = (srgb) => {
    const rt = new THREE.WebGLRenderTarget(CELL_W * n, CELL_H, { depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    if (srgb) rt.texture.colorSpace = THREE.SRGBColorSpace;
    return rt;
  };
  const albedoRT = mk(true), normalRT = mk(false);
  const scene = new THREE.Scene();
  const cells = [];
  const nMats = new Map(), aMats = new Map();
  const normalMat = (m) => {
    if (!nMats.has(m)) nMats.set(m, new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { map: { value: m.map || null }, cut: { value: m.alphaTest > 0 ? 0.5 : -1 } },
      vertexShader: 'varying vec3 vN; varying vec2 vUv; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D map; uniform float cut; varying vec3 vN; varying vec2 vUv; void main(){ if (cut > 0.0 && texture2D(map, vUv).a < cut) discard; gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0); }',
    }));
    return nMats.get(m);
  };
  // albedo: an unlit twin that keeps the part's regrade hook (it edits map_fragment, which
  // MeshBasicMaterial shares), so the baked colour is the regraded colour
  const albedoMat = (m) => {
    if (!aMats.has(m)) {
      const b = new THREE.MeshBasicMaterial({ map: m.map, color: m.color, alphaTest: m.alphaTest > 0 ? 0.5 : 0, side: THREE.DoubleSide });
      if (m.onBeforeCompile) b.onBeforeCompile = m.onBeforeCompile;
      const key = m.customProgramCacheKey?.bind(m);
      b.customProgramCacheKey = () => (key ? key() : '') + '-bake';
      aMats.set(m, b);
    }
    return aMats.get(m);
  };
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  const prevTarget = renderer.getRenderTarget(), prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  renderer.autoClear = false;
  for (const [rt, pass] of [[albedoRT, 'a'], [normalRT, 'n']]) {
    renderer.setRenderTarget(rt);
    renderer.setClearColor(pass === 'n' ? 0x8080ff : 0x2a3a1c, 0);   // normal: facing the camera; albedo: a dark green fringe
    renderer.clear(true, true, true);
    CARD_VARIANTS.forEach(([name, yaw, widen], i) => {
      const parts = np[name];
      if (!parts) return;
      const g = new THREE.Group();
      for (const p of parts) g.add(new THREE.Mesh(p.geometry, pass === 'n' ? normalMat(p.material) : albedoMat(p.material)));
      g.rotation.y = yaw; g.scale.set(widen, 1, widen);
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g);
      const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, (box.max.y - box.min.y) / ASPECT) * 1.04;
      const h = w * ASPECT;
      const cx = (box.min.x + box.max.x) / 2;
      cam.left = cx - w / 2; cam.right = cx + w / 2; cam.bottom = box.min.y - 0.02 * h; cam.top = cam.bottom + h;
      cam.position.set(0, 0, 50); cam.lookAt(0, 0, 0);
      cam.near = 0; cam.far = 100;
      cam.updateProjectionMatrix();
      scene.add(g);
      rt.viewport.set(i * CELL_W, 0, CELL_W, CELL_H);
      rt.scissor.set(i * CELL_W, 0, CELL_W, CELL_H); rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      scene.remove(g);
      if (pass === 'a') cells.push({ w, h, base: -(cam.bottom), u0: i / n, u1: (i + 1) / n });
    });
    rt.scissorTest = false; rt.viewport.set(0, 0, CELL_W * n, CELL_H);
  }
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAuto;
  for (const m of [...nMats.values(), ...aMats.values()]) m.dispose();
  return { albedo: albedoRT.texture, normal: normalRT.texture, cells };
}

// cards: [{ x, y, z, s, v (variant), c (THREE.Color tint) }]
export function createCards(atlas, cards, { name = 'dio-treeline' } = {}) {
  const N = cards.length;
  const pos = new Float32Array(N * 4 * 3), ctr = new Float32Array(N * 4 * 3), crn = new Float32Array(N * 4 * 2), uv = new Float32Array(N * 4 * 2), col = new Float32Array(N * 4 * 3);
  const idx = new Uint32Array(N * 6);
  const C = [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]];
  cards.forEach((k, i) => {
    const cell = atlas.cells[k.v];
    for (let j = 0; j < 4; j++) {
      const o = i * 4 + j;
      // `position` is the centre (a zero-area quad): any pass that swaps the material (the AO
      // normal pass) draws nothing instead of an unbillboarded board
      pos.set([k.x, k.y, k.z], o * 3);
      ctr.set([k.x, k.y - cell.base * k.s, k.z], o * 3);
      crn.set([C[j][0] * cell.w * k.s, C[j][1] * cell.h * k.s], o * 2);
      uv.set([C[j][0] < 0 ? cell.u0 + 0.002 : cell.u1 - 0.002, C[j][1]], o * 2);
      col.set([k.c.r, k.c.g, k.c.b], o * 3);
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCenter', new THREE.BufferAttribute(ctr, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(crn, 2));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N * 4 * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.boundingSphere.radius += 30;

  const mat = new THREE.MeshStandardMaterial({ map: atlas.albedo, vertexColors: true, alphaTest: 0.42, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tCardN = { value: atlas.normal };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aCenter; attribute vec2 aCorner; varying vec3 vCR; varying vec3 vCF;')
      .replace('#include <begin_vertex>', `
        vec3 toCam = cameraPosition - aCenter; toCam.y = 0.0;
        vec3 cF = normalize(toCam + vec3(1e-4, 0.0, 0.0));
        vec3 cR = normalize(cross(vec3(0.0, 1.0, 0.0), cF));
        vec3 transformed = aCenter + cR * aCorner.x + vec3(0.0, aCorner.y, 0.0);
        vCR = cR; vCF = cF;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tCardN; varying vec3 vCR; varying vec3 vCF;')
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 cn = texture2D(tCardN, vMapUv).xyz * 2.0 - 1.0;
          vec3 nW = normalize(vCR * cn.x + vec3(0.0, 1.0, 0.0) * cn.y + vCF * cn.z);
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`);
  };
  mat.customProgramCacheKey = () => 'dio-cards1';
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = name;
  mesh.userData.noAO = true;
  mesh.castShadow = false; mesh.receiveShadow = false;
  return mesh;
}
