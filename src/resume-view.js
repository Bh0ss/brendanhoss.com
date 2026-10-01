// "Read as a page" résumé view. The markup is pre-rendered into <main id="resume">
// at build time (vite-plugin-resume.js); this module only shows/hides it.
//
// State lives in one class on <html>: `resume-open`. The inline <head> script in
// index.html may set it before this module ever loads (a /resume landing), so
// the view adopts that initial state rather than assuming closed.
//
// Contract for the town lane: every open/close dispatches a DOM event
//   document → 'bh:resumeview'  detail: { open: boolean, source: string|null }
// source is 'hud' | 'intro' | 'deeplink' | 'history' on open, null on close.
// Listeners: Town holds its render loop and fades the music out, then pauses
// it, while open (Town.js), and main.js builds the town on the first
// { open: false } after a /resume landing (the town is deferred until then).
// `isResumeOpen()` gives the current state synchronously.
//
// While the markup is only visually hidden (town mode), its links are taken
// out of the Tab order (tabindex=-1) so keyboard focus can't land on invisible
// links. Screen readers still read them; `inert` is deliberately not used.

import { track } from './analytics.js';

const root = document.documentElement;
export const RESUME_EVENT = 'bh:resumeview';
const TRACKED_SOURCES = new Set(['hud', 'intro', 'deeplink']);

export const isResumeOpen = () => root.classList.contains('resume-open');

// Is the résumé markup actually on screen? The reading view, or the
// no-WebGL fallback (no-JS never runs this module).
const isResumeShown = () => isResumeOpen() || document.body.classList.contains('no-webgl');

// Keep the résumé's links out of the Tab order while they're invisible.
export function syncResumeTabbable() {
  const view = document.getElementById('resume');
  if (!view) return;
  const shown = isResumeShown();
  for (const a of view.querySelectorAll('a[href]')) {
    if (shown) a.removeAttribute('tabindex');
    else a.setAttribute('tabindex', '-1');
  }
}

export function createResumeView({ onClose } = {}) {
  const view = document.getElementById('resume');
  const title = document.getElementById('resume-title');
  const back = document.getElementById('resume-back');
  const hudBtn = document.getElementById('resume-btn');
  let lastFocused = null;

  const emit = (open, source) => {
    document.dispatchEvent(new CustomEvent(RESUME_EVENT, { detail: { open, source } }));
  };

  function focusTop() {
    if (view) view.scrollTop = 0;
    title?.focus({ preventScroll: true });
  }

  function open(source) {
    if (isResumeOpen()) return;
    lastFocused = document.activeElement;
    root.classList.add('resume-open');
    syncResumeTabbable();
    focusTop();
    if (TRACKED_SOURCES.has(source)) track('resume_view', { source });
    emit(true, source);
  }

  // The landing case: the <head> script already opened the view before JS ran.
  function adoptInitial() {
    if (!isResumeOpen()) return false;
    syncResumeTabbable();
    focusTop();
    track('resume_view', { source: 'deeplink' });
    emit(true, 'deeplink');
    return true;
  }

  function close() {
    if (!isResumeOpen()) return;
    root.classList.remove('resume-open');
    syncResumeTabbable();
    const target = lastFocused && lastFocused !== document.body && document.contains(lastFocused) ? lastFocused : hudBtn;
    lastFocused = null;
    // Focus after the chrome's visibility flips back, or the focus is dropped.
    requestAnimationFrame(() => target?.focus?.({ preventScroll: true }));
    emit(false, null);
  }

  // "← Explore the town" is a real link to / — upgrade it to a one-click close.
  back?.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    close();
    onClose?.();
  });
  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || !isResumeOpen() || document.body.classList.contains('no-webgl')) return;
    close();
    onClose?.();
  });

  syncResumeTabbable();
  return { open, close, adoptInitial, isOpen: isResumeOpen };
}
