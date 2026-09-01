/** Small, allocation-conscious math helpers used by the simulation. */

export interface Vec2 {
  x: number;
  y: number;
}

export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent exponential smoothing. `speed` is per-second. */
export const damp = (a: number, b: number, speed: number, dt: number): number =>
  b + (a - b) * Math.exp(-speed * dt);

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

export const dist2 = (a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
};

export const len = (x: number, y: number): number => Math.hypot(x, y);

export const norm = (x: number, y: number): Vec2 => {
  const l = Math.hypot(x, y);
  return l < 1e-6 ? { x: 0, y: 0 } : { x: x / l, y: y / l };
};

export const angleBetween = (a: Vec2, b: Vec2): number => Math.atan2(b.y - a.y, b.x - a.x);

/** Shortest signed difference between two angles, in (-PI, PI]. */
export const angleDelta = (from: number, to: number): number => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export const lerpAngle = (from: number, to: number, t: number): number =>
  from + angleDelta(from, to) * t;

/** Distance from point p to segment ab. Used for line-shaped skillshots. */
export const distToSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
};

export const smoothstep = (t: number): number => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeOutQuint = (t: number): number => 1 - Math.pow(1 - clamp(t, 0, 1), 5);
export const easeInOutCubic = (t: number): number => {
  const c = clamp(t, 0, 1);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};
export const easeOutBack = (t: number): number => {
  const c = clamp(t, 0, 1);
  const s = 1.70158;
  return 1 + (s + 1) * Math.pow(c - 1, 3) + s * Math.pow(c - 1, 2);
};

/** Maps v from [inLo,inHi] to [outLo,outHi], clamped. */
export const remap = (
  v: number,
  inLo: number,
  inHi: number,
  outLo: number,
  outHi: number,
): number => {
  if (inHi === inLo) return outLo;
  return clamp(outLo + ((v - inLo) / (inHi - inLo)) * (outHi - outLo), Math.min(outLo, outHi), Math.max(outLo, outHi));
};

export const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

export const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const stdev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
};

export const percentile = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = clamp(p, 0, 1) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? s[lo] : lerp(s[lo], s[hi], idx - lo);
};
