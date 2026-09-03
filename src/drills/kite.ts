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
/**
 * The three shapes a kite takes, and the order they arrive in.
 *
 * Orbwalking against something walking at you is one skill. Orbwalking
 * *forwards*, at something running away, is a different one with the same
 * name — you have to close the gap in the free window instead of opening it,
 * and every attack you take costs you ground you then have to make up. Almost
 * nobody practises the second, and it is half of every chase in a real game.
 *
 * The third is neither: something that will not commit to either, so the
 * answer keeps changing and the rhythm cannot be run open-loop.
 */
type KitePhase = 'chased' | 'chasing' | 'irregular';

interface PhaseBook {
  time: number;
  attacks: number;
}

export class KiteDrill extends Drill {
  private respawnCd = 0;
  private kills = 0;
  private wanted = 1;
  private lastRhythmPulse = 0;
  private phase: KitePhase = 'chased';
  private phaseCd = 15;
  private book: Record<KitePhase, PhaseBook> = {
    chased: { time: 0, attacks: 0 },
    chasing: { time: 0, attacks: 0 },
    irregular: { time: 0, attacks: 0 },
  };

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
    const a = this.spawnEnemy('diver', pos, { hpScale: 0.72, behavior: this.behaviorFor(this.phase) });
    // An orbwalker only moves during the free window — roughly 75% of the
    // attack cycle — so their *effective* speed is about 260u/s, not 345.
    // The pursuer is tuned against that effective figure: comfortably slower
    // at low difficulty, and a genuine race at the top.
    a.moveSpeed = 148 + this.s.config.difficulty * 76;
    // This drill is about rhythm, so contact costs tempo and health but does
    // not end the run in three mistakes. The 1v1 arena is where damage bites.
    a.attack.damage = 19 + this.s.config.difficulty * 19;
    a.label = 'PURSUER';
    const brain = this.lastBrain;
    if (brain) {
      brain.tune = { ...brain.tune, aggression: 0.34 + this.s.config.difficulty * 0.5 };
      brain.preferredRange = this.rangeFor(this.phase);
    }
    this.s.fx.ring(pos.x, pos.y, 10, 120, 0.5, PALETTE.hazard, 2.5, 'shock');
  }

  private behaviorFor(phase: KitePhase): 'chase' | 'retreat' | 'irregular' {
    return phase === 'chased' ? 'chase' : phase === 'chasing' ? 'retreat' : 'irregular';
  }

  /** How far it wants to be. Running means wanting to be a long way off. */
  private rangeFor(phase: KitePhase): number {
    return phase === 'chasing' ? 820 : phase === 'irregular' ? 380 : 110;
  }

  private setPhase(next: KitePhase): void {
    this.phase = next;
    for (const b of this.brains) {
      b.behavior = this.behaviorFor(next);
      b.preferredRange = this.rangeFor(next);
    }
    this.s.setBanner(
      next === 'chased' ? 'THEY COME TO YOU' : next === 'chasing' ? 'THEY RUN — KEEP ATTACKING' : 'NEITHER',
      1.5,
    );
    const p = this.s.world.player;
    if (p) this.s.fx.ring(p.pos.x, p.pos.y, p.radius + 8, p.radius + 90, 0.5, PALETTE.warn, 2.4, 'pulse');
  }

  update(dt: number): void {
    this.updateBrains(dt);

    // The phase clock. Fifteen seconds each, in a fixed order, so a run always
    // contains all three and nobody can be good at this drill by only ever
    // having practised the half of it that walks toward them.
    this.book[this.phase].time += dt;
    this.phaseCd -= dt;
    if (this.phaseCd <= 0) {
      this.phaseCd = 15;
      this.setPhase(this.phase === 'chased' ? 'chasing' : this.phase === 'chasing' ? 'irregular' : 'chased');
    }

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

  onEvents(events: readonly { type: string; byPlayer?: boolean; actorId?: number }[]): void {
    for (const e of events) {
      if (e.type === 'death' && e.byPlayer) this.kills++;
      if (e.type === 'attackRelease' && e.actorId === this.s.world.playerId) this.book[this.phase].attacks++;
    }
  }

  /** Attacks landed against attacks that were available, in one phase. */
  private phaseEfficiency(phase: KitePhase): number {
    const p = this.s.world.player;
    const book = this.book[phase];
    if (!p || book.time < 2) return 0;
    const cycle = 1 / Math.max(0.05, p.attack.attackSpeed);
    return clamp(book.attacks / (book.time / cycle), 0, 1);
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
      {
        label: this.phase === 'chased' ? 'THEY CHASE' : this.phase === 'chasing' ? 'YOU CHASE' : 'IRREGULAR',
        value: `${Math.round(this.phaseEfficiency(this.phase) * 100)}%`,
        bar: this.phaseEfficiency(this.phase),
        tone: 'neutral',
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
    // Kiting forwards and kiting backwards are two skills with one name, and
    // the weaker of the two is the one that decides a fight. So the drill is
    // graded on the worse half rather than the average: a player who can only
    // orbwalk away from things has not learnt to orbwalk.
    const chased = this.phaseEfficiency('chased');
    const chasing = this.phaseEfficiency('chasing');
    const irregular = this.phaseEfficiency('irregular');
    const weakest = Math.min(chased, chasing, irregular);
    const bothWays = clamp(weakest * 0.6 + (chased + chasing + irregular) / 3 * 0.4, 0, 1);

    const performance = clamp(
      d.orbwalkEfficiency * 0.24 +
        d.attackTiming * 0.2 +
        bothWays * 0.16 +
        cleanliness * 0.08 +
        damageRate * 0.08 +
        hpRetained * 0.16 +
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
    if (chasing > 0.65 && chased > 0.65) helped.push('You kite forwards as well as backwards — most players only own one of those.');
    if (chasing < chased - 0.2) hurt.push('Your damage falls apart the moment they run. Closing the gap happens in the same free window that opening it does.');
    if (chased < chasing - 0.2) hurt.push('You chase well and panic when chased. Step back in the backswing, not in the windup.');

    const advice =
      chasing < 0.45 && chased > 0.6
        ? 'You can only kite backwards. When they run, close in the free window and attack the instant you are in range — chasing is orbwalking with the radial sign flipped.'
        : m.haltTime > 5
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
        pct('chased', 'KITING WHILE CHASED', chased),
        pct('chasing', 'KITING WHILE CHASING', chasing),
        pct('advantage', 'ADVANTAGEOUS SPACING', d.advantageousSpacing),
        secs('danger', 'DANGER EXPOSURE', m.dangerExposure, 'lower'),
      ],
      helped,
      hurt,
      advice,
    };
  }
}
