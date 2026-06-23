# brendanhoss.com — Walkable "Memory Lane" — Handoff

_Last updated: 2026-06-23. Branch: `walkable-branford` (pushed to GitHub, **NOT live**)._

## What this is

A rebuild of Brendan Hoss's personal site as a **walkable 3D experience** inspired by
[Abeto "Messenger"](https://messenger.abeto.co/) (clean/delicate painterly tiny-planet).
Concept: a **"walk down memory lane"** — you spawn at a trailhead on a town green and walk a
winding path through career-chapter buildings **in chronological order**, each opening a content
card. The setting is an evocative New England shoreline "Branford, CT" (Brendan's hometown).

**Stack:** Vite 6 + Three.js r0.171. Deploys to Cloudflare via `wrangler` (static `./dist`).

## Status

- **Branch `walkable-branford`** holds all work, pushed to `origin` (github.com/Bh0ss/brendanhoss.com). **Production is `master`** (old scroll-site) and is untouched.
- **Phases 1 & 2 complete; visual Increments 1 & 2 complete; world-bending fixed; content enriched from the 2026 resume.** User is happy with current state.
- Deploy = merge `walkable-branford` → `master` → push (Cloudflare auto-builds). **Do NOT deploy without explicit go-ahead.**

## How to run / build / deploy

```bash
cd ~/Documents/brendanhoss.com
npm install
npm run dev        # http://localhost:5173/
npm run build      # -> dist/
# deploy (only when approved): git checkout master && git merge walkable-branford && git push origin master
```

## Architecture (all under `src/`)

| File | Role |
|------|------|
| `main.js` | bootstrap, preloader, touch detection, builds the **accessible semantic résumé** (`#resume`) from LANDMARKS |
| `data.js` | **content**: `ROUTE` (memory-lane waypoints) + `LANDMARKS` (each chapter's card content) |
| `town/Town.js` | renderer, lighting, follow-cam, main loop, proximity detection, audio/UI wiring, **`window.__town` dev hook (REMOVE before deploy)** |
| `town/world.js` | environment: flat ground (fades to fog horizon), green, shoreline/water/dock, lighthouse, sailboats, Thimble Islands, trees/props, builds the path + lampposts; returns obstacles + clampFn |
| `town/path.js` | Catmull-Rom "memory lane" ribbon; `startPos/startDir`, `besideAt`, `nearPath` |
| `town/landmarks.js` | per-category **building designs** (`buildingFor`), signs (billboarded labels), beacons, ground-marker rings, plinths; proximity interactables |
| `town/player.js` | low-poly avatar + two-segment limb walk gait, movement, collision, click-to-move |
| `town/input.js` | WASD/arrows, tap-vs-drag, pinch-zoom |
| `town/ui.js` | proximity prompt + content card (renderCard), focus management, résumé/LinkedIn/GitHub/email buttons |
| `town/audio.js` | procedural Web Audio (ambient pad, footsteps, UI blips) |
| `town/post.js` | EffectComposer: GTAO → bloom → ACES output → color grade → tilt-shift → vignette → SMAA → **film grain** |
| `town/outline.js` | inverted-hull outlines (Abeto signature) |
| `town/water.js`, `atmosphere.js`, `palette.js` | water shader, clouds/birds, shared colors |

## The 9 landmarks (chronological, along the trail)

`intro` (The Green / welcome) → `gateway` (Gateway CC — collegiate, copper cupola) →
`uconn` (UConn — collegiate, clock tower) → `lambda` (Lambda School — tech/glass) →
`story` (Story Squad — tech) → `yale` (Yale — civic, dome+columns) →
`catalyst` (Veoci · Ops — commercial cottage) → `veoci_se` (Veoci HQ — **hero**, stepped
massing+fin) → `contact` (Harbor — résumé/LinkedIn/GitHub/email). Content is enriched from
`~/Documents/Resume 2026/archimedes-draft-resume.md`.

## Controls
WASD/arrows or tap to walk · drag to look · scroll/pinch to zoom · **E** (or tap the prompt)
to read a landmark · Esc/✕/backdrop to close.

## Key decisions
- **Stay flat + tiny-world feel via camera/fog/tilt-shift**, NOT a full walk-on-sphere globe
  (researched: 5–8 day rewrite, weakens the linear memory-lane narrative, modest perf gain).
- **Reviewed increments**: each visual change gets a sentinel review + user confirmation.
- Art direction follows the `eames` research spec (desaturated palette, smooth shading,
  outlines, grain, distinct building silhouettes, billboarded signs).

## Gotchas / learnings (don't repeat)
- **`Object3D.add(child)` returns the PARENT, not the child.** `g.add(mesh).position.y = h`
  silently moves `g`. This was the root cause of the long-running "floating buildings" bug.
  Always: `mesh.position.y = h; g.add(mesh);`.
- **Shadow peter-panning** read as "floating": fix = `shadow.radius` low (1.5) + low
  `normalBias` (0.006) + bigger map (4096 desktop).
- **Don't add outline children during `group.traverse`** — collect targets first or you
  recurse into the new meshes forever (stack overflow).
- **The world-bending look** came from curving the ground rim while objects stayed flat. Fixed
  by removing the curl and using a large flat ground that fades into a fog horizon.

## Remaining roadmap
- **DONE:** toon ramp on ground/green, grain/camera tuning, content enriched from the 2026 resume,
  9-stop walk verified, `window.__town` dev hook removed.
- **Optional future polish:** `InstancedMesh` for trees/rocks (perf), richer building detail,
  distant scenery, toon ramp on building walls (deferred — risk of clashing with outlines).
- **Pre-deploy:** real-device mobile FPS check; OG share-unfurl test (og:image needs the apex
  domain bound). 
- **Deploy (only on go-ahead):** merge `walkable-branford` → `master`, push → Cloudflare
  auto-build → brendanhoss.com.

## Session memory
Archimedes session saved (Faraday): ID `f4e2361b-b3dc-4249-8982-eb539c75785f`. Two `learning`
entries recorded (the `Object3D.add` gotcha; the shadow peter-panning fix).
