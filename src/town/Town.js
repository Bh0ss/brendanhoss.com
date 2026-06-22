import * as THREE from 'three';
import { SKY } from './palette.js';
import { buildWorld } from './world.js';
import { createWater } from './water.js';
import { createAtmosphere } from './atmosphere.js';
import { createComposer } from './post.js';
import { Player } from './player.js';
import { Input } from './input.js';

// Third-person town. Owns renderer/scene/camera + the post stack, drives the
// player from input, and runs a smoothed follow-cam you can orbit and zoom.

export class Town {
  constructor(canvas, { mobile = false, reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.mobile = mobile;
    this.reducedMotion = reducedMotion;
    this.running = false;
    this.time = 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1200);
    this.camYaw = Math.PI;
    this.camPitch = 0.46;
    this.camDist = mobile ? 27 : 23;

    this.sunDir = new THREE.Vector3(-40, 60, 30).normalize();
    this._lights();

    this.world = buildWorld(this.scene);

    this.water = createWater({ waterline: this.world.shoreZ + 5, sunDir: this.sunDir });
    this.scene.add(this.water.mesh);

    this.atmosphere = createAtmosphere(this.scene);

    this.player = new Player();
    this.player.position.set(0, 0, 20);
    this.scene.add(this.player.group);
    this._addBlobShadow();

    this.input = new Input(canvas);
    this.input.onTap((nx, ny) => this._handleTap(nx, ny));

    this.raycaster = new THREE.Raycaster();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._camTarget = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();

    this.resize();
    addEventListener('resize', () => this.resize());
    this._updateCamera(1, true);

    // Post stack — degrade gracefully to direct rendering if it fails.
    try {
      this.post = createComposer(this.renderer, this.scene, this.camera, { mobile });
    } catch (err) {
      console.warn('Post-processing unavailable, rendering directly:', err);
      this.post = null;
    }
  }

  _lights() {
    const hemi = new THREE.HemisphereLight(SKY.top, 0x6a7a55, 0.7);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d6, 1.7);
    sun.position.copy(this.sunDir).multiplyScalar(80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 95;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.16));
  }

  _addBlobShadow() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0.38)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.renderOrder = 2;
    this.blob = blob;
    this.scene.add(blob);
  }

  _handleTap(nx, ny) {
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this._groundPlane, hit)) this.player.moveTarget = hit;
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
    this.post?.resize(w, h);
  }

  _cameraBasis() {
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    return { fx, fz, rx: -fz, rz: fx };
  }

  _updateCamera(dt, snap = false) {
    const cd = this.input.takeCameraDelta();
    this.camYaw += cd.yaw;
    this.camPitch = Math.max(0.14, Math.min(0.95, this.camPitch + cd.pitch));
    this.camDist = Math.max(11, Math.min(42, this.camDist + cd.zoom * 1.5));

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
    this.time += dt;
    const t = this.time;

    const a = this.input.moveAxis();
    let worldDir = { x: 0, z: 0 };
    if (a.x || a.z) {
      const { fx, fz, rx, rz } = this._cameraBasis();
      worldDir.x = fx * -a.z + rx * a.x;
      worldDir.z = fz * -a.z + rz * a.x;
    }
    this.player.update(dt, worldDir, this.world.obstacles, this.world.clampFn);
    this._updateCamera(dt);

    // ground the character
    const pp = this.player.position;
    this.blob.position.set(pp.x, 0.03, pp.z);

    this.water.update(t);
    this.atmosphere.update(dt, t);

    // wind sway on tree crowns
    for (const tr of this.world.trees) {
      const c = tr.userData.crown; if (!c) continue;
      const ph = tr.userData.phase;
      c.rotation.z = Math.sin(t * 1.2 + ph) * 0.045;
      c.rotation.x = Math.cos(t * 0.9 + ph) * 0.03;
    }
    // boat bob
    for (const b of this.world.boats) {
      const ph = b.userData.phase;
      b.position.y = Math.sin(t * 1.3 + ph) * 0.18;
      b.rotation.z = Math.sin(t * 0.8 + ph) * 0.05;
    }
  }

  _loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this.update(dt);
    if (this.post) this.post.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
