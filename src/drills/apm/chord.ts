import { audio } from '../../engine/audio';
import type { AbilitySlot } from '../../engine/input';
import { clamp } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, ms } from '../base';
import { APM_TARGET_APM } from './engine';
import { LabDrill, median, type LabSolution, type Pad } from './lab';

const SLOTS: AbilitySlot[] = ['q', 'w', 'e', 'r'];

/**
 * CHORD — two keys, one instant.
 *
 * A pair of pads lights and both keys have to go down together. Not quickly
 * one after the other: together, inside a tolerance that starts at about an
 * eighth of a second and closes to under fifty milliseconds at the top of the
 * ladder. Land the second key outside it and the pair is a SPLIT — no partial
 * credit, because a split chord is not a slow chord, it is two things instead
 * of one thing.
 *
 * It is the only mode here where being fast is not the point at all. The
 * measurement is *spread*: how far apart your two fingers are when they think
 * they are simultaneous. Almost everyone's is wider than they believe, and it
 * is the reason a flash-cast comes out as a flash and then a cast.
 *
 * Transfer: flash plus an ability, an item plus a cast — the pairs that only
 * work when the game sees them on the same frame.
 */
export class ApmChordDrill extends LabDrill {
  protected readonly targetApm = APM_TARGET_APM.apmChord;

  private pads: Pad[] = [];
  private pair: [AbilitySlot, AbilitySlot] = ['q', 'e'];
  private shownAt = 0;
  private window = 1.3;
  private first: { slot: AbilitySlot; at: number } | null = null;
  private spreads: number[] = [];
  private splits = 0;
  private wrong = 0;
  private missed = 0;

  protected build(): void {
    this.pads = this.ring(SLOTS, 300, 62);
    this.deal();
  }

  /** The tolerance the pair has to land inside. */
  private get tolerance(): number {
    return clamp(0.135 - this.d * 0.085, 0.042, 0.135);
  }

  private deal(): void {
    const a = this.s.rng.pick(SLOTS);
    let b = this.s.rng.pick(SLOTS);
    let guard = 0;
    while (b === a && guard++ < 8) b = this.s.rng.pick(SLOTS);
    this.pair = [a, b];
    this.first = null;
    this.shownAt = this.s.elapsed;
    this.window = clamp((1.5 - this.d * 0.55) / this.tempo, 0.45, 1.6);
  }

  private padOf(slot: AbilitySlot): Pad {
    return this.pads[SLOTS.indexOf(slot)];
  }

  private get midpoint() {
    const a = this.padOf(this.pair[0]).pos;
    const b = this.padOf(this.pair[1]).pos;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  protected tick(_dt: number): void {
    if (this.first) {
      // Half a chord is not a chord. The partner had its window and missed it.
      if (this.s.elapsed - this.first.at > this.tolerance) {
        this.splits++;
        this.fumble(this.midpoint, 'SPLIT', { input: false, cost: 60 });
        this.deal();
      }
      return;
    }
    if (this.s.elapsed - this.shownAt > this.window) {
      this.missed++;
      this.fumble(this.midpoint, 'MISSED', { input: false, cost: 50 });
      this.deal();
    }
  }

  protected onKey(slot: AbilitySlot): void {
    this.press(slot);
    if (slot !== this.pair[0] && slot !== this.pair[1]) {
      this.wrong++;
      this.fumble(this.padOf(slot).pos, 'NOT IN THE PAIR');
      this.deal();
      return;
    }
    if (!this.first) {
      // The first key of a pair is an input like any other — it counts towards
      // the rate — but it has not earned anything yet.
      this.note();
      this.first = { slot, at: this.s.elapsed };
      audio.play('castArm', { intensity: 0.5 });
      this.s.fx.ring(this.padOf(slot).pos.x, this.padOf(slot).pos.y, 8, 46, 0.2, PALETTE.warn, 2, 'pulse');
      return;
    }
    if (slot === this.first.slot) {
      this.stray(this.padOf(slot).pos);
      return;
    }
    const spread = (this.s.elapsed - this.first.at) * 1000;
    this.spreads.push(spread);
    const tol = this.tolerance * 1000;
    if (spread > tol) {
      this.splits++;
      this.fumble(this.midpoint, `SPLIT · ${Math.round(spread)}ms`);
      this.deal();
      return;
    }
    this.hit(this.midpoint, {
      quality: clamp(1 - spread / tol, 0, 1),
      value: 130,
      reaction: (this.s.elapsed - this.shownAt) * 1000,
      label: `${Math.round(spread)}ms`,
    });
    this.deal();
  }

  protected modeSolution(): LabSolution {
    // Both keys, this instant. The harness sends them in one step, which is
    // exactly the thing the mode is asking a pair of fingers to do.
    return { keys: this.first ? [this.first.slot === this.pair[0] ? this.pair[1] : this.pair[0]] : [...this.pair] };
  }

  protected slotName(slot: AbilitySlot): string {
    return this.pair.includes(slot) ? 'CHORD' : '';
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    const left = clamp(1 - (this.s.elapsed - this.shownAt) / this.window, 0, 1);
    const holding = this.first !== null;
    const held = holding ? clamp(1 - (this.s.elapsed - this.first!.at) / this.tolerance, 0, 1) : 0;
    for (const slot of SLOTS) {
      const pad = this.padOf(slot);
      const inPair = this.pair.includes(slot);
      const done = holding && this.first!.slot === slot;
      this.paintPad(out, pad, {
        color: done ? PALETTE.good : inPair ? (holding ? PALETTE.warn : this.flow.color) : PALETTE.textFaint,
        glow: inPair ? 0.55 + (holding ? held : left) * 0.45 : 0.04,
        progress: inPair ? (holding ? held : left) : undefined,
      });
    }
    const a = this.padOf(this.pair[0]).pos;
    const b = this.padOf(this.pair[1]).pos;
    out.markers.push({
      kind: 'line',
      x: a.x,
      y: a.y,
      x2: b.x,
      y2: b.y,
      halfWidth: 4,
      color: holding ? PALETTE.warn : this.flow.color,
      alpha: 0.5 + (holding ? held : left) * 0.4,
      rise: 0.4,
    });
    this.paintCaption(
      out,
      holding ? 'PARTNER' : 'TOGETHER',
      `${Math.round(this.tolerance * 1000)}ms apart, at most`,
      holding ? PALETTE.warn : PALETTE.textDim,
    );
  }

  protected modeField(): HudField {
    const sp = median(this.spreads);
    return {
      label: 'SPREAD',
      value: sp ? `${Math.round(sp)}ms` : '—',
      bar: clamp(1 - sp / 200, 0, 1),
      tone: sp && sp < 45 ? 'good' : sp && sp < 90 ? 'warn' : sp ? 'bad' : 'neutral',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    void speed;
    return {
      tempo: clamp(performance * 0.7 + accuracy * 0.3, 0, 1),
      combat: clamp(performance * 0.6 + accuracy * 0.4, 0, 1),
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [
      ms('spread', 'FINGER SPREAD', median(this.spreads)),
      count('chords', 'CHORDS LANDED', this.hits),
      count('splits', 'SPLIT PAIRS', this.splits, 'lower'),
      count('wrong', 'KEYS OUTSIDE THE PAIR', this.wrong, 'lower'),
      count('missed', 'PAIRS UNTOUCHED', this.missed, 'lower'),
    ];
  }

  protected notes() {
    const sp = median(this.spreads);
    return {
      helped: sp > 0 && sp < 40 ? [`Your two fingers land ${Math.round(sp)}ms apart. That is one input, not two.`] : [],
      hurt: this.splits > this.hits * 0.35 ? ['More pairs split than landed together.'] : [],
      advice:
        this.splits > this.hits * 0.35
          ? 'Stop leading with one finger. Drop both hands at once and let the pair arrive together rather than in order.'
          : sp > 90
            ? 'You are pressing in sequence and calling it a chord. Aim for one motion with two fingers in it.'
            : null,
    };
  }
}
