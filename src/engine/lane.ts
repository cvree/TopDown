/**
 * A lane.
 *
 * Last hitting is not a reaction test with a health bar attached — it is a
 * negotiation with a fight you are standing next to. Six minions per side walk
 * into each other, pick targets by a published set of rules, and grind each
 * other down; two turrets shoot whatever crosses them; an enemy laner takes
 * the same farm you are trying to take. Every point of damage in this file is
 * thrown by a body you can see, at a target it has chosen for a reason you can
 * name, after a windup you can watch. Nothing ticks invisibly.
 *
 * That constraint is the whole design. If health bars simply drained, the only
 * skill available would be "click when the bar is short". Because the damage
 * comes from somewhere, the real skills appear on their own: reading which
 * minion three casters are focusing, knowing a turret shot is mid-flight,
 * noticing that autoing the enemy champion just turned six minions around to
 * face you.
 *
 * The numbers are League's, scaled to this trainer's champion. The one that
 * matters most: a caster minion dies to one turret shot plus one of your
 * attacks, and a melee minion to two turret shots plus one of yours. Those two
 * facts are the whole of under-tower farming, and they are exact here.
 */
import { dist } from './math';
import type { Rng } from './rng';
import type { Actor, AttackProfile, Vec2 } from './types';
import type { World } from './world';

export type MinionRole = 'melee' | 'caster' | 'cannon';

export interface MinionStats {
  hp: number;
  radius: number;
  moveSpeed: number;
  gold: number;
  attack: AttackProfile;
}

/**
 * Minion stat lines.
 *
 * Read the health totals against the player's 68 damage and the turret's 105
 * and the whole lesson plan falls out: a caster is a one-shot last hit off a
 * turret shot, a melee is two turret shots then yours, and a cannon is a
 * five-shot proposition worth three ordinary minions.
 */
export const MINION_STATS: Record<MinionRole, MinionStats> = {
  melee: {
    hp: 240,
    radius: 26,
    moveSpeed: 235,
    gold: 21,
    attack: {
      attackSpeed: 1.05,
      windupRatio: 0.28,
      backswingRatio: 0.3,
      range: 45,
      damage: 8,
      projectileSpeed: 0,
    },
  },
  caster: {
    hp: 150,
    radius: 24,
    moveSpeed: 235,
    gold: 14,
    attack: {
      attackSpeed: 0.85,
      windupRatio: 0.34,
      backswingRatio: 0.28,
      range: 300,
      damage: 13,
      projectileSpeed: 900,
      projectileShape: 'orb',
      projectileRadius: 9,
    },
  },
  cannon: {
    hp: 460,
    radius: 33,
    moveSpeed: 220,
    gold: 60,
    attack: {
      attackSpeed: 0.62,
      windupRatio: 0.4,
      backswingRatio: 0.3,
      range: 340,
      damage: 22,
      projectileSpeed: 760,
      projectileShape: 'wave',
      projectileRadius: 14,
    },
  },
};

const TURRET_ATTACK: AttackProfile = {
  attackSpeed: 0.85,
  windupRatio: 0.42,
  backswingRatio: 0.2,
  range: 720,
  damage: 105,
  projectileSpeed: 1450,
  projectileShape: 'shard',
  projectileRadius: 17,
};

/** How far a minion looks for something to hit, and how far it will follow. */
const ACQUIRE = 470;
const LEASH = 690;
/** A unit counts as "currently attacking" its target for this long after a swing. */
const AGGRO_MEMORY = 2.5;

/**
 * How much damage is already on its way to `target` and will land within
 * `within` seconds.
 *
 * This is the number a good last-hitter holds in their head: not the health
 * the bar shows, but the health it will show once everything already thrown
 * has arrived. Missiles in the air count, and so do windups past the point of
 * recall — an attacker mid-windup has committed, and pretending otherwise is
 * how you lose a minion by half a second.
 */
export interface PendingHit {
  /** Seconds from now until it lands. */
  at: number;
  damage: number;
  ownerId: number;
}

/**
 * Every hit already committed to `target`: missiles in the air, and windups
 * past the point of recall.
 *
 * Collected in one pass and written into a caller-owned array, because the
 * drill asks this question of every minion on screen every frame and a fresh
 * array per minion per frame is a garbage-collection pause waiting to land in
 * the middle of somebody's reaction time.
 */
export const pendingHits = (world: World, target: Actor, out: PendingHit[]): PendingHit[] => {
  out.length = 0;
  for (const p of world.projectiles) {
    if (p.targetId !== target.id || p.team === target.team) continue;
    out.push({ at: dist(p.pos, target.pos) / Math.max(1, p.speed), damage: p.damage, ownerId: p.ownerId });
  }
  for (const a of world.actors) {
    if (!a.alive || a.phase !== 'windup' || a.targetId !== target.id || a.team === target.team) continue;
    const travel = a.attack.projectileSpeed > 0 ? dist(a.pos, target.pos) / a.attack.projectileSpeed : 0;
    out.push({ at: a.phaseTime + travel, damage: a.attack.damage, ownerId: a.id });
  }
  return out;
};

/**
 * How much of that will land within `within` seconds.
 *
 * `exclude` drops one attacker's contribution, `only` keeps just that one:
 * "what will the rest of the lane do to this minion" and "have I already
 * committed to it" are different questions with different answers.
 */
export const incomingDamage = (
  world: World,
  target: Actor,
  within: number,
  from: { exclude?: number; only?: number } = {},
): number => sumPending(pendingHits(world, target, []), within, from);

export const sumPending = (
  hits: readonly PendingHit[],
  within: number,
  from: { exclude?: number; only?: number } = {},
): number => {
  let total = 0;
  for (const h of hits) {
    if (h.at > within) continue;
    if (from.only !== undefined ? h.ownerId !== from.only : h.ownerId === from.exclude) continue;
    total += h.damage;
  }
  return total;
};

/** True when `a` is presently swinging at `id`. */
const isAttacking = (world: World, a: Actor, id: number): boolean =>
  a.targetId === id && world.time - a.lastAttackAt < AGGRO_MEMORY;

/**
 * League's minion targeting priority, in order.
 *
 * The list is worth knowing by heart, because two of its rows are things
 * players lose games to. Row 0 is why autoing the enemy laner with the wave on
 * top of you turns six minions around; row 3 is why a wave that has nothing
 * else to shoot at eventually walks over and shoots you.
 */
const priorityOf = (world: World, me: Actor, c: Actor): number => {
  // Read the candidate's own order rather than scanning our whole team for
  // victims: a unit is attacking exactly one thing, so the question "is it
  // hitting one of ours" is a single lookup, and this runs for every candidate
  // of every minion several times a second.
  const victim = world.time - c.lastAttackAt < AGGRO_MEMORY ? world.byId(c.targetId) : undefined;
  const hitsOurs = !!victim && victim.team === me.team;
  const hitsChampion = hitsOurs && victim.unitKind === 'champion';
  const hitsMinion = hitsOurs && !!victim.isMinion;
  if (c.unitKind === 'champion' && hitsChampion) return 0;
  if (c.isMinion && hitsChampion) return 1;
  if (c.isMinion && hitsMinion) return 2;
  if (c.isMinion) return 3;
  if (c.unitKind === 'champion') return 4;
  if (c.unitKind === 'turret') return 5;
  return 6;
};

/**
 * One minion's head.
 *
 * A minion has exactly two states — walking to the far end of the lane, and
 * hitting the highest-priority thing near it — and it is sticky about the
 * second, because League minions are. Stickiness is what makes a lane legible:
 * a minion that re-picked its target every frame would spread damage evenly
 * and nothing would ever be about to die.
 */
export class MinionBrain {
  private retargetCd = 0;

  constructor(readonly actor: Actor, private readonly goal: Vec2) {}

  update(world: World, dt: number): void {
    const me = this.actor;
    if (!me.alive) return;
    this.retargetCd -= dt;

    const cur = world.byId(me.targetId);
    const held = cur && cur.alive && cur.team !== me.team && dist(me.pos, cur.pos) < LEASH ? cur : null;

    if (this.retargetCd <= 0) {
      this.retargetCd = 0.2;
      const next = this.pick(world, held);
      me.targetId = next ? next.id : null;
    } else if (!held) {
      me.targetId = null;
    }

    const target = world.byId(me.targetId);
    if (target && target.alive) {
      // Never re-order during a windup: the order object is what the world
      // walks on, and rewriting it mid-swing is a cancel by another name.
      if (me.order?.kind !== 'attackTarget' || me.order.targetId !== target.id) {
        me.order = { kind: 'attackTarget', pos: { ...me.pos }, targetId: target.id };
      }
    } else {
      me.order = { kind: 'attackMove', pos: { ...this.goal } };
    }
  }

  /**
   * A held target is only dropped for something strictly more urgent — which
   * in practice means the taunt rows, so a champion who opens on the enemy
   * laner gets the wave and a champion who does not, does not.
   */
  private pick(world: World, held: Actor | null): Actor | null {
    let best: Actor | null = held;
    let bestTier = held ? priorityOf(world, this.actor, held) : 99;
    let bestD = held ? dist(this.actor.pos, held.pos) : Infinity;
    for (const c of world.actors) {
      if (!c.alive || c.team === this.actor.team) continue;
      if ((c.invisibleFor ?? 0) > 0) continue;
      const d = dist(this.actor.pos, c.pos) - c.radius;
      if (d > ACQUIRE) continue;
      const tier = priorityOf(world, this.actor, c);
      if (tier < bestTier || (tier === bestTier && !held && d < bestD)) {
        best = c;
        bestTier = tier;
        bestD = d;
      }
    }
    return best;
  }
}

/**
 * A turret.
 *
 * Turrets are the most honest damage in the game: one target at a time, a long
 * visible windup, and a rule for switching that never surprises you. It holds
 * whatever it is shooting until that thing dies or walks out, and it drops
 * everything to punish a champion who starts on a champion inside its reach.
 * Learning to farm alongside that clock is the skill; being told the clock
 * exists is not enough, so it is on screen and it is loud.
 */
export class TurretBrain {
  /** Consecutive shots on the current champion target, for the damage ramp. */
  private streak = 0;

  constructor(readonly actor: Actor) {}

  update(world: World, dt: number): void {
    void dt;
    const me = this.actor;
    if (!me.alive) return;
    const inRange = (a: Actor): boolean => dist(me.pos, a.pos) - a.radius <= me.attack.range;

    // The dive punish: a champion attacking one of ours inside the turret's
    // reach takes the turret, immediately, whatever it was doing.
    const diver = world.actors.find(
      (a) =>
        a.alive &&
        a.team !== me.team &&
        a.unitKind === 'champion' &&
        inRange(a) &&
        world.actors.some((f) => f.alive && f.team === me.team && f.unitKind === 'champion' && isAttacking(world, a, f.id)),
    );

    const cur = world.byId(me.targetId);
    let target: Actor | null = cur && cur.alive && cur.team !== me.team && inRange(cur) ? cur : null;
    if (diver && (!target || target.unitKind !== 'champion')) target = diver;
    if (!target) {
      let bestD = Infinity;
      for (const c of world.actors) {
        if (!c.alive || c.team === me.team || c.unitKind === 'turret') continue;
        if (!inRange(c)) continue;
        // Minions before champions, then whichever is deepest into the reach.
        const d = dist(me.pos, c.pos) + (c.unitKind === 'champion' ? 4000 : 0);
        if (d < bestD) {
          bestD = d;
          target = c;
        }
      }
    }

    if (target?.id !== me.targetId) this.streak = 0;
    me.targetId = target ? target.id : null;
    // The champion ramp: the third shot hurts far more than the first, which
    // is exactly why a dive has a shot clock.
    me.attack.damage = target?.unitKind === 'champion' ? 110 + this.streak * 45 : TURRET_ATTACK.damage;
  }

  onShot(): void {
    this.streak = Math.min(3, this.streak + 1);
  }
}

export interface LaneOptions {
  bounds: { w: number; h: number };
  /** 0..1. Drives wave tempo and the rival's competence, never anyone's health. */
  difficulty: number;
}

export interface LaneEvent {
  kind: 'wave' | 'cannon';
  wave: number;
}

/**
 * The lane itself: geometry, wave clock, and everyone in it.
 */
export class Lane {
  readonly laneY: number;
  readonly allyGate: Vec2;
  readonly enemyGate: Vec2;
  readonly allyTurret: Actor;
  readonly enemyTurret: Actor;
  rival: Actor | null = null;

  /** Living minions on both sides, freshest wave last. */
  minions: Actor[] = [];
  waveIndex = 0;
  waveCd: number;
  readonly waveInterval: number;
  events: LaneEvent[] = [];

  private brains: MinionBrain[] = [];
  private turrets: TurretBrain[] = [];

  constructor(
    private readonly world: World,
    private readonly rng: Rng,
    private readonly opts: LaneOptions,
  ) {
    const { w, h } = opts.bounds;
    this.laneY = h * 0.5;
    // Lane geometry is the balance, so it is derived rather than guessed.
    // Waves meet in the middle; each turret's reach has to stop short of that
    // meeting point by a clear margin, or farming the wave you were given is
    // already a tower dive. Chasing a pushed wave crosses the line — which is
    // exactly the decision the drill wants you making on purpose.
    const turretX = w * 0.075;
    this.allyTurret = this.spawnTurret('player', { x: turretX, y: this.laneY });
    this.enemyTurret = this.spawnTurret('enemy', { x: w - turretX, y: this.laneY });
    // Minions form up in front of their own turret, so a spawning wave never
    // has to be shoved out of the structure it just walked past.
    this.allyGate = { x: turretX + 112, y: this.laneY };
    this.enemyGate = { x: w - turretX - 112, y: this.laneY };
    this.turrets.push(new TurretBrain(this.allyTurret), new TurretBrain(this.enemyTurret));
    // Waves come faster than League's thirty seconds because a drill is ninety
    // seconds long, not thirty minutes. Everything else about them is honest.
    this.waveInterval = 15.5 - opts.difficulty * 3;
    this.waveCd = 0;
  }

  /** The enemy laner, if this difficulty has earned one. */
  spawnRival(pos: Vec2): Actor {
    const a = this.world.spawnActor({
      pos,
      team: 'enemy',
      maxHp: 1450,
      radius: 28,
      moveSpeed: 340,
      unitKind: 'champion',
      archetype: 'ranger',
      label: 'RIVAL',
      attack: {
        attackSpeed: 0.74,
        windupRatio: 0.28,
        backswingRatio: 0.3,
        range: 545,
        damage: 62,
        projectileSpeed: 1700,
        projectileColor: '#ff9a6a',
      },
    });
    this.rival = a;
    return a;
  }

  private spawnTurret(team: 'player' | 'enemy', pos: Vec2): Actor {
    return this.world.spawnActor({
      pos,
      team,
      maxHp: 24000,
      radius: 46,
      moveSpeed: 0,
      unitKind: 'turret',
      immovable: true,
      label: team === 'player' ? 'YOUR TURRET' : 'ENEMY TURRET',
      attack: {
        ...TURRET_ATTACK,
        projectileColor: team === 'player' ? '#8fe9ff' : '#ffbb66',
      },
    });
  }

  /** Composition follows League: three melee, three casters, a cannon every third. */
  private composition(wave: number): MinionRole[] {
    const roles: MinionRole[] = ['melee', 'melee', 'melee', 'caster', 'caster', 'caster'];
    if (wave % 3 === 0) roles.splice(3, 0, 'cannon');
    return roles;
  }

  private spawnWave(): void {
    this.waveIndex++;
    const roles = this.composition(this.waveIndex);
    const cannon = roles.includes('cannon');
    for (const team of ['player', 'enemy'] as const) {
      const gate = team === 'player' ? this.allyGate : this.enemyGate;
      const goal = team === 'player' ? this.enemyGate : this.allyGate;
      const dir = team === 'player' ? 1 : -1;
      roles.forEach((role, i) => {
        const s = MINION_STATS[role];
        // Melee lead, casters and the cannon trail: the column marches out of
        // the base in the order it will meet the other one.
        const rank = roles.length - 1 - i;
        const file = i % 2 === 0 ? -1 : 1;
        const m = this.world.spawnActor({
          pos: {
            x: gate.x + dir * rank * 40,
            y: this.laneY + file * (role === 'cannon' ? 0 : 44) + this.rng.range(-8, 8),
          },
          team,
          maxHp: s.hp,
          radius: s.radius,
          moveSpeed: s.moveSpeed,
          isMinion: true,
          unitKind: role,
          goldValue: s.gold,
          label: role.toUpperCase(),
          attack: {
            ...s.attack,
            projectileColor: team === 'player' ? '#9fdcff' : '#ff9d76',
          },
        });
        this.minions.push(m);
        this.brains.push(new MinionBrain(m, goal));
      });
    }
    this.events.push({ kind: cannon ? 'cannon' : 'wave', wave: this.waveIndex });
    this.waveCd = this.waveInterval;
  }

  update(dt: number): void {
    this.waveCd -= dt;
    if (this.waveCd <= 0) this.spawnWave();

    for (const b of this.brains) b.update(this.world, dt);
    for (const t of this.turrets) t.update(this.world, dt);

    for (let i = this.brains.length - 1; i >= 0; i--) if (!this.brains[i].actor.alive) this.brains.splice(i, 1);
    for (let i = this.minions.length - 1; i >= 0; i--) if (!this.minions[i].alive) this.minions.splice(i, 1);
  }

  /** Tell the turrets a shot went out, so the champion damage ramp advances. */
  noteTurretShot(actorId: number): void {
    for (const t of this.turrets) if (t.actor.id === actorId) t.onShot();
  }

  enemyMinions(): Actor[] {
    return this.minions.filter((m) => m.alive && m.team === 'enemy');
  }

  allyMinions(): Actor[] {
    return this.minions.filter((m) => m.alive && m.team === 'player');
  }

  /**
   * Where the fight is: the mean x of everything alive in the lane, which is
   * the number that tells you whether you are farming safely or standing in
   * the enemy's half wondering why a turret is looking at you.
   */
  frontX(): number {
    let sum = 0;
    let n = 0;
    for (const m of this.minions) {
      if (!m.alive) continue;
      sum += m.pos.x;
      n++;
    }
    return n ? sum / n : this.opts.bounds.w / 2;
  }

  drainEvents(): LaneEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

/**
 * The enemy laner.
 *
 * Not a duelist and not a target dummy: someone standing across from you doing
 * the same job. It is here because farming against nobody is a metronome, and
 * farming against someone who takes the minion you were waiting for is a
 * competition — which is the actual feeling of a lane, and the reason the
 * skill is worth building.
 *
 * Its difficulty is entirely reaction time and discipline. A weak rival sees a
 * killable minion late and swings at healthy ones out of boredom, which pushes
 * the wave and hands you free farm. A strong one is on the minion the instant
 * it enters the window and only ever throws an attack at you when the trade is
 * free. Neither of them has extra damage or extra health.
 */
export class RivalBrain {
  /** Seconds before it notices a minion has entered its kill window. */
  private readonly reaction: number;
  /** Chance per attack cycle that it throws one away at a healthy minion. */
  private readonly greed: number;
  /** Chance per attack cycle that it takes a free poke at you. */
  private readonly harass: number;
  private noticed = new Map<number, number>();
  private decisionCd = 0;
  private repositionCd = 0;
  /**
   * One roll per attack cycle, not one per decision tick.
   *
   * Without the latch a 12Hz decision loop turns a 20% chance into a
   * certainty, and the rival becomes a machine that attacks constantly at
   * every difficulty. The temptation to waste an attack should arrive once
   * per attack, which is how often a person gets to make that mistake.
   */
  private armed = false;
  private wantsGreed = false;
  private wantsHarass = false;

  constructor(
    readonly actor: Actor,
    private readonly lane: Lane,
    private readonly rng: Rng,
    difficulty: number,
  ) {
    this.reaction = 0.44 - difficulty * 0.36;
    this.greed = 0.55 - difficulty * 0.45;
    this.harass = 0.06 + difficulty * 0.3;
  }

  update(world: World, dt: number): void {
    const me = this.actor;
    if (!me.alive) return;
    this.decisionCd -= dt;
    this.repositionCd -= dt;

    const player = world.player;
    const targets = this.lane.allyMinions();

    // Notice-time bookkeeping: a minion only becomes "available" to this AI
    // once it has been inside the kill window for `reaction` seconds. That is
    // the entire difference between a bronze rival and a challenger one.
    for (const m of targets) {
      const killable = m.hp <= me.attack.damage;
      if (killable && !this.noticed.has(m.id)) this.noticed.set(m.id, world.time);
      if (!killable) this.noticed.delete(m.id);
    }
    for (const id of [...this.noticed.keys()]) if (!world.byId(id)?.alive) this.noticed.delete(id);

    const ready = me.attackCd <= 0.001 && me.phase !== 'windup';
    if (!ready) this.armed = false;
    else if (!this.armed) {
      this.armed = true;
      this.wantsGreed = this.rng.next() < this.greed;
      this.wantsHarass = this.rng.next() < this.harass;
    }

    if (this.decisionCd > 0) return;
    this.decisionCd = 0.08;

    const reach = (a: Actor): number => dist(me.pos, a.pos) - a.radius;

    // 1. Take the last hit, if it has seen one long enough.
    let cs: Actor | null = null;
    for (const m of targets) {
      if (reach(m) > me.attack.range) continue;
      const at = this.noticed.get(m.id);
      if (at === undefined || world.time - at < this.reaction) continue;
      if (!cs || m.hp < cs.hp) cs = m;
    }
    if (cs && ready) {
      world.issueAttackTarget(me, cs.id);
      this.armed = false;
      return;
    }

    // 2. Poke, but only when it is actually free: never with the wave on it,
    //    never inside the turret that would answer, never while hurt.
    if (ready && this.wantsHarass && player && player.alive && reach(player) <= me.attack.range) {
      const underTurret = dist(player.pos, this.lane.allyTurret.pos) < this.lane.allyTurret.attack.range - 40;
      const beingHit = world.actors.some(
        (a) => a.alive && a.team === 'player' && a.isMinion && isAttacking(world, a, me.id),
      );
      if (!underTurret && !beingHit && me.hp > me.maxHp * 0.45) {
        world.issueAttackTarget(me, player.id);
        this.wantsHarass = false;
        this.armed = false;
        return;
      }
    }

    // 3. Waste an attack on a healthy minion — the exact bad habit this drill
    //    is grading you on, performed by someone else so you can watch it.
    if (ready && this.wantsGreed) {
      const near = targets.filter((m) => reach(m) <= me.attack.range);
      if (near.length) {
        world.issueAttackTarget(me, near[this.rng.int(0, near.length)].id);
        this.wantsGreed = false;
        this.armed = false;
        return;
      }
    }

    // 4. Otherwise hold a sane lane position: behind its own wave, out of
    //    your turret, and not close enough to be traded on for free.
    //
    //    A target is only dropped while genuinely idle. Clearing it mid-swing
    //    would delete the attack in flight — the AI's version of clicking to
    //    move during your own windup, and just as invisible when it happens.
    if (me.phase === 'idle') me.targetId = null;
    if (this.repositionCd > 0) return;
    this.repositionCd = 0.32;
    const front = this.lane.frontX();
    const hurt = me.hp < me.maxHp * 0.35;
    let goalX = front + (hurt ? 340 : 150);
    const safeX = this.lane.allyTurret.pos.x + this.lane.allyTurret.attack.range + 90;
    goalX = Math.max(goalX, safeX);
    goalX = Math.min(goalX, this.lane.enemyGate.x + 120);
    const goalY = this.lane.laneY + (player ? Math.sign(me.pos.y - player.pos.y) * 90 : 0);
    if (Math.hypot(goalX - me.pos.x, goalY - me.pos.y) > 60 && me.phase !== 'windup') {
      me.order = { kind: 'move', pos: { x: goalX, y: goalY } };
    }
  }
}
