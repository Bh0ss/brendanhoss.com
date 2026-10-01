# brendanhoss.com — Handoff

_Last updated: 2026-09-30 (diorama W3). Branch `feat/site-upgrade` (off `master` @ fbd8bc8),
diorama work uncommitted on top of 115f9f7._

This branch combines two lanes, both cut from `master` @ fbd8bc8:

- **Fast path** (`feat/fast-path`): the `/resume` reading view, deep links,
  the build-time résumé pre-render, and the deletion of `src/scene/network.js`.
- **Art direction** (`feat/art-direction`): the golden-hour look in
  `src/town/{palette,outline,world,landmarks,post,water,atmosphere,player}.js`
  and the matching `Town.js` lighting and tone mapping.

On top of both: the integration (the fast path's `bh:resumeview` event wired
into the town, two HUD fixes), then the **diorama rebuild** (W0 spike, W1
buildings and streaming, W3 integration: the diorama is now the default look).

## Live vs master

**Live equals `master` @ fbd8bc8**, verified byte-identical on 2026-09-30.
Nothing on this branch is deployed. (Older versions of this file said both
"LIVE" and "production is the old scroll site". Ignore them.)

Deploy path: Cloudflare Workers static assets (`wrangler.jsonc`, project
`website-1`, SPA fallback). `wrangler deploy` runs `npm ci && npm run build`
itself (never the Blender / toktx asset pipeline: `public/assets/v1` is
committed; `npm run assets -- --check` validates it). A
push to `master` deploys through the git-connected Workers Build. **Don't
deploy without Brendan's go-ahead.**

## What this is

Brendan Hoss's personal site. It has two front doors:

1. **The town.** A walkable three.js shoreline town ("Branford"). Career
   chapters are buildings along a trail, and each one opens a content card.
   It renders as the **diorama** (stylised-real: PBR buildings, terrain,
   water, grass, post) by default, or as the **classic** code-built toy town.
2. **The fast path.** For recruiters and clients: a plain résumé page at
   `/resume`, reachable in one click from anywhere, plus deep links straight to
   any landmark.

**Stack:** Vite 6, three.js 0.171, vanilla ES modules, no framework.
GA4 (`G-WBHYXKGD0V`) is inline in `index.html`.

```bash
npm ci
npm run dev       # http://localhost:5173
npm run build     # -> dist/ (pre-renders the résumé into dist/index.html)
npm run assets    # optimise the diorama art into public/assets/v1 (run build first; exits 1 over budget, writing nothing)
npm run assets -- --check   # fast, non-writing: public/assets/v1 vs manifest, decoders, trim rows, budgets
npm run preview   # serve dist/ (SPA fallback, so /resume and /yale work)
```

## Routes

| Path | Result |
|------|--------|
| `/` | The town (the diorama by default; see "Looks"). The intro card auto-opens once per session. |
| `/resume` | The reading view is open before first paint (inline `<head>` script). The town is **not** built behind it, and its code isn't downloaded: `main.js` imports `town/Town.js` dynamically, on the view's first close. The landing fetches one 17 KB JS file. |
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

## Looks: diorama (default) and classic

| | Diorama (default) | Classic (`?look=classic`) |
|---|---|---|
| What | `src/diorama/*` attaches to a Town: hides the classic world, adds terrain, water, grass, trees, the GLB buildings, avatar, IBL, post + LUT | `src/town/*` as it was: code-built flat-shaded town |
| Downloads | JS ~0.3 MB gz (entry 7 KB, Town + three.js + post 216 KB, diorama 81 KB) + core assets (lite 2.76 MB / full 5.58 MB incl. decoders), landmark packs streamed after | JS ~0.22 MB gz, no assets |
| First frame | After the core set (and a deep-linked landmark's pack) loads; the preloader shows real byte progress | Almost at once |

The classic town is always constructed first (it is the diorama's placeholder
and its interaction model: cards, prompts, ‹ › hops, collision, deep links all
run through `Town`). The diorama re-seats each landmark node (sign, beacon,
doormat ring, collision, approach, hop framing) onto its new building.

**Automatic fallback to classic** (`src/diorama/flag.js`), in order:

1. **Capability**: no half-float colour buffers (`EXT_color_buffer_float` /
   `_half_float`) or max texture < 2048 → classic before any diorama download.
2. **Load**: the diorama chunk, the KTX2 transcoder (`ktx2.init()` is awaited
   up front), a core asset, any texture decode (`loadGLB` checks every texture
   resolved: GLTFLoader otherwise swallows them), or a shader compile
   (`renderer.debug.onShaderError`, which throws) fails → classic **in place**.
   Every critical load (including the green and the houses) finishes before
   **`index.js` sets `town._dioCommitted`, immediately before its first scene
   mutation** (the IBL and the sky-dome swap; `town-build.js` hides the classic
   world after that). Renderer settings, lights and `scene.environment` are
   snapshotted and restored, and the KTX2 worker pool and the PMREM target are
   disposed (`attachDiorama` cleans up on a pre-commit throw and returns
   `dispose` on success).
3. **Frame time** (both tiers; not under `?look=diorama`): once the diorama is
   up, flag.js renders ~36 real frames behind the preloader (after 8
   shader-compile frames; `town._noPark` keeps the loop running under the intro
   card). Median > 40 ms → cheaper settings and probe again: **lite** drops to
   the lowest resolution scale; **full** drops to lite settings (GTAO off, the
   lite near-field grass ring, DPR cap 1.5 with dynamic resolution on). Still
   > 40 ms → set `sessionStorage.bh_look = classic` and reload (URL and history
   kept; the intro card is un-marked so the classic load shows it). **Never in
   front of the visitor:** if the preloader has already lifted (its 20 s safety
   net fired on a slow core load) or the visitor has clicked or typed, the
   reload is skipped and the diorama stays at minimum scale.
4. A failure **after** commit (a code bug, a shader that won't compile) takes
   the reload path.

**Reloads are bounded.** At most one fallback reload per session
(`sessionStorage.bh_fallback_tries`); a second fault logs and stays put (the
preloader lifts on its own). Under `?look=diorama` nothing ever reloads into
classic: failures are logged. No sessionStorage → reload with `?look=classic`
instead (can't loop). A **WebGL context restore** under the diorama reloads
once to rebuild the PMREM env, treeline atlas and terrain data textures
(`bh_ctx_reload`); a second loss in the session goes classic.

**Analytics on our own reloads** (`bh_fallback_reload`): the inline `<head>`
script configures GA with `send_page_view: false`, `main.js` skips
`deep_link_open`, and `ui.js` skips the deep-linked card's first
`landmark_view`. One page_view, one deep_link_open, one landmark_view per
visit (asserted in `w3-fallback.js`).

No WebGL2 at all is handled upstream, as before: `Town`'s constructor throws
(three r171 is WebGL2-only), `body.no-webgl`, and the résumé is the page. A
failed download of the Town chunk takes the same path.

### URL flags

| Flag | Effect |
|---|---|
| `?look=classic` | The classic town. No diorama bytes. |
| `?look=diorama` | Force the diorama: never reloads into classic (QA on slow devices); post-commit faults are logged. Pre-commit load failures still fall back in place. |
| `?qa=1` | The test hooks `window.__diorama` and `window.__dioTown` (off in production). `?debug=1` implies it. |
| `?perf=low` / `?perf=high` | Force the lite / full tier (default: auto — phones and low-end GPUs by renderer string go lite). |
| `?debug=1` | Diorama fps / ms / draws / tris / DPR readout, top left (and the `?qa=1` hooks). |
| `?seed=<int>` | Classic world scatter layout (see "Layout seed"). |
| `?tm=agx` | Diorama tone mapping A/B (default Khronos PBR Neutral). |

A session that fell back for frame time stays classic until the tab closes;
`?look=diorama` overrides it.

### Camera

| | Classic | Diorama |
|---|---|---|
| Default follow pitch | 0.60 | **0.48** (whole rooflines, more horizon) |
| Default distance (desktop / phone) | 24 / 27 | 25 / 29 |
| Zoom range | 11–42 | 12–48 |

A guided hop (‹ ›, deep link) in the diorama frames the building: default
pitch, the landmark's `viewDist`, and a **look lift** (`Town._lift`) that
tilts the view up so the visitor's feet and the building (facade eave; the
ridge / cupola capped at 1.5× the eave) sit clear of the HUD. Computed per
building in `town-build.js` `viewFor()` from its extents and `meta.h` /
`meta.top`; phones also back off until ~72% of the facade width reads. The
hero landmarks (**Yale's tower, Lambda's smokestack**) use `heroView()`
instead: it fits the whole silhouette (a lower pitch, a small yaw off the
facade axis, a landing shift), so the tower and stack stay in frame. The first
step, tap, drag or zoom eases the lift back to the visitor. Current values
(pitch / distance; desktop then phone, from `diorama-shots/final/metrics.json`):
gateway 0.48 / 25 and 0.48 / 34.5, uconn 0.48 / 27 and 0.48 / 40.5, **lambda
0.27 / 42 and 0.27 / 48**, story 0.48 / 25 and 0.48 / 30.5, **yale 0.27 / 36
and 0.48 / 44**, catalyst 0.48 / 25 and 0.48 / 30, veoci 0.48 / 25 and
0.48 / 29, harbor 0.48 / 25 and 0.48 / 29 (harbor keeps its `VIEW_OVERRIDES`
spot, looking out to sea).

### Reduced motion (`prefers-reduced-motion: reduce`)

Diorama: `town.motion = 0.05` (classic keeps 0.4), so grass wind, water
swell and swash, boat bob, clouds and beacon pulse run at 1/20 speed (an idle
second changes 2.5% of pixels vs 14.4% with motion). The follow camera cuts
instead of gliding (no lerp), the hop's look lift snaps back, and a streamed
landmark swaps in without its rise animation. The preloader's dots and bar
don't animate.

### Loading

- Preloader (`index.html`, inline CSS): wordmark, dots, and a progress bar
  that appears when the diorama starts loading. `flag.js` drives `--p` from
  `assets.js` byte progress over every load registered before the first frame
  (the core set plus a deep-linked pack), monotonic. It lifts on the first
  frame of the **finished** diorama (never the classic still).
- Streaming (`src/diorama/stream.js`): landmark packs load one at a time:
  front requests (a deep link loads with the core; a ‹ › hop pulls its pack to
  the front), then the window (current + 2 ahead), then the rest in route order.
- Placeholder swap (`town-build.js` `swapIn`): if the landmark is on screen,
  the classic building sinks away (0.35 s) as the new one rises into place
  (0.55 s ease-out). Off screen, behind a card, or under reduced motion, it's
  instant. A visitor standing on the placeholder's old landing spot is moved
  to the new doorstep, camera and all.

### Beacons and doormat rings

Each landmark's beacon sits over its entrance, just above the sign board
(`signY + 2.75`, `e.front + 1.2`), proud of the facade, never on a roof. The
classic 5-unit light shaft is cut to a short stub so it doesn't run through the
sign. The Green's beacon hangs over the bandstand's steps (it was inside its
roof); its ring is off (it sat under the bandstand). Doormat rings mark each
hop's landing spot and fade with distance from the visitor (full within 14
units, gone beyond 26), pulse kept.

## Architecture

| File | Role |
|------|------|
| `index.html` | Shell. Inline `<head>` script (`no-js` removal, `/resume` early open), preloader (+ progress bar), HUD, card dialog, `<main id="resume">` holding the pre-render marker, JSON-LD Person, GA4. |
| `vite-plugin-resume.js` | `transformIndexHtml`. Renders the full résumé from `src/data.js` into `index.html` in both dev and build. |
| `src/main.js` | Bootstrap, preloader, router and history sync, HUD Résumé button, deep-link landing, PDF-click analytics. **Imports `town/Town.js` dynamically** (at once off `/resume`; on the reading view's first close on `/resume`). |
| `src/routes.js` | Pure path parsing (`parsePath`, `pathForLandmark`). |
| `src/resume-view.js` | Shows and hides the pre-rendered résumé (`html.resume-open`), handles focus, emits `bh:resumeview`. |
| `src/data.js` | Content: `ROUTE` (trail waypoints) and `LANDMARKS` (card content plus `slug`). |
| `src/analytics.js` | `track()`, a guarded gtag wrapper that no-ops under blockers. |
| `src/town/Town.js` | Renderer, camera (per-look defaults, hop framing, look lift), loop, render holds, proximity, prev/next hop, deep-link hook, golden-hour lights. Boots the diorama. |
| `src/town/*` (rest) | The classic town, its UI (`ui.js`), audio, input, player. All still used: classic look, fallback, placeholders, interaction. |
| `src/diorama/flag.js` | Look selection, capability check, diorama boot (dynamic import), fallbacks, frame-time probe, preloader progress. The only diorama module in the Town chunk. |
| `src/diorama/index.js` | `attachDiorama(town)`: renderer settings, core loads, the commit point, IBL, lights, terrain, water, nature scatter, grass, avatar, post, shadows, perf, full-tier `reduceQuality`, QA hooks (`window.__diorama`, `?qa=1` only). Rendering lane. |
| `src/diorama/town-build.js` | Hides the classic world; places the green, church, houses, street fence, walls, lamps, benches; landmark packs, re-seating, hop framing, beacons, ring fade, placeholder swap; `blocked(x, z, pad)` for the scatter and `footprints` for the shrubs; QA hook `window.__dioTown` (`?qa=1` only). Art / assets lane. |
| `src/diorama/assets.js` | Manifest, KTX2 + meshopt loaders, tiered GLB/HDR/LUT loads, texture-decode check, byte progress. |
| `src/diorama/stream.js` | The landmark pack queue. |
| `src/diorama/perf.js` | Frame accounting, lite dynamic resolution, `setMinScale()` for the probe, `?debug=1` HUD. |
| `src/diorama/{terrain,water,grass,lawn,post,shadows,materials,avatar}.js` | Rendering pieces (rendering lane). `trim-layout.js` is generated. |
| `scripts/optimize-assets.mjs` | The asset pipeline (`npm run assets`; `-- --check` validates without writing). |

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
  the close paints first; the 3D chunk is downloaded only then). The
  preloader, still up under the view, covers the build and fades on Town's
  first frame; its safety net (20 s diorama, 6 s classic) is armed only when
  the build starts. Music starts on the first gesture in the town.
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

## Diorama assets

### Style mapping

Each landmark's architecture follows its role and org in `src/data.js`:

| Landmark | Role / org | Building | Why |
|---|---|---|---|
| The Green (intro) | — | Octagonal bandstand on the green, white steepled Congregational church facing it from the north | The New England town green: where the walk starts |
| Gateway CC | A.S. Computer Science, Gateway Community College | Modern red-brick academic hall: ribbon windows, two-storey glazed atrium, canopy | A community college is a contemporary campus building, not a Gothic one |
| UConn | Software Engineering, University of Connecticut | Red-brick Georgian hall: giant-order portico and pediment, quoins, hipped slate roof, copper-domed cupola | UConn's brick Georgian / colonial-revival campus |
| Lambda School | Data Science program (a tech startup school) | Converted brick mill: arched mill windows, clock tower with copper spire, smokestack, modern glass entry | Startup / tech → converted mill, New England's classic tech-company home |
| Story Squad | Data Science Intern (startup) | Modern barn-form studio: charcoal clapboard, glazed gable end, black metal roof, timber entry | Startup → modern office, kept small and distinct from Veoci's |
| Yale | Test Site Coordinator & Site Lead, Yale University | Collegiate Gothic: sandstone ashlar, limestone lancets, buttresses, crenellated gate tower with pinnacles | Yale's Collegiate Gothic colleges |
| Veoci · Ops (catalyst) | Office Manager & IT Coordinator, Veoci | Main Street commercial block: brick, green storefront and awning, sign band, bracketed cornice | A small-company, hands-on role → Main Street storefront |
| Veoci (veoci_se) | Solutions Engineer, Veoci | The W0 glass-and-aluminium office | Tech employer → modern office; the hero building |
| Harbor (contact) | — | Lighthouse on the point, New England fixed pier with lobster gear, a daysailer and a work skiff | "Let's build something": the end of the walk, by the water |

Town filler: 14 houses from five variants (white centre-chimney colonial, pale-yellow Cape
with dormers, grey-blue saltbox, barn-red farmhouse with porch, white Greek Revival); one
continuous picket street fence along the four shore-road yards (straight runs that bend at each
front walk, open gates at the walks, posts at every panel and run end, returns to the house at
both ends of the row, sheared to follow the ground); fieldstone walls in a broken ring beyond
the lane; colonial lampposts along the lane and round the green; green park benches.

Signs keep their narrative subtitles ("The Proving Ground · 2021–2023"): on-brand, deliberate.

### Asset pipeline

- **Source art** lives in `~/Documents/brendanhoss-art/` (not a git repo;
  `.gitignore` there excludes `build/`, `raw/`, `__pycache__/`). Blender 5.2
  headless scripts; licences in `SOURCES.md`.
- **Rebuild everything:** `~/Documents/brendanhoss-art/scripts/build_all.sh`
  (needs `raw/` populated: `fetch_polyhaven.py` plus the Quaternius zips), then
  in this repo `npm run build && npm run assets`. `build_all.sh` writes
  `build/glb` + `build/tex`; `npm run assets` reads them (`--src <dir>` to
  override).
- Buildings carry library material *names* only (`M_Trim` trim sheet,
  `M_Siding[_Yellow|_Blue|_Red|_Grey]`, `M_Shingle[_Dark]`, `M_Brick`,
  `M_Ashlar`, `M_LampGlow`); the runtime binds them to the shared material
  libraries, so textures never scale with building count. Colour variants are
  tints of one map set (`town-build.js`, `SIDING`).
- `npm run assets` optimises into `public/assets/v1/` per tier (full / lite):
  KTX2 (UASTC hero albedos, ETC1S the rest), meshopt, int16 building UVs
  (scale in primitive extras, applied in `materials.js` `floatGeometry()`).
  It writes `manifest.json` (packs, route order, per-building metadata, byte
  totals), generates `src/diorama/trim-layout.js` (trim-sheet row bands: never
  hardcode them), copies the decoders to `public/basis/` and `public/meshopt/`,
  and **prunes** any `.glb/.hdr/.cube/.ktx2` in `public/assets/v1` the manifest
  no longer references. Everything is built into a temporary staging
  directory and every budget is checked there first: on any failure nothing in
  `public/` or `src/` is touched; on success the assets, decoders and trim rows
  are copied in and `manifest.json` is written last, atomically.
  `public/assets/v1` holds exactly the manifest's 41 files plus `manifest.json`.
- `npm run assets -- --check` (well under a second, no Blender or toktx)
  re-validates that: every manifest file at its recorded size, nothing stale,
  per-model triangles and KTX2 sizes re-read from the GLBs, decoders identical
  to `node_modules`, `trim-layout.js` matching the manifest, and the byte
  budgets against the current `dist/`.

### Budgets (`npm run assets` exits non-zero on any overrun)

| | Budget | Now |
|---|---|---|
| Core payload, lite | ≤ 3 MB | 2.76 MB (incl. decoders 595 KB) |
| Core payload, full | ≤ 6 MB | 5.58 MB |
| Whole site, lite (all assets + decoders + dist JS/CSS/HTML + fonts + music) | ≤ 8 MB | 6.23 MB |
| Whole site, full | ≤ 18 MB | 9.75 MB |
| Triangles per model | ≤ 20k | max 17.1k (Lambda) |
| Texture size | ≤ 2048 px | — |
| Draws per frame (runtime; metrics script) | lite ≤ 150, full ≤ 300 | lite max 56, full max 205 |
| `/resume` landing JS | — | 17.2 KB (7.4 KB gz), was 742 KB (221 KB gz) |

### Licensing

All third-party art is **CC0 1.0** (Poly Haven textures, HDRI and models;
Quaternius packs, free Standard tier only; one Quaternius model via Poly
Pizza). Everything else is built in the art scripts. Per-asset URLs and
verification: `~/Documents/brendanhoss-art/SOURCES.md`. The music bed is the
existing `beach-lofi.mp3`, re-encoded at 96 kbps.

### W3 numbers (`diorama-shots/w3/metrics.json`)

Headless Chromium, Apple M4 Pro (ANGLE Metal). Lite is simulated (375×812 @3x,
`?perf=low` on the same GPU): it shows draw / payload discipline, not phone
frame times.

| | draws max / avg | tris max | fps min | network, whole town |
|---|---|---|---|---|
| full | 205 / 186 (≤ 300) | 3.53 M | 90 | 8.37 MB |
| lite | 56 / 48 (≤ 150) | 0.50 M | 120 (vsync) | 4.84 MB |

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

- **Hop to the green over an open card.** `ui.openCard` refuses the intro
  card while another card is open (a guard for its auto-open timer), so
  `Town.gotoLandmark` closes the open card first. `syncUrl` must not issue a
  second `history.back()` while one is in flight (`ignorePop`): two backs from
  a first-hop entry left the site for `about:blank`. (Both predate W3; fixed
  there.)
- **Diorama frame-time probe runs behind the preloader.** Anything that holds
  the loop before the diorama is up (the intro card at +650 ms) is overridden by
  `town._noPark` until the probe finishes.
- **`extents()` height is the bounding box.** Towers, spires and smokestacks
  are in it. Use the manifest `meta.h` (eave) / `meta.top` for framing.

## Known issues

- Full-tier triangle count rose to 3.5 M a frame (W1: 1.2–1.9 M) with the
  rendering lane's W2 scatter (horizon trees, grass); fps on the M4 dropped
  from 120 to 90–100. Still within the draw budget; no phone numbers yet. A
  slow full-tier device now drops to lite settings, then classic (frame-time
  probe, above).
- On a portrait phone the widest landmarks (Lambda, Yale, UConn) show ~72% of
  their facade width at the hop; the rest is a pan away.
- The frame-time fallback reloads the page (the diorama can't be unwound in
  place once committed), so it costs a second load on those devices. It only
  happens behind the preloader; once the town is on screen a slow device keeps
  the diorama at minimum scale instead.
- When the core load outlasts the preloader's 20 s safety net, the classic
  town shows first and the diorama attaches in front of the visitor when it
  arrives (no reload).
- Streamed landmark packs compile their shaders after `onShaderError` is
  unhooked: a failure there gets three's default console error, not a fallback.
- `resume-bytes` and the regression suites run headless on one Mac; a real
  phone pass (`?debug=1`) is still owed.

## Open items

- Real-device mobile pass: frame times on an iPhone and a mid Android,
  whether the lite probe threshold (40 ms median) is right.
- Carried over: re-scrape OG unfurls after deploy (the og.jpg still shows the
  classic town).
- `~/Documents/brendanhoss-art/scripts/build_house.py` and `build_dock.py` are
  the superseded W0 builders (`build_all.sh` skips them) and
  `build/glb/house_colonial.glb` is their output: delete when convenient.
