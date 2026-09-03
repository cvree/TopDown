import { codeLabel, defaultsFor, type AbilitySlot } from '../../engine/input';
import { clamp } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { AbilityView } from '../../engine/session';
import type { Actor, Vec2 } from '../../engine/types';
import { ApmDrill, KeyCooldowns } from './engine';

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
 * Two decisions are worth stating outright, because everything else follows.
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
 */

/** Which shape your hand is in to reach a key. */
export type Bank = 'near' | 'far' | 'mouse';

/** The bank a slot lives in: three fingers rest, the rest is a stretch. */
export const BANK_OF: Record<AbilitySlot, Bank> = {
  q: 'near',
  w: 'near',
  e: 'near',
  r: 'far',
  d: 'far',
  f: 'far',
};

export const BANK_LABEL: Record<Bank, string> = {
  near: 'NEAR BANK',
  far: 'FAR BANK',
  mouse: 'MOUSE',
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

  /** What each key prints, which the control scheme decides. */
  private glyphs: Partial<Record<AbilitySlot, string>> = {};

  /** Set by a mode that needs a driveable body rather than a bench. */
  protected mobile(): boolean {
    return false;
  }

  /** Per-mode construction, once the bench exists. */
  protected abstract build(): void;

  /** What a perfect player would do right now. */
  abstract solution(): LabSolution;

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
    this.build();
  }

  // ------------------------------------------------------------ the bench

  protected get centre(): Vec2 {
    const { w, h } = this.s.world.bounds;
    return { x: w / 2, y: h * 0.52 };
  }

  /** The key printed on a pad — the one your hand is actually on. */
  protected glyph(slot: AbilitySlot): string {
    return this.glyphs[slot] ?? slot.toUpperCase();
  }

  /** A row of pads across the bench, centred, evenly spaced. */
  protected row(slots: AbilitySlot[], opts: { y?: number; gap?: number; radius?: number } = {}): Pad[] {
    const c = this.centre;
    const gap = opts.gap ?? 190;
    const radius = opts.radius ?? 58;
    const y = opts.y ?? c.y;
    const span = (slots.length - 1) * gap;
    return slots.map((slot, i) => ({ slot, pos: { x: c.x - span / 2 + i * gap, y }, radius }));
  }

  /** Pads on a ring around the bench, starting at the top and going clockwise. */
  protected ring(slots: AbilitySlot[], radius: number, padRadius = 54): Pad[] {
    const c = this.centre;
    return slots.map((slot, i) => {
      const a = -Math.PI / 2 + (i / slots.length) * Math.PI * 2;
      return {
        slot,
        pos: { x: c.x + Math.cos(a) * radius, y: c.y + Math.sin(a) * radius * 0.62 },
        radius: padRadius,
      };
    });
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
      name: this.slotName(slot),
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
    return BANK_OF[slot] === 'near' ? 'NEAR' : 'FAR';
  }

  update(dt: number): void {
    this.keys.tick(dt);
    super.update(dt);
  }

  /** Nothing on this bench moves, so a click is only ever aimed at a pad. */
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

/** The middle of a set of samples. Medians, not means: one 900ms fumble
 *  should not move a number that describes a hundred clean presses. */
export const median = (xs: readonly number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/** The mean, for the samples where an outlier is the thing being measured. */
export const mean = (xs: readonly number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
