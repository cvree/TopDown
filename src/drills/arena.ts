import { audio } from '../engine/audio';
import { ARCHETYPES } from '../engine/archetypes';
import { clamp, dist, norm } from '../engine/math';
import { derive } from '../engine/metrics';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { AbilitySlot } from '../engine/input';
import type { AbilityView, HudField } from '../engine/session';
import type { ArchetypeId, Vec2 } from '../engine/types';
import type { WorldEvent } from '../engine/world';
import { Drill, band, count, pct, secs, type DrillOutcome } from './base';

const HARD_CAP = 150;
const BLINK_CD = 20;
const BLINK_RANGE = 375;

/**
 * 1v1 / 1v2 / 1v3 — everything at once.
 *
 * No farming, no walking across a map. Enemies that move, attack, cast, dodge,
 * chase, retreat and respect their cooldowns. You get one summoner (blink) and
 * your autos, and the run ends the moment it is decided either way.
 */
export class ArenaDrill extends Drill {
  private blinkCd = 0;
  private killed = 0;
  private startedWith = 1;
  private focusChanges = 0;
  private lastFocus = -1;

  constructor(s: import('../engine/session').Session, private readonly count_: 1 | 2 | 3) {
    super(s);
  }

  setup(): void {
    const { w, h } = this.s.world.bounds;
    const player = this.s.world.spawnPlayer({ x: w / 2, y: h * 0.78 });
    // Three enemies focusing one target will end a 760-health run in eight
    // seconds, which teaches nothing. The extra health buys enough fight to
    // practise priority and dodging; the enemies stay individually lethal.
    player.maxHp = 760 + (this.count_ - 1) * 270;
    player.hp = player.maxHp;
    this.startedWith = this.count_;

    // Composition is drawn to guarantee variety of pressure: never three of
    // the same archetype, and always at least one that closes distance.
    const melee: ArchetypeId[] = ['diver', 'duelist', 'juggernaut'];
    const ranged: ArchetypeId[] = ['ranger', 'artillery', 'controller'];
    const picks: ArchetypeId[] = [];
    if (this.count_ === 1) {
      picks.push(this.s.rng.pick([...melee, ...ranged]));
    } else {
      picks.push(this.s.rng.pick(melee));
      picks.push(this.s.rng.pick(ranged));
      if (this.count_ === 3) {
        const rest = [...melee, ...ranged].filter((a) => !picks.includes(a));
        picks.push(this.s.rng.pick(rest));
      }
    }

    // Outnumbered fights shorten each enemy rather than making the fight a
    // slog — the lesson is survival and priority, not endurance.
    const hpScale = this.count_ === 1 ? 1 : this.count_ === 2 ? 0.6 : 0.46;
    picks.forEach((id, i) => {
      const spread = (i - (picks.length - 1) / 2) * 300;
      const a = this.spawnEnemy(id, { x: w / 2 + spread, y: h * 0.2 }, { hpScale });
      this.s.fx.ring(a.pos.x, a.pos.y, 10, 160, 0.7, ARCHETYPES[id].color, 3, 'shock');
    });
  }

  onStart(): void {
    const names = this.s.world.enemies().map((e) => e.label ?? '').join('  ·  ');
    this.s.setBanner(names, 1.8);
  }

  update(dt: number): void {
    this.updateBrains(dt);
    if (this.blinkCd > 0) this.blinkCd -= dt;

    const player = this.s.world.player;
    if (player && player.targetId !== this.lastFocus && player.targetId != null) {
      this.lastFocus = player.targetId;
      this.focusChanges++;
    }

    if (this.s.world.enemies().length === 0) {
      this.endReason = 'complete';
      this.s.forceEnd = true;
    } else if (this.s.elapsed > HARD_CAP) {
      this.endReason = 'time';
      this.s.forceEnd = true;
    }
  }

  onAbility(slot: AbilitySlot, at: Vec2): void {
    if (slot !== 'd' || this.blinkCd > 0) return;
    const p = this.s.world.player;
    if (!p) return;
    const d = Math.min(BLINK_RANGE, dist(p.pos, at));
    const dir = norm(at.x - p.pos.x, at.y - p.pos.y);
    const from = { ...p.pos };
    p.pos.x = clamp(p.pos.x + dir.x * d, p.radius, this.s.world.bounds.w - p.radius);
    p.pos.y = clamp(p.pos.y + dir.y * d, p.radius, this.s.world.bounds.h - p.radius);
    p.prev.x = p.pos.x;
    p.prev.y = p.pos.y;
    p.order = null;
    this.blinkCd = BLINK_CD;
    audio.play('dodge');
    this.s.fx.ring(from.x, from.y, 6, 110, 0.4, PALETTE.accent, 3, 'shock');
    this.s.fx.ring(p.pos.x, p.pos.y, 90, 12, 0.35, PALETTE.playerCore, 3, 'shock');
    this.s.fx.trace([from, { ...p.pos }], PALETTE.accent, 0.5, 6);
    this.s.fx.burst(p.pos.x, p.pos.y, 16, { color: PALETTE.accent, speed: 300, life: 0.4, size: 2.4 });
  }

  abilities(): AbilityView[] {
    // The blink is the only thing on the bar in a duel, so it gets a live
    // cooldown sweep. A summoner you cannot see the timer on is a summoner you
    // hold forever.
    return super.abilities().map((a) =>
      a.slot === 'd' ? { ...a, name: 'BLINK', cd: clamp(this.blinkCd / BLINK_CD, 0, 1), locked: false } : a,
    );
  }

  onEvents(events: readonly WorldEvent[]): void {
    for (const e of events) {
      if (e.type === 'death' && e.byPlayer) {
        this.killed++;
        const left = this.s.world.enemies().length;
        if (left > 0) this.s.setBanner(`${left} LEFT`, 1.0);
        this.s.fx.addFlash(0.1, PALETTE.accent);
      }
    }
  }

  paint(out: DrillPaint, t: number): void {
    const p = this.s.world.player;
    if (!p) return;
    // Only the ranges that currently threaten you are drawn. Every enemy's
    // range at once is noise; the one that can hit you right now is a read.
    for (const e of this.s.world.enemies()) {
      const r = e.attack.range + p.radius;
      if (dist(p.pos, e.pos) >= r) continue;
      out.markers.push({
        kind: 'ring',
        x: e.pos.x,
        y: e.pos.y,
        radius: r,
        color: PALETTE.danger,
        alpha: 0.34 + 0.16 * Math.sin(t * 6),
        width: 3,
        dash: 54,
        spin: -0.2,
        rise: 1.8,
      });
    }
  }

  hudFields(): HudField[] {
    const d = derive(this.s.metrics.m);
    return [
      { label: 'ENEMIES', value: `${this.s.world.enemies().length}`, tone: 'neutral' },
      {
        label: 'BLINK',
        value: this.blinkCd > 0 ? `${this.blinkCd.toFixed(0)}s` : 'READY',
        bar: 1 - clamp(this.blinkCd / BLINK_CD, 0, 1),
        tone: this.blinkCd > 0 ? 'warn' : 'good',
      },
      {
        label: 'ORBWALK',
        value: `${Math.round(d.orbwalkEfficiency * 100)}%`,
        bar: d.orbwalkEfficiency,
        tone: d.orbwalkEfficiency > 0.7 ? 'good' : 'warn',
      },
    ];
  }

  liveScore(): number {
    const m = this.s.metrics.m;
    const d = derive(m);
    const won = this.killed >= this.startedWith;
    // The live score only ever climbs with what you achieve — damage taken is
    // already priced in through the health-retention term.
    return Math.max(0, Math.round(
      m.damageDealt * 9 +
        this.killed * 4200 * this.startedWith * 0.6 +
        (won ? 9000 * this.startedWith : 0) +
        d.hpRetained * 6000 +
        m.nearMisses * 120,
    ));
  }

  outcome(): DrillOutcome {
    const m = this.s.metrics.m;
    const d = derive(m);
    const won = this.killed >= this.startedWith && m.survived;
    const killFraction = this.killed / this.startedWith;
    // The outcome term rewards finishing, but a close loss against three still
    // reads better than an untested win against one.
    const outcomeScore = won ? 1 : killFraction * 0.7;
    const speed = won ? band(this.s.elapsed, 90, 22) : 0;
    const survival = m.survived ? 1 : clamp(m.survivalTime / 45, 0, 0.85);

    const performance = clamp(
      outcomeScore * 0.3 +
        d.hpRetained * 0.18 +
        d.orbwalkEfficiency * 0.16 +
        survival * 0.14 +
        band(m.hitsTaken / Math.max(1, this.s.elapsed / 10), 4, 0.3) * 0.12 +
        speed * 0.1,
      0,
      1,
    );

    const helped: string[] = [];
    const hurt: string[] = [];
    if (won) helped.push(`Won the ${this.startedWith === 1 ? '1v1' : `1v${this.startedWith}`} with ${Math.round(d.hpRetained * 100)}% health left.`);
    if (d.orbwalkEfficiency > 0.7) helped.push('You kept orbwalking while under real pressure — that is the hard part.');
    if (m.nearMisses > 5) helped.push(`${m.nearMisses} near misses dodged mid-fight.`);
    if (!m.survived) hurt.push(`You died at ${m.survivalTime.toFixed(1)}s.`);
    if (d.cancelRate > 0.15) hurt.push(`${Math.round(d.cancelRate * 100)}% of your attacks were cancelled — panic movement.`);
    if (m.hazardExposure > 1.2) hurt.push(`${m.hazardExposure.toFixed(1)}s standing inside telegraphed ground.`);
    if (d.hpRetained < 0.4 && won) hurt.push('You won, but at close to full health cost.');

    const advice = !m.survived
      ? this.startedWith > 1
        ? 'Fight one angle at a time. Move so the two of them line up behind each other.'
        : 'Disengage when your attack timer is down — there is nothing to gain by standing there.'
      : d.cancelRate > 0.12
        ? 'Your movement is interrupting your own damage. Let each attack finish before repositioning.'
        : d.hpRetained > 0.75
          ? 'Comfortable. Step up to the next count or raise the difficulty.'
          : 'Solid win. Work on taking less damage in the first ten seconds.';

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: {
        combat: performance,
        kiting: clamp(d.orbwalkEfficiency, 0, 1),
        dodging: clamp(band(m.hitsTaken / Math.max(1, this.s.elapsed / 10), 4, 0.3), 0, 1),
        spacing: clamp(band(d.avgSpacingError, 260, 40), 0, 1),
        targeting: clamp(band(this.focusChanges / Math.max(1, this.startedWith), 1, 6), 0, 1),
      },
      keyMetrics: [
        pct('hpLeft', 'HEALTH REMAINING', d.hpRetained),
        secs('fightTime', won ? 'TIME TO WIN' : 'SURVIVED', won ? this.s.elapsed : m.survivalTime, won ? 'lower' : 'higher'),
        count('kills', 'ENEMIES DOWN', this.killed),
        pct('orbwalk', 'ORBWALK EFFICIENCY', d.orbwalkEfficiency),
        count('hitsTaken', 'HITS TAKEN', m.hitsTaken, 'lower'),
      ],
      helped,
      hurt,
      advice,
      // Being outnumbered is difficulty the slider cannot express, so it is
      // folded in here — this is what lets a hard-fought 1v3 outrank a
      // comfortable 1v1 at the same setting.
      effectiveDifficulty: clamp(this.s.config.difficulty + (this.startedWith - 1) * 0.13, 0, 1),
    };
  }
}
