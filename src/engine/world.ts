import { clamp, dist, distToSegment, norm, v2 } from './math';
import { Rng } from './rng';
import type { Actor, AttackProfile, Hazard, Projectile, Team, Vec2 } from './types';

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
    | 'dodgedProjectile';
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

export class World {
  readonly bounds: WorldBounds;
  readonly rng: Rng;
  time = 0;
  actors: Actor[] = [];
  projectiles: Projectile[] = [];
  hazards: Hazard[] = [];
  events: WorldEvent[] = [];
  playerId = -1;

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
      lastAttackAt: -99,
      hitFlash: 0,
      rootedFor: 0,
      slowFactor: 1,
      slowFor: 0,
      archetype: init.archetype,
      label: init.label,
      isMinion: init.isMinion,
      goldValue: init.goldValue,
      tint: init.tint,
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

  issueStop(a: Actor): void {
    if (a.phase === 'windup') return; // stop does not cancel a windup
    a.order = null;
    a.vel.x = 0;
    a.vel.y = 0;
  }

  /** Nearest living hostile actor within `range` of `pos`. */
  findTarget(from: Actor, pos: Vec2, range: number): Actor | null {
    let best: Actor | null = null;
    let bestD = Infinity;
    for (const b of this.actors) {
      if (!b.alive || b.team === from.team) continue;
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
    if (target && a.attackCd <= 0 && a.phase !== 'windup') {
      const d = dist(a.pos, target.pos) - target.radius;
      if (d <= a.attack.range) this.beginAttack(a, target);
    }

    // Movement.
    const canMove = a.phase !== 'windup' && a.rootedFor <= 0;
    let moved = 0;
    if (canMove && order) {
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
    if (target) a.facing = Math.atan2(target.pos.y - a.pos.y, target.pos.x - a.pos.x);

    // Keep everyone inside the arena.
    a.pos.x = clamp(a.pos.x, a.radius, this.bounds.w - a.radius);
    a.pos.y = clamp(a.pos.y, a.radius, this.bounds.h - a.radius);
  }

  beginAttack(a: Actor, target: Actor): void {
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
        radius: 11,
        shape: 'bolt',
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
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        const nx = dx / d;
        const ny = dy / d;
        a.pos.x -= nx * push;
        a.pos.y -= ny * push;
        b.pos.x += nx * push;
        b.pos.y += ny * push;
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
