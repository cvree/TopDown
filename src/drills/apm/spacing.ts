import { audio } from '../../engine/audio';
import { clamp, dist } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { Actor, Vec2 } from '../../engine/types';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, pct, units } from '../base';
import { APM_TARGET_APM, ApmDrill } from './engine';

type Call = 'edge' | 'step' | 'break';

const CALL_LABEL: Record<Call, string> = {
  edge: 'MAX RANGE',
  step: 'STEP IN',
  break: 'DISENGAGE',
};

/**
 * SPACING — the band, on a beat.
 *
 * A chaser walks at you and a band is drawn around it. Every beat the drill
 * calls for a band and checks whether you are standing in it — max range for
 * a trade, inside for a burst, well out for a disengage — and the beat gets
 * faster the better you are doing.
 *
 * The standard spacing drill measures the distance you hold. This one
 * measures how fast you can *change* it, which is the version of spacing that
 * actually decides trades: the gap is never wrong for long, it is wrong at
 * the moment somebody's cooldown comes up.
 */
export class ApmSpacingDrill extends ApmDrill {
  protected readonly targetApm = APM_TARGET_APM.apmSpacing;
  // One call answered every couple of seconds, for the whole run.
  protected get targetRate(): number {
    return 26;
  }

  private chaser: Actor | null = null;
  private call: Call = 'edge';
  private calledAt = 0;
  private window = 2.4;
  private held = 0;
  private missedCalls = 0;
  private errors: number[] = [];
  private warned = false;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    this.s.world.spawnPlayer({ x: w * 0.5, y: h * 0.7 });
    this.chaser = this.spawnEnemy('duelist', { x: w * 0.5, y: h * 0.32 }, { hpScale: 20 });
    this.chaser.attack.damage = 26;
    // Much slower than you are, and deliberately so. The bands are hundreds of
    // units apart and the calls are seconds long, so the gap between your
    // speed and its speed is the entire budget you have to answer with. At
    // anything close to parity every call but the current one is unanswerable.
    this.chaser.moveSpeed *= 0.48;
    this.chaser.label = 'PRESSURE';
    this.newCall();
  }

  /** The band the current call asks for, as a distance from the chaser. */
  private band(): { lo: number; hi: number } {
    const p = this.s.world.player;
    const e = this.chaser;
    if (!p || !e) return { lo: 0, hi: 0 };
    const mine = p.attack.range + e.radius;
    const theirs = e.attack.range + e.radius;
    switch (this.call) {
      case 'edge':
        return { lo: Math.max(theirs + 40, mine * 0.76), hi: mine + 30 };
      case 'step':
        return { lo: theirs * 0.5, hi: theirs * 0.95 };
      default:
        return { lo: mine + 70, hi: mine + 340 };
    }
  }

  /**
   * The next call is always a neighbour of the current one.
   *
   * Burst range, trade range and disengage range are a ladder, and a champion
   * can only cross one rung of it inside one beat. Calling for the far end
   * would not be a hard call, it would be an impossible one — and a drill that
   * asks for the impossible stops being read at all.
   */
  private newCall(): void {
    const ladder: Call[] = ['step', 'edge', 'break'];
    const at = ladder.indexOf(this.call);
    const options = [ladder[at - 1], ladder[at + 1]].filter(Boolean) as Call[];
    this.call = this.s.rng.pick(options);
    this.calledAt = this.s.elapsed;
    this.warned = false;
    // The beat tightens as you climb: at the top tier there is about a second
    // to read the call, decide the direction, and be standing there.
    // Long enough to cross the gap the call asks for, short enough that you
    // have to start moving before you have finished reading it.
    this.window = clamp((2.9 - this.d * 0.9) / Math.max(0.85, this.tempo * 0.9), 1.4, 2.8);
    this.s.setBanner(CALL_LABEL[this.call], 0.7);
    audio.play('tick', { intensity: 0.8 });
  }

  protected tick(dt: number): void {
    this.updateBrains(dt);
    const p = this.s.world.player;
    const e = this.chaser;
    if (!p || !e) return;
    if (!e.alive) {
      // It is a metronome with legs, not an opponent — it never actually dies.
      e.alive = true;
      e.hp = e.maxHp;
    }
    e.hp = Math.min(e.maxHp, e.hp + dt * 120);

    const gap = dist(p.pos, e.pos);
    const b = this.band();
    const inside = gap >= b.lo && gap <= b.hi;
    if (inside) this.held += dt;

    const age = this.s.elapsed - this.calledAt;
    if (!this.warned && age > this.window - 0.45) {
      this.warned = true;
      audio.play('countdown', { intensity: 0.5 });
    }
    if (age < this.window) return;

    if (inside) {
      const centre = (b.lo + b.hi) / 2;
      const halfWidth = Math.max(1, (b.hi - b.lo) / 2);
      const tightness = clamp(1 - Math.abs(gap - centre) / halfWidth, 0, 1);
      this.errors.push(Math.abs(gap - centre));
      this.hit(p.pos, {
        quality: tightness,
        value: 190,
        action: false,
        label: tightness > 0.75 ? 'ON THE EDGE' : CALL_LABEL[this.call],
      });
    } else {
      this.missedCalls++;
      const off = gap < b.lo ? 'TOO CLOSE' : 'TOO FAR';
      this.errors.push(gap < b.lo ? b.lo - gap : gap - b.hi);
      this.fumble(p.pos, off, { input: false, cost: 70 });
    }
    this.newCall();
  }

  /** Repositioning is the action here; the beat only decides whether it worked. */
  onClick(pos: Vec2): boolean {
    this.noteMove(pos);
    return false;
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    const e = this.chaser;
    const p = this.s.world.player;
    if (!e || !p) return;
    const b = this.band();
    const left = clamp(1 - (this.s.elapsed - this.calledAt) / this.window, 0, 1);
    const gap = dist(p.pos, e.pos);
    const inside = gap >= b.lo && gap <= b.hi;
    const col = inside ? PALETTE.good : left < 0.35 ? PALETTE.danger : PALETTE.warn;

    for (const r of [b.lo, b.hi]) {
      out.markers.push({
        kind: 'ring',
        x: e.pos.x,
        y: e.pos.y,
        radius: r,
        color: col,
        alpha: 0.55,
        width: 3,
        dash: 10,
        rise: 0.5,
      });
    }
    out.markers.push({
      kind: 'ring',
      x: e.pos.x,
      y: e.pos.y,
      radius: (b.lo + b.hi) / 2,
      color: col,
      alpha: 0.85,
      width: 4 + (inside ? 2 : 0),
      progress: left,
      rise: 0.8,
    });
    out.billboards.push({
      kind: 'label',
      x: e.pos.x,
      y: e.pos.y,
      text: CALL_LABEL[this.call],
      color: col,
      size: 20,
      sub: inside ? 'HOLD' : gap < b.lo ? 'BACK OUT' : 'CLOSE IN',
    });
    out.billboards.push({
      kind: 'timerBar',
      x: p.pos.x,
      y: p.pos.y,
      progress: left,
      color: col,
      width: 150,
      lift: 84,
    });
  }

  private meanError(): number {
    return this.errors.length ? this.errors.reduce((a, b) => a + b, 0) / this.errors.length : 0;
  }

  private holdRatio(): number {
    return clamp(this.held / Math.max(0.5, this.s.elapsed), 0, 1);
  }

  protected modeField(): HudField {
    const hold = this.holdRatio();
    return {
      label: 'IN BAND',
      value: `${Math.round(hold * 100)}%`,
      bar: hold,
      tone: hold > 0.7 ? 'good' : hold > 0.45 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    void accuracy;
    return {
      tempo: clamp(speed * 0.5 + performance * 0.5, 0, 1),
      spacing: clamp(this.holdRatio() * 0.5 + performance * 0.5, 0, 1),
      movement: performance,
    };
  }

  protected modeMetrics(): KeyMetric[] {
    const calls = this.hits + this.missedCalls;
    return [
      pct('calls', 'CALLS ANSWERED', this.hits / Math.max(1, calls)),
      pct('inBand', 'TIME IN BAND', this.holdRatio()),
      units('bandErr', 'DISTANCE ERROR', this.meanError()),
      count('missed', 'CALLS MISSED', this.missedCalls, 'lower'),
    ];
  }

  protected notes() {
    return {
      helped: this.holdRatio() > 0.75 ? ['You spend most of the run already standing where the next call wants you.'] : [],
      hurt: this.missedCalls > this.hits * 0.4 ? ['You are reacting to the call rather than anticipating the band.'] : [],
      advice:
        this.missedCalls > this.hits * 0.4
          ? 'Move the instant the call changes rather than checking the ring first. The band is always in the same three places.'
          : null,
    };
  }
}
