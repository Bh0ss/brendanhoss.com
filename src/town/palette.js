// Shared color language for the town — warm, slightly desaturated New England
// shoreline, tuned toward the painterly Abeto feel. All values are hex ints so
// they drop straight into THREE.Color.

export const SKY = {
  top: 0x6fc8da,      // brighter teal zenith
  horizon: 0xfaf2e2,  // warm cream haze at the horizon
  fog: 0xe7eee6,      // fog blends toward the horizon
};

export const GROUND = {
  grass: 0x93c06a,    // open grass
  green: 0x82b65f,    // the town common (slightly deeper)
  path: 0xdac9a4,     // sandy crushed-stone paths
  sand: 0xe7d8b5,     // shoreline sand
  water: 0x5cc6c2,    // Long Island Sound teal
  waterDeep: 0x3da7a6,
};

export const BUILD = {
  cream: 0xf4ead2,
  white: 0xf9f3e6,
  brick: 0xc77b5b,
  sage: 0xb7c4a6,
  blue: 0xb9cdd6,
  roofTerracotta: 0xbf6049,
  roofSlate: 0x6c7b8a,
  roofDark: 0x47525e,
  trim: 0x5a4636,
};

export const NATURE = {
  trunk: 0x7a5638,
  foliageA: 0x6fae54,
  foliageB: 0x5b9e46,
  foliageC: 0x82bb63,
};

export const CHAR = {
  skin: 0xe8b98f,
  shirt: 0x4a9eff,   // ties back to the site's signature blue
  pants: 0x3a4a63,
  shoes: 0x2c2c33,
  hair: 0x4a3424,
};
