// Brendan's story as a walk down memory lane. The ROUTE is the meandering
// "memory lane" the player follows; LANDMARKS are placed organically beside it
// in chronological order. Each building auto-orients to face the trail
// (landmarks.js) and opens a card on approach. Content preserved from the
// original site.

// Memory-lane centerline (x, z) — trailhead at the green, winding out around
// the town and down to the shoreline (the present).
export const ROUTE = [
  [0, 12],     // trailhead, just south of the green/gazebo
  [-16, 8],
  [-34, -2],
  [-44, -22],  // the foundation (NW)
  [-28, -40],
  [-6, -46],   // the data chapter (N)
  [18, -42],
  [38, -30],   // Story Squad
  [50, -10],   // Yale
  [50, 12],    // Veoci Ops
  [36, 30],    // Solutions Engineer (present)
  [16, 40],
  [4, 44],     // the harbor (by the water)
];

export const LANDMARKS = [
  {
    id: 'intro', kind: 'intro',
    sign: 'The Green',
    title: 'Brendan Hoss',
    period: 'Solutions Engineer · Branford, CT',
    accent: 0x4a9eff,
    pos: [0, 0],
    intro: "Every solution starts with someone who sees the connections others don't.",
    points: [
      'Welcome. This is a walk down memory lane — follow the path and each stop is a chapter of the journey.',
      'Use WASD or tap to walk, drag to look around.',
    ],
  },
  {
    id: 'gateway', kind: 'edu',
    sign: 'Gateway CC',
    title: 'The Foundation',
    period: 'Gateway Community College · 2014–2017',
    accent: 0x4a9eff,
    pos: [-54, -16],
    intro: 'Where it started — Computer Science.',
    points: [
      "Associate's Degree, Computer Science",
      "Dean's List, 2014–2017",
      'Phi Theta Kappa Honor Society',
    ],
  },
  {
    id: 'uconn', kind: 'edu',
    sign: 'UConn',
    title: 'Going Deeper',
    period: 'University of Connecticut · 2018',
    accent: 0x6bb8ff,
    pos: [-40, -46],
    intro: '85 credits into Software Engineering.',
    points: [
      '85 credits toward a B.S. in Software Engineering',
      'Then a pivot — not away from tech, but toward building things people actually use.',
    ],
  },
  {
    id: 'lambda', kind: 'edu',
    sign: 'Lambda School',
    title: 'The Data Chapter',
    period: 'Lambda School · Data Science · 2019–2020',
    accent: 0x00d4aa,
    pos: [-8, -57],
    intro: 'Python. TensorFlow. Neural networks.',
    points: [
      'Immersive Data Science program',
      'Computer Science · Statistics · Machine Learning · Data Engineering',
      'Python · TensorFlow · neural network fundamentals',
    ],
  },
  {
    id: 'story', kind: 'work',
    sign: 'Story Squad',
    title: 'Story Squad',
    period: 'Data Science Intern · 2021–2022',
    accent: 0x00d4aa,
    pos: [46, -42],
    intro: 'Shipping ML in production.',
    points: [
      'Trained & deployed a self-hosted neural network for content moderation — preprocessing user-submitted images to filter profane content in a production app',
      'Improved an image-clustering algorithm (Python · TensorFlow · unsupervised learning) to group user artwork into competitive match tiers',
    ],
  },
  {
    id: 'yale', kind: 'work',
    sign: 'Yale',
    title: 'The Proving Ground',
    period: 'Yale University · 2021–2023',
    accent: 0x6bb8ff,
    pos: [61, -12],
    intro: '100+ patients daily. Epic EMR. Zero margin for error.',
    points: [
      'Test Site Coordinator & Site Lead',
      'Operated Epic EMR — testing orders for 100+ patients daily, full protocol compliance',
      'Led site staff through daily operations & real-time issue resolution at peak pandemic demand',
    ],
  },
  {
    id: 'catalyst', kind: 'work',
    sign: 'Veoci · Ops',
    title: 'The Catalyst',
    period: 'Office Manager & IT Coordinator · 2022–2024',
    accent: 0xffb347,
    pos: [61, 14],
    intro: 'Joined Veoci as the person who fixes things.',
    points: [
      'Built no-code forms, asset-management workflows & onboarding tools in Veoci — eliminated 3 manual processes (the first internal automation, which led to the SE role)',
      'Primary IT for a 50+ person org — ~20% lower equipment costs via lifecycle management',
      'Designed company-wide security protocols; managed 10+ vendor relationships',
      "…and realized: this is what I'm supposed to be doing.",
    ],
  },
  {
    id: 'veoci_se', kind: 'hero',
    sign: 'Veoci',
    title: 'Solutions Engineer',
    period: 'Veoci Inc. · 2024–Present',
    accent: 0x9f6aff,
    pos: [44, 36],
    intro: 'A Solutions Engineer who builds products that open new markets — designing, deploying, and expanding automated platform solutions across six verticals.',
    stats: [
      { num: 15, suffix: '+', label: 'n8n Workflows' },
      { num: 30, suffix: '+', label: 'Client Demos' },
      { num: 35, suffix: '%', label: 'Less Manual Entry' },
      { num: 6, suffix: '', label: 'Industry Verticals' },
    ],
    achievements: [
      'Built a custom Travel Registry product for higher-ed — a turnkey solution that opened a new revenue stream',
      'First SE-driven expansion into the utilities vertical — custom solutions from zero',
      'Fortune 10 onsite engagement — led discovery & demos to expand platform footprint',
      'Architected 15+ end-to-end n8n workflows (webhooks, conditional logic, API integrations) — ~35% less manual data entry',
      'Built Archimedes — AI agent orchestration (6 agents, persistent memory, dashboard) cutting PoC cycles by ~2 weeks',
    ],
    skills: ['n8n', 'REST APIs', 'Webhooks', 'Python', 'SQL', 'TensorFlow', 'Veoci', 'Solution Architecture', 'AI Tooling'],
    verticals: ['Aviation', 'Healthcare', 'Higher Ed', 'Enterprise', 'Government', 'Utilities'],
  },
  {
    id: 'contact', kind: 'contact',
    sign: 'Harbor',
    title: "Let's build something.",
    period: 'Brendan Hoss',
    accent: 0xffce6b,
    pos: [12, 43],
    intro: 'The journey so far — and still building. Find me here.',
    email: 'hossbrendan@gmail.com',
    linkedin: 'https://linkedin.com/in/brendan-hoss',
    github: 'https://github.com/Bh0ss',
  },
];

export const byId = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));
