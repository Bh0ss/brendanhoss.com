import * as THREE from 'three';
import { CHAR } from './palette.js';

// A small low-poly character: blocky body, sphere head, swinging limbs. Built
// as a group so the whole thing turns to face travel direction, with a nested
// "rig" that bobs and swings while walking.

export class Player {
  constructor() {
    this.group = new THREE.Group();
    this.rig = new THREE.Group();      // bob/lean live here so heading is clean
    this.group.add(this.rig);

    this.radius = 0.9;                 // collision radius
    this.speed = 9.5;                  // units/sec at full tilt
    this.velocity = new THREE.Vector3();
    this.heading = 0;                  // facing angle (radians)
    this.moveTarget = null;            // click-to-move destination (Vector3 | null)
    this.walkPhase = 0;

    this._build();
  }

  _mat(color) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
  }

  _build() {
    const skin = this._mat(CHAR.skin);
    const shirt = this._mat(CHAR.shirt);
    const pants = this._mat(CHAR.pants);
    const shoes = this._mat(CHAR.shoes);
    const hair = this._mat(CHAR.hair);

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 0.7), shirt);
    torso.position.y = 1.7;
    torso.castShadow = true;
    this.rig.add(torso);

    // Neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.32, 8), skin);
    neck.position.y = 2.42;
    this.rig.add(neck);

    // Head + hair cap
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.47, 18, 14), skin);
    head.position.y = 2.78;
    head.castShadow = true;
    this.rig.add(head);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.49, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), hair);
    cap.position.y = 2.84;
    this.rig.add(cap);

    // Arms (pivoted at the shoulder so they swing), with hands
    this.armL = new THREE.Group(); this.armL.position.set(-0.72, 2.25, 0);
    this.armR = new THREE.Group(); this.armR.position.set(0.72, 2.25, 0);
    for (const grp of [this.armL, this.armR]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.0, 0.3), shirt);
      arm.position.y = -0.5; arm.castShadow = true;
      grp.add(arm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), skin);
      hand.position.y = -1.05; hand.castShadow = true;
      grp.add(hand);
      this.rig.add(grp);
    }

    // Legs (pivoted at the hip)
    this.legL = new THREE.Group(); this.legL.position.set(-0.28, 1.1, 0);
    this.legR = new THREE.Group(); this.legR.position.set(0.28, 1.1, 0);
    for (const grp of [this.legL, this.legR]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.1, 0.42), pants);
      leg.position.y = -0.55; leg.castShadow = true;
      grp.add(leg);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.28, 0.6), shoes);
      shoe.position.set(0, -1.05, 0.08);
      grp.add(shoe);
      this.rig.add(grp);
    }
  }

  get position() { return this.group.position; }

  // dir: camera-relative desired direction {x,z} already rotated into world.
  // obstacles: array of {x, z, r}. clampFn(pos): mutate pos to stay in bounds.
  update(dt, worldDir, obstacles, clampFn) {
    let desired = new THREE.Vector3(worldDir.x, 0, worldDir.z);

    // Click-to-move overrides keys only when no key direction is given.
    if (desired.lengthSq() < 0.001 && this.moveTarget) {
      const to = this.moveTarget.clone().sub(this.group.position);
      to.y = 0;
      if (to.length() < 0.6) { this.moveTarget = null; }
      else desired = to.normalize();
    } else if (desired.lengthSq() > 0.001) {
      this.moveTarget = null; // keys cancel click-to-move
      desired.normalize();
    }

    const target = desired.multiplyScalar(this.speed);
    // Smooth accel/decel.
    this.velocity.x += (target.x - this.velocity.x) * Math.min(1, dt * 10);
    this.velocity.z += (target.z - this.velocity.z) * Math.min(1, dt * 10);

    const moving = this.velocity.length() > 0.4;

    // Propose new position, then resolve collisions by pushing out of circles.
    const pos = this.group.position;
    let nx = pos.x + this.velocity.x * dt;
    let nz = pos.z + this.velocity.z * dt;
    for (const o of obstacles) {
      const dx = nx - o.x, dz = nz - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + this.radius;
      if (d < min && d > 0.0001) {
        const push = (min - d);
        nx += (dx / d) * push;
        nz += (dz / d) * push;
      }
    }
    pos.x = nx; pos.z = nz;
    if (clampFn) clampFn(pos);

    // Face travel direction.
    if (moving) {
      const want = Math.atan2(this.velocity.x, this.velocity.z);
      let delta = want - this.heading;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.heading += delta * Math.min(1, dt * 12);
      this.group.rotation.y = this.heading;
    }

    // Walk cycle: bob + limb swing; settle to neutral when idle.
    const sp = this.velocity.length();
    if (moving) this.walkPhase += dt * (6 + sp * 0.7);
    const swing = moving ? Math.sin(this.walkPhase) * 0.6 : 0;
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.12 : 0;
    this.rig.position.y = bob;
    this.armL.rotation.x = swing;
    this.armR.rotation.x = -swing;
    this.legL.rotation.x = -swing;
    this.legR.rotation.x = swing;
    // gentle lean into motion
    this.rig.rotation.x += ((moving ? 0.06 : 0) - this.rig.rotation.x) * Math.min(1, dt * 8);

    return moving;
  }
}
