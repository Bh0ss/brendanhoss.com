import * as THREE from 'three';

// Soft drifting clouds + a small flock of circling birds. Pure motion/depth —
// no interaction — but they're what make a static diorama feel alive.

function cloud() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true, opacity: 0.92, fog: false,
  });
  const puffs = 4 + (Math.random() * 3 | 0);
  for (let i = 0; i < puffs; i++) {
    const r = 4 + Math.random() * 5;
    const p = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
    p.position.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 8);
    p.scale.y = 0.6;
    g.add(p);
  }
  return g;
}

function bird() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x39424a, fog: true });
  const wingGeo = new THREE.BufferGeometry();
  // a single wing triangle, mirrored for the other side
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1.4, 0, -0.5, 1.4, 0, 0.5], 3));
  wingGeo.computeVertexNormals();
  const wL = new THREE.Mesh(wingGeo, mat);
  const wR = new THREE.Mesh(wingGeo, mat);
  wR.scale.x = -1;
  g.add(wL, wR);
  g.userData = { wL, wR };
  return g;
}

export function createAtmosphere(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const c = cloud();
    c.position.set((Math.random() - 0.5) * 320, 48 + Math.random() * 28, -60 + Math.random() * 200);
    const sc = 0.8 + Math.random() * 0.9;
    c.scale.setScalar(sc);
    c.userData = { speed: 1.2 + Math.random() * 1.4, sc };
    group.add(c);
    clouds.push(c);
  }

  const birds = [];
  for (let i = 0; i < 6; i++) {
    const b = bird();
    b.userData.r = 30 + Math.random() * 40;
    b.userData.h = 34 + Math.random() * 16;
    b.userData.phase = Math.random() * Math.PI * 2;
    b.userData.speed = 0.18 + Math.random() * 0.12;
    b.userData.cx = (Math.random() - 0.5) * 30;
    b.userData.cz = -20 + (Math.random() - 0.5) * 30;
    group.add(b);
    birds.push(b);
  }

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
