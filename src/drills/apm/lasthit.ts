import { audio } from '../../engine/audio';
import { Lane, RivalBrain, pendingHits, sumPending, type PendingHit } from '../../engine/lane';
import { clamp, dist } from '../../engine/math';
import { PALETTE } from '../../engine/palette';
import type { DrillPaint } from '../../engine/paint';
import type { HudField } from '../../engine/session';
import type { Actor, Vec2 } from '../../engine/types';
import type { WorldEvent } from '../../engine/world';
import type { KeyMetric } from '../../progression/profile';
import type { SkillAxis } from '../../progression/skills';
import { count, pct } from '../base';
import { ApmDrill } from './engine';

/**
 * The lane modes.
 *
 * These are the same lane the Rhythm drill runs — two waves walking into each
 * other, turrets behind both, no damage arriving from nowhere — asked a
 * different question. That drill asks whether you can read a bar. These ask
 * how many of them you can read a minute, which is the difference between
 * knowing what a last hit is and actually taking a whole wave.
 *
 * The three verbs map onto laning almost too neatly:
 *
 *   hit    — a minion secured, worth more the fewer attacks it cost.
 *   stray  — an attack thrown at a healthy minion. It pushes the wave, it
 *            empties your timer for the minion dropping a second later, and
 *            it is exactly what "an input that meant nothing" describes.
 *   fumble — a minion that died inside your window while your attack was up
 *            and in range. Not every minion you lose: only the ones you could
 *            have had, because three bars can empty in the same second.
 */
abstract class ApmLaneDrill extends ApmDrill {
  protected lane!: Lane;
  protected rival: RivalBrain | null = null;

  protected cs = 0;
  protected perfectCs = 0;
  protected cannons = 0;
  protected missed = 0;
  protected pushes = 0;
  protected rivalCs = 0;
  /** Attacks of yours that have landed on each enemy minion. */
  private swings = new Map<number, number>();
  private pending: PendingHit[] = [];

  /** Seconds between waves. The lane's own tempo, tightened for a rate drill. */
  protected abstract waveGap(): number;
  /** Whether an enemy laner is competing with you for the same farm. */
  protected abstract contested(): boolean;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    this.lane = new Lane(this.s.world, this.s.rng, { bounds: { w, h }, difficulty: this.d });
    this.s.world.spawnPlayer({ x: w * 0.4, y: h * 0.5 + 150 });
    if (this.contested()) {
      this.rival = new RivalBrain(
        this.lane.spawnRival({ x: w * 0.62, y: h * 0.5 - 150 }),
        this.lane,
        this.s.rng,
        this.d,
      );
    }
    this.lane.waveCd = 0;
  }

  protected tick(dt: number): void {
    this.lane.update(dt);
    this.rival?.update(this.s.world, dt);
    this.regenerate(dt);

    for (const e of this.lane.drainEvents()) {
      // The lane paces itself for a ninety-second farming drill. These modes
      // are shorter and are asking about rate, so the next wave is already
      // walking before the last one is finished — there has to be more farm
      // available in the run than one pair of hands can take.
      this.lane.waveCd = Math.min(this.lane.waveCd, this.waveGap());
      if (e.kind === 'cannon') {
        this.s.setBanner(`WAVE ${e.wave} · CANNON`, 1.2);
        audio.play('announce', { intensity: 0.5 });
      }
    }
  }

  /** Out of combat, health comes back. Same reason as the Rhythm lane's. */
  private regenerate(dt: number): void {
    const p = this.s.world.player;
    if (!p || !p.alive || p.hp >= p.maxHp) return;
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.045 * dt);
  }

  /**
   * Where a minion's health will be when an attack started now lands.
   *
   * Everything already in the air from everybody else is subtracted; your own
   * committed damage is not, because the question being asked is "is this one
   * mine", and an arrow you already fired is the reason it might be.
   */
  protected read(m: Actor, p: Actor): { hpAtLanding: number; mineInFlight: number; inRange: boolean } {
    const cycle = 1 / Math.max(0.05, p.attack.attackSpeed);
    const gap = Math.max(0, dist(p.pos, m.pos) - m.radius);
    const travel = p.attack.projectileSpeed > 0 ? gap / p.attack.projectileSpeed : 0;
    const windup = p.phase === 'windup' && p.targetId === m.id ? p.phaseTime : cycle * p.attack.windupRatio;
    const hits = pendingHits(this.s.world, m, this.pending);
    return {
      hpAtLanding: m.hp - sumPending(hits, windup + travel, { exclude: p.id }),
      mineInFlight: sumPending(hits, Infinity, { only: p.id }),
      inRange: gap <= p.attack.range,
    };
  }

  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    const p = this.s.world.player;
    for (const e of events) {
      if (e.type === 'attackRelease' && e.actorId != null) {
        const a = this.s.world.byId(e.actorId);
        if (a?.unitKind === 'turret') this.lane.noteTurretShot(a.id);
        if (e.actorId === pid && p) {
          const t = this.s.world.byId(e.targetId);
          if (t?.isMinion && t.team === 'enemy') {
            this.swings.set(t.id, (this.swings.get(t.id) ?? 0) + 1);
            // Judged at release, before the damage is counted: a swing at a
            // minion that was never in your window pushed the wave whether or
            // not something else killed it while the arrow was in the air.
            const r = this.read(t, p);
            if (r.hpAtLanding - r.mineInFlight > p.attack.damage) {
              this.pushes++;
              this.stray(t.pos);
            }
          }
        }
        continue;
      }

      if (e.type !== 'death' || e.actorId == null) continue;
      const victim = this.s.world.byId(e.actorId);
      const pos = e.pos ?? victim?.pos;
      if (!victim || !pos) continue;

      if (victim.isMinion && victim.team === 'enemy') {
        const swings = this.swings.get(victim.id) ?? 0;
        this.swings.delete(victim.id);
        if (e.byPlayer) {
          this.cs++;
          const clean = swings <= 1;
          if (clean) this.perfectCs++;
          if (victim.unitKind === 'cannon') this.cannons++;
          this.hit(pos, {
            quality: clean ? 0.95 : clamp(1 - (swings - 1) * 0.3, 0, 0.65),
            value: victim.unitKind === 'cannon' ? 260 : 140,
            action: false,
            label: victim.unitKind === 'cannon' ? 'CANNON' : clean ? 'CLEAN' : undefined,
            color: victim.unitKind === 'cannon' ? PALETTE.warn : undefined,
          });
        } else {
          if (this.rival && e.targetId === this.rival.actor.id) this.rivalCs++;
          this.judgeLoss(victim, pos, p);
        }
      }
    }
  }

  /**
   * A minion you lost only counts if you could have taken it: it was inside
   * one of your attacks, in range, and your attack was actually available.
   * Anything else is arithmetic, and breaking a chain over arithmetic teaches
   * nothing except that the chain is arbitrary.
   */
  private judgeLoss(victim: Actor, pos: Vec2, p: Actor | undefined): void {
    const takeable =
      !!p &&
      p.alive &&
      dist(p.pos, pos) - victim.radius <= p.attack.range &&
      p.attackCd <= 0.2 &&
      p.phase !== 'windup';
    if (!takeable) {
      this.s.fx.ring(pos.x, pos.y, 6, 30, 0.22, PALETTE.textFaint, 1.4, 'impact');
      return;
    }
    this.missed++;
    this.fumble(pos, victim.unitKind === 'cannon' ? 'CANNON LOST' : 'MISSED', {
      input: false,
      cost: victim.unitKind === 'cannon' ? 120 : 60,
    });
  }

  /** Attack orders and the steps between bars: both are the counted action. */
  onClick(pos: Vec2): boolean {
    this.noteMove(pos);
    return false;
  }

  protected onDirectMove(): void {}

  protected csRate(): number {
    return this.cs / Math.max(1, this.cs + this.missed);
  }

  /** Attacks thrown per minion secured. A clean farmer sits at one. */
  protected attacksPerCs(): number {
    return this.cs > 0 ? (this.cs + this.pushes) / this.cs : 0;
  }

  protected paintMode(out: DrillPaint, t: number): void {
    const p = this.s.world.player;
    if (!p) return;

    out.markers.push({
      kind: 'line',
      x: this.lane.allyGate.x - 160,
      y: this.lane.laneY,
      x2: this.lane.enemyGate.x + 160,
      y2: this.lane.laneY,
      halfWidth: 156,
      color: PALETTE.textFaint,
      alpha: 0.16,
      fill: 1,
      rise: 0.4,
    });

    for (const turret of [this.lane.allyTurret, this.lane.enemyTurret]) {
      const ally = turret.team === 'player';
      const hot = !ally && dist(p.pos, turret.pos) < turret.attack.range;
      out.markers.push({
        kind: 'ring',
        x: turret.pos.x,
        y: turret.pos.y,
        radius: turret.attack.range,
        color: ally ? PALETTE.accentDim : PALETTE.danger,
        alpha: hot ? 0.34 + 0.16 * Math.sin(t * 6) : 0.085,
        width: hot ? 4 : 2,
        dash: 90,
        spin: ally ? 0.05 : -0.05,
      });
    }

    // The plates stay at every level here. In a rate drill the bottleneck is
    // meant to be your hands, not your eyesight: aggregating the damage that
    // is already on the screen onto the bar it is flying toward is legibility,
    // and taking it away would only measure how well you can squint.
    for (const m of this.lane.enemyMinions()) {
      const r = this.read(m, p);
      const tone =
        r.mineInFlight > 0
          ? 'ready'
          : r.hpAtLanding <= 0
            ? 'losing'
            : r.hpAtLanding <= p.attack.damage
              ? 'ready'
              : undefined;
      out.plates.push({
        actorId: m.id,
        incoming: Math.min(m.hp / m.maxHp, (m.hp - r.hpAtLanding) / m.maxHp),
        threshold: p.attack.damage / m.maxHp,
        tone,
      });
      if (m.unitKind === 'cannon') {
        out.billboards.push({ kind: 'caret', x: m.pos.x, y: m.pos.y, color: PALETTE.warn, lift: 190 });
      }
    }
  }

  protected modeField(): HudField {
    const rate = this.csRate();
    return {
      label: 'CS',
      value: `${this.cs}`,
      bar: rate,
      tone: rate > 0.85 ? 'good' : rate > 0.65 ? 'warn' : 'bad',
    };
  }

  protected axisSplit(performance: number, accuracy: number, speed: number): Partial<Record<SkillAxis, number>> {
    void accuracy;
    return {
      tempo: clamp(speed * 0.55 + performance * 0.45, 0, 1),
      lastHitting: clamp(this.csRate() * 0.6 + performance * 0.4, 0, 1),
      targeting: performance,
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [
      count('cs', 'MINIONS TAKEN', this.cs),
      pct('csRate', 'OF THE ONES YOU COULD', this.csRate()),
      count('perfect', 'ONE-ATTACK KILLS', this.perfectCs),
      count('pushes', 'SWINGS AT FULL HEALTH', this.pushes, 'lower'),
    ];
  }
}

/**
 * LAST HIT — a whole wave, at rate.
 *
 * No rival: the only thing between you and every minion in the lane is how
 * fast you can move between bars without swinging at one that is not yours.
 * Waves overlap on purpose, so there is always more farm on the screen than
 * one attack timer can take.
 */
export class ApmLastHitDrill extends ApmLaneDrill {
  protected readonly targetApm = 110;
  protected get targetRate(): number {
    // Two-thirds of a dense lane's minions. Nobody takes all of them.
    return 26;
  }

  protected waveGap(): number {
    return 9.5 - this.d * 1.5;
  }
  protected contested(): boolean {
    return false;
  }

  protected notes() {
    return {
      helped: this.csRate() > 0.9 && this.cs > 15 ? ['Almost nothing inside your reach died without you.'] : [],
      hurt: this.pushes > this.cs * 0.4 ? ['You are swinging at healthy minions, which pushes the wave for free.'] : [],
      advice:
        this.perfectCs < this.cs * 0.5 && this.cs > 8
          ? 'You are chipping. Let the wave do the damage and arrive with one attack, not three.'
          : this.attacksPerCs() > 1.6
            ? 'Stand between two bars rather than next to one. Most of a fast lane is where you are, not how fast you click.'
            : null,
    };
  }
}

/**
 * LAST HIT 2 — the same wave, with someone taking it off you.
 *
 * An enemy laner stands opposite doing your job, and every minion is now a
 * race. The rate is the same rate; what changes is that hesitating costs the
 * minion to somebody rather than to a turret, and the HUD keeps the score.
 */
export class ApmLastHit2Drill extends ApmLaneDrill {
  protected readonly targetApm = 130;
  protected get targetRate(): number {
    // Lower than the empty lane: some of this wave was never going to be yours.
    return 20;
  }

  protected waveGap(): number {
    return 10 - this.d * 1.5;
  }
  protected contested(): boolean {
    return true;
  }

  protected modeField(): HudField {
    const total = this.cs + this.rivalCs;
    return {
      label: 'CS · YOU / THEM',
      value: `${this.cs} / ${this.rivalCs}`,
      bar: total > 0 ? this.cs / total : 0.5,
      tone: this.cs > this.rivalCs ? 'good' : this.cs === this.rivalCs ? 'warn' : 'bad',
    };
  }

  protected modeMetrics(): KeyMetric[] {
    return [
      count('cs', 'MINIONS TAKEN', this.cs),
      count('rivalCs', 'THEIRS', this.rivalCs, 'lower'),
      pct('csRate', 'OF THE ONES YOU COULD', this.csRate()),
      count('pushes', 'SWINGS AT FULL HEALTH', this.pushes, 'lower'),
    ];
  }

  protected notes() {
    const ahead = this.cs - this.rivalCs;
    return {
      helped: ahead > 6 ? [`You out-farmed the rival by ${ahead}.`] : [],
      hurt: ahead < -4 ? [`The rival took ${-ahead} more minions than you did.`] : [],
      advice:
        ahead < 0
          ? 'You are waiting for certainty on bars they are already swinging at. Commit a fraction earlier — their windup is the clock, not yours.'
          : null,
    };
  }
}
