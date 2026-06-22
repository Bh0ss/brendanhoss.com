import * as THREE from 'three';
import { SKY } from './palette.js';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { Input } from './input.js';

// Third-person town. Owns the renderer/scene/camera, drives the player from
// input, and runs a smoothed follow-cam you can orbit (drag) and zoom (wheel).

export class Town {
  constructor(canvas, { mobile = false, reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.mobile = mobile;
    this.reducedMotion = reducedMotion;
    this.running = false;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 1000);
    // follow-cam state
    this.camYaw = Math.PI;       // looking south initially
    this.camPitch = 0.42;        // radians above horizon
    this.camDist = mobile ? 26 : 22;

    this._lights();
    this.world = buildWorld(this.scene);

    this.player = new Player();
    this.player.position.set(0, 0, 18); // start just south of the green, facing it
    this.scene.add(this.player.group);

    this.input = new Input(canvas);
    this.input.onTap((nx, ny) => this._handleTap(nx, ny));

    this.raycaster = new THREE.Raycaster();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._tmp = new THREE.Vector3();
    this._camTarget = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();

    this.resize();
    addEventListener('resize', () => this.resize());
    // place camera immediately so first frame isn't from the origin
    this._updateCamera(1, true);
  }

  _lights() {
    const hemi = new THREE.HemisphereLight(SKY.top, 0x6a7a55, 0.85);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d6, 1.5);
    sun.position.set(-40, 60, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 90;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.18));
  }

  _handleTap(nx, ny) {
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this._groundPlane, hit)) {
      this.player.moveTarget = hit;
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _cameraBasis() {
    // Horizontal forward/right derived from yaw (used for movement + placement).
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    return { fx, fz, rx: fz, rz: -fx };
  }

  _updateCamera(dt, snap = false) {
    const cd = this.input.takeCameraDelta();
    this.camYaw += cd.yaw;
    this.camPitch = Math.max(0.12, Math.min(0.95, this.camPitch + cd.pitch));
    this.camDist = Math.max(10, Math.min(40, this.camDist + cd.zoom * 1.5));

    const p = this.player.position;
    const horiz = Math.cos(this.camPitch) * this.camDist;
    const vert = Math.sin(this.camPitch) * this.camDist;
    this._camTarget.set(
      p.x - Math.sin(this.camYaw) * horiz,
      p.y + vert + 2,
      p.z - Math.cos(this.camYaw) * horiz
    );
    const k = snap ? 1 : Math.min(1, dt * 6);
    this.camera.position.lerp(this._camTarget, k);
    this._lookTarget.set(p.x, p.y + 2.4, p.z);
    this.camera.lookAt(this._lookTarget);
  }

  update(dt) {
    // Movement axis → world direction relative to camera yaw.
    const a = this.input.moveAxis();
    let worldDir = { x: 0, z: 0 };
    if (a.x || a.z) {
      const { fx, fz, rx, rz } = this._cameraBasis();
      worldDir.x = fx * -a.z + rx * a.x;
      worldDir.z = fz * -a.z + rz * a.x;
    }
    this.player.update(dt, worldDir, this.world.obstacles, this.world.clampFn);
    this._updateCamera(dt);

    // gentle water shimmer
    if (this.world.water) this.world.water.material.opacity = 0.9 + Math.sin(performance.now() * 0.001) * 0.04;
  }

  _loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
