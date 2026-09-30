// Path routing for the fast path + deep links. Pure: no DOM, no history.
//
//   /                 → the town
//   /resume           → the town with the "Read as a page" résumé view open
//   /<landmark-slug>  → the town, teleported to that landmark with its card open
//   anything else     → the town (unknown paths fall back; URL is cleaned to /)
//
// Slugs live on each landmark in data.js. A landmark's raw id (e.g. /veoci_se)
// is accepted as an alias. Cloudflare's SPA fallback (wrangler.jsonc) serves
// index.html for all of these; the Vite dev/preview servers do the same.

import { LANDMARKS, byId } from './data.js';

export const RESUME_PATH = '/resume'; // keep in sync with the inline <head> script in index.html
export const HOME_PATH = '/';

const idBySlug = {};
for (const lm of LANDMARKS) {
  if (lm.kind === 'intro') continue;
  idBySlug[lm.id.toLowerCase()] = lm.id;
  if (lm.slug) idBySlug[lm.slug.toLowerCase()] = lm.id;
}

// → { type: 'town' | 'resume' | 'landmark', id?, unknown? }
export function parsePath(pathname) {
  const p = String(pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/index.html') return { type: 'town' };
  if (p === RESUME_PATH) return { type: 'resume' };
  const id = idBySlug[p.slice(1)];
  if (id) return { type: 'landmark', id };
  return { type: 'town', unknown: true };
}

// Path for a landmark's card, or HOME_PATH for cards without one (the intro).
export function pathForLandmark(id) {
  const lm = byId[id];
  return lm && lm.slug ? '/' + lm.slug : HOME_PATH;
}
