import * as THREE from 'three';
import { CHAR } from './palette.js';

// A characterful low-poly avatar with a tapered jacketed torso, two-segment
// arms (elbow) and legs (knee) for a believable gait, and a friendly face.
// Built as: group (heading) → rig (bob/twist) → body parts. Movement,
// collision and click-to-move live in update().

export class Player {
  constructor() {
    this.group = new THREE.Group();
    this.rig = new THREE.Group();
    this.group.add(this.rig);

    this.radius = 0.9;
    this.speed = 9.5;
    this.velocity = new THREE.Vector3();
    this.heading = 0;
    this.moveTarget = null;
    this.walkPhase = 0;

    this._build();
  }

  _mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, flatShading: false, ...opts });
  }

  _limb(w, h, d, mat, taperTop = 1) {
    // a short box limb segment whose pivot is at its TOP (y=0), extending down
    const geo = new THREE.BoxGeometry(w, h, d);
    if (taperTop !== 1) {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) > 0) { pos.setX(i, pos.getX(i) * taperTop); pos.setZ(i, pos.getZ(i) * taperTop); }
      }
    }
    geo.translate(0, -h / 2, 0);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    return m;
  }

  _build() {
    const skin = this._mat(CHAR.skin, { roughness: 0.7 });
    const jacket = this._mat(CHAR.shirt);
    const jacketDk = this._mat(0x3f86e0);
    const pants = this._mat(CHAR.pants);
    const shoes = this._mat(CHAR.shoes, { roughness: 0.6 });
    const hair = this._mat(CHAR.hair);

    // ── Torso: tapered waist + broader chest, with a jacket collar ──────────
    const pelvis = this._limb(0.95, 0.55, 0.62, pants, 1.15); pelvis.position.y = 1.95; this.rig.add(pelvis);
    const waist = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.5, 0.6), jacket);
    waist.position.y = 1.7; waist.castShadow = true; this.rig.add(waist);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.8, 0.66), jacket);
    chest.position.y = 2.25; chest.castShadow = true; this.rig.add(chest);
    // jacket zipper + collar
    const zip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.04), jacketDk);
    zip.position.set(0, 2.0, 0.34); this.rig.add(zip);
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.18, 0.6), jacketDk);
    collar.position.y = 2.66; this.rig.add(collar);

    // ── Head, hair, face ─────────────────────────────────────────────────────
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.26, 8), skin);
    neck.position.y = 2.78; this.rig.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 16), skin);
    head.position.y = 3.16; head.scale.set(1, 1.05, 0.95); head.castShadow = true; this.rig.add(head);
    // hair: a slim skullcap that shows the forehead/face
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.465, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.46), hair);
    cap.position.y = 3.27; cap.scale.set(1, 1.0, 0.96); this.rig.add(cap);
    const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.1, 0.08), hair);
    fringe.position.set(0, 3.33, 0.4); this.rig.add(fringe);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 10), eyeMat);
      eye.position.set(sx * 0.15, 3.14, 0.41); this.rig.add(eye);
    }

    // ── Arms: upper + forearm (elbow) + hand ────────────────────────────────
    this.armL = new THREE.Group(); this.armL.position.set(-0.66, 2.55, 0);
    this.armR = new THREE.Group(); this.armR.position.set(0.66, 2.55, 0);
    this.foreL = new THREE.Group(); this.foreR = new THREE.Group();
    for (const [arm, fore] of [[this.armL, this.foreL], [this.armR, this.foreR]]) {
      arm.add(this._limb(0.3, 0.62, 0.3, jacket));        // upper arm (sleeve)
      fore.position.y = -0.62; arm.add(fore);
      fore.add(this._limb(0.27, 0.5, 0.27, jacketDk));     // forearm (cuff)
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skin);
      hand.position.y = -0.56; hand.castShadow = true; fore.add(hand);
      this.rig.add(arm);
    }

    // ── Legs: thigh + shin (knee) + shoe ────────────────────────────────────
    this.thighL = new THREE.Group(); this.thighL.position.set(-0.26, 1.7, 0);
    this.thighR = new THREE.Group(); this.thighR.position.set(0.26, 1.7, 0);
    this.shinL = new THREE.Group(); this.shinR = new THREE.Group();
    for (const [thigh, shin] of [[this.thighL, this.shinL], [this.thighR, this.shinR]]) {
      thigh.add(this._limb(0.38, 0.78, 0.42, pants));
      shin.position.y = -0.78; thigh.add(shin);
      shin.add(this._limb(0.34, 0.78, 0.38, pants));
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.62), shoes);
      shoe.position.set(0, -0.86, 0.1); shoe.castShadow = true; shin.add(shoe);
      this.rig.add(thigh);
    }
  }

  get position() { return this.group.position; }

  update(dt, worldDir, obstacles, clampFn) {
    let desired = new THREE.Vector3(worldDir.x, 0, worldDir.z);
    if (desired.lengthSq() < 0.001 && this.moveTarget) {
      const to = this.moveTarget.clone().sub(this.group.position); to.y = 0;
      if (to.length() < 0.6) this.moveTarget = null;
      else desired = to.normalize();
    } else if (desired.lengthSq() > 0.001) {
      this.moveTarget = null; desired.normalize();
    }

    const target = desired.multiplyScalar(this.speed);
    this.velocity.x += (target.x - this.velocity.x) * Math.min(1, dt * 10);
    this.velocity.z += (target.z - this.velocity.z) * Math.min(1, dt * 10);
    const moving = this.velocity.length() > 0.4;

    const pos = this.group.position;
    let nx = pos.x + this.velocity.x * dt;
    let nz = pos.z + this.velocity.z * dt;
    for (const o of obstacles) {
      const dx = nx - o.x, dz = nz - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + this.radius;
      if (d < min && d > 0.0001) { const push = min - d; nx += (dx / d) * push; nz += (dz / d) * push; }
    }
    pos.x = nx; pos.z = nz;
    if (clampFn) clampFn(pos);

    if (moving) {
      const want = Math.atan2(this.velocity.x, this.velocity.z);
      let delta = want - this.heading;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.heading += delta * Math.min(1, dt * 12);
      this.group.rotation.y = this.heading;
    }

    // ── Gait ────────────────────────────────────────────────────────────────
    const sp = this.velocity.length();
    if (moving) this.walkPhase += dt * (5.5 + sp * 0.55);
    const p = this.walkPhase;
    const k = Math.min(1, dt * 10);
    const swing = moving ? 0.7 : 0;

    // legs: hip swing + knee bend on the rising leg
    const setLeg = (thigh, shin, ph) => {
      const s = Math.sin(ph) * swing;
      thigh.rotation.x += (s - thigh.rotation.x) * k;
      const bend = moving ? Math.max(0, Math.sin(ph + Math.PI * 0.5)) * 0.9 : 0;
      shin.rotation.x += (bend - shin.rotation.x) * k;
    };
    setLeg(this.thighL, this.shinL, p);
    setLeg(this.thighR, this.shinR, p + Math.PI);

    // arms: opposite swing + slight elbow bend
    const setArm = (arm, fore, ph) => {
      const s = Math.sin(ph) * swing * 0.85;
      arm.rotation.x += (s - arm.rotation.x) * k;
      const bend = moving ? (-0.25 - Math.max(0, Math.sin(ph)) * 0.35) : 0;
      fore.rotation.x += (bend - fore.rotation.x) * k;
    };
    setArm(this.armL, this.foreL, p + Math.PI);
    setArm(this.armR, this.foreR, p);

    // body bob + counter-twist, plus a gentle idle breathe
    const bob = moving ? Math.abs(Math.sin(p)) * 0.09 : Math.sin(this.walkPhase * 0.0 + performance.now() * 0.0018) * 0.02;
    this.rig.position.y += (bob - this.rig.position.y) * k;
    const twist = moving ? Math.sin(p) * 0.06 : 0;
    this.rig.rotation.y += (twist - this.rig.rotation.y) * k;
    const lean = moving ? 0.05 : 0;
    this.rig.rotation.x += (lean - this.rig.rotation.x) * k;

    return moving;
  }
}
