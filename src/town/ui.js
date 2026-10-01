// DOM layer for the proximity prompt + content card. Town tells it which
// landmark is nearby (setPrompt) and asks it to open/close the card. Keeps all
// HTML/string-building out of the 3D code.

import { track } from '../analytics.js';
import { isResumeOpen } from '../resume-view.js';

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
    // Two doors: walk the town, or the fast path (résumé page view).
    actions = `<div class="card-actions"><button class="btn btn-primary" data-close>Explore the town →</button><button class="btn" data-resume>Just the highlights</button></div>`;
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
      const p = Math.min((now - start) / 800, 1);
      const eased = 1 - Math.pow(1 - p, 4); // ease-out quart: value lands fast
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

  // The ‹ › building-hop arrows sit outside the card (fixed, above the
  // backdrop) but stay usable while it's open, so they join the Tab cycle.
  const navBtns = ['nav-prev', 'nav-next'].map((id) => document.getElementById(id)).filter(Boolean);

  let currentPrompt = null;
  let open = false;
  let lastFocused = null;
  let hideTimer = 0;
  let showFrame = 0;   // openCard's deferred "show" frame; closeCard cancels it

  // Trap Tab within the card + the nav arrows while it's open. Document-level so
  // it also catches Tab while focus is on an arrow (outside the card).
  function onTrap(e) {
    if (!open || e.code !== 'Tab') return;
    const f = [...card.querySelectorAll('a[href], button, [tabindex]:not([tabindex="-1"])'), ...navBtns];
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    e.preventDefault();
    const next = i < 0 ? (e.shiftKey ? f.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + f.length) % f.length;
    f[next].focus();
  }
  addEventListener('keydown', onTrap);

  function setPrompt(lm) {
    currentPrompt = lm;
    if (lm && !open) {
      promptName.textContent = lm.sign || lm.title;
      prompt.classList.remove('hidden');
    } else {
      prompt.classList.add('hidden');
    }
  }

  // opts.hop: a ‹ › / deep-link hop (Town.gotoLandmark), which may replace an open card with the
  // welcome card.
  function openCard(lm, { hop = false } = {}) {
    if (!lm) return;
    // No cards over the résumé page view (E-key / prompt taps behind it).
    if (isResumeOpen()) return;
    // The auto-opening welcome card never replaces a card that's already up
    // (e.g. a /yale deep link opened before the intro's 650ms timer fired).
    if (lm.kind === 'intro' && open && !hop) return;
    // Key engagement signal: which project/section a visitor actually opens.
    // The intro card isn't a "section" — it's covered by experience_start.
    // On our own fallback reload (main.js sets replayLandmark), the deep-linked card reopening is
    // the same view the first load already reported: skip that one event.
    if (lm.kind !== 'intro') {
      const replayed = api.replayLandmark === lm.id;
      api.replayLandmark = null;
      if (!replayed) track('landmark_view', { landmark: lm.id });
    }
    // Hopping card→card with an arrow keeps focus on that arrow, and keeps the
    // original pre-card focus target for when the card finally closes.
    const keepFocus = open && navBtns.includes(document.activeElement);
    if (!open) lastFocused = document.activeElement;
    open = true;
    api.current = lm;
    clearTimeout(hideTimer);
    cardBody.innerHTML = renderCard(lm);
    card.setAttribute('aria-labelledby', 'card-title-h');
    card.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    prompt.classList.add('hidden');
    audio?.ui('open');
    // A close (Back, Esc) or another open can land before this frame runs (a slow
    // frame: low-end GPU, shader compile after a hop). Cancel the stale one so it
    // can't re-show a closed card or steal focus to its hidden close button.
    cancelAnimationFrame(showFrame);
    showFrame = requestAnimationFrame(() => {
      showFrame = 0;
      card.classList.add('shown');
      animateCounters(cardBody);
      if (!keepFocus) closeBtn.focus();
    });
    api.onChange?.(lm);
    api.onVisibility?.(true);
  }

  function closeCard() {
    if (!open) return;
    open = false;
    api.current = null;
    cancelAnimationFrame(showFrame);
    showFrame = 0;
    card.classList.remove('shown');
    backdrop.classList.add('hidden');
    hideTimer = setTimeout(() => card.classList.add('hidden'), 260);
    audio?.ui('close');
    setPrompt(currentPrompt);
    if (lastFocused && lastFocused.focus) lastFocused.focus();
    api.onChange?.(null);
    api.onVisibility?.(false);
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
    // "Just the highlights" → the résumé page view. main.js owns that view and
    // the URL, so hand off via a DOM event instead of importing it here.
    if (e.target.matches('[data-resume]')) {
      closeCard();
      document.dispatchEvent(new CustomEvent('bh:resume-request', { detail: { source: 'intro' } }));
    }
    // Résumé PDF clicks are tracked site-wide by a single document-level
    // delegate in main.js (covers card actions + the fallback résumé view),
    // so there's no per-click resume_view here — avoids double-counting.
  });
  addEventListener('keydown', (e) => { if (e.code === 'Escape' && open) closeCard(); });
  // tapping the prompt opens it (mobile / mouse)
  prompt.addEventListener('click', () => { if (currentPrompt) openCard(currentPrompt); });

  // isOpen() is what Town reads to freeze movement and gate the E key, so the
  // résumé page view counts as "open" too: nothing walks or opens behind it.
  // current is the open card's landmark (or null). onChange(lm | null) is set by
  // main.js to keep the URL in sync with the card. onVisibility(bool) is Town's
  // own hook (card shown/hidden → pause/resume rendering); kept separate so the
  // two owners never overwrite each other.
  // replayLandmark (main.js): on a fallback-reload replay, the landing landmark whose first
  // landmark_view was already reported by the load before the reload.
  const api = { setPrompt, openCard, closeCard, isOpen: () => open || isResumeOpen(), current: null, onChange: null, onVisibility: null, replayLandmark: null };
  return api;
}
