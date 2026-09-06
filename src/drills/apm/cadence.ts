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

const PULSE_SLOTS: AbilitySlot[] = ['q', 'e'];

/**
 * PULSE — cadence, with one bit of decision on top.
 *
 * Two pads, two fingers. One pad is lit; press its key and the light moves.
 * That is the entire mode, and it is the floor under every other one: whatever
 * number comes out here is the fastest your hands will ever go in this trainer,
 * because nothing else is being asked of them.
 *
 * The one thing it refuses to be is a metronome you can run blind. Roughly a
 * third of the time the light stays where it is, so a hand that has decided to
 * alternate and stopped looking answers the wrong pad — and the wrong pad
 * costs the chain. One bit of choice is the smallest amount of reading that
 * still makes a rate honest.
 *
 * Transfer: the trill under a combo. Two abilities, two fingers, no travel.
 */
export class ApmPulseDrill extends LabDrill {
  protected readonly targetApm = APM_TARGET_APM.apmPulse;

  private pads: Pad[] = [];
  private lit = 0;
  private shownAt = 0;
  private window = 0.9;
  private gaps: number[] = [];
  private lastHitAt = 0;
  private wrongPad = 0;
  private missed = 0;
  private repeats = 0;
  private repeatsTaken = 0;
  /** True while the current light is the same pad as the one before it. */
  private repeatNow = false;

  protected build(): void {
    this.pads = this.row(PULSE_SLOTS, { gap: 300, radius: 76 });
    this.arm(0);
  }

  private arm(next: number): void {
    this.repeatNow = next === this.lit && this.shownAt > 0;
    if (this.repeatNow) this.repeats++;
    this.lit = next;
    this.shownAt = this.s.elapsed;
    // Long enough that the mode never sets the pace for a strong player, short
    // enough that a stalled hand is caught. Your own speed is the real clock.
    this.window = clamp((1.05 - this.d * 0.45) / this.tempo, 0.17, 1.1);
  }

  /** Where the light goes next: usually across, often enough not. */
  private advance(): void {
    const stay = this.s.rng.chance(0.3 + this.d * 0.08);
    this.arm(stay ? this.lit : 1 - this.lit);
  }

  protected tick(_dt: number): void {
    if (this.s.elapsed - this.shownAt <= this.window) return;
    this.missed++;
    this.fumble(this.pads[this.lit].pos, 'STALLED', { input: false, cost: 40 });
    this.advance();
  }

  protected onKey(slot: AbilitySlot): void {
    const idx = PULSE_SLOTS.indexOf(slot);
    if (idx < 0) {
      this.stray(this.centre);
      return;
    }
    this.press(slot);
    const pad = this.pads[idx];
    if (idx !== this.lit) {
      this.wrongPad++;
      this.fumble(pad.pos, 'WRONG PAD');
      this.advance();
      return;
    }

    const age = this.s.elapsed - this.shownAt;
    if (this.repeatNow) this.repeatsTaken++;
    if (this.lastHitAt > 0) this.gaps.push((this.s.elapsed - this.lastHitAt) * 1000);
    this.lastHitAt = this.s.elapsed;
    this.hit(pad.pos, {
      quality: clamp(1 - age / this.window, 0, 1),
      value: 70,
      reaction: age * 1000,
      label: this.glyph(slot),
    });
    this.advance();
  }

  protected modeSolution(): LabSolution {
    return { keys: [PULSE_SLOTS[this.lit]] };
  }

  protected slotName(slot: AbilitySlot): string {
    return slot === PULSE_SLOTS[0] ? 'LEFT PAD' : slot === PULSE_SLOTS[1] ? 'RIGHT PAD' : '';
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    this.paintBench(out, this.pads);
    const left = clamp(1 - (this.s.elapsed - this.shownAt) / this.window, 0, 1);
    this.pads.forEach((pad, i) => {
      const on = i === this.lit;
      this.paintPad(out, pad, {
        color: on ? this.flow.color : PALETTE.textFaint,
        glow: on ? 0.6 + left * 0.4 : 0.05,
        progress: on ? left : undefined,
      });
    });
    this.paintCaption(out, 'PULSE', 'take the lit pad — it does not always move', PALETTE.textDim);
  }

  protected modeField(): HudField {
    const gap = median(this.gaps);
    return {
      label: 'GAP',
      value: gap ? `${Math.round(gap)}ms` : '—',
      bar: clamp(1 - gap / 700, 0, 1),
      tone: gap && gap < 230 ? 'good' : gap && gap < 400 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, _accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    return { tempo: clamp(speed * 0.6 + performance * 0.4, 0, 1) };
  }

  protected modeMetrics(): KeyMetric[] {
    return [
      ms('gap', 'TIME PER PRESS', median(this.gaps)),
      count('wrong', 'WRONG PAD', this.wrongPad, 'lower'),
      count('repeats', 'REPEATS TAKEN', this.repeatsTaken),
      count('stalled', 'PADS TIMED OUT', this.missed, 'lower'),
    ];
  }

  protected notes() {
    const gap = median(this.gaps);
    return {
      helped: gap > 0 && gap < 200 ? [`${Math.round(gap)}ms a press — that is a trained pair of fingers.`] : [],
      hurt: this.wrongPad > this.hits * 0.12 ? ['You are alternating from memory rather than reading the pad.'] : [],
      advice:
        this.wrongPad > this.hits * 0.12
          ? 'Watch the pad, not the rhythm. The light repeats about a third of the time and that is the whole test.'
          : gap > 340
            ? 'Leave both fingers resting on their keys. Lifting between presses is most of the gap you are paying.'
            : null,
    };
  }
}

const SUSTAIN_SLOTS: AbilitySlot[] = ['q', 'w', 'e', 'r'];
/** Seconds at each required cadence before it steps up. */
const STEP_SECONDS = 12;
/** How much faster each step asks you to be, in actions per minute. */
const STEP_UP = 18;

/**
 * SUSTAIN — the rate you can hold, found by taking it away from you.
 *
 * A beat runs, one of four pads lights on each one, and you press it before
 * the next beat lands. Every twelve seconds the beat gets faster. There is no
 * ceiling in the mode and no way to finish it: you play until two beats inside
 * one step get away from you, and the run ends where your hands actually end.
 *
 * Every other mode measures a rate you chose. This one measures the rate you
 * can be *held to*, which is a different and much less flattering number — the
 * ceiling everywhere else is a peak, and this one is a floor you fell off.
 *
 * Transfer: minute three of a fight, not second three of one.
 */
export class ApmSustainDrill extends LabDrill {
  protected readonly targetApm = APM_TARGET_APM.apmSustain;

  private pads: Pad[] = [];
  private lit = 0;
  private beat = 0;
  private beatAt = 0;
  private step = 0;
  private stepAt = 0;
  private missesThisStep = 0;
  private answeredBeat = false;
  private beatsHeld = 0;
  private topRate = 0;
  private wrongPad = 0;
  private gaps: number[] = [];
  private lastHitAt = 0;

  /** The rate the current step demands, in presses a minute. */
  private get rate(): number {
    return 88 + this.d * 62 + this.step * STEP_UP;
  }

  protected build(): void {
    this.pads = this.ring(SUSTAIN_SLOTS, 250, 62);
    this.stepAt = 0;
    this.nextBeat(true);
  }

  private nextBeat(first = false): void {
    if (!first && !this.answeredBeat) {
      this.missesThisStep++;
      this.fumble(this.pads[this.lit].pos, 'DROPPED', { input: false, cost: 60 });
      if (this.missesThisStep >= 2) {
        this.collapse();
        return;
      }
    } else if (!first) {
      this.beatsHeld++;
    }
    this.beat = 60 / this.rate;
    this.beatAt = this.s.elapsed;
    this.answeredBeat = false;
    let next = this.s.rng.int(0, SUSTAIN_SLOTS.length);
    if (next === this.lit) next = (next + 1 + this.s.rng.int(0, SUSTAIN_SLOTS.length - 1)) % SUSTAIN_SLOTS.length;
    this.lit = next;
    this.topRate = Math.max(this.topRate, this.rate);
    audio.play('flowPulse', { intensity: 0.4 });
  }

  /** Two dropped beats inside one step and the run is over, on purpose. */
  private collapse(): void {
    this.s.setBanner(`BROKE AT ${Math.round(this.rate)} APM`, 2.2);
    this.s.fx.addFlash(0.14, PALETTE.danger);
    audio.play('fail');
    this.endReason = 'complete';
    this.s.forceEnd = true;
  }

  protected tick(_dt: number): void {
    if (this.s.elapsed - this.stepAt >= STEP_SECONDS) {
      this.stepAt = this.s.elapsed;
      this.step++;
      this.missesThisStep = 0;
      this.s.setBanner(`STEP ${this.step + 1} · ${Math.round(this.rate)} APM`, 1.2);
      audio.play('flowTier', { intensity: 0.6 });
    }
    if (this.s.elapsed - this.beatAt >= this.beat) this.nextBeat();
  }

  protected onKey(slot: AbilitySlot): void {
    const idx = SUSTAIN_SLOTS.indexOf(slot);
    if (idx < 0) {
      this.stray(this.centre);
      return;
    }
    this.press(slot);
    const pad = this.pads[idx];
    if (idx !== this.lit) {
      this.wrongPad++;
      this.fumble(pad.pos, 'WRONG PAD');
      return;
    }
    if (this.answeredBeat) {
      // The beat is already paid for. A second press is enthusiasm, not rate.
      this.stray(pad.pos);
      return;
    }
    this.answeredBeat = true;
    const age = this.s.elapsed - this.beatAt;
    if (this.lastHitAt > 0) this.gaps.push((this.s.elapsed - this.lastHitAt) * 1000);
    this.lastHitAt = this.s.elapsed;
    this.hit(pad.pos, {
      quality: clamp(1 - age / this.beat, 0, 1),
      value: 80,
      reaction: age * 1000,
      label: this.glyph(slot),
    });
  }

  protected modeSolution(): LabSolution {
    return this.answeredBeat ? { wait: true } : { keys: [SUSTAIN_SLOTS[this.lit]] };
  }

  protected slotName(): string {
    return 'BEAT';
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    const left = clamp(1 - (this.s.elapsed - this.beatAt) / this.beat, 0, 1);
    this.pads.forEach((pad, i) => {
      const on = i === this.lit && !this.answeredBeat;
      this.paintPad(out, pad, {
        color: on ? this.flow.color : PALETTE.textFaint,
        glow: on ? 0.55 + left * 0.45 : 0.05,
        progress: on ? left : undefined,
      });
    });
    this.paintCaption(
      out,
      `${Math.round(this.rate)} APM`,
      `step ${this.step + 1} · ${this.missesThisStep} of 2 dropped`,
      this.missesThisStep > 0 ? PALETTE.warn : PALETTE.textDim,
    );
  }

  protected modeField(): HudField {
    const held = clamp(this.step / 8, 0, 1);
    return {
      label: 'STEP',
      value: `${this.step + 1}`,
      bar: held,
      tone: this.missesThisStep > 0 ? 'warn' : 'good',
    };
  }

  protected axisSplit(performance: number, _accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    return {
      tempo: clamp(speed * 0.55 + performance * 0.45, 0, 1),
      combat: clamp(performance * 0.8, 0, 1),
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [
      count('top', 'RATE HELD', Math.round(this.topRate)),
      count('beats', 'BEATS HELD', this.beatsHeld),
      count('step', 'STEPS CLEARED', this.step),
      ms('gap', 'TIME PER PRESS', median(this.gaps)),
      count('wrong', 'WRONG PAD', this.wrongPad, 'lower'),
    ];
  }

  protected notes() {
    return {
      helped: this.step >= 5 ? [`You were still on the beat at ${Math.round(this.topRate)} a minute.`] : [],
      hurt: this.wrongPad > this.hits * 0.12 ? ['Most of what you lost was the wrong pad, not a slow one.'] : [],
      advice:
        this.step <= 1
          ? 'You are dropping beats at the opening rate. Play a lower rung until the first two steps feel like nothing.'
          : this.wrongPad > this.hits * 0.12
            ? 'Keep all four fingers home. At this rate a hand that travels cannot arrive.'
            : null,
    };
  }
}
