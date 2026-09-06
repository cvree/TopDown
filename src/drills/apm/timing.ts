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
import { LabDrill, mean, median, type LabSolution, type Pad } from './lab';

const GATE_SLOT: AbilitySlot = 'q';

/**
 * BUFFER — pressing into a window that has not opened yet.
 *
 * A shutter runs on a clock you can see. It opens, and the press has to be
 * already on its way when it does: land inside the last fraction of a second
 * before the opening and the input is BUFFERED, which is the whole point of
 * the mode. Land after it and you merely REACTED — it still counts, at about a
 * third of the payout, because reacting to a window you could have predicted
 * is the habit this drill exists to break. Land too early and the input is
 * eaten, exactly as an early press is eaten by the game.
 *
 * Nothing here is a reaction test. The clock is visible, slightly irregular so
 * it cannot be played from memory alone, and the buffer closes from a third of
 * a second down to under a tenth as the rung climbs.
 *
 * Transfer: queueing the next cast into the tail of the current one, and
 * hitting an ability on the frame its cooldown ends rather than a beat later.
 */
export class ApmBufferDrill extends LabDrill {
  protected readonly targetApm = APM_TARGET_APM.apmBuffer;

  private pad!: Pad;
  private openAt = 0;
  private cycle = 1.2;
  private done = false;
  /** After a gate resolves, the beat before the next one starts filling. */
  private restUntil = 0;
  private buffered = 0;
  private reacted = 0;
  private early = 0;
  private missed = 0;
  private leads: number[] = [];

  /** How far ahead of the opening a press still counts as buffered. */
  private get buffer(): number {
    return clamp(0.36 - this.d * 0.24, 0.085, 0.36);
  }

  /** How long after the opening a late press is still worth something. */
  private get grace(): number {
    return 0.34;
  }

  protected build(): void {
    const c = this.centre;
    this.pad = this.drift({ slot: GATE_SLOT, pos: { x: c.x, y: c.y }, radius: 96 });
    this.schedule();
  }

  private schedule(): void {
    this.cycle =
      clamp((1.25 - this.d * 0.45) / Math.max(0.85, this.tempo * 0.8), 0.5, 1.4) * this.s.rng.range(0.9, 1.12);
    this.openAt = this.s.elapsed + this.cycle;
    this.done = false;
  }

  /** One gate finished, one way or another. */
  private resolve(): void {
    this.done = true;
    this.restUntil = this.s.elapsed + 0.26;
  }

  protected tick(_dt: number): void {
    if (this.done) {
      if (this.s.elapsed >= this.restUntil) this.schedule();
      return;
    }
    if (this.s.elapsed >= this.openAt + this.grace) {
      this.missed++;
      this.fumble(this.pad.pos, 'MISSED', { input: false, cost: 60 });
      this.resolve();
    }
  }

  protected onKey(slot: AbilitySlot): void {
    this.press(slot);
    if (slot !== GATE_SLOT) {
      this.stray(this.pad.pos);
      return;
    }
    if (this.done) {
      // The gate has already been paid. A second press is a wasted input.
      this.stray(this.pad.pos);
      return;
    }
    const lead = this.openAt - this.s.elapsed;
    const buffer = this.buffer;

    if (lead > buffer) {
      this.early++;
      this.resolve();
      this.fumble(this.pad.pos, `EARLY · ${Math.round(lead * 1000)}ms`);
      return;
    }
    this.resolve();
    if (lead >= 0) {
      this.buffered++;
      this.leads.push(lead * 1000);
      this.hit(this.pad.pos, {
        // Everything inside the buffer is a perfect: the window *is* the
        // standard, and shaving it finer is not a better input.
        quality: clamp(0.78 + (1 - lead / buffer) * 0.22, 0, 1),
        value: 200,
        color: PALETTE.good,
        label: `BUFFERED · ${Math.round(lead * 1000)}ms`,
      });
      return;
    }
    const late = -lead;
    this.reacted++;
    this.hit(this.pad.pos, {
      quality: clamp(0.3 * (1 - late / this.grace), 0, 1),
      value: 70,
      reaction: late * 1000,
      color: PALETTE.warn,
      label: `REACTED · ${Math.round(late * 1000)}ms`,
    });
  }

  protected modeSolution(): LabSolution {
    if (this.done) return { wait: true };
    const lead = this.openAt - this.s.elapsed;
    // Correct play is silence until the shutter is inside the buffer.
    return lead > this.buffer * 0.55 ? { wait: true } : { keys: [GATE_SLOT] };
  }

  protected slotName(slot: AbilitySlot): string {
    return slot === GATE_SLOT ? 'GATE' : '';
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    const c = this.centre;
    const lead = this.openAt - this.s.elapsed;
    const fill = clamp(1 - lead / this.cycle, 0, 1);
    const inBuffer = lead <= this.buffer && lead >= 0;
    const open = lead < 0;
    const color = this.done ? PALETTE.textFaint : open ? PALETTE.warn : inBuffer ? PALETTE.good : this.flow.color;

    this.paintPad(out, this.pad, {
      color,
      glow: this.done ? 0.05 : inBuffer ? 1 : open ? 0.6 : 0.15 + fill * 0.35,
      text: this.glyph(GATE_SLOT),
      sub: this.done ? 'SPENT' : open ? 'OPEN' : inBuffer ? 'NOW' : 'WAIT',
    });
    // The sweep: a ring that closes onto the shutter, and a fixed band showing
    // exactly where the buffer starts. The band is the thing to aim at.
    out.markers.push({
      kind: 'ring',
      x: c.x,
      y: c.y,
      radius: this.pad.radius + 40,
      color,
      alpha: 0.85,
      width: 5,
      progress: fill,
      rise: 0.9,
    });
    out.markers.push({
      kind: 'ring',
      x: c.x,
      y: c.y,
      radius: this.pad.radius + 40,
      color: PALETTE.good,
      alpha: 0.35,
      width: 12,
      progress: clamp(this.buffer / this.cycle, 0, 1),
      dash: 4,
      rise: 0.7,
    });
    this.paintCaption(
      out,
      'BUFFER',
      `be pressing inside the last ${Math.round(this.buffer * 1000)}ms`,
      PALETTE.textDim,
    );
  }

  protected modeField(): HudField {
    const share = this.buffered / Math.max(1, this.buffered + this.reacted + this.early + this.missed);
    return {
      label: 'BUFFERED',
      value: `${Math.round(share * 100)}%`,
      bar: share,
      tone: share > 0.7 ? 'good' : share > 0.45 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    void speed;
    return {
      tempo: clamp(performance * 0.75 + accuracy * 0.25, 0, 1),
      lastHitting: clamp(performance * 0.6 + accuracy * 0.4, 0, 1),
    };
  }

  protected modeMetrics(): KeyMetric[] {
    const gates = this.buffered + this.reacted + this.early + this.missed;
    return [
      pct('bufferShare', 'GATES BUFFERED', this.buffered / Math.max(1, gates)),
      ms('lead', 'LEAD ON THE OPENING', mean(this.leads)),
      count('reacted', 'REACTED INSTEAD', this.reacted, 'lower'),
      count('early', 'EATEN AS EARLY', this.early, 'lower'),
      count('missed', 'GATES MISSED', this.missed, 'lower'),
    ];
  }

  protected notes() {
    const gates = this.buffered + this.reacted + this.early + this.missed;
    const share = this.buffered / Math.max(1, gates);
    return {
      helped: share > 0.7 ? ['Most of your inputs were already moving before the gate opened.'] : [],
      hurt: this.early > this.buffered * 0.5 ? ['You are guessing rather than anticipating — the early presses cost as much as the late ones.'] : [],
      advice:
        this.reacted > this.buffered
          ? 'You are waiting to see the opening. Watch the sweep instead and start the press while it is still closing.'
          : this.early > this.buffered * 0.5
            ? 'Back off about a tenth of a second. The buffer is generous; anything before it is thrown away entirely.'
            : null,
    };
  }
}

const START_SLOT: AbilitySlot = 'q';
const CUT_SLOT: AbilitySlot = 'e';
type CancelPhase = 'call' | 'commit' | 'cut' | 'rest';

/**
 * CANCEL — the second press that has to arrive at a particular moment.
 *
 * Press START and a bar begins to run. The first stretch is committed: a cut
 * inside it throws the whole thing away. The second stretch is the cut window,
 * and the CUT key has to land inside it — early is a fumble, late is an
 * overrun, and the window narrows to about a tenth of a second at the top of
 * the ladder.
 *
 * Two presses to a repetition, one of them free and one of them not. What is
 * isolated here is the pairing: the input that only means anything relative to
 * an input you already made, which is a different motor problem from any
 * single prompt and the one most people are worst at.
 *
 * Transfer: cutting a backswing the instant it is free, and every animation
 * cancel that is really two presses pretending to be one.
 */
export class ApmCancelDrill extends LabDrill {
  protected readonly targetApm = APM_TARGET_APM.apmCancel;

  private startPad!: Pad;
  private cutPad!: Pad;
  private phase: CancelPhase = 'call';
  private phaseAt = 0;
  private callWindow = 1.1;
  private cancels = 0;
  private earlyCuts = 0;
  private overruns = 0;
  private slowStarts = 0;
  private cutLeads: number[] = [];

  private get commit(): number {
    return clamp(0.36 - this.d * 0.14, 0.15, 0.36);
  }

  private get cutWindow(): number {
    return clamp(0.4 - this.d * 0.26, 0.1, 0.4);
  }

  protected build(): void {
    const c = this.centre;
    this.startPad = this.drift({ slot: START_SLOT, pos: { x: c.x - 190, y: c.y }, radius: 78 });
    this.cutPad = this.drift({ slot: CUT_SLOT, pos: { x: c.x + 190, y: c.y }, radius: 78 });
    this.toCall();
  }

  private toCall(): void {
    this.phase = 'call';
    this.phaseAt = this.s.elapsed;
    this.callWindow = clamp((1.3 - this.d * 0.45) / this.tempo, 0.34, 1.4);
  }

  private get age(): number {
    return this.s.elapsed - this.phaseAt;
  }

  protected tick(_dt: number): void {
    switch (this.phase) {
      case 'call':
        if (this.age > this.callWindow) {
          this.slowStarts++;
          this.fumble(this.startPad.pos, 'NO START', { input: false, cost: 40 });
          this.toCall();
        }
        break;
      case 'commit':
        if (this.age >= this.commit) {
          this.phase = 'cut';
          this.phaseAt = this.s.elapsed;
          audio.play('abilityReady', { intensity: 0.6 });
        }
        break;
      case 'cut':
        if (this.age > this.cutWindow) {
          this.overruns++;
          this.fumble(this.cutPad.pos, 'OVERRAN', { input: false, cost: 70 });
          this.phase = 'rest';
          this.phaseAt = this.s.elapsed;
        }
        break;
      case 'rest':
        if (this.age > 0.24) this.toCall();
        break;
    }
  }

  protected onKey(slot: AbilitySlot): void {
    this.press(slot);
    if (slot !== START_SLOT && slot !== CUT_SLOT) {
      this.stray(this.centre);
      return;
    }
    if (this.phase === 'rest') {
      this.stray(this.centre);
      return;
    }
    if (this.phase === 'call') {
      if (slot !== START_SLOT) {
        this.fumble(this.cutPad.pos, 'NOTHING TO CUT');
        this.toCall();
        return;
      }
      this.hit(this.startPad.pos, {
        quality: clamp(1 - this.age / this.callWindow, 0, 1),
        value: 55,
        reaction: this.age * 1000,
        label: 'START',
      });
      this.phase = 'commit';
      this.phaseAt = this.s.elapsed;
      return;
    }
    if (slot === START_SLOT) {
      // Re-issuing the order you already gave is the click-speed inflation the
      // engine exists to refuse to pay for.
      this.stray(this.startPad.pos);
      return;
    }
    if (this.phase === 'commit') {
      this.earlyCuts++;
      this.fumble(this.cutPad.pos, 'CUT EARLY');
      this.phase = 'rest';
      this.phaseAt = this.s.elapsed;
      return;
    }
    const lead = this.age * 1000;
    this.cutLeads.push(lead);
    this.cancels++;
    this.hit(this.cutPad.pos, {
      quality: clamp(1 - this.age / this.cutWindow, 0, 1),
      value: 165,
      label: `CANCELLED · ${Math.round(lead)}ms`,
    });
    this.phase = 'rest';
    this.phaseAt = this.s.elapsed;
  }

  protected modeSolution(): LabSolution {
    switch (this.phase) {
      case 'call':
        return { keys: [START_SLOT] };
      case 'cut':
        return { keys: [CUT_SLOT] };
      default:
        return { wait: true };
    }
  }

  protected slotName(slot: AbilitySlot): string {
    return slot === START_SLOT ? 'START' : slot === CUT_SLOT ? 'CUT' : '';
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    const c = this.centre;
    const calling = this.phase === 'call';
    const cutting = this.phase === 'cut';
    const committing = this.phase === 'commit';

    this.paintPad(out, this.startPad, {
      color: calling ? this.flow.color : PALETTE.textFaint,
      glow: calling ? 0.55 + clamp(1 - this.age / this.callWindow, 0, 1) * 0.45 : 0.05,
      progress: calling ? clamp(1 - this.age / this.callWindow, 0, 1) : undefined,
      sub: 'START',
    });
    this.paintPad(out, this.cutPad, {
      color: cutting ? PALETTE.good : committing ? PALETTE.danger : PALETTE.textFaint,
      glow: cutting ? 1 : committing ? 0.35 : 0.05,
      progress: cutting ? clamp(1 - this.age / this.cutWindow, 0, 1) : undefined,
      barred: committing,
      sub: cutting ? 'CUT NOW' : committing ? 'COMMITTED' : 'CUT',
    });

    // The bar itself: committed stretch in danger, cut window in green, and a
    // head running along it. The shape is the teaching.
    if (committing || cutting) {
      const total = this.commit + this.cutWindow;
      const done = committing ? this.age : this.commit + this.age;
      const x0 = c.x - 260;
      const x1 = c.x + 260;
      const split = x0 + (x1 - x0) * (this.commit / total);
      out.markers.push({
        kind: 'line',
        x: x0,
        y: c.y - 150,
        x2: split,
        y2: c.y - 150,
        halfWidth: 11,
        color: PALETTE.danger,
        alpha: 0.55,
        rise: 0.5,
      });
      out.markers.push({
        kind: 'line',
        x: split,
        y: c.y - 150,
        x2: x1,
        y2: c.y - 150,
        halfWidth: 11,
        color: PALETTE.good,
        alpha: 0.55,
        rise: 0.5,
      });
      const head = x0 + (x1 - x0) * clamp(done / total, 0, 1);
      out.markers.push({
        kind: 'line',
        x: head,
        y: c.y - 178,
        x2: head,
        y2: c.y - 122,
        halfWidth: 4,
        color: PALETTE.text,
        alpha: 0.95,
        rise: 0.8,
      });
    }
    this.paintCaption(
      out,
      cutting ? 'CUT' : committing ? 'COMMITTED' : 'START',
      `cut window ${Math.round(this.cutWindow * 1000)}ms`,
      cutting ? PALETTE.good : committing ? PALETTE.danger : PALETTE.textDim,
    );
  }

  protected modeField(): HudField {
    const reps = this.cancels + this.earlyCuts + this.overruns;
    const rate = this.cancels / Math.max(1, reps);
    return {
      label: 'CANCELLED',
      value: `${Math.round(rate * 100)}%`,
      bar: rate,
      tone: rate > 0.8 ? 'good' : rate > 0.55 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    return {
      tempo: clamp(speed * 0.45 + performance * 0.55, 0, 1),
      kiting: clamp(accuracy * 0.45 + performance * 0.55, 0, 1),
    };
  }

  protected modeMetrics(): KeyMetric[] {
    const reps = this.cancels + this.earlyCuts + this.overruns;
    return [
      pct('cancelRate', 'CANCELS LANDED', this.cancels / Math.max(1, reps)),
      ms('cutLead', 'INTO THE CUT WINDOW', median(this.cutLeads)),
      count('early', 'CUT TOO EARLY', this.earlyCuts, 'lower'),
      count('over', 'OVERRAN', this.overruns, 'lower'),
      count('noStart', 'STARTS MISSED', this.slowStarts, 'lower'),
    ];
  }

  protected notes() {
    const lead = median(this.cutLeads);
    return {
      helped: this.cancels > 8 && lead > 0 && lead < 90 ? [`You cut ${Math.round(lead)}ms into the window — as early as it is legal to be.`] : [],
      hurt: this.earlyCuts > this.cancels * 0.4 ? ['You are cutting before the commit is over, which throws the whole repetition away.'] : [],
      advice:
        this.earlyCuts > this.cancels * 0.4
          ? 'Wait for the bar to cross into green. Cutting early is worse than cutting late — one costs the input, the other costs the timing.'
          : this.overruns > this.cancels * 0.4
            ? 'The second press has to be loaded while the first is still running. Do not start reaching for it after the window opens.'
            : null,
    };
  }
}
