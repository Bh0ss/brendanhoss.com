import * as THREE from 'three';
import { GROUND } from './palette.js';

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
      uDeep: { value: new THREE.Color(GROUND.waterDeep) },
      uShallow: { value: new THREE.Color(GROUND.water) },
      uFoam: { value: new THREE.Color(0xfbfdfb) },
      uSun: { value: sunDir.clone().normalize() },
      uShore: { value: waterline },
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      float wave(vec2 p){
        return sin(p.x*0.10 + uTime*0.9)*0.22
             + sin(p.y*0.14 - uTime*1.1)*0.16
             + sin((p.x+p.y)*0.06 + uTime*0.6)*0.26;
      }
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float h = wave(wp.xz);
        wp.y += h;
        float e = 1.5;
        vNormalW = normalize(vec3(h - wave(wp.xz + vec2(e,0.0)), e, h - wave(wp.xz + vec2(0.0,e))));
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uDeep, uShallow, uFoam, uSun;
      uniform float uShore, uTime;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3,289.1)))*43758.5); }
      void main(){
        if (vWorld.z < uShore) discard;             // never cover the land
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
        vec3 col = mix(uDeep, uShallow, clamp(fres*1.4 + 0.3, 0.0, 1.0));

        vec3 H = normalize(uSun + V);
        float spec = pow(max(dot(N, H), 0.0), 80.0);
        float sparkle = step(0.93, hash(floor(vWorld.xz*2.0) + floor(uTime*3.0)));
        col += spec * 0.7 + sparkle * spec * 1.4;

        float foam = smoothstep(4.0, 0.0, vWorld.z - uShore);   // band at the waterline
        foam *= 0.6 + 0.4 * sin(vWorld.x*0.5 + uTime*2.0);
        col = mix(col, uFoam, clamp(foam, 0.0, 0.9));

        gl_FragColor = vec4(col, mix(0.85, 0.97, fres));
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0.05, waterline + 300);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;

  return { mesh, update(t) { mat.uniforms.uTime.value = t; } };
}
