import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PHASES, PALETTE, buildCameraPath, hexToRgbNorm } from '../data.js';

// A soft radial sprite so every point reads as a glowing orb (and blooms nicely).
function makeGlowTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const POINT_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aOpacity;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vOpacity;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vOpacity = aOpacity;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FRAG = /* glsl */ `
  uniform sampler2D uTex;
  varying vec3 vColor;
  varying float vOpacity;
  void main() {
    vec4 t = texture2D(uTex, gl_PointCoord);
    gl_FragColor = vec4(vColor, 1.0) * t.a * vOpacity;
  }
`;

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

export class CareerNetwork {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.mobile = opts.mobile || false;
    this.reducedMotion = opts.reducedMotion || false;
    this.scroll = 0;
    this.time = 0;
    this.mouse = new THREE.Vector2(0, 0);
    this.mouseTarget = new THREE.Vector2(0, 0);
    this._tmpEye = new THREE.Vector3();
    this._tmpLook = new THREE.Vector3();

    this._initRenderer();
    this._initScene();
    this._buildNodes();
    this._buildEdges();
    this._buildPulses();
    this._initPost();
    this._bindEvents();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: !this.mobile,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.dpr = Math.min(window.devicePixelRatio || 1, this.mobile ? 2 : 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(PALETTE.bg, 1);
  }

  // Point size in framebuffer px = aSize * uScale / dist. uScale maps a
  // world-space size to pixels at unit distance for the current viewport.
  _pointScale() {
    return (window.innerHeight * this.dpr) / (2 * Math.tan((this.fov * Math.PI / 180) / 2));
  }

  _initScene() {
    this.fov = 60;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(PALETTE.bg, 0.0042);
    this.camera = new THREE.PerspectiveCamera(this.fov, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 1, 42);

    const path = buildCameraPath();
    this.eyeCurve = new THREE.CatmullRomCurve3(path.eye.map((p) => new THREE.Vector3(...p)));
    this.lookCurve = new THREE.CatmullRomCurve3(path.look.map((p) => new THREE.Vector3(...p)));
    this.glowTex = makeGlowTexture();
  }

  // ── Nodes: one Points cloud for the whole constellation ─────────────────
  _buildNodes() {
    const qty = this.mobile ? 0.55 : 1;
    const nodes = [];
    PHASES.forEach((phase, pi) => {
      const groups = [{ center: phase.center, color: phase.color, count: phase.count, radius: phase.radius }];
      if (phase.satellites) {
        for (const s of phase.satellites) {
          groups.push({
            center: [phase.center[0] + s.offset[0], phase.center[1] + s.offset[1], phase.center[2] + s.offset[2]],
            color: s.color,
            count: Math.round(7 * qty),
            radius: 5,
          });
        }
      }
      for (const g of groups) {
        const n = Math.max(4, Math.round(g.count * qty));
        for (let i = 0; i < n; i++) {
          // Distribute in a soft 3D blob around the cluster center.
          const r = g.radius * Math.cbrt(Math.random());
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          const x = g.center[0] + r * Math.sin(phi) * Math.cos(theta);
          const y = g.center[1] + r * Math.sin(phi) * Math.sin(theta);
          const z = g.center[2] + r * Math.cos(phi);
          nodes.push({
            phase: pi,
            home: new THREE.Vector3(x, y, z),
            color: g.color,
            size: phase.hub && g === groups[0] && i === 0 ? 4.6 : 0.5 + Math.random() * 1.0,
            birth: phase.scroll[0] - 0.04,
            drift: {
              ax: Math.random() * Math.PI * 2,
              ay: Math.random() * Math.PI * 2,
              sx: 0.2 + Math.random() * 0.4,
              sy: 0.2 + Math.random() * 0.4,
              amp: 0.5 + Math.random() * 1.4,
            },
          });
        }
      }
    });

    this.nodes = nodes;
    const count = nodes.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const opacities = new Float32Array(count);

    nodes.forEach((nd, i) => {
      positions[i * 3] = nd.home.x;
      positions[i * 3 + 1] = nd.home.y;
      positions[i * 3 + 2] = nd.home.z;
      const [r, g, b] = hexToRgbNorm(nd.color);
      colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
      sizes[i] = nd.size;
      opacities[i] = 0;
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1));

    this.nodeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: this.glowTex },
        uScale: { value: this._pointScale() },
      },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    this.nodeGeo = geo;
    this.nodePoints = new THREE.Points(geo, this.nodeMat);
    this.nodePoints.frustumCulled = false;
    this.scene.add(this.nodePoints);
  }

  // ── Edges: connect nearby nodes + bridge consecutive clusters ───────────
  _buildEdges() {
    const edges = [];
    const maxDist = this.mobile ? 14 : 16;
    // Intra-cluster links (only test within the same phase to stay cheap).
    const byPhase = {};
    this.nodes.forEach((n, i) => { (byPhase[n.phase] = byPhase[n.phase] || []).push(i); });
    for (const key in byPhase) {
      const idxs = byPhase[key];
      for (let a = 0; a < idxs.length; a++) {
        for (let b = a + 1; b < idxs.length; b++) {
          if (this.nodes[idxs[a]].home.distanceTo(this.nodes[idxs[b]].home) < maxDist) {
            edges.push([idxs[a], idxs[b]]);
          }
        }
      }
    }
    // Bridges between consecutive phases (a couple of dim links to show the
    // throughline without dominating the frame). Flagged so they render faint.
    for (let p = 0; p < PHASES.length - 1; p++) {
      const here = byPhase[p] || [];
      const next = byPhase[p + 1] || [];
      const links = Math.min(2, here.length, next.length);
      for (let k = 0; k < links; k++) {
        edges.push([here[(k * 7) % here.length], next[(k * 5) % next.length], true]);
      }
    }

    this.edges = edges;
    const positions = new Float32Array(edges.length * 6);
    const colors = new Float32Array(edges.length * 6);
    this.edgeGeo = new THREE.BufferGeometry();
    this.edgeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.edgeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.edgeMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.edgeLines = new THREE.LineSegments(this.edgeGeo, this.edgeMat);
    this.edgeLines.frustumCulled = false;
    this.scene.add(this.edgeLines);
  }

  // ── Signal pulses traveling along edges ─────────────────────────────────
  _buildPulses() {
    this.pulseCount = this.reducedMotion ? 0 : (this.mobile ? 26 : 60);
    const positions = new Float32Array(Math.max(1, this.pulseCount) * 3);
    const colors = new Float32Array(Math.max(1, this.pulseCount) * 3);
    const sizes = new Float32Array(Math.max(1, this.pulseCount));
    const opacities = new Float32Array(Math.max(1, this.pulseCount));
    this.pulses = [];
    for (let i = 0; i < this.pulseCount; i++) {
      this.pulses.push(this._spawnPulse());
      sizes[i] = 0.7;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1));
    this.pulseGeo = geo;
    this.pulseMat = this.nodeMat.clone();
    this.pulsePoints = new THREE.Points(geo, this.pulseMat);
    this.pulsePoints.frustumCulled = false;
    if (this.pulseCount > 0) this.scene.add(this.pulsePoints);
  }

  _spawnPulse() {
    const e = this.edges[Math.floor(Math.random() * this.edges.length)] || [0, 0];
    return { edge: e, t: Math.random(), speed: 0.15 + Math.random() * 0.5 };
  }

  _initPost() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      this.mobile ? 0.55 : 0.75, // strength
      0.55,                       // radius
      0.22                        // threshold — only bright cores bloom
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  _bindEvents() {
    this._onResize = this.resize.bind(this);
    window.addEventListener('resize', this._onResize);
    if (!this.mobile) {
      window.addEventListener('pointermove', (e) => {
        this.mouseTarget.set(
          (e.clientX / window.innerWidth) * 2 - 1,
          (e.clientY / window.innerHeight) * 2 - 1
        );
      });
    }
  }

  setScroll(s) { this.scroll = clamp01(s); }

  update(dt) {
    this.time += dt;
    const t = this.scroll;

    // ── Camera: fly the curve, with smoothed mouse parallax ──────────────
    this.eyeCurve.getPoint(t, this._tmpEye);
    this.lookCurve.getPoint(t, this._tmpLook);
    this.mouse.lerp(this.mouseTarget, 0.05);
    const par = this.reducedMotion ? 0 : 1;
    this.camera.position.set(
      this._tmpEye.x + this.mouse.x * 6 * par,
      this._tmpEye.y - this.mouse.y * 4 * par,
      this._tmpEye.z
    );
    this.camera.lookAt(
      this._tmpLook.x + this.mouse.x * 2 * par,
      this._tmpLook.y - this.mouse.y * 1.5 * par,
      this._tmpLook.z
    );

    // ── Node birth + drift ───────────────────────────────────────────────
    const pos = this.nodeGeo.attributes.position.array;
    const op = this.nodeGeo.attributes.aOpacity.array;
    const driftOn = this.reducedMotion ? 0 : 1;
    for (let i = 0; i < this.nodes.length; i++) {
      const nd = this.nodes[i];
      op[i] = clamp01((t - nd.birth) / 0.05);
      const d = nd.drift;
      const dx = Math.cos(d.ax + this.time * d.sx) * d.amp * driftOn;
      const dy = Math.sin(d.ay + this.time * d.sy) * d.amp * driftOn;
      pos[i * 3] = nd.home.x + dx;
      pos[i * 3 + 1] = nd.home.y + dy;
      pos[i * 3 + 2] = nd.home.z;
    }
    this.nodeGeo.attributes.position.needsUpdate = true;
    this.nodeGeo.attributes.aOpacity.needsUpdate = true;

    // ── Edges follow their endpoints; brightness tracks node births ──────
    const ep = this.edgeGeo.attributes.position.array;
    const ec = this.edgeGeo.attributes.color.array;
    for (let i = 0; i < this.edges.length; i++) {
      const [a, b, isBridge] = this.edges[i];
      const oa = op[a], ob = op[b];
      const bright = Math.min(oa, ob);
      ep[i * 6] = pos[a * 3];     ep[i * 6 + 1] = pos[a * 3 + 1]; ep[i * 6 + 2] = pos[a * 3 + 2];
      ep[i * 6 + 3] = pos[b * 3]; ep[i * 6 + 4] = pos[b * 3 + 1]; ep[i * 6 + 5] = pos[b * 3 + 2];
      const ca = this.nodes[a].color;
      const [r, g, bl] = hexToRgbNorm(ca);
      const k = bright * (isBridge ? 0.16 : 0.55);
      ec[i * 6] = r * k; ec[i * 6 + 1] = g * k; ec[i * 6 + 2] = bl * k;
      ec[i * 6 + 3] = r * k; ec[i * 6 + 4] = g * k; ec[i * 6 + 5] = bl * k;
    }
    this.edgeGeo.attributes.position.needsUpdate = true;
    this.edgeGeo.attributes.color.needsUpdate = true;

    // ── Pulses ───────────────────────────────────────────────────────────
    if (this.pulseCount > 0) {
      const pp = this.pulseGeo.attributes.position.array;
      const pc = this.pulseGeo.attributes.aColor.array;
      const popp = this.pulseGeo.attributes.aOpacity.array;
      for (let i = 0; i < this.pulses.length; i++) {
        const pu = this.pulses[i];
        pu.t += pu.speed * dt;
        if (pu.t >= 1) { this.pulses[i] = this._spawnPulse(); continue; }
        const [a, b] = pu.edge;
        const av = clamp01((t - this.nodes[a].birth) / 0.05);
        const bv = clamp01((t - this.nodes[b].birth) / 0.05);
        const vis = Math.min(av, bv);
        pp[i * 3] = lerp(pos[a * 3], pos[b * 3], pu.t);
        pp[i * 3 + 1] = lerp(pos[a * 3 + 1], pos[b * 3 + 1], pu.t);
        pp[i * 3 + 2] = lerp(pos[a * 3 + 2], pos[b * 3 + 2], pu.t);
        const [r, g, bl] = hexToRgbNorm(this.nodes[b].color);
        pc[i * 3] = r; pc[i * 3 + 1] = g; pc[i * 3 + 2] = bl;
        popp[i] = Math.sin(pu.t * Math.PI) * vis;
      }
      this.pulseGeo.attributes.position.needsUpdate = true;
      this.pulseGeo.attributes.aColor.needsUpdate = true;
      this.pulseGeo.attributes.aOpacity.needsUpdate = true;
    }

    this.composer.render();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.nodeMat.uniforms.uScale.value = this._pointScale();
    this.pulseMat.uniforms.uScale.value = this._pointScale();
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}
