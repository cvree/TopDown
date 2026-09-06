import { audio } from '../../engine/audio';
import type { AbilitySlot } from '../../engine/input';
import { clamp } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, ms, pct } from '../base';
import { APM_TARGET_APM } from './engine';
import { LabDrill, mean, type LabSolution, type Pad } from './lab';

const WHEEL_SLOTS: AbilitySlot[] = ['q', 'w', 'e', 'r'];
/** Base seconds per wheel, before tempo. Deliberately not multiples. */
const PERIODS = [2.4, 3.1, 3.9, 4.7];

interface Wheel {
  slot: AbilitySlot;
  pad: Pad;
  /** Seconds since it was last spent. */
  t: number;
  period: number;
  /** When it came up, in run seconds, or -1 while it is still filling. */
  readyAt: number;
  locked: boolean;
  /** Whether a key was pressed at this wheel during the current lock. */
  touchedWhileLocked: boolean;
}

/**
 * UPKEEP — four clocks, none of them prompting you.
 *
 * Four wheels fill at four rates that do not divide into each other. When one
 * comes up it has a grace period and then it is wasted, and nothing flashes,
 * nothing beeps at the last moment and nothing waits: the wheels are the only
 * prompt there is. Press one early and the input is thrown away.
 *
 * Every other mode in the lab reacts to something. This one is self-paced, and
 * that is a genuinely different problem — the limit is not how fast you can
 * answer but how much you can keep track of while answering. Every so often a
 * wheel is locked, and then the correct thing to do with a full wheel is
 * nothing at all, which is the other half of the same skill.
 *
 * Transfer: never sitting on a cooldown because your attention was elsewhere,
 * and never spending one into the moment it is useless.
 */
export class ApmUpkeepDrill extends LabDrill {
  protected readonly targetApm = APM_TARGET_APM.apmUpkeep;
  /** The wheels set the ceiling: nobody can press faster than they fill. */
  protected get targetRate(): number {
    return this.targetApm * 0.62;
  }

  private wheels: Wheel[] = [];
  private lockCd = 6;
  private lockUntil = 0;
  private locked: Wheel | null = null;
  private idles: number[] = [];
  private wasted = 0;
  private earlies = 0;
  private lockBreaks = 0;

  protected build(): void {
    const pads = this.row(WHEEL_SLOTS, { gap: 210, radius: 76 });
    this.wheels = WHEEL_SLOTS.map((slot, i) => ({
      slot,
      pad: pads[i],
      t: this.s.rng.range(0, PERIODS[i] * 0.6),
      period: PERIODS[i],
      readyAt: -1,
      locked: false,
      touchedWhileLocked: false,
    }));
  }

  /** How long a full wheel may be left standing before it is wasted. */
  private get grace(): number {
    return clamp(1.25 - this.d * 0.6, 0.35, 1.25);
  }

  private periodOf(w: Wheel): number {
    return clamp(w.period / Math.max(0.85, this.tempo * 0.85), 0.9, 6);
  }

  protected tick(dt: number): void {
    this.lockCd -= dt;
    if (this.locked && this.s.elapsed >= this.lockUntil) this.unlock();
    if (!this.locked && this.lockCd <= 0) this.lock();

    for (const w of this.wheels) {
      if (w.locked) continue;
      const period = this.periodOf(w);
      w.t += dt;
      if (w.readyAt < 0 && w.t >= period) {
        w.readyAt = this.s.elapsed;
        audio.play('abilityReady', { intensity: 0.5, pan: this.s.panOf(w.pad.pos) });
      }
      if (w.readyAt >= 0 && this.s.elapsed - w.readyAt > this.grace) {
        this.wasted++;
        this.fumble(w.pad.pos, 'WASTED', { input: false, cost: 80 });
        this.reset(w);
      }
    }
  }

  private reset(w: Wheel): void {
    w.t = 0;
    w.readyAt = -1;
  }

  private lock(): void {
    const w = this.s.rng.pick(this.wheels);
    w.locked = true;
    w.touchedWhileLocked = false;
    this.locked = w;
    this.lockUntil = this.s.elapsed + clamp(2.8 - this.d * 0.8, 1.6, 2.8);
    this.s.setBanner(`${this.glyph(w.slot)} LOCKED`, 1);
    audio.play('castRefuse', { intensity: 0.7, pan: this.s.panOf(w.pad.pos) });
  }

  private unlock(): void {
    const w = this.locked;
    this.locked = null;
    this.lockCd = clamp(7.5 - this.d * 2.5, 4, 7.5);
    if (!w) return;
    w.locked = false;
    // A lock ridden out with your hands still is the mode's other payout, and
    // it is a hold rather than a hit: nothing was pressed, so nothing is rate.
    if (!w.touchedWhileLocked) this.hold(w.pad.pos, 'HELD');
  }

  protected onKey(slot: AbilitySlot): void {
    const w = this.wheels.find((x) => x.slot === slot);
    if (!w) {
      this.stray(this.centre);
      return;
    }
    this.press(slot);
    if (w.locked) {
      w.touchedWhileLocked = true;
      this.lockBreaks++;
      this.fumble(w.pad.pos, 'LOCKED');
      return;
    }
    if (w.readyAt < 0) {
      // Pressing a wheel that has not come up is exactly the wasted input the
      // engine refuses to pay a rate for.
      this.earlies++;
      this.stray(w.pad.pos);
      return;
    }
    const idle = this.s.elapsed - w.readyAt;
    this.idles.push(idle * 1000);
    this.hit(w.pad.pos, {
      quality: clamp(1 - idle / this.grace, 0, 1),
      value: 140,
      reaction: idle * 1000,
      label: this.glyph(slot),
    });
    this.reset(w);
  }

  protected modeSolution(): LabSolution {
    const ready = this.wheels.filter((w) => !w.locked && w.readyAt >= 0);
    if (!ready.length) return { wait: true };
    // Oldest first: the one closest to being wasted is the one that matters.
    const first = ready.reduce((a, b) => (a.readyAt <= b.readyAt ? a : b));
    return { keys: [first.slot] };
  }

  protected slotName(slot: AbilitySlot): string {
    const w = this.wheels.find((x) => x.slot === slot);
    if (!w) return '';
    return w.locked ? 'LOCKED' : w.readyAt >= 0 ? 'UP' : 'FILLING';
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    this.paintBench(out, this.wheels.map((w) => w.pad));
    for (const w of this.wheels) {
      const period = this.periodOf(w);
      const ready = w.readyAt >= 0;
      const burn = ready ? clamp(1 - (this.s.elapsed - w.readyAt) / this.grace, 0, 1) : 0;
      const color = w.locked ? PALETTE.danger : ready ? (burn < 0.35 ? PALETTE.warn : PALETTE.good) : PALETTE.textFaint;
      this.paintPad(out, w.pad, {
        color,
        glow: w.locked ? 0.4 : ready ? 0.5 + burn * 0.5 : 0.06 + clamp(w.t / period, 0, 1) * 0.2,
        progress: w.locked ? undefined : ready ? burn : clamp(w.t / period, 0, 1),
        barred: w.locked,
        sub: w.locked ? 'HANDS OFF' : ready ? 'SPEND' : undefined,
      });
    }
    const up = this.wheels.filter((w) => w.readyAt >= 0 && !w.locked).length;
    this.paintCaption(
      out,
      up > 0 ? `${up} UP` : 'FILLING',
      `spend inside ${Math.round(this.grace * 1000)}ms of coming up`,
      up > 1 ? PALETTE.warn : PALETTE.textDim,
    );
  }

  protected modeField(): HudField {
    const idle = mean(this.idles);
    return {
      label: 'SPENT IN',
      value: this.idles.length ? `${Math.round(idle)}ms` : '—',
      bar: clamp(1 - idle / (this.grace * 1000), 0, 1),
      tone: idle < 260 ? 'good' : idle < 520 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    return {
      tempo: clamp(speed * 0.45 + performance * 0.55, 0, 1),
      combat: clamp(accuracy * 0.4 + performance * 0.6, 0, 1),
      targeting: performance,
    };
  }

  protected modeMetrics(): KeyMetric[] {
    const offered = this.hits + this.wasted;
    return [
      pct('spent', 'WHEELS SPENT', this.hits / Math.max(1, offered)),
      ms('idle', 'LEFT STANDING', mean(this.idles)),
      count('wasted', 'WHEELS WASTED', this.wasted, 'lower'),
      count('early', 'PRESSED EARLY', this.earlies, 'lower'),
      count('lockBreaks', 'LOCKS BROKEN', this.lockBreaks, 'lower'),
    ];
  }

  protected notes() {
    const idle = mean(this.idles);
    return {
      helped: this.idles.length > 8 && idle < 240 ? [`Wheels go out ${Math.round(idle)}ms after coming up.`] : [],
      hurt: this.wasted > this.hits * 0.25 ? [`${this.wasted} wheels filled and expired without you.`] : [],
      advice:
        this.wasted > this.hits * 0.25
          ? 'Watch the two slow wheels. The fast one trains your eye to the left of the bench and the slow ones expire out of frame.'
          : this.earlies > this.hits * 0.3
            ? 'You are pressing on hope. An early press is thrown away entirely — wait for the ring to close.'
            : this.lockBreaks > 2
              ? 'A locked wheel is not a wheel you are late on. Take your hand off it and let the lock run out.'
              : null,
    };
  }
}
