import { codeLabel, defaultsFor, type AbilitySlot } from '../../engine/input';
import type { MapBoard } from '../../engine/mapboard';
import { clamp } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { AbilityView } from '../../engine/session';
import type { Actor, Vec2 } from '../../engine/types';
import type { KeyMetric } from '../../progression/profile';
import { ApmDrill, KeyCooldowns } from './engine';
import { MAP_KEYS, MapDodge } from './map';
import { PadMotion, type Drift } from './motion';

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
 * rung and with your own flow. Two hands are being measured on this floor and
 * the eyes were being let off entirely; they are not any more.
 *
 * And one thing that is not on this floor at all: the board in the corner. The
 * minimap runs a two-lane dodge for the whole of every mode, on the two
 * summoner keys, and it is wired in here so that no mode ever has to know it
 * exists. See `map.ts` for what it asks and why.
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
  /** The board in the bottom-right corner. Every mode runs one. */
  protected map!: MapDodge;

  /** What each key prints, which the control scheme decides. */
  private glyphs: Partial<Record<AbilitySlot, string>> = {};

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
    const binds = defaultsFor(this.s.scheme);
    for (const slot of ['q', 'w', 'e', 'r', 'd', 'f'] as AbilitySlot[]) {
      this.glyphs[slot] = codeLabel(binds[slot].primary);
    }
    this.motion = new PadMotion(this.s.world.bounds, this.s.rng);
    this.map = new MapDodge(
      this.s,
      {
        hit: (pos, opts) => this.hit(pos, opts),
        hold: (pos, label) => this.hold(pos, label),
        fumble: (pos, label, opts) => this.fumble(pos, label, opts),
        stray: (pos) => this.stray(pos),
        glyph: (slot) => this.glyph(slot),
        color: () => this.flow.color,
        focus: () => this.mapFocus,
      },
      this.mapPressure(),
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

  /** The key printed on a pad — the one your hand is actually on. */
  protected glyph(slot: AbilitySlot): string {
    return this.glyphs[slot] ?? slot.toUpperCase();
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
   * Both read the rung and your own flow, so the floor is nearly still for
   * somebody opening level one and genuinely hard to read for somebody
   * transcendent on level ten — and it settles the moment a chain breaks,
   * which is the same self-pacing every other part of the engine uses.
   */
  protected motionSpeed(): number {
    return 0.5 + this.d * 1.05 + this.heat * 0.55;
  }

  protected motionSpread(): number {
    return clamp(0.18 + this.d * 0.66 + this.heat * 0.28, 0, 1);
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
      locked: !active.has(slot),
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
    this.map.update(dt);
  }

  /**
   * A key, routed.
   *
   * The summoner pair is the board's in every mode, and the mode never sees
   * it: that is the whole of the arbitration, and it is here rather than in
   * thirteen places.
   */
  onAbility(slot: AbilitySlot, at: Vec2): void {
    if (MAP_KEYS.includes(slot)) {
      this.press(slot);
      this.map.press(slot);
      return;
    }
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
    const dodge = this.map?.solution();
    if (!dodge) return base;
    return { keys: [dodge], dir: base.dir ?? null };
  }

  mapBoard(): MapBoard | null {
    return this.map?.board() ?? null;
  }

  protected extraMetrics(): KeyMetric[] {
    return this.map?.metrics() ?? [];
  }

  protected extraNotes(): { helped: string[]; hurt: string[] } {
    return this.map?.notes() ?? { helped: [], hurt: [] };
  }

  protected extraAdvice(): string | null {
    return this.map?.advice() ?? null;
  }

  /** Nothing on this bench moves on its own, so a click is only ever aimed. */
  onClick(pos: Vec2): boolean {
    this.onBenchClick(pos);
    return true;
  }

  protected onBenchClick(pos: Vec2): void {
    this.stray(pos);
  }

  // -------------------------------------------------------------- drawing

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

export { mean, median } from './stats';
