import { clamp, dist } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { Vec2 } from '../../engine/types';
import type { WorldEvent } from '../../engine/world';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, ms, pct } from '../base';
import { APM_TARGET_APM, ApmDrill } from './engine';

/**
 * The orbwalking half of the APM trainer.
 *
 * An orbwalk is two commands — attack, then move — and the whole skill is
 * that neither of them is ever early or late. So this is the one place where
 * high APM is not just permitted but *required*: at a full attack cycle you
 * cannot hold the rhythm below about a hundred and twenty actions a minute,
 * and every action that is not one of those two is measured against you.
 */
abstract class OrbwalkDrill extends ApmDrill {
  protected attacks = 0;
  protected steps = 0;
  protected stationaryAttacks = 0;
  protected cancels = 0;
  protected hitsTaken = 0;
  private movedSinceRelease = false;
  private lastRelease = -1;
  private gaps: number[] = [];

  protected abstract enemyCount(): number;
  protected abstract hostile(): boolean;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w * 0.5, y: h * 0.68 });
    if (this.hostile()) {
      p.maxHp = 1600;
      p.hp = 1600;
    }
    for (let i = 0; i < this.enemyCount(); i++) this.spawnDummy();
  }

  protected spawnDummy(): void {
    const p = this.s.world.player;
    const pos = this.randomPoint(p?.pos ?? null, 460, 200);
    const a = this.spawnEnemy(this.hostile() ? 'diver' : 'juggernaut', pos, { hpScale: this.hostile() ? 2.4 : 7 });
    if (!this.hostile()) {
      // A pace dummy, not an opponent: it walks at you so the range keeps
      // moving, and it barely hurts, because being killed is not the lesson.
      a.attack.damage = 6;
      a.moveSpeed *= 0.62;
      a.label = 'DUMMY';
    }
  }

  protected tick(dt: number): void {
    this.updateBrains(dt);
    while (this.s.world.enemies().length < this.enemyCount()) this.spawnDummy();
    void dt;
  }

  /**
   * The ideal gap between two attacks: one full cycle. Anything longer is a
   * window you did not use, and this is what separates orbwalking from
   * clicking quickly.
   */
  private idealGap(): number {
    const p = this.s.world.player;
    return p ? 1 / Math.max(0.1, p.attack.attackSpeed) : 1;
  }

  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    const p = this.s.world.player;
    for (const e of events) {
      if (e.actorId !== pid && e.targetId !== pid) continue;
      switch (e.type) {
        case 'attackRelease': {
          if (e.actorId !== pid || !p) break;
          this.attacks++;
          const gap = this.lastRelease >= 0 ? this.s.elapsed - this.lastRelease : 0;
          if (gap > 0) this.gaps.push(gap * 1000);
          this.lastRelease = this.s.elapsed;
          if (!this.movedSinceRelease && this.attacks > 1) {
            this.stationaryAttacks++;
            this.fumble(p.pos, 'STOOD STILL', { input: false, cost: 50 });
            break;
          }
          const ideal = this.idealGap();
          // A gap at the cycle length is perfect; twice the cycle is nothing.
          const quality = gap > 0 ? clamp(1 - (gap - ideal) / ideal, 0, 1) : 0.5;
          this.hit(p.pos, { quality, value: 120, action: false, label: quality > 0.8 ? 'ON CYCLE' : undefined });
          this.movedSinceRelease = false;
          break;
        }
        case 'attackCancel':
          if (e.actorId === pid && p) {
            this.cancels++;
            this.fumble(p.pos, 'CANCELLED', { input: false, cost: 70 });
          }
          break;
        case 'damage':
          if (e.targetId === pid && p) {
            this.hitsTaken++;
            if (this.hostile()) this.fumble(e.pos ?? p.pos, 'TAKEN', { input: false, cost: 70 });
          }
          break;
        default:
          break;
      }
    }
  }

  /**
   * Both halves of the orbwalk are commands, and both are counted.
   *
   * The step out of the backswing is not overhead on the way to the next
   * attack — it *is* the mechanic — so the first step of each free window
   * scores in its own right. Further steps inside the same window are neither
   * rewarded nor punished: kiting in a curve is real movement, and only a
   * repeat of the same order in the same instant is waste.
   */
  onClick(pos: Vec2): boolean {
    const p = this.s.world.player;
    const onEnemy = this.s.world.enemies().some((a) => dist(pos, a.pos) < a.radius + 26);
    this.noteMove(pos);
    if (onEnemy || !p) return false;
    if (!this.movedSinceRelease && p.phase !== 'windup') {
      this.steps++;
      this.hit(p.pos, { quality: 0.55, value: 55, action: false });
    }
    this.movedSinceRelease = true;
    return false;
  }

  /**
   * The same step, taken with the keys.
   *
   * Under WASD the step out of the backswing is a key going down rather than a
   * click on the ground, and it has to score identically — the trainer's whole
   * claim is that a run means the same thing under either scheme.
   */
  protected onDirectMove(pos: Vec2, started: boolean): void {
    const p = this.s.world.player;
    if (!p) return;
    if (started && !this.movedSinceRelease && p.phase !== 'windup') {
      this.steps++;
      this.hit(p.pos, { quality: 0.55, value: 55, action: false });
    }
    this.movedSinceRelease = true;
    void pos;
  }

  protected medianGap(): number {
    if (!this.gaps.length) return 0;
    const s = [...this.gaps].sort((a, b) => a - b);
    return s[s.length >> 1];
  }

  /** Attacks landed against the number a perfect cycle would have produced. */
  protected uptime(): number {
    const ideal = this.idealGap();
    const possible = Math.max(1, this.s.elapsed / ideal);
    return clamp(this.attacks / possible, 0, 1);
  }

  protected paintMode(out: DrillPaint, _t: number): void {
    const p = this.s.world.player;
    if (!p) return;
    // Your own range, always drawn: an orbwalk step that leaves range is the
    // most common way to lose a cycle and the hardest one to feel.
    out.markers.push({
      kind: 'ring',
      x: p.pos.x,
      y: p.pos.y,
      radius: p.attack.range,
      color: this.movedSinceRelease ? PALETTE.good : PALETTE.accentDim,
      alpha: 0.35,
      width: 2,
      rise: 0.6,
    });
  }

  protected modeField(): HudField {
    const up = this.uptime();
    return {
      label: 'CYCLE UPTIME',
      value: `${Math.round(up * 100)}%`,
      bar: up,
      tone: up > 0.85 ? 'good' : up > 0.6 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    void accuracy;
    return {
      tempo: clamp(speed * 0.55 + performance * 0.45, 0, 1),
      kiting: clamp(this.uptime() * 0.5 + performance * 0.5, 0, 1),
      spacing: performance,
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [
      pct('uptime', 'CYCLE UPTIME', this.uptime()),
      ms('gap', 'TIME BETWEEN ATTACKS', this.medianGap()),
      count('attacks', 'ATTACKS LANDED', this.attacks),
      count('cancels', 'ATTACKS CANCELLED', this.cancels, 'lower'),
      count('rooted', 'ATTACKS WITHOUT A STEP', this.stationaryAttacks, 'lower'),
      count('steps', 'STEPS IN THE WINDOW', this.steps),
    ];
  }
}

/**
 * KITING — attack, move, attack, at full speed.
 *
 * A pace dummy that walks at you and cannot really hurt you, so nothing here
 * is about survival: it is about whether your two commands can hold a full
 * attack cycle for a whole minute without a single wasted window.
 */
export class ApmKiteDrill extends OrbwalkDrill {
  protected readonly targetApm = APM_TARGET_APM.apmKite;
  // An attack and a step per cycle, at a full cycle.
  protected get targetRate(): number {
    return 80;
  }

  protected enemyCount(): number {
    return 1;
  }
  protected hostile(): boolean {
    return false;
  }

  protected notes() {
    return {
      helped: this.cancels === 0 && this.attacks > 20 ? ['Not one windup thrown away all run.'] : [],
      hurt: this.cancels > 5 ? [`${this.cancels} attacks cancelled by moving too early.`] : [],
      advice:
        this.cancels > 5
          ? 'Watch the cycle bar under your health: amber is committed, green is yours. Move on green, never on amber.'
          : this.uptime() < 0.6
            ? 'You are moving further than you need to. One short step is a whole extra attack.'
            : null,
    };
  }
}

/**
 * DEFENSIVE KITING — the same rhythm, running backwards.
 *
 * Two divers that actually want to reach you. The cycle is the same; the
 * difference is that every step now has a direction it has to be in, and the
 * moment you take one attack you find out whether you were kiting or fleeing.
 */
export class ApmDefensiveKiteDrill extends OrbwalkDrill {
  protected readonly targetApm = APM_TARGET_APM.apmDefKite;
  protected get targetRate(): number {
    return 72;
  }
  private closest = 0;
  private samples = 0;
  private safeSum = 0;

  protected enemyCount(): number {
    return this.d > 0.55 ? 2 : 1;
  }
  protected hostile(): boolean {
    return true;
  }

  protected tick(dt: number): void {
    super.tick(dt);
    const p = this.s.world.player;
    if (!p) return;
    // How well you are holding the gap, sampled rather than judged at the end.
    let near = Infinity;
    let threat = 0;
    for (const e of this.s.world.enemies()) {
      const d = dist(p.pos, e.pos) - e.radius;
      if (d < near) {
        near = d;
        threat = e.attack.range;
      }
    }
    if (Number.isFinite(near)) {
      this.samples++;
      this.closest += near;
      if (near > threat * 0.92) this.safeSum += dt;
    }
  }

  private safeRatio(): number {
    return clamp(this.safeSum / Math.max(0.5, this.s.elapsed), 0, 1);
  }

  protected modeField(): HudField {
    const safe = this.safeRatio();
    return {
      label: 'OUT OF REACH',
      value: `${Math.round(safe * 100)}%`,
      bar: safe,
      tone: safe > 0.8 ? 'good' : safe > 0.55 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    void accuracy;
    return {
      tempo: clamp(speed * 0.5 + performance * 0.5, 0, 1),
      kiting: clamp(this.uptime() * 0.45 + this.safeRatio() * 0.55, 0, 1),
      spacing: this.safeRatio(),
      dodging: clamp(1 - this.hitsTaken / 12, 0, 1),
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [
      ...super.modeMetrics(),
      pct('safe', 'TIME OUT OF THEIR RANGE', this.safeRatio()),
      count('taken', 'HITS TAKEN', this.hitsTaken, 'lower'),
    ];
  }

  protected notes() {
    const avg = this.samples ? this.closest / this.samples : 0;
    return {
      helped: this.safeRatio() > 0.85 ? ['You held the gap for most of the run while still attacking.'] : [],
      hurt: avg > 0 && avg < 120 ? ['You are kiting inside their reach — that is trading, not kiting.'] : [],
      advice:
        this.hitsTaken > 8
          ? 'Step away first, attack second. The instinct to get one more attack in is what closes the gap.'
          : null,
    };
  }
}
