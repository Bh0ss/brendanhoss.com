import './style.css';
import { CareerNetwork } from './scene/network.js';
import { accentAt } from './data.js';

const mobile = window.matchMedia('(max-width: 768px)').matches || window.innerWidth < 768;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.getElementById('scene');
let net;
try {
  net = new CareerNetwork(canvas, { mobile, reducedMotion });
} catch (err) {
  // WebGL unavailable — fall back to a static gradient so content stays usable.
  console.error('WebGL init failed:', err);
  document.body.classList.add('no-webgl');
}

// ── Preloader → reveal → trigger the constellation's intro assembly ───────
const preloader = document.getElementById('preloader');
let revealed = false;
function reveal() {
  if (revealed) return;
  revealed = true;
  document.body.classList.add('ready');
  if (net) net.start();
  if (preloader) setTimeout(() => preloader.classList.add('hidden'), 60);
}
if (document.readyState === 'complete') setTimeout(reveal, 400);
else window.addEventListener('load', () => setTimeout(reveal, 400));
setTimeout(reveal, 2600); // hard fallback so we never get stuck on the loader

// ── Scroll state (smoothed) ───────────────────────────────────────────────
let scroll = 0;
let targetScroll = 0;
let maxScroll = 1;
function updateMaxScroll() {
  maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
}
updateMaxScroll();
window.addEventListener('resize', updateMaxScroll);

// ── Overlays ──────────────────────────────────────────────────────────────
const overlays = Array.from(document.querySelectorAll('.overlay'));
const overlayLines = Array.from(document.querySelectorAll('.overlay-line'));
const progressBar = document.getElementById('scroll-progress');
const scrollHint = document.getElementById('scroll-hint');

function hex(n) { return '#' + n.toString(16).padStart(6, '0'); }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function updateOverlays(s) {
  progressBar.style.height = (s * 100) + '%';
  progressBar.style.background = hex(accentAt(s));

  for (const ov of overlays) {
    const enter = parseFloat(ov.dataset.enter);
    const exit = parseFloat(ov.dataset.exit);
    // Keep fades shorter than the narrowest window so every section reaches
    // full opacity and holds there (no more flashing-by while half-faded).
    const fadeIn = clamp01((s - enter) / 0.02);
    const fadeOut = clamp01((exit - s) / 0.02);
    const opacity = Math.min(fadeIn, fadeOut);
    if (opacity > 0) {
      ov.classList.add('active');
      ov.style.opacity = opacity;
    } else {
      ov.classList.remove('active');
      ov.style.opacity = 0;
    }
  }

  for (const line of overlayLines) {
    const le = parseFloat(line.dataset.lineEnter);
    line.classList.toggle('visible', s >= le);
  }

  if (scrollHint) scrollHint.classList.toggle('hidden', s > 0.02);

  // Stat counters fire once when their line becomes visible.
  for (const el of document.querySelectorAll('[data-counter]')) {
    if (el.dataset.counted) continue;
    const parent = el.closest('.overlay-line');
    if (parent && parent.classList.contains('visible')) {
      el.dataset.counted = '1';
      animateCounter(el);
    }
  }
}

function animateCounter(el) {
  const target = parseInt(el.dataset.counter, 10);
  const suffix = el.dataset.suffix || '';
  const duration = 1200;
  const start = performance.now();
  function step(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * eased) + suffix;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── Loop ────────────────────────────────────────────────────────────────
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  targetScroll = clamp01(window.pageYOffset / maxScroll);
  scroll += (targetScroll - scroll) * 0.12;
  if (Math.abs(scroll - targetScroll) < 0.0002) scroll = targetScroll;

  updateOverlays(scroll);
  if (net) {
    net.setScroll(scroll);
    net.update(dt);
  }
}
requestAnimationFrame(frame);
updateOverlays(0);

// ── Contact form (obfuscated mailto, same as legacy) ──────────────────────
window.sendContact = function sendContact() {
  const name = document.getElementById('cf-name').value.trim();
  const email = document.getElementById('cf-email').value.trim();
  const msg = document.getElementById('cf-message').value.trim();
  if (!name || !email || !msg) return;
  const t = [104, 111, 115, 115, 98, 114, 101, 110, 100, 97, 110, 64, 103, 109, 97, 105, 108, 46, 99, 111, 109];
  const to = t.map((c) => String.fromCharCode(c)).join('');
  const subject = encodeURIComponent('Website Contact from ' + name);
  const body = encodeURIComponent('From: ' + name + ' (' + email + ')\n\n' + msg);
  window.location.href = 'mai' + 'lto:' + to + '?subject=' + subject + '&body=' + body;
  document.getElementById('contact-form').innerHTML =
    '<div class="form-success">Opening your email client…</div>';
};
