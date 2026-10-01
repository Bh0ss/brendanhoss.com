import * as THREE from 'three';
import { LIGHT, SUN_DIR } from './palette.js';
import { buildWorld } from './world.js';
import { buildLandmarks } from './landmarks.js';
import { createWater } from './water.js';
import { createAtmosphere } from './atmosphere.js';
import { createComposer } from './post.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';
import { byId } from '../data.js';
import { track } from '../analytics.js';
import { RESUME_EVENT, isResumeOpen } from '../resume-view.js';
import { DIORAMA, bootDiorama, reloadAfterContextRestore } from '../diorama/flag.js';

// Follow-camera defaults per look. The diorama's buildings are taller and more detailed than the
// classic toy town: a lower pitch shows whole rooflines (and more horizon), a longer zoom range
// lets a guided hop frame the tallest facades.
const CAMERA = {
  classic: { pitch: 0.60, dist: 24, distMobile: 27, min: 11, max: 42 },
  diorama: { pitch: 0.48, dist: 25, distMobile: 29, min: 12, max: 48 },
};

// Third-person town. Owns renderer/scene/camera + the post stack, drives the
// player from input, and runs a smoothed follow-cam you can orbit and zoom.

export class Town {
  constructor(canvas, { mobile = false, reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.mobile = mobile;
    this.reducedMotion = reducedMotion;
    this.running = false;
    this.time = 0;
    // Render holds: while any reason is held (the résumé view or a content card
    // covers the scene) the loop parks after drawing the current frame, and
    // restarts when the last hold is released. See hold() / _loop().
    this._holds = new Set();
    this._parked = false;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });

    // Quality tier. `mobile` already routes phones down a lighter pipeline; the
    // same lighter pipeline is exactly what a weak integrated-GPU desktop needs.
    // Detect low-end GPUs at startup and route them down that same path.
    //
    // Fail-safe: only downgrade on a POSITIVE low-end match. If the renderer
    // string is empty/redacted (some Firefox configs), keep full quality — we'd
    // rather a capable unknown GPU get full quality than penalize it.
    //
    // QA override: ?perf=low forces the lite tier on, ?perf=high forces it off,
    // overriding detection. No param = auto-detection.
    let lowEndGPU = false;
    try {
      const gl = this.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const rs = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      lowEndGPU = /intel(?!.*arc)|uhd|iris|hd graphics|mali|adreno|llvmpipe|swiftshader|microsoft basic/i.test(rs);
    } catch (e) { lowEndGPU = false; }

    let lite = mobile || lowEndGPU;
    const perfParam = new URLSearchParams(location.search).get('perf');
    if (perfParam === 'low') lite = true;
    else if (perfParam === 'high') lite = false;
    this.lite = lite;

    this.renderer.setPixelRatio(Math.min(devicePixelRatio, lite ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral (Khronos PBR Neutral) keeps the authored pastel palette's hues —
    // ACES skewed the warm golden-hour tones toward orange and desaturated them.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1200);
    this.camYaw = Math.PI;
    this._lookDefaults('classic');

    this.sunDir = SUN_DIR.clone();   // golden-hour sun, shared with sky + water
    this._lights();

    this.world = buildWorld(this.scene);

    this.water = createWater({ waterline: this.world.shoreZ + 5, sunDir: this.sunDir });
    this.scene.add(this.water.mesh);

    this.atmosphere = createAtmosphere(this.scene);

    // Career landmarks (buildings + signs + beacons); merge their footprints
    // into the collision set so the player can't walk through them.
    this.landmarks = buildLandmarks(this.scene, this.world.path);
    for (const it of this.landmarks.interactables) {
      if (it.collide > 0) this.world.obstacles.push({ x: it.x, z: it.z, r: it.collide });
    }
    this.audio = createAudio();
    this.ui = createUI(this.audio);

    // Fast-path handoff (resume-view.js contract): the reading view covers the
    // canvas, so stop rendering and pause the music bed while it's open. A
    // /resume landing opens it before Town exists — adopt that initial state.
    const onResume = (open) => { this.hold('resume', open); this.audio.setDucked(open); };
    document.addEventListener(RESUME_EVENT, (e) => onResume(!!e.detail?.open));
    if (isResumeOpen()) onResume(true);
    // A content card dims + blurs the scene behind it: park the loop there too.
    this.ui.onVisibility = (shown) => this.hold('card', shown);
    this.nearest = null;
    this._lastStep = 0;
    this.motion = reducedMotion ? 0.4 : 1;   // the diorama lowers this further (_lookDefaults)
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyE' && this.nearest && !this.ui.isOpen()) this.ui.openCard(this.nearest.data);
    });

    // Start audio on the first user gesture (autoplay policy).
    const startAudio = () => { this.audio.start(); removeEventListener('pointerdown', startAudio); removeEventListener('keydown', startAudio); };
    addEventListener('pointerdown', startAudio);
    addEventListener('keydown', startAudio);

    const muteBtn = document.getElementById('mute');
    if (muteBtn) muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.start();
      const muted = this.audio.toggle();
      muteBtn.classList.toggle('muted', muted);
      track('audio_toggle', { state: muted ? 'off' : 'on' });
    });

    // Prev/next building hop
    this._navIndex = 0;
    const navPrev = document.getElementById('nav-prev');
    const navNext = document.getElementById('nav-next');
    if (navPrev) navPrev.addEventListener('click', (e) => { e.stopPropagation(); this.audio.start(); track('nav_arrow', { direction: 'prev' }); this.gotoLandmark(-1); });
    if (navNext) navNext.addEventListener('click', (e) => { e.stopPropagation(); this.audio.start(); track('nav_arrow', { direction: 'next' }); this.gotoLandmark(1); });

    this.player = new Player();
    // Spawn between the trailhead and the gazebo — at the intro's approach point
    // ([0,6]), which is inside the gazebo's interact radius (7.5), so the welcome
    // prompt is right there: the player can click/press E on the gazebo to reopen
    // the intro card whenever they like. Facing down the trail toward the first
    // building so a single step forward starts the walk.
    const intro = this.landmarks.interactables.find((i) => i.id === 'intro');
    const sp = intro ? intro.approach : this.world.path.startPos();
    this.player.position.set(sp.x, 0, sp.z);
    const sd = this.world.path.startDir();
    this.player.heading = Math.atan2(sd.x, sd.z);
    this.player.group.rotation.y = this.player.heading;
    // camera behind the player, looking down the trail at spawn
    this.camYaw = this.player.heading;
    this.scene.add(this.player.group);
    this._addBlobShadow();

    this.input = new Input(canvas);
    this.input.onTap((nx, ny) => this._handleTap(nx, ny));

    this.raycaster = new THREE.Raycaster();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._camTarget = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    // Follow-camera collision (diorama): oriented building boxes pushed by town-build.js. Trees are
    // never in it (the diorama dissolves them instead). Empty in the classic town: no collision.
    this.camColliders = [];
    this._collD = 0;                   // current (eased) collision-limited camera distance
    this._collHeld = false;            // true while a building holds the camera in

    this.resize();
    addEventListener('resize', () => this.resize());
    this._updateCamera(1, true);

    // Pause cleanly on GPU context loss; resume when restored (avoids a
    // permanent black screen on a laptop GPU reset / mobile backgrounding).
    // The diorama can't resume in place: three rebuilds its own state, but not the diorama's derived
    // GPU data (PMREM environment, treeline atlas, terrain data textures). It reloads once instead
    // (flag.js bounds it: a second loss in the session goes classic, never a loop).
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.running = false; });
    canvas.addEventListener('webglcontextrestored', () => {
      if (this.look === 'diorama' && reloadAfterContextRestore()) return;
      if (this._loop && !this.running) { this.running = true; this._parked = false; this._last = performance.now(); requestAnimationFrame(this._loop); }
    });

    // Post stack — degrade gracefully to direct rendering if it fails.
    try {
      this.post = createComposer(this.renderer, this.scene, this.camera, { lite: this.lite });
    } catch (err) {
      console.warn('Post-processing unavailable, rendering directly:', err);
      this.post = null;
    }

    // The diorama (the default look) attaches to this town; null = classic (?look=classic, a
    // GPU that can't run it, or an earlier fallback this session). A load failure hands the
    // classic town back through onFallback.
    this.diorama = DIORAMA ? bootDiorama(this, { onFallback: () => { this.diorama = null; this.camColliders.length = 0; this._lookDefaults('classic'); this._updateCamera(1, true); } }) : null;
    this.look = this.diorama ? 'diorama' : 'classic';
    if (this.diorama) { this._lookDefaults('diorama'); this._updateCamera(1, true); }
  }

  // Camera + motion defaults for a look. Reduced motion: the classic town slows to 0.4x; the
  // diorama's wind, water and swell near-stop (0.05x), and the follow camera cuts instead of
  // gliding (see _updateCamera).
  _lookDefaults(look) {
    const c = CAMERA[look];
    this.look = look;
    this.camPitchDefault = c.pitch;
    this.camDistDefault = this.mobile ? c.distMobile : c.dist;
    this.camPitch = c.pitch;
    this.camDist = this.camDistDefault;
    this._camRange = [c.min, c.max];
    this.motion = this.reducedMotion ? (look === 'diorama' ? 0.05 : 0.4) : 1;
  }

  _lights() {
    // Golden hour: warm low key sun, cool sky fill, warm grass bounce. No
    // ambient — the hemisphere is the only fill, so shadows stay cool and read.
    const hemi = new THREE.HemisphereLight(LIGHT.hemiSky, LIGHT.hemiGround, 1.45);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(LIGHT.sun, 1.8);
    sun.position.copy(this.sunDir).multiplyScalar(80);
    sun.castShadow = true;
    sun.shadow.radius = 1.5;                 // tight penumbra (soft radius caused peter-panning)
    sun.shadow.mapSize.set(this.lite ? 1024 : 2048, this.lite ? 1024 : 2048);
    const s = 72;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;            // low sun → a touch more normal bias vs acne
    this.scene.add(sun);
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
    if (this.raycaster.ray.intersectPlane(this._groundPlane, hit)) { this.player.moveTarget = hit; this.player._stuck = 0; }
  }

  // Hop the player to the prev/next landmark's approach point and open its card.
  gotoLandmark(delta) {
    const list = this.landmarks.interactables;
    if (!list.length) return;
    this._navIndex = ((this._navIndex + delta) % list.length + list.length) % list.length;
    const it = list[this._navIndex];
    const p = this.player;
    p.position.set(it.approach.x, 0, it.approach.z);
    p.moveTarget = null; p._stuck = 0; p.velocity.set(0, 0, 0);
    const heading = Math.atan2(it.x - it.approach.x, it.z - it.approach.z);
    p.heading = heading; p.group.rotation.y = heading;
    this.camYaw = heading;
    // a guided hop frames the building: default pitch, and the landmark's own framing distance
    // when it has one (diorama buildings; town-build.js viewDistFor)
    // (and, for a hero tower or stack, a small yaw off the facade axis and a lower pitch: town-build.js heroView)
    if (it.viewDist) { this.camPitch = it.viewPitch ?? this.camPitchDefault; this.camDist = it.viewDist; this.camYaw = heading + (it.viewYaw || 0); this._lift = it.viewLift || 0; this._liftHold = true; }
    this._updateCamera(1, true);
    // A hop may replace an open card with the welcome card (the › wrap from the last landmark round
    // to the green); the welcome card's auto-open timer may not (ui.openCard). Focus stays on the arrow.
    this.ui.openCard(it.data, { hop: true });
    this._kick();   // card→card hop while parked: draw the new spot once
  }

  // Hold/release rendering for a named reason ('resume' | 'card').
  hold(reason, on) {
    if (on) this._holds.add(reason); else this._holds.delete(reason);
    if (!this._holds.size) this._kick();
  }

  // Wake a parked loop. With holds still active it draws one frame and parks
  // again; with none it resumes normally. dt restarts from now (no jump).
  _kick() {
    if (!this._parked || !this.running) return;
    this._parked = false;
    this._last = performance.now();
    requestAnimationFrame(this._loop);
  }

  // Public hook for deep links (/yale etc., wired in main.js): hop to a landmark
  // by id and open its card, reusing the prev/next teleport above.
  goToLandmarkById(id) {
    const i = this.landmarks.interactables.findIndex((it) => it.id === id);
    if (i < 0) return false;
    this._navIndex = i;
    this.gotoLandmark(0);
    return true;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    // Welcome card auto-opens once per session (sessionStorage): shown on a fresh
    // landing, but not re-shown on every in-session refresh. Returning visitors in
    // a new tab/session see it again. They can also reopen it anytime by clicking
    // the gazebo (the intro prompt is in range at spawn).
    let seen = false;
    try { seen = sessionStorage.getItem('bh_seen_intro') === '1'; } catch (_) { /* private mode */ }
    // Only mark it seen if it actually opened: openCard() declines the intro
    // over a deep-linked card or the résumé view, and that visitor should
    // still get the welcome on their next plain landing this session.
    if (!seen) {
      setTimeout(() => {
        this.ui.openCard(byId.intro);
        if (this.ui.current === byId.intro) {
          try { sessionStorage.setItem('bh_seen_intro', '1'); } catch (_) { /* ignore */ }
        }
      }, 650);
    }
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post?.resize(w, h);
    this._kick();   // parked behind a card: redraw at the new size
  }

  _cameraBasis() {
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    return { fx, fz, rx: -fz, rz: fx };
  }

  _updateCamera(dt, snap = false) {
    const cd = this.input.takeCameraDelta();
    this.camYaw += cd.yaw;
    this.camPitch = Math.max(0.14, Math.min(0.95, this.camPitch + cd.pitch));
    this.camDist = Math.max(this._camRange[0], Math.min(this._camRange[1], this.camDist + cd.zoom * 1.5));

    const p = this.player.position;
    const horiz = Math.cos(this.camPitch) * this.camDist;
    const vert = Math.sin(this.camPitch) * this.camDist;
    this._camTarget.set(
      p.x - Math.sin(this.camYaw) * horiz,
      p.y + vert + 2,
      p.z - Math.cos(this.camYaw) * horiz
    );
    const k = snap || this.reducedMotion ? 1 : Math.min(1, dt * 6);   // reduced motion: cuts, no glide
    this.camera.position.lerp(this._camTarget, k);
    if (this.camColliders.length) this._collideCamera(dt, snap || this.reducedMotion);
    // Look lift: a guided hop tilts the view up so the whole building reads (gotoLandmark). The
    // first step, tap-to-walk, drag or zoom lets it settle back onto the visitor.
    if (this._lift) {
      const v = this.player.velocity;
      if (cd.yaw || cd.pitch || cd.zoom || this.player.moveTarget || v.x * v.x + v.z * v.z > 0.05) this._liftHold = false;
      if (!this._liftHold) this._lift = this.reducedMotion || this._lift < 0.02 ? 0 : this._lift * (1 - Math.min(1, dt * 2.5));
    }
    this._lookTarget.set(p.x, p.y + 2.4 + (this._lift || 0), p.z);
    this.camera.lookAt(this._lookTarget);
  }

  // Keep the follow camera out of buildings: cast from the visitor's head toward the camera against
  // the collider boxes and hold the camera short of the first hit. Two casts: toward where the follow
  // cam wants to be (sets the held distance, which eases in to a margin short of the wall, so an
  // approaching wall pulls the camera in smoothly, and eases back out when the way clears), and toward
  // where the camera actually is (a hard limit that only bites on a sudden block, e.g. a quick orbit).
  _collideCamera(dt, cut) {
    const p = this.player.position, cam = this.camera.position, tgt = this._camTarget;
    const ox = p.x, oy = p.y + 2.4, oz = p.z;
    const dx = cam.x - ox, dy = cam.y - oy, dz = cam.z - oz;
    const L = Math.hypot(dx, dy, dz);
    const Ld = Math.hypot(tgt.x - ox, tgt.y - oy, tgt.z - oz);
    if (L < 1e-3 || Ld < 1e-3) return;
    const SOFT = 0.8, MIN = 3;
    // the soft cast runs fatter, so it meets a building corner before the thin hard cast does
    const tSoft = this._castCamera(ox, oy, oz, tgt.x - ox, tgt.y - oy, tgt.z - oz, 2.2);
    const tHard = this._castCamera(ox, oy, oz, dx, dy, dz, 0.45);
    const want = tSoft < 1 ? Math.max(Math.min(MIN, tSoft * Ld), tSoft * Ld - SOFT) : Ld;
    const hard = tHard < 1 ? tHard * L : Infinity;            // never past the first wall, however close
    if (!this._collHeld) this._collD = L;                     // free last frame: start from where the camera is
    if (cut) this._collD = want;
    else this._collD += (want - this._collD) * Math.min(1, dt * (want < this._collD ? 10 : 3));
    this._collD = Math.min(this._collD, hard);
    this._collHeld = this._collD < L - 0.02;                  // eased back out past the camera: let go
    if (this._collHeld) { const s = this._collD / L; cam.set(ox + dx * s, oy + dy * s, oz + dz * s); }
  }

  // First hit (0..1 along the segment) of a head-to-camera segment against the collider boxes; 1 = clear.
  // Broad phase: a box is slab-tested only when its footprint circle comes near the segment in plan,
  // so a frame tests a handful of boxes at most.
  _castCamera(ox, oy, oz, dx, dy, dz, PAD) {
    const sl = dx * dx + dz * dz || 1, o = this._co || (this._co = [0, 0, 0]), d = this._cd || (this._cd = [0, 0, 0]);
    let tHit = 1;
    for (const b of this.camColliders) {
      const u = Math.max(0, Math.min(1, ((b.x - ox) * dx + (b.z - oz) * dz) / sl));
      const ex = ox + dx * u - b.x, ez = oz + dz * u - b.z, rr = b.rad + PAD;
      if (ex * ex + ez * ez > rr * rr) continue;
      // slab test in the box frame: [across (right), y, along (facing axis, front +)]
      const fx = Math.sin(b.face), fz = Math.cos(b.face), lx = ox - b.x, lz = oz - b.z;
      o[0] = lx * fz - lz * fx; o[1] = oy; o[2] = lx * fx + lz * fz;
      d[0] = dx * fz - dz * fx; d[1] = dy; d[2] = dx * fx + dz * fz;
      // The visitor can stand inside the padding (a wall, a tight gap between houses), or even inside the
      // bare box (a footprint corner the walk circles leave open): the pad shrinks, negative if need be,
      // to just exclude the head. Continuous as the visitor moves, so the hit never jumps at a corner.
      const out = Math.max(Math.abs(o[0]) - b.hw, o[2] - b.front, -b.back - o[2], oy - b.y1, b.y0 - oy);
      const pad = Math.min(PAD, out - 0.02);
      if (b.hw + pad <= 0 || b.front + b.back + 2 * pad <= 0) continue;
      const lo0 = -b.hw - pad, hi0 = b.hw + pad, lo1 = b.y0 - Math.min(0, pad), hi1 = b.y1 + pad, lo2 = -b.back - pad, hi2 = b.front + pad;
      let t0 = 0, t1 = tHit;
      for (let a = 0; a < 3 && t0 <= t1; a++) {
        const lo = a === 0 ? lo0 : a === 1 ? lo1 : lo2, hi = a === 0 ? hi0 : a === 1 ? hi1 : hi2;
        if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo || o[a] > hi) t1 = -1; continue; }
        let ta = (lo - o[a]) / d[a], tb = (hi - o[a]) / d[a];
        if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
      }
      if (t0 <= t1 && t0 < tHit) tHit = t0;
    }
    return tHit;
  }

  update(dt) {
    this.time += dt * this.motion;
    const t = this.time;

    const frozen = this.ui.isOpen();
    const a = frozen ? { x: 0, z: 0 } : this.input.moveAxis();
    let worldDir = { x: 0, z: 0 };
    if (a.x || a.z) {
      const { fx, fz, rx, rz } = this._cameraBasis();
      worldDir.x = fx * -a.z + rx * a.x;
      worldDir.z = fz * -a.z + rz * a.x;
    }
    const moving = this.player.update(dt, worldDir, this.world.obstacles, this.world.clampFn);
    this._updateCamera(dt);

    // Footsteps on each half-stride.
    if (moving) {
      const step = Math.floor(this.player.walkPhase / Math.PI);
      if (step !== this._lastStep) { this._lastStep = step; this.audio.footstep(step); }
    }

    // Nearest interactable → proximity prompt.
    const pp0 = this.player.position;
    let near = null, best = Infinity;
    for (const it of this.landmarks.interactables) {
      const d = Math.hypot(pp0.x - it.x, pp0.z - it.z);
      if (d < it.interact && d < best) { near = it; best = d; }
    }
    if (near !== this.nearest) {
      this.nearest = near;
      this.ui.setPrompt(near ? near.data : null);
      if (near) this._navIndex = this.landmarks.interactables.indexOf(near);
    }
    this.landmarks.update(dt, this.time, this.camera);

    // ground the character
    const pp = this.player.position;
    this.blob.position.set(pp.x, 0.03, pp.z);

    this.water.update(t);
    this.atmosphere.update(dt * this.motion, t);   // reduced-motion-scaled, like t

    // wind sway on tree crowns
    for (const tr of this.world.trees) {
      const c = tr.userData.crown; if (!c) continue;
      const ph = tr.userData.phase;
      c.rotation.z = Math.sin(t * 1.2 + ph) * 0.045;
      c.rotation.x = Math.cos(t * 0.9 + ph) * 0.03;
    }
    // boat bob (around baseY, which floats the hull on the offshore water level)
    for (const b of this.world.boats) {
      const ph = b.userData.phase;
      b.position.y = b.userData.baseY + Math.sin(t * 1.3 + ph) * 0.18;
      b.rotation.z = Math.sin(t * 0.8 + ph) * 0.05;
    }
    this.diorama?.update(dt, t);
  }

  _loop(now) {
    if (!this.running) return;
    // Park (don't schedule) once held — but never before the first frame.
    // _parked is set up front, before update()/render(): if either throws on
    // the parking frame, _kick() can still wake the loop (it only acts on a
    // parked loop), so a throw can't freeze the town for good.
    // _noPark: the diorama draws a few real frames behind the preloader before it lifts
    // (flag.js), even when a card already holds the loop.
    const park = this._holds.size > 0 && !!this._firstFrameDone && !this._noPark;
    if (park) this._parked = true;
    else requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this.update(dt);
    if (this.post) {
      if (this.post.grain) this.post.grain.uniforms.uTime.value = this.time;
      this.post.composer.render(dt);
    } else this.renderer.render(this.scene, this.camera);
    // First rendered frame — let the loader fade out only once there's actually
    // something on the canvas (fires once).
    if (!this._firstFrameDone) {
      this._firstFrameDone = true;
      this.onFirstFrame?.();
    }
    // Held: this frame (showing the latest state) stays on the canvas and
    // nothing is scheduled until hold()/_kick() wakes us. Parking happens on
    // the frame after a hold starts, so a just-teleported view is drawn first.
  }
}
