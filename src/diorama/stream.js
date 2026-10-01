// Landmark pack streaming for the diorama (W1).
//
// The core pack (terrain, env, player, the green and the town filler) blocks the first frame;
// see town-build.js. Every landmark has its own pack (manifest.packs), loaded by this queue:
//
//   1. front requests    a deep link at boot, or a ‹ › / deep-link hop to a landmark whose pack
//                        isn't in yet, jumps straight to the head of the queue;
//   2. the window        the landmark the visitor is at plus the next two along the route
//                        (prefetch 2 ahead), in route order;
//   3. background fill   everything else, in route order, one pack at a time, so the whole town
//                        completes without ever competing with 1 or 2.
//
// One pack is in flight at a time (dependencies such as the masonry library ride along with the
// first pack that needs them). Until a landmark's pack attaches, its code-built classic building
// stands in as the placeholder.
export function createStreamer({ routeOrder, load, currentIndex, onError = console.error }) {
  const state = new Map(routeOrder.map((id) => [id, 'queued']));   // queued | loading | ready | failed
  const front = [];
  const waiters = new Map();
  const log = [];                                       // [id, ms since start] per load, for QA
  const t0 = performance.now();
  let busy = false, stopped = false;

  function waitFor(id) {
    if (state.get(id) === 'ready' || state.get(id) === 'failed') return Promise.resolve();
    if (!waiters.has(id)) { let r; const p = new Promise((res) => { r = res; }); waiters.set(id, { p, r }); }
    return waiters.get(id).p;
  }
  function next() {
    const q = (id) => state.get(id) === 'queued';
    while (front.length) { const id = front.shift(); if (q(id)) return id; }
    const cur = currentIndex();                         // route index of the landmark the visitor is at (-1 = the green)
    for (let k = Math.max(0, cur); k <= cur + 2 && k < routeOrder.length; k++) if (q(routeOrder[k])) return routeOrder[k];
    for (let k = 0; k < routeOrder.length; k++) { const id = routeOrder[(Math.max(0, cur) + k) % routeOrder.length]; if (q(id)) return id; }
    return null;
  }
  async function pump() {
    if (busy || stopped) return;
    const id = next();
    if (!id) return;
    busy = true;
    state.set(id, 'loading');
    log.push([id, Math.round(performance.now() - t0), currentIndex()]);
    try {
      await load(id);
      state.set(id, 'ready');
    } catch (err) {
      state.set(id, 'failed');
      onError(`diorama pack "${id}" failed; its classic building stays:`, err);
    }
    waiters.get(id)?.r();
    busy = false;
    // yield a frame between packs so a pack's merge never lands in the same frame as the next fetch
    requestAnimationFrame(() => pump());
  }
  return {
    state,
    log,
    /** Move a pack to the head of the queue (deep link / hop). Resolves when it is attached. */
    request(id) {
      if (!state.has(id)) return Promise.resolve();
      if (state.get(id) === 'queued' && !front.includes(id)) front.unshift(id);
      pump();
      return waitFor(id);
    },
    start() { pump(); },
    poke() { pump(); },                                  // the visitor moved on: re-evaluate the window
    stop() { stopped = true; },
    waitFor,
    all() { return Promise.all(routeOrder.map(waitFor)); },
  };
}
