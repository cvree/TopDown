/**
 * Deterministic value noise.
 *
 * Every texture, rock scatter and terrain contour in the arena is generated
 * from this at load time, which is why the build ships no image assets and
 * still looks like a place rather than a gradient. Same seed, same rift.
 */

const hash2 = (x: number, y: number, seed: number): number => {
  let h = x * 374761393 + y * 668265263 + seed * 1274126177;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Value noise in [0,1]. Integer lattice, smoothstep interpolation. */
export const value2 = (x: number, y: number, seed = 0): number => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
};

/** Value noise that tiles seamlessly over `period` lattice cells. */
export const valueTiled = (x: number, y: number, period: number, seed = 0): number => {
  const wrap = (v: number) => ((v % period) + period) % period;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const x0 = wrap(xi);
  const y0 = wrap(yi);
  const x1 = wrap(xi + 1);
  const y1 = wrap(yi + 1);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
};

export interface FbmOptions {
  octaves?: number;
  lacunarity?: number;
  gain?: number;
  seed?: number;
  /** When set, the result tiles over this many base-frequency cells. */
  period?: number;
}

/** Fractal brownian motion in [0,1]. */
export const fbm = (x: number, y: number, opts: FbmOptions = {}): number => {
  const octaves = opts.octaves ?? 4;
  const lac = opts.lacunarity ?? 2;
  const gain = opts.gain ?? 0.5;
  const seed = opts.seed ?? 0;
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const v = opts.period
      ? valueTiled(x * freq, y * freq, Math.round(opts.period * freq), seed + o * 101)
      : value2(x * freq, y * freq, seed + o * 101);
    sum += v * amp;
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
};

/**
 * Worley / cellular noise returning the distance to the nearest feature point,
 * normalised to roughly [0,1]. Cracks and stone tiling are built from this.
 */
export const worley = (x: number, y: number, seed = 0, period = 0): number => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const wrap = (v: number) => (period ? ((v % period) + period) % period : v);
  let best = 8;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx;
      const cy = yi + dy;
      const px = cx + hash2(wrap(cx), wrap(cy), seed);
      const py = cy + hash2(wrap(cx), wrap(cy), seed + 7919);
      const d = Math.hypot(px - x, py - y);
      if (d < best) best = d;
    }
  }
  return Math.min(1, best);
};

/**
 * Distance to the nearest *border* between cells (F2 - F1), which is what you
 * actually want for masonry: it is ~0 along every joint and rises toward the
 * middle of each slab. Plain nearest-point distance gives you the opposite —
 * dark blobs at the cell centres.
 */
export const worleyEdge = (x: number, y: number, seed = 0, period = 0): number => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const wrap = (v: number) => (period ? ((v % period) + period) % period : v);
  let f1 = 8;
  let f2 = 8;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx;
      const cy = yi + dy;
      const px = cx + hash2(wrap(cx), wrap(cy), seed);
      const py = cy + hash2(wrap(cx), wrap(cy), seed + 7919);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return Math.min(1, f2 - f1);
};

/** Ridged noise — sharp crests, good for rock strata. */
export const ridge = (x: number, y: number, opts: FbmOptions = {}): number => {
  const v = fbm(x, y, opts);
  return 1 - Math.abs(v * 2 - 1);
};

export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0 || 1));
  return t * t * (3 - 2 * t);
};
