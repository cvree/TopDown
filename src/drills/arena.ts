import { ARCHETYPES } from '../engine/archetypes';
import { clamp, dist } from '../engine/math';
import { derive } from '../engine/metrics';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { HudField } from '../engine/session';
import type { ArchetypeId, Wall } from '../engine/types';
import { FIGHT_RANKS } from '../engine/vayne';
import type { WorldEvent } from '../engine/world';
import { band, count, pct, secs, type DrillOutcome } from './base';
import { VayneDrill } from './vaynebase';

const HARD_CAP = 150;

/**
 * 1v1 / 1v2 / 1v3 — everything at once, with everything.
 *
 * No farming, no walking across a map. Enemies that move, attack, cast, dodge,
 * chase, retreat and respect their cooldowns, and the run ends the moment it is
 * decided either way.
 *
 * What you bring to it is now the whole champion, and that is a deliberate
 * reversal. The arena used to hand you your autos and a generic blink, on the
 * theory that a fight stripped of abilities is a purer test of the mechanics
 * the other drills teach. It is — and it is also a test of a game nobody
 * plays. Every fight a League player has ever been in was fought with four
 * buttons and two summoners, and the skill the arena is supposed to be the
 * final exam for is not *orbwalking*, it is orbwalking **while** spending a
 * kit: knowing which of your cooldowns answers the thing walking at you, and
 * having the hands to press it without dropping the attack rhythm underneath.
 *
 * So the duel fields Vayne at her mid-game ranks, the trinket, and Flash. The
 * floor has terrain on it for the same reason — a Condemn with nothing behind
 * the target is half an ability, and a duel with nothing to fight around is
 * half a duel.
 */
export class ArenaDrill extends VayneDrill {
  private killed = 0;
  private startedWith = 1;
  private focusChanges = 0;
  private lastFocus = -1;

  constructor(s: import('../engine/session').Session, private readonly count_: 1 | 2 | 3) {
    // The mid-game champion, exactly as Night Hunter fields her: Q maxed, a
    // point in each of W, E and R. This is the Vayne a duel is actually played
    // on, and the ranks are the mode's answer to "which Vayne is this".
    super(s, { tumble: true, bolts: true, condemn: true, finalHour: true, ranks: FIGHT_RANKS });
  }

  setup(): void {
    const { w, h } = this.s.world.bounds;
    this.placeCover();
    const player = this.spawnVayne({ x: w / 2, y: h * 0.78 });
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
    //
    // The figures went up by half when the duel started handing you the whole
    // champion, and they had to. They were chosen for a player with her autos
    // and a blink, and against a Vayne with Silver Bolts, an empowered tumble
    // and a Condemn that pins people to walls they are simply the wrong size:
    // a 1v2 that used to take forty-five seconds ended in seventeen, which is
    // not a duel, it is a burst window. What is being kept constant here is
    // the *length of the fight*, because the length is what the mode is for —
    // priority, spacing and dodging are things you do for a minute, not things
    // you do once.
    const forKit = 1.45;
    const hpScale = (this.count_ === 1 ? 1 : this.count_ === 2 ? 0.6 : 0.46) * forKit;
    picks.forEach((id, i) => {
      const spread = (i - (picks.length - 1) / 2) * 300;
      const a = this.spawnEnemy(id, { x: w / 2 + spread, y: h * 0.2 }, { hpScale });
      this.s.fx.ring(a.pos.x, a.pos.y, 10, 160, 0.7, ARCHETYPES[id].color, 3, 'shock');
    });
  }

  /**
   * Terrain, arranged around the fight rather than across it.
   *
   * Two side pillars and one island in the middle, all of them inside the
   * band of floor between the two spawn rows — so nothing ever arrives inside
   * a wall, and every one of them is reachable from either end.
   *
   * The shape is chosen so that a wall is *somewhere* rather than everywhere.
   * A ring of cover would make every Condemn a wall stun and teach nothing; a
   * bare floor makes the ability a knockback and teaches nothing either. Three
   * blocks means the good place to take a fight exists, is about a third of
   * the arena, and has to be walked to before the fight arrives — which is the
   * whole of Condemn as a positional ability.
   */
  private placeCover(): void {
    const { w, h } = this.s.world.bounds;
    const walls: Wall[] = [
      { x: w * 0.24, y: h * 0.5, w: 72, h: h * 0.3 },
      { x: w * 0.76, y: h * 0.5, w: 72, h: h * 0.3 },
      { x: w * 0.5, y: h * 0.5, w: w * 0.2, h: 72 },
    ];
    this.s.world.walls = walls;
  }

  onStart(): void {
    const names = this.s.world.enemies().map((e) => e.label ?? '').join('  ·  ');
    this.s.setBanner(names, 1.8);
  }

  update(dt: number): void {
    super.update(dt);
    this.updateBrains(dt);

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

  onEvents(events: readonly WorldEvent[]): void {
    super.onEvents(events);
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
    super.paint(out, t);
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
    const fields: HudField[] = [
      { label: 'ENEMIES', value: `${this.s.world.enemies().length}`, tone: 'neutral' },
      this.tumbleField(),
      this.boltField(),
      {
        label: 'ORBWALK',
        value: `${Math.round(d.orbwalkEfficiency * 100)}%`,
        bar: d.orbwalkEfficiency,
        tone: d.orbwalkEfficiency > 0.7 ? 'good' : 'warn',
      },
    ];
    const trigger = this.triggerField();
    if (trigger) fields.push(trigger);
    return fields;
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

    // The arena is where everything else is supposed to transfer to, so the
    // two reads the rhythm drills are built around are graded here as well.
    // Winning a 1v1 by standing still and out-statting somebody is not the
    // thing the other eight drills spent an hour teaching.
    const performance = clamp(
      outcomeScore * 0.26 +
        d.hpRetained * 0.16 +
        d.orbwalkEfficiency * 0.12 +
        d.attackTiming * 0.12 +
        d.advantageousSpacing * 0.08 +
        survival * 0.12 +
        band(m.hitsTaken / Math.max(1, this.s.elapsed / 10), 4, 0.3) * 0.08 +
        speed * 0.06,
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
    if (d.advantageousSpacing > 0.6) helped.push(`${Math.round(d.advantageousSpacing * 100)}% of the fight spent where they could not reach you.`);
    if (d.advantageousSpacing < 0.3) hurt.push('You fought most of it from inside their range. The fight was winnable from further out.');
    if (d.attackLatency > 240) hurt.push(`Your attacks went out ${Math.round(d.attackLatency)}ms late under pressure — that is a fifth of your damage.`);
    if (m.hazardExposure > 1.2) hurt.push(`${m.hazardExposure.toFixed(1)}s standing inside telegraphed ground.`);
    if (d.hpRetained < 0.4 && won) hurt.push('You won, but at close to full health cost.');
    this.handsNotes(helped, hurt);
    this.summonerNotes(helped, hurt);

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
        spacing: clamp(d.advantageousSpacing * 0.6 + band(d.avgSpacingError, 260, 40) * 0.4, 0, 1),
        targeting: clamp(band(this.focusChanges / Math.max(1, this.startedWith), 1, 6), 0, 1),
      },
      keyMetrics: [
        pct('hpLeft', 'HEALTH REMAINING', d.hpRetained),
        secs('fightTime', won ? 'TIME TO WIN' : 'SURVIVED', won ? this.s.elapsed : m.survivalTime, won ? 'lower' : 'higher'),
        count('kills', 'ENEMIES DOWN', this.killed),
        pct('orbwalk', 'ORBWALK EFFICIENCY', d.orbwalkEfficiency),
        pct('timing', 'ATTACK TIMING', d.attackTiming),
        pct('advantage', 'ADVANTAGEOUS SPACING', d.advantageousSpacing),
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
