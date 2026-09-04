import { EnemyBrain, applyTuningToActor, tuningFor, type BotBehavior } from '../engine/ai';
import { ARCHETYPES } from '../engine/archetypes';
import type { DrillPaint } from '../engine/paint';
import { DrillBase, type Session } from '../engine/session';
import type { Actor, ArchetypeId, Vec2 } from '../engine/types';
import type { KeyMetric } from '../progression/profile';
import type { SkillAxis } from '../progression/skills';

export interface DrillOutcome {
  score: number;
  /** 0..1. This is the only number the rating system consumes. */
  performance: number;
  axisPerformance: Partial<Record<SkillAxis, number>>;
  keyMetrics: KeyMetric[];
  helped: string[];
  hurt: string[];
  advice: string;
  /**
   * What the run was actually worth, if the drill is harder than its raw
   * difficulty setting implies. A 1v3 at level 40 is not a 1v1 at level 40.
   */
  effectiveDifficulty?: number;
}

/**
 * Every drill extends this. `outcome()` is what turns a run into rating, so it
 * has to be honest: it should be impossible to score well by clicking fast
 * without playing well.
 */
export abstract class Drill extends DrillBase {
  protected brains: EnemyBrain[] = [];

  abstract outcome(): DrillOutcome;

  /**
   * Drill-specific indicators. Push ground markers (drawn as real geometry on
   * the arena floor) and billboards (crisp 2D anchored to a world point) into
   * `out`; the renderer decides how each is realised.
   */
  paint(_out: DrillPaint, _t: number): void {}

  protected get session(): Session {
    return this.s;
  }

  protected spawnEnemy(
    archetype: ArchetypeId,
    pos: Vec2,
    opts: { hpScale?: number; level?: number; behavior?: BotBehavior; leash?: number; anchor?: Vec2 } = {},
  ): Actor {
    const def = ARCHETYPES[archetype];
    const level = opts.level ?? this.s.config.difficulty;
    const tune = tuningFor(level);
    const a = this.s.world.spawnActor({
      pos,
      team: 'enemy',
      maxHp: Math.round(def.baseHp * (opts.hpScale ?? 1)),
      radius: def.radius,
      moveSpeed: def.moveSpeed,
      attack: { ...def.attack },
      archetype,
      label: def.name,
    });
    applyTuningToActor(a, def, tune);
    const brain = new EnemyBrain(a, archetype, tune, this.s.rng);
    if (opts.behavior) brain.behavior = opts.behavior;
    if (opts.anchor) brain.anchor = { ...opts.anchor };
    if (opts.leash !== undefined) brain.leash = opts.leash;
    this.brains.push(brain);
    return a;
  }

  /** The brain driving the most recently spawned enemy, for further tuning. */
  protected get lastBrain(): EnemyBrain | undefined {
    return this.brains[this.brains.length - 1];
  }

  protected updateBrains(dt: number): void {
    for (const b of this.brains) b.update(this.s.world, dt);
    for (let i = this.brains.length - 1; i >= 0; i--) {
      if (!this.brains[i].actor.alive) this.brains.splice(i, 1);
    }
  }

  /** A point at least `minDist` from `from`, inside the arena margins. */
  protected randomPoint(from: Vec2 | null, minDist = 0, margin = 90): Vec2 {
    const { w, h } = this.s.world.bounds;
    for (let i = 0; i < 40; i++) {
      const p = {
        x: this.s.rng.range(margin, w - margin),
        y: this.s.rng.range(margin, h - margin),
      };
      if (!from || Math.hypot(p.x - from.x, p.y - from.y) >= minDist) return p;
    }
    return { x: w / 2, y: h / 2 };
  }

  /** A point on the arena perimeter, used for incoming waves. */
  protected edgePoint(): Vec2 {
    const { w, h } = this.s.world.bounds;
    const side = this.s.rng.int(0, 4);
    const t = this.s.rng.next();
    switch (side) {
      case 0:
        return { x: t * w, y: -40 };
      case 1:
        return { x: w + 40, y: t * h };
      case 2:
        return { x: t * w, y: h + 40 };
      default:
        return { x: -40, y: t * h };
    }
  }
}

/** Maps a raw value onto 0..1 where `good` scores 1 and `bad` scores 0. */
export const band = (value: number, bad: number, good: number): number => {
  if (good === bad) return 0;
  const t = (value - bad) / (good - bad);
  return t < 0 ? 0 : t > 1 ? 1 : t;
};

export const pct = (id: string, label: string, value: number): KeyMetric => ({
  id,
  label,
  value,
  format: 'pct',
  direction: 'higher',
});

export const ms = (id: string, label: string, value: number): KeyMetric => ({
  id,
  label,
  value,
  format: 'ms',
  direction: 'lower',
});

export const count = (id: string, label: string, value: number, direction: 'higher' | 'lower' = 'higher'): KeyMetric => ({
  id,
  label,
  value,
  format: 'int',
  direction,
});

export const units = (id: string, label: string, value: number): KeyMetric => ({
  id,
  label,
  value,
  format: 'units',
  direction: 'lower',
});

export const secs = (id: string, label: string, value: number, direction: 'higher' | 'lower' = 'higher'): KeyMetric => ({
  id,
  label,
  value,
  format: 'sec',
  direction,
});
