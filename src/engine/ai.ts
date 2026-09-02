import { ARCHETYPES } from './archetypes';
import { angleDelta, clamp, dist, norm, v2 } from './math';
import type { Rng } from './rng';
import type { Actor, AiTuning, ArchetypeDef, ArchetypeId, Vec2 } from './types';
import { World } from './world';

/**
 * Difficulty is expressed entirely through behaviour. A "harder" Ranger is not
 * a Ranger with more health — it reacts sooner, leads your movement better,
 * misses by less, holds its spacing tighter and uses its ability more often.
 */
export const TUNING_FLOOR: AiTuning = {
  reactionDelay: 0.46,
  aimError: 175,
  prediction: 0.1,
  dodgeSkill: 0.05,
  spacingDiscipline: 0.32,
  aggression: 0.5,
  tempo: 0.82,
};

export const TUNING_CEILING: AiTuning = {
  reactionDelay: 0.075,
  aimError: 14,
  prediction: 0.95,
  dodgeSkill: 0.75,
  spacingDiscipline: 1.0,
  aggression: 1.7,
  tempo: 1.3,
};

/** `level` runs 0..1 and interpolates every behavioural knob. */
export const tuningFor = (level: number): AiTuning => {
  const t = clamp(level, 0, 1);
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    reactionDelay: mix(TUNING_FLOOR.reactionDelay, TUNING_CEILING.reactionDelay),
    aimError: mix(TUNING_FLOOR.aimError, TUNING_CEILING.aimError),
    prediction: mix(TUNING_FLOOR.prediction, TUNING_CEILING.prediction),
    dodgeSkill: mix(TUNING_FLOOR.dodgeSkill, TUNING_CEILING.dodgeSkill),
    spacingDiscipline: mix(TUNING_FLOOR.spacingDiscipline, TUNING_CEILING.spacingDiscipline),
    aggression: mix(TUNING_FLOOR.aggression, TUNING_CEILING.aggression),
    tempo: mix(TUNING_FLOOR.tempo, TUNING_CEILING.tempo),
  };
};

interface Snapshot {
  t: number;
  pos: Vec2;
  vel: Vec2;
}

export class EnemyBrain {
  readonly actor: Actor;
  readonly def: ArchetypeDef;
  tune: AiTuning;
  /** Distance this unit tries to hold. Drills may override it. */
  preferredRange: number;

  private history: Snapshot[] = [];
  private abilityCd: number;
  private repathCd = 0;
  private strafeDir = 1;
  private strafeCd = 0;
  private dashTime = 0;
  private dashVel = v2();
  private dodgeCd = 0;
  private rng: Rng;

  constructor(actor: Actor, archetype: ArchetypeId, tune: AiTuning, rng: Rng) {
    this.actor = actor;
    this.def = ARCHETYPES[archetype];
    this.tune = tune;
    this.preferredRange = this.def.preferredRange;
    this.rng = rng;
    // Stagger the first ability so a 1v3 does not open with three ults at once.
    this.abilityCd = this.def.abilityCd * rng.range(0.35, 0.9);
    this.strafeDir = rng.chance(0.5) ? 1 : -1;
  }

  /** Position of the player as this AI currently believes it to be. */
  private perceived(world: World): Snapshot | null {
    const target = world.time - this.tune.reactionDelay;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].t <= target) return this.history[i];
    }
    return this.history[0] ?? null;
  }

  update(world: World, dt: number): void {
    const me = this.actor;
    if (!me.alive) return;
    const player = world.player;
    if (!player || !player.alive) {
      me.order = null;
      me.targetId = null;
      return;
    }

    this.history.push({ t: world.time, pos: { ...player.pos }, vel: { ...player.vel } });
    if (this.history.length > 240) this.history.shift();

    // A unit being shoved through the air, or stunned against a wall, is not
    // making decisions. Condemn is supposed to buy Vayne real time.
    if (me.knockback || me.rootedFor > 0) {
      me.order = null;
      this.dashTime = 0;
      if (this.abilityCd > 0) this.abilityCd -= dt;
      return;
    }

    if (this.abilityCd > 0) this.abilityCd -= dt;
    if (this.repathCd > 0) this.repathCd -= dt;
    if (this.strafeCd > 0) this.strafeCd -= dt;
    if (this.dodgeCd > 0) this.dodgeCd -= dt;

    // Dash movement overrides normal steering while it lasts.
    if (this.dashTime > 0) {
      this.dashTime -= dt;
      me.pos.x = clamp(me.pos.x + this.dashVel.x * dt, me.radius, world.bounds.w - me.radius);
      me.pos.y = clamp(me.pos.y + this.dashVel.y * dt, me.radius, world.bounds.h - me.radius);
      me.order = null;
      return;
    }

    const seen = this.perceived(world);
    if (!seen) return;

    // Lead the target by however much prediction this difficulty grants.
    const lead = this.tune.prediction * this.tune.reactionDelay;
    const believed: Vec2 = {
      x: seen.pos.x + seen.vel.x * lead,
      y: seen.pos.y + seen.vel.y * lead,
    };

    me.targetId = player.id;

    const d = dist(me.pos, player.pos);
    const pref = this.preferredRange;
    // Spacing discipline tightens the deadzone the AI is happy to sit in.
    const slack = 130 * (1.3 - this.tune.spacingDiscipline);
    const aggr = this.def.aggression * this.tune.aggression;

    // Dodge an inbound player projectile by stepping perpendicular to it.
    if (this.dodgeCd <= 0 && this.tryDodge(world, me)) {
      this.dodgeCd = 0.55;
      return;
    }

    // Signature ability.
    if (this.abilityCd <= 0 && d < this.def.attack.range * 1.9) {
      this.castAbility(world, me, player, believed);
      this.abilityCd = this.def.abilityCd / Math.max(0.4, this.tune.aggression);
      return;
    }

    const inRange = d - player.radius <= me.attack.range;

    // The AI orbwalks too: it holds still to attack, then repositions in the
    // backswing window, which is exactly the rhythm the player is learning.
    const freeToMove = me.phase !== 'windup';

    if (!freeToMove) return;

    let goal: Vec2 | null = null;

    if (d > pref + slack) {
      // Too far — approach, biased toward the believed position.
      const dir = norm(believed.x - me.pos.x, believed.y - me.pos.y);
      goal = { x: me.pos.x + dir.x * 400, y: me.pos.y + dir.y * 400 };
    } else if (d < pref - slack && aggr < 0.85) {
      // Too close for a ranged archetype — back off.
      const dir = norm(me.pos.x - believed.x, me.pos.y - believed.y);
      goal = { x: me.pos.x + dir.x * 320, y: me.pos.y + dir.y * 320 };
    } else if (inRange && me.attackCd > 0.02) {
      // In range and waiting on the attack timer: strafe rather than stand.
      if (this.strafeCd <= 0) {
        this.strafeCd = this.rng.range(0.6, 1.4);
        if (this.rng.chance(0.3)) this.strafeDir *= -1;
      }
      const a = Math.atan2(believed.y - me.pos.y, believed.x - me.pos.x) + (Math.PI / 2) * this.strafeDir;
      const amount = 180 * this.tune.spacingDiscipline;
      goal = { x: me.pos.x + Math.cos(a) * amount, y: me.pos.y + Math.sin(a) * amount };
    }

    if (goal && this.repathCd <= 0) {
      this.repathCd = 0.08;
      goal.x = clamp(goal.x, me.radius + 10, world.bounds.w - me.radius - 10);
      goal.y = clamp(goal.y, me.radius + 10, world.bounds.h - me.radius - 10);
      me.order = { kind: 'attackMove', pos: goal };
    } else if (!goal) {
      me.order = { kind: 'attackTarget', pos: { ...player.pos }, targetId: player.id };
    }
  }

  /** Steps out of the path of a player projectile if this difficulty allows. */
  private tryDodge(world: World, me: Actor): boolean {
    if (!this.rng.chance(this.tune.dodgeSkill)) return false;
    for (const p of world.projectiles) {
      if (p.team !== 'player' || p.targetId != null) continue;
      const toMe = { x: me.pos.x - p.pos.x, y: me.pos.y - p.pos.y };
      const d = Math.hypot(toMe.x, toMe.y);
      if (d > 420 || d < 40) continue;
      const travel = Math.atan2(p.vel.y, p.vel.x);
      const bearing = Math.atan2(toMe.y, toMe.x);
      if (Math.abs(angleDelta(travel, bearing)) > 0.45) continue;
      const side = angleDelta(travel, bearing) > 0 ? 1 : -1;
      const a = travel + (Math.PI / 2) * side;
      me.order = {
        kind: 'move',
        pos: {
          x: clamp(me.pos.x + Math.cos(a) * 260, me.radius, world.bounds.w - me.radius),
          y: clamp(me.pos.y + Math.sin(a) * 260, me.radius, world.bounds.h - me.radius),
        },
      };
      return true;
    }
    return false;
  }

  private aimAt(target: Vec2, from: Vec2): Vec2 {
    // Aim error scales with distance so far shots are the sloppy ones.
    const d = Math.hypot(target.x - from.x, target.y - from.y);
    const spread = (this.tune.aimError * d) / 600;
    return {
      x: target.x + this.rng.gauss() * spread * 0.5,
      y: target.y + this.rng.gauss() * spread * 0.5,
    };
  }

  private castAbility(world: World, me: Actor, player: Actor, believed: Vec2): void {
    const aim = this.aimAt(believed, me.pos);
    const dir = norm(aim.x - me.pos.x, aim.y - me.pos.y);
    const col = this.def.color;

    switch (this.def.id) {
      case 'ranger': {
        // A long piercing bolt. Punishes standing in a straight line.
        world.spawnProjectile({
          pos: { ...me.pos },
          team: 'enemy',
          ownerId: me.id,
          vel: { x: dir.x * 1350, y: dir.y * 1350 },
          speed: 1350,
          damage: 55,
          radius: 17,
          pierce: true,
          shape: 'shard',
          maxLife: 1.5,
          color: col,
        });
        break;
      }
      case 'diver': {
        // Commits to a straight dash. Sidestepping it is the whole lesson.
        const d = dist(me.pos, player.pos);
        const speed = 1500;
        this.dashVel = { x: dir.x * speed, y: dir.y * speed };
        this.dashTime = clamp(d / speed, 0.08, 0.45);
        // The dash gets a real telegraph — it is meant to be sidestepped, not
        // to feel like an ambush.
        world.spawnHazard({
          pos: { ...me.pos },
          end: { x: me.pos.x + dir.x * 700, y: me.pos.y + dir.y * 700 },
          team: 'enemy',
          shape: 'line',
          width: 44,
          warn: 0.3,
          active: 0.22,
          damage: 32,
          color: col,
        });
        break;
      }
      case 'artillery': {
        world.spawnHazard({
          pos: aim,
          team: 'enemy',
          shape: 'circle',
          radius: 132,
          warn: clamp(1.15 - this.tune.aggression * 0.35, 0.55, 1.2),
          active: 0.3,
          damage: 85,
          color: col,
        });
        break;
      }
      case 'controller': {
        world.spawnProjectile({
          pos: { ...me.pos },
          team: 'enemy',
          ownerId: me.id,
          vel: { x: dir.x * 1150, y: dir.y * 1150 },
          speed: 1150,
          damage: 30,
          radius: 19,
          shape: 'orb',
          maxLife: 1.3,
          effect: { root: 0.75 },
          color: col,
        });
        break;
      }
      case 'duelist': {
        // Dashes past you, then immediately threatens. Trains target switching.
        const speed = 1700;
        this.dashVel = { x: dir.x * speed, y: dir.y * speed };
        this.dashTime = 0.2;
        me.attackCd = Math.min(me.attackCd, 0.1);
        break;
      }
      case 'juggernaut': {
        world.spawnHazard({
          pos: { ...me.pos },
          team: 'enemy',
          shape: 'ring',
          radius: 265,
          width: 150,
          warn: 0.8,
          active: 0.3,
          damage: 70,
          color: col,
        });
        break;
      }
    }
  }
}

export const applyTuningToActor = (a: Actor, def: ArchetypeDef, tune: AiTuning): void => {
  a.attack = { ...def.attack, attackSpeed: def.attack.attackSpeed * tune.tempo };
  a.moveSpeed = def.moveSpeed * (0.94 + tune.tempo * 0.08);
};
