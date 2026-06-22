// Career narrative -> 3D space.
// Each phase is a cluster of glowing nodes positioned along a forward-moving
// path through space. The camera flies through them as the user scrolls,
// arriving at each chapter of Brendan's story.

export const PALETTE = {
  bg: 0x05060a,
  blue: 0x4a9eff,
  clinical: 0x6bb8ff,
  green: 0x00d4aa,
  amber: 0xffb347,
  purple: 0x9f6aff,
  indigo: 0x6366f1,
  slate: 0x8890b0,
};

// scroll: [start, end] window where this chapter is "active"
// center:  world-space cluster center [x, y, z]
// count:   nodes in the cluster   |   radius: cluster spread
export const PHASES = [
  { id: 'origin',    scroll: [0.00, 0.10], color: PALETTE.blue,     center: [0, 0, 0],       count: 18, radius: 10 },
  { id: 'gateway',   scroll: [0.10, 0.22], color: PALETTE.blue,     center: [-16, 7, -26],   count: 22, radius: 9  },
  { id: 'uconn',     scroll: [0.22, 0.33], color: PALETTE.clinical, center: [18, -5, -50],   count: 22, radius: 9  },
  { id: 'lambda',    scroll: [0.33, 0.43], color: PALETTE.green,    center: [-20, -9, -74],  count: 26, radius: 10 },
  { id: 'story',     scroll: [0.43, 0.52], color: PALETTE.green,    center: [16, 11, -98],   count: 22, radius: 9  },
  { id: 'yale',      scroll: [0.52, 0.62], color: PALETTE.clinical, center: [-12, -13, -124],count: 24, radius: 10 },
  { id: 'catalyst',  scroll: [0.62, 0.72], color: PALETTE.amber,    center: [20, 9, -150],   count: 24, radius: 9  },
  // The main event — a dense hub with six industry sub-clusters orbiting it.
  { id: 'se',        scroll: [0.70, 0.90], color: PALETTE.purple,   center: [0, 0, -182],    count: 30, radius: 7, hub: true,
    satellites: [
      { label: 'Aviation',   offset: [-22, 14, -8],  color: PALETTE.purple },
      { label: 'Healthcare', offset: [22, 14, -8],   color: PALETTE.indigo },
      { label: 'Higher Ed',  offset: [-26, -6, 6],   color: 0x818cf8 },
      { label: 'Enterprise', offset: [26, -6, 6],    color: 0x2563eb },
      { label: 'Government', offset: [-14, -18, -4], color: 0x3b82f6 },
      { label: 'Utilities',  offset: [16, -18, -4],  color: 0x60a5fa },
    ] },
  { id: 'skills',    scroll: [0.90, 0.955], color: PALETTE.slate,   center: [0, 0, -214],    count: 28, radius: 13 },
  { id: 'close',     scroll: [0.955, 1.01], color: PALETTE.blue,    center: [0, 0, -240],    count: 20, radius: 11 },
];

// Camera flies a smooth curve sitting "behind" each cluster, looking forward
// into the next chapter. Derived from phase centers so the two stay in sync.
export function buildCameraPath() {
  const eye = [];
  const look = [];
  // Opening shot: pulled back from the origin cluster.
  eye.push([0, 1, 42]);
  look.push([0, 0, 0]);
  for (let i = 0; i < PHASES.length; i++) {
    const c = PHASES[i].center;
    const next = PHASES[Math.min(i + 1, PHASES.length - 1)].center;
    // Sit slightly above and to the side, offset toward the previous cluster.
    const side = i % 2 === 0 ? 1 : -1;
    eye.push([c[0] + side * 6, c[1] + 4, c[2] + 24]);
    // Look toward a point between this cluster and the next.
    look.push([(c[0] + next[0]) / 2, (c[1] + next[1]) / 2, (c[2] + next[2]) / 2]);
  }
  return { eye, look };
}

export function hexToRgbNorm(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

// Accent color for the scroll progress bar / UI chrome at a given scroll %.
export function accentAt(scroll) {
  for (const p of PHASES) {
    if (scroll >= p.scroll[0] && scroll < p.scroll[1]) return p.color;
  }
  return PHASES[PHASES.length - 1].color;
}
