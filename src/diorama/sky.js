import * as THREE from 'three';

// Diorama sky + haze (W2). Replaces the classic dome, which was a fixed 420-unit sphere centred on
// the green: from a wide or low camera its lower half (flat horizon colour) showed past the edge
// of the land as a beige wall. This dome rides the camera, so it is always the backdrop, and
// everything below the horizon line is exactly the fog colour: land and sea fade into it at any
// distance, from any angle, with no seam.
//
// Golden hour, sun low in the south-west over the Sound: a warm haze band at the horizon (fog),
// a gold lobe around the sun, pale blue by ~20 degrees up, clear blue at the zenith, and a faint
// rose cast on the side away from the sun.
export const HAZE = 0xecd9c2;           // horizon == fog: warm, slightly greyed so distance reads as air

export function createSky({ scene, camera, sunDir, lite }) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: {
      uHaze: { value: new THREE.Color(HAZE) },
      uLow: { value: new THREE.Color(0xd9dfe0) },     // the pale band above the haze
      uMid: { value: new THREE.Color(0xa9c8e2) },
      uTop: { value: new THREE.Color(0x5f95c8) },
      uGlow: { value: new THREE.Color(0xffc583) },
      uRose: { value: new THREE.Color(0xe8c9c4) },
      uSunCol: { value: new THREE.Color(0xfff2d8) },
      uSun: { value: sunDir.clone().normalize() },
    },
    vertexShader: /* glsl */`
      varying vec3 vD;
      void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uHaze, uLow, uMid, uTop, uGlow, uRose, uSunCol, uSun; varying vec3 vD;
      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void main(){
        vec3 d = normalize(vD);
        float h = max(d.y, 0.0);
        float s = dot(d, uSun);
        // azimuth only (how far round from the sun), so the gold band hugs the horizon under it
        vec2 az = normalize(d.xz + 1e-5), saz = normalize(uSun.xz);
        float toward = dot(az, saz) * 0.5 + 0.5;
        vec3 col = mix(uHaze, uLow, smoothstep(0.0, 0.10, h));
        col = mix(col, uMid, smoothstep(0.06, 0.34, h));
        col = mix(col, uTop, smoothstep(0.30, 0.95, h));
        float lift = smoothstep(0.0, 0.035, h);                  // exactly the fog colour at the horizon
        // gold under the sun: broad and low, then a tighter halo
        float band = pow(toward, 3.0) * (1.0 - smoothstep(0.0, 0.45, h));
        col = mix(col, uGlow, (band * 0.55 + pow(max(s, 0.0), 12.0) * 0.45) * lift);
        // the side away from the sun picks up a little rose in the low sky
        col = mix(col, uRose, pow(1.0 - toward, 2.0) * (1.0 - smoothstep(0.02, 0.3, h)) * 0.45 * lift);
        col += uSunCol * (smoothstep(0.9988, 0.9993, s) * 4.0 + pow(max(s, 0.0), 350.0) * 1.1) * lift;
        col += (h12(gl_FragCoord.xy) - 0.5) / 255.0;            // de-band the long gradients
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, lite ? 24 : 40, lite ? 12 : 20), mat);
  dome.scale.setScalar(1000);
  dome.frustumCulled = false;
  dome.renderOrder = -2;
  dome.name = 'dio-sky';
  dome.userData.noAO = true;
  dome.onBeforeRender = () => { dome.position.copy(camera.position); dome.updateMatrixWorld(); };
  scene.add(dome);

  // Linear haze: the town stays crisp (a light veil on its far side), the woods and hills fade
  // through it, and by `far` everything is the horizon colour.
  scene.fog = new THREE.Fog(HAZE, 70, 470);
  return { dome, material: mat };
}
