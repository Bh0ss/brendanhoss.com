// One lawn colour field, shared by the terrain's grass layer and the grass blades, so a blade's
// root is exactly the colour of the ground it grows from: gaps between blades never read as
// bare dirt, and the blades only add fuzz and tip highlights on top.
//
// Colours are LINEAR albedo (they multiply into lit materials). Summer New England lawn: a
// mid green with broad hue/value drift, occasional dry straw patches, and a drier, yellower
// cast wherever the caller passes `dry` (beach margin, path edges).
//
// Hash is sin-free (Dave Hoskins' hash12): sin() of large world coordinates quantises on some
// mobile GPUs and ANGLE fast-math, which shows up as square cells.
export const LAWN_GLSL = /* glsl */`
  float lwHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float lwNoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);          // quintic: no grid creases
    return mix(mix(lwHash(i), lwHash(i + vec2(1.0, 0.0)), u.x), mix(lwHash(i + vec2(0.0, 1.0)), lwHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // two octaves, the second rotated so the lattice never lines up with the world axes
  float lwFbm(vec2 p){ return lwNoise(p) * 0.62 + lwNoise(mat2(0.8, -0.6, 0.6, 0.8) * p * 2.07 + 11.3) * 0.38; }
  const vec3 LW_DEEP  = vec3(0.052, 0.105, 0.030);   // #405a30  shaded summer green
  const vec3 LW_FRESH = vec3(0.112, 0.195, 0.045);   // #5e7a3c  fresh mown green
  const vec3 LW_STRAW = vec3(0.235, 0.205, 0.090);   // #857c54  dry patch / dune
  vec3 lawnCol(vec2 xz, float dry){
    float broad = lwFbm(xz * 0.055);
    float mid = lwFbm(xz * 0.21 + 7.0);
    vec3 c = mix(LW_DEEP, LW_FRESH, smoothstep(0.28, 0.78, broad));
    c *= mix(0.8, 1.14, mid);
    // a little hue drift: some patches lean blue-green (clover), some yellow-green
    float hue = lwNoise(xz * 0.13 + 31.0) - 0.5;
    c *= vec3(1.0 + hue * 0.22, 1.0, 1.0 - hue * 0.35);
    // mowing stripes: ~1.3 m passes, +-4% value, fading out where the lawn turns dry
    float stripe = smoothstep(-0.35, 0.35, sin(dot(xz, vec2(0.23, 0.97)) * 1.35));
    c *= 1.0 + (stripe * 2.0 - 1.0) * 0.04 * (1.0 - clamp(dry * 2.5, 0.0, 1.0));
    // dry patches: sparse, soft-edged, never dominant
    float patchy = smoothstep(0.66, 0.86, lwFbm(xz * 0.09 + 53.0)) * 0.45;
    c = mix(c, LW_STRAW, clamp(patchy + dry, 0.0, 0.85));
    return c;
  }
`;

// JS twin of lawnCol() (same hash, noise, constants), evaluated once per grass tuft at build time
// so the blade vertex shader doesn't re-run ~8 noise lookups per vertex every frame.
const fr = (x) => x - Math.floor(x);
function lwHash(x, y) {
  let a = fr(x * 0.1031), b = fr(y * 0.1031), c = fr(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fr((a + b) * c);
}
function lwNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = lwHash(ix, iy), b = lwHash(ix + 1, iy), c = lwHash(ix, iy + 1), d = lwHash(ix + 1, iy + 1);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}
function lwFbm(x, y) {
  // GLSL mat2(0.8,-0.6,0.6,0.8) is column-major: (0.8x + 0.6y, -0.6x + 0.8y)
  const rx = 0.8 * x + 0.6 * y, ry = -0.6 * x + 0.8 * y;
  return lwNoise(x, y) * 0.62 + lwNoise(rx * 2.07 + 11.3, ry * 2.07 + 11.3) * 0.38;
}
const ssj = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const DEEP = [0.052, 0.105, 0.030], FRESH = [0.112, 0.195, 0.045], STRAW = [0.235, 0.205, 0.090];
export function lawnColJS(x, z, dry, out = [0, 0, 0]) {
  const broad = lwFbm(x * 0.055, z * 0.055);
  const mid = lwFbm(x * 0.21 + 7, z * 0.21 + 7);
  const k = ssj(0.28, 0.78, broad), m = 0.8 + 0.34 * mid;
  const hue = lwNoise(x * 0.13 + 31, z * 0.13 + 31) - 0.5;
  const hm = [1 + hue * 0.22, 1, 1 - hue * 0.35];
  const stripe = ssj(-0.35, 0.35, Math.sin((x * 0.23 + z * 0.97) * 1.35));
  const st = 1 + (stripe * 2 - 1) * 0.04 * (1 - Math.min(1, Math.max(0, dry * 2.5)));
  const patchy = ssj(0.66, 0.86, lwFbm(x * 0.09 + 53, z * 0.09 + 53)) * 0.45;
  const w = Math.min(0.85, Math.max(0, patchy + dry));
  for (let i = 0; i < 3; i++) {
    const c = (DEEP[i] + (FRESH[i] - DEEP[i]) * k) * m * hm[i] * st;
    out[i] = c + (STRAW[i] - c) * w;
  }
  return out;
}
