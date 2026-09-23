import type { AbilitySlot, InputEventKind } from './input';
import type { ViewProjection } from './session';
import type { Vec2 } from './types';

/**
 * THE TAPE — what makes rewind possible.
 *
 * The simulation is deterministic: one seed, a fixed 240 Hz step, and every
 * random number drawn from a seeded generator. Given the same inputs on the
 * same steps it produces the same world, bit for bit. So a run does not need
 * to be *saved* to be rewound — it needs its inputs written down, and the
 * world can be rebuilt from nothing by playing them back.
 *
 * What is written is exactly what the simulation reads, per simulated step:
 *
 *  - the cursor, in world units (drills aim with it, the metrics sample it);
 *  - the held movement direction (WASD);
 *  - every command event, with its screen position already turned into a
 *    world position.
 *
 * That last point is the one that makes it work. A click arrives in screen
 * pixels and the camera turns it into ground — and the camera is not part of
 * the simulation: it shakes, it pans, it is a different size on the next
 * screen. So the conversion happens once, live, as the event is taken, and
 * the tape holds the ground point. The session is then handed an identity
 * projection, live and on replay alike, and never sees a pixel again.
 *
 * Only steps that actually advanced the simulation are written. A paused step,
 * or a countdown step, reads no commands the world acts on, so leaving it out
 * is exact rather than approximate — and the replay does not care how long a
 * player spent on the pause screen.
 */

/** Command events the simulation acts on. Pause, blur, reset and rewind are the shell's. */
const SIM_KINDS: ReadonlySet<InputEventKind['kind']> = new Set([
  'move',
  'attackMove',
  'stop',
  'ability',
  'abilityRelease',
  'centerCamera',
  'cameraLock',
]);

export class Tape {
  /** Four doubles a step: cursor x, y, move x, y. Doubles, because a float would round the cursor and the run would drift. */
  private data = new Float64Array(4 * 4096);
  private events = new Map<number, InputEventKind[]>();
  length = 0;

  push(cursor: Vec2, move: Vec2, events: InputEventKind[]): void {
    if ((this.length + 1) * 4 > this.data.length) {
      const next = new Float64Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const o = this.length * 4;
    this.data[o] = cursor.x;
    this.data[o + 1] = cursor.y;
    this.data[o + 2] = move.x;
    this.data[o + 3] = move.y;
    if (events.length) this.events.set(this.length, events);
    this.length++;
  }

  cursorAt(i: number, out: Vec2): Vec2 {
    out.x = this.data[i * 4];
    out.y = this.data[i * 4 + 1];
    return out;
  }

  moveAt(i: number, out: Vec2): Vec2 {
    out.x = this.data[i * 4 + 2];
    out.y = this.data[i * 4 + 3];
    return out;
  }

  eventsAt(i: number): InputEventKind[] {
    return this.events.get(i) ?? [];
  }

  /** The first `n` steps, as a tape of their own. The original is untouched. */
  slice(n: number): Tape {
    const t = new Tape();
    const len = Math.max(0, Math.min(this.length, Math.floor(n)));
    t.data = new Float64Array(Math.max(4 * 4096, len * 4 * 2));
    t.data.set(this.data.subarray(0, len * 4));
    for (const [i, ev] of this.events) if (i < len) t.events.set(i, ev.map((e) => ({ ...e })));
    t.length = len;
    return t;
  }
}

/** What the tape needs from the live input system. */
export interface LiveInput {
  drain(): InputEventKind[];
  moveVector?(): Vec2;
  readonly armedSlot?: AbilitySlot | null;
  readonly cursor: { x: number; y: number };
}

/**
 * The input the session actually holds: the live one with a recorder on it,
 * or the tape playing back.
 *
 * `begin` and `end` bracket each simulated step. Live, `begin` reads the
 * cursor and the held direction and `drain` converts and keeps every event;
 * `end` writes the step if the world moved. On replay the same three calls
 * serve the step's recorded inputs instead.
 */
export class TapeInput {
  private pending: InputEventKind[] = [];
  private cursor: Vec2 = { x: 0, y: 0 };
  private move: Vec2 = { x: 0, y: 0 };
  private at = -1;

  constructor(
    readonly tape: Tape,
    private live: LiveInput | null,
    /** Pixels to ground, for live events. Only ever the real camera. */
    private toWorld: ((x: number, y: number) => Vec2) | null,
  ) {}

  /** Stop replaying and start listening. Recording carries on from where the tape ends. */
  goLive(live: LiveInput, toWorld: (x: number, y: number) => Vec2): void {
    this.live = live;
    this.toWorld = toWorld;
    this.at = -1;
  }

  get replaying(): boolean {
    return this.live === null;
  }

  /**
   * Before a live step: the cursor the step will see, already in world units
   * (the shell turns the pointer into ground; the test harness aims directly).
   */
  beginLive(cursorWorld: Vec2): Vec2 {
    this.pending = [];
    this.cursor = { x: cursorWorld.x, y: cursorWorld.y };
    const v = this.live?.moveVector?.() ?? { x: 0, y: 0 };
    this.move = { x: v.x, y: v.y };
    return this.cursor;
  }

  /** Before a replayed step: serve step `i` of the tape, or nothing at all for `-1`. */
  beginReplay(i: number): Vec2 {
    this.pending = [];
    this.at = i;
    if (i >= 0 && i < this.tape.length) {
      this.tape.cursorAt(i, this.cursor);
      this.tape.moveAt(i, this.move);
    } else {
      this.move = { x: 0, y: 0 };
    }
    return { x: this.cursor.x, y: this.cursor.y };
  }

  /** Called after a step, with whether the simulation advanced. */
  end(advanced: boolean): void {
    if (this.live === null || !advanced) return;
    this.tape.push(this.cursor, this.move, this.pending.filter((e) => SIM_KINDS.has(e.kind)));
  }

  // ------------------------------------------------ the InputSystem surface

  drain(): InputEventKind[] {
    if (this.live === null) return this.at >= 0 && this.at < this.tape.length ? this.tape.eventsAt(this.at).map((e) => ({ ...e })) : [];
    const raw = this.live.drain();
    const out = raw.map((e): InputEventKind => {
      if (!('x' in e) || !this.toWorld) return e;
      const w = this.toWorld(e.x, e.y);
      return { ...e, x: w.x, y: w.y };
    });
    this.pending.push(...out);
    return out;
  }

  moveVector(): Vec2 {
    return this.move;
  }

  get armedSlot(): AbilitySlot | null {
    return this.live?.armedSlot ?? null;
  }
}

/**
 * The projection the session holds.
 *
 * Its `screenToWorld` is the identity, because every event reaching the session
 * through a `TapeInput` is already in world units. The cosmetic calls — the
 * cast pose, the camera kick — go to the real renderer only while live, so a
 * fast-forward through thirty seconds of play does not shake the camera thirty
 * seconds' worth.
 */
export class TapeView implements ViewProjection {
  quiet = false;
  constructor(private readonly real: ViewProjection | null) {}
  screenToWorld(x: number, y: number): Vec2 {
    return { x, y };
  }
  panAt(p: Vec2): number {
    return this.real?.panAt?.(p) ?? 0;
  }
  castPose(id: number): void {
    if (!this.quiet) this.real?.castPose?.(id);
  }
  cameraKick(angle: number, amount: number): void {
    if (!this.quiet) this.real?.cameraKick?.(angle, amount);
  }
  recenterCamera(): void {
    if (!this.quiet) this.real?.recenterCamera?.();
  }
  toggleCameraLock(): boolean {
    return this.real?.toggleCameraLock?.() ?? true;
  }
}

/** The part of a session a replay drives. Structural, so the harness can use it too. */
export interface Replayable {
  phase: string;
  elapsed: number;
  cursorWorld: Vec2;
  step(dt: number): void;
  world: { fogIdle: boolean };
}

/**
 * Rebuild a run: play the countdown with no hands on it, then the first
 * `steps` recorded steps of the tape, exactly as they were played.
 *
 * Returns how many tape steps were actually played — fewer than asked only if
 * the run ended inside them, which a rewind never asks for but a corrupt tape
 * could. Throws nothing: a replay that diverged is still a playable run.
 */
export const replayInto = (session: Replayable, input: TapeInput, steps: number, dt: number): number => {
  let guard = 0;
  session.world.fogIdle = true;
  while (session.phase === 'countdown' && guard++ < 100_000) {
    session.cursorWorld = input.beginReplay(-1);
    session.step(dt);
  }
  const n = Math.min(steps, input.tape.length);
  let i = 0;
  for (; i < n; i++) {
    if (session.phase === 'ended') break;
    session.cursorWorld = input.beginReplay(i);
    session.step(dt);
  }
  session.world.fogIdle = false;
  return i;
};

/**
 * The same rebuild, a slice at a time.
 *
 * A rewind late in a ten-minute lane replays several minutes of simulation,
 * which is seconds of work — too long to do in one frame without the page
 * freezing. So the client asks for a few milliseconds of it per frame and draws
 * a progress bar in between; the headless harness uses `replayInto` instead.
 */
export class Replayer {
  private i = 0;
  private counting = true;
  private readonly n: number;
  constructor(
    private readonly session: Replayable,
    private readonly input: TapeInput,
    steps: number,
    private readonly dt: number,
  ) {
    this.n = Math.min(steps, input.tape.length);
    session.world.fogIdle = true;
  }

  get progress(): number {
    return this.n === 0 ? 1 : this.i / this.n;
  }

  /** Replay for up to `budgetMs`. True once the rebuild is complete. */
  advance(budgetMs: number): boolean {
    const until = performance.now() + budgetMs;
    let guard = 0;
    while (this.counting) {
      if (this.session.phase !== 'countdown' || guard++ > 100_000) {
        this.counting = false;
        break;
      }
      this.session.cursorWorld = this.input.beginReplay(-1);
      this.session.step(this.dt);
    }
    while (this.i < this.n) {
      if (this.session.phase === 'ended') {
        this.i = this.n;
        break;
      }
      this.session.cursorWorld = this.input.beginReplay(this.i);
      this.session.step(this.dt);
      this.i++;
      if ((this.i & 63) === 0 && performance.now() > until) return false;
    }
    this.session.world.fogIdle = false;
    return true;
  }
}

/** Steps a rewind goes back, at the simulation's fixed rate. */
export const REWIND_SECONDS = 3;
export const REWIND_LONG_SECONDS = 10;
