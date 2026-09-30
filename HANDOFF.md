# brendanhoss.com — Handoff

_Last updated: 2026-09-30. Branch `feat/site-upgrade` (off `master` @ fbd8bc8)._

This branch combines two lanes, both cut from `master` @ fbd8bc8:

- **Fast path** (`feat/fast-path`): the `/resume` reading view, deep links,
  the build-time résumé pre-render, and the deletion of `src/scene/network.js`.
- **Art direction** (`feat/art-direction`): the golden-hour look in
  `src/town/{palette,outline,world,landmarks,post,water,atmosphere,player}.js`
  and the matching `Town.js` lighting and tone mapping.

On top of both, the integration wires the fast path's `bh:resumeview` event
into the town (see "Town ↔ fast path wiring") and fixes two HUD layout bugs.
This branch is the base for the diorama rebuild.

## Live vs master

**Live equals `master` @ fbd8bc8**, verified byte-identical on 2026-09-30.
Nothing on this branch is deployed. (Older versions of this file said both
"LIVE" and "production is the old scroll site". Ignore them.)

Deploy path: Cloudflare Workers static assets (`wrangler.jsonc`, project
`website-1`, SPA fallback). `wrangler deploy` runs `npm run build` itself. A
push to `master` deploys through the git-connected Workers Build. **Don't
deploy without Brendan's go-ahead.**

## What this is

Brendan Hoss's personal site. It has two front doors:

1. **The town.** A walkable three.js shoreline town ("Branford"). Career
   chapters are buildings along a trail, and each one opens a content card.
2. **The fast path.** For recruiters and clients: a plain résumé page at
   `/resume`, reachable in one click from anywhere, plus deep links straight to
   any landmark.

**Stack:** Vite 6, three.js 0.171, vanilla ES modules, no framework.
GA4 (`G-WBHYXKGD0V`) is inline in `index.html`.

```bash
npm ci
npm run dev       # http://localhost:5173
npm run build     # -> dist/ (pre-renders the résumé into dist/index.html)
npm run preview   # serve dist/ (SPA fallback, so /resume and /yale work)
```

## Routes

| Path | Result |
|------|--------|
| `/` | The town. The intro card auto-opens once per session. |
| `/resume` | The reading view is open before first paint (inline `<head>` script). The town is **not** built behind it: `main.js` defers `new Town()` until the view first closes. |
| `/<slug>` | The town, teleported to that landmark with its card open. |
| anything else | The town. The URL is cleaned to `/`. |

On landing, `main.js` rewrites a recognised path to its canonical form with
`replaceState` (`/YALE/` → `/yale`, `/resume//` → `/resume`, `/veoci_se` →
`/veoci`). `deep_link_open` still reports the path as requested.

Slugs are the `slug` field on each landmark in `src/data.js`: `gateway`,
`uconn`, `lambda`, `story-squad`, `yale`, `veoci-ops`, `veoci`, `contact`. The
raw landmark id also works as an alias (`/veoci_se`).

The URL follows the UI state. Opening a card or the résumé from `/` pushes a
history entry, so Back returns to the plain town. Switching between cards
replaces the entry. Closing pops our own entry, or replaces the URL on a
deep-link landing.

## Architecture

| File | Role |
|------|------|
| `index.html` | Shell. Inline `<head>` script (`no-js` removal, `/resume` early open), HUD, card dialog, `<main id="resume">` holding the pre-render marker, JSON-LD Person, GA4. |
| `vite-plugin-resume.js` | `transformIndexHtml`. Renders the full résumé from `src/data.js` into `index.html` in both dev and build: `<h1>`, Experience and Education (newest first), Skills, Contact, stats. |
| `src/main.js` | Bootstrap, preloader, router and history sync, HUD Résumé button, deep-link landing, PDF-click analytics. |
| `src/routes.js` | Pure path parsing (`parsePath`, `pathForLandmark`). |
| `src/resume-view.js` | Shows and hides the pre-rendered résumé (`html.resume-open`), handles focus, emits the `bh:resumeview` event. |
| `src/data.js` | Content: `ROUTE` (trail waypoints) and `LANDMARKS` (card content plus `slug`). |
| `src/analytics.js` | `track()`, a guarded gtag wrapper that no-ops under blockers. |
| `src/town/Town.js` | Renderer, camera, loop, render holds (`hold(reason, on)`), proximity, prev/next hop (`gotoLandmark(delta)`), deep-link hook (`goToLandmarkById(id)`), golden-hour lights. |
| `src/town/ui.js` | Proximity prompt and content card: focus trap/restore, the ‹ › arrows in the Tab cycle, `onChange` URL hook (main.js), `onVisibility` render hook (Town), intro CTAs. |
| `src/town/audio.js` | Music bed and SFX. `setDucked(bool)` fades and pauses the music. |
| `src/town/palette.js` | The art-direction source of truth: colors, `LIGHT`, `SUN_DIR`, materials, and the seeded PRNG (`LAYOUT_SEED`). |
| `src/town/world.js`, `landmarks.js`, `path.js`, `player.js`, `input.js`, `audio.js`, `post.js`, `outline.js`, `water.js`, `atmosphere.js`, `palette.js` | The 3D town. |

`src/scene/network.js` (the dead career-network scene) was deleted, and the
`window.__town` dev hook mentioned in older notes no longer exists.

## Résumé display modes

The same pre-rendered markup appears in four modes:

- **Town (default):** visually hidden, but in the DOM for screen readers,
  crawlers, ATS parsers, and unfurlers.
- **Reading view:** `html.resume-open`, a full-screen scrollable page over the
  canvas. It has a sticky "← Explore the town" / "Download PDF" bar. The HUD is
  hidden, and Esc or the back link returns to the town in one click.
- **No JS:** `html.no-js` shows the same page view.
- **No WebGL:** `body.no-webgl` shows the same page view with a notice line. A
  `/<slug>` landing scrolls to that section.

## Analytics (GA4 events)

| Event | Params | When |
|-------|--------|------|
| `experience_start` | — | Intro card "Explore the town →" (once per session) |
| `landmark_view` | `landmark` | A non-intro card opens |
| `resume_view` | `source`: `hud` \| `intro` \| `deeplink` | Reading view opened |
| `resume_view` | `source`: `pdf` | A `/resume.pdf` link was clicked (the historical meaning of this event) |
| `deep_link_open` | `target` (`resume` or landmark id), `path` | Landing on `/resume` or `/<slug>` |
| `nav_arrow` | `direction` | ‹ › buttons |
| `audio_toggle` | `state` | Mute button |

## Town ↔ fast path wiring

- `document` gets the event `bh:resumeview` with `detail: { open, source }` on
  every reading-view open and close. **Town listens.** While the view is
  open, Town holds rendering (`hold('resume')`) and ducks the music
  (`audio.setDucked`: a 0.3 s fade, then pause, then a 0.6 s fade back in on
  close). On a `/resume` landing, Town doesn't exist yet: `main.js` builds
  it on the first `bh:resumeview { open: false }` (a frame + task later, so
  the close paints first). The preloader, still up under the view, covers
  the build and fades on Town's first frame; its 6 s safety net is armed
  only when the build starts. Music starts on the first gesture in the town.
  Town still adopts an already-open view in its constructor, as a guard.
- Cards also hold rendering (`hold('card')`, through `ui.onVisibility`). The
  scene behind the dimmed backdrop is a still frame. A ‹ › hop while a card
  is open, or a resize, redraws one frame and then parks again.
- Holds park the loop only **after** a frame is drawn. The first frame always
  renders, so the preloader still clears on a `/<slug>` landing, and a
  teleport is drawn before the loop parks. `_parked` is set before
  `update()`/`render()`, so a throw on the parking frame can't strand it.
- The intro card's once-per-session flag (`bh_seen_intro`) is set only when
  the intro actually opens, not when a deep-linked card or the reading view
  blocks it.
- In town mode the visually hidden résumé's links carry `tabindex="-1"`
  (`syncResumeTabbable` in `resume-view.js`), so Tab never lands on
  invisible links. They are still in the accessibility tree; don't use
  `inert`. The reading view and the no-WebGL fallback remove it.
- The card is `role="dialog"` **without** `aria-modal`: the ‹ › arrows sit
  outside it and stay in the focus trap's Tab cycle.
- `town.ui.isOpen()` returns true while a card **or** the reading view is open.
  Town uses it to freeze movement and gate the E key.

## Layout seed

The town layout comes from a seeded PRNG (mulberry32 in `palette.js`), so
every load composes the same town. The default seed is **1987**
(`LAYOUT_SEED`). `?seed=<int>` previews another layout without a rebuild
(for example `/?seed=2014`). Landmarks and atmosphere use their own fixed
seeds, so this parameter moves only the world scatter.

## Planned: diorama rebuild

The next lane rebuilds the town as a diorama. It will be built behind a
`?look=diorama` flag, off this branch, so the current look stays the default
until the rebuild is signed off. The flag does not exist yet.

## Controls

WASD/arrows or tap to walk, drag to look, scroll/pinch to zoom. **E** (or tap
the prompt) reads a landmark. Esc, ✕, or the backdrop closes it. ‹ › hop
between buildings, and they stay reachable by Tab while a card is open.

## Gotchas (don't repeat)

- **`Object3D.add(child)` returns the parent.** `g.add(mesh).position.y = h`
  moves `g`. Set the child's position first, then add it.
- **Shadow peter-panning reads as floating.** Keep `shadow.radius` low (1.5).
  `normalBias` is 0.02 for the golden-hour sun. The lower sun needs more
  bias against acne. Master used 0.006. If contact shadows detach, lower it.
- **Don't add outline children inside `group.traverse`.** It recurses forever.
- **The résumé is build-time content.** Edit `src/data.js` rather than
  `index.html`. The plugin throws if the `<!--resume:prerender-->` marker goes
  missing.
- **The `/resume` check exists twice**, in the inline `<head>` script and in
  `parsePath` (`src/routes.js`). Both lowercase the path and strip every
  trailing slash before comparing to `/resume`; keep them identical. If they
  ever drift, `main.js` self-heals (opens the view itself on a résumé route),
  but the first paint shows the preloader instead of the page.

- **HUD bottom stack.** While the controls hint is visible, the proximity
  prompt sits above it. `main.js` measures the hint into `--hint-top`, and
  the CSS rule is `#controls-hint:not(.hidden) ~ #prompt`. The prompt pill is
  `width: max-content; white-space: nowrap`. A fixed box at `left: 50%`
  shrink-wraps to half the viewport, which is why "Story Squad / tap to read"
  wrapped onto two lines on phones.

## Open items

- Diorama rebuild behind `?look=diorama` (see above).
- Content: done for the résumé page — each career entry in `data.js` now has
  `role` and `org` (from `public/resume.pdf` and existing card text), rendered as the
  "Role — Org" `<h3>`; the meta line shows only the dates (the last
  ` · ` segment of `period`). Cards still show the narrative `title`.
- A `/resume` landing still downloads the full bundle (Town is statically
  imported); only construction is deferred. A dynamic `import()` of Town
  would cut the reading view's JS too.
- Carried over: `InstancedMesh` for trees and rocks; a real-device mobile FPS
  pass; re-scrape OG unfurls after deploy.
