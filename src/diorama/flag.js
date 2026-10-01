// Look selection and the diorama boot. The ONLY diorama module Town.js imports statically: the
// renderer itself (./index.js and everything under it) is a separate chunk, fetched only when the
// diorama actually boots.
//
//   (no flag)        the diorama is the site; it falls back to the classic town on its own when it
//                    can't run here (see bootDiorama)
//   ?look=classic    the classic code-built town
//   ?look=diorama    the diorama, forced: never reloads into classic (QA); failures are logged
//   ?debug=1         on-screen fps / draws / tris readout (diorama); implies ?qa=1
//   ?qa=1            window.__diorama / window.__dioTown test hooks
//
// Automatic fallback to classic, in order:
//   1. capability  no float colour buffers (post needs them) -> classic, before any download
//   2. load        the diorama chunk, the KTX2 transcoder, a core asset, or a shader compile fails
//                  -> classic in place (nothing in the visible scene changed yet; see COMMITTED below)
//   3. frame time  a short probe behind the preloader. Lite: if frames stay slow at the lowest
//                  resolution scale; full: if they stay slow on lite settings (no GTAO, lower DPR,
//                  near-field grass) -> reload into classic for the rest of the session. Skipped when
//                  the town is already in front of the visitor (see inView): it keeps the diorama at
//                  minimum scale instead.
// A failure after the scene was committed (a code bug, a shader that won't compile) takes the same
// reload path. Every reload is bounded: at most one fallback reload per session (TRIES_KEY), never
// under ?look=diorama, and at most one context-restore reload (CTX_KEY).
// (no WebGL2 at all is handled upstream: Town's constructor throws and main.js shows the résumé.)
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const LOOK_KEY = 'bh_look';                    // sessionStorage: 'classic' after an automatic fallback
// sessionStorage: the next load is our own reload (fallback or context restore). Read by the inline
// <head> script (no second GA page_view) and consumed by main.js (no second deep_link_open /
// landmark_view). Keep the name in sync with index.html.
const RELOAD_KEY = 'bh_fallback_reload';
const TRIES_KEY = 'bh_fallback_tries';         // sessionStorage: fallback reloads this session (max 1)
const CTX_KEY = 'bh_ctx_reload';               // sessionStorage: context-restore reloads this session (max 1)
const look = params.get('look');
let sessionClassic = false;
try { sessionClassic = sessionStorage.getItem(LOOK_KEY) === 'classic'; } catch (_) { /* private mode */ }

export const FORCED = look === 'diorama';
export const DIORAMA = look === 'diorama' || (look !== 'classic' && !sessionClassic);
export const DEBUG = params.get('debug') === '1';
export const QA = DEBUG || params.get('qa') === '1';
export const LOOK = DIORAMA ? 'diorama' : 'classic';

/** True once, on the load that follows our own reload (main.js skips re-reporting it). */
export function consumeFallbackReload() {
  try { const v = sessionStorage.getItem(RELOAD_KEY); if (v) sessionStorage.removeItem(RELOAD_KEY); return !!v; } catch (_) { return false; }
}

let introSeenAtBoot = false;
try { introSeenAtBoot = sessionStorage.getItem('bh_seen_intro') === '1'; } catch (_) { /* ignore */ }

// Reload into the classic town for the rest of this session (URL and history entry kept).
// Returns true when a reload is under way. Never reloads under ?look=diorama, and never twice in a
// session (a fault that survives the reload must not loop): it logs and returns false, and the
// caller carries on (the preloader lifts on its own).
function reloadClassic(reason) {
  if (FORCED) { console.error('Diorama: ' + reason + ' (forced by ?look=diorama: no fallback reload)'); return false; }
  let tries = 0, storage = true;
  try { tries = +sessionStorage.getItem(TRIES_KEY) || 0; } catch (_) { storage = false; }
  if (tries >= 1) { console.error('Diorama: ' + reason + ' (a fallback reload already ran this session: not reloading again)'); return false; }
  console.warn('Diorama: falling back to the classic town (' + reason + ')');
  if (storage) {
    try {
      sessionStorage.setItem(TRIES_KEY, String(tries + 1));
      sessionStorage.setItem(LOOK_KEY, 'classic');
      sessionStorage.setItem(RELOAD_KEY, reason);
      // the welcome card opened under the preloader on this attempt; let the classic load show it
      if (!introSeenAtBoot) sessionStorage.removeItem('bh_seen_intro');
      location.reload();
      return true;
    } catch (_) { /* quota / blocked: fall through to the URL flag */ }
  }
  // no sessionStorage: the flag must ride in the URL, or we'd loop (?look=classic never boots the diorama)
  const u = new URL(location.href); u.searchParams.set('look', 'classic');
  location.replace(u.href);
  return true;
}

/**
 * WebGL context restored under the diorama (Town.js). three rebuilds its own state, but not the
 * diorama's derived GPU data (the PMREM environment, the treeline atlas render target, the terrain
 * data textures), so the page reloads once to rebuild them. A second loss in the same session goes
 * to the classic town instead (reloadClassic, itself bounded). Returns true when a reload is under way.
 */
export function reloadAfterContextRestore() {
  let n = 0;
  try { n = +sessionStorage.getItem(CTX_KEY) || 0; } catch (_) { return reloadClassic('WebGL context restored, no sessionStorage'); }
  if (n >= 1) return reloadClassic('WebGL context lost again');
  try { sessionStorage.setItem(CTX_KEY, '1'); sessionStorage.setItem(RELOAD_KEY, 'context'); } catch (_) { return reloadClassic('WebGL context restored, sessionStorage full'); }
  console.warn('Diorama: WebGL context restored: reloading to rebuild GPU resources');
  location.reload();
  return true;
}

// Can this GPU run the diorama's post stack? (half-float colour targets for the composer)
function capable(renderer) {
  try {
    const gl = renderer.getContext();
    if (!renderer.capabilities.isWebGL2) return false;
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return false;
    return gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 2048;
  } catch (_) { return false; }
}

// Everything the diorama touches before it commits the scene, so a load failure can hand the
// classic town back exactly as it was.
function snapshot(town) {
  const r = town.renderer;
  const lights = [];
  town.scene.traverse((o) => { if (o.isLight) lights.push([o, o.intensity, o.shadow && { radius: o.shadow.radius, bias: o.shadow.bias, normalBias: o.shadow.normalBias }]); });
  const s = { tm: r.toneMapping, exp: r.toneMappingExposure, shadowType: r.shadowMap.type, autoReset: r.info.autoReset, dpr: r.getPixelRatio(), post: town.post, env: town.scene.environment, lights };
  return () => {
    r.toneMapping = s.tm; r.toneMappingExposure = s.exp; r.shadowMap.type = s.shadowType; r.info.autoReset = s.autoReset;
    r.setPixelRatio(s.dpr);
    town.post = s.post; town.scene.environment = s.env;
    for (const [o, i, sh] of s.lights) { o.intensity = i; if (sh) Object.assign(o.shadow, sh); }
    town.resize();
  };
}

// Frame-time probe: real frames of the finished diorama, drawn behind the preloader. Median over a
// short window after the shader-compile frames; if slow, retry once on cheaper settings (lite: the
// lowest resolution scale, what dynamic resolution would settle on; full: lite settings) before
// giving up on the diorama.
const PROBE = { skip: 8, frames: 36, maxMs: 2600, slowMs: 40 };
function probeFrames(ctl) {
  return new Promise((resolve) => {
    const dts = []; let last = 0, seen = 0, t0 = 0, over = false;
    const done = () => { if (over) return; over = true; ctl.onFrame = null; clearTimeout(timer); dts.sort((a, b) => a - b); resolve(dts.length >= 12 ? dts[dts.length >> 1] : 0); };
    const timer = setTimeout(done, 6000);            // loop not started / tab hidden: don't judge
    ctl.onFrame = (now) => {
      if (!t0) t0 = now;
      if (last && ++seen > PROBE.skip) dts.push(now - last);
      last = now;
      if (dts.length >= PROBE.frames || now - t0 > PROBE.maxMs) done();
    };
  });
}

// Is the town already in front of the visitor? (the preloader's safety net fired on a slow core
// load, or they clicked / typed: the résumé button and the HUD stay live over the preloader). Then a
// reload would yank the page out from under them: the probe keeps the diorama at minimum scale.
function watchVisitor() {
  let acted = false;
  const mark = (e) => { if (e.isTrusted) acted = true; };
  const opts = { capture: true, passive: true };
  addEventListener('pointerdown', mark, opts);
  addEventListener('keydown', mark, opts);
  const stop = () => { removeEventListener('pointerdown', mark, opts); removeEventListener('keydown', mark, opts); };
  const inView = () => acted || !!document.getElementById('preloader')?.classList.contains('hidden');
  return { inView, stop };
}

/**
 * Called once from the Town constructor when DIORAMA is set. Returns null when this device can't
 * run the diorama (Town stays classic), else a controller at once (Town calls controller.update
 * every frame); the renderer attaches when its chunk and core assets arrive. Until then the
 * preloader stays up: Town's first-frame hook is deferred and the preloader shows load progress.
 */
export function bootDiorama(town, { onFallback } = {}) {
  if (!capable(town.renderer)) { console.warn('Diorama: GPU lacks float colour buffers; classic town'); return null; }
  const ctl = { ready: false, failed: false, update() {}, impl: null, onFrame: null };
  let firstFrame = null;
  let fired = false;
  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });
  Object.defineProperty(town, 'onFirstFrame', {
    configurable: true,
    get() { return () => { if (fired) return; fired = true; ready.then(() => firstFrame?.()); }; },
    set(fn) { firstFrame = fn; },
  });
  const restore = snapshot(town);
  const visitor = watchVisitor();
  // Shader compile failures (three's default is a console error and an invisible material). Before
  // the scene is committed the throw lands in the catch below (classic in place); after it, the
  // bounded reload into classic. Live until every material in the finished scene has compiled and
  // drawn (compileAsync + two frames, behind the preloader); streamed packs after that get three's
  // default logging.
  const rdebug = town.renderer.debug;
  let shaderFailed = false, shaderReload = false;
  const onShaderError = (gl, program, vs, fs) => {
    const info = [gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs), gl.getProgramInfoLog(program)].filter(Boolean).join('\n').trim();
    const err = new Error('shader compile failed: ' + (info.split('\n')[0] || 'no info log'));
    console.error('Diorama:', err.message, info);
    if (!town._dioCommitted) throw err;
    if (shaderFailed) return;
    shaderFailed = true;
    ctl.failed = true;
    shaderReload = reloadClassic('shader');
  };
  rdebug.onShaderError = onShaderError;
  const unhookShaders = () => { if (rdebug.onShaderError === onShaderError) rdebug.onShaderError = null; };
  progress(0.04);
  Promise.all([import('./index.js'), import('./assets.js')])
    .then(([m, a]) => { a.onLoadProgress((f) => progress(0.06 + 0.9 * f)); return m.attachDiorama(town); })
    .then(async (impl) => {
      ctl.impl = impl;
      ctl.update = (dt, t) => { impl.update(dt, t); ctl.onFrame?.(performance.now()); };
      ctl.ready = true;
      progress(1);
      // draw the finished diorama (not the classic still) before the preloader lifts, even if a
      // card is already holding the loop; judge the frame time meanwhile
      town._noPark = true; town._kick();
      if (!FORCED) {
        let ms = await probeFrames(ctl);
        if (shaderReload) return new Promise(() => {});
        if (ms > PROBE.slowMs) {
          if (town.lite) impl.setMinResolution?.(); else impl.reduceQuality?.();
          ms = await probeFrames(ctl);
        }
        ctl.probeMs = ms;
        if (ms > PROBE.slowMs) {
          const why = 'slow frames: ' + ms.toFixed(0) + ' ms';
          if (visitor.inView()) console.warn('Diorama: ' + why + ', but the town is already on screen: keeping the diorama at minimum scale');
          else if (reloadClassic(why)) { ctl.failed = true; return new Promise(() => {}); }
          impl.setMinResolution?.();
        }
      }
      // every material in the scene compiled (three checks a program's log on its first draw, so
      // two more frames after compileAsync), so a core shader failure has surfaced before the hook goes
      await Promise.race([town.renderer.compileAsync(town.scene, town.camera).catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (shaderReload) return new Promise(() => {});
      unhookShaders();
      town._noPark = false;
    })
    .catch((err) => {
      ctl.failed = true;
      ctl.update = () => {};
      town._noPark = false;
      unhookShaders();
      if (town._dioCommitted) {
        // the visible scene is the diorama's: only a reload can hand the classic town back
        if (reloadClassic('error after commit: ' + (err?.message || err))) return new Promise(() => {});
        console.error('Diorama failed after commit:', err);
        return undefined;
      }
      console.error('Diorama failed to load; keeping the classic town:', err);
      restore();
      onFallback?.(err);
      return undefined;
    })
    .finally(() => { visitor.stop(); import('./assets.js').then((a) => a.onLoadProgress(null)).catch(() => {}); progressDone(); resolveReady(); });
  return ctl;
}

// ── preloader progress (index.html #preloader .pl-bar) ────────────────────────────────────────
let shown = 0;
function progress(f) {
  const el = typeof document !== 'undefined' && document.getElementById('preloader');
  if (!el) return;
  shown = Math.max(shown, Math.min(1, f));     // never runs backwards
  el.classList.add('loading');
  el.style.setProperty('--p', shown.toFixed(3));
}
function progressDone() { progress(1); }
