// Build-time résumé pre-render.
//
// Renders the full résumé from src/data.js straight into index.html (dev and
// build), replacing the `<!--resume:prerender-->` marker inside <main id="resume">.
// The shipped HTML therefore carries the whole story — real <h1>, headings,
// contact links — for ATS parsers, link unfurlers, crawlers, no-JS visitors,
// and screen readers. At runtime main.js only toggles how this markup is shown
// (visually hidden, the "Read as a page" view, or the no-WebGL fallback); it
// never re-renders it.

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const MARKER = '<!--resume:prerender-->';
const PDF_HREF = '/resume.pdf';
const PDF_NAME = 'Brendan_Hoss_Resume_2026.pdf';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only allow safe schemes in hrefs (same rule as the card renderer in ui.js).
function safeUrl(u) {
  try {
    const x = new URL(u, 'https://brendanhoss.com/');
    return ['https:', 'http:', 'mailto:'].includes(x.protocol) ? x.href : '#';
  } catch { return '#'; }
}

const list = (items) => '<ul>' + items.map((i) => `<li>${esc(i)}</li>`).join('') + '</ul>';

// Résumé heading: "Role — Org" (plain, for recruiters and ATS parsers), from
// the role/org fields in data.js. The narrative `title` ("The Proving Ground")
// belongs to the town's cards and is left out here. Every career entry must
// carry both fields: a missing one fails the build rather than shipping a
// résumé with a narrative heading in it.
function heading(lm) {
  if (!lm.role || !lm.org) throw new Error(`[resume-prerender] ${lm.id}: career entry is missing ${!lm.role ? 'role' : 'org'} (src/data.js)`);
  return `${lm.role} — ${lm.org}`;
}

// Dates only: `period` is "<org or role> · <dates>" (or just dates), and the
// heading already carries role and org.
const dates = (period) => String(period).split(' · ').pop();

// skipLede: the hero's intro doubles as the page summary; don't repeat it.
function item(lm, skipLede = false) {
  let h = `<article class="r-item" id="r-${esc(lm.slug || lm.id)}">`;
  h += `<h3>${esc(heading(lm))}</h3>`;
  if (lm.period) h += `<p class="r-meta">${esc(dates(lm.period))}</p>`;
  if (lm.intro && !skipLede) h += `<p class="r-lede">${esc(lm.intro)}</p>`;
  // A bullet that just restates the heading's role (the Yale and Gateway
  // cards open with one) would repeat it here.
  if (lm.points) h += list(lm.points.filter((pt) => pt !== lm.role));
  if (lm.achievements) h += list(lm.achievements);
  return h + '</article>';
}

export function renderResume(LANDMARKS) {
  const byId = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));
  const intro = byId.intro || {};
  const hero = LANDMARKS.find((l) => l.kind === 'hero') || {};
  const contact = LANDMARKS.find((l) => l.kind === 'contact') || {};
  // data.js is chronological (it's a walk); a résumé reads newest-first.
  const work = LANDMARKS.filter((l) => l.kind === 'hero' || l.kind === 'work').reverse();
  const edu = LANDMARKS.filter((l) => l.kind === 'edu').reverse();

  const links = [];
  if (contact.email) links.push(`<a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a>`);
  if (contact.linkedin) links.push(`<a href="${esc(safeUrl(contact.linkedin))}" target="_blank" rel="noopener noreferrer">LinkedIn</a>`);
  if (contact.github) links.push(`<a href="${esc(safeUrl(contact.github))}" target="_blank" rel="noopener noreferrer">GitHub</a>`);
  links.push(`<a href="${PDF_HREF}" download="${PDF_NAME}">Résumé (PDF)</a>`);

  let h = '';
  // Reading-view toolbar. Hidden (display:none) whenever the résumé is only
  // present for assistive tech / crawlers; shown in the reading view.
  h += `<div class="r-bar">
    <a class="r-back" id="resume-back" href="/"><span aria-hidden="true">←</span> Explore the town</a>
    <a class="r-pdf" href="${PDF_HREF}" download="${PDF_NAME}">Download PDF</a>
  </div>`;
  h += `<p class="r-fallback">This site is an interactive 3D town, but your browser can't run it — here's everything directly.</p>`;

  h += '<div class="r-doc">';
  h += '<header class="r-head">';
  h += `<h1 id="resume-title" tabindex="-1">${esc(intro.title || 'Brendan Hoss')}</h1>`;
  if (intro.period) h += `<p class="r-sub">${esc(intro.period)}</p>`;
  if (hero.intro) h += `<p class="r-summary">${esc(hero.intro)}</p>`;
  h += `<ul class="r-links">${links.map((l) => `<li>${l}</li>`).join('')}</ul>`;
  h += '</header>';

  if (hero.stats) {
    h += '<ul class="r-stats" aria-label="At a glance">' + hero.stats.map((s) =>
      `<li><span class="r-stat-num">${esc(String(s.num) + s.suffix)}</span> <span class="r-stat-label">${esc(s.label)}</span></li>`
    ).join('') + '</ul>';
  }

  if (work.length) h += '<section aria-labelledby="r-h-exp"><h2 id="r-h-exp">Experience</h2>' + work.map((l) => item(l, l === hero && !!hero.intro)).join('') + '</section>';
  if (edu.length) h += '<section aria-labelledby="r-h-edu"><h2 id="r-h-edu">Education</h2>' + edu.map((l) => item(l)).join('') + '</section>';

  if (hero.skills || hero.verticals) {
    h += '<section aria-labelledby="r-h-skills"><h2 id="r-h-skills">Skills</h2>';
    if (hero.skills) h += `<p><strong>Toolkit:</strong> ${esc(hero.skills.join(' · '))}</p>`;
    if (hero.verticals) h += `<p><strong>Industries:</strong> ${esc(hero.verticals.join(' · '))}</p>`;
    h += '</section>';
  }

  h += `<section class="r-contact" id="r-${esc(contact.slug || 'contact')}" aria-labelledby="r-h-contact"><h2 id="r-h-contact">Contact</h2>`;
  if (contact.intro) h += `<p>${esc(contact.intro)}</p>`;
  h += `<ul class="r-links">${links.map((l) => `<li>${l}</li>`).join('')}</ul></section>`;
  h += '</div>';
  return h;
}

export default function resumePrerender() {
  const dataPath = resolve(process.cwd(), 'src/data.js');
  return {
    name: 'brendanhoss:resume-prerender',
    async transformIndexHtml(html) {
      if (!html.includes(MARKER)) {
        throw new Error(`[resume-prerender] marker ${MARKER} missing from index.html`);
      }
      // Cache-bust so `vite dev` picks up data.js edits on reload.
      const { LANDMARKS } = await import(`${pathToFileURL(dataPath).href}?t=${Date.now()}`);
      return html.replace(MARKER, renderResume(LANDMARKS));
    },
    handleHotUpdate({ file, server }) {
      if (file === dataPath) server.ws.send({ type: 'full-reload' });
    },
  };
}
