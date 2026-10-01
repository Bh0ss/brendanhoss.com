import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';

// Post stack, by tier:
//   full: Render → Bloom (emissives only) → Output → tilt-shift H/V → SMAA → Finish
//   lite: Render → Output → Finish(+FXAA)
// No tier ships without anti-aliasing. FXAA is folded into the lite Finish pass,
// which also carries the grade, vignette and grain — so lite is now 3 passes
// (was 5, and had no AA at all). FXAA costs ~9 texture reads/pixel in one pass;
// SMAA is 3 passes with 2 lookup textures, which is why lite gets FXAA.
//
// GTAO is gone: ambient occlusion is now baked into vertex colours and the
// shared material's contact term (palette.js), so both tiers get the same
// grounded look and the full tier drops a whole extra scene render (GTAO's
// normal/depth pass).

// Finish: optional FXAA (lite), then painterly grade (gentle S-contrast,
// warm-highlight / cool-shadow split tone, saturation), vignette and grain.
export const FinishShader = {
  defines: { FXAA: 0 },
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    contrast: { value: 1.04 },
    saturation: { value: 1.06 },
    lift: { value: 0.012 },
    splitStrength: { value: 0.05 },
    vigOffset: { value: 1.05 },
    vigDarkness: { value: 0.75 },
    grain: { value: 0.018 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime, contrast, saturation, lift, splitStrength, vigOffset, vigDarkness, grain;
    varying vec2 vUv;
    float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    #if FXAA
    // FXAA 3.11-style "console" variant: edge-aware blend along the local gradient.
    vec3 fxaa(vec2 uv){
      vec2 px = 1.0 / uResolution;
      vec3 rgbM = texture2D(tDiffuse, uv).rgb;
      float lNW = luma(texture2D(tDiffuse, uv + vec2(-1.0,-1.0)*px).rgb);
      float lNE = luma(texture2D(tDiffuse, uv + vec2( 1.0,-1.0)*px).rgb);
      float lSW = luma(texture2D(tDiffuse, uv + vec2(-1.0, 1.0)*px).rgb);
      float lSE = luma(texture2D(tDiffuse, uv + vec2( 1.0, 1.0)*px).rgb);
      float lM = luma(rgbM);
      float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
      float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
      if (lMax - lMin < max(0.0312, lMax * 0.125)) return rgbM;
      vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
      float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0/128.0);
      float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
      dir = clamp(dir * rcp, -8.0, 8.0) * px;
      vec3 a = 0.5 * (texture2D(tDiffuse, uv + dir * (1.0/3.0 - 0.5)).rgb + texture2D(tDiffuse, uv + dir * (2.0/3.0 - 0.5)).rgb);
      vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, uv - dir * 0.5).rgb + texture2D(tDiffuse, uv + dir * 0.5).rgb);
      float lB = luma(b);
      return (lB < lMin || lB > lMax) ? a : b;
    }
    #endif
    float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      #if FXAA
        vec3 col = fxaa(vUv);
      #else
        vec3 col = texture2D(tDiffuse, vUv).rgb;
      #endif
      col = (col - 0.5) * contrast + 0.5 + lift;
      float l = luma(col);
      vec3 warm = vec3(1.0, 0.965, 0.9);
      vec3 cool = vec3(0.92, 0.97, 1.03);
      col *= mix(cool, warm, smoothstep(0.15, 0.85, l)) * (1.0 - splitStrength) + splitStrength;
      col = mix(vec3(l), col, saturation);
      // vignette (same falloff as three's VignetteShader)
      vec2 uv = (vUv - 0.5) * vec2(vigOffset);
      col = mix(col, vec3(1.0 - vigDarkness), dot(uv, uv));
      col += (rand(vUv + fract(uTime)) * 2.0 - 1.0) * grain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export function createComposer(renderer, scene, camera, { lite = false } = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const W = size.x, H = size.y;
  const pr = renderer.getPixelRatio();

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // Bloom: threshold sits above the brightest sunlit albedo, so only the HDR
  // emissives (lit windows, lamps, lantern, beacons, sun glints) glow.
  let bloom = null;
  if (!lite) {
    bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.32, 0.55, 1.15);
    composer.addPass(bloom);
  }

  // Tone-map + sRGB here so subsequent passes operate on display-ready color.
  composer.addPass(new OutputPass());

  // Tilt-shift diorama blur — full tier only (two fullscreen passes).
  const BLUR = 1.2;
  const focus = 0.62;
  let hts = null, vts = null;
  if (!lite) {
    hts = new ShaderPass(HorizontalTiltShiftShader);
    hts.uniforms.r.value = focus; hts.uniforms.h.value = BLUR / W;
    composer.addPass(hts);
    vts = new ShaderPass(VerticalTiltShiftShader);
    vts.uniforms.r.value = focus; vts.uniforms.v.value = BLUR / H;
    composer.addPass(vts);
  }

  let smaa = null;
  if (!lite) { smaa = new SMAAPass(W * pr, H * pr); composer.addPass(smaa); }

  const finish = new ShaderPass(FinishShader);
  finish.material.defines.FXAA = lite ? 1 : 0;
  finish.uniforms.uResolution.value.set(W * pr, H * pr);
  composer.addPass(finish);

  function resize(w, h) {
    composer.setSize(w, h);
    const p = renderer.getPixelRatio();
    finish.uniforms.uResolution.value.set(w * p, h * p);
    if (hts) hts.uniforms.h.value = BLUR / w;
    if (vts) vts.uniforms.v.value = BLUR / h;
  }

  // `grain` keeps its name: Town's loop drives grain.uniforms.uTime.
  return { composer, bloom, grain: finish, resize };
}
