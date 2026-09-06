import type { AbilitySlot } from '../../engine/input';
import { clamp } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, ms, pct } from '../base';
import { APM_TARGET_APM } from './engine';
import { LabDrill, median, type LabSolution, type Pad } from './lab';

const SLOTS: AbilitySlot[] = ['q', 'w', 'e', 'r'];

/**
 * GO / NO-GO — the press you were right not to make.
 *
 * Pads light one at a time. A live pad wants its key, now. A barred pad — the
 * cross through it — wants nothing at all, and the only correct thing to do
 * with it is let it time out with your hands still. Press a barred pad and the
 * chain is gone.
 *
 * Every other mode in the lab pays for speed. This one is the counterweight,
 * and it is the reason the engine has a fourth verb: withholding pays score
 * and keeps the chain, and moves the rate not one action, because no finger
 * moved. A player who mashes through this mode can be very fast and score
 * close to nothing, which is the correct outcome and not a punishment.
 *
 * Transfer: the cooldown you do not spend on a bait, and the flash you do not
 * throw at a step forward. Inhibition is a mechanic, it is slower than
 * reaction, and it is the half of hand speed nobody trains.
 */
export class ApmGateDrill extends LabDrill {
  protected readonly targetApm = APM_TARGET_APM.apmGate;
  /**
   * A barred pad takes a full window and pays no action, so the raw rate this
   * mode can reach is well under the others'. Scoring it against three
   * quarters of the par would ask for a rate the mode makes impossible.
   */
  protected get targetRate(): number {
    return this.targetApm * 0.55;
  }

  private pads: Pad[] = [];
  private lit = 0;
  private barred = false;
  private shownAt = 0;
  private window = 1.1;
  private baits = 0;
  private wrong = 0;
  private missed = 0;
  private barredSeen = 0;
  private reactionsOnGo: number[] = [];

  protected build(): void {
    this.pads = this.row(SLOTS, { gap: 200, radius: 66 });
    this.deal();
  }

  private deal(): void {
    let next = this.s.rng.int(0, SLOTS.length);
    if (next === this.lit) next = (next + 1) % SLOTS.length;
    this.lit = next;
    // Barred pads get commoner as the rung climbs: at the top nearly half of
    // what lights up is asking to be left alone.
    this.barred = this.s.rng.chance(0.2 + this.d * 0.25);
    if (this.barred) this.barredSeen++;
    this.shownAt = this.s.elapsed;
    this.window = clamp((1.25 - this.d * 0.45) / this.tempo, 0.34, 1.35);
  }

  protected tick(_dt: number): void {
    if (this.s.elapsed - this.shownAt <= this.window) return;
    const pad = this.pads[this.lit];
    if (this.barred) this.hold(pad.pos, 'HELD');
    else {
      this.missed++;
      this.fumble(pad.pos, 'MISSED', { input: false, cost: 50 });
    }
    this.deal();
  }

  protected onKey(slot: AbilitySlot): void {
    const idx = SLOTS.indexOf(slot);
    if (idx < 0) {
      this.stray(this.centre);
      return;
    }
    this.press(slot);
    const pad = this.pads[idx];
    if (this.barred) {
      // Any key at all during a barred pad is the mistake: the mode is asking
      // for stillness, not for a different key.
      this.baits++;
      this.fumble(pad.pos, 'BAIT');
      this.deal();
      return;
    }
    if (idx !== this.lit) {
      this.wrong++;
      this.fumble(pad.pos, `WRONG · ${this.glyph(SLOTS[this.lit])}`);
      this.deal();
      return;
    }
    const age = this.s.elapsed - this.shownAt;
    this.reactionsOnGo.push(age * 1000);
    this.hit(pad.pos, {
      quality: clamp(1 - age / this.window, 0, 1),
      value: 110,
      reaction: age * 1000,
      label: this.glyph(slot),
    });
    this.deal();
  }

  protected modeSolution(): LabSolution {
    return this.barred ? { wait: true } : { keys: [SLOTS[this.lit]] };
  }

  protected slotName(slot: AbilitySlot): string {
    return SLOTS[this.lit] === slot ? (this.barred ? 'HOLD' : 'GO') : '';
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    const left = clamp(1 - (this.s.elapsed - this.shownAt) / this.window, 0, 1);
    this.paintBench(out, this.pads);
    this.pads.forEach((pad, i) => {
      const on = i === this.lit;
      const color = !on ? PALETTE.textFaint : this.barred ? PALETTE.danger : this.flow.color;
      this.paintPad(out, pad, {
        color,
        glow: on ? 0.55 + left * 0.45 : 0.05,
        progress: on ? left : undefined,
        barred: on && this.barred,
        sub: on ? (this.barred ? 'HANDS OFF' : 'GO') : undefined,
      });
    });
    this.paintCaption(
      out,
      this.barred ? 'HOLD' : 'GO',
      this.barred ? 'let it time out — pressing anything is the mistake' : 'take it now',
      this.barred ? PALETTE.danger : PALETTE.good,
    );
  }

  protected modeField(): HudField {
    const kept = this.holds / Math.max(1, this.holds + this.baits);
    return {
      label: 'HELD',
      value: this.barredSeen ? `${Math.round(kept * 100)}%` : '—',
      bar: kept,
      tone: kept > 0.9 ? 'good' : kept > 0.7 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    return {
      tempo: clamp(speed * 0.45 + performance * 0.55, 0, 1),
      targeting: clamp(accuracy * 0.6 + performance * 0.4, 0, 1),
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [
      pct('kept', 'BARRED PADS HELD', this.holds / Math.max(1, this.holds + this.baits)),
      ms('go', 'REACTION ON GO', median(this.reactionsOnGo)),
      count('baits', 'BAITS TAKEN', this.baits, 'lower'),
      count('missed', 'LIVE PADS MISSED', this.missed, 'lower'),
      count('wrong', 'WRONG PAD', this.wrong, 'lower'),
    ];
  }

  protected notes() {
    const kept = this.holds / Math.max(1, this.holds + this.baits);
    return {
      helped: this.holds > 6 && kept > 0.92 ? ['Your hands stop when the pad says stop. That is the hard half.'] : [],
      hurt: kept < 0.7 ? [`${this.baits} barred pads took a press out of you.`] : [],
      advice:
        kept < 0.7
          ? 'You are committing before you have finished reading. Wait for the cross, not for the light.'
          : this.missed > this.hits * 0.25
            ? 'You have over-corrected: now the live pads are timing out. The bar is read the pad, then go — not hesitate, then go.'
            : null,
    };
  }
}
