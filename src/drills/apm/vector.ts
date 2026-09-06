import { audio } from '../../engine/audio';
import { clamp } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { Vec2 } from '../../engine/types';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, pct } from '../base';
import { APM_TARGET_APM } from './engine';
import { LabDrill, mean, type LabSolution } from './lab';

/** The eight headings, and what they are called. */
const HEADINGS: { dir: Vec2; name: string }[] = [
  { dir: { x: 0, y: -1 }, name: 'UP' },
  { dir: { x: 0.7071, y: -0.7071 }, name: 'UP RIGHT' },
  { dir: { x: 1, y: 0 }, name: 'RIGHT' },
  { dir: { x: 0.7071, y: 0.7071 }, name: 'DOWN RIGHT' },
  { dir: { x: 0, y: 1 }, name: 'DOWN' },
  { dir: { x: -0.7071, y: 0.7071 }, name: 'DOWN LEFT' },
  { dir: { x: -1, y: 0 }, name: 'LEFT' },
  { dir: { x: -0.7071, y: -0.7071 }, name: 'UP LEFT' },
];

/**
 * VECTOR — the movement command, with the map taken away.
 *
 * A heading is called. Go that way, now. There is nothing to dodge, nothing to
 * kite and nowhere in particular to be: no minion is walking, no skillshot is
 * coming, and standing in the wrong place costs you nothing except the call
 * you did not answer.
 *
 * What is left when all of that is stripped out is the command itself — how
 * long it takes you to turn a decision into a direction, and how close the
 * direction is to the one you decided on. Both control schemes are counted the
 * way the scheme actually works: a click is judged on the heading it sends
 * your body along, a held key on the heading it is holding.
 *
 * Transfer: the reposition you have already decided on arriving as one
 * command in the right direction, rather than as two corrections.
 */
export class ApmVectorDrill extends LabDrill {
  protected readonly targetApm = APM_TARGET_APM.apmVector;

  private call = 0;
  private calledAt = 0;
  /** After an answer the heading has to be *held* before the next call. */
  private holdUntil = 0;
  private window = 1.3;
  private errors: number[] = [];
  private taken = 0;
  private wrongWay = 0;
  private missed = 0;
  private lastClick: { x: number; y: number; t: number } | null = null;

  /** This is the one mode with a body to steer, so it keeps one. */
  protected mobile(): boolean {
    return true;
  }

  protected build(): void {
    this.newCall();
  }

  /** How far off the called heading still counts. */
  private get tolerance(): number {
    return (42 - this.d * 16) * (Math.PI / 180);
  }

  /** Seconds a command has to stand before the next one is called. */
  private get dwell(): number {
    return clamp(0.62 - this.d * 0.22, 0.28, 0.62) / Math.max(0.9, this.tempo * 0.7);
  }

  private newCall(): void {
    this.holdUntil = 0;
    const { w, h } = this.s.world.bounds;
    const p = this.anchor;
    const toCentre = { x: w / 2 - p.pos.x, y: h / 2 - p.pos.y };
    const far = Math.hypot(toCentre.x, toCentre.y);
    // Near a wall the only calls offered are the ones with somewhere to go.
    // A drill that asks for the impossible stops being read at all.
    const inward = far > Math.min(w, h) * 0.28;
    const unit = far > 1 ? { x: toCentre.x / far, y: toCentre.y / far } : { x: 0, y: 0 };
    const options = HEADINGS.map((_, i) => i).filter((i) => {
      if (i === this.call) return false;
      if (!inward) return true;
      return HEADINGS[i].dir.x * unit.x + HEADINGS[i].dir.y * unit.y > -0.1;
    });
    this.call = this.s.rng.pick(options.length ? options : HEADINGS.map((_, i) => i));
    this.calledAt = this.s.elapsed;
    this.window = clamp((1.7 - this.d * 0.6) / this.tempo, 0.45, 1.8);
    this.s.setBanner(HEADINGS[this.call].name, 0.6);
    audio.play('tick', { intensity: 0.7 });
  }

  protected tick(_dt: number): void {
    if (this.holdUntil > 0) {
      // The command has to stand. Without this the mode would pay for a wrist
      // flick every eighth of a second and never for going anywhere, which is
      // a twitch test wearing a movement mode's name.
      if (this.s.elapsed >= this.holdUntil) this.newCall();
      return;
    }
    if (this.s.elapsed - this.calledAt <= this.window) return;
    this.missed++;
    this.fumble(this.anchor.pos, 'NO COMMAND', { input: false, cost: 60 });
    this.newCall();
  }

  /**
   * One heading, judged. The action itself was already counted — by the
   * engine's WASD poll, or by the click below — so the payout does not count
   * it a second time.
   */
  private judge(dir: Vec2): void {
    if (this.holdUntil > 0) {
      // Already answered. Changing your mind inside the dwell is a command
      // that bought nothing, which is precisely a stray.
      this.stray(this.anchor.pos);
      return;
    }
    const want = HEADINGS[this.call].dir;
    const dot = clamp(dir.x * want.x + dir.y * want.y, -1, 1);
    const err = Math.acos(dot);
    const tol = this.tolerance;
    if (err > tol) {
      this.wrongWay++;
      this.fumble(this.anchor.pos, 'WRONG WAY');
      this.newCall();
      return;
    }
    this.taken++;
    this.errors.push((err * 180) / Math.PI);
    const age = this.s.elapsed - this.calledAt;
    this.hit(this.anchor.pos, {
      quality: clamp(1 - err / tol, 0, 1) * 0.6 + clamp(1 - age / this.window, 0, 1) * 0.4,
      value: 150,
      reaction: age * 1000,
      action: false,
      label: HEADINGS[this.call].name,
    });
    this.holdUntil = this.s.elapsed + this.dwell;
  }

  /** WASD: the command is the key going down, or the heading changing. */
  protected onDirectMove(_pos: Vec2, _started: boolean): void {
    const dir = this.anchor.moveDir;
    if (dir) this.judge(dir);
  }

  onClick(pos: Vec2): boolean {
    const p = this.anchor;
    const rep =
      this.lastClick !== null &&
      this.s.elapsed - this.lastClick.t < 0.14 &&
      Math.hypot(pos.x - this.lastClick.x, pos.y - this.lastClick.y) < 90;
    this.lastClick = { x: pos.x, y: pos.y, t: this.s.elapsed };
    if (rep) {
      this.stray(pos);
      return false;
    }
    const v = { x: pos.x - p.pos.x, y: pos.y - p.pos.y };
    const len = Math.hypot(v.x, v.y);
    this.note();
    if (len < 80) {
      // A click on your own feet is not a heading.
      this.stray(pos);
      return false;
    }
    this.judge({ x: v.x / len, y: v.y / len });
    // Never consumed: the body really does walk where you sent it, which is
    // the only thing making the command feel like a command.
    return false;
  }

  protected onKey(): void {
    this.stray(this.anchor.pos);
  }

  protected modeSolution(): LabSolution {
    const want = HEADINGS[this.call].dir;
    const p = this.anchor;
    // Inside the dwell the correct thing is to keep going, not to command
    // again: the heading stays, and no new input belongs in it.
    if (this.holdUntil > 0) return { dir: want, wait: true };
    return { dir: want, click: { x: p.pos.x + want.x * 320, y: p.pos.y + want.y * 320 } };
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    const p = this.anchor;
    const want = HEADINGS[this.call].dir;
    const left = clamp(1 - (this.s.elapsed - this.calledAt) / this.window, 0, 1);
    const holding = this.holdUntil > 0;
    const color = holding ? PALETTE.good : left < 0.3 ? PALETTE.danger : this.flow.color;
    const a = Math.atan2(want.y, want.x);
    const tol = this.tolerance;
    out.markers.push({
      kind: 'sector',
      x: p.pos.x,
      y: p.pos.y,
      radius: 300,
      a0: a - tol,
      a1: a + tol,
      color,
      alpha: 0.18,
      fill: 1,
      rise: 0.2,
    });
    out.markers.push({
      kind: 'line',
      x: p.pos.x,
      y: p.pos.y,
      x2: p.pos.x + want.x * 300,
      y2: p.pos.y + want.y * 300,
      halfWidth: 7,
      color,
      alpha: 0.9,
      progress: left,
      rise: 0.6,
    });
    out.billboards.push({
      kind: 'label',
      x: p.pos.x + want.x * 330,
      y: p.pos.y + want.y * 330,
      text: HEADINGS[this.call].name,
      color,
      size: 22,
      sub: holding ? 'HOLD IT' : `${Math.round((tol * 180) / Math.PI)}° either side`,
    });
    out.billboards.push({
      kind: 'timerBar',
      x: p.pos.x,
      y: p.pos.y,
      progress: holding ? clamp((this.holdUntil - this.s.elapsed) / this.dwell, 0, 1) : left,
      color,
      width: 160,
      lift: 90,
    });
  }

  protected modeField(): HudField {
    const err = mean(this.errors);
    return {
      label: 'HEADING',
      value: this.errors.length ? `${Math.round(err)}°` : '—',
      bar: clamp(1 - err / 45, 0, 1),
      tone: err < 12 ? 'good' : err < 24 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    return {
      tempo: clamp(speed * 0.5 + performance * 0.5, 0, 1),
      movement: clamp(accuracy * 0.4 + performance * 0.6, 0, 1),
    };
  }

  protected modeMetrics(): KeyMetric[] {
    const calls = this.taken + this.wrongWay + this.missed;
    return [
      pct('calls', 'CALLS ANSWERED', this.taken / Math.max(1, calls)),
      count('err', 'HEADING ERROR', Math.round(mean(this.errors)), 'lower'),
      count('wrongWay', 'WRONG WAY', this.wrongWay, 'lower'),
      count('missed', 'CALLS MISSED', this.missed, 'lower'),
    ];
  }

  protected notes() {
    const err = mean(this.errors);
    return {
      helped: this.errors.length > 8 && err < 12 ? [`Your commands land ${Math.round(err)}° off the call.`] : [],
      hurt: this.missed > this.taken * 0.3 ? ['A third of the calls went by without a command at all.'] : [],
      advice:
        this.missed > this.taken * 0.3
          ? 'Commit on the word, not on the arrow. You already know the eight directions; you are waiting to see one drawn.'
          : err > 24
            ? 'You are sending the command roughly and correcting after. One command, aimed, is faster than two.'
            : null,
    };
  }
}
