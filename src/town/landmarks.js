import * as THREE from 'three';
import { BUILD } from './palette.js';
import { LANDMARKS } from '../data.js';
import { outlineGroup } from './outline.js';

// Builds an interactive building + signboard + glowing beacon for each career
// landmark. Returns the scene group, an `interactables` list (id, x, z,
// collision + interaction radii, data) for Town's proximity logic, and an
// update() that animates the beacons.

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: false, ...opts });
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

// ── building part helpers ─────────────────────────────────────────────────
function box(w, h, d, color, y) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.y = (y !== undefined) ? y : h / 2;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function columns(n, spanW, height, z) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const x = n > 1 ? -spanW / 2 + (i / (n - 1)) * spanW : 0;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.30, height, 12), mat(BUILD.white));
    col.position.set(x, height / 2, z); col.castShadow = true; g.add(col);
  }
  return g;
}
function steps(w, z, n = 3) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const s = box(w - i * 0.7, 0.22, 0.7 + i * 0.5, BUILD.stone, 0.11 + i * 0.22);
    s.position.z = z + (n - i) * 0.34; g.add(s);
  }
  return g;
}
function clockFace() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#f6efe1'; c.beginPath(); c.arc(64, 64, 58, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#33413e'; c.lineWidth = 7; c.stroke();
  c.lineWidth = 5; c.beginPath(); c.moveTo(64, 64); c.lineTo(64, 28); c.moveTo(64, 64); c.lineTo(90, 70); c.stroke();
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.CircleGeometry(0.85, 24), new THREE.MeshBasicMaterial({ map: tex }));
}

function buildingFor(lm) {
  const g = new THREE.Group();
  const accentMat = mat(lm.accent, { flatShading: false });
  const id = lm.id;
  const style = id === 'veoci_se' ? 'hero'
    : (id === 'gateway' || id === 'uconn') ? 'collegiate'
    : (id === 'lambda' || id === 'story') ? 'tech'
    : (id === 'yale') ? 'civic'
    : 'commercial';
  let w, d, h;

  if (style === 'collegiate') {
    w = 11; d = 8; h = 6;
    g.add(box(w, h, d, BUILD.stone));
    g.add(box(w + 0.3, 0.5, d + 0.3, BUILD.trim, 0.25));               // baseboard
    const roofC = gableRoof(w + 0.5, d + 0.5, 2.6, BUILD.roofSlate); roofC.position.y = h; g.add(roofC);
    g.add(columns(4, 5.4, 3.6, d / 2 + 1.3));
    const ped = box(6.4, 0.5, 2.4, BUILD.white, 3.85); ped.position.z = d / 2 + 1.3; g.add(ped);
    const tri = gableRoof(6.4, 2.4, 1.2, BUILD.white); tri.position.set(0, 4.1, d / 2 + 1.3); g.add(tri);
    g.add(steps(5.6, d / 2 + 1.3));
    g.add(windowGrid(w, h, d, 5, 2));
    const door = box(1.5, 2.4, 0.16, BUILD.trim, 1.2); door.position.z = d / 2 + 0.02; g.add(door);
    if (id === 'gateway') {                                            // cupola
      g.add(box(1.8, 1.8, 1.8, BUILD.white, h + 1.3));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.7, 8), mat(BUILD.roofCopper)); cone.position.y = h + 3.0; cone.rotation.y = Math.PI / 8; cone.castShadow = true; g.add(cone);
      const fin = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), mat(0xddd6c8)); fin.position.y = h + 4.0; g.add(fin);
    } else {                                                           // clock tower (UConn)
      const tower = box(2.6, 5.5, 2.6, BUILD.stone, h + 1.4); tower.position.z = -1.0; g.add(tower);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2.0, 1.8, 4), mat(BUILD.roofCopper)); cap.position.set(0, h + 5.0, -1.0); cap.rotation.y = Math.PI / 4; cap.castShadow = true; g.add(cap);
      const clock = clockFace(); clock.position.set(0, h + 2.6, 0.31); g.add(clock);
    }
  } else if (style === 'tech') {
    w = 10; d = 7; h = 5;
    g.add(box(w, h, d, BUILD.white));
    g.add(box(w + 0.3, 0.5, d + 0.3, BUILD.trim, 0.25));
    g.add(box(w + 0.5, 0.5, d + 0.5, BUILD.roofDark, h + 0.2));        // flat roof cap
    const band = new THREE.Mesh(new THREE.BoxGeometry(w * 0.86, h * 0.45, 0.12), mat(BUILD.glassTech, { emissive: 0x2a4650, emissiveIntensity: 0.25 }));
    band.position.set(0, h * 0.56, d / 2 + 0.04); g.add(band);
    for (let i = -1; i <= 1; i++) { const mu = box(0.12, h * 0.45, 0.16, BUILD.white, h * 0.56); mu.position.x = i * w * 0.28; mu.position.z = d / 2 + 0.06; g.add(mu); }
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3, 0.8), accentMat); pylon.position.set(-w / 2 - 1.1, 1.5, d / 2 - 1); pylon.castShadow = true; g.add(pylon);
    const door = box(2.0, 2.3, 0.16, 0x2f3a44, 1.15); door.position.set(w * 0.18, 1.15, d / 2 + 0.02); g.add(door);
    const mech = box(1.6, 0.8, 1.4, BUILD.roofDark, h + 0.8); mech.position.set(-2, h + 0.8, -1); g.add(mech);
  } else if (style === 'civic') {
    w = 12; d = 10; h = 8;
    g.add(box(w, h, d, BUILD.stone));
    g.add(box(w + 0.4, 0.6, d + 0.4, BUILD.trim, 0.3));
    g.add(box(w + 0.6, 0.7, d + 0.6, BUILD.white, h - 0.2));           // cornice
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 1.2, 20), mat(BUILD.stone)); drum.position.y = h + 0.6; g.add(drum);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(BUILD.roofCopper)); dome.position.y = h + 1.2; dome.scale.y = 0.85; dome.castShadow = true; g.add(dome);
    const fin = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 10), mat(0xddd6c8)); fin.position.y = h + 3.6; g.add(fin);
    g.add(columns(6, 8.4, 5.6, d / 2 + 1.6));
    const ped = box(9.6, 0.6, 2.8, BUILD.white, 5.9); ped.position.z = d / 2 + 1.6; g.add(ped);
    const tri = gableRoof(9.6, 2.8, 1.4, BUILD.white); tri.position.set(0, 6.2, d / 2 + 1.6); g.add(tri);
    g.add(steps(8.6, d / 2 + 1.6, 4));
    g.add(windowGrid(w, h, d, 4, 2));
  } else if (style === 'hero') {
    w = 12; d = 9; h = 11;
    g.add(box(w, h, d, BUILD.white));
    g.add(box(w + 0.4, 0.6, d + 0.4, BUILD.trim, 0.3));
    const upper = box(8, 4, 6, BUILD.white, h + 2); upper.position.z = -1.2; g.add(upper);
    const capH = box(8.4, 0.5, 6.4, BUILD.roofDark, h + 4.25); capH.position.z = -1.2; g.add(capH);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.7, h + 4, 0.7), accentMat); fin.position.set(w / 2 - 0.4, (h + 4) / 2, d / 2 - 0.4); fin.castShadow = true; g.add(fin);
    g.add(box(w + 0.2, 0.8, d + 0.2, lm.accent, h - 0.6));             // accent band
    g.add(windowGrid(w, h, d, 6, 3));
    const canopy = box(3.6, 0.35, 1.8, lm.accent, 2.8); canopy.position.z = d / 2 + 0.9; g.add(canopy);
    const door = box(2.4, 2.5, 0.16, 0x2f3a44, 1.25); door.position.z = d / 2 + 0.02; g.add(door);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 6), mat(0xddd6c8)); mast.position.set(0, h + 5.6, -1.2); g.add(mast);
  } else { // commercial (Veoci · Ops)
    w = 8; d = 6.5; h = 5;
    g.add(box(w, h, d, BUILD.sage));
    g.add(box(w + 0.3, 0.5, d + 0.3, BUILD.trim, 0.25));
    const roofK = gableRoof(w + 0.4, d + 0.4, 2.2, BUILD.roofTerracotta); roofK.position.y = h; g.add(roofK);
    const awning = box(w * 0.92, 0.25, 1.1, lm.accent, 3.2); awning.position.z = d / 2 + 0.5; g.add(awning);
    g.add(windowGrid(w, h, d, 3, 1));
    const door = box(1.3, 2.1, 0.16, BUILD.trim, 1.05); door.position.z = d / 2 + 0.02; g.add(door);
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
  const board = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.25), new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: true }));
  board.position.y = y; group.add(board);
  // a soft drop-shadow plate behind the board so it pops against the sky
  const back = new THREE.Mesh(new THREE.PlaneGeometry(4.9, 1.5), new THREE.MeshBasicMaterial({ color: 0x2c2a2e, transparent: true, opacity: 0.22, fog: true }));
  back.position.set(0, y, -0.04); group.add(back);
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
  const signs = [];

  for (const lm of LANDMARKS) {
    const node = new THREE.Group();
    node.position.set(lm.pos[0], 0, lm.pos[1]);

    // Auto-orient the entrance (+z) toward the nearest point on the trail.
    let face = lm.face ?? 0;
    let nearX = lm.pos[0], nearZ = lm.pos[1];
    if (path && lm.kind !== 'intro') {
      let best = Infinity;
      for (const s of path.samples) {
        const d = Math.hypot(s.x - lm.pos[0], s.z - lm.pos[1]);
        if (d < best) { best = d; nearX = s.x; nearZ = s.z; }
      }
      face = Math.atan2(nearX - lm.pos[0], nearZ - lm.pos[1]);
    }
    node.rotation.y = face;

    let footprint = 3.2, signY = 6.5, beaconY = 5;
    if (lm.kind !== 'intro' && lm.kind !== 'contact') {
      const b = buildingFor(lm); node.add(b);
      outlineGroup(b, 0.06);
      const s = b.userData.size; footprint = Math.max(s.w, s.d) / 2;
      // foundation plinth — grounds the building (kills the "floating" look)
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(s.w + 1.3, 0.5, s.d + 1.3), mat(0xcfc3a6, { flatShading: false }));
      plinth.position.y = -0.12; plinth.receiveShadow = true; node.add(plinth);
      signY = s.h + (lm.kind === 'edu' ? 3.2 : lm.kind === 'hero' ? 3.0 : 2.8);
      // sign in front, lifted clear of the roofline; billboards to camera
      const sign = makeSign(lm.sign, lm.accent, signY); sign.position.z = s.d / 2 + 1.2;
      node.add(sign); signs.push({ obj: sign, node });
      beaconY = s.h + 4.4;
    } else if (lm.kind === 'contact') {
      // harbor kiosk: a small signpost + bench-like base
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), mat(0x6b5640)); post.position.y = 2; post.castShadow = true; node.add(post);
      const sign = makeSign(lm.sign, lm.accent, 4.2); node.add(sign); signs.push({ obj: sign, node });
      footprint = 1.2; beaconY = 5.4;
    } else {
      // intro: just a beacon over the green near the gazebo
      footprint = 0; beaconY = 6.5;
    }

    const beacon = beaconFor(lm.accent); beacon.position.y = beaconY; node.add(beacon);
    beacons.push(beacon);

    // glowing ground marker ring — wayfinding + "this is a place"
    const mr = Math.max(footprint, 1.6) + 2.2;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(mr - 0.55, mr, 44),
      new THREE.MeshBasicMaterial({ color: lm.accent, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, fog: true })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.renderOrder = 1; node.add(ring);
    beacon.userData.markerRing = ring;

    group.add(node);

    // approach point: where the nav arrows drop the player to view this place
    let ax, az;
    if (lm.kind === 'intro') { ax = 0; az = 6; }
    else {
      const dx = nearX - lm.pos[0], dz = nearZ - lm.pos[1], d = Math.hypot(dx, dz) || 1;
      ax = lm.pos[0] + (dx / d) * (footprint + 3);
      az = lm.pos[1] + (dz / d) * (footprint + 3);
    }
    interactables.push({
      id: lm.id, data: lm,
      x: lm.pos[0], z: lm.pos[1],
      collide: footprint > 0 ? footprint + 0.4 : 0,
      interact: Math.max(footprint, 2) + 5.5,
      approach: { x: ax, z: az },
      beacon,
    });
  }

  const _v = new THREE.Vector3();
  function update(dt, t, camera) {
    for (const b of beacons) {
      b.userData.orb.position.y = Math.sin(t * 1.6 + b.position.x) * 0.18;
      b.userData.orb.rotation.y += dt * 0.8;
      b.userData.ring.scale.setScalar(1 + Math.sin(t * 2 + b.position.x) * 0.08);
      b.userData.ring.rotation.z += dt * 0.5;
      if (b.userData.markerRing) b.userData.markerRing.material.opacity = 0.32 + 0.14 * (Math.sin(t * 2 + b.position.x) * 0.5 + 0.5);
    }
    // billboard signs (Y-axis only) so they always read broadside to camera
    if (camera) for (const s of signs) {
      s.node.getWorldPosition(_v);
      const yaw = Math.atan2(camera.position.x - _v.x, camera.position.z - _v.z);
      s.obj.rotation.y = yaw - s.node.rotation.y;
    }
  }

  return { group, interactables, update };
}
