import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';

// Painterly color grade (LDR, post-tonemap): gentle S-contrast, a teal-orange
// split-tone (cool shadows / warm highlights), and a saturation lift — the
// cohesive "look" Abeto gets from a baked LUT, done analytically.
const ColorGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: 1.03 },
    saturation: { value: 1.04 },
    lift: { value: 0.020 },
    splitStrength: { value: 0.04 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float contrast, saturation, lift, splitStrength;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      col = (col - 0.5) * contrast + 0.5 + lift;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 warm = vec3(1.0, 0.96, 0.88);
      vec3 cool = vec3(0.90, 0.97, 1.04);
      col *= mix(cool, warm, smoothstep(0.15, 0.85, l)) * (1.0 - splitStrength) + splitStrength;
      col = mix(vec3(l), col, saturation);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

// The "Apple-grade" look comes mostly from post: ambient occlusion to ground
// everything, a whisper of bloom on the sky/water, a tilt-shift diorama blur
// that sells the "tiny world", and a soft vignette + grade. Wrapped so a
// failure degrades to plain rendering rather than a black screen.

// Subtle animated film grain — makes flat low-poly read as "printed/painterly"
// rather than CG. The cohesion glue Abeto has.
const GrainShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, amount: { value: 0.03 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, amount; varying vec2 vUv;
    float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 col = texture2D(tDiffuse, vUv);
      float n = rand(vUv + fract(uTime)) * 2.0 - 1.0;
      col.rgb += n * amount;
      gl_FragColor = col;
    }`,
};

export function createComposer(renderer, scene, camera, { mobile = false } = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const W = size.x, H = size.y;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // Ambient occlusion — the single biggest "pro" upgrade for low-poly.
  let gtao = null;
  if (!mobile) {
    gtao = new GTAOPass(scene, camera, W, H);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.55;
    try {
      gtao.updateGtaoMaterial({
        radius: 2.2, distanceExponent: 1.0, thickness: 1.2,
        scale: 1.0, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false,
      });
    } catch (_) { /* keep defaults */ }
    composer.addPass(gtao);
  }

  // Subtle bloom — sun glints on water, sky lift. Desktop only (mip-chain cost).
  let bloom = null;
  if (!mobile) {
    bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.22, 0.7, 0.86);
    composer.addPass(bloom);
  }

  // Tone-map + sRGB here so subsequent passes operate on display-ready color.
  composer.addPass(new OutputPass());

  composer.addPass(new ShaderPass(ColorGradeShader));

  // Tilt-shift: blur grows with vertical distance from a sharp focus band.
  // Two full-screen passes — desktop only.
  const BLUR = 1.4;
  const focus = 0.62; // screen-height of the focus band (roughly the character)
  let hts = null, vts = null;
  if (!mobile) {
    hts = new ShaderPass(HorizontalTiltShiftShader);
    hts.uniforms.r.value = focus; hts.uniforms.h.value = BLUR / W;
    composer.addPass(hts);
    vts = new ShaderPass(VerticalTiltShiftShader);
    vts.uniforms.r.value = focus; vts.uniforms.v.value = BLUR / H;
    composer.addPass(vts);
  }

  const vig = new ShaderPass(VignetteShader);
  vig.uniforms.offset.value = 1.1;
  vig.uniforms.darkness.value = 0.95;
  composer.addPass(vig);

  if (!mobile) composer.addPass(new SMAAPass(W, H));

  const grain = new ShaderPass(GrainShader);
  composer.addPass(grain);

  function resize(w, h) {
    composer.setSize(w, h);
    gtao?.setSize?.(w, h);
    if (hts) hts.uniforms.h.value = BLUR / w;
    if (vts) vts.uniforms.v.value = BLUR / h;
  }

  return { composer, bloom, gtao, grain, resize };
}
