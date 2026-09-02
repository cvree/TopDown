import type { AbilitySlot } from '../engine/input';
import { clamp, dist, norm } from '../engine/math';
import { derive } from '../engine/metrics';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { HudField } from '../engine/session';
import type { Vec2 } from '../engine/types';
import { VAYNE_STATS, wallRate } from '../engine/vayne';
import { band, count, ms, pct, type DrillOutcome } from './base';
import { VayneDrill } from './vaynebase';

/**
 * CONDEMN — the wall.
 *
 * A condemn that knocks somebody into open ground is a small inconvenience. A
 * condemn that pins them against terrain is a stun, a chunk of health and a
 * free fight. The difference is not reaction time; it is where you were
 * standing before they arrived, because the wall has to be *behind them*,
 * which means you have to be on the other side of it.
 *
 * So this drill sends divers at you from every angle and scores the geometry:
 * how many of your condemns found terrain, how many chances you let walk past,
 * and how quickly you took the ones you took. The preview line is a training
 * wheel and it is drawn deliberately — you are supposed to stop needing it.
 */
export class VayneCondemnDrill extends VayneDrill {
  private spawnCd = 1.2;
  private wanted = 2;
  /** When each enemy first came into condemn range. */
  private entered = new Map<number, number>();
  private reactions: number[] = [];
  private opportunities = 0;
  private opportunitiesTaken = 0;
  private wastedPresses = 0;
  private kills = 0;

  constructor(s: import('../engine/session').Session) {
    super(s, { tumble: true, bolts: false, condemn: true, finalHour: false });
  }

  setup(): void {
    const { w, h } = this.s.world.bounds;
    this.placeWalls();
    const p = this.spawnVayne({ x: w / 2, y: h * 0.52 });
    p.maxHp = 1500;
    p.hp = 1500;
    this.wanted = this.s.config.difficulty > 0.55 ? 3 : 2;
  }

  private spawnDiver(): void {
    const edge = this.edgePoint();
    const { w, h } = this.s.world.bounds;
    const pos = { x: clamp(edge.x, 70, w - 70), y: clamp(edge.y, 70, h - 70) };
    const a = this.spawnEnemy('diver', pos, { hpScale: 0.55 });
    a.label = 'CHARGER';
    a.moveSpeed = 210 + this.s.config.difficulty * 90;
    a.attack.damage = 26 + this.s.config.difficulty * 26;
    const brain = this.brains[this.brains.length - 1];
    if (brain) {
      brain.tune = { ...brain.tune, aggression: 0.9 };
      brain.preferredRange = 60;
    }
    this.s.fx.ring(pos.x, pos.y, 10, 120, 0.5, PALETTE.hazard, 2.5, 'shock');
  }

  update(dt: number): void {
    super.update(dt);
    this.updateBrains(dt);

    const alive = this.s.world.enemies();
    if (alive.length < this.wanted) {
      this.spawnCd -= dt;
      if (this.spawnCd <= 0) {
        this.spawnCd = 1.6 - this.s.config.difficulty * 0.6;
        this.spawnDiver();
      }
    }

    const p = this.s.world.player;
    if (!p) return;
    // An opportunity is an enemy inside condemn range while condemn is up.
    // Letting one reach melee unpunished is the thing being measured.
    for (const e of alive) {
      const inRange = dist(p.pos, e.pos) - e.radius <= VAYNE_STATS.condemnRange;
      if (inRange && this.kit.condemnCd <= 0 && !this.entered.has(e.id)) {
        this.entered.set(e.id, this.s.world.time);
        this.opportunities++;
      }
    }
    for (const [id] of this.entered) {
      const e = this.s.world.byId(id);
      if (!e || !e.alive) this.entered.delete(id);
    }
  }

  onAbility(slot: AbilitySlot, at: Vec2): void {
    if (slot !== 'e') {
      super.onAbility(slot, at);
      return;
    }
    const ready = this.kit.condemnCd <= 0;
    const before = this.kit.stats.condemnHits;
    const target = ready ? this.kit.pickCondemnTarget(at) : null;
    const enteredAt = target ? this.entered.get(target.id) : undefined;
    super.onAbility(slot, at);

    if (!ready) return;
    if (this.kit.stats.condemnHits === before) {
      // The button was up and the cast found nobody: a real input, aimed at
      // nothing. It costs no cooldown in League, so it costs none here — it
      // is simply recorded.
      this.wastedPresses++;
      this.s.micro('NO TARGET', this.s.world.player?.pos ?? at, PALETTE.textDim);
      return;
    }
    if (target) {
      this.opportunitiesTaken++;
      if (enteredAt !== undefined) this.reactions.push((this.s.world.time - enteredAt) * 1000);
      this.entered.delete(target.id);
    }
  }

  paint(out: DrillPaint, t: number): void {
    super.paint(out, t);
    this.paintSignature(out, t);
    const p = this.s.world.player;
    if (!p) return;

    out.markers.push({
      kind: 'ring',
      x: p.pos.x,
      y: p.pos.y,
      radius: VAYNE_STATS.condemnRange,
      color: this.kit.condemnCd > 0 ? PALETTE.textFaint : PALETTE.warn,
      alpha: this.kit.condemnCd > 0 ? 0.14 : 0.3,
      width: 2,
      dash: 72,
      spin: 0.1,
      rise: 1,
    });

    // Every enemy already in range gets its outcome drawn on the floor: amber
    // means terrain is waiting behind it, faint means it would land in open
    // ground. Reading that at a glance is the skill.
    if (this.kit.condemnCd <= 0) {
      for (const e of this.s.world.enemies()) {
        if (dist(p.pos, e.pos) - e.radius > VAYNE_STATS.condemnRange) continue;
        const dir = norm(e.pos.x - p.pos.x, e.pos.y - p.pos.y);
        const path = this.s.world.terrainAlong(e.pos, dir, VAYNE_STATS.condemnPush, e.radius);
        if (!path.hit) continue;
        out.markers.push({
          kind: 'ring',
          x: e.pos.x,
          y: e.pos.y,
          radius: e.radius + 18,
          color: PALETTE.warn,
          alpha: 0.45 + 0.2 * Math.sin(t * 7),
          width: 3,
          dash: 16,
          spin: -0.6,
          rise: 1.5,
        });
      }
    }
  }

  hudFields(): HudField[] {
    const st = this.kit.stats;
    const rate = wallRate(st);
    return [
      {
        label: 'CONDEMN',
        value: this.kit.condemnCd > 0 ? `${this.kit.condemnCd.toFixed(1)}s` : 'READY',
        bar: 1 - clamp(this.kit.condemnCd / VAYNE_STATS.condemnCd, 0, 1),
        tone: this.kit.condemnCd > 0 ? 'warn' : 'good',
      },
      {
        label: 'WALL STUNS',
        value: `${st.condemnWallStuns} / ${st.condemnHits}`,
        bar: rate,
        tone: rate > 0.7 ? 'good' : rate > 0.4 ? 'warn' : 'bad',
      },
      {
        label: 'CHANCES MISSED',
        value: `${Math.max(0, this.opportunities - this.opportunitiesTaken)}`,
        tone: this.opportunities - this.opportunitiesTaken > 3 ? 'bad' : 'neutral',
      },
    ];
  }

  liveScore(): number {
    const m = this.s.metrics.m;
    const st = this.kit.stats;
    return Math.max(0, Math.round(
      st.condemnWallStuns * 2600 +
        (st.condemnHits - st.condemnWallStuns) * 500 +
        this.kills * 1200 +
        m.damageDealt * 4 -
        this.wastedPresses * 250 -
        m.hpLost * 3,
    ));
  }

  onEvents(events: readonly import('../engine/world').WorldEvent[]): void {
    super.onEvents(events);
    for (const e of events) if (e.type === 'death' && e.byPlayer) this.kills++;
  }

  outcome(): DrillOutcome {
    const m = this.s.metrics.m;
    const d = derive(m, this.s.world.player?.maxHp ?? 1500);
    const st = this.kit.stats;

    const rate = wallRate(st);
    const available = Math.max(1, this.s.elapsed / VAYNE_STATS.condemnCd);
    const usage = band(st.condemnHits / available, 0.3, 0.9);
    const taken = this.opportunities > 0 ? clamp(this.opportunitiesTaken / this.opportunities, 0, 1) : 0;
    const median = this.reactions.length
      ? [...this.reactions].sort((a, b) => a - b)[Math.floor(this.reactions.length / 2)]
      : 0;
    const reaction = this.reactions.length ? band(median, 2600, 500) : 0;

    const performance = clamp(
      rate * 0.4 + usage * 0.2 + taken * 0.14 + reaction * 0.12 + d.hpRetained * 0.14,
      0,
      1,
    );

    const helped: string[] = [];
    const hurt: string[] = [];
    if (rate > 0.7 && st.condemnHits > 3) helped.push(`${st.condemnWallStuns} of ${st.condemnHits} condemns pinned somebody to terrain.`);
    if (usage > 0.75) helped.push('Condemn was almost never sitting unused.');
    if (median > 0 && median < 900) helped.push(`You took the chance in ${Math.round(median)}ms on average.`);
    if (rate < 0.45 && st.condemnHits > 2) hurt.push('Most of your condemns pushed them into open ground — nothing happened.');
    if (this.opportunities - this.opportunitiesTaken > 3) hurt.push(`${this.opportunities - this.opportunitiesTaken} chargers reached you with condemn up.`);
    if (this.wastedPresses > 2) hurt.push(`${this.wastedPresses} condemns aimed at nobody.`);

    const advice =
      rate < 0.45
        ? 'Stand so the wall is behind them, not beside you. Walk to the wall before the fight, not during it.'
        : usage < 0.5
          ? 'You are holding condemn for a perfect moment that never comes. A stun every thirteen seconds beats a perfect one every forty.'
          : rate > 0.72
            ? 'You are reading the geometry. Take it into Night Hunter, where the wall is one of three things you are tracking.'
            : 'Good instincts. Now pick your standing spot before they arrive rather than reacting to where they come from.';

    return {
      score: Math.max(0, this.liveScore()),
      performance,
      axisPerformance: {
        skillshot: performance,
        spacing: clamp(taken * 0.5 + rate * 0.5, 0, 1),
        movement: clamp(d.moveEfficiency, 0, 1),
      },
      keyMetrics: [
        pct('wallRate', 'WALL STUN RATE', rate),
        count('wallStuns', 'WALL STUNS', st.condemnWallStuns),
        ms('condemnReaction', 'REACTION', median),
        count('missed', 'CHANCES MISSED', Math.max(0, this.opportunities - this.opportunitiesTaken), 'lower'),
        pct('condemnUse', 'CONDEMN UPTIME USED', usage),
      ],
      helped,
      hurt,
      advice,
    };
  }
}
