// DOM layer for the proximity prompt + content card. Town tells it which
// landmark is nearby (setPrompt) and asks it to open/close the card. Keeps all
// HTML/string-building out of the 3D code.

import { track } from '../analytics.js';

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Only allow safe schemes in hrefs (defends a future data.js edit from a
// javascript: URL slipping into the card).
function safeUrl(u) {
  try {
    const x = new URL(u, location.href);
    return ['https:', 'http:', 'mailto:'].includes(x.protocol) ? x.href : '#';
  } catch { return '#'; }
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function renderCard(lm) {
  const head = `<div class="card-eyebrow" style="color:#${lm.accent.toString(16).padStart(6, '0')}">${esc(lm.period || '')}</div>
    <h2 class="card-title" id="card-title-h">${esc(lm.title)}</h2>`;
  const intro = lm.intro ? `<p class="card-intro">${esc(lm.intro)}</p>` : '';

  let body = '';
  if (lm.points) {
    body += '<ul class="card-list">' + lm.points.map((p) => `<li>${esc(p)}</li>`).join('') + '</ul>';
  }
  if (lm.stats) {
    body += '<div class="card-stats">' + lm.stats.map((s) =>
      `<div class="stat"><div class="stat-num" data-num="${esc(String(s.num))}" data-suffix="${esc(String(s.suffix))}">${esc('0' + s.suffix)}</div><div class="stat-label">${esc(s.label)}</div></div>`
    ).join('') + '</div>';
  }
  if (lm.achievements) {
    body += '<div class="card-section">Selected Impact</div><ul class="card-list">' +
      lm.achievements.map((a) => `<li>${esc(a)}</li>`).join('') + '</ul>';
  }
  if (lm.verticals) {
    body += '<div class="card-section">Industries</div><div class="pills">' +
      lm.verticals.map((v) => `<span class="pill">${esc(v)}</span>`).join('') + '</div>';
  }
  if (lm.skills) {
    body += '<div class="card-section">Toolkit</div><div class="pills">' +
      lm.skills.map((s) => `<span class="pill">${esc(s)}</span>`).join('') + '</div>';
  }

  let actions = '';
  if (lm.kind === 'hero' || lm.kind === 'contact') {
    const parts = [`<a class="btn btn-primary" href="/resume.pdf" download="Brendan_Hoss_Resume_2026.pdf">Download résumé</a>`];
    if (lm.linkedin) parts.push(`<a class="btn" href="${safeUrl(lm.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>`);
    if (lm.github) parts.push(`<a class="btn" href="${safeUrl(lm.github)}" target="_blank" rel="noopener noreferrer">GitHub</a>`);
    if (lm.email) parts.push(`<a class="btn" href="mailto:${esc(lm.email)}">Email</a>`);
    actions = `<div class="card-actions">${parts.join('')}</div>`;
  }
  if (lm.kind === 'intro') {
    actions = `<div class="card-actions"><button class="btn btn-primary" data-close>Start exploring →</button></div>`;
  }

  return `${head}${intro}${body}${actions}`;
}

function animateCounters(root) {
  for (const el of root.querySelectorAll('.stat-num')) {
    const target = parseInt(el.dataset.num, 10);
    const suffix = el.dataset.suffix || '';
    if (reduceMotion()) { el.textContent = target + suffix; continue; }
    const start = performance.now();
    const step = (now) => {
      const p = Math.min((now - start) / 1100, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

export function createUI(audio = null) {
  const prompt = document.getElementById('prompt');
  const promptName = document.getElementById('prompt-name');
  const card = document.getElementById('card');
  const cardBody = document.getElementById('card-body');
  const backdrop = document.getElementById('card-backdrop');
  const closeBtn = document.getElementById('card-close');

  let currentPrompt = null;
  let open = false;
  let lastFocused = null;

  // Trap Tab within the card while it's open.
  function onTrap(e) {
    if (!open || e.code !== 'Tab') return;
    const f = card.querySelectorAll('a[href], button, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  card.addEventListener('keydown', onTrap);

  function setPrompt(lm) {
    currentPrompt = lm;
    if (lm && !open) {
      promptName.textContent = lm.sign || lm.title;
      prompt.classList.remove('hidden');
    } else {
      prompt.classList.add('hidden');
    }
  }

  function openCard(lm) {
    if (!lm) return;
    // Key engagement signal: which project/section a visitor actually opens.
    // The intro card isn't a "section" — it's covered by experience_start.
    if (lm.kind !== 'intro') track('landmark_view', { landmark: lm.id });
    open = true;
    lastFocused = document.activeElement;
    cardBody.innerHTML = renderCard(lm);
    card.setAttribute('aria-labelledby', 'card-title-h');
    card.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    prompt.classList.add('hidden');
    audio?.ui('open');
    requestAnimationFrame(() => {
      card.classList.add('shown');
      animateCounters(cardBody);
      closeBtn.focus();
    });
  }

  function closeCard() {
    if (!open) return;
    open = false;
    card.classList.remove('shown');
    backdrop.classList.add('hidden');
    setTimeout(() => card.classList.add('hidden'), 260);
    audio?.ui('close');
    setPrompt(currentPrompt);
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  closeBtn.addEventListener('click', closeCard);
  backdrop.addEventListener('click', closeCard);
  cardBody.addEventListener('click', (e) => {
    // "Start exploring →" (intro card's [data-close]) — one-time-per-session
    // engagement signal that the visitor began exploring.
    if (e.target.matches('[data-close]')) {
      let fired = false;
      try { fired = sessionStorage.getItem('bh_exp_start') === '1'; } catch (_) { /* private mode */ }
      if (!fired) {
        track('experience_start');
        try { sessionStorage.setItem('bh_exp_start', '1'); } catch (_) { /* ignore */ }
      }
      closeCard();
    }
    // Résumé PDF clicks are tracked site-wide by a single document-level
    // delegate in main.js (covers card actions + the fallback résumé view),
    // so there's no per-click resume_view here — avoids double-counting.
  });
  addEventListener('keydown', (e) => { if (e.code === 'Escape' && open) closeCard(); });
  // tapping the prompt opens it (mobile / mouse)
  prompt.addEventListener('click', () => { if (currentPrompt) openCard(currentPrompt); });

  return { setPrompt, openCard, closeCard, isOpen: () => open };
}
