import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FinishShader } from '../town/post.js';

// Diorama post stack.
//   full: Render(+depth) -> depth-aware tilt-shift DOF -> GTAO (half res) -> Output (tone map)
//         -> SMAA -> Finish (grade + .cube LUT + vignette + grain)
//   lite: Render -> Output -> Finish (FXAA + CAS sharpen + cheap top-band blur + LUT)
// The Finish pass is the classic town's FinishShader, extended by define (LUT / CAS / TOPBLUR),
// so both looks share one grade.

// The scene render lands in whichever composer buffer is current this frame (it alternates when
// a frame has an odd number of swapping passes), so hand its depth to the DOF pass right here.
class DepthRenderPass extends RenderPass {
  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    this.depthTexture = readBuffer.depthTexture;
    if (this.dof) this.dof.uniforms.tDepth.value = readBuffer.depthTexture;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

const DOFShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null },
    uNear: { value: 0.1 }, uFar: { value: 1200 }, uFocus: { value: 25 },
    uRes: { value: new THREE.Vector2(1, 1) }, uMaxR: { value: 7 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tDepth; uniform float uNear, uFar, uFocus, uMaxR; uniform vec2 uRes;
    varying vec2 vUv;
    float viewZ(vec2 uv){ float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
    // circle of confusion 0..1: a deep sharp band covering the player AND the landmark beside
    // them, then a mild falloff. Background ramps slowly and is capped, so the far sea stays
    // legible (a gentle miniature cue, not a mush); the foreground softens a little faster.
    float coc(float d){
      float x = d - uFocus;
      if (x > 0.0) return clamp((x - uFocus * 0.6) / (uFocus * 2.4), 0.0, 0.55);
      return clamp((-x - uFocus * 0.4) / (uFocus * 0.9), 0.0, 1.0);
    }
    void main(){
      float d0 = viewZ(vUv);
      float c0 = coc(d0);
      vec4 base = texture2D(tDiffuse, vUv);
      if (c0 < 0.02) { gl_FragColor = base; return; }
      vec3 acc = base.rgb; float wsum = 1.0;
      float R = c0 * uMaxR;
      const int N = 28;
      for (int i = 1; i <= N; i++) {
        float fi = float(i);
        float r = sqrt(fi / float(N)) * R;
        float a = fi * 2.39996323;
        vec2 o = vec2(cos(a), sin(a)) * r / uRes;
        vec2 uv = vUv + o;
        float cs = coc(viewZ(uv));
        // a tap only contributes if its own blur reaches this pixel (keeps sharp subjects crisp)
        float w = clamp(cs * uMaxR - r + 1.0, 0.0, 1.0);
        acc += texture2D(tDiffuse, uv).rgb * w; wsum += w;
      }
      gl_FragColor = vec4(acc / wsum, base.a);
    }`,
};

function extendFinish({ lite }) {
  const s = THREE.UniformsUtils.clone(FinishShader.uniforms);
  s.tLut = { value: null }; s.lutSize = { value: 17 }; s.lutMix = { value: 1 };
  s.uSharp = { value: 0.55 };
  s.uGreen = { value: 0.5 }; s.uCool = { value: 1 }; s.uClean = { value: 0.35 };
  let frag = FinishShader.fragmentShader;
  frag = frag.replace('uniform sampler2D tDiffuse;', `uniform sampler2D tDiffuse;
    #if LUT
    uniform highp sampler3D tLut; uniform float lutSize, lutMix;
    #endif
    uniform float uSharp, uGreen, uCool, uClean;`);
  frag = frag.replace('float rand(vec2 c)', `
    #if CAS
    vec3 cas(vec3 c, vec2 uv){
      vec2 px = 1.0 / uResolution;
      vec3 a = texture2D(tDiffuse, uv + vec2(0.0, -px.y)).rgb, b = texture2D(tDiffuse, uv + vec2(-px.x, 0.0)).rgb;
      vec3 d = texture2D(tDiffuse, uv + vec2(px.x, 0.0)).rgb, e = texture2D(tDiffuse, uv + vec2(0.0, px.y)).rgb;
      vec3 mn = min(c, min(min(a, b), min(d, e))), mx = max(c, max(max(a, b), max(d, e)));
      vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
      vec3 w = -amp / mix(8.0, 5.0, uSharp);
      return clamp((c + (a + b + d + e) * w) / (1.0 + 4.0 * w), 0.0, 1.0);
    }
    #endif
    #if TOPBLUR
    vec3 topBlur(vec3 c, vec2 uv){
      // phone miniature cue: only the top ~15% of the frame, and only a little
      float k = smoothstep(0.84, 1.0, uv.y) * 0.65;
      if (k <= 0.0) return c;
      vec2 px = 1.3 * k / uResolution * max(uResolution.y / 900.0, 1.0);
      vec3 s = c;
      s += texture2D(tDiffuse, uv + vec2( 1.0,  0.5) * px).rgb; s += texture2D(tDiffuse, uv + vec2(-1.0, -0.5) * px).rgb;
      s += texture2D(tDiffuse, uv + vec2(-0.5,  1.0) * px).rgb; s += texture2D(tDiffuse, uv + vec2( 0.5, -1.0) * px).rgb;
      s += texture2D(tDiffuse, uv + vec2( 2.0, -1.0) * px).rgb; s += texture2D(tDiffuse, uv + vec2(-2.0,  1.0) * px).rgb;
      return mix(c, s / 7.0, k);
    }
    #endif
    float rand(vec2 c)`);
  frag = frag.replace('col = (col - 0.5) * contrast + 0.5 + lift;', `
      #if CAS
        col = cas(col, vUv);
      #endif
      #if TOPBLUR
        col = topBlur(col, vUv);
      #endif
      col = (col - 0.5) * contrast + 0.5 + lift;`);
  frag = frag.replace('// vignette', `
      #if LUT
        vec3 lc = clamp(col, 0.0, 1.0) * ((lutSize - 1.0) / lutSize) + 0.5 / lutSize;
        col = mix(col, texture(tLut, lc).rgb, lutMix);
      #endif
      // diorama trim after the LUT:
      //  - foliage that has drifted olive (red riding close under green) is pulled to summer green
      //  - shadows get a faint cool lift, highlights are cleaned toward neutral white
      {
        float gl = luma(col);
        // olive only: red riding at 75-105% of green (fresh greens sit well below that)
        float ro = col.r / max(col.g, 1e-3);
        float fol = smoothstep(0.015, 0.09, col.g - col.b) * smoothstep(0.64, 0.8, ro) * (1.0 - smoothstep(1.02, 1.12, ro));
        col = mix(col, col * vec3(0.86, 1.05, 0.9), fol * uGreen);
        col += (1.0 - smoothstep(0.02, 0.32, gl)) * vec3(-0.008, 0.002, 0.018) * uCool;
        col = mix(col, vec3(gl) * vec3(1.015, 1.0, 0.975), smoothstep(0.72, 0.96, gl) * uClean);
      }
      // vignette`);
  // vignette as a multiply (the classic one mixes toward flat grey, which veils the corners of a
  // tall phone frame in milky grey)
  frag = frag.replace('col = mix(col, vec3(1.0 - vigDarkness), dot(uv, uv));', 'col *= 1.0 - dot(uv, uv) * vigDarkness * 0.55;');
  return {
    defines: { FXAA: lite ? 1 : 0, LUT: 0, CAS: lite ? 1 : 0, TOPBLUR: lite ? 1 : 0 },
    uniforms: s, vertexShader: FinishShader.vertexShader, fragmentShader: frag,
  };
}

export function createDioramaPost(renderer, scene, camera, { lite }) {
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const composer = new EffectComposer(renderer);
  if (!lite) {
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
      rt.depthTexture = new THREE.DepthTexture(size.x * pr, size.y * pr);
      rt.depthTexture.type = THREE.UnsignedIntType;
      rt.depthBuffer = true;
    }
  }
  const renderPass = new DepthRenderPass(scene, camera);
  composer.addPass(renderPass);

  let gtao = null, dof = null, smaa = null;
  if (!lite) {
    // DOF runs straight after the scene render: it samples that render's depth attachment while
    // writing the other buffer (running it later would read and write the same framebuffer).
    dof = new ShaderPass(DOFShader);
    renderPass.dof = dof;
    composer.addPass(dof);
    gtao = new GTAOPass(scene, camera, Math.round(size.x * pr / 2), Math.round(size.y * pr / 2));
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.85;
    gtao.updateGtaoMaterial({ radius: 2.4, distanceExponent: 1.2, thickness: 2.0, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    // GTAO re-renders the scene for its normal / depth. Only solid, lit, near geometry belongs in
    // it: cloud sprites (depth-less, painted soft) as occluders put dark boxes wherever a cloud
    // overlaps the land in a wide or low view; transparent and unlit things (water, beacons,
    // rings, birds) never took AO; far layers tagged noAO (sky, woods cards, islands, far
    // terrain) are past its 2.4-unit radius anyway. This also halves the pass's draw calls.
    const ov = gtao.overrideVisibility.bind(gtao);
    const skip = (m) => m && (m.transparent || m.isMeshBasicMaterial || m.isSpriteMaterial);
    gtao.overrideVisibility = () => {
      ov();
      scene.traverse((o) => {
        if (!o.visible) return;
        if (o.isSprite || o.userData.noAO || (o.isMesh && (Array.isArray(o.material) ? o.material.every(skip) : skip(o.material)))) o.visible = false;
      });
    };
    composer.addPass(gtao);
  }
  composer.addPass(new OutputPass());
  if (!lite) { smaa = new SMAAPass(size.x * pr, size.y * pr); composer.addPass(smaa); }
  const finish = new ShaderPass(extendFinish({ lite }));
  // the diorama grade is lighter-handed: the LUT carries the split tone
  finish.uniforms.contrast.value = 1.02;
  finish.uniforms.saturation.value = 1.04;
  finish.uniforms.splitStrength.value = 0.02;
  finish.uniforms.vigDarkness.value = 0.55;
  finish.uniforms.grain.value = 0.012;
  finish.uniforms.uResolution.value.set(size.x * pr, size.y * pr);
  composer.addPass(finish);

  function setLut(tex3d, n) {
    finish.uniforms.tLut.value = tex3d; finish.uniforms.lutSize.value = n;
    finish.material.defines.LUT = 1; finish.material.needsUpdate = true;
  }
  function resize(w, h) {
    const p = renderer.getPixelRatio();
    composer.setPixelRatio(p);
    composer.setSize(w, h);
    finish.uniforms.uResolution.value.set(w * p, h * p);
    if (gtao) gtao.setSize(Math.round(w * p / 2), Math.round(h * p / 2));
    if (dof) dof.uniforms.uRes.value.set(w * p, h * p);
  }
  resize(size.x, size.y);
  function beforeRender(focusDist) {
    if (dof) {
      dof.uniforms.uNear.value = camera.near; dof.uniforms.uFar.value = camera.far;
      dof.uniforms.uFocus.value = focusDist;
      dof.uniforms.uMaxR.value = 4.5 * renderer.getPixelRatio() * Math.max(1, innerHeight / 900);
    }
  }
  // `grain` keeps the classic name: Town's loop drives grain.uniforms.uTime.
  return { composer, grain: finish, finish, gtao, dof, resize, setLut, beforeRender };
}
