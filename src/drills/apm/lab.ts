import { shortCodeLabel, type AbilitySlot } from '../../engine/input';
import type { MapBoard } from '../../engine/mapboard';
import { clamp } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { AbilityView } from '../../engine/session';
import type { Actor, Vec2 } from '../../engine/types';
import type { KeyMetric } from '../../progression/profile';
import { difficultyLevel } from '../../progression/apmladder';
import { pct } from '../base';
import { ApmDrill, KeyCooldowns } from './engine';
import { benchPair, benchSlots, mapAtLevel, ORDER_LABEL, type LabOrder } from './keyladder';
import { MAP_KEYS, MapDodge } from './map';
import { PadMotion, type Drift } from './motion';
import { OrderLine } from './orders';

/**
 * THE CONSOLE — the surface every lab mode is built on.
 *
 * There is no champion here, nothing to kill and nowhere to be. What the modes
 * share is a bench: a handful of pads laid out on the floor, each one either a
 * key under your left hand or a place the cursor has to land, and a small
 * vocabulary for lighting them, barring them, timing them and reading what you
 * did about it. A mode written against this file is nearly all rule and almost
 * no scaffolding, which is the point — the rules are the interesting part and
 * they should be short enough to read in one sitting.
 *
 * Three decisions are worth stating outright, because everything else follows.
 *
 * *The pads are not units.* They are geometry drawn on the floor and hit-
 * tested in this file. The trainer used to spawn a champion-shaped body with a
 * health bar for every click target, which meant the "abstract" modes were
 * still full of things that looked like the game and behaved like the game.
 * A pad has a position and a radius and nothing else.
 *
 * *The body is an anchor, not a character.* Most modes bolt it down, strip its
 * health and hide it outright, so the arena reads as a bench rather than as a
 * fight nobody turned up to. The exception is the one mode about movement
 * commands, which needs something to steer.
 *
 * *Nothing stands still.* Every pad a mode builds is handed to the motion
 * field the moment it is built, so a bench is a formation of moving circles
 * rather than a diagram, and the field swings wider and runs faster with the
 * rung — and only with the rung. Two hands are being measured on this floor
 * and the eyes were being let off entirely; they are not any more.
 *
 * And two things that are not on this floor at all, both wired in here so that
 * no mode ever has to know they exist.
 *
 * *The board in the corner.* On level four and above the minimap runs a
 * two-lane dodge for the whole of every mode, on the two summoner keys. Below
 * level four there is no board — the bottom of the ladder is for learning what
 * a bench asks, and a second screen asking a second question is the wrong
 * first lesson. See `map.ts`.
 *
 * *The order line.* Along the bottom of the floor, from level five up, a strip
 * that asks for the three commands that are not abilities at all: move here,
 * attack-move here, stop. They arrive one rung at a time. See `orders.ts`.
 *
 * Both are entries in one table — the key ladder in `keyladder.ts` — which is
 * the answer to a question the section could not previously answer: what does
 * a *level* change, besides the speed. It changes how much of your keyboard is
 * in play. Rung one is two fingers. By the top every command the bench can
 * grade is being asked for, and a bench reads its own share of that ladder
 * through `useSlots` below rather than hard-coding a row of four.
 */

/** Which shape your hand is in to reach a key. */
export type Bank = 'near' | 'far' | 'mouse' | 'map';

/**
 * The bank a slot lives in.
 *
 * Two fingers rest, two stretch, and the summoner pair is not on this floor at
 * all any more — it belongs to the board in the corner, in every mode, which
 * is why it is a bank of its own rather than the far end of this one.
 */
export const BANK_OF: Record<AbilitySlot, Bank> = {
  q: 'near',
  w: 'near',
  e: 'far',
  r: 'far',
  d: 'map',
  f: 'map',
};

export const BANK_LABEL: Record<Bank, string> = {
  near: 'NEAR BANK',
  far: 'FAR BANK',
  mouse: 'MOUSE',
  map: 'THE MAP',
};

export interface Pad {
  /** The key this pad answers to, or null when the pad wants the cursor. */
  slot: AbilitySlot | null;
  pos: Vec2;
  radius: number;
}

/**
 * What a perfect player would do at this instant.
 *
 * It exists for the headless suite, which has to be able to play thirteen
 * modes correctly without knowing thirteen sets of internals — and it is
 * honest about the modes where the correct thing is to keep your hands still,
 * which is the case a naive "press whatever is lit" harness would score well
 * on and a real player would not.
 */
export interface LabSolution {
  /** Keys to send this instant. More than one means a chord. */
  keys?: AbilitySlot[];
  /** A point to click. */
  click?: Vec2 | null;
  /** A heading to steer or click along, unit length. */
  dir?: Vec2 | null;
  /** True when doing nothing is the correct play right now. */
  wait?: boolean;
  /**
   * Where the cursor has to be for `keys` to count.
   *
   * The bench does not take a key on its own — see `AIM_SLACK` below — so a
   * solution that names keys and does not say where to point them is only half
   * an answer. Null means this mode is not asking the mouse for anything right
   * now, which is the honest answer for the one mode with no pads in it.
   */
  aim?: Vec2 | null;
  /**
   * An order the strip along the bottom wants — a command to the champion
   * rather than a key on the console, so it is its own field and not a key.
   */
  order?: { kind: LabOrder; at: Vec2 | null } | null;
}

/** How a pad is drawn. The colour says what it wants; the shape says when. */
export interface PadStyle {
  color: string;
  /** 0..1 — how lit the face is. */
  glow?: number;
  /** Countdown ring, 1 full to 0 gone. */
  progress?: number;
  /** What is printed on it. Defaults to the key's own glyph. */
  text?: string;
  /** A caption under the glyph. */
  sub?: string;
  /** Struck through: this pad is barred and must be left alone. */
  barred?: boolean;
}

export abstract class LabDrill extends ApmDrill {
  /** The body the camera and the flow ring hang off. Not a character. */
  protected anchor!: Actor;
  protected keys = new KeyCooldowns();
  /** The field that keeps every pad in the mode travelling. */
  protected motion!: PadMotion;
  /**
   * The board in the bottom-right corner. Every mode runs one — from level
   * four up.
   */
  protected map!: MapDodge;
  /** The strip along the bottom. Every mode runs one — from level five up. */
  protected orderLine!: OrderLine;

  /** Presses that were pointed at the pad that wanted them, and presses that were not. */
  private onPad = 0;
  private offPad = 0;

  /**
   * The keys this bench is actually asking for at this rung.
   *
   * Filled in by `useSlots`, and read by the ability bar so that a key the
   * ladder has not handed over yet is drawn locked rather than drawn as a
   * finger nothing is going to ask for.
   */
  protected slots: AbilitySlot[] = [];

  /**
   * Whether the board is running.
   *
   * The lowest three rungs of every bench are a single question: what does
   * this mode want from my hands. Divided attention is a second question, and
   * a player who cannot yet answer the first one is not learning to look at
   * the map — they are losing a chain to something they never had the
   * attention to spare for.
   *
   * It latches on rather than tracking the floor both ways, because INFINITE
   * moves the rung continuously and a board that appeared and vanished every
   * time the tide crossed four would be worse than either answer.
   */
  private mapOn = false;

  /** Set by a mode that needs a driveable body rather than a bench. */
  protected mobile(): boolean {
    return false;
  }

  /** Per-mode construction, once the bench exists. */
  protected abstract build(): void;

  /**
   * What a perfect player would do about *this mode* right now.
   *
   * The board is not a mode's business: `solution()` folds it in on top, so a
   * mode answers for its own bench and nothing else.
   */
  protected abstract modeSolution(): LabSolution;

  /**
   * The mode's answer to a key.
   *
   * The two summoner keys never arrive here — they belong to the board — so a
   * mode can treat every key it is handed as one of its own.
   */
  protected abstract onKey(slot: AbilitySlot, at: Vec2): void;

  /**
   * How hard this mode runs the board. One is the standard load; a mode about
   * divided attention turns it up rather than inventing a second one.
   */
  protected mapPressure(): number {
    return 1;
  }

  /**
   * THE PADS THE CURSOR MAY BE RESTING ON RIGHT NOW.
   *
   * The bench used to be a keyboard test with circles drawn on it. The circles
   * were where the prompt *was*, and they were nothing else: a player could
   * put the mouse in a corner, never move it again, and answer thirteen modes
   * at full rate for a minute. That is not a trainer, it is a typing exercise
   * with a lightshow — and it trains the one habit the whole client exists to
   * break, which is producing inputs without aiming them.
   *
   * So a pad has to be *pointed at* to be answered. A mode lists the pads that
   * are live this instant and the base class does the rest: a key the bench is
   * asking for, pressed with the cursor somewhere else, is an input that meant
   * nothing — counted, worth nothing, and told so by name.
   *
   * Three things it deliberately is not.
   *
   * It is not a second reaction test. `AIM_SLACK` is generous and every pad on
   * every bench is large; what is being asked is that the hand that is not
   * busy goes where the eyes already are, which is free once it is a habit and
   * impossible to fake.
   *
   * It is not applied to a key the mode did not ask for. Press the wrong key
   * and the mode answers for it — WRONG PAD, BAIT, NOTHING TO CUT — because a
   * wrong key is a different mistake from a wrong aim and the run's own
   * coaching has to be able to tell them apart.
   *
   * And it is not a rule about the *chain*. An off-pad press is a stray: it
   * dents a streak and never ends one, which is the same verdict the engine
   * gives every other input that was real and bought nothing.
   *
   * An empty list means this mode is not asking the mouse for anything —
   * VECTOR, whose whole answer is a heading and which has no pads at all.
   */
  protected aimPads(): readonly Pad[] {
    return [];
  }

  /** Whether the bench is asking for this key at this instant. */
  private wantsKey(slot: AbilitySlot): boolean {
    const s = this.modeSolution();
    return !s.wait && (s.keys?.includes(slot) ?? false);
  }

  /** The live pad the cursor is inside, or null. */
  protected aimedPad(at: Vec2 = this.s.cursorWorld): Pad | null {
    for (const pad of this.aimPads()) {
      if (Math.hypot(at.x - pad.pos.x, at.y - pad.pos.y) <= pad.radius + AIM_SLACK) return pad;
    }
    return null;
  }

  /**
   * Whether a press of this key, made from here, is pointed at anything.
   *
   * True whenever the mode is not asking for the key — the mode owns that
   * mistake — and true whenever the mode has no pads to point at.
   */
  private aimed(slot: AbilitySlot, at: Vec2): boolean {
    if (this.aimPads().length === 0) return true;
    if (!this.wantsKey(slot)) return true;
    return this.aimedPad(at) !== null;
  }

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w / 2, y: h * 0.52 }, { range: 0, damage: 0 });
    this.anchor = p;
    // A health bar on a bench is a question the mode never answers: nothing
    // here can hurt you. One hit point reads as "no pool" everywhere
    // downstream, so the HUD prints no bar at all.
    p.maxHp = 1;
    p.hp = 1;
    if (!this.mobile()) {
      // Bolted down and not drawn. The console is the only thing on the floor.
      p.moveSpeed = 0;
      p.hidden = true;
    }
    this.motion = new PadMotion(this.s.world.bounds, this.s.rng);
    this.mapOn = mapAtLevel(this.rung);
    this.map = new MapDodge(
      this.s,
      {
        hit: (pos, opts) => this.hit(pos, opts),
        hold: (pos, label) => this.hold(pos, label),
        fumble: (pos, label, opts) => this.fumble(pos, label, opts),
        stray: (pos) => this.stray(pos),
        glyph: (slot) => this.glyph(slot),
        color: () => this.promptColor,
        focus: () => this.mapFocus,
      },
      this.mapPressure(),
    );
    this.orderLine = new OrderLine(
      this.s,
      {
        hit: (pos, opts) => this.hit(pos, opts),
        fumble: (pos, label, opts) => this.fumble(pos, label, opts),
        stray: (pos) => this.stray(pos),
        glyph: (order) => this.orderGlyph(order),
        color: () => this.promptColor,
        difficulty: () => this.d,
      },
      // The rung the *ladder* is on, not the one a streak has pushed the pace
      // to: SURGE moves the pace and never the roster, so a surge run asks for
      // the same commands from its first second to its last.
      () => this.rung,
    );
    this.build();
  }

  // ------------------------------------------------------------ the bench

  protected get centre(): Vec2 {
    const { w, h } = this.s.world.bounds;
    return { x: w / 2, y: h * 0.52 };
  }

  /**
   * Where the board's feedback lands on the floor.
   *
   * The bottom-right corner of the arena, because that is the corner of the
   * screen the board is in: a ring that blooms toward the minimap is a hint
   * about where to look, and one that blooms in the middle of the bench is
   * one more thing competing with the prompt.
   */
  protected get mapFocus(): Vec2 {
    const { w, h } = this.s.world.bounds;
    return { x: w * 0.78, y: h * 0.82 };
  }

  /**
   * The rung being played, continuously.
   *
   * The tide's level while INFINITE is moving the floor, and the level the
   * menu opened otherwise. Read back out of the difficulty rather than passed
   * down, because the difficulty is the one number every run shape agrees on.
   *
   * It deliberately reads the *tide* rather than the live difficulty, which is
   * not the same thing in SURGE: everything the rung decides besides the pace
   * — which keys are in play, whether the board is up, which orders the strip
   * is asking for — is a roster, and a roster that grew a key on a good chain
   * and lost it again on the next break would be a layout changing under the
   * hands using it. SURGE moves the pace. It never moves this.
   */
  protected get rung(): number {
    return this.tideLevel ?? difficultyLevel(this.s.config.difficulty);
  }

  /**
   * A bench's slot vocabulary, cut to what the rung has handed over, and
   * recorded so the ability bar can lock the rest.
   */
  protected useSlots(vocabulary: AbilitySlot[], min = 2): AbilitySlot[] {
    return this.take(benchSlots(vocabulary, this.rung, min));
  }

  /** The two keys a two-pad bench uses at this rung — the widest pair there is. */
  protected usePair(): AbilitySlot[] {
    return this.take(benchPair(this.rung));
  }

  private take(got: AbilitySlot[]): AbilitySlot[] {
    for (const slot of got) if (!this.slots.includes(slot)) this.slots.push(slot);
    return got;
  }

  /** The key a given order is on, as the player has it bound. */
  protected orderGlyph(order: LabOrder): string {
    return shortCodeLabel(this.s.bindings[order].primary);
  }

  /** Whether the board in the corner is part of this run. */
  protected get mapRunning(): boolean {
    return this.mapOn;
  }

  /**
   * The key printed on a pad — the one your hand is actually on.
   *
   * Read from the run's live bindings on every frame that asks, rather than
   * snapshotted when the bench was built. Two reasons, and both of them are
   * the same reason: the bench used to print the *scheme's defaults*, so a
   * player who had moved their ability row was being asked for Q while their
   * Q was on the right mouse button — and settings can be opened from inside a
   * run, so a rebind made on the pause screen has to be on the pads by the
   * time the panel closes.
   */
  protected glyph(slot: AbilitySlot): string {
    return shortCodeLabel(this.s.bindings[slot].primary);
  }

  /**
   * A row of pads across the bench, centred, evenly spaced.
   *
   * The spacing is where the row *starts*. Every pad it builds is put into the
   * motion field, so the row is a formation the pads swim inside rather than a
   * set of positions they sit at.
   */
  protected row(slots: AbilitySlot[], opts: { y?: number; gap?: number; radius?: number } = {}): Pad[] {
    const c = this.centre;
    const gap = opts.gap ?? 190;
    const radius = opts.radius ?? 58;
    const y = opts.y ?? c.y;
    const span = (slots.length - 1) * gap;
    return this.motion.addAll(
      slots.map((slot, i) => ({ slot, pos: { x: c.x - span / 2 + i * gap, y }, radius })),
    );
  }

  /** Pads on a ring around the bench, starting at the top and going clockwise. */
  protected ring(slots: AbilitySlot[], radius: number, padRadius = 54): Pad[] {
    const c = this.centre;
    return this.motion.addAll(
      slots.map((slot, i) => {
        const a = -Math.PI / 2 + (i / slots.length) * Math.PI * 2;
        return {
          slot,
          pos: { x: c.x + Math.cos(a) * radius, y: c.y + Math.sin(a) * radius * 0.62 },
          radius: padRadius,
        };
      }),
    );
  }

  /**
   * Puts a pad the mode built itself into the moving field.
   *
   * `wander` swims around where the pad was built, which is what a bench wants.
   * `free` gives it a heading and bounces it off the arena, which is what a
   * target you are supposed to chase does.
   */
  protected drift(pad: Pad, mode: Drift = 'wander'): Pad {
    return this.motion.add(pad, mode);
  }

  /** Takes a pad back out. A mode that deals and discards has to say so. */
  protected undrift(pad: Pad): void {
    this.motion.forget(pad);
  }

  /** Whichever pad a point lands on, or null. */
  protected padAt(pads: readonly Pad[], at: Vec2): Pad | null {
    let best: Pad | null = null;
    let bd = Infinity;
    for (const p of pads) {
      const d = Math.hypot(at.x - p.pos.x, at.y - p.pos.y);
      if (d <= p.radius + 14 && d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  // -------------------------------------------------------------- the field

  /**
   * How fast the field runs and how far it swings.
   *
   * Both read `d`, which in PLAY is the rung and only the rung: the floor is
   * nearly still for somebody opening level one and genuinely hard to read on
   * level ten, and it is the *same* floor for the whole of a run. It used to
   * speed up with the player's own flow in every mode, which meant a bench
   * that got harder to read precisely as the run got worth protecting — the
   * reward for a good chain was a worse bench, and no two runs at a level were
   * the same level.
   *
   * That behaviour is still in the client and it has a mode: in SURGE the
   * streak is added to `d`, so the field really does run away from you as the
   * chain climbs. Nothing here had to be told about either — one getter.
   */
  protected motionSpeed(): number {
    return 0.5 + this.d * 1.4;
  }

  protected motionSpread(): number {
    return clamp(0.18 + this.d * 0.8, 0, 1);
  }

  // ------------------------------------------------------------- feedback

  /**
   * The press feedback the client hangs off the ability bar.
   *
   * The session watches a slot's cooldown either side of an input and plays
   * the cast — the voice, the ring, the camera shove — only when it moved. So
   * every legal press has to move it, or the bench would answer in silence.
   */
  protected press(slot: AbilitySlot): void {
    this.keys.set(slot, PRESS_CD);
  }

  /**
   * A bench press is a keystroke, not a spell.
   *
   * The session shoves the camera along every cast, which is right in a mode
   * where a cast is an event and wrong here, where there are five or six of
   * them a second for a whole minute. Kept just above nothing so the press
   * still has a body to it.
   */
  castKick(): number {
    return 0.2;
  }

  abilities(): AbilityView[] {
    const active = new Set(this.s.config.abilities);
    const want = new Set(this.expected());
    return (['q', 'w', 'e', 'r', 'd', 'f'] as AbilitySlot[]).map((slot) => ({
      slot,
      // The board owns its two keys in every mode, so the bar says so in every
      // mode rather than leaving them named after whatever the bench calls them.
      name: MAP_KEYS.includes(slot) ? 'MAP' : this.slotName(slot),
      cd: clamp(this.keys.get(slot) / PRESS_CD, 0, 1),
      highlight: want.has(slot),
      // Two ways a key can be dark. The board's pair is dark below the rung
      // the board turns up on, because that screen is not there; a bench key
      // is dark until the rung has handed it over, because the ladder is a
      // roster as well as a pace and a finger nothing will ask for should not
      // be lit as though it might be.
      locked:
        !active.has(slot) ||
        (MAP_KEYS.includes(slot) && !this.mapOn) ||
        (!MAP_KEYS.includes(slot) && this.slots.length > 0 && !this.slots.includes(slot)),
    }));
  }

  /** Slots the mode is asking for right now, for the bar's highlight. */
  protected expected(): AbilitySlot[] {
    const s = this.solution();
    return s.wait ? [] : (s.keys ?? []);
  }

  /** What the bar calls a slot. The lab names benches, not spells. */
  protected slotName(slot: AbilitySlot): string {
    return BANK_OF[slot] === 'near' ? 'NEAR' : BANK_OF[slot] === 'far' ? 'FAR' : 'MAP';
  }

  update(dt: number): void {
    this.keys.tick(dt);
    super.update(dt);
    // The bench moves after the mode has had its frame, so a pad dealt this
    // tick is drawn where it was dealt and starts travelling on the next one.
    this.motion.step(dt, { speed: this.motionSpeed(), spread: this.motionSpread() });
    // INFINITE can climb into the board's half of the ladder mid-run. It is
    // announced when it does, because a second screen that simply turns up is
    // a second screen nobody looks at.
    if (!this.mapOn && mapAtLevel(this.rung)) {
      this.mapOn = true;
      this.s.setBanner('THE MAP IS LIVE', 1.6);
    }
    if (this.mapOn) this.map.update(dt);
    // Same again for the strip along the bottom: INFINITE can climb into an
    // order's half of the ladder mid-run, and an order that simply turned up
    // is an order nobody would look for.
    const gained = this.orderLine.update(dt);
    if (gained) this.s.setBanner(`${ORDER_LABEL[gained]} · ${this.orderGlyph(gained)}`, 1.8);
  }

  /**
   * A key, routed.
   *
   * The summoner pair is the board's in every mode, and the mode never sees
   * it: that is the whole of the arbitration, and it is here rather than in
   * thirteen places.
   */
  onAbility(slot: AbilitySlot, at: Vec2): void {
    // No summoner here, deliberately: the lab has no arena to flash across
    // and it uses both summoner keys as pads. D and F on this bench are two
    // more fingers, not two more spells.
    if (MAP_KEYS.includes(slot)) {
      this.press(slot);
      // With no board running they are two keys with nothing behind them,
      // which is exactly what a stray is: counted, and worth nothing.
      if (this.mapOn) this.map.press(slot);
      else this.stray(at);
      return;
    }
    // The right key, from nowhere in particular. The bench does not take it —
    // see `aimPads` — and it says which of the two things went wrong, because
    // "nothing happened" is the one response that teaches a player to press
    // harder rather than to point.
    if (!this.aimed(slot, at)) {
      this.press(slot);
      this.offPad++;
      const want = this.aimPads()[0];
      // The spray lands on the pad that wanted the press rather than under the
      // cursor: the correction is *go there*, and the feedback should be
      // where the player has to go.
      this.s.micro('CURSOR OFF THE PAD', want?.pos ?? at, PALETTE.warn);
      this.stray(want?.pos ?? at);
      return;
    }
    this.onPad++;
    this.onKey(slot, at);
  }

  /**
   * The mode's answer, with the board's laid over it.
   *
   * An orb about to land on you outranks anything on the bench — it costs the
   * flow tier the bench is building, so it is worth more than the prompt it
   * interrupts — but a heading is left in place, because a movement mode's
   * command is a state rather than an input and dropping it would be a
   * different mistake.
   */
  solution(): LabSolution {
    const base = this.modeSolution();
    const dodge = this.mapOn ? this.map?.solution() : null;
    // The corner outranks everything: an orb about to land costs the whole
    // flow tier. The strip outranks the bench, because a bench prompt renews
    // itself the instant it expires and an order does not. Under both of them
    // a heading is left in place — a movement command is a state rather than
    // an input, and dropping it would be a different mistake.
    // The board's two keys are on the board, not on the bench, so a dodge
    // carries no aim: the cursor is not what answers the corner.
    if (dodge) return { keys: [dodge], dir: base.dir ?? null };
    const order = this.orderLine?.solution() ?? null;
    if (order) return { order, dir: base.dir ?? null };
    // Where to point for the keys the mode just named. A bench answers for its
    // own pads; the rule lives in one place and so does the answer to it.
    return { ...base, aim: base.aim ?? this.aimPads()[0]?.pos ?? null };
  }

  mapBoard(): MapBoard | null {
    return this.mapOn ? this.map?.board() ?? null : null;
  }

  /**
   * The corner is empty, so the client should not draw a minimap into it.
   *
   * A bench has no terrain and no units, so the map of the place you are
   * standing in — which is what the minimap is everywhere else — would be an
   * empty box with a hidden dot in it.
   */
  mapHidden(): boolean {
    return !this.mapOn;
  }

  protected extraMetrics(): KeyMetric[] {
    const aimed = this.onPad + this.offPad;
    return [
      // Every bench that has pads prints this, and only the ones that have
      // pads: a movement mode has nothing to be on and a zero there would read
      // as a failure rather than as an absence.
      ...(aimed > 0
        ? [pct('onpad', 'PRESSES ON THE PAD', this.onPad / aimed)]
        : []),
      ...(this.map?.metrics() ?? []),
      ...(this.orderLine?.metrics() ?? []),
    ];
  }

  protected extraNotes(): { helped: string[]; hurt: string[] } {
    const map = this.map?.notes() ?? { helped: [], hurt: [] };
    const orders = this.orderLine?.notes() ?? { helped: [], hurt: [] };
    const aimed = this.onPad + this.offPad;
    const share = aimed > 0 ? this.onPad / aimed : 1;
    return {
      helped: [
        ...(aimed > 24 && share >= 0.98
          ? ['Your cursor was on the pad for every press. That is the hand this section is for.']
          : []),
        ...map.helped,
        ...orders.helped,
      ],
      hurt: [
        ...(share < 0.85 && this.offPad > 3
          ? [`${this.offPad} presses went in with the cursor somewhere else.`]
          : []),
        ...map.hurt,
        ...orders.hurt,
      ],
    };
  }

  protected extraAdvice(): string | null {
    const aimed = this.onPad + this.offPad;
    // First, because it is the mistake that makes every other number on the
    // screen a lie: a rate produced without aiming is not a rate.
    if (aimed > 0 && this.offPad > 3 && this.onPad / aimed < 0.85) {
      return 'Take the cursor with you. A key only counts while the pointer is on the pad asking for it — leading with the mouse is the habit, and it is the one that transfers.';
    }
    // The corner next, because it is the more expensive of the two that are left.
    return this.map?.advice() ?? this.orderLine?.advice() ?? null;
  }

  /**
   * A click, arbitrated.
   *
   * The strip along the bottom gets first refusal and only ever takes a click
   * that landed on its own mark, so a bench whose entire mode is clicking pads
   * keeps every click that was aimed at one. Everything else is the bench's.
   */
  onClick(pos: Vec2, kind: 'move' | 'attackMove' = 'move'): boolean {
    if (this.orderLine?.click(pos, kind)) return true;
    this.onBenchClick(pos, kind);
    return !this.passClicks();
  }

  /**
   * Whether a click the bench has judged still reaches the champion.
   *
   * No, in twelve of the thirteen modes: the body is bolted to the floor and a
   * move order would be an instruction to nowhere. Yes in the one mode about
   * movement commands, where the body really does walk where you sent it —
   * which is the only thing making the command feel like a command.
   */
  protected passClicks(): boolean {
    return false;
  }

  /**
   * The stop key.
   *
   * Below the rung it arrives on the strip does not want it, and the champion
   * may have it — which on a bench with a bolted-down body means nothing at
   * all happens, which is the honest answer to a key this run is not using.
   */
  onStop(): boolean {
    return this.orderLine?.stop() ?? false;
  }

  /** The bench's own answer to a click the strip did not want. */
  protected onBenchClick(pos: Vec2, _kind: 'move' | 'attackMove' = 'move'): void {
    this.stray(pos);
  }

  // -------------------------------------------------------------- drawing

  /** The bench, the aim on it, and then the strip under it. */
  paint(out: DrillPaint, t: number): void {
    super.paint(out, t);
    this.paintAim(out, t);
    this.orderLine?.paint(out);
  }

  /**
   * Where the cursor is, and whether it is anywhere useful.
   *
   * A rule the player can only find out about by breaking it is a bug wearing
   * a rule's clothes, so the state is on the floor at all times: a live pad
   * wears a second ring inside its edge, that ring closes and lights when the
   * pointer is inside it, and a pointer that is *not* on anything gets a line
   * drawn to the pad that wants it. Nobody should ever have to read a menu to
   * find out why a press did nothing.
   */
  private paintAim(out: DrillPaint, t: number): void {
    const pads = this.aimPads();
    if (pads.length === 0) return;
    const cur = this.s.cursorWorld;
    const on = this.aimedPad(cur);
    for (const pad of pads) {
      const live = pad === on;
      out.markers.push({
        kind: 'ring',
        x: pad.pos.x,
        y: pad.pos.y,
        radius: pad.radius - 7,
        color: live ? this.promptColor : PALETTE.textDim,
        alpha: live ? 0.55 + Math.sin(t * 6) * 0.12 : 0.3,
        width: live ? 2.4 : 1.4,
        // Dashed while it is asking, solid once it has what it asked for: the
        // closing of the ring is the confirmation, and it needs no words.
        dash: live ? 0 : 10,
        spin: live ? 0 : 0.5,
        rise: 0.55,
      });
    }
    if (on) {
      out.markers.push({
        kind: 'ring',
        x: cur.x,
        y: cur.y,
        radius: 16,
        color: this.promptColor,
        alpha: 0.5,
        width: 1.6,
        rise: 1.2,
      });
      return;
    }
    // Off every pad: the shortest way back, drawn. It is faint on purpose —
    // a player who is already leading with the mouse never sees it.
    const want = pads[0];
    out.markers.push({
      kind: 'line',
      x: cur.x,
      y: cur.y,
      x2: want.pos.x,
      y2: want.pos.y,
      halfWidth: 1.4,
      color: PALETTE.warn,
      alpha: 0.3,
      rise: 1.1,
    });
    out.markers.push({
      kind: 'cross',
      x: cur.x,
      y: cur.y,
      radius: 11,
      color: PALETTE.warn,
      alpha: 0.7,
      width: 2,
      rise: 1.2,
    });
  }

  /** Draws one pad: a lit face, an edge, a countdown and what it wants. */
  protected paintPad(out: DrillPaint, pad: Pad, style: PadStyle): void {
    const glow = clamp(style.glow ?? 0, 0, 1);
    out.markers.push({
      kind: 'disc',
      x: pad.pos.x,
      y: pad.pos.y,
      radius: pad.radius,
      color: style.color,
      alpha: 0.1 + glow * 0.4,
      fill: 1,
      rise: 0.3,
    });
    out.markers.push({
      kind: 'ring',
      x: pad.pos.x,
      y: pad.pos.y,
      radius: pad.radius,
      color: style.color,
      // A dark pad has to fall away hard, or four faint rings compete with the
      // one that is actually asking for something.
      alpha: 0.16 + glow * 0.78,
      width: 2.5 + glow * 4,
      rise: 0.6,
    });
    if (style.progress !== undefined) {
      out.markers.push({
        kind: 'ring',
        x: pad.pos.x,
        y: pad.pos.y,
        radius: pad.radius + 16,
        color: style.progress < 0.3 ? PALETTE.danger : style.color,
        alpha: 0.85,
        width: 4,
        progress: clamp(style.progress, 0, 1),
        rise: 0.9,
      });
    }
    if (style.barred) {
      out.markers.push({
        kind: 'cross',
        x: pad.pos.x,
        y: pad.pos.y,
        radius: pad.radius * 0.62,
        color: style.color,
        alpha: 0.9,
        width: 5,
        rise: 1.1,
      });
    }
    const text = style.text ?? (pad.slot ? this.glyph(pad.slot) : 'CLICK');
    out.billboards.push({
      kind: 'label',
      x: pad.pos.x,
      y: pad.pos.y,
      text,
      color: style.color,
      size: 24 + glow * 10,
      sub: style.sub,
    });
  }

  /** A bench outline, so the console reads as one object rather than N pads. */
  protected paintBench(out: DrillPaint, pads: readonly Pad[], color = PALETTE.textFaint): void {
    if (pads.length < 2) return;
    for (let i = 0; i < pads.length - 1; i++) {
      out.markers.push({
        kind: 'line',
        x: pads[i].pos.x,
        y: pads[i].pos.y,
        x2: pads[i + 1].pos.x,
        y2: pads[i + 1].pos.y,
        halfWidth: 2,
        color,
        alpha: 0.35,
        rise: 0.1,
      });
    }
  }

  /** The bench's own caption, above the console. */
  protected paintCaption(out: DrillPaint, text: string, sub: string, color: string): void {
    const c = this.centre;
    out.billboards.push({
      kind: 'label',
      x: c.x,
      y: c.y - 250,
      text,
      color,
      size: 24,
      sub,
    });
  }
}

/** How long a pressed key stays lit. Purely feedback; it gates nothing. */
const PRESS_CD = 0.26;

/**
 * How far outside a pad still counts as pointing at it.
 *
 * The same fourteen units `padAt` has always allowed a click, because a key
 * press aimed at a pad and a click aimed at a pad are the same gesture and it
 * would be indefensible for one of them to be stricter. The whole rule is
 * about *leading with the mouse*, not about pixels: a hand that arrived is a
 * hand that arrived, and shaving the last few units off a sixty-unit circle
 * would only be measuring a mouse sensor.
 */
const AIM_SLACK = 14;

export { mean, median } from './stats';
