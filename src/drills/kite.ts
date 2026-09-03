import { clamp, dist } from '../engine/math';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import { derive } from '../engine/metrics';
import type { HudField } from '../engine/session';
import { Drill, band, count, ms, pct, secs, type DrillOutcome } from './base';
import type { Actor } from '../engine/types';

/**
 * KITE — the flagship drill.
 *
 * Attack, step in the backswing, attack again. The pursuer is deliberately a
 * little slower than you, so perfect orbwalking is always survivable and every
 * point you lose is a point you actually gave away: a cancelled windup, a
 * missed attack window, or standing still when you could have been moving.
 */
export class KiteDrill extends Drill {
  private respawnCd = 0;
  private kills = 0;
  private wanted = 1;
  private lastRhythmPulse = 0;

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const p = this.s.world.spawnPlayer({ x: w / 2, y: h * 0.72 });
    // A rhythm drill should always run its full sixty seconds: health here is
    // a graded cost of sloppy spacing, not a fail state that cuts the run.
    p.maxHp = 1600;
    p.hp = 1600;
    this.wanted = this.s.config.difficulty > 0.62 ? 2 : 1;
    for (let i = 0; i < this.wanted; i++) this.spawnPursuer();
  }

  private spawnPursuer(): void {
    const p = this.s.world.player;
    const pos = this.randomPoint(p?.pos ?? null, 520, 140);
    const a = this.spawnEnemy('diver', pos, { hpScale: 0.72 });
    // An orbwalker only moves during the free window — roughly 75% of the
    // attack cycle — so their *effective* speed is about 260u/s, not 345.
    // The pursuer is tuned against that effective figure: comfortably slower
    // at low difficulty, and a genuine race at the top.
    a.moveSpeed = 148 + this.s.config.difficulty * 76;
    // This drill is about rhythm, so contact costs tempo and health but does
    // not end the run in three mistakes. The 1v1 arena is where damage bites.
    a.attack.damage = 19 + this.s.config.difficulty * 19;
    a.label = 'PURSUER';
    const brain = this.brains[this.brains.length - 1];
    if (brain) brain.tune = { ...brain.tune, aggression: 0.34 + this.s.config.difficulty * 0.5 };
    this.s.fx.ring(pos.x, pos.y, 10, 120, 0.5, PALETTE.hazard, 2.5, 'shock');
  }

  update(dt: number): void {
    this.updateBrains(dt);

    const alive = this.s.world.enemies().length;
    if (alive < this.wanted) {
      this.respawnCd -= dt;
      if (this.respawnCd <= 0) {
        this.respawnCd = 1.1;
        this.spawnPursuer();
      }
    }

    // Rhythm feedback: a soft pulse in time with the attack cycle while the
    // player is chaining cleanly. It is the visual metronome of orbwalking.
    const player = this.s.world.player;
    if (player && this.s.chain >= 2) {
      const cycle = 1 / player.attack.attackSpeed;
      if (this.s.elapsed - this.lastRhythmPulse > cycle) {
        this.lastRhythmPulse = this.s.elapsed;
        this.s.fx.ring(
          player.pos.x,
          player.pos.y,
          player.radius + 6,
          player.radius + 30 + this.s.chain * 4,
          0.45,
          PALETTE.accent,
          1.6,
          'pulse',
        );
      }
    }
  }

  onEvents(events: readonly { type: string; byPlayer?: boolean }[]): void {
    for (const e of events) if (e.type === 'death' && e.byPlayer) this.kills++;
  }

  paint(out: DrillPaint, t: number): void {
    const p = this.s.world.player;
    if (!p) return;
    // Threat rings: the distance at which each pursuer can hit you. The one
    // you are standing inside lights up and fills, because that is the only
    // one that is costing you anything.
    for (const e of this.s.world.enemies()) {
      const r = e.attack.range + p.radius;
      const inside = dist(p.pos, e.pos) < r;
      out.markers.push({
        kind: 'ring',
        x: e.pos.x,
        y: e.pos.y,
        radius: r,
        color: PALETTE.danger,
        alpha: inside ? 0.55 + 0.2 * Math.sin(t * 8) : 0.22,
        width: inside ? 4 : 2.5,
        dash: 46,
        spin: -0.22,
        fill: inside ? 0.07 : 0,
        rise: 1.8,
      });
    }
  }

  onTargetOrder(_a: Actor): void {}

  hudFields(): HudField[] {
    const d = derive(this.s.metrics.m);
    return [
      {
        label: 'ORBWALK',
        value: `${Math.round(d.orbwalkEfficiency * 100)}%`,
        bar: d.orbwalkEfficiency,
        tone: d.orbwalkEfficiency > 0.75 ? 'good' : d.orbwalkEfficiency > 0.55 ? 'warn' : 'bad',
      },
      // The number a kiting drill should lead with is not how much damage you
      // did — it is how late each shot was. Damage is the consequence; this is
      // the cause, and it is the only one of the two you can act on mid-run.
      {
        label: 'LATE',
        value: `${Math.round(d.attackLatency)}ms`,
        bar: d.attackPunctuality,
        tone: d.attackLatency < 90 ? 'good' : d.attackLatency < 220 ? 'warn' : 'bad',
      },
      {
        label: 'CANCELS',
        value: `${this.s.metrics.m.attacksCancelled}`,
        tone: this.s.metrics.m.attacksCancelled > 2 ? 'bad' : 'good',
      },
      { label: 'KILLS', value: `${this.kills}`, tone: 'neutral' },
    ];
  }

  liveScore(): number {
    const m = this.s.metrics.m;
    const d = derive(m);
    return Math.max(0, Math.round(
      m.damageDealt * 8 * (0.5 + d.orbwalkEfficiency) +
        this.kills * 2200 +
        this.s.chainBest * 260 -
        m.attacksCancelled * 480 -
        m.hpLost * 3,
    ));
  }

  outcome(): DrillOutcome {
    const m = this.s.metrics.m;
    const d = derive(m);
    const chainScore = band(m.maxChain, 2, 14);
    const cleanliness = band(d.cancelRate, 0.28, 0.0);
    const hpRetained = d.hpRetained;
    const damageRate = band(m.damageDealt / Math.max(1, this.s.elapsed), 12, 42);

    // The timing read carries almost as much as the efficiency read, and the
    // two fail differently: efficiency notices that you are not attacking or
    // not moving, timing notices *when* in the cycle you are losing it. A run
    // can be efficient and badly timed — every shot a beat late, every
    // backswing stood through — and it should not score like a clean one.
    const performance = clamp(
      d.orbwalkEfficiency * 0.28 +
        d.attackTiming * 0.24 +
        cleanliness * 0.1 +
        damageRate * 0.1 +
        hpRetained * 0.2 +
        chainScore * 0.08,
      0,
      1,
    ) * (0.86 + 0.14 * d.commandDiscipline);

    const helped: string[] = [];
    const hurt: string[] = [];
    if (d.orbwalkEfficiency > 0.78) helped.push('Your attack and movement windows are almost fully used.');
    if (m.attacksCancelled === 0 && m.attacksStarted > 8) helped.push('Zero cancelled attacks across the whole run.');
    if (m.maxChain >= 8) helped.push(`A ${m.maxChain}-attack clean chain at your best.`);
    if (d.cancelRate > 0.12) hurt.push(`${Math.round(d.cancelRate * 100)}% of your attacks were cancelled mid-windup.`);
    if (d.moveEfficiency < 0.55) hurt.push('You stood still through much of your free movement window.');
    if (d.attackEfficiency < 0.6) hurt.push('You missed attack windows — the timer came up while you were out of range.');
    if (d.hpLostCapped > 250) hurt.push(`${Math.round(d.hpLostCapped)} health given up to a slower opponent.`);
    if (d.attackLatency < 70 && m.attacksCompleted > 12) helped.push(`Every shot taken within ${Math.round(d.attackLatency)}ms of coming up.`);
    if (d.attackLatency > 220) hurt.push(`Each attack went out ${Math.round(d.attackLatency)}ms after it was available — that is a fifth of your damage.`);
    if (d.backswingUse < 0.5 && m.backswingTime > 3) hurt.push('You stood through your backswings. That half of the cycle is free movement.');
    if (m.haltTime > 4) hurt.push(`${m.haltTime.toFixed(1)}s spent stood still by attack commands fired before the timer was up.`);

    const advice =
      m.haltTime > 5
        ? 'Stop mashing the attack command. Each one plants your feet until the shot leaves — pressed early it buys you nothing but standing still.'
        : d.backswingUse < 0.5 && m.backswingTime > 3
        ? 'The damage is already done when the projectile leaves. Move the instant it does — the backswing is free.'
        : d.attackLatency > 220
        ? 'Your shots are landing late. Watch the cooldown ring, not the enemy: the attack goes out the frame it closes.'
        : d.cancelRate > 0.1
        ? 'Wait for the hit to register before you click away. The damage happens at the end of the windup, not the start.'
        : d.moveEfficiency < 0.6
          ? 'After each attack lands, move immediately — every frame you stand still there is free distance lost.'
          : d.attackEfficiency < 0.7
            ? 'You are moving too far between attacks. Step just enough to stay at range, then re-engage.'
            : 'This is clean. Take it to 1v2 and keep the same rhythm under real pressure.';

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: {
        kiting: performance,
        spacing: clamp(band(d.avgSpacingError, 240, 40), 0, 1),
        movement: clamp(d.moveEfficiency, 0, 1),
      },
      keyMetrics: [
        pct('orbwalk', 'ORBWALK EFFICIENCY', d.orbwalkEfficiency),
        count('cancels', 'ATTACK CANCELS', m.attacksCancelled, 'lower'),
        ms('latency', 'ATTACK LATENCY', d.attackLatency),
        pct('backswing', 'BACKSWING USED', d.backswingUse),
        pct('uptime', 'DPS UPTIME', d.dpsUptime),
        count('chain', 'BEST CHAIN', m.maxChain),
        secs('danger', 'DANGER EXPOSURE', m.dangerExposure, 'lower'),
      ],
      helped,
      hurt,
      advice,
    };
  }
}
