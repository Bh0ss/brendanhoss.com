// Thin, dependency-free wrapper around GA4's gtag. Every call is guarded:
// many visitors (and the site owner) run ad/tracker blockers that block or
// strip gtag.js, so window.gtag may be undefined. A blocked tracker must never
// throw or break the experience — track() silently no-ops when gtag isn't there.

export function track(eventName, params = {}) {
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, params);
    }
  } catch (_) {
    /* analytics is best-effort: never let it surface to the user */
  }
}
