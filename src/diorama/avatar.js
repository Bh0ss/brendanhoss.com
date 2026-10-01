import * as THREE from 'three';
import { normalizeMaterial } from './materials.js';

// The UBC avatar, dropped into the existing Player: Player keeps doing movement, collision,
// click-to-move, heading and walkPhase (its public interface is untouched); its code-built rig
// is hidden and this skinned model rides player.group instead. Idle / walk / jog blend by speed.
//
// Clip ground speeds (site units / s, at 1.75 units per metre): walk ~1.35 m/s, jog ~3.3 m/s.
const WALK_SPEED = 1.35 * 1.75;
const JOG_SPEED = 3.3 * 1.75;

export function attachAvatar(player, gltf, { envIntensity = 1, lite = false } = {}) {
  const model = gltf.scene;
  model.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = !lite; o.receiveShadow = true;
      o.frustumCulled = false;
      normalizeMaterial(o.material, { envIntensity, tint: 0.03, minRough: 0.4 });
      if (lite && o.material.normalMap) { o.material.normalMap = null; o.material.needsUpdate = true; }
    }
  });
  player.rig.visible = false;
  player.group.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const clip = (n) => gltf.animations.find((a) => a.name === n || a.name.startsWith(n));
  const idle = mixer.clipAction(clip('Idle_Loop'));
  const walk = mixer.clipAction(clip('Walk_Loop'));
  const jog = mixer.clipAction(clip('Jog_Fwd_Loop'));
  for (const a of [idle, walk, jog]) { a.play(); a.setEffectiveWeight(0); }
  idle.setEffectiveWeight(1);
  // walk and jog share a phase so the blend between them doesn't scissor the legs
  jog.syncWith(walk);

  let wIdle = 1, wWalk = 0, wJog = 0;
  function update(dt) {
    const v = Math.hypot(player.velocity.x, player.velocity.z);
    const moving = v > 0.4;
    const tJog = moving ? THREE.MathUtils.smoothstep(v, WALK_SPEED * 1.4, JOG_SPEED * 1.2) : 0;
    const tWalk = moving ? 1 - tJog : 0;
    const tIdle = moving ? 0 : 1;
    const k = Math.min(1, dt * 8);
    wIdle += (tIdle - wIdle) * k; wWalk += (tWalk - wWalk) * k; wJog += (tJog - wJog) * k;
    idle.setEffectiveWeight(wIdle); walk.setEffectiveWeight(wWalk); jog.setEffectiveWeight(wJog);
    // match foot speed to ground speed
    walk.setEffectiveTimeScale(THREE.MathUtils.clamp(moving ? v / WALK_SPEED : 1, 0.6, 2.2));
    jog.setEffectiveTimeScale(THREE.MathUtils.clamp(moving ? v / JOG_SPEED : 1, 0.6, 1.9));
    mixer.update(dt);
  }
  return { model, mixer, update };
}
