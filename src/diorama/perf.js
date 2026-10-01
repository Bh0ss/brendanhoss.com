// Frame accounting, dynamic resolution (lite) and the ?debug=1 readout.
//
// Draw calls are counted across the whole frame (shadow pass + scene + every post pass):
// renderer.info auto-reset is off and we reset it at the start of each frame.
// Lite dynamic resolution: DPR is capped at 2 and scaled between 55% and 100% of that cap from a
// smoothed frame time (drop above ~19 ms, recover below ~14 ms), with hysteresis so it doesn't
// flap; the CAS pass in Finish restores edge crispness at the lower scales.
// Full tier: a fixed DPR, until the frame-time probe calls reduce() (flag.js): then the DPR cap drops
// to 1.5 and dynamic resolution runs as on lite.
export function createPerf({ town, post, lite, debug }) {
  const { renderer } = town;
  let cap = Math.min(window.devicePixelRatio || 1, 2);
  let dyn = lite;
  let scale = 1;
  let ema = 16.7, last = performance.now(), lastChange = last;
  let fps = 60, frames = 0, fpsT = last;
  let draws = 0, tris = 0;
  renderer.setPixelRatio(cap);
  town.resize();

  let hud = null;
  if (debug) {
    hud = document.createElement('div');
    hud.id = 'dio-debug';
    hud.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;font:12px/1.35 ui-monospace,Menlo,monospace;color:#fff;background:rgba(20,24,30,.72);padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre';
    document.body.appendChild(hud);
  }

  function beginFrame() {
    const now = performance.now();
    const dt = now - last; last = now;
    // previous frame's totals
    draws = renderer.info.render.calls; tris = renderer.info.render.triangles;
    renderer.info.reset();
    frames++;
    if (now - fpsT > 500) { fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now; if (hud) paint(); }
    if (dt > 0 && dt < 250) ema += (dt - ema) * 0.05;
    if (dyn && now - lastChange > 1500) {
      let next = scale;
      if (ema > 19 && scale > 0.55) next = Math.max(0.55, scale - 0.1);
      else if (ema < 14 && scale < 1) next = Math.min(1, scale + 0.05);
      if (next !== scale) {
        scale = next; lastChange = now;
        renderer.setPixelRatio(cap * scale);
        post.resize(innerWidth, innerHeight);
      }
    }
  }
  function paint() {
    hud.textContent = `${lite ? 'lite' : 'full'}  ${fps.toFixed(0)} fps  ${ema.toFixed(1)} ms\ndraws ${draws}  tris ${(tris / 1000).toFixed(0)}k\ndpr ${(renderer.getPixelRatio()).toFixed(2)} (cap ${cap}, scale ${scale.toFixed(2)})`;
  }
  function stats() {
    return { fps, frameMs: ema, draws, tris, dpr: renderer.getPixelRatio(), dprCap: cap, resScale: scale };
  }
  // average fps / draws over a window of real frames
  function measure(ms = 3000) {
    return new Promise((resolve) => {
      const start = performance.now(); let n = 0; let maxDraws = 0, sumDraws = 0, sumTris = 0;
      const tick = () => {
        n++; sumDraws += draws; sumTris += tris; maxDraws = Math.max(maxDraws, draws);
        if (performance.now() - start < ms) requestAnimationFrame(tick);
        else resolve({ fps: n * 1000 / (performance.now() - start), drawsAvg: sumDraws / n, drawsMax: maxDraws, trisAvg: sumTris / n, dpr: renderer.getPixelRatio(), resScale: scale });
      };
      requestAnimationFrame(tick);
    });
  }
  // the lowest dynamic-resolution scale at once (flag.js frame-time probe, before judging a device)
  function setMinScale() {
    scale = 0.55; lastChange = performance.now();
    renderer.setPixelRatio(cap * scale);
    post.resize(innerWidth, innerHeight);
  }
  // full tier, too slow (flag.js probe): lite-style DPR handling from here on
  function reduce() {
    cap = Math.min(cap, 1.5); dyn = true; scale = 0.75; lastChange = performance.now();
    renderer.setPixelRatio(cap * scale);
    post.resize(innerWidth, innerHeight);
  }
  return { beginFrame, stats, measure, setMinScale, reduce };
}
