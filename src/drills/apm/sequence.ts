import type { AbilitySlot } from '../../engine/input';
import { clamp } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { Vec2 } from '../../engine/types';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, ms, pct } from '../base';
import { APM_TARGET_APM } from './engine';
import { BANK_LABEL, BANK_OF, LabDrill, median, type Bank, type LabSolution, type Pad } from './lab';

const ALL_SLOTS: AbilitySlot[] = ['q', 'w', 'e', 'r', 'd', 'f'];

/**
 * SEQUENCE — the queue, and the eye that runs ahead of the hand.
 *
 * Six keys roll across the bench and only the front one is legal. Answer it
 * and the queue advances; answer anything else and the chain is gone. The
 * window shrinks as the chain grows, so the mode converges on the fastest
 * cadence you can actually hold rather than the fastest one you can reach for
 * a second and a half.
 *
 * The queue — rather than a single prompt — is the whole design. It puts your
 * eyes two keys ahead of your fingers and keeps them there, which is the habit
 * that makes a long input come out clean when you are not thinking about it.
 *
 * Transfer: a five-key combo arriving in the right order at speed.
 */
export class ApmSequenceDrill extends LabDrill {
  protected readonly targetApm = APM_TARGET_APM.apmSequence;

  private pads: Pad[] = [];
  private queue: AbilitySlot[] = [];
  private shownAt = 0;
  private window = 1.2;
  private wrongKeys = 0;
  private lateKeys = 0;
  private gaps: number[] = [];
  private lastHitAt = 0;

  protected build(): void {
    this.pads = this.row(ALL_SLOTS, { gap: 150, radius: 52, y: this.centre.y + 130 });
    for (let i = 0; i < 6; i++) this.push();
    this.arm();
  }

  /** Never the same key twice running: this is coordination, not a trill. */
  private push(): void {
    let pick = this.s.rng.pick(ALL_SLOTS);
    const last = this.queue[this.queue.length - 1];
    let guard = 0;
    while (pick === last && guard++ < 8) pick = this.s.rng.pick(ALL_SLOTS);
    this.queue.push(pick);
  }

  private arm(): void {
    this.shownAt = this.s.elapsed;
    this.window = clamp((1.25 - this.d * 0.42) / this.tempo, 0.3, 1.4);
  }

  private advance(): void {
    this.queue.shift();
    this.push();
    this.arm();
  }

  protected tick(_dt: number): void {
    if (this.s.elapsed - this.shownAt <= this.window) return;
    this.lateKeys++;
    this.fumble(this.centre, 'TOO SLOW', { input: false, cost: 50 });
    this.advance();
  }

  onAbility(slot: AbilitySlot): void {
    this.press(slot);
    const expected = this.queue[0];
    const age = this.s.elapsed - this.shownAt;
    const pad = this.pads[ALL_SLOTS.indexOf(slot)] ?? { pos: this.centre };

    if (slot !== expected) {
      this.wrongKeys++;
      this.fumble(pad.pos, `WRONG · ${this.glyph(expected)}`);
      this.advance();
      return;
    }
    if (this.lastHitAt > 0) this.gaps.push((this.s.elapsed - this.lastHitAt) * 1000);
    this.lastHitAt = this.s.elapsed;
    this.hit(pad.pos, {
      quality: clamp(1 - age / this.window, 0, 1),
      value: 85,
      reaction: age * 1000,
      label: this.glyph(slot),
    });
    this.advance();
  }

  protected onBenchClick(pos: Vec2): void {
    // The mouse has no job in this mode, and pretending otherwise costs APM.
    this.stray(pos);
  }

  solution(): LabSolution {
    return { keys: [this.queue[0]] };
  }

  protected slotName(slot: AbilitySlot): string {
    return this.queue[0] === slot ? 'NEXT' : '';
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    const c = this.centre;
    const left = clamp(1 - (this.s.elapsed - this.shownAt) / this.window, 0, 1);
    out.billboards.push({
      kind: 'keys',
      x: c.x,
      y: c.y - 120,
      seq: this.queue.slice(0, 5).map((k) => this.glyph(k)),
      labels: this.queue.slice(0, 5).map(() => ''),
      index: 0,
      progress: left,
    });
    this.paintBench(out, this.pads);
    const head = this.queue[0];
    this.pads.forEach((pad, i) => {
      const on = ALL_SLOTS[i] === head;
      this.paintPad(out, pad, {
        color: on ? (left < 0.3 ? PALETTE.danger : this.flow.color) : PALETTE.textFaint,
        glow: on ? 0.5 + left * 0.5 : 0.05,
        progress: on ? left : undefined,
      });
    });
  }

  protected modeField(): HudField {
    const gap = median(this.gaps);
    return {
      label: 'KEY GAP',
      value: gap ? `${Math.round(gap)}ms` : '—',
      bar: clamp(1 - gap / 900, 0, 1),
      tone: gap && gap < 300 ? 'good' : gap && gap < 520 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    return {
      tempo: clamp(speed * 0.55 + performance * 0.45, 0, 1),
      targeting: clamp(accuracy * 0.6 + performance * 0.4, 0, 1),
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [
      ms('gap', 'TIME PER KEY', median(this.gaps)),
      count('wrong', 'WRONG KEYS', this.wrongKeys, 'lower'),
      count('late', 'KEYS MISSED', this.lateKeys, 'lower'),
    ];
  }

  protected notes() {
    const gap = median(this.gaps);
    return {
      helped: gap > 0 && gap < 260 ? [`About ${Math.round(gap)}ms between keys — that is a trained hand.`] : [],
      hurt: this.wrongKeys > this.hits * 0.15 ? ['Wrong keys, not slow keys, are what is costing you here.'] : [],
      advice:
        this.wrongKeys > this.hits * 0.15
          ? 'Read two keys ahead and let your fingers pre-position. Reading one at a time is what produces the wrong key.'
          : gap > 480
            ? 'Rest your fingers on the row between prompts. Returning to a home position after every key is the cost you are paying.'
            : null,
    };
  }
}

interface SwitchPrompt {
  bank: Bank;
  slot: AbilitySlot | null;
}

/**
 * SWITCH — what it costs to move your hand.
 *
 * Three places an input can come from: the near bank your fingers rest on, the
 * far bank they have to stretch for, and the mouse. A prompt names one, you
 * answer it, and the next prompt is usually somewhere else. The higher the
 * rung, the more often it is somewhere else.
 *
 * The mode exists for one number, and the number is not the rate: it is the
 * difference between how long you take when the next input is under the finger
 * already there and how long you take when it is not. That gap is the cost of
 * a hand change in milliseconds, it is trainable, and almost nobody has ever
 * seen their own.
 *
 * Transfer: the summoner key mid-combo. It is not a harder key, it is a
 * different hand shape, and the shape is what you are paying for.
 */
export class ApmSwitchDrill extends LabDrill {
  protected readonly targetApm = APM_TARGET_APM.apmSwitch;

  private nearPads: Pad[] = [];
  private farPads: Pad[] = [];
  private mousePad!: Pad;
  private prompt: SwitchPrompt = { bank: 'near', slot: 'q' };
  private shownAt = 0;
  private window = 1.1;
  private lastBank: Bank | null = null;
  private sameGaps: number[] = [];
  private switchGaps: number[] = [];
  private wrong = 0;
  private missed = 0;
  private lastHitAt = 0;
  private lastWasSwitch = false;

  protected build(): void {
    const c = this.centre;
    this.nearPads = this.row(['q', 'w', 'e'], { gap: 150, radius: 54, y: c.y + 170 });
    this.farPads = this.row(['r', 'd', 'f'], { gap: 150, radius: 54, y: c.y - 170 });
    this.mousePad = { slot: null, pos: { x: c.x, y: c.y }, radius: 92 };
    this.next(true);
  }

  private next(first = false): void {
    const banks: Bank[] = ['near', 'far', 'mouse'];
    const switching = first ? true : this.s.rng.chance(0.45 + this.d * 0.4);
    const from = this.prompt.bank;
    const pool = switching ? banks.filter((b) => b !== from) : [from];
    const bank = this.s.rng.pick(pool);
    const slot =
      bank === 'near'
        ? this.s.rng.pick(['q', 'w', 'e'] as AbilitySlot[])
        : bank === 'far'
          ? this.s.rng.pick(['r', 'd', 'f'] as AbilitySlot[])
          : null;
    this.lastWasSwitch = !first && bank !== from;
    this.prompt = { bank, slot };
    this.shownAt = this.s.elapsed;
    this.window = clamp((1.35 - this.d * 0.5) / this.tempo, 0.32, 1.5);
  }

  protected tick(_dt: number): void {
    if (this.s.elapsed - this.shownAt <= this.window) return;
    this.missed++;
    this.fumble(this.promptPos(), 'TOO SLOW', { input: false, cost: 50 });
    this.next();
  }

  private promptPos(): Vec2 {
    const p = this.prompt;
    if (p.bank === 'mouse') return this.mousePad.pos;
    const pads = p.bank === 'near' ? this.nearPads : this.farPads;
    return pads.find((pad) => pad.slot === p.slot)?.pos ?? this.centre;
  }

  /** One answered prompt, whichever hand answered it. */
  private answer(at: Vec2, label: string): void {
    const age = this.s.elapsed - this.shownAt;
    if (this.lastHitAt > 0) {
      const gap = (this.s.elapsed - this.lastHitAt) * 1000;
      (this.lastWasSwitch ? this.switchGaps : this.sameGaps).push(gap);
    }
    this.lastHitAt = this.s.elapsed;
    this.lastBank = this.prompt.bank;
    this.hit(at, {
      quality: clamp(1 - age / this.window, 0, 1),
      value: this.lastWasSwitch ? 105 : 80,
      reaction: age * 1000,
      label,
    });
    this.next();
  }

  onAbility(slot: AbilitySlot): void {
    this.press(slot);
    if (this.prompt.slot !== slot) {
      this.wrong++;
      this.fumble(this.promptPos(), this.prompt.bank === 'mouse' ? 'MOUSE' : `WRONG · ${this.glyph(this.prompt.slot!)}`);
      this.next();
      return;
    }
    this.answer(this.promptPos(), this.glyph(slot));
  }

  protected onBenchClick(pos: Vec2): void {
    if (this.prompt.bank !== 'mouse') {
      this.wrong++;
      this.fumble(pos, 'KEYS');
      this.next();
      return;
    }
    if (!this.padAt([this.mousePad], pos)) {
      this.stray(pos);
      return;
    }
    this.answer(this.mousePad.pos, 'CLICK');
  }

  solution(): LabSolution {
    return this.prompt.slot ? { keys: [this.prompt.slot] } : { click: this.mousePad.pos };
  }

  protected slotName(slot: AbilitySlot): string {
    return BANK_OF[slot] === 'near' ? 'NEAR' : 'FAR';
  }

  /** The cost of a hand change, in milliseconds. The whole point of the mode. */
  private switchCost(): number {
    const a = median(this.switchGaps);
    const b = median(this.sameGaps);
    return a > 0 && b > 0 ? Math.max(0, a - b) : 0;
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    const left = clamp(1 - (this.s.elapsed - this.shownAt) / this.window, 0, 1);
    const live = this.flow.color;
    const dead = PALETTE.textFaint;
    this.paintBench(out, this.nearPads);
    this.paintBench(out, this.farPads);
    for (const pad of [...this.nearPads, ...this.farPads]) {
      const on = pad.slot === this.prompt.slot;
      this.paintPad(out, pad, {
        color: on ? (left < 0.3 ? PALETTE.danger : live) : dead,
        glow: on ? 0.5 + left * 0.5 : 0.05,
        progress: on ? left : undefined,
      });
    }
    const mouseOn = this.prompt.bank === 'mouse';
    this.paintPad(out, this.mousePad, {
      color: mouseOn ? (left < 0.3 ? PALETTE.danger : live) : dead,
      glow: mouseOn ? 0.45 + left * 0.5 : 0.04,
      progress: mouseOn ? left : undefined,
      text: 'CLICK',
    });
    const cost = this.switchCost();
    this.paintCaption(
      out,
      BANK_LABEL[this.prompt.bank],
      cost > 0 ? `hand change costs you ${Math.round(cost)}ms` : 'answer where the light is',
      this.lastWasSwitch ? PALETTE.warn : PALETTE.textDim,
    );
  }

  protected modeField(): HudField {
    const cost = this.switchCost();
    return {
      label: 'SWITCH COST',
      value: cost > 0 ? `${Math.round(cost)}ms` : '—',
      bar: clamp(1 - cost / 320, 0, 1),
      tone: cost && cost < 90 ? 'good' : cost && cost < 190 ? 'warn' : cost ? 'bad' : 'neutral',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    return {
      tempo: clamp(speed * 0.5 + performance * 0.5, 0, 1),
      targeting: clamp(accuracy * 0.5 + performance * 0.5, 0, 1),
    };
  }

  protected modeMetrics(): KeyMetric[] {
    const switches = this.switchGaps.length;
    return [
      ms('switchCost', 'COST OF A HAND CHANGE', this.switchCost()),
      ms('switchGap', 'AFTER A SWITCH', median(this.switchGaps)),
      ms('sameGap', 'SAME BANK', median(this.sameGaps)),
      pct('switchShare', 'PROMPTS THAT SWITCHED', switches / Math.max(1, switches + this.sameGaps.length)),
      count('wrong', 'WRONG BANK', this.wrong, 'lower'),
      count('missed', 'PROMPTS MISSED', this.missed, 'lower'),
    ];
  }

  protected notes() {
    const cost = this.switchCost();
    void this.lastBank;
    return {
      helped: cost > 0 && cost < 80 ? [`A hand change costs you only ${Math.round(cost)}ms.`] : [],
      hurt: cost > 200 ? [`A hand change costs you ${Math.round(cost)}ms — that is a whole extra input's worth.`] : [],
      advice:
        cost > 200
          ? 'Move the hand on the prompt, not on the press. The stretch should already be happening while you are reading.'
          : this.wrong > this.hits * 0.15
            ? 'You are answering the bank you were already in. Read the caption before the glyph.'
            : null,
    };
  }
}
