import { clamp } from '../../engine/math';
import { APM_LEVELS, levelDifficulty } from '../../progression/apmladder';

/**
 * THE TIDE — the floor that comes up to meet your hands.
 *
 * Every other run in this client is played at a difficulty somebody chose
 * before it started: the ladder's rung in the lab, the opponent in the lane,
 * the adaptive figure everywhere else. That is right for a rep, because a rep
 * is only comparable with the last one if nothing moved underneath it.
 *
 * The infinite run is not a rep. It has no clock and no rung — it opens
 * wherever the menu was pointing and then spends the whole run looking for the
 * level at which you are *just* holding on, by the only method that can
 * possibly find it: turning the floor up while you are winning and down while
 * you are drowning, until the two cancel out. Where it settles is the answer,
 * and the answer is the score.
 *
 * Two halves decide which way it moves, because either one alone is a mode you
 * can cheat:
 *
 *  - **Form** — a trailing read of how much of what you did was correct.
 *    Fed by the engine's four verbs, so a held prompt counts as much as a
 *    pressed one and a wasted input costs whether or not it broke anything.
 *    Alone, it would climb forever for somebody playing perfectly and slowly.
 *  - **Pace** — correct actions a minute over the last dozen seconds, against
 *    the rate a strong run holds in this mode. Alone, it would climb forever
 *    for somebody mashing a mode that happens to accept mashing.
 *
 * Between them they answer the only question the tide is allowed to ask: is
 * this person still comfortably inside it. Above the band the floor rises;
 * below it the floor falls, and it falls half again as fast as it rises,
 * because a player who is drowning wants relief now and a player who is
 * cruising can afford to wait a few seconds for the next rung.
 */

export interface TideOpts {
  /** The rung the run opens on — whatever the menu was showing. */
  openAt: number;
  /** Correct actions a minute a strong run holds in this mode. */
  targetRate: number;
}

/** A rung boundary crossed, for the arena to announce. */
export interface TideCrossing {
  level: number;
  up: boolean;
}

/**
 * Seconds before the floor is allowed to move at all.
 *
 * Long enough for the first prompts to have been answered, because the first
 * two seconds of any mode are a player finding the pads and would otherwise
 * read as drowning and drop a rung nobody had failed at.
 */
const WARMUP = 4;

/** How much of one event the trailing read of your form takes on. */
const FORM_ALPHA = 0.16;

/** The window the pace half is read over. */
const PACE_WINDOW = 12;

/**
 * The band the tide holds you in.
 *
 * The same shape as the adaptive system's own target band, and for the same
 * reason: a run that is going *well* is one you are winning about three
 * quarters of, and anything cleaner than that is a rung you have outgrown.
 */
const BAND: [number, number] = [0.62, 0.82];

/** How far past the band counts as "as well as it gets", either way. */
const CLIMB_SPAN = 0.16;
const FALL_SPAN = 0.34;

/** Rungs a second at the extremes. Falling is faster than climbing on purpose. */
const CLIMB_RATE = 0.135;
const FALL_RATE = 0.23;

export class Tide {
  private lvl: number;
  private readonly openedAt: number;
  private readonly targetRate: number;

  /** Trailing form, 0..1. Opens at the middle of the band, so nothing moves early. */
  private form = 0.72;
  /** Run-seconds of every correct *action*, for the pace half. */
  private acts: number[] = [];

  private t = 0;
  /** Seconds the floor has been live, and the rung integrated over them. */
  private lived = 0;
  private heldSum = 0;

  private peakLvl: number;
  private lowLvl: number;
  private shown: number;
  private crossing: TideCrossing | null = null;
  private climbs = 0;
  private slips = 0;

  constructor(opts: TideOpts) {
    this.lvl = clamp(opts.openAt, 1, APM_LEVELS);
    this.openedAt = this.lvl;
    // A mode with no target rate would divide by zero and read as infinitely
    // fast, which is the one way a tide can get stuck at the top.
    this.targetRate = Math.max(20, opts.targetRate);
    this.peakLvl = this.lvl;
    this.lowLvl = this.lvl;
    this.shown = Math.max(1, Math.floor(this.lvl));
  }

  // ------------------------------------------------------------------ state

  /** Where the floor is, continuously. */
  get level(): number {
    return this.lvl;
  }

  /** What the modes actually read. */
  get difficulty(): number {
    return levelDifficulty(this.lvl);
  }

  get opened(): number {
    return this.openedAt;
  }

  get peak(): number {
    return this.peakLvl;
  }

  get low(): number {
    return this.lowLvl;
  }

  /** The whole rung the HUD prints, hysteresis included. */
  get rung(): number {
    return this.shown;
  }

  /** How many boundaries were crossed, each way. */
  get gained(): number {
    return this.climbs;
  }

  get lost(): number {
    return this.slips;
  }

  /**
   * The rung the run actually stood on: the length-weighted mean of the floor
   * over everything after the warm-up.
   *
   * Not the peak, which is a moment, and not the finish, which is wherever the
   * player happened to stop. A run that spent four minutes at seven and ten
   * seconds at eight held seven, and saying otherwise would make the record
   * a matter of quitting at the right instant.
   */
  get settled(): number {
    return this.lived > 0.5 ? this.heldSum / this.lived : this.lvl;
  }

  /** Which way the floor is going right now, -1..1, for the HUD's arrow. */
  get drift(): number {
    const d = this.drive;
    if (d > BAND[1]) return clamp((d - BAND[1]) / CLIMB_SPAN, 0, 1);
    if (d < BAND[0]) return -clamp((BAND[0] - d) / FALL_SPAN, 0, 1);
    return 0;
  }

  /** How well it thinks you are doing, 0..1. Above the band it climbs. */
  get drive(): number {
    return clamp(this.form * 0.62 + this.pace() * 0.38, 0, 1);
  }

  // ----------------------------------------------------------------- events

  /**
   * A correct command.
   *
   * `action` is false for the prompts you were right to leave alone and for
   * the payoffs that arrive without an input: both are correct play and
   * neither is a keystroke, so they move form and never pace — exactly the
   * split the engine already makes between `hold()` and `hit()`.
   */
  good(at: number, action: boolean): void {
    this.blend(1, 1);
    if (action) this.acts.push(at);
  }

  /** A wrong, late or wasted command. `weight` is what it is worth. */
  bad(weight = 1): void {
    this.blend(0, weight);
  }

  private blend(to: number, weight: number): void {
    // One event of weight w is w events of weight one, compounded — so a
    // fumble moves the read further than a stray without needing a second
    // constant to disagree with the first.
    const a = 1 - Math.pow(1 - FORM_ALPHA, clamp(weight, 0.2, 4));
    this.form += (to - this.form) * a;
  }

  private pace(): number {
    const from = this.t - PACE_WINDOW;
    while (this.acts.length > 0 && this.acts[0] < from) this.acts.shift();
    // Early in a run the window has not filled, so it is measured over what
    // there has been rather than over twelve seconds that have not happened.
    const span = Math.min(PACE_WINDOW, Math.max(3, this.t));
    const rate = (this.acts.length / span) * 60;
    // Faster than par is capped: a mode you are outrunning is a mode the floor
    // should rise under, and by how much you are outrunning it is not the
    // question — the next rung will ask again in a few seconds anyway.
    return clamp(rate / this.targetRate, 0, 1.15);
  }

  // ------------------------------------------------------------------ frame

  step(dt: number, elapsed: number): void {
    this.t = elapsed;
    if (elapsed < WARMUP) return;
    this.lived += dt;
    this.heldSum += this.lvl * dt;

    const v = this.drift * (this.drift > 0 ? CLIMB_RATE : FALL_RATE);
    if (v === 0) return;

    const before = this.lvl;
    this.lvl = clamp(this.lvl + v * dt, 1, APM_LEVELS);
    if (this.lvl === before) return;
    this.peakLvl = Math.max(this.peakLvl, this.lvl);
    this.lowLvl = Math.min(this.lowLvl, this.lvl);

    // Whole rungs, with a little hysteresis on the way down, so a floor
    // hovering on a boundary announces itself once rather than nine times.
    const want = clamp(Math.floor(this.lvl + 1e-9), 1, APM_LEVELS);
    if (want > this.shown) {
      this.shown = want;
      this.climbs++;
      this.crossing = { level: want, up: true };
    } else if (want < this.shown && this.lvl <= this.shown - 0.12) {
      this.shown = want;
      this.slips++;
      this.crossing = { level: want, up: false };
    }
  }

  /** The rung change nobody has been told about yet, if there is one. */
  takeCrossing(): TideCrossing | null {
    const c = this.crossing;
    this.crossing = null;
    return c;
  }
}
