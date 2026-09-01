/**
 * Deterministic small-state PRNG (mulberry32). Every drill run seeds one of
 * these so a "retry seed" reproduces an identical pattern when we want it,
 * and so replays of a run line up with the recorded metrics.
 */
export class Rng {
  private s: number;

  constructor(seed = (Math.random() * 0xffffffff) >>> 0) {
    this.s = seed >>> 0;
  }

  /** [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  int(lo: number, hiExclusive: number): number {
    return Math.floor(this.range(lo, hiExclusive));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length)];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  angle(): number {
    return this.next() * Math.PI * 2;
  }

  /** Approximately normal, mean 0, stdev 1. */
  gauss(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** A point inside a circle, uniformly distributed by area. */
  inCircle(radius: number): { x: number; y: number } {
    const a = this.angle();
    const r = Math.sqrt(this.next()) * radius;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }
}

export const newSeed = (): number => (Math.random() * 0xffffffff) >>> 0;
