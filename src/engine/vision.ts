import type { Vec2 } from './math';

/**
 * Fog of war.
 *
 * League's map is not dark because it is night. It is dark because *you have
 * not looked*, and the whole macro game grows out of that one fact: you walk
 * to see, you place vision to keep seeing, and the moment an enemy leaves your
 * sight you are guessing rather than reacting. A trainer that hands you every
 * enemy position for free trains a player who never learns to ask where the
 * other four are.
 *
 * So the model here is League's, not a lighting effect:
 *
 *  - **Vision comes from bodies.** Every unit on a team lights a circle around
 *    itself. Nothing else does, which is why walking somewhere is the only way
 *    to learn what is there.
 *  - **Terrain blocks sight.** A wall casts a shadow away from the viewer, and
 *    that shadow is the ambush. Standing on the wrong side of a block is how
 *    you get jumped, and standing on the right side of it is how you leave.
 *  - **Brush conceals.** A body inside a bush is invisible to anyone who is
 *    not also inside it, and sight does not pass *through* a bush from
 *    outside. Brush is the one piece of terrain that is more dangerous the
 *    better you understand it.
 *
 * The field keeps two representations, deliberately: a grid, used for drawing
 * the fog and the minimap, and exact per-point queries used for gameplay. The
 * grid is a picture and may be a cell coarse; a query that decides whether an
 * enemy is allowed to shoot you may not be.
 */

/** An axis-aligned sight blocker. Terrain, or a bush. */
export interface SightBlocker {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * A bush rather than a rock: it blocks sight for anyone standing outside it
   * and is transparent to anyone standing inside it.
   */
  brush?: boolean;
}

/** One eye on the map: a body, or something a body left behind. */
export interface VisionSource {
  x: number;
  y: number;
  radius: number;
}

/**
 * Grid resolution, in world units.
 *
 * Fine enough that a wall's shadow has a recognisable edge at this camera
 * distance, coarse enough that a full refresh of a 1660×960 arena is a few
 * thousand cells rather than a hundred thousand.
 */
export const VISION_CELL = 40;

/**
 * Rays cast per source when carving its shadow.
 *
 * At the champion's sight radius this puts one ray every ~45 units of arc,
 * which is one grid cell — past that the extra rays are resolving detail the
 * grid cannot hold anyway.
 */
const RAYS = 192;

/** How fast a cell brightens and dims, in units of "per second". */
const LIGHT_RISE = 9;
const LIGHT_FALL = 3.4;

/** Softening at the edge of a vision circle, in world units. */
const EDGE = 90;

/**
 * How far outside a bush you can still be seen by someone inside it.
 *
 * League's rule is exact adjacency; a small margin here does the same job
 * without making the boundary feel like a bug when a champion's body is half
 * in and half out.
 */
const BRUSH_REACH = 30;

const inRect = (x: number, y: number, b: SightBlocker, grow = 0): boolean =>
  x >= b.x - b.w / 2 - grow && x <= b.x + b.w / 2 + grow && y >= b.y - b.h / 2 - grow && y <= b.y + b.h / 2 + grow;

/**
 * Distance along a ray to an axis-aligned box, or -1 for a miss, plus the
 * distance at which it leaves again.
 *
 * Both numbers are used, for different jobs. Gameplay asks where sight is
 * *broken*, which is where the ray enters. Drawing asks how far the light
 * reaches, which is where it leaves — because a wall you are standing against
 * is lit in League, and only the ground behind it is dark. Shading terrain
 * from its near face instead turns every block into a black bar with its own
 * shadow painted on the front of it.
 */
const rayBoxExit = (ox: number, oy: number, dx: number, dy: number, b: SightBlocker): number => {
  const t = rayBoxSpan(ox, oy, dx, dy, b);
  return t ? t[1] : -1;
};

const rayBox = (ox: number, oy: number, dx: number, dy: number, b: SightBlocker): number => {
  const t = rayBoxSpan(ox, oy, dx, dy, b);
  return t ? t[0] : -1;
};

/** The slab test, same one the world uses for terrain collision. */
const rayBoxSpan = (ox: number, oy: number, dx: number, dy: number, b: SightBlocker): [number, number] | null => {
  const minX = b.x - b.w / 2;
  const maxX = b.x + b.w / 2;
  const minY = b.y - b.h / 2;
  const maxY = b.y + b.h / 2;
  let t0 = 0;
  let t1 = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (ox < minX || ox > maxX) return null;
  } else {
    let ta = (minX - ox) / dx;
    let tb = (maxX - ox) / dx;
    if (ta > tb) {
      const s = ta;
      ta = tb;
      tb = s;
    }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < minY || oy > maxY) return null;
  } else {
    let ta = (minY - oy) / dy;
    let tb = (maxY - oy) / dy;
    if (ta > tb) {
      const s = ta;
      ta = tb;
      tb = s;
    }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return [t0, t1];
};

/**
 * Is the straight line between two points clear of terrain?
 *
 * `from` is the eye, which matters: a bush the eye is standing in does not
 * block anything, because you can see out of the bush you are in.
 */
export const sightClear = (from: Vec2, to: Vec2, blockers: readonly SightBlocker[]): boolean => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return true;
  const nx = dx / len;
  const ny = dy / len;
  for (const b of blockers) {
    if (b.brush && inRect(from.x, from.y, b, BRUSH_REACH)) continue;
    const t = rayBox(from.x, from.y, nx, ny, b);
    if (t >= 0 && t < len) return false;
  }
  return true;
};

export class VisionField {
  readonly cols: number;
  readonly rows: number;
  readonly cell = VISION_CELL;
  /**
   * Smoothed brightness per cell, 0..1. This is what the fog shader and the
   * minimap read: a cell snapping between lit and unlit at the simulation's
   * update rate strobes, and a strobing map is one nobody reads.
   */
  readonly light: Float32Array;
  /** The last hard answer, before smoothing. */
  private readonly raw: Float32Array;
  /** Scratch: shadow distance per ray angle, reused across sources. */
  private readonly reach = new Float32Array(RAYS);

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cols = Math.max(1, Math.ceil(width / VISION_CELL) + 1);
    this.rows = Math.max(1, Math.ceil(height / VISION_CELL) + 1);
    this.light = new Float32Array(this.cols * this.rows);
    this.raw = new Float32Array(this.cols * this.rows);
  }

  /**
   * Recompute the grid from a team's eyes.
   *
   * Each source carves its own visible region by casting a fan of rays out to
   * its sight radius, recording where each one stops, and then asking every
   * cell in its bounding box whether it sits inside the fan. That is O(cells)
   * with a table lookup per cell rather than O(cells × walls) of ray tests,
   * which is the difference between a fog that can run every frame and one
   * that cannot.
   */
  update(sources: readonly VisionSource[], blockers: readonly SightBlocker[], dt: number): void {
    this.raw.fill(0);
    for (const s of sources) this.carve(s, blockers);

    // Ease toward the answer. Brightening is nearly immediate — you notice a
    // thing the instant it walks into your sight — and dimming lags, so a
    // shadow closing over a spot you just left reads as the map going quiet
    // rather than as a light switch.
    const up = 1 - Math.exp(-LIGHT_RISE * dt);
    const down = 1 - Math.exp(-LIGHT_FALL * dt);
    for (let i = 0; i < this.light.length; i++) {
      const target = this.raw[i];
      const k = target > this.light[i] ? up : down;
      this.light[i] += (target - this.light[i]) * k;
    }
  }

  /** Fills the grid instantly, with no easing. Used when a run starts. */
  prime(sources: readonly VisionSource[], blockers: readonly SightBlocker[]): void {
    this.raw.fill(0);
    for (const s of sources) this.carve(s, blockers);
    this.light.set(this.raw);
  }

  private carve(s: VisionSource, blockers: readonly SightBlocker[]): void {
    const r = s.radius;
    const from = { x: s.x, y: s.y };
    // Terrain the eye is standing inside — a bush — is transparent to it.
    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let best = r;
      for (const b of blockers) {
        if (b.brush && inRect(from.x, from.y, b, BRUSH_REACH)) continue;
        // Rock is lit up to its far face and dark behind it; a bush is dark
        // from its near face, because the thing you cannot see is what is
        // standing *in* it.
        const t = b.brush ? rayBox(from.x, from.y, dx, dy, b) : rayBoxExit(from.x, from.y, dx, dy, b);
        if (t >= 0 && t < best) best = t;
      }
      this.reach[i] = best;
    }

    const c0 = Math.max(0, Math.floor((s.x - r) / this.cell));
    const c1 = Math.min(this.cols - 1, Math.ceil((s.x + r) / this.cell));
    const r0 = Math.max(0, Math.floor((s.y - r) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.ceil((s.y + r) / this.cell));
    const inv = RAYS / (Math.PI * 2);

    for (let row = r0; row <= r1; row++) {
      const cy = row * this.cell;
      const dy = cy - s.y;
      for (let col = c0; col <= c1; col++) {
        const cx = col * this.cell;
        const dx = cx - s.x;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        let lit: number;
        if (d < this.cell) {
          // The cell you are standing in is always yours: at this distance the
          // ray fan is coarser than the cell and would flicker.
          lit = 1;
        } else {
          let ang = Math.atan2(dy, dx);
          if (ang < 0) ang += Math.PI * 2;
          const fi = ang * inv;
          const i0 = Math.floor(fi) % RAYS;
          const i1 = (i0 + 1) % RAYS;
          // The nearer of the two bracketing rays: erring toward "blocked"
          // keeps a shadow's edge crisp instead of leaking light around it.
          const wall = Math.min(this.reach[i0], this.reach[i1]);
          if (d > wall) continue;
          // Soften only the outer rim of the circle, never the wall edge — a
          // shadow with a gradient in it looks like a rendering artefact.
          lit = Math.min(1, (r - d) / EDGE);
          lit = Math.min(lit, Math.max(0, (wall - d) / 24));
        }
        const idx = row * this.cols + col;
        if (lit > this.raw[idx]) this.raw[idx] = lit;
      }
    }
  }

  /** Smoothed brightness at a world point, 0..1, bilinear across the grid. */
  sample(x: number, y: number): number {
    const fx = Math.max(0, Math.min(this.cols - 1.001, x / this.cell));
    const fy = Math.max(0, Math.min(this.rows - 1.001, y / this.cell));
    const c = Math.floor(fx);
    const r = Math.floor(fy);
    const tx = fx - c;
    const ty = fy - r;
    const i = r * this.cols + c;
    const a = this.light[i];
    const b = this.light[i + 1];
    const cc = this.light[i + this.cols];
    const d = this.light[i + this.cols + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty;
  }
}
