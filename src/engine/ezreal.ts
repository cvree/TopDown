/**
 * The Prodigal Explorer's kit.
 *
 * Vayne is the champion this trainer uses to teach *rhythm* — when in the
 * attack cycle a button belongs. Ezreal is the champion it uses to teach
 * *aim while moving*, which is a different problem with a different failure
 * mode, and the one every WASD player is actually here for.
 *
 * Four things make him the right body for it:
 *
 *  - **Q Mystic Shot is a basic attack you have to aim.** It has travel time,
 *    it has a width, and it stops on the first thing it touches. Every one of
 *    those is a reason a stationary target teaches you nothing.
 *  - **Q refunds cooldowns when it hits.** Accuracy compounds into tempo, so
 *    a player who lands them gets to press more buttons than one who does not.
 *    That is the whole economy of the champion and it cannot be faked.
 *  - **Casting has a cost.** Q roots for its cast time and locks its direction
 *    the instant you press it, so aiming happens *before* you commit, not
 *    during. Pressed in the attack windup it throws the attack away; pressed
 *    in the backswing it is free. That asymmetry is auto-Q weaving.
 *  - **E Arcane Shift is a blink with a bolt on the end.** Where it puts you
 *    is the entire skill; that it went on cooldown is not an achievement.
 *
 * The kit owns its state and knows nothing about drills, so every Ezreal stage
 * shares one implementation of the champion.
 */
import { audio } from './audio';
import type { AbilitySlot } from './input';
import { clamp, dist, norm } from './math';
import { PALETTE } from './palette';
import type { AbilityView, Session } from './session';
import type { Actor, Vec2 } from './types';
import type { WorldEvent } from './world';

export const EZREAL_COLOR = '#ffd166';
export const EZREAL_ARCANE = '#7cc7ff';

export const EZREAL_STATS = {
  hp: 700,
  moveSpeed: 335,
  radius: 27,
  attack: {
    attackSpeed: 0.72,
    windupRatio: 0.28,
    backswingRatio: 0.3,
    range: 550,
    damage: 52,
    projectileSpeed: 2000,
    projectileColor: EZREAL_COLOR,
  },

  /** Q — Mystic Shot. */
  qRange: 1150,
  qSpeed: 2000,
  qRadius: 28,
  qDamage: 76,
  qCd: 5.0,
  /** Seconds the cast roots you, and during which the direction is already locked. */
  qCastTime: 0.25,
  /** Every cooldown drops by this much when a Q connects. */
  qRefund: 1.5,

  /** W — Essence Flux. Marks; the mark detonates on your next damage. */
  wRange: 1050,
  wSpeed: 1500,
  wRadius: 34,
  wCd: 9,
  wMarkFor: 4,
  wDetonation: 62,
  wCastTime: 0.25,

  /** E — Arcane Shift. A blink, and a bolt at whatever is nearest when you land. */
  eRange: 475,
  eCd: 13,
  eBoltDamage: 68,
  eBoltRange: 700,
  eBoltSpeed: 1700,
} as const;

export interface EzrealLoadout {
  mystic?: boolean;
  flux?: boolean;
  shift?: boolean;
}

export type EzrealCastResult = 'cast' | 'refused' | 'locked' | 'noTarget';

/** Everything the Ezreal stages score, measured by the kit itself. */
export interface EzrealStats {
  qCasts: number;
  qHits: number;
  /** Hits taken while the player's own body was moving. The headline number. */
  qHitsMoving: number;
  qCastsMoving: number;
  /** Hits on a target that was itself moving at the moment of the cast. */
  qHitsOnMovers: number;
  /** Hits landed beyond three quarters of the missile's range. */
  qHitsLong: number;
  /** Casts that were eaten by something that was not the target. */
  qBlocked: number;
  /** Cooldown seconds actually recovered by landing them. */
  qRefunded: number;
  /** Q pressed during the attack windup — an auto thrown away for a missile. */
  qWastedWindup: number;
  /** Q pressed in the backswing: the weave. */
  qWeaves: number;
  /** Autos that landed between two Qs — the other half of the weave. */
  weaveCycles: number;

  wCasts: number;
  wMarks: number;
  wDetonations: number;

  eCasts: number;
  /** Blinks that ended outside every threat's reach. */
  eToSafety: number;
  /** Blinks that ended inside somebody's attack range. */
  eIntoDanger: number;
  /** Blinks that ended with the nearest threat still in your own attack range. */
  eKeptRange: number;
  /** Blinks cut short by terrain. */
  eBlocked: number;
  eBoltHits: number;

  attacksLanded: number;
}

const emptyStats = (): EzrealStats => ({
  qCasts: 0,
  qHits: 0,
  qHitsMoving: 0,
  qCastsMoving: 0,
  qHitsOnMovers: 0,
  qHitsLong: 0,
  qBlocked: 0,
  qRefunded: 0,
  qWastedWindup: 0,
  qWeaves: 0,
  weaveCycles: 0,
  wCasts: 0,
  wMarks: 0,
  wDetonations: 0,
  eCasts: 0,
  eToSafety: 0,
  eIntoDanger: 0,
  eKeptRange: 0,
  eBlocked: 0,
  eBoltHits: 0,
  attacksLanded: 0,
});

/** A missile in flight, and what the kit needs to remember about its launch. */
interface TrackedShot {
  id: number;
  slot: 'q' | 'w';
  from: Vec2;
  /** Was the player moving when the key went down? */
  moving: boolean;
  /** Was the intended target moving when the key went down? */
  targetMoving: boolean;
  /** Which unit the shot was aimed at, for the blocked read. */
  aimedAt: number | null;
}

/** A cast that has been committed to but has not left yet. */
interface PendingCast {
  slot: 'q' | 'w';
  dir: Vec2;
  releaseAt: number;
  moving: boolean;
  targetMoving: boolean;
  aimedAt: number | null;
}

export class EzrealKit {
  readonly stats: EzrealStats = emptyStats();
  readonly loadout: Required<EzrealLoadout>;

  qCd = 0;
  wCd = 0;
  eCd = 0;

  /** Live marks from W, keyed by actor id, with their remaining seconds. */
  private marks = new Map<number, number>();
  private shots: TrackedShot[] = [];
  private pending: PendingCast | null = null;
  private pendingDamage: { targetId: number; amount: number }[] = [];
  /** Weave bookkeeping: did an auto land since the last Q, and vice versa. */
  private autoSinceQ = false;
  private qSinceAuto = false;
  /** Where the last blink started, so the stages can draw it. */
  lastShift: { from: Vec2; to: Vec2; at: number } | null = null;

  constructor(
    private readonly s: Session,
    loadout: EzrealLoadout = { mystic: true, flux: false, shift: false },
  ) {
    this.loadout = {
      mystic: loadout.mystic ?? false,
      flux: loadout.flux ?? false,
      shift: loadout.shift ?? false,
    };
  }

  /** Spawns the player as Ezreal and returns him. */
  spawn(pos: Vec2): Actor {
    const p = this.s.world.spawnPlayer(pos, { ...EZREAL_STATS.attack });
    p.maxHp = EZREAL_STATS.hp;
    p.hp = EZREAL_STATS.hp;
    p.moveSpeed = EZREAL_STATS.moveSpeed;
    p.radius = EZREAL_STATS.radius;
    p.label = 'EZREAL';
    return p;
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    if (this.qCd > 0) this.qCd = Math.max(0, this.qCd - dt);
    if (this.wCd > 0) this.wCd = Math.max(0, this.wCd - dt);
    if (this.eCd > 0) this.eCd = Math.max(0, this.eCd - dt);

    for (const [id, left] of this.marks) {
      const next = left - dt;
      if (next <= 0) this.marks.delete(id);
      else this.marks.set(id, next);
    }

    // The committed cast leaves after its cast time, in the direction chosen
    // when the key went down. Aiming happens before the commitment, which is
    // the whole reason a moving target is hard.
    const cast = this.pending;
    if (cast && this.s.world.time >= cast.releaseAt) {
      this.pending = null;
      this.release(cast);
    }

    if (this.pendingDamage.length) {
      const player = this.s.world.player;
      for (const hit of this.pendingDamage) {
        const t = this.s.world.byId(hit.targetId);
        if (t && t.alive) this.s.world.damage(t, hit.amount, player);
      }
      this.pendingDamage.length = 0;
    }

    // Missiles that are gone and never reported a hit were blocked or missed.
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i];
      if (this.s.world.projectiles.some((p) => p.id === shot.id)) continue;
      this.shots.splice(i, 1);
    }
  }

  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    for (const e of events) {
      if (e.type === 'attackLand' && e.actorId === pid) {
        const shot = e.meta !== undefined ? this.shots.find((sh) => sh.id === e.meta) : undefined;
        if (shot) this.onShotLanded(shot, e);
        else this.onAutoLanded(e);
      }
    }
  }

  private onShotLanded(shot: TrackedShot, e: WorldEvent): void {
    const target = this.s.world.byId(e.targetId);
    this.shots = this.shots.filter((s) => s.id !== shot.id);
    if (shot.slot === 'w') {
      if (target && target.alive) {
        this.marks.set(target.id, EZREAL_STATS.wMarkFor);
        this.stats.wMarks++;
        this.s.fx.ring(target.pos.x, target.pos.y, 6, 70, 0.35, EZREAL_ARCANE, 3, 'pulse');
      }
      return;
    }

    // A Q that stopped on a minion is a block, not a hit. Defining it that way
    // rather than "hit something other than the unit under the aim line" is
    // deliberate: the aim line points at a *lead* position, so the intended
    // target is routinely well off it, and inferring intent from geometry got
    // the answer wrong exactly when the target was moving fastest — which is
    // the case the whole stage is about.
    const blocked = target !== undefined && target.isMinion === true;
    if (blocked) {
      this.stats.qBlocked++;
      this.s.micro('BLOCKED', e.pos ?? shot.from, PALETTE.textDim);
      return;
    }

    this.stats.qHits++;
    if (shot.moving) this.stats.qHitsMoving++;
    // Whether it was a led shot is judged at the impact, not at the press: a
    // unit that is still moving when the missile reaches it is a unit you had
    // to aim ahead of, and that is knowable here and only guessable there.
    const victimMoving = target ? Math.hypot(target.vel.x, target.vel.y) > 20 : shot.targetMoving;
    if (victimMoving) this.stats.qHitsOnMovers++;
    const travel = e.pos ? dist(shot.from, e.pos) : 0;
    if (travel > EZREAL_STATS.qRange * 0.75) {
      this.stats.qHitsLong++;
      this.s.micro('MAX RANGE', e.pos ?? shot.from, PALETTE.good);
    }

    // The refund. Every cooldown drops, which is why an accurate Ezreal simply
    // has more of a kit than an inaccurate one.
    const before = this.qCd + this.wCd + this.eCd;
    this.qCd = Math.max(0, this.qCd - EZREAL_STATS.qRefund);
    this.wCd = Math.max(0, this.wCd - EZREAL_STATS.qRefund);
    this.eCd = Math.max(0, this.eCd - EZREAL_STATS.qRefund);
    this.stats.qRefunded += before - (this.qCd + this.wCd + this.eCd);

    this.qSinceAuto = true;
    if (this.autoSinceQ) {
      this.stats.weaveCycles++;
      this.autoSinceQ = false;
    }
    this.detonate(target);
    audio.play('perfect', { pan: this.s.panOf(e.pos ?? shot.from) });
  }

  private onAutoLanded(e: WorldEvent): void {
    this.stats.attacksLanded++;
    this.autoSinceQ = true;
    if (this.qSinceAuto) this.qSinceAuto = false;
    this.detonate(this.s.world.byId(e.targetId));
  }

  /** Anything Ezreal damages pops a live mark on it. */
  private detonate(target: Actor | undefined): void {
    if (!target || !target.alive) return;
    if (!this.marks.has(target.id)) return;
    this.marks.delete(target.id);
    this.stats.wDetonations++;
    this.pendingDamage.push({ targetId: target.id, amount: EZREAL_STATS.wDetonation });
    this.s.fx.ring(target.pos.x, target.pos.y, 8, 110, 0.4, EZREAL_ARCANE, 4, 'shock');
    this.s.micro('FLUX', target.pos, EZREAL_ARCANE);
  }

  hasMark(id: number): boolean {
    return this.marks.has(id);
  }

  // ------------------------------------------------------------------ casts

  cast(slot: AbilitySlot, at: Vec2): EzrealCastResult {
    switch (slot) {
      case 'q':
        return this.skillshot('q', at);
      case 'w':
        return this.skillshot('w', at);
      case 'e':
        return this.shift(at);
      default:
        return 'locked';
    }
  }

  /**
   * Q and W are the same act with different numbers: pick a direction, commit
   * to it, stand still for the cast, and live with where the target went.
   */
  private skillshot(slot: 'q' | 'w', at: Vec2): EzrealCastResult {
    if (slot === 'q' && !this.loadout.mystic) return 'locked';
    if (slot === 'w' && !this.loadout.flux) return 'locked';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    if (this.pending) return 'refused';
    if ((slot === 'q' ? this.qCd : this.wCd) > 0) return 'refused';

    const dir = norm(at.x - p.pos.x, at.y - p.pos.y);
    if (dir.x === 0 && dir.y === 0) return 'refused';

    const moving = Math.hypot(p.vel.x, p.vel.y) > 20;
    const aimed = this.aimedTarget(p, dir, slot === 'q' ? EZREAL_STATS.qRange : EZREAL_STATS.wRange);

    if (slot === 'q') {
      this.stats.qCasts++;
      if (moving) this.stats.qCastsMoving++;
      this.qCd = EZREAL_STATS.qCd;
      // Pressed mid-windup, the attack is gone. Pressed in the backswing it is
      // free, and that is the weave the whole champion is built around.
      if (p.phase === 'windup') {
        p.phase = 'idle';
        p.phaseTime = 0;
        this.stats.qWastedWindup++;
        this.s.world.emit({ type: 'attackCancel', actorId: p.id, amount: 0 });
        this.s.micro('CANCELLED THE AUTO', p.pos, PALETTE.danger);
      } else if (p.phase === 'backswing') {
        this.stats.qWeaves++;
      }
    } else {
      this.stats.wCasts++;
      this.wCd = EZREAL_STATS.wCd;
    }

    const castTime = slot === 'q' ? EZREAL_STATS.qCastTime : EZREAL_STATS.wCastTime;
    p.rootedFor = Math.max(p.rootedFor, castTime);
    p.facing = Math.atan2(dir.y, dir.x);
    this.pending = {
      slot,
      dir,
      releaseAt: this.s.world.time + castTime,
      moving,
      targetMoving: aimed ? Math.hypot(aimed.vel.x, aimed.vel.y) > 20 : false,
      aimedAt: aimed ? aimed.id : null,
    };
    audio.play(slot === 'q' ? 'castQ' : 'castW', { pan: this.s.panOf(p.pos) });
    return 'cast';
  }

  /** The unit a shot down `dir` would hit if nothing moved. */
  private aimedTarget(p: Actor, dir: Vec2, range: number): Actor | null {
    let best: Actor | null = null;
    let bd = Infinity;
    const radius = EZREAL_STATS.qRadius;
    for (const a of this.s.world.actors) {
      if (!a.alive || a.team === p.team) continue;
      const rx = a.pos.x - p.pos.x;
      const ry = a.pos.y - p.pos.y;
      const along = rx * dir.x + ry * dir.y;
      if (along < 0 || along > range) continue;
      const off = Math.abs(rx * -dir.y + ry * dir.x);
      if (off > a.radius + radius + 60) continue;
      if (along < bd) {
        bd = along;
        best = a;
      }
    }
    return best;
  }

  private release(cast: PendingCast): void {
    const p = this.s.world.player;
    if (!p || !p.alive) return;
    const q = cast.slot === 'q';
    const speed = q ? EZREAL_STATS.qSpeed : EZREAL_STATS.wSpeed;
    const range = q ? EZREAL_STATS.qRange : EZREAL_STATS.wRange;
    const shot = this.s.world.spawnProjectile({
      pos: { x: p.pos.x + cast.dir.x * p.radius, y: p.pos.y + cast.dir.y * p.radius },
      team: 'player',
      ownerId: p.id,
      vel: { x: cast.dir.x * speed, y: cast.dir.y * speed },
      speed,
      damage: q ? EZREAL_STATS.qDamage : 0,
      radius: q ? EZREAL_STATS.qRadius : EZREAL_STATS.wRadius,
      shape: q ? 'shard' : 'wave',
      color: q ? EZREAL_COLOR : EZREAL_ARCANE,
      maxLife: range / speed,
    });
    this.shots.push({
      id: shot.id,
      slot: cast.slot,
      from: { ...p.pos },
      moving: cast.moving,
      targetMoving: cast.targetMoving,
      aimedAt: cast.aimedAt,
    });
    this.s.fx.ring(p.pos.x, p.pos.y, p.radius, p.radius + 40, 0.22, q ? EZREAL_COLOR : EZREAL_ARCANE, 2, 'pulse');
  }

  /**
   * E — Arcane Shift.
   *
   * A blink, and then a bolt at whatever is closest. What is scored is where
   * it put you: out of everything's reach and still inside your own is the
   * only outcome worth a nineteen-second cooldown.
   */
  private shift(at: Vec2): EzrealCastResult {
    if (!this.loadout.shift) return 'locked';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    if (this.eCd > 0) return 'refused';

    const dir = this.shiftDir(p.pos, at);
    if (!dir) return 'refused';
    const reach = this.s.world.terrainAlong(p.pos, dir, EZREAL_STATS.eRange, p.radius);
    const from = { ...p.pos };
    // The unit you are leaving. Judging the blink against whatever happens to
    // be nearest *afterwards* looked reasonable and was wrong: on any stage
    // with something that shells from 880 units, "out of everybody's reach"
    // is not a place that exists, and every blink scored as a failure however
    // well it was aimed.
    const escaping = this.nearestHostile(from);

    p.pos.x = from.x + dir.x * reach.distance;
    p.pos.y = from.y + dir.y * reach.distance;
    p.prev.x = p.pos.x;
    p.prev.y = p.pos.y;
    if (p.phase === 'windup') {
      p.phase = 'idle';
      p.phaseTime = 0;
      this.s.world.emit({ type: 'attackCancel', actorId: p.id, amount: 0 });
    }

    this.eCd = EZREAL_STATS.eCd;
    this.stats.eCasts++;
    if (reach.hit) this.stats.eBlocked++;

    // Where it put you, in the only two terms that matter: out of *their*
    // reach, and — the harder half — still inside your own. Straight backwards
    // gets the first. Only a lateral blink gets both, which is why good Ezreal
    // players blink sideways and bad ones blink away.
    if (escaping) {
      const gap = dist(p.pos, escaping.pos);
      const safe = gap > escaping.attack.range + p.radius;
      if (safe) this.stats.eToSafety++;
      else this.stats.eIntoDanger++;
      if (safe && gap <= p.attack.range + escaping.radius) this.stats.eKeptRange++;
    }

    // The bolt: homing, at whatever is nearest when he lands.
    const near = this.s.world.findTarget(p, p.pos, EZREAL_STATS.eBoltRange);
    if (near) {
      const d = norm(near.pos.x - p.pos.x, near.pos.y - p.pos.y);
      this.s.world.spawnProjectile({
        pos: { ...p.pos },
        team: 'player',
        ownerId: p.id,
        vel: { x: d.x * EZREAL_STATS.eBoltSpeed, y: d.y * EZREAL_STATS.eBoltSpeed },
        speed: EZREAL_STATS.eBoltSpeed,
        damage: EZREAL_STATS.eBoltDamage,
        targetId: near.id,
        radius: 13,
        shape: 'orb',
        color: EZREAL_ARCANE,
        maxLife: 2,
      });
      this.stats.eBoltHits++;
    }

    this.s.fx.trace([from, { ...p.pos }], EZREAL_ARCANE, 0.4, 5);
    this.s.fx.ring(from.x, from.y, 6, 92, 0.34, EZREAL_ARCANE, 3, 'shock');
    this.s.fx.burst(p.pos.x, p.pos.y, 12, { color: EZREAL_ARCANE, speed: 250, life: 0.35, size: 2.2 });
    this.lastShift = { from, to: { ...p.pos }, at: this.s.world.time };
    audio.play('dodge', { pan: this.s.panOf(p.pos) });
    return 'cast';
  }

  /**
   * Where a blink points.
   *
   * Same fork as Vayne's tumble and the same answer: under WASD the keys own
   * the escape and the mouse owns the target, so a blink aimed at the mouse
   * while you are running is the opposite of what you meant.
   */
  shiftDir(from: Vec2, at: Vec2): Vec2 | null {
    if (this.s.tumbleAim === 'hands') {
      const hands = this.s.handDir;
      if (hands) return hands;
    }
    const dir = norm(at.x - from.x, at.y - from.y);
    return dir.x === 0 && dir.y === 0 ? null : dir;
  }

  /** The closest living hostile to a point, minions included. */
  private nearestHostile(at: Vec2): Actor | null {
    let best: Actor | null = null;
    let bd = Infinity;
    for (const a of this.s.world.actors) {
      if (!a.alive || a.team === 'player') continue;
      const d = dist(at, a.pos);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------- ui

  bar(base: AbilityView[]): AbilityView[] {
    return base.map((a) => {
      switch (a.slot) {
        case 'q':
          return this.loadout.mystic
            ? { ...a, name: 'MYSTIC SHOT', locked: false, cd: clamp(this.qCd / EZREAL_STATS.qCd, 0, 1) }
            : a;
        case 'w':
          return this.loadout.flux
            ? { ...a, name: 'ESSENCE FLUX', locked: false, cd: clamp(this.wCd / EZREAL_STATS.wCd, 0, 1) }
            : a;
        case 'e':
          return this.loadout.shift
            ? { ...a, name: 'ARCANE SHIFT', locked: false, cd: clamp(this.eCd / EZREAL_STATS.eCd, 0, 1) }
            : a;
        default:
          return a;
      }
    });
  }

  /** True while a cast is committed and the body cannot move. */
  get casting(): boolean {
    return this.pending !== null;
  }

  /** Q accuracy, counting only shots that were not eaten by something else. */
  get accuracy(): number {
    const attempts = this.stats.qCasts - this.stats.qBlocked;
    return attempts > 0 ? clamp(this.stats.qHits / attempts, 0, 1) : 0;
  }

  /**
   * The number that separates an Ezreal from a turret: the share of landed Qs
   * that were fired while his own feet were moving.
   *
   * Standing still and aiming is a solved problem. Nobody loses a game to a
   * stationary Ezreal because a stationary Ezreal is dead.
   */
  get movingAccuracy(): number {
    return this.stats.qHits > 0 ? clamp(this.stats.qHitsMoving / this.stats.qHits, 0, 1) : 0;
  }
}
