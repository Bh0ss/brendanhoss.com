import * as THREE from 'three';
import { GROUND, SKY } from './palette.js';

// Stylized shoreline water. The surface is one big plane that DISCARDS every
// fragment shoreward of the waterline, so it never pokes through the grass no
// matter how the land is shaped. A few summed sines ripple it, a fresnel term
// mixes deep/shallow teal, the sun adds a moving sparkle, and a foam band rides
// the waterline.

export function createWater({ waterline = 56, sunDir }) {
  const geo = new THREE.PlaneGeometry(900, 700, 200, 140);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      // Deep, desaturated ocean blue (was teal — teal over the green seabed read
      // murky-green through the translucent surface). Shallow is a lighter aqua for
      // the near-shore band; deep water is opaque so the green ground never shows.
      uDeep: { value: new THREE.Color(0x2f6c8f) },
      uShallow: { value: new THREE.Color(0x6fb4c4) },
      uFoam: { value: new THREE.Color(0xfbfdfb) },
      uSun: { value: sunDir.clone().normalize() },
      uShore: { value: waterline },
      uSkyTop: { value: new THREE.Color(SKY.top) },
      uSkyHorizon: { value: new THREE.Color(SKY.horizon) },
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      uniform float uShore;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying float vWave;
      // p.x = world X (along the beach), p.y = world Z (out to sea).
      // Swells roll TOWARD shore (-Z) with wavefronts running parallel to the
      // beach, so the water rises and recedes up/down the beach rather than
      // sliding sideways across it. Wavelengths are short enough that several
      // crest lines are visible marching in at once.
      float wave(vec2 p){
        float x = p.x, z = p.y;
        float w1 = sin(z*0.30 + uTime*1.25) * 0.26;          // primary shoreward swell
        float w2 = sin(z*0.16 + uTime*0.75) * 0.18;          // longer secondary swell
        float w3 = sin(x*0.05 + z*0.04 + uTime*0.30) * 0.06; // gentle along-shore bow
        return w1 + w2 + w3;
      }
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float raw = wave(wp.xz);
        // Waves only ever rise ABOVE the base waterline — never dip below it — and
        // grow from the shoreline outward. This stops troughs from sinking under
        // the (green) ground plane in the sea (which was showing green bands in the
        // water), and lets the surface meet the sand flush at the shore (no lip).
        float depth01 = clamp((wp.z - uShore) / 9.0, 0.0, 1.0);    // 0 at shore → 1 offshore (short taper)
        float disp = (raw + 0.5) * depth01;                        // always >= 0
        wp.y += disp;
        float e = 1.2;
        vNormalW = normalize(vec3(raw - wave(wp.xz + vec2(e,0.0)), e, raw - wave(wp.xz + vec2(0.0,e))));
        vWave = raw;
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uDeep, uShallow, uFoam, uSun, uSkyTop, uSkyHorizon;
      uniform float uShore, uTime;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying float vWave;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3,289.1)))*43758.5); }
      void main(){
        // Swash: the waterline runs UP the beach (-Z) on a crest and pulls back
        // on a trough, in phase with the primary swell at the shore — the leading
        // wave visibly washes up the sand and recedes like a real wave. Amplitude
        // is large enough to read clearly; the furthest run-up (~z 45.5) stays on
        // sand, ~1.5 units seaward of the grass line (SHORE_Z=44), so land is never
        // covered.
        float swash = sin(uShore*0.30 + uTime*1.25);   // phase-locked to the primary swell (w1)
        float shoreNow = uShore - swash*3.0 - 0.5;
        if (vWorld.z < shoreNow) discard;
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);

        // Base water color by DEPTH (distance from the shoreline): a light aqua in
        // the shallows grading to deep blue offshore. Depth also drives opacity —
        // the shallow band is slightly translucent (reads as water over sand) while
        // deep water is fully opaque, so the green seabed never shows through.
        float depth = clamp((vWorld.z - uShore) / 24.0, 0.0, 1.0);
        vec3 col = mix(uShallow, uDeep, depth);

        // sky reflection (stronger at grazing angles)
        vec3 R = reflect(-V, N);
        float ry = clamp(R.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 sky = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, 0.6, ry));
        col = mix(col, sky, fres * 0.45);

        vec3 H = normalize(uSun + V);
        float spec = pow(max(dot(N, H), 0.0), 90.0);
        float sparkle = step(0.92, hash(floor(vWorld.xz*2.0) + floor(uTime*3.0)));
        col += spec * 1.1 + sparkle * spec * 1.8;

        // Crest/trough relief: lighten the tops of swells, darken the troughs so
        // the rolling bands read clearly as waves marching toward the beach. Done
        // in COLOR (not just geometry) so the swells read strongly even though the
        // surface no longer dips into troughs (which would reveal the green ground).
        col += clamp(vWave * 1.0, -1.0, 1.0) * 0.12;
        // Foam caps riding the tops of the crests — the main "rolling waves" cue.
        float crestFoam = smoothstep(0.16, 0.40, vWave);
        col = mix(col, uFoam, crestFoam * 0.5);

        float foam = smoothstep(5.0, 0.0, vWorld.z - shoreNow);   // foam rides the moving edge
        foam *= 0.7 + 0.3 * sin(vWorld.x*0.16 + uTime*0.8);       // subtle texture along the crest
        col = mix(col, uFoam, clamp(foam, 0.0, 0.9));

        // Opacity by depth: a thin translucent shallow band (water over wet sand)
        // grading to fully opaque deep water that hides the green seabed. The
        // opacity ramp is faster than the colour ramp — fully opaque by z≈63,
        // before the sand plane ends (z 65) — so no green ground is ever visible
        // through the water. Foam is always opaque so the wave edge reads crisp.
        float opaqueDepth = clamp((vWorld.z - uShore) / 14.0, 0.0, 1.0);
        float alpha = max(mix(0.82, 1.0, opaqueDepth), clamp(foam, 0.0, 1.0));
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0.05, waterline + 300);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;

  return { mesh, update(t) { mat.uniforms.uTime.value = t; } };
}
