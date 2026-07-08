import './style.css';
import { Town } from './town/Town.js';
import { LANDMARKS } from './data.js';
import { track } from './analytics.js';

// Résumé PDF is high-value job-search signal. One site-wide delegate catches
// every /resume.pdf link click — card actions and the fallback résumé view —
// so we get a single resume_view per click regardless of where it lives.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (a && /\/resume\.pdf(?:[?#]|$)/.test(a.getAttribute('href') || '')) {
    track('resume_view');
  }
});

// Render all content as real semantic HTML (always present, visually hidden by
// default) so screen readers, search engines, ATS, and no-WebGL visitors get
// the full story — not just what the 3D world surfaces.
(function buildResume() {
  const el = document.getElementById('resume');
  if (!el) return;
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  let h = `<h1>Brendan Hoss</h1><p class="r-sub">Solutions Engineer · Branford, CT</p>`;
  for (const lm of LANDMARKS) {
    if (lm.id === 'intro') continue;
    h += `<section><h2>${esc(lm.title)}</h2>`;
    if (lm.period) h += `<p class="r-period">${esc(lm.period)}</p>`;
    if (lm.intro) h += `<p>${esc(lm.intro)}</p>`;
    if (lm.points) h += '<ul>' + lm.points.map((p) => `<li>${esc(p)}</li>`).join('') + '</ul>';
    if (lm.stats) h += '<ul>' + lm.stats.map((s) => `<li>${esc(s.num + s.suffix)} — ${esc(s.label)}</li>`).join('') + '</ul>';
    if (lm.achievements) h += '<ul>' + lm.achievements.map((a) => `<li>${esc(a)}</li>`).join('') + '</ul>';
    if (lm.verticals) h += `<p><strong>Industries:</strong> ${esc(lm.verticals.join(', '))}</p>`;
    if (lm.skills) h += `<p><strong>Toolkit:</strong> ${esc(lm.skills.join(', '))}</p>`;
    if (lm.email) h += `<p>Email: <a href="mailto:${esc(lm.email)}">${esc(lm.email)}</a></p>`;
    if (lm.linkedin) h += `<p><a href="${esc(lm.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a></p>`;
    if (lm.github) h += `<p><a href="${esc(lm.github)}" target="_blank" rel="noopener noreferrer">GitHub</a></p>`;
    h += '</section>';
  }
  h += `<p><a href="/resume.pdf" download="Brendan_Hoss_Resume_2026.pdf">Download résumé (PDF)</a></p>`;
  el.innerHTML = h;
})();

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
let town;
// Wait for fonts before constructing the scene: Town draws Fredoka into canvas
// sign textures (landmarks.js), which would otherwise render in the fallback
// font on first load until the web font finishes loading.
// Preloader control. Hide it the moment the scene paints its first frame (via
// Town.onFirstFrame) — not on a fixed timer — so what replaces the loader is
// actually the rendered world. The transition (0.55s in index.html) makes fast
// loads fade cleanly rather than flashing.
const preloader = document.getElementById('preloader');
let preloaderHidden = false;
function hidePreloader() {
  if (preloaderHidden) return;
  preloaderHidden = true;
  if (preloader) preloader.classList.add('hidden');
}

document.fonts.ready.then(() => {
  try {
    town = new Town(canvas, { mobile, reducedMotion });
    town.onFirstFrame = hidePreloader;
    // If reveal already ran (e.g. the hard fallback fired before fonts
    // resolved), start the loop now — reveal's `if (town)` would have skipped it.
    if (revealed) town.start();
  } catch (err) {
    console.error('WebGL init failed:', err);
    document.body.classList.add('no-webgl'); // CSS hides the preloader on this path
    hidePreloader();
  }
});

// reveal → chrome fades in + render loop starts (first frame then hides loader).
let revealed = false;
function reveal() {
  if (revealed) return;
  revealed = true;
  document.body.classList.add('ready');
  if (town) town.start();
}
if (document.readyState === 'complete') setTimeout(reveal, 300);
else window.addEventListener('load', () => setTimeout(reveal, 300));
setTimeout(reveal, 2500);        // hard fallback: ensure the loop starts
setTimeout(hidePreloader, 6000); // safety net: never strand the loader on-screen

// Dismiss the controls hint on first interaction.
const hint = document.getElementById('controls-hint');
function dismissHint() {
  if (hint) hint.classList.add('hidden');
  removeEventListener('keydown', dismissHint);
  canvas.removeEventListener('pointerdown', dismissHint);
}
addEventListener('keydown', dismissHint);
canvas.addEventListener('pointerdown', dismissHint);
setTimeout(dismissHint, 9000);
