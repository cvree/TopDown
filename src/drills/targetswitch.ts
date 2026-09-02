import { audio } from '../engine/audio';
import { clamp, median } from '../engine/math';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { HudField } from '../engine/session';
import type { Actor } from '../engine/types';
import { Drill, band, count, ms, pct, type DrillOutcome } from './base';

/**
 * TARGET SWITCH — commit to the right one.
 *
 * A priority target lights up and rotates. What is measured is the gap between
 * the priority changing and your attack order landing on the new unit, which
 * is exactly the delay that gets people killed in a real fight.
 */
export class TargetSwitchDrill extends Drill {
  private dummies: Actor[] = [];
  private priorityId = -1;
  private priorityAt = 0;
  private switchCd = 0;
  private switches = 0;
  private correct = 0;
  private wrong = 0;
  private awaiting = false;
  private times: number[] = [];

  setup(): void {
    const { w, h } = this.s.world.bounds;
    this.s.world.spawnPlayer({ x: w / 2, y: h / 2 });
    const n = 3 + Math.floor(this.s.config.difficulty * 2);
    for (let i = 0; i < n; i++) {
      const a = this.s.world.spawnActor({
        pos: this.randomPoint({ x: w / 2, y: h / 2 }, 300, 150),
        team: 'enemy',
        maxHp: 100000,
        radius: 31,
        moveSpeed: 90 + this.s.config.difficulty * 150,
        label: `T${i + 1}`,
        attack: { attackSpeed: 0.01, windupRatio: 0.3, backswingRatio: 0.3, range: 0, damage: 0, projectileSpeed: 0 },
      });
      this.dummies.push(a);
    }
    this.rotate(true);
  }

  private rotate(first = false): void {
    const pool = this.dummies.filter((d) => d.id !== this.priorityId);
    const next = pool[this.s.rng.int(0, pool.length)];
    this.priorityId = next.id;
    this.priorityAt = this.s.elapsed;
    this.awaiting = true;
    if (!first) {
      this.switches++;
      audio.play('tick');
      this.s.fx.ring(next.pos.x, next.pos.y, next.radius + 60, next.radius + 6, 0.32, PALETTE.warn, 3, 'range');
    }
    const d = this.s.config.difficulty;
    this.switchCd = this.s.rng.range(2.4 - d * 1.1, 3.4 - d * 1.5);
  }

  update(dt: number): void {
    // Dummies drift so the click is never a memorised screen position.
    const { w, h } = this.s.world.bounds;
    for (const a of this.dummies) {
      if (!a.order) a.order = { kind: 'move', pos: this.randomPoint(a.pos, 220, 140) };
      a.pos.x = clamp(a.pos.x, 100, w - 100);
      a.pos.y = clamp(a.pos.y, 100, h - 100);
    }
    this.switchCd -= dt;
    if (this.switchCd <= 0) {
      if (this.awaiting) {
        // The window closed with no correct order — that counts as a miss.
        this.wrong++;
        this.s.chain = 0;
        audio.setComboPitch(0);
      }
      this.rotate();
    }
  }

  onTargetOrder(a: Actor): void {
    if (!this.awaiting) return;
    if (a.id === this.priorityId) {
      const t = (this.s.elapsed - this.priorityAt) * 1000;
      this.times.push(t);
      this.s.metrics.noteTargetSwitch(t);
      this.correct++;
      this.awaiting = false;
      this.s.chain++;
      this.s.chainBest = Math.max(this.s.chainBest, this.s.chain);
      audio.setComboPitch(this.s.chain);
      audio.play('pickup');
      this.s.micro(`${Math.round(t)}ms`, a.pos, t < 400 ? PALETTE.good : PALETTE.accent);
      this.s.fx.ring(a.pos.x, a.pos.y, a.radius, a.radius * 2.6, 0.3, PALETTE.good, 2.5, 'impact');
    } else {
      this.wrong++;
      this.s.chain = 0;
      audio.setComboPitch(0);
      audio.play('attackCancel');
      this.s.micro('WRONG TARGET', a.pos, PALETTE.danger);
    }
  }

  paint(out: DrillPaint, t: number): void {
    for (const a of this.dummies) {
      if (a.id !== this.priorityId) continue;
      const pulse = 0.5 + 0.5 * Math.sin(t * 8);
      out.markers.push({
        kind: 'ring',
        x: a.pos.x,
        y: a.pos.y,
        radius: a.radius + 18 + pulse * 5,
        color: PALETTE.warn,
        alpha: 0.6 + pulse * 0.4,
        width: 5,
        rise: 2.4,
      });
      // A caret above the priority target plus the closing window as a bar:
      // both live over the unit, so your eye never leaves the fight.
      out.billboards.push({ kind: 'caret', x: a.pos.x, y: a.pos.y, color: PALETTE.warn });
      out.billboards.push({
        kind: 'timerBar',
        x: a.pos.x,
        y: a.pos.y,
        progress: clamp(this.switchCd / 2.4, 0, 1),
        color: PALETTE.warn,
        width: 70,
      });
    }
  }

  hudFields(): HudField[] {
    const acc = this.correct / Math.max(1, this.correct + this.wrong);
    const med = this.times.length ? median(this.times) : 0;
    return [
      { label: 'SWITCHES', value: `${this.correct}`, tone: 'neutral' },
      { label: 'MEDIAN', value: med ? `${Math.round(med)}ms` : '—', tone: med && med < 450 ? 'good' : 'warn' },
      { label: 'ACCURACY', value: `${Math.round(acc * 100)}%`, bar: acc, tone: acc > 0.9 ? 'good' : 'warn' },
    ];
  }

  liveScore(): number {
    const med = this.times.length ? median(this.times) : 1200;
    const speed = clamp((1200 - med) / 900, 0, 1);
    return Math.max(0, Math.round(this.correct * (500 + speed * 900) - this.wrong * 620));
  }

  outcome(): DrillOutcome {
    const acc = this.correct / Math.max(1, this.correct + this.wrong);
    const med = this.times.length ? median(this.times) : 1500;
    const speed = band(med, 900, 260);
    const consistency = this.times.length > 3 ? band(stdev(this.times), 320, 60) : 0;

    const performance = clamp(acc * 0.4 + speed * 0.36 + consistency * 0.14 + band(this.correct / Math.max(1, this.switches), 0.5, 1) * 0.1, 0, 1);

    const helped: string[] = [];
    const hurt: string[] = [];
    if (med < 420 && this.correct > 5) helped.push(`Median switch of ${Math.round(med)}ms.`);
    if (acc === 1 && this.correct > 6) helped.push('Never clicked the wrong unit.');
    if (this.wrong > 2) hurt.push(`${this.wrong} orders went to the wrong target or arrived too late.`);
    if (med > 620) hurt.push('Your switches are slow — you are re-finding the target with your eyes each time.');

    const advice =
      med > 600
        ? 'Keep your cursor between the units rather than parked on your current target.'
        : acc < 0.85
          ? 'Confirm the marker before you click. A wrong switch costs more than a slow one.'
          : 'Raise the difficulty — more units and faster rotations is the next step.';

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: { targeting: performance, aim: clamp(acc * 0.8 + speed * 0.2, 0, 1) },
      keyMetrics: [
        ms('switch', 'MEDIAN SWITCH', med),
        pct('switchAcc', 'SWITCH ACCURACY', acc),
        count('switches', 'CLEAN SWITCHES', this.correct),
      ],
      helped,
      hurt,
      advice,
    };
  }
}

const stdev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
};
