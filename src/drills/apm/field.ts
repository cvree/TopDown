import { audio } from '../../engine/audio';
import type { AbilitySlot } from '../../engine/input';
import { clamp, dist } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { Vec2 } from '../../engine/types';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, ms, pct, units } from '../base';
import { APM_TARGET_APM } from './engine';
import { LabDrill, median, type LabSolution, type Pad } from './lab';

interface LivePad {
  pad: Pad;
  born: number;
  ttl: number;
}

/**
 * FIELD — the mouse half of a command, with nothing attached to it.
 *
 * Pads light across the floor and go out again. Put the cursor inside one and
 * click. That is all, and the absence of everything else is deliberate: there
 * is no champion under the pad, no health bar on it, nothing to decide about
 * it and no consequence for it beyond whether your hand arrived.
 *
 * It is graded in units from the centre rather than as a yes or no, and the
 * pads shrink as the chain grows, so the mode always asks for the smallest
 * target you have just proved you can hit. Clicking the floor is a stray: an
 * input you paid for and did not get.
 *
 * Transfer: the ceiling on every command that starts with the cursor being
 * somewhere. You cannot click a champion faster than you can click a circle.
 */
export class ApmFieldDrill extends LabDrill {
  protected readonly targetApm = APM_TARGET_APM.apmField;

  private live: LivePad[] = [];
  private spawnCd = 0.2;
  private errors: number[] = [];
  private gaps: number[] = [];
  private lastHitAt = 0;
  private missed = 0;

  protected build(): void {
    this.spawnCd = 0.2;
  }

  /** Smaller the hotter you are: the mode chases the hand it is watching. */
  private radius(): number {
    return clamp(86 - this.d * 26 - this.heat * 22, 32, 90);
  }

  private concurrency(): number {
    return this.d > 0.55 ? 3 : 2;
  }

  private spawn(): void {
    const radius = this.radius();
    const pos = this.randomPoint(this.live[this.live.length - 1]?.pad.pos ?? null, 190, 130);
    this.live.push({
      pad: { slot: null, pos, radius },
      born: this.s.elapsed,
      ttl: clamp((2.1 - this.d * 0.75) / this.tempo, 0.55, 2.2),
    });
    this.s.fx.ring(pos.x, pos.y, radius * 2.4, radius, 0.22, this.flow.color, 2, 'range');
  }

  protected tick(dt: number): void {
    this.spawnCd -= dt;
    if (this.spawnCd <= 0 && this.live.length < this.concurrency()) {
      this.spawnCd = clamp(0.62 / this.tempo, 0.16, 0.7);
      this.spawn();
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      const m = this.live[i];
      if (this.s.elapsed - m.born <= m.ttl) continue;
      this.live.splice(i, 1);
      this.missed++;
      this.fumble(m.pad.pos, 'GONE', { input: false, cost: 40 });
    }
  }

  protected onBenchClick(pos: Vec2): void {
    let idx = -1;
    let bd = Infinity;
    for (let i = 0; i < this.live.length; i++) {
      const d = dist(pos, this.live[i].pad.pos);
      if (d <= this.live[i].pad.radius && d < bd) {
        bd = d;
        idx = i;
      }
    }
    if (idx < 0) {
      this.stray(pos);
      return;
    }
    const m = this.live[idx];
    this.live.splice(idx, 1);
    this.errors.push(bd);
    if (this.lastHitAt > 0) this.gaps.push((this.s.elapsed - this.lastHitAt) * 1000);
    this.lastHitAt = this.s.elapsed;
    const age = this.s.elapsed - m.born;
    this.hit(m.pad.pos, {
      quality: clamp(1 - bd / m.pad.radius, 0, 1) * 0.6 + clamp(1 - age / m.ttl, 0, 1) * 0.4,
      value: 90,
      reaction: age * 1000,
      label: bd < m.pad.radius * 0.28 ? 'CENTRE' : undefined,
    });
  }

  onAbility(): void {
    // Nothing on this bench answers to a key.
    this.stray(this.centre);
  }

  solution(): LabSolution {
    if (!this.live.length) return { wait: true };
    const oldest = this.live.reduce((a, b) => (a.born <= b.born ? a : b));
    return { click: oldest.pad.pos };
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    for (const m of this.live) {
      const left = clamp(1 - (this.s.elapsed - m.born) / m.ttl, 0, 1);
      this.paintPad(out, m.pad, {
        color: left < 0.3 ? PALETTE.danger : this.flow.color,
        glow: 0.35 + left * 0.5,
        progress: left,
        text: '',
      });
    }
  }

  protected modeField(): HudField {
    const err = median(this.errors);
    return {
      label: 'OFF CENTRE',
      value: this.errors.length ? `${Math.round(err)}u` : '—',
      bar: clamp(1 - err / 90, 0, 1),
      tone: err < 26 ? 'good' : err < 52 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    return {
      tempo: clamp(speed * 0.55 + performance * 0.45, 0, 1),
      aim: clamp(accuracy * 0.5 + clamp(1 - median(this.errors) / 90, 0, 1) * 0.5, 0, 1),
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [
      units('err', 'OFF CENTRE', median(this.errors)),
      ms('gap', 'TIME PER CLICK', median(this.gaps)),
      count('missed', 'PADS MISSED', this.missed, 'lower'),
      count('stray', 'CLICKS ON NOTHING', this.strays, 'lower'),
    ];
  }

  protected notes() {
    const err = median(this.errors);
    return {
      helped: this.errors.length > 10 && err < 24 ? ['You land in the middle, not merely inside.'] : [],
      hurt: this.strays > this.hits * 0.2 ? [`${this.strays} clicks landed on the floor.`] : [],
      advice:
        this.strays > this.hits * 0.2
          ? 'You are clicking where the pad is going to be rather than where it is. Arrive, then press.'
          : err > 55
            ? 'You are stopping the cursor at the edge. Overshoot the centre slightly and let the click settle it.'
            : null,
    };
  }
}

const HANDOFF_KEYS: AbilitySlot[] = ['q', 'w', 'e'];

/**
 * HANDOFF — the two hands, strictly taking turns.
 *
 * A pad lights on the floor: click it. A key lights on the bench: press it.
 * Click, key, click, key, and it is never twice in a row. Answer with the hand
 * whose turn it is not and the chain is gone even though the input was, in
 * isolation, perfectly good.
 *
 * Speed in either hand alone is not what this measures. It measures the
 * *seam*: the dead time between one hand finishing and the other starting,
 * which is where most people's real rate goes and which neither a mouse drill
 * nor a keyboard drill can see.
 *
 * Transfer: cast, then reposition, then cast. The pair that has to overlap
 * rather than queue.
 */
export class ApmHandoffDrill extends LabDrill {
  protected readonly targetApm = APM_TARGET_APM.apmHandoff;

  private turn: 'click' | 'key' = 'click';
  private clickPad: Pad | null = null;
  private keySlot: AbilitySlot = 'q';
  private keyPads: Pad[] = [];
  private shownAt = 0;
  private window = 1.2;
  private swaps: number[] = [];
  private lastAt = 0;
  private wrongHand = 0;
  private missed = 0;

  protected build(): void {
    this.keyPads = this.row(HANDOFF_KEYS, { gap: 170, radius: 56, y: this.centre.y + 250 });
    this.deal();
  }

  private deal(): void {
    this.window = clamp((1.45 - this.d * 0.55) / this.tempo, 0.36, 1.5);
    this.shownAt = this.s.elapsed;
    if (this.turn === 'click') {
      const pos = this.randomPoint(this.clickPad?.pos ?? null, 220, 150);
      this.clickPad = { slot: null, pos, radius: clamp(96 - this.d * 26, 46, 96) };
    } else {
      this.keySlot = this.s.rng.pick(HANDOFF_KEYS);
    }
  }

  private pass(at: Vec2, label: string, quality: number): void {
    if (this.lastAt > 0) this.swaps.push((this.s.elapsed - this.lastAt) * 1000);
    this.lastAt = this.s.elapsed;
    this.hit(at, { quality, value: 100, reaction: (this.s.elapsed - this.shownAt) * 1000, label });
    this.turn = this.turn === 'click' ? 'key' : 'click';
    this.deal();
  }

  protected tick(_dt: number): void {
    if (this.s.elapsed - this.shownAt <= this.window) return;
    this.missed++;
    this.fumble(this.turn === 'click' ? this.clickPad!.pos : this.centre, 'TOO SLOW', { input: false, cost: 50 });
    this.turn = this.turn === 'click' ? 'key' : 'click';
    this.deal();
  }

  onAbility(slot: AbilitySlot): void {
    this.press(slot);
    if (this.turn !== 'key') {
      this.wrongHand++;
      this.fumble(this.centre, 'MOUSE');
      this.deal();
      return;
    }
    if (slot !== this.keySlot) {
      this.wrongHand++;
      this.fumble(this.centre, `WRONG · ${this.glyph(this.keySlot)}`);
      this.turn = 'click';
      this.deal();
      return;
    }
    const age = this.s.elapsed - this.shownAt;
    this.pass(this.keyPads[HANDOFF_KEYS.indexOf(slot)].pos, this.glyph(slot), clamp(1 - age / this.window, 0, 1));
  }

  protected onBenchClick(pos: Vec2): void {
    if (this.turn !== 'click') {
      this.wrongHand++;
      this.fumble(pos, 'KEYS');
      this.deal();
      return;
    }
    const pad = this.clickPad!;
    const d = dist(pos, pad.pos);
    if (d > pad.radius) {
      this.stray(pos);
      return;
    }
    const age = this.s.elapsed - this.shownAt;
    this.pass(pad.pos, 'CLICK', clamp(1 - d / pad.radius, 0, 1) * 0.5 + clamp(1 - age / this.window, 0, 1) * 0.5);
  }

  solution(): LabSolution {
    return this.turn === 'click' ? { click: this.clickPad?.pos ?? null } : { keys: [this.keySlot] };
  }

  protected slotName(slot: AbilitySlot): string {
    return this.turn === 'key' && slot === this.keySlot ? 'NOW' : '';
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    const left = clamp(1 - (this.s.elapsed - this.shownAt) / this.window, 0, 1);
    const clicking = this.turn === 'click';
    if (this.clickPad) {
      this.paintPad(out, this.clickPad, {
        color: clicking ? (left < 0.3 ? PALETTE.danger : this.flow.color) : PALETTE.textFaint,
        glow: clicking ? 0.45 + left * 0.5 : 0.03,
        progress: clicking ? left : undefined,
        text: clicking ? 'CLICK' : '',
      });
    }
    this.paintBench(out, this.keyPads);
    this.keyPads.forEach((pad, i) => {
      const on = !clicking && HANDOFF_KEYS[i] === this.keySlot;
      this.paintPad(out, pad, {
        color: on ? (left < 0.3 ? PALETTE.danger : this.flow.color) : PALETTE.textFaint,
        glow: on ? 0.55 + left * 0.45 : 0.05,
        progress: on ? left : undefined,
      });
    });
    this.paintCaption(out, clicking ? 'MOUSE' : 'KEYS', 'never twice in a row', PALETTE.textDim);
  }

  protected modeField(): HudField {
    const swap = median(this.swaps);
    return {
      label: 'SEAM',
      value: swap ? `${Math.round(swap)}ms` : '—',
      bar: clamp(1 - swap / 800, 0, 1),
      tone: swap && swap < 320 ? 'good' : swap && swap < 520 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    return {
      tempo: clamp(speed * 0.5 + performance * 0.5, 0, 1),
      aim: clamp(accuracy * 0.5 + performance * 0.5, 0, 1),
      targeting: performance,
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [
      ms('seam', 'HAND TO HAND', median(this.swaps)),
      count('wrongHand', 'WRONG HAND', this.wrongHand, 'lower'),
      count('missed', 'PROMPTS MISSED', this.missed, 'lower'),
    ];
  }

  protected notes() {
    const swap = median(this.swaps);
    return {
      helped: swap > 0 && swap < 300 ? [`${Math.round(swap)}ms from one hand to the other — the seam is nearly gone.`] : [],
      hurt: this.wrongHand > this.hits * 0.15 ? ['You are answering with whichever hand was already moving.'] : [],
      advice:
        swap > 520
          ? 'Start the next hand while the current one is still finishing. You are waiting for confirmation you do not need.'
          : this.wrongHand > this.hits * 0.15
            ? 'Read the caption, not the pad. Which hand is a decision you can make before you know what it will be asked to do.'
            : null,
    };
  }
}

const CENTRE_KEYS: AbilitySlot[] = ['q', 'w', 'e'];
const ALERT_KEYS: AbilitySlot[] = ['d', 'f'];

interface Alert {
  slot: AbilitySlot;
  pos: Vec2;
  born: number;
  ttl: number;
}

/**
 * SPLIT — two things at once, neither allowed to wait.
 *
 * The centre runs a key queue that never stops. The rim throws alerts that
 * want a different key inside a second, and they do not care what the centre
 * was in the middle of. Drop either and you pay for it.
 *
 * Divided attention is the mechanic, and it is a real and separable one: most
 * players can run the centre alone at nearly full rate and lose thirty percent
 * of it the moment anything else in the world is also true.
 *
 * Transfer: answering the minimap without your combo falling apart.
 */
export class ApmSplitDrill extends LabDrill {
  protected readonly targetApm = APM_TARGET_APM.apmSplit;

  private pads: Pad[] = [];
  private queue: AbilitySlot[] = [];
  private shownAt = 0;
  private window = 1.1;
  private alerts: Alert[] = [];
  private alertCd = 2.4;
  private alertsSeen = 0;
  private alertsTaken = 0;
  private alertReactions: number[] = [];
  private wrongCentre = 0;
  private wrongAlert = 0;
  private centreMissed = 0;

  protected build(): void {
    this.pads = this.row(CENTRE_KEYS, { gap: 170, radius: 60 });
    for (let i = 0; i < 5; i++) this.push();
    this.arm();
  }

  private push(): void {
    let pick = this.s.rng.pick(CENTRE_KEYS);
    let guard = 0;
    while (pick === this.queue[this.queue.length - 1] && guard++ < 6) pick = this.s.rng.pick(CENTRE_KEYS);
    this.queue.push(pick);
  }

  private arm(): void {
    this.shownAt = this.s.elapsed;
    this.window = clamp((1.35 - this.d * 0.45) / this.tempo, 0.36, 1.4);
  }

  private advance(): void {
    this.queue.shift();
    this.push();
    this.arm();
  }

  private spawnAlert(): void {
    const { w, h } = this.s.world.bounds;
    const side = this.s.rng.int(0, 4);
    const t = this.s.rng.range(0.18, 0.82);
    const m = 110;
    const pos =
      side === 0
        ? { x: t * w, y: m }
        : side === 1
          ? { x: w - m, y: t * h }
          : side === 2
            ? { x: t * w, y: h - m }
            : { x: m, y: t * h };
    this.alerts.push({
      slot: this.s.rng.pick(ALERT_KEYS),
      pos,
      born: this.s.elapsed,
      ttl: clamp(1.5 - this.d * 0.5, 0.75, 1.5),
    });
    this.alertsSeen++;
    audio.play('telegraph', { intensity: 0.7, pan: this.s.panOf(pos) });
  }

  protected tick(dt: number): void {
    this.alertCd -= dt;
    if (this.alertCd <= 0 && this.alerts.length < 2) {
      this.alertCd = clamp((3.1 - this.d * 1.2) / Math.max(0.9, this.tempo * 0.85), 1.1, 3.2);
      this.spawnAlert();
    }
    for (let i = this.alerts.length - 1; i >= 0; i--) {
      const a = this.alerts[i];
      if (this.s.elapsed - a.born <= a.ttl) continue;
      this.alerts.splice(i, 1);
      this.fumble(a.pos, 'ALERT LOST', { input: false, cost: 80 });
    }
    if (this.s.elapsed - this.shownAt > this.window) {
      this.centreMissed++;
      this.fumble(this.centre, 'CENTRE DROPPED', { input: false, cost: 50 });
      this.advance();
    }
  }

  onAbility(slot: AbilitySlot): void {
    this.press(slot);
    if (ALERT_KEYS.includes(slot)) {
      const idx = this.alerts.findIndex((a) => a.slot === slot);
      if (idx < 0) {
        // Either nothing is flashing, or the one that is wants the other key.
        if (this.alerts.length) {
          this.wrongAlert++;
          this.fumble(this.alerts[0].pos, `WRONG · ${this.glyph(this.alerts[0].slot)}`);
        } else this.stray(this.centre);
        return;
      }
      const a = this.alerts[idx];
      this.alerts.splice(idx, 1);
      const age = this.s.elapsed - a.born;
      this.alertsTaken++;
      this.alertReactions.push(age * 1000);
      this.hit(a.pos, {
        quality: clamp(1 - age / a.ttl, 0, 1),
        value: 150,
        reaction: age * 1000,
        label: this.glyph(slot),
      });
      return;
    }
    const expected = this.queue[0];
    if (slot !== expected) {
      this.wrongCentre++;
      this.fumble(this.centre, `WRONG · ${this.glyph(expected)}`);
      this.advance();
      return;
    }
    const age = this.s.elapsed - this.shownAt;
    this.hit(this.pads[CENTRE_KEYS.indexOf(slot)].pos, {
      quality: clamp(1 - age / this.window, 0, 1),
      value: 80,
      reaction: age * 1000,
      label: this.glyph(slot),
    });
    this.advance();
  }

  solution(): LabSolution {
    // The rim first, always: the centre prompt renews and an alert does not.
    if (this.alerts.length) return { keys: [this.alerts[0].slot] };
    return { keys: [this.queue[0]] };
  }

  protected slotName(slot: AbilitySlot): string {
    return ALERT_KEYS.includes(slot) ? 'ALERT' : 'CENTRE';
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    const c = this.centre;
    const left = clamp(1 - (this.s.elapsed - this.shownAt) / this.window, 0, 1);
    out.billboards.push({
      kind: 'keys',
      x: c.x,
      y: c.y - 120,
      seq: this.queue.slice(0, 4).map((k) => this.glyph(k)),
      labels: this.queue.slice(0, 4).map(() => ''),
      index: 0,
      progress: left,
    });
    this.paintBench(out, this.pads);
    this.pads.forEach((pad, i) => {
      const on = CENTRE_KEYS[i] === this.queue[0];
      this.paintPad(out, pad, {
        color: on ? (left < 0.3 ? PALETTE.danger : this.flow.color) : PALETTE.textFaint,
        glow: on ? 0.5 + left * 0.5 : 0.05,
        progress: on ? left : undefined,
      });
    });
    for (const a of this.alerts) {
      const l = clamp(1 - (this.s.elapsed - a.born) / a.ttl, 0, 1);
      this.paintPad(
        out,
        { slot: a.slot, pos: a.pos, radius: 66 },
        {
          color: l < 0.35 ? PALETTE.danger : PALETTE.warn,
          glow: 0.5 + l * 0.5,
          progress: l,
          sub: 'ALERT',
        },
      );
    }
  }

  protected modeField(): HudField {
    const rate = this.alertsTaken / Math.max(1, this.alertsSeen);
    return {
      label: 'ALERTS',
      value: `${this.alertsTaken}/${this.alertsSeen}`,
      bar: rate,
      tone: rate > 0.85 ? 'good' : rate > 0.6 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    return {
      tempo: clamp(speed * 0.5 + performance * 0.5, 0, 1),
      targeting: clamp(accuracy * 0.4 + this.alertsTaken / Math.max(1, this.alertsSeen) * 0.6, 0, 1),
      aim: accuracy,
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [
      pct('alerts', 'ALERTS ANSWERED', this.alertsTaken / Math.max(1, this.alertsSeen)),
      ms('alertMs', 'ALERT REACTION', median(this.alertReactions)),
      count('centreMissed', 'CENTRE DROPPED', this.centreMissed, 'lower'),
      count('wrongCentre', 'WRONG CENTRE KEY', this.wrongCentre, 'lower'),
      count('wrongAlert', 'WRONG ALERT KEY', this.wrongAlert, 'lower'),
    ];
  }

  protected notes() {
    const rate = this.alertsTaken / Math.max(1, this.alertsSeen);
    return {
      helped: rate > 0.9 && this.centreMissed < 4 ? ['Neither half of the mode waited for the other.'] : [],
      hurt: rate < 0.6 ? ['The rim is what you are dropping. The centre is comfortable and it is eating everything.'] : [],
      advice:
        rate < 0.6
          ? 'Answer the rim first every time. The centre prompt renews itself; an alert does not.'
          : this.centreMissed > this.hits * 0.2
            ? 'You are stopping the centre to serve the rim. The alert key is a different finger — it does not need the queue to pause.'
            : null,
    };
  }
}
