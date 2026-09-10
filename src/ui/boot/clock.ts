import { MILESTONES, type Milestone } from './variants';

/**
 * THE LOADING BAR THAT IS NEVER STUCK.
 *
 * A progress bar has one job and two ways to fail at it, and the trainer had
 * been failing at both:
 *
 *  1. **It lies.** The old bar climbed on a timer to 88% and then sat there
 *     until the arena reported a frame. On a fast machine that is invisible.
 *     On a slow one it is a bar that stops dead two thirds of the way across
 *     and stays there for six seconds, which reads as a hang, not as work.
 *  2. **It freezes.** Everything the boot screen knows arrives on the main
 *     thread, and the main thread is exactly what building an arena blocks.
 *     A bar driven frame by frame from JavaScript stops moving *precisely*
 *     when the machine is at its busiest — the one moment it must not.
 *
 * This model fixes the first. The second is fixed in the component, by
 * handing the compositor a target a second into the future and letting it
 * interpolate through the stall (`projected`), and by the fact that every
 * moving thing on the screen besides the digits is a CSS animation.
 *
 * The model:
 *
 *  - Four real milestones — the client is running, the terrain exists, the
 *    champions exist, the first frame is on the glass — each with a ceiling.
 *    The bar eases toward the ceiling of whatever milestone it is waiting on,
 *    so it is never ahead of the truth.
 *  - **Relief.** If a milestone overstays its welcome, its ceiling starts
 *    drifting toward the next one. A bar that is waiting a long time keeps
 *    moving, slowly, forever — it just never arrives, because it has not.
 *  - It is monotone by construction, frame-rate independent (every step is
 *    `1 - e^(-dt/tau)`, not a fixed increment), and it catches up correctly
 *    after a stall of any length rather than resuming where it was.
 */

/** Where the bar may climb to while waiting on each milestone. */
const CAPS = [0.32, 0.6, 0.85, 1];
/** How eagerly it approaches that ceiling. The last one is a snap, not a climb. */
const TAU = [1.15, 1.35, 1.3, 0.35];
/** How long a milestone may take before its ceiling starts to drift. */
const PATIENCE = 1.6;
/** How fast the drift builds once it starts. */
const RELIEF_TAU = 6.5;
/** How much of the drift is the initial give — the part that feels like easing. */
const RELIEF_SHARE = 0.5;
/**
 * And how much of it is a flat crawl, in bar per second.
 *
 * This term is the whole difference between a bar that stops and a bar that
 * does not. An easing curve — any easing curve — has a rate that tends to
 * zero, so a wait long enough always ends with a number that has not changed
 * in seconds. A linear crawl underneath it does not: one percent a second is
 * slow enough to read as "this is taking a while" and fast enough that the
 * digits never sit still, and it holds that rate for a good twenty seconds
 * before it runs out of room — twice as long as the screen is ever allowed
 * to last.
 */
const CRAWL = 0.01;
/** How far into the next milestone's territory relief may ever reach. */
const RELIEF_CAP = 0.94;

export interface BootRead {
  /** 0..1, monotone. */
  p: number;
  /** What to print. Never 100 until it is genuinely finished. */
  pct: number;
  /** Index into `MILESTONES` of the piece of work currently in flight. */
  level: number;
  /** Seconds since the clock started. */
  elapsed: number;
  /** Seconds the current milestone has been outstanding. */
  waiting: number;
  /** True once the arena is up, the bar is full and the floor has been served. */
  done: boolean;
}

export class BootClock {
  /** Elapsed seconds at which each milestone landed; null while outstanding. */
  readonly marks: (number | null)[] = MILESTONES.map(() => null);
  private p = 0;
  private level = 0;
  private t0: number;
  private levelAt: number;
  private lastT: number;
  private minShow: number;

  constructor(now: number, minShow = 2.5) {
    this.t0 = now;
    this.levelAt = now;
    this.lastT = now;
    this.minShow = minShow;
    // The client is demonstrably running: something constructed this.
    this.marks[0] = 0;
  }

  /**
   * Record a milestone. Landing one implies every milestone before it —
   * a first frame proves the terrain and the champions exist, whether or not
   * anybody said so, and a bar that waits for an announcement it has already
   * been given the evidence for is the stuck bar all over again.
   */
  mark(m: Milestone, now: number): void {
    const idx = MILESTONES.indexOf(m);
    if (idx < 0 || idx <= this.level) return;
    const elapsed = (now - this.t0) / 1000;
    for (let i = this.level; i <= idx; i++) if (this.marks[i] === null) this.marks[i] = elapsed;
    this.level = idx;
    this.levelAt = now;
  }

  /**
   * Give up waiting and let the player in.
   *
   * Not a failure state: the arena finishes arriving behind the client, which
   * is what the whole front end is designed to survive. It is the promise
   * that no machine, however tired, can hold anybody on this screen forever.
   */
  giveUp(now: number): void {
    this.mark('frame', now);
  }

  /** True once every milestone has landed. */
  get complete(): boolean {
    return this.level >= MILESTONES.length - 1;
  }

  /**
   * The ceremony floor, as a ceiling.
   *
   * A cold open has a minimum length — the crest has to finish drawing, the
   * manifest has to tick, the sentence at the bottom has to be readable — and
   * on a machine that has everything in memory the arena is up long before
   * any of that is done. Without this the bar hits 100% in two seconds and
   * then sits there waiting for the theatre, which is precisely the thing a
   * loading bar must never do: a full bar that is still waiting is worse than
   * no bar at all, because it has told you it is finished and then argued.
   *
   * So the floor is not a delay bolted on after the bar; it is one more
   * ceiling over it. On a fast machine it is the *only* thing governing the
   * climb, and the bar reads as a smooth ease-out that arrives exactly as the
   * gate opens. On a slow one it is already satisfied and does nothing.
   */
  private floor(elapsed: number): number {
    if (this.minShow <= 0) return 1;
    const u = Math.min(1, elapsed / this.minShow);
    return 1 - (1 - u) * (1 - u);
  }

  private ceiling(level: number, waiting: number): number {
    const base = CAPS[level];
    if (level >= CAPS.length - 1) return 1;
    const over = waiting - PATIENCE;
    if (over <= 0) return base;
    const gap = CAPS[level + 1] - base;
    const give = gap * RELIEF_SHARE * (1 - Math.exp(-over / RELIEF_TAU)) + over * CRAWL;
    return base + Math.min(gap * RELIEF_CAP, give);
  }

  /** Advance to `now` and read the bar. */
  tick(now: number): BootRead {
    // A stall of any length is caught up in one step, because every term is a
    // function of elapsed time rather than of how many times this was called.
    // Five seconds is the cap: past that the tab was hidden, not busy, and
    // teleporting the bar on the frame somebody looks back at it is worse.
    const dt = Math.min(5, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;
    const waiting = (now - this.levelAt) / 1000;
    const cap = Math.min(this.ceiling(this.level, waiting), this.floor((now - this.t0) / 1000));
    if (cap > this.p) this.p += (cap - this.p) * (1 - Math.exp(-dt / TAU[this.level]));
    // An asymptote never arrives, and the last half a percent of a loading
    // bar is not worth another second of anybody's life. Once the arena is
    // genuinely up and the fill is visually full, it is full.
    if (this.complete && this.p > 0.99) this.p = 1;
    return this.read(now);
  }

  /** Read without advancing. */
  read(now: number): BootRead {
    const elapsed = (now - this.t0) / 1000;
    const waiting = (now - this.levelAt) / 1000;
    const p = Math.min(1, this.p);
    const done = this.complete && p >= 0.99 && elapsed >= this.minShow;
    return {
      p,
      // 99 is a promise, not a rounding: the hundredth percent belongs to the
      // frame that actually exists, and arrives with the gate.
      pct: this.complete && p >= 0.99 ? 100 : Math.min(99, Math.floor(p * 100)),
      level: this.level,
      elapsed,
      waiting,
      done,
    };
  }

  /**
   * Where the bar will be `ahead` seconds from now if nothing else happens.
   *
   * This is the value handed to CSS as a transition target. The compositor
   * runs that transition on its own thread, so when the main thread disappears
   * for half a second building terrain, the bar keeps crawling at exactly the
   * rate it would have crawled anyway — and the next tick sets a fresh target
   * from wherever it actually got to. A stalled machine and a busy one look
   * the same from the outside, which is the whole point.
   */
  projected(now: number, ahead: number): number {
    const waiting = (now - this.levelAt) / 1000 + ahead;
    const cap = Math.min(this.ceiling(this.level, waiting), this.floor((now - this.t0) / 1000 + ahead));
    if (cap <= this.p) return this.p;
    return Math.min(1, this.p + (cap - this.p) * (1 - Math.exp(-ahead / TAU[this.level])));
  }
}
