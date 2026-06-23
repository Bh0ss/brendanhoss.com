import * as THREE from 'three';
import { BUILD } from './palette.js';
import { LANDMARKS } from '../data.js';

// Builds an interactive building + signboard + glowing beacon for each career
// landmark. Returns the scene group, an `interactables` list (id, x, z,
// collision + interaction radii, data) for Town's proximity logic, and an
// update() that animates the beacons.

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true, ...opts });
}

function gableRoof(w, d, h, color) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, h); shape.lineTo(-w / 2, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  const m = new THREE.Mesh(geo, mat(color)); m.castShadow = true; m.receiveShadow = true;
  return m;
}

function windowGrid(w, h, d, cols, rows) {
  const g = new THREE.Group();
  const glass = mat(0x9fc6d4, { emissive: 0x2a4650, emissiveIntensity: 0.35, flatShading: false });
  const frame = mat(BUILD.white);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = (c - (cols - 1) / 2) * (w / cols);
    const y = h * 0.28 + r * (h * 0.62 / Math.max(1, rows - 1 || 1));
    const fr = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.92, 0.12), frame); fr.position.set(x, y, d / 2 + 0.02); g.add(fr);
    const wn = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.7, 0.16), glass); wn.position.set(x, y, d / 2 + 0.04); g.add(wn);
  }
  return g;
}

function buildingFor(lm) {
  const g = new THREE.Group();
  const accent = mat(lm.accent, { flatShading: false });
  let w, d, h, wall, roof;

  if (lm.kind === 'hero') {
    w = 12; d = 9; h = 9; wall = BUILD.white; roof = BUILD.roofSlate;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(wall));
    body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true; g.add(body);
    // accent band + flat parapet roof (modern HQ)
    const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 1.0, d + 0.2), accent); band.position.y = h - 0.5; g.add(band);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6), mat(BUILD.roofDark)); cap.position.y = h + 0.2; g.add(cap);
    g.add(windowGrid(w, h, d, 5, 2));
    // entrance canopy
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 1.6), accent); canopy.position.set(0, 2.6, d / 2 + 0.8); g.add(canopy);
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.3, 0.16), mat(0x2f3a44, { flatShading: false })); door.position.set(0, 1.15, d / 2 + 0.02); g.add(door);
  } else if (lm.kind === 'edu') {
    w = 9; d = 7; h = 6; wall = BUILD.brick; roof = BUILD.roofDark;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(wall)); body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true; g.add(body);
    g.add(gableRoof(w + 0.4, d + 0.4, 2.6, roof)).position.y = h;
    // portico columns + pediment
    for (let i = 0; i < 4; i++) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 3.4, 10), mat(BUILD.white));
      col.position.set(-2.4 + i * 1.6, 1.7, d / 2 + 1.0); col.castShadow = true; g.add(col);
    }
    const ped = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.5, 2.2), mat(BUILD.white)); ped.position.set(0, 3.6, d / 2 + 1.0); g.add(ped);
    const tri = gableRoof(7.4, 2.2, 1.1, BUILD.white); tri.position.set(0, 3.85, d / 2 + 1.0); g.add(tri);
    g.add(windowGrid(w, h, d, 4, 1));
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 0.16), mat(BUILD.trim)); door.position.set(0, 1.1, d / 2 + 0.02); g.add(door);
  } else { // work
    w = 8; d = 6.5; h = 5; wall = lm.id === 'catalyst' ? BUILD.sage : BUILD.cream; roof = BUILD.roofTerracotta;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(wall)); body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true; g.add(body);
    g.add(gableRoof(w + 0.4, d + 0.4, 2.2, roof)).position.y = h;
    const awning = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, 0.25, 1.1), accent); awning.position.set(0, 3.2, d / 2 + 0.5); g.add(awning);
    g.add(windowGrid(w, h, d, 3, 1));
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 0.16), mat(BUILD.trim)); door.position.set(0, 1.05, d / 2 + 0.02); g.add(door);
  }

  g.userData.size = { w, d, h };
  return g;
}

function makeSign(text, accent, y) {
  const group = new THREE.Group();
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 140;
  const ctx = cv.getContext('2d');
  const a = '#' + new THREE.Color(accent).getHexString();
  // rounded board
  ctx.fillStyle = '#f8f1e2'; ctx.strokeStyle = a; ctx.lineWidth = 12;
  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  rr(10, 10, 492, 120, 22); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#33413e'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '600 62px Fredoka, Trebuchet MS, sans-serif';
  ctx.fillText(text, 256, 74);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: true }));
  board.position.y = y; group.add(board);
  // two little posts down to the roof
  for (const sx of [-1.6, 1.6]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 6), mat(0x6b5640));
    post.position.set(sx, y - 1.0, 0); group.add(post);
  }
  return group;
}

function beaconFor(accent) {
  const g = new THREE.Group();
  const col = new THREE.Color(accent);
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.4, roughness: 0.4, fog: false }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 8, 24), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, fog: false }));
  ring.rotation.x = Math.PI / 2;
  // soft light shaft
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 5, 12, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  shaft.position.y = -2.0;
  g.add(orb, ring, shaft);
  g.userData = { orb, ring, base: 0 };
  return g;
}

export function buildLandmarks(scene, path) {
  const group = new THREE.Group(); scene.add(group);
  const interactables = [];
  const beacons = [];

  for (const lm of LANDMARKS) {
    const node = new THREE.Group();
    node.position.set(lm.pos[0], 0, lm.pos[1]);

    // Auto-orient the entrance (+z) toward the nearest point on the trail.
    let face = lm.face ?? 0;
    if (path && lm.kind !== 'intro') {
      let best = Infinity, bx = lm.pos[0], bz = lm.pos[1];
      for (const s of path.samples) {
        const d = Math.hypot(s.x - lm.pos[0], s.z - lm.pos[1]);
        if (d < best) { best = d; bx = s.x; bz = s.z; }
      }
      face = Math.atan2(bx - lm.pos[0], bz - lm.pos[1]);
    }
    node.rotation.y = face;

    let footprint = 3.2, signY = 6.5, beaconY = 5;
    if (lm.kind !== 'intro' && lm.kind !== 'contact') {
      const b = buildingFor(lm); node.add(b);
      const s = b.userData.size; footprint = Math.max(s.w, s.d) / 2;
      // foundation plinth — grounds the building (kills the "floating" look)
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(s.w + 1.3, 0.5, s.d + 1.3), mat(0xcfc3a6, { flatShading: false }));
      plinth.position.y = -0.12; plinth.receiveShadow = true; node.add(plinth);
      signY = s.h + (lm.kind === 'edu' ? 3.2 : lm.kind === 'hero' ? 3.0 : 2.8);
      // sign in front (toward +z, which faces the approach after rotation)
      const sign = makeSign(lm.sign, lm.accent, signY); sign.position.z = s.d / 2;
      node.add(sign);
      beaconY = s.h + 4.4;
    } else if (lm.kind === 'contact') {
      // harbor kiosk: a small signpost + bench-like base
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), mat(0x6b5640)); post.position.y = 2; post.castShadow = true; node.add(post);
      const sign = makeSign(lm.sign, lm.accent, 4.2); node.add(sign);
      footprint = 1.2; beaconY = 5.4;
    } else {
      // intro: just a beacon over the green near the gazebo
      footprint = 0; beaconY = 6.5;
    }

    const beacon = beaconFor(lm.accent); beacon.position.y = beaconY; node.add(beacon);
    beacons.push(beacon);

    group.add(node);

    interactables.push({
      id: lm.id, data: lm,
      x: lm.pos[0], z: lm.pos[1],
      collide: footprint > 0 ? footprint + 0.4 : 0,
      interact: Math.max(footprint, 2) + 5.5,
      beacon,
    });
  }

  function update(dt, t) {
    for (const b of beacons) {
      b.userData.orb.position.y = Math.sin(t * 1.6 + b.position.x) * 0.18;
      b.userData.orb.rotation.y += dt * 0.8;
      b.userData.ring.scale.setScalar(1 + Math.sin(t * 2 + b.position.x) * 0.08);
      b.userData.ring.rotation.z += dt * 0.5;
    }
  }

  return { group, interactables, update };
}
