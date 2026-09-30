import * as THREE from 'three';
import { seeded } from './palette.js';

// Soft drifting clouds + a small flock of circling birds. Pure motion/depth —
// no interaction — but they're what make a static diorama feel alive.
//
// Clouds are camera-facing sprites painted on a canvas: cream tops, a peach
// golden-hour underside, soft edges. Three texture variants, shared.

function cloudTexture(rng) {
  const W = 512, H = 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  // puffs: soft radial blobs along a flattened base
  const puffs = 7 + ((rng() * 4) | 0);
  for (let i = 0; i < puffs; i++) {
    const t = i / (puffs - 1);
    const x = 70 + t * (W - 140) + (rng() - 0.5) * 40;
    const r = (46 + rng() * 44) * (1 - Math.abs(t - 0.5) * 0.9);
    const y = H * 0.62 - r * 0.45 - rng() * 18;
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // flat-ish base: fade out below the belly line
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(0.6, 'rgba(0,0,0,1)'); fade.addColorStop(0.78, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade; ctx.fillRect(0, 0, W, H);
  // golden-hour tint: cream top → peach belly
  ctx.globalCompositeOperation = 'source-atop';
  const tint = ctx.createLinearGradient(0, 0, 0, H * 0.7);
  tint.addColorStop(0, 'rgba(255,248,236,1)');
  tint.addColorStop(0.55, 'rgba(255,229,204,1)');
  tint.addColorStop(1, 'rgba(244,184,150,1)');
  ctx.fillStyle = tint; ctx.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// one wing triangle + one material, shared by every bird (mirrored for the other side)
const birdMat = new THREE.MeshBasicMaterial({ color: 0x4a3c3e, fog: true, side: THREE.DoubleSide });
const wingGeo = new THREE.BufferGeometry();
wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1.4, 0, -0.5, 1.4, 0, 0.5], 3));
function bird() {
  const g = new THREE.Group();
  const mat = birdMat;
  const wL = new THREE.Mesh(wingGeo, mat);
  const wR = new THREE.Mesh(wingGeo, mat);
  wR.scale.x = -1;
  g.add(wL, wR);
  g.userData = { wL, wR };
  return g;
}

export function createAtmosphere(scene) {
  const rng = seeded(0xc10d5);
  const group = new THREE.Group();
  scene.add(group);

  const mats = [0, 1, 2].map(() => new THREE.SpriteMaterial({
    map: cloudTexture(rng), transparent: true, depthWrite: false, fog: false, opacity: 0.95,
  }));

  const clouds = [];
  for (let i = 0; i < 11; i++) {
    const c = new THREE.Sprite(mats[i % 3]);
    const sc = rng.range(0.8, 1.7);
    c.scale.set(56 * sc, 28 * sc, 1);
    c.position.set(rng.range(-190, 190), rng.range(46, 78), rng.range(-80, 200));
    c.renderOrder = -1;
    c.userData = { speed: rng.range(1.2, 2.6), sc };
    group.add(c);
    clouds.push(c);
  }

  const birds = [];
  for (let i = 0; i < 6; i++) {
    const b = bird();
    b.userData.r = rng.range(30, 70);
    b.userData.h = rng.range(34, 50);
    b.userData.phase = rng() * Math.PI * 2;
    b.userData.speed = rng.range(0.18, 0.30);
    b.userData.cx = rng.range(-15, 15);
    b.userData.cz = -20 + rng.range(-15, 15);
    group.add(b);
    birds.push(b);
  }

  // dt and t arrive already scaled for reduced motion (Town.update).
  function update(dt, t) {
    for (const c of clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 200) c.position.x = -200;
    }
    for (const b of birds) {
      const a = b.userData.phase + t * b.userData.speed;
      b.position.set(
        b.userData.cx + Math.cos(a) * b.userData.r,
        b.userData.h + Math.sin(a * 1.7) * 2.0,
        b.userData.cz + Math.sin(a) * b.userData.r
      );
      b.rotation.y = -a + Math.PI / 2;
      const flap = Math.sin(t * 9 + b.userData.phase) * 0.5 + 0.2;
      b.userData.wL.rotation.z = flap;
      b.userData.wR.rotation.z = -flap;
    }
  }

  return { group, update };
}
