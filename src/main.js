import './style.css';
import { track } from './analytics.js';
import { LOOK, consumeFallbackReload } from './diorama/flag.js';
import { parsePath, pathForLandmark, RESUME_PATH, HOME_PATH } from './routes.js';
import { createResumeView, isResumeOpen, syncResumeTabbable, RESUME_EVENT } from './resume-view.js';

// Résumé PDF is high-value job-search signal. One site-wide delegate catches
// every /resume.pdf link click — card actions and the résumé page view — so we
// get a single event per click regardless of where it lives. Kept as
// resume_view (its historical name) with source 'pdf', so it can be told apart
// from the page-view sources (hud | intro | deeplink).
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (a && /\/resume\.pdf(?:[?#]|$)/.test(a.getAttribute('href') || '')) {
    track('resume_view', { source: 'pdf' });
  }
});

// The full résumé is pre-rendered into <main id="resume"> at build time
// (vite-plugin-resume.js) — nothing to render here.

// ── Fast path + deep links ────────────────────────────────────────────────
// App state is { résumé view open?, which card is open? }; the URL mirrors it:
// /resume, /<landmark-slug>, or /. Leaving "/" pushes a history entry (so Back
// returns to the plain town); moving between non-home paths replaces it; going
// home pops our own entry, or replaces when there is none (a deep-link landing).
let town = null;
let applying = false;   // true while applying a URL → state (don't write URL back)
let ignorePop = false;  // our own history.back() in flight

function desiredPath() {
  if (isResumeOpen()) return RESUME_PATH;
  const lm = town && town.ui.isOpen() ? town.ui.current : null;
  return lm ? pathForLandmark(lm.id) : HOME_PATH;
}

function syncUrl() {
  if (applying) return;
  const path = desiredPath();
  if (location.pathname === path) return;
  const url = path + location.search + location.hash;
  const fromHome = location.pathname === HOME_PATH;
  if (path === HOME_PATH) {
    if (ignorePop) return;   // our back() to home is already in flight (a second would leave the site)
    if (history.state && history.state.bhFromHome) { ignorePop = true; history.back(); }
    else history.replaceState(null, '', url);
  } else if (fromHome) {
    history.pushState({ bhFromHome: true }, '', url);
  } else {
    history.replaceState(history.state, '', url);
  }
}

const resumeView = createResumeView({ onClose: syncUrl });

function openResume(source) {
  if (town && town.ui.isOpen() && !isResumeOpen()) { applying = true; town.ui.closeCard(); applying = false; }
  resumeView.open(source);
  syncUrl();
}

// HUD "Résumé" is a real <a href="/resume">; upgrade plain left-clicks in place.
document.getElementById('resume-btn')?.addEventListener('click', (e) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  openResume('hud');
});
// Intro card's "Just the highlights" (ui.js dispatches this).
document.addEventListener('bh:resume-request', (e) => openResume(e.detail?.source || 'intro'));

// Apply a parsed route to the UI without writing the URL back.
function applyRoute(route, { source = 'history' } = {}) {
  applying = true;
  try {
    if (route.type === 'resume') {
      if (town && town.ui.isOpen()) town.ui.closeCard();
      resumeView.open(source);
    } else {
      resumeView.close();
      if (route.type === 'landmark') {
        if (town) town.goToLandmarkById(route.id);
        else pendingLandmark = route.id;
      } else if (town && town.ui.isOpen()) {
        town.ui.closeCard();
      }
    }
  } finally { applying = false; }
}

addEventListener('popstate', () => {
  if (ignorePop) { ignorePop = false; return; }
  applyRoute(parsePath(location.pathname));
});

// Landing route. Any recognised route is rewritten to its canonical path
// (/YALE/ → /yale, /resume// → /resume, /veoci_se → /veoci); unknown paths go
// to /. Analytics keep the path as it was actually requested.
let pendingLandmark = null;
// Our own reload (diorama -> classic fallback, or a context-restore rebuild; flag.js) replays the
// landing: don't report it twice. The inline <head> script already sent the GA config without a
// page_view; deep_link_open is skipped here and the landing card's landmark_view in ui.js.
const replay = consumeFallbackReload();
const trackLanding = (name, params) => { if (!replay) track(name, params); };
const landingPath = location.pathname;
const landing = parsePath(landingPath);
const canonicalPath =
  landing.type === 'resume' ? RESUME_PATH :
  landing.type === 'landmark' ? pathForLandmark(landing.id) : HOME_PATH;
if (landingPath !== canonicalPath) {
  history.replaceState(history.state, '', canonicalPath + location.search + location.hash);
}
if (landing.type === 'resume') {
  // The <head> script normally showed the view already (adopt it: focus +
  // analytics). If it didn't — the two route checks drifted — open it here so
  // the page and the deep_link_open event always agree.
  if (!resumeView.adoptInitial()) resumeView.open('deeplink');
  trackLanding('deep_link_open', { target: 'resume', path: landingPath });
} else if (landing.type === 'landmark') {
  pendingLandmark = landing.id; // opened once the town is up (see openPendingLandmark)
  trackLanding('deep_link_open', { target: landing.id, path: landingPath });
}

function openPendingLandmark() {
  if (!pendingLandmark) return;
  const id = pendingLandmark;
  pendingLandmark = null;
  if (town) {
    applying = true;
    try { town.goToLandmarkById(id); } finally { applying = false; }
  } else if (document.body.classList.contains('no-webgl')) {
    // No 3D: the résumé is the page. Scroll to that landmark's section.
    document.getElementById('r-' + (pathForLandmark(id).slice(1) || id))?.scrollIntoView();
  }
}

const mobile = window.matchMedia('(max-width: 768px)').matches || window.innerWidth < 768;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Touch devices: prompt opens on tap (not E), and the WASD hint is irrelevant.
if (window.matchMedia('(hover: none), (pointer: coarse)').matches) {
  document.body.classList.add('touch');
  const pk = document.querySelector('#prompt .prompt-key');
  if (pk) pk.textContent = 'tap to read';
  const wasdRow = document.querySelector('#controls-hint .ch-row');
  if (wasdRow) wasdRow.style.display = 'none';
}

const canvas = document.getElementById('scene');
// Wait for fonts before constructing the scene: Town draws Fredoka into canvas
// sign textures (landmarks.js), which would otherwise render in the fallback
// font on first load until the web font finishes loading.
// Preloader control. Hide it the moment the scene paints its first frame (via
// Town.onFirstFrame) — not on a fixed timer — so what replaces the loader is
// actually the rendered world. The transition (0.55s in index.html) makes fast
// loads fade cleanly rather than flashing.
const preloader = document.getElementById('preloader');
// The preloader is aria-hidden (decorative); this polite live region outside it tells screen-reader
// users the town is loading, and when it's ready (index.html #load-status).
const loadStatus = document.getElementById('load-status');
const announce = (msg) => { if (loadStatus) loadStatus.textContent = msg; };
let preloaderHidden = false;
function hidePreloader(msg = 'The town is ready.') {
  if (preloaderHidden) return;
  preloaderHidden = true;
  if (preloader) preloader.classList.add('hidden');
  announce(msg);
}
const NO_TOWN = 'The 3D town is unavailable here. Showing the résumé.';

// The 3D town is its own chunk (three.js, the classic town, and the diorama boot), loaded with a
// dynamic import: a /resume landing downloads none of it until the reader leaves the page. On any
// other landing the import starts at once, in parallel with the fonts.
let townModule = null;
const loadTownModule = () => (townModule ||= import('./town/Town.js'));
if (!(landing.type === 'resume' && isResumeOpen())) loadTownModule();

let townRequested = false;
function buildTown() {
  if (townRequested) return;
  townRequested = true;
  announce('Loading the town…');
  // Safety net: never strand the loader on-screen. The diorama holds it while its core set loads
  // (with real progress), so its net is longer; the classic town paints almost at once.
  setTimeout(hidePreloader, LOOK === 'diorama' ? 20000 : 6000);
  Promise.all([loadTownModule(), document.fonts.ready]).then(([{ Town }]) => {
    try {
      town = new Town(canvas, { mobile, reducedMotion });
      town.onFirstFrame = hidePreloader;
      town.ui.onChange = syncUrl;
      if (replay && landing.type === 'landmark') town.ui.replayLandmark = landing.id;
      // If reveal already ran (e.g. the hard fallback fired before fonts
      // resolved, or the town was deferred), start the loop now — reveal's
      // `if (town)` would have skipped it.
      if (revealed) { town.start(); openPendingLandmark(); }
    } catch (err) {
      console.error('WebGL init failed:', err);
      document.body.classList.add('no-webgl'); // CSS hides the preloader on this path
      syncResumeTabbable(); // the résumé is now the visible page
      hidePreloader(NO_TOWN);
      openPendingLandmark();
    }
  }, (err) => {
    // the town chunk itself failed to download: the résumé is the page
    console.error('Town failed to load:', err);
    document.body.classList.add('no-webgl');
    syncResumeTabbable();
    hidePreloader(NO_TOWN);
    openPendingLandmark();
  });
}

// A /resume landing doesn't build the town behind the reading view: it would
// be parked (hidden) the whole time, and a recruiter who only reads never
// needs it. Build it on the first close instead ("Explore the town", Esc, or
// Back to a town route). The preloader, still up under the reading view,
// covers the build and fades on the town's first frame. The build waits a
// frame + task so the close (and that preloader) paints before the
// synchronous scene construction blocks the thread.
if (landing.type === 'resume' && isResumeOpen()) {
  const onResumeView = (e) => {
    if (e.detail?.open) return;
    document.removeEventListener(RESUME_EVENT, onResumeView);
    requestAnimationFrame(() => setTimeout(buildTown, 0));
  };
  document.addEventListener(RESUME_EVENT, onResumeView);
} else {
  buildTown();
}

// reveal → chrome fades in + render loop starts (first frame then hides loader).
let revealed = false;
function reveal() {
  if (revealed) return;
  revealed = true;
  document.body.classList.add('ready');
  if (town) { town.start(); openPendingLandmark(); }
}
if (document.readyState === 'complete') setTimeout(reveal, 300);
else window.addEventListener('load', () => setTimeout(reveal, 300));
setTimeout(reveal, 2500);        // hard fallback: ensure the loop starts

// Dismiss the controls hint on first interaction.
const hint = document.getElementById('controls-hint');
// Publish the hint's top edge (px above the viewport bottom) so the proximity
// prompt can sit above it instead of overlapping it at spawn (style.css).
function measureHint() {
  if (!hint) return;
  const top = Math.round(innerHeight - hint.getBoundingClientRect().top);
  if (top > 0) document.documentElement.style.setProperty('--hint-top', top + 'px');
}
measureHint();
document.fonts.ready.then(measureHint); // Fredoka kbd glyphs can change its height
addEventListener('resize', measureHint);
function dismissHint() {
  if (hint) hint.classList.add('hidden');
  removeEventListener('keydown', dismissHint);
  canvas.removeEventListener('pointerdown', dismissHint);
}
addEventListener('keydown', dismissHint);
canvas.addEventListener('pointerdown', dismissHint);
setTimeout(dismissHint, 9000);
