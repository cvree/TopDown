import { DEFAULT_HERO, type HeroId } from './heroes';
import { clamp, dist, distToSegment, norm, v2 } from './math';
import { Rng } from './rng';
import type { Actor, AttackProfile, Hazard, Projectile, Team, Vec2, Wall } from './types';

export interface WorldEvent {
  type:
    | 'attackStart'
    | 'attackRelease'
    | 'attackLand'
    | 'attackCancel'
    | 'moveOrder'
    | 'damage'
    | 'death'
    | 'graze'
    | 'hazardWarn'
    | 'hazardFire'
    | 'projectileSpawn'
    | 'projectileExpire'
    | 'dodgedProjectile'
    | 'knockbackStart'
    | 'wallImpact';
  actorId?: number;
  targetId?: number;
  amount?: number;
  pos?: Vec2;
  dir?: number;
  byPlayer?: boolean;
  meta?: number;
}

export interface WorldBounds {
  w: number;
  h: number;
}

const PLAYER_ATTACK: AttackProfile = {
  attackSpeed: 0.8,
  windupRatio: 0.25,
  backswingRatio: 0.33,
  range: 545,
  damage: 68,
  projectileSpeed: 1750,
};

/** Radius inside which an enemy projectile counts as a "near miss". */
export const GRAZE_RADIUS = 46;

/**
 * The longest an attack command will hold your feet waiting for a shot.
 *
 * Long enough that a press a tenth of a second early still fires — nobody has
 * frame-perfect hands and a trainer that demands them teaches flinching, not
 * timing. Short enough that a press half a cycle early is simply thrown away
 * after costing you the distance, which is what stops mashing from being a
 * strategy.
 */
export const FIRE_REQUEST_MAX = 0.3;

export class World {
  readonly bounds: WorldBounds;
  readonly rng: Rng;
  time = 0;
  actors: Actor[] = [];
  projectiles: Projectile[] = [];
  hazards: Hazard[] = [];
  /** Terrain blocks. Empty in every drill that does not place them. */
  walls: Wall[] = [];
  events: WorldEvent[] = [];
  playerId = -1;
  /**
   * Which body the player wears. Cosmetic in the strictest sense — the
   * renderer is the only thing that ever reads it, and `spawnPlayer` stamps it
   * onto the actor so a drill that spawns its own champion (the Vayne path)
   * can overrule it without the world caring.
   */
  playerHero: HeroId = DEFAULT_HERO;

  private nextId = 1;

  constructor(bounds: WorldBounds, rng: Rng) {
    this.bounds = bounds;
    this.rng = rng;
  }

  get player(): Actor | undefined {
    return this.actors.find((a) => a.id === this.playerId);
  }

  byId(id: number | null | undefined): Actor | undefined {
    if (id == null) return undefined;
    return this.actors.find((a) => a.id === id);
  }

  enemies(): Actor[] {
    return this.actors.filter((a) => a.alive && a.team === 'enemy');
  }

  emit(e: WorldEvent): void {
    this.events.push(e);
  }

  clearEvents(): void {
    this.events.length = 0;
  }

  // ---------------------------------------------------------------- spawning

  spawnActor(init: Partial<Actor> & { pos: Vec2; team: Team }): Actor {
    const attack: AttackProfile = init.attack ?? { ...PLAYER_ATTACK };
    const hp = init.maxHp ?? init.hp ?? 600;
    const a: Actor = {
      id: this.nextId++,
      team: init.team,
      pos: { ...init.pos },
      prev: { ...init.pos },
      vel: v2(),
      radius: init.radius ?? 26,
      moveSpeed: init.moveSpeed ?? 345,
      hp,
      maxHp: hp,
      alive: true,
      facing: init.facing ?? -Math.PI / 2,
      attack,
      phase: 'idle',
      phaseTime: 0,
      attackCd: 0,
      targetId: null,
      order: null,
      moveDir: null,
      fireRequest: 0,
      knockback: null,
      lastAttackAt: -99,
      hitFlash: 0,
      rootedFor: 0,
      slowFactor: 1,
      slowFor: 0,
      archetype: init.archetype,
      label: init.label,
      isMinion: init.isMinion,
      unitKind: init.unitKind,
      immovable: init.immovable,
      goldValue: init.goldValue,
      tint: init.tint,
      visual: init.visual,
      invisibleFor: 0,
    };
    this.actors.push(a);
    return a;
  }

  spawnPlayer(pos: Vec2, overrides: Partial<AttackProfile> = {}): Actor {
    const p = this.spawnActor({
      pos,
      team: 'player',
      maxHp: 760,
      radius: 30,
      moveSpeed: 345,
      attack: { ...PLAYER_ATTACK, ...overrides },
      label: 'YOU',
    });
    p.visual = this.playerHero;
    this.playerId = p.id;
    return p;
  }

  spawnProjectile(init: Omit<Partial<Projectile>, 'pos'> & { pos: Vec2; team: Team; ownerId: number }): Projectile {
    const speed = init.speed ?? 1200;
    const vel = init.vel ?? v2();
    const p: Projectile = {
      id: this.nextId++,
      team: init.team,
      ownerId: init.ownerId,
      pos: { ...init.pos },
      prev: { ...init.pos },
      vel,
      radius: init.radius ?? 14,
      speed,
      damage: init.damage ?? 30,
      targetId: init.targetId ?? null,
      life: 0,
      maxLife: init.maxLife ?? 3,
      shape: init.shape ?? 'bolt',
      pierce: init.pierce ?? false,
      effect: init.effect,
      hitIds: init.pierce ? new Set<number>() : undefined,
      color: init.color,
      trail: [],
    };
    this.projectiles.push(p);
    this.emit({ type: 'projectileSpawn', actorId: init.ownerId, pos: { ...p.pos } });
    return p;
  }

  spawnHazard(init: Partial<Hazard> & { pos: Vec2; team: Team }): Hazard {
    const h: Hazard = {
      id: this.nextId++,
      team: init.team,
      shape: init.shape ?? 'circle',
      pos: { ...init.pos },
      end: init.end ? { ...init.end } : undefined,
      radius: init.radius ?? 120,
      width: init.width,
      warn: init.warn ?? 0.85,
      warnTotal: init.warn ?? 0.85,
      active: init.active ?? 0.35,
      activeTotal: init.active ?? 0.35,
      damage: init.damage ?? 45,
      spin: init.spin,
      tickCd: 0,
      color: init.color,
    };
    this.hazards.push(h);
    this.emit({ type: 'hazardWarn', pos: { ...h.pos } });
    return h;
  }

  // ----------------------------------------------------------------- orders

  /**
   * A move order issued during the attack windup cancels the attack outright —
   * the exact mistake this trainer is built to remove. During backswing the
   * same order is free, which is what good orbwalking exploits.
   */
  issueMove(a: Actor, pos: Vec2, attackMove = false): void {
    if (a.phase === 'windup') {
      const remaining = a.phaseTime;
      a.phase = 'idle';
      a.phaseTime = 0;
      this.emit({ type: 'attackCancel', actorId: a.id, amount: remaining });
    }
    a.order = { kind: attackMove ? 'attackMove' : 'move', pos: { ...pos } };
    if (!attackMove) a.targetId = null;
    this.emit({ type: 'moveOrder', actorId: a.id, pos: { ...pos } });
  }

  issueAttackTarget(a: Actor, targetId: number): void {
    a.order = { kind: 'attackTarget', pos: { ...a.pos }, targetId };
    a.targetId = targetId;
  }

  /**
   * Direct control's attack order: acquire and fire without taking a step.
   *
   * It is an attack command, not a move command, so it never cancels a windup
   * — under WASD the mouse cannot move you, and an input that cannot move you
   * must not be able to throw away an attack. Naming a target locks onto it;
   * the attack-move stance underneath re-acquires when that target dies.
   */
  issueAttackHere(a: Actor, targetId?: number): void {
    a.order = { kind: 'attackMove', pos: { ...a.pos } };
    if (targetId !== undefined) a.targetId = targetId;
  }

  /**
   * "Shoot now."
   *
   * The one command direct control has that clicking does not need, because
   * clicking cannot be holding a direction at the same time. It plants the
   * champion until the attack starts, for at most `FIRE_REQUEST_MAX`, and
   * reports how much standing still the press is about to cost — zero if the
   * timer was already up, the whole remaining cooldown if it was not.
   *
   * Returns the seconds of movement the command will cost.
   */
  requestFire(a: Actor): number {
    if (a.phase === 'windup') return 0;
    const cost = Math.max(0, a.attackCd);
    a.fireRequest = Math.min(FIRE_REQUEST_MAX, Math.max(cost, 1 / 240));
    return Math.min(FIRE_REQUEST_MAX, cost);
  }

  /**
   * Stop.
   *
   * It drops the order, the target and any pending attack command, which is
   * what League's S key does: it is how you *stop attacking*, not merely how
   * you stop walking. It used to leave the target behind, so under an
   * attack-move stance the champion carried on shooting the thing you had just
   * asked it to leave alone.
   *
   * It still does not cancel a windup. A committed attack is committed, and a
   * key that could take it back would be a free undo on the one decision this
   * whole trainer is about.
   */
  issueStop(a: Actor): void {
    if (a.phase === 'windup') return;
    a.order = null;
    a.targetId = null;
    a.fireRequest = 0;
    a.vel.x = 0;
    a.vel.y = 0;
  }

  /**
   * The WASD scheme's movement command.
   *
   * A held direction is a move order that never stops arriving, so it obeys the
   * same law every other move order does: taken during the windup it cancels
   * the attack, taken during the backswing it is free. The asymmetry is the
   * whole trainer, and it must not quietly disappear because the player
   * switched control schemes.
   */
  setMoveDir(a: Actor, x: number, y: number): void {
    const m = Math.hypot(x, y);
    if (m < 0.001) {
      a.moveDir = null;
      return;
    }
    const dir = { x: x / m, y: y / m };
    if (!a.moveDir && a.phase === 'windup') {
      const remaining = a.phaseTime;
      a.phase = 'idle';
      a.phaseTime = 0;
      this.emit({ type: 'attackCancel', actorId: a.id, amount: remaining });
    }
    if (!a.moveDir) this.emit({ type: 'moveOrder', actorId: a.id, pos: { x: a.pos.x + dir.x * 200, y: a.pos.y + dir.y * 200 } });
    a.moveDir = dir;
    // A direction supersedes any pathing order's destination, but not its
    // targeting: an attack-move stance keeps acquiring while you drive.
    if (a.order && a.order.kind === 'move') a.order = null;
  }

  /** Shoves an actor along `dir` for `distance` units at `speed` u/s. */
  knockBack(a: Actor, dir: Vec2, distance: number, speed = 1400): void {
    const m = Math.hypot(dir.x, dir.y) || 1;
    a.knockback = { dir: { x: dir.x / m, y: dir.y / m }, remaining: distance, speed };
    a.moveDir = null;
    a.order = null;
    if (a.phase === 'windup') {
      const remaining = a.phaseTime;
      a.phase = 'idle';
      a.phaseTime = 0;
      this.emit({ type: 'attackCancel', actorId: a.id, amount: remaining });
    }
    this.emit({ type: 'knockbackStart', actorId: a.id, pos: { ...a.pos }, amount: distance });
  }

  /**
   * How far a body of `radius` can travel from `from` along `dir` before it
   * meets terrain, capped at `maxDist`. Returns the free distance and whether
   * something was actually hit — which is the entire question Condemn asks.
   */
  terrainAlong(from: Vec2, dir: Vec2, maxDist: number, radius: number): { distance: number; hit: boolean; at: Vec2 } {
    const m = Math.hypot(dir.x, dir.y) || 1;
    const dx = dir.x / m;
    const dy = dir.y / m;
    let best = maxDist;
    let hit = false;
    // The arena edge is a wall too — being pinned against it is a real
    // League interaction, not an artefact of the playfield ending.
    const edges = [
      { t: (radius - from.x) / (dx || 1e-9), valid: dx < 0 },
      { t: (this.bounds.w - radius - from.x) / (dx || 1e-9), valid: dx > 0 },
      { t: (radius - from.y) / (dy || 1e-9), valid: dy < 0 },
      { t: (this.bounds.h - radius - from.y) / (dy || 1e-9), valid: dy > 0 },
    ];
    for (const e of edges) {
      if (!e.valid || e.t < 0) continue;
      if (e.t < best) {
        best = e.t;
        hit = true;
      }
    }
    for (const wall of this.walls) {
      const t = raySlab(from, dx, dy, wall, radius);
      if (t >= 0 && t < best) {
        best = t;
        hit = true;
      }
    }
    best = Math.max(0, Math.min(best, maxDist));
    return { distance: best, hit: hit && best < maxDist - 0.5, at: { x: from.x + dx * best, y: from.y + dy * best } };
  }

  /**
   * Puts an actor back where an actor is allowed to be: inside the arena and
   * outside the terrain.
   *
   * Everything that moves a body — steering, knockback, and the separation
   * pass that runs after both — ends by calling this. Before, separation ran
   * last and answered to nothing, so two units shoving each other against a
   * wall pushed one of them *through* it, and a crowd against the arena edge
   * quietly leaked bodies off the floor.
   */
  private confine(a: Actor): void {
    a.pos.x = clamp(a.pos.x, a.radius, this.bounds.w - a.radius);
    a.pos.y = clamp(a.pos.y, a.radius, this.bounds.h - a.radius);
    if (this.walls.length) this.resolveWalls(a);
  }

  /** Pushes a circle out of any wall it is standing in. */
  private resolveWalls(a: Actor): void {
    for (const wall of this.walls) {
      const hw = wall.w / 2;
      const hh = wall.h / 2;
      const nx = clamp(a.pos.x, wall.x - hw, wall.x + hw);
      const ny = clamp(a.pos.y, wall.y - hh, wall.y + hh);
      const dx = a.pos.x - nx;
      const dy = a.pos.y - ny;
      const d2 = dx * dx + dy * dy;
      if (d2 > a.radius * a.radius) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        a.pos.x = nx + (dx / d) * a.radius;
        a.pos.y = ny + (dy / d) * a.radius;
      } else {
        // Dead centre: leave by the nearest face.
        const left = a.pos.x - (wall.x - hw);
        const right = wall.x + hw - a.pos.x;
        const up = a.pos.y - (wall.y - hh);
        const down = wall.y + hh - a.pos.y;
        const min = Math.min(left, right, up, down);
        if (min === left) a.pos.x = wall.x - hw - a.radius;
        else if (min === right) a.pos.x = wall.x + hw + a.radius;
        else if (min === up) a.pos.y = wall.y - hh - a.radius;
        else a.pos.y = wall.y + hh + a.radius;
      }
    }
  }

  /** Nearest living hostile actor within `range` of `pos`. */
  findTarget(from: Actor, pos: Vec2, range: number): Actor | null {
    let best: Actor | null = null;
    let bestD = Infinity;
    for (const b of this.actors) {
      if (!b.alive || b.team === from.team) continue;
      if ((b.invisibleFor ?? 0) > 0) continue;
      const d = dist(pos, b.pos) - b.radius;
      if (d <= range && d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------- step

  step(dt: number): void {
    this.time += dt;
    for (const a of this.actors) {
      a.prev.x = a.pos.x;
      a.prev.y = a.pos.y;
    }
    for (const p of this.projectiles) {
      p.prev.x = p.pos.x;
      p.prev.y = p.pos.y;
    }

    for (const a of this.actors) if (a.alive) this.stepActor(a, dt);
    this.separate();
    this.stepProjectiles(dt);
    this.stepHazards(dt);
    this.cull();
  }

  private stepActor(a: Actor, dt: number): void {
    if (a.hitFlash > 0) a.hitFlash = Math.max(0, a.hitFlash - dt * 4);
    if (a.rootedFor > 0) a.rootedFor -= dt;
    if ((a.invisibleFor ?? 0) > 0) a.invisibleFor = Math.max(0, (a.invisibleFor ?? 0) - dt);

    // A knockback owns the actor while it lasts: no pathing, no attacking.
    if (a.knockback) {
      a.fireRequest = 0;
      const kb = a.knockback;
      const step = Math.min(kb.speed * dt, kb.remaining);
      a.pos.x += kb.dir.x * step;
      a.pos.y += kb.dir.y * step;
      a.vel.x = kb.dir.x * kb.speed;
      a.vel.y = kb.dir.y * kb.speed;
      kb.remaining -= step;
      this.confine(a);
      if (kb.remaining <= 0.001) {
        a.knockback = null;
        a.vel.x = 0;
        a.vel.y = 0;
      }
      return;
    }
    if (a.slowFor > 0) {
      a.slowFor -= dt;
      if (a.slowFor <= 0) a.slowFactor = 1;
    }
    if (a.attackCd > 0) a.attackCd -= dt;

    const cycle = 1 / Math.max(0.05, a.attack.attackSpeed);

    if (a.phase === 'windup') {
      a.phaseTime -= dt;
      if (a.phaseTime <= 0) {
        this.releaseAttack(a);
        a.phase = 'backswing';
        a.phaseTime = cycle * a.attack.backswingRatio;
      }
    } else if (a.phase === 'backswing') {
      a.phaseTime -= dt;
      if (a.phaseTime <= 0) {
        a.phase = 'idle';
        a.phaseTime = 0;
      }
    }

    // Acquire a target when attack-moving.
    const order = a.order;
    if (order && order.kind === 'attackMove') {
      const cur = this.byId(a.targetId);
      if (!cur || !cur.alive || dist(a.pos, cur.pos) - cur.radius > a.attack.range + 40) {
        const t = this.findTarget(a, a.pos, a.attack.range);
        a.targetId = t ? t.id : null;
      }
    }

    let target = this.byId(a.targetId);
    if (target && !target.alive) {
      target = undefined;
      a.targetId = null;
    }

    // Start an attack if the timer is up and the target is in range.
    // An attack-move never chases: it walks to the point you clicked and
    // attacks whatever enters range on the way, exactly as in League. Only an
    // explicit attack-on-target order follows the unit.
    // Under direct control an attack needs one of two things: the keys let go
    // of — the classic orbwalk release — or an explicit attack command, which
    // costs you standing still until the shot leaves. A held direction alone
    // never fires, because a champion that shoots while you drive it is not
    // teaching anybody to orbwalk.
    const firing = a.directControl ? a.moveDir === null || (a.fireRequest ?? 0) > 0 : true;
    if (target && a.attackCd <= 0 && a.phase !== 'windup' && firing && (target.invisibleFor ?? 0) <= 0) {
      const d = dist(a.pos, target.pos) - target.radius;
      if (d <= a.attack.range) this.beginAttack(a, target);
    }

    // Movement. A live attack command plants the feet: the champion has been
    // told to shoot and is waiting for the timer, which is exactly the stutter
    // an early attack-move click buys you in League.
    const halted = (a.directControl ?? false) && (a.fireRequest ?? 0) > 0;
    const canMove = a.phase !== 'windup' && a.rootedFor <= 0 && !halted;
    let moved = 0;
    if (canMove && a.moveDir) {
      const sp = a.moveSpeed * a.slowFactor;
      a.pos.x += a.moveDir.x * sp * dt;
      a.pos.y += a.moveDir.y * sp * dt;
      a.vel.x = a.moveDir.x * sp;
      a.vel.y = a.moveDir.y * sp;
      a.facing = Math.atan2(a.moveDir.y, a.moveDir.x);
      moved = sp * dt;
    } else if (canMove && order && !a.directControl) {
      let goal = order.pos;
      let stopAt = 4;
      if (order.kind === 'attackTarget' && target) {
        // Walk only as far as it takes to get the target in range.
        goal = target.pos;
        stopAt = Math.max(6, a.attack.range + target.radius - 12);
      }
      const dx = goal.x - a.pos.x;
      const dy = goal.y - a.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > stopAt) {
        const sp = a.moveSpeed * a.slowFactor;
        const stepLen = Math.min(sp * dt, d - stopAt + 0.001);
        const nx = dx / d;
        const ny = dy / d;
        a.pos.x += nx * stepLen;
        a.pos.y += ny * stepLen;
        a.vel.x = nx * sp;
        a.vel.y = ny * sp;
        a.facing = Math.atan2(ny, nx);
        moved = stepLen;
      } else {
        a.vel.x = 0;
        a.vel.y = 0;
        if (order.kind === 'move') a.order = null;
      }
    } else {
      a.vel.x = 0;
      a.vel.y = 0;
    }
    if (moved === 0) {
      a.vel.x = 0;
      a.vel.y = 0;
    }
    // Face the target while the attack animation owns the body; face where you
    // are going the rest of the time. A champion that moonwalks everywhere
    // because a stance is holding a target reads its own movement wrongly.
    if (target && (a.phase !== 'idle' || moved === 0)) {
      a.facing = Math.atan2(target.pos.y - a.pos.y, target.pos.x - a.pos.x);
    }

    this.confine(a);
    // The command ages out at the end of the step it was read on, never
    // before: a request made and expired inside one tick would be a command
    // that could not possibly have fired anything.
    if ((a.fireRequest ?? 0) > 0) a.fireRequest = Math.max(0, (a.fireRequest ?? 0) - dt);
  }

  beginAttack(a: Actor, target: Actor): void {
    a.fireRequest = 0;
    const cycle = 1 / Math.max(0.05, a.attack.attackSpeed);
    a.phase = 'windup';
    a.phaseTime = cycle * a.attack.windupRatio;
    a.attackCd = cycle;
    a.targetId = target.id;
    a.lastAttackAt = this.time;
    a.facing = Math.atan2(target.pos.y - a.pos.y, target.pos.x - a.pos.x);
    this.emit({ type: 'attackStart', actorId: a.id, targetId: target.id });
  }

  private releaseAttack(a: Actor): void {
    const target = this.byId(a.targetId);
    this.emit({ type: 'attackRelease', actorId: a.id, targetId: target?.id, pos: { ...a.pos } });
    if (!target || !target.alive) return;
    if (a.attack.projectileSpeed > 0) {
      const d = norm(target.pos.x - a.pos.x, target.pos.y - a.pos.y);
      this.spawnProjectile({
        pos: { x: a.pos.x + d.x * a.radius, y: a.pos.y + d.y * a.radius },
        team: a.team,
        ownerId: a.id,
        vel: { x: d.x * a.attack.projectileSpeed, y: d.y * a.attack.projectileSpeed },
        speed: a.attack.projectileSpeed,
        damage: a.attack.damage,
        targetId: target.id,
        radius: a.attack.projectileRadius ?? 11,
        shape: a.attack.projectileShape ?? 'bolt',
        color: a.attack.projectileColor,
        maxLife: 2.5,
      });
    } else {
      this.damage(target, a.attack.damage, a);
      this.emit({ type: 'attackLand', actorId: a.id, targetId: target.id, amount: a.attack.damage, pos: { ...target.pos } });
    }
  }

  damage(target: Actor, amount: number, source?: Actor): void {
    if (!target.alive) return;
    target.hp -= amount;
    target.hitFlash = 1;
    this.emit({ type: 'damage', actorId: source?.id, targetId: target.id, amount, pos: { ...target.pos } });
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.killedByPlayer = source?.id === this.playerId;
      this.emit({
        type: 'death',
        actorId: target.id,
        targetId: source?.id,
        byPlayer: source?.id === this.playerId,
        pos: { ...target.pos },
      });
    }
  }

  /** Soft unit collision — units nudge apart instead of overlapping. */
  private separate(): void {
    const n = this.actors.length;
    for (let i = 0; i < n; i++) {
      const a = this.actors[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.actors[j];
        if (!b.alive) continue;
        if (a.immovable && b.immovable) continue;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        // A structure never gives ground: the whole displacement goes to
        // whoever walked into it, which is what makes a turret feel planted.
        const share = a.immovable || b.immovable ? 1 : 0.5;
        const push = (min - d) * share;
        const nx = dx / d;
        const ny = dy / d;
        if (!a.immovable) {
          a.pos.x -= nx * push;
          a.pos.y -= ny * push;
        }
        if (!b.immovable) {
          b.pos.x += nx * push;
          b.pos.y += ny * push;
        }
        if (!a.immovable) this.confine(a);
        if (!b.immovable) this.confine(b);
      }
    }
  }

  private stepProjectiles(dt: number): void {
    const player = this.player;
    for (const p of this.projectiles) {
      p.life += dt;
      // Homing projectiles (basic attacks) steer to their target.
      if (p.targetId != null) {
        const t = this.byId(p.targetId);
        if (t && t.alive) {
          const d = norm(t.pos.x - p.pos.x, t.pos.y - p.pos.y);
          p.vel.x = d.x * p.speed;
          p.vel.y = d.y * p.speed;
        }
      }
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;

      p.trail.push({ x: p.pos.x, y: p.pos.y });
      if (p.trail.length > 8) p.trail.shift();

      // Near-miss detection against the player, used for dodge scoring and fx.
      if (player && player.alive && p.team === 'enemy' && !p.grazed) {
        const dSeg = distToSegment(player.pos, p.prev, p.pos);
        if (dSeg < GRAZE_RADIUS + player.radius && dSeg > player.radius + p.radius) {
          p.grazed = true;
          this.emit({ type: 'graze', targetId: player.id, amount: dSeg, pos: { ...p.pos } });
        }
      }

      // Collision — swept against the segment travelled this step.
      for (const a of this.actors) {
        if (!a.alive || a.team === p.team) continue;
        if (p.hitIds?.has(a.id)) continue;
        if (p.targetId != null && p.targetId !== a.id) continue;
        const d = distToSegment(a.pos, p.prev, p.pos);
        if (d <= a.radius + p.radius) {
          this.damage(a, p.damage, this.byId(p.ownerId));
          if (p.effect?.root) a.rootedFor = Math.max(a.rootedFor, p.effect.root);
          if (p.effect?.slow) {
            a.slowFactor = Math.min(a.slowFactor, p.effect.slow.factor);
            a.slowFor = Math.max(a.slowFor, p.effect.slow.dur);
          }
          this.emit({
            type: 'attackLand',
            actorId: p.ownerId,
            targetId: a.id,
            amount: p.damage,
            pos: { ...p.pos },
            // Which missile it was. A champion whose abilities are missiles
            // needs to tell its own skillshot landing apart from its basic
            // attack landing, and the alternative — inferring it from damage
            // or timing — is a guess that goes wrong the first time two
            // numbers happen to match.
            meta: p.id,
          });
          if (p.pierce) p.hitIds?.add(a.id);
          else p.life = p.maxLife + 1;
          break;
        }
      }

      if (
        p.pos.x < -80 ||
        p.pos.y < -80 ||
        p.pos.x > this.bounds.w + 80 ||
        p.pos.y > this.bounds.h + 80
      ) {
        p.life = p.maxLife + 1;
      }
    }
  }

  private stepHazards(dt: number): void {
    const player = this.player;
    for (const h of this.hazards) {
      if (h.spin && h.end) {
        const dx = h.end.x - h.pos.x;
        const dy = h.end.y - h.pos.y;
        const a = Math.atan2(dy, dx) + h.spin * dt;
        const r = Math.hypot(dx, dy);
        h.end.x = h.pos.x + Math.cos(a) * r;
        h.end.y = h.pos.y + Math.sin(a) * r;
      }
      if (h.warn > 0) {
        h.warn -= dt;
        if (h.warn <= 0) this.emit({ type: 'hazardFire', pos: { ...h.pos } });
        continue;
      }
      h.active -= dt;
      if (h.tickCd !== undefined && h.tickCd > 0) h.tickCd -= dt;

      for (const a of this.actors) {
        if (!a.alive) continue;
        if (h.team === 'enemy' && a.team !== 'player') continue;
        if (h.team === 'player' && a.team !== 'enemy') continue;
        if (!this.hazardHits(h, a.pos, a.radius)) continue;
        if (h.activeTotal <= 0.4) {
          if (h.consumed) continue;
          h.consumed = true;
          this.damage(a, h.damage, undefined);
        } else if ((h.tickCd ?? 0) <= 0) {
          this.damage(a, h.damage, undefined);
          h.tickCd = 0.4;
        }
      }
      void player;
    }
  }

  hazardHits(h: Hazard, pos: Vec2, radius: number): boolean {
    switch (h.shape) {
      case 'circle':
        return dist(h.pos, pos) < h.radius + radius;
      case 'ring': {
        const d = dist(h.pos, pos);
        return d < h.radius + radius && d > h.radius - (h.width ?? 60) - radius;
      }
      case 'line': {
        if (!h.end) return false;
        return distToSegment(pos, h.pos, h.end) < (h.width ?? 50) + radius;
      }
      case 'cone': {
        if (!h.end) return false;
        const d = dist(h.pos, pos);
        if (d > h.radius + radius) return false;
        const aim = Math.atan2(h.end.y - h.pos.y, h.end.x - h.pos.x);
        const to = Math.atan2(pos.y - h.pos.y, pos.x - h.pos.x);
        let diff = Math.abs(((to - aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        diff = Math.abs(diff);
        return diff < (h.width ?? 0.5);
      }
    }
  }

  private cull(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.life > p.maxLife) {
        if (p.team === 'enemy' && !p.grazed && p.targetId === null) {
          this.emit({ type: 'dodgedProjectile', pos: { ...p.pos } });
        }
        this.projectiles.splice(i, 1);
      }
    }
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      if (h.warn <= 0 && h.active <= 0) this.hazards.splice(i, 1);
    }
  }

  /** Free-window bookkeeping helper: is this actor able to move without cost? */
  static isFreeToMove(a: Actor): boolean {
    return a.phase !== 'windup';
  }
}

/**
 * Distance along a ray to an axis-aligned box grown by `radius`, or -1 if the
 * ray misses it. The classic slab test, written out rather than pulled in.
 */
const raySlab = (from: Vec2, dx: number, dy: number, wall: Wall, radius: number): number => {
  const minX = wall.x - wall.w / 2 - radius;
  const maxX = wall.x + wall.w / 2 + radius;
  const minY = wall.y - wall.h / 2 - radius;
  const maxY = wall.y + wall.h / 2 + radius;
  let t0 = 0;
  let t1 = Infinity;
  for (const [o, d, lo, hi] of [
    [from.x, dx, minX, maxX],
    [from.y, dy, minY, maxY],
  ] as [number, number, number, number][]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return -1;
      continue;
    }
    let ta = (lo - o) / d;
    let tb = (hi - o) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  return t0;
};
