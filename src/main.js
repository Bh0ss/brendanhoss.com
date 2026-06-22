import './style.css';
import { Town } from './town/Town.js';

const mobile = window.matchMedia('(max-width: 768px)').matches || window.innerWidth < 768;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.getElementById('scene');
let town;
try {
  town = new Town(canvas, { mobile, reducedMotion });
} catch (err) {
  console.error('WebGL init failed:', err);
  document.body.classList.add('no-webgl');
}

// Preloader → reveal → start the loop.
const preloader = document.getElementById('preloader');
let revealed = false;
function reveal() {
  if (revealed) return;
  revealed = true;
  document.body.classList.add('ready');
  if (town) town.start();
  if (preloader) setTimeout(() => preloader.classList.add('hidden'), 80);
}
if (document.readyState === 'complete') setTimeout(reveal, 300);
else window.addEventListener('load', () => setTimeout(reveal, 300));
setTimeout(reveal, 2500); // hard fallback

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
