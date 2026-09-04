/**
 * The Night Hunter's kit.
 *
 * One champion, modelled properly, because "train Vayne" is not the same
 * request as "train an ADC". Every ability here exists to force a habit that
 * generic drills cannot reach:
 *
 * - **Q Tumble** is a repositioning dash with a cooldown, and its whole skill
 *   is *when* you press it. Pressed during the attack windup it throws the
 *   attack away; pressed during the backswing it is free distance and an
 *   empowered next shot. That is the same asymmetry the trainer's kite drill
 *   is built on, with a cooldown attached so it cannot be spammed.
 * - **W Silver Bolts** is a counter, not a button. Three consecutive hits *on
 *   the same target* execute for a share of its maximum health. It punishes
 *   the exact habit low-elo Vayne players have: switching targets at two.
 * - **E Condemn** is a knockback that only pays when there is terrain behind
 *   the target, so it trains position rather than reaction — you have to have
 *   put yourself on the right side of the wall before the fight arrives.
 * - **R Final Hour** is a window: more damage, a shorter tumble, and
 *   invisibility on each tumble. It trains committing to a burst of time.
 *
 * The kit owns its own state and stats and knows nothing about drills, so all
 * four Vayne drills and the gauntlet share exactly one implementation of the
 * champion.
 */
import { audio } from './audio';
import type { AbilitySlot } from './input';
import { clamp, dist, norm } from './math';
import { PALETTE } from './palette';
import type { DrillPaint } from './paint';
import type { AbilityView, Session } from './session';
import type { Actor, Vec2 } from './types';
import type { WorldEvent } from './world';

export const VAYNE_COLOR = '#c86bff';
export const VAYNE_SILVER = '#e6f0ff';

/** Which parts of the kit a drill hands the player. */
export interface VayneLoadout {
  tumble?: boolean;
  bolts?: boolean;
  condemn?: boolean;
  finalHour?: boolean;
}

export const VAYNE_STATS = {
  hp: 720,
  moveSpeed: 340,
  radius: 28,
  attack: {
    attackSpeed: 0.78,
    windupRatio: 0.27,
    backswingRatio: 0.32,
    range: 550,
    damage: 58,
    projectileSpeed: 1850,
  },

  tumbleRange: 320,
  tumbleCd: 6,
  tumbleCdFinalHour: 3.6,
  /** Extra damage on the attack that follows a tumble. */
  tumbleEmpower: 34,

  /** Hits on one target before the bolts fire. */
  boltsPerProc: 3,
  /** Share of the target's maximum health the third hit takes, as true damage. */
  boltsMaxHpShare: 0.075,
  boltsFlat: 30,
  /** Stacks expire this long after the last hit on that target. */
  boltsDecay: 6,

  condemnRange: 590,
  condemnCd: 13,
  condemnPush: 430,
  condemnDamage: 65,
  condemnWallDamage: 95,
  condemnStun: 1.5,

  finalHourCd: 55,
  finalHourDuration: 9,
  finalHourDamage: 1.28,
  /** Seconds of invisibility granted by a tumble during Final Hour. */
  finalHourStealth: 1,
} as const;

export type VayneCastResult = 'cast' | 'refused' | 'locked' | 'noTarget';

/** Everything the Vayne drills score, measured by the kit itself. */
export interface VayneStats {
  tumbles: number;
  /** Tumbles taken in the backswing or between attacks — free repositioning. */
  tumblesClean: number;
  /** Tumbles that threw away an attack mid-windup. */
  tumblesWasted: number;
  /** Tumbles taken while the attack was off cooldown and a target was in range. */
  tumblesGreedy: number;
  /** Tumbles whose direction closed the gap on the nearest live threat. */
  tumblesInward: number;
  /** Tumbles cut short by terrain — a dash spent on a wall. */
  tumblesBlocked: number;
  /**
   * Tumbles that ended outside the reach of the unit they were taken away
   * from, and — the harder half — those that also ended with that unit still
   * inside her own reach.
   *
   * This is the difference between a tumble and a *good* tumble, and nothing
   * about when the key was pressed can tell them apart. Straight backwards
   * off a diver is safe and costs you the trade; the same cooldown spent
   * sideways buys the same distance and keeps the damage on.
   */
  tumblesToSafety: number;
  tumblesKeptRange: number;
  /** Tumbles that landed closer to a *second* threat than they started. */
  tumblesIntoCrowd: number;
  empoweredHits: number;

  attacksLanded: number;
  boltProcs: number;
  /** Stacks abandoned by switching target before the third hit. */
  boltsDropped: number;
  boltDamage: number;

  condemnCasts: number;
  condemnHits: number;
  condemnWallStuns: number;
  /**
   * Wall stuns the player *made*, rather than found.
   *
   * A target standing in a corner can be condemned into terrain from three
   * quarters of the compass, and doing it is not a skill. This counts the
   * ones where the angle did not exist a second and a bit earlier and exists
   * now because of where she walked — which is the whole of Condemn as a
   * positional ability rather than a button.
   */
  condemnCreated: number;
  /**
   * Summed narrowness of the angles taken, 0..1 each. A stun from the one
   * direction in twenty-four that works is worth most of a point; a stun on
   * something already pinned in a corner is worth almost none.
   */
  condemnAngleSum: number;

  finalHours: number;
  finalHourSeconds: number;
}

const emptyStats = (): VayneStats => ({
  tumbles: 0,
  tumblesClean: 0,
  tumblesWasted: 0,
  tumblesGreedy: 0,
  tumblesInward: 0,
  tumblesBlocked: 0,
  tumblesToSafety: 0,
  tumblesKeptRange: 0,
  tumblesIntoCrowd: 0,
  empoweredHits: 0,
  attacksLanded: 0,
  boltProcs: 0,
  boltsDropped: 0,
  boltDamage: 0,
  condemnCasts: 0,
  condemnHits: 0,
  condemnWallStuns: 0,
  condemnCreated: 0,
  condemnAngleSum: 0,
  finalHours: 0,
  finalHourSeconds: 0,
});

interface PendingHit {
  targetId: number;
  amount: number;
  kind: 'bolts' | 'empower' | 'condemn' | 'wall';
}

export class VayneKit {
  readonly stats: VayneStats = emptyStats();
  readonly loadout: Required<VayneLoadout>;

  /** Seconds remaining on each ability. */
  tumbleCd = 0;
  condemnCd = 0;
  hourCd = 0;
  hourLeft = 0;

  /** Bolt stacks on the target they belong to. */
  stacks = 0;
  stackTargetId: number | null = null;
  private stackAge = 0;
  private empowered = false;
  private pending: PendingHit[] = [];
  /**
   * Where she has been standing, sampled ten times a second for two seconds.
   *
   * Condemn reads it to answer the only question that separates the ability
   * from a knockback: was the wall behind them already, or did you put
   * yourself on the side of the fight where it would be?
   */
  private trail: { t: number; pos: Vec2 }[] = [];
  private trailAccum = 0;
  /** Attack cycle phase at the moment Q was pressed, for the rhythm read. */
  lastTumbleQuality: 'clean' | 'wasted' | 'greedy' | null = null;
  lastTumbleAt = -99;
  lastCondemnAt = -99;
  lastWallStunAt = -99;

  constructor(
    private readonly s: Session,
    loadout: VayneLoadout = { tumble: true, bolts: true, condemn: true, finalHour: false },
  ) {
    this.loadout = {
      tumble: loadout.tumble ?? false,
      bolts: loadout.bolts ?? false,
      condemn: loadout.condemn ?? false,
      finalHour: loadout.finalHour ?? false,
    };
  }

  /** Spawns the player as Vayne and returns her. */
  spawn(pos: Vec2): Actor {
    const p = this.s.world.spawnPlayer(pos, { ...VAYNE_STATS.attack });
    p.maxHp = VAYNE_STATS.hp;
    p.hp = VAYNE_STATS.hp;
    p.moveSpeed = VAYNE_STATS.moveSpeed;
    p.radius = VAYNE_STATS.radius;
    p.label = 'VAYNE';
    p.visual = 'nightHunter';
    return p;
  }

  get inFinalHour(): boolean {
    return this.hourLeft > 0;
  }

  // ------------------------------------------------------------------ frame

  /**
   * Called from the drill's `update`, i.e. *before* the world steps.
   *
   * Bonus damage is queued rather than applied the moment its trigger event
   * arrives, because events raised while the session is draining the event
   * list would be cleared before metrics ever saw them. Flushing here costs
   * one simulation step — a quarter of a hundredth of a second — and keeps
   * every point of bolt damage countable.
   */
  update(dt: number): void {
    const me = this.s.world.player;
    if (me) {
      this.trailAccum += dt;
      if (this.trailAccum >= 0.1) {
        this.trailAccum = 0;
        this.trail.push({ t: this.s.world.time, pos: { ...me.pos } });
        while (this.trail.length && this.s.world.time - this.trail[0].t > 2.2) this.trail.shift();
      }
    }
    if (this.tumbleCd > 0) this.tumbleCd = Math.max(0, this.tumbleCd - dt);
    if (this.condemnCd > 0) this.condemnCd = Math.max(0, this.condemnCd - dt);
    if (this.hourCd > 0) this.hourCd = Math.max(0, this.hourCd - dt);
    if (this.hourLeft > 0) {
      this.hourLeft = Math.max(0, this.hourLeft - dt);
      this.stats.finalHourSeconds += dt;
      if (this.hourLeft === 0) this.s.setBanner('FINAL HOUR OVER', 1);
    }

    // Stacks are a memory of a target, and memories fade.
    if (this.stacks > 0) {
      this.stackAge += dt;
      const target = this.s.world.byId(this.stackTargetId);
      if (this.stackAge > VAYNE_STATS.boltsDecay || !target || !target.alive) this.clearStacks(false);
    }

    if (this.pending.length) {
      const player = this.s.world.player;
      for (const hit of this.pending) {
        const target = this.s.world.byId(hit.targetId);
        if (!target || !target.alive) continue;
        this.s.world.damage(target, hit.amount, player);
      }
      this.pending.length = 0;
    }
  }

  /** Fed the world's events by the drill. */
  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    for (const e of events) {
      if (e.type !== 'attackLand' || e.actorId !== pid) continue;
      const target = this.s.world.byId(e.targetId);
      if (!target || !target.alive) continue;
      this.onAttackLanded(target);
    }
  }

  private onAttackLanded(target: Actor): void {
    this.stats.attacksLanded++;

    // Final Hour's damage is applied as a top-up rather than by rewriting the
    // attack profile, so the number on the attack cycle bar never lies about
    // what a base attack costs.
    if (this.inFinalHour) {
      this.pending.push({
        targetId: target.id,
        amount: VAYNE_STATS.attack.damage * (VAYNE_STATS.finalHourDamage - 1),
        kind: 'empower',
      });
    }

    if (this.empowered) {
      this.empowered = false;
      this.stats.empoweredHits++;
      this.pending.push({ targetId: target.id, amount: VAYNE_STATS.tumbleEmpower, kind: 'empower' });
      this.s.fx.ring(target.pos.x, target.pos.y, 6, 74, 0.3, VAYNE_COLOR, 3, 'impact');
    }

    if (!this.loadout.bolts) return;

    if (this.stackTargetId !== target.id) {
      // A switch with stacks on the board is the mistake this drill exists to
      // find. It is recorded, not punished silently.
      if (this.stacks > 0) this.stats.boltsDropped++;
      this.stackTargetId = target.id;
      this.stacks = 0;
    }
    this.stacks++;
    this.stackAge = 0;

    if (this.stacks >= VAYNE_STATS.boltsPerProc) {
      const amount = target.maxHp * VAYNE_STATS.boltsMaxHpShare + VAYNE_STATS.boltsFlat;
      this.pending.push({ targetId: target.id, amount, kind: 'bolts' });
      this.stats.boltProcs++;
      this.stats.boltDamage += amount;
      this.stacks = 0;
      this.stackAge = 0;
      audio.play('perfect', { pan: this.panOf(target.pos) });
      this.s.fx.ring(target.pos.x, target.pos.y, 8, 128, 0.42, VAYNE_SILVER, 4, 'shock');
      this.s.fx.burst(target.pos.x, target.pos.y, 14, { color: VAYNE_SILVER, speed: 260, life: 0.45, size: 2.4 });
      this.s.micro('SILVER BOLTS', target.pos, VAYNE_SILVER);
    }
  }

  private clearStacks(blame: boolean): void {
    if (blame && this.stacks > 0) this.stats.boltsDropped++;
    this.stacks = 0;
    this.stackAge = 0;
    this.stackTargetId = null;
  }

  // ------------------------------------------------------------------ casts

  cast(slot: AbilitySlot, at: Vec2): VayneCastResult {
    switch (slot) {
      case 'q':
        return this.tumble(at);
      case 'e':
        return this.condemn(at);
      case 'r':
        return this.finalHour();
      default:
        return 'locked';
    }
  }

  /**
   * Where the tumble would actually go, from `from`, with the cursor at `at`.
   *
   * Under the click scheme this is the cursor and nothing else — that is
   * League. Under WASD the keys win whenever one is down, because the mouse
   * under that scheme is holding the *target*, and a dash aimed at your target
   * while you are running away from it is the opposite of the instruction you
   * meant to give. Returns null when there is no direction to be had.
   */
  tumbleDir(from: Vec2, at: Vec2): Vec2 | null {
    if (this.s.tumbleAim === 'hands') {
      const hands = this.s.handDir;
      if (hands) return hands;
    }
    const dir = norm(at.x - from.x, at.y - from.y);
    return dir.x === 0 && dir.y === 0 ? null : dir;
  }

  /** The closest living enemy, for the reads that are about a direction. */
  private nearestThreat(): Actor | null {
    const p = this.s.world.player;
    if (!p) return null;
    let best: Actor | null = null;
    let bd = Infinity;
    for (const e of this.s.world.actors) {
      if (!e.alive || e.team === p.team) continue;
      const d = dist(p.pos, e.pos);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return bd < 900 ? best : null;
  }

  /**
   * Q — Tumble.
   *
   * The dash itself is trivial. What the kit records is *when* it was taken:
   * during the windup it costs an attack, during the backswing it is free, and
   * standing with an attack up and a target in range it is a wasted cooldown.
   * Those three cases are the whole of Vayne's movement skill.
   */
  private tumble(at: Vec2): VayneCastResult {
    if (!this.loadout.tumble) return 'locked';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    if (this.tumbleCd > 0) return 'refused';

    const dir = this.tumbleDir(p.pos, at);
    if (!dir) return 'refused';
    const reach = this.s.world.terrainAlong(p.pos, dir, VAYNE_STATS.tumbleRange, p.radius);
    const from = { ...p.pos };

    const wasWindup = p.phase === 'windup';
    const target = this.s.world.byId(p.targetId);
    const inRange = !!target && target.alive && dist(p.pos, target.pos) - target.radius <= p.attack.range;
    const attackUp = p.attackCd <= 0.02 && p.phase === 'idle';
    // Read before the dash moves her: "which way did that go" is a question
    // about where she was standing when the key went down.
    const threat = this.nearestThreat();

    p.pos.x = from.x + dir.x * reach.distance;
    p.pos.y = from.y + dir.y * reach.distance;
    // The dash is instantaneous, so the render interpolation must not smear
    // the champion across the gap — she was never in between.
    p.prev.x = p.pos.x;
    p.prev.y = p.pos.y;
    p.moveDir = null;
    if (p.order && p.order.kind === 'move') p.order = null;

    if (wasWindup) {
      p.phase = 'idle';
      p.phaseTime = 0;
      this.s.world.emit({ type: 'attackCancel', actorId: p.id, amount: 0 });
      this.stats.tumblesWasted++;
      this.lastTumbleQuality = 'wasted';
      this.s.micro('TUMBLED THE WINDUP', p.pos, PALETTE.danger);
    } else if (attackUp && inRange) {
      this.stats.tumblesGreedy++;
      this.lastTumbleQuality = 'greedy';
      this.s.micro('ATTACK WAS UP', p.pos, PALETTE.textDim);
    } else {
      this.stats.tumblesClean++;
      this.lastTumbleQuality = 'clean';
      if (p.phase === 'backswing') this.s.micro('TUMBLE CANCEL', p.pos, VAYNE_COLOR);
    }

    // Which way it went is its own read, separate from when it was pressed. A
    // perfectly timed tumble into the person chasing you is still a tumble
    // into the person chasing you, and under WASD — where the mouse is on the
    // target and the keys are on the escape — it is the easy mistake to make.
    if (threat && dir.x * (threat.pos.x - from.x) + dir.y * (threat.pos.y - from.y) > 0) {
      this.stats.tumblesInward++;
    }
    if (reach.hit) this.stats.tumblesBlocked++;

    // Where it *put* her. Direction is only half the read: a tumble taken
    // perfectly on the beat, in a sensible direction, that ends outside her
    // own attack range has still bought distance by giving up the trade, and
    // that is the trade-off the ability actually asks about.
    if (threat) {
      const gap = dist(p.pos, threat.pos);
      const safe = gap > threat.attack.range + p.radius;
      if (safe) this.stats.tumblesToSafety++;
      if (safe && gap <= p.attack.range + threat.radius) this.stats.tumblesKeptRange++;
      // And whether she landed nearer to somebody else's fist than she left.
      for (const other of this.s.world.actors) {
        if (!other.alive || other.team === p.team || other.id === threat.id) continue;
        if (dist(p.pos, other.pos) >= dist(from, other.pos)) continue;
        if (dist(p.pos, other.pos) <= other.attack.range + p.radius) {
          this.stats.tumblesIntoCrowd++;
          this.s.micro('INTO THE SECOND ONE', p.pos, PALETTE.danger);
          break;
        }
      }
    }

    this.stats.tumbles++;
    this.lastTumbleAt = this.s.world.time;
    this.empowered = true;
    this.tumbleCd = this.inFinalHour ? VAYNE_STATS.tumbleCdFinalHour : VAYNE_STATS.tumbleCd;
    if (this.inFinalHour) p.invisibleFor = VAYNE_STATS.finalHourStealth;

    this.s.fx.trace([from, { ...p.pos }], VAYNE_COLOR, 0.45, 5);
    this.s.fx.ring(from.x, from.y, 6, 92, 0.34, VAYNE_COLOR, 3, 'shock');
    this.s.fx.burst(p.pos.x, p.pos.y, 12, { color: VAYNE_COLOR, speed: 250, life: 0.35, size: 2.2 });
    audio.play('dodge', { pan: this.panOf(p.pos) });
    return 'cast';
  }

  /**
   * E — Condemn.
   *
   * The knockback is the easy half. The scored half is whether there was a
   * wall behind them when you pressed it, which is a question about where you
   * chose to stand ten seconds earlier.
   */
  private condemn(at: Vec2): VayneCastResult {
    if (!this.loadout.condemn) return 'locked';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    if (this.condemnCd > 0) return 'refused';

    const target = this.pickCondemnTarget(at);
    if (!target) return 'noTarget';

    this.condemnCd = VAYNE_STATS.condemnCd;
    this.stats.condemnCasts++;
    this.stats.condemnHits++;
    this.lastCondemnAt = this.s.world.time;
    audio.play('castE', { pan: this.panOf(target.pos) });

    const dir = norm(target.pos.x - p.pos.x, target.pos.y - p.pos.y);
    const path = this.s.world.terrainAlong(target.pos, dir, VAYNE_STATS.condemnPush, target.radius);
    this.pending.push({ targetId: target.id, amount: VAYNE_STATS.condemnDamage, kind: 'condemn' });
    this.s.world.knockBack(target, dir, path.distance);

    if (path.hit) {
      this.stats.condemnWallStuns++;
      // How hard the angle was, and whether she made it.
      const narrowness = 1 - this.wallWindow(target);
      this.stats.condemnAngleSum += narrowness;
      const then = this.trail.find((s) => this.s.world.time - s.t <= 1.3);
      if (then) {
        const thenDir = norm(target.pos.x - then.pos.x, target.pos.y - then.pos.y);
        const thenPath = this.s.world.terrainAlong(target.pos, thenDir, VAYNE_STATS.condemnPush, target.radius);
        if (!thenPath.hit) {
          this.stats.condemnCreated++;
          this.s.micro('ANGLE MADE', path.at, PALETTE.good);
        }
      }
      this.lastWallStunAt = this.s.world.time;
      target.rootedFor = Math.max(target.rootedFor, VAYNE_STATS.condemnStun);
      this.pending.push({ targetId: target.id, amount: VAYNE_STATS.condemnWallDamage, kind: 'wall' });
      this.s.world.emit({ type: 'wallImpact', actorId: target.id, pos: { ...path.at } });
      this.s.fx.ring(path.at.x, path.at.y, 10, 150, 0.5, PALETTE.warn, 4, 'shock');
      this.s.fx.burst(path.at.x, path.at.y, 22, { color: PALETTE.warn, speed: 340, life: 0.5, size: 2.8 });
      this.s.fx.addFlash(0.07, PALETTE.warn);
      this.s.micro('WALL STUN', path.at, PALETTE.warn);
      audio.play('kill', { pan: this.panOf(path.at) });
    } else {
      this.s.micro('NO WALL', target.pos, PALETTE.textDim);
    }
    return 'cast';
  }

  /**
   * What share of the compass around a target has terrain behind it.
   *
   * Small means the angle was rare and finding it was the skill. Large means
   * the target was already pinned in a corner and any condemn at all would
   * have stunned it, which is not something a player should be paid for.
   */
  private wallWindow(target: Actor): number {
    const n = 24;
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const path = this.s.world.terrainAlong(
        target.pos,
        { x: Math.cos(a), y: Math.sin(a) },
        VAYNE_STATS.condemnPush,
        target.radius,
      );
      if (path.hit) hits++;
    }
    return hits / n;
  }

  /** The unit Condemn would hit: under the cursor first, else nearest to it. */
  pickCondemnTarget(at: Vec2): Actor | null {
    const p = this.s.world.player;
    if (!p) return null;
    let best: Actor | null = null;
    let bd = Infinity;
    for (const e of this.s.world.actors) {
      if (!e.alive || e.team === p.team) continue;
      if (dist(p.pos, e.pos) - e.radius > VAYNE_STATS.condemnRange) continue;
      const d = dist(at, e.pos);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    // A cursor nowhere near a unit is a miss, not a free lock-on.
    return best && bd < best.radius + 190 ? best : null;
  }

  private finalHour(): VayneCastResult {
    if (!this.loadout.finalHour) return 'locked';
    if (this.hourCd > 0) return 'refused';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    this.hourCd = VAYNE_STATS.finalHourCd;
    this.hourLeft = VAYNE_STATS.finalHourDuration;
    this.stats.finalHours++;
    this.tumbleCd = Math.min(this.tumbleCd, VAYNE_STATS.tumbleCdFinalHour);
    this.s.setBanner('FINAL HOUR', 1.4);
    this.s.fx.ring(p.pos.x, p.pos.y, p.radius, p.radius + 260, 0.6, VAYNE_COLOR, 5, 'shock');
    this.s.fx.addFlash(0.1, VAYNE_COLOR);
    return 'cast';
  }

  /** A takedown resets the tumble during Final Hour, exactly as in League. */
  onTakedown(): void {
    if (!this.inFinalHour) return;
    this.tumbleCd = 0;
    this.s.micro('TUMBLE RESET', this.s.world.player?.pos ?? { x: 0, y: 0 }, VAYNE_COLOR);
  }

  // -------------------------------------------------------------------- ui

  /** The ability bar, with the bolt counter living where W's cooldown would. */
  bar(base: AbilityView[]): AbilityView[] {
    return base.map((a) => {
      switch (a.slot) {
        case 'q':
          return this.loadout.tumble
            ? { ...a, name: 'TUMBLE', locked: false, cd: clamp(this.tumbleCd / this.tumbleCdTotal, 0, 1) }
            : a;
        case 'w':
          return this.loadout.bolts
            ? {
                ...a,
                name: `BOLTS ${this.stacks}/${VAYNE_STATS.boltsPerProc}`,
                locked: false,
                cd: 0,
                highlight: this.stacks === VAYNE_STATS.boltsPerProc - 1,
              }
            : a;
        case 'e':
          return this.loadout.condemn
            ? { ...a, name: 'CONDEMN', locked: false, cd: clamp(this.condemnCd / VAYNE_STATS.condemnCd, 0, 1) }
            : a;
        case 'r':
          return this.loadout.finalHour
            ? {
                ...a,
                name: this.inFinalHour ? `HOUR ${this.hourLeft.toFixed(0)}s` : 'FINAL HOUR',
                locked: false,
                cd: clamp(this.hourCd / VAYNE_STATS.finalHourCd, 0, 1),
                highlight: this.inFinalHour,
              }
            : a;
        default:
          return a;
      }
    });
  }

  get tumbleCdTotal(): number {
    return this.inFinalHour ? VAYNE_STATS.tumbleCdFinalHour : VAYNE_STATS.tumbleCd;
  }

  /**
   * Ground indicators the kit owns.
   *
   * The condemn preview is the important one: a line from the target to where
   * it would land, drawn in warning amber when terrain is waiting at the end
   * of it. It is a training wheel on purpose — you are meant to stop needing
   * to look at it, and by then you will have learned to stand on the right
   * side of the wall.
   */
  paint(out: DrillPaint, t: number, cursor: Vec2): void {
    const p = this.s.world.player;
    if (!p) return;

    // Walls are real geometry with real shadows, so they need no decal of
    // their own — only the line showing what would happen to a body arriving
    // at one.
    if (this.loadout.condemn) {
      const target = this.condemnCd <= 0 ? this.pickCondemnTarget(cursor) : null;
      if (target) {
        const dir = norm(target.pos.x - p.pos.x, target.pos.y - p.pos.y);
        const path = this.s.world.terrainAlong(target.pos, dir, VAYNE_STATS.condemnPush, target.radius);
        out.markers.push({
          kind: 'line',
          x: target.pos.x,
          y: target.pos.y,
          x2: path.at.x,
          y2: path.at.y,
          halfWidth: target.radius,
          color: path.hit ? PALETTE.warn : PALETTE.textDim,
          alpha: path.hit ? 0.72 : 0.3,
          fill: path.hit ? 0.3 : 0.08,
          rise: 2.2,
        });
        out.markers.push({
          kind: 'ring',
          x: path.at.x,
          y: path.at.y,
          radius: target.radius + 14,
          color: path.hit ? PALETTE.warn : PALETTE.textDim,
          alpha: path.hit ? 0.7 + 0.2 * Math.sin(t * 9) : 0.28,
          width: 3,
          dash: path.hit ? 0 : 24,
          rise: 2.3,
        });
      }
    }

    // The exit.
    //
    // A dash you cannot see the end of is a dash you press and hope about, and
    // under WASD there is a genuine question to answer — the keys aim it, and
    // the mouse is somewhere else entirely. So while the tumble is up it draws
    // where it would put you, clipped by the terrain that would stop it. It
    // brightens in the backswing, which is the window the whole champion is
    // built on, and it is gone the moment the cooldown starts, so it never
    // becomes furniture.
    if (this.loadout.tumble && this.tumbleCd <= 0) {
      const dir = this.tumbleDir(p.pos, cursor);
      if (dir) {
        const reach = this.s.world.terrainAlong(p.pos, dir, VAYNE_STATS.tumbleRange, p.radius);
        const to = { x: p.pos.x + dir.x * reach.distance, y: p.pos.y + dir.y * reach.distance };
        const free = p.phase === 'backswing' || (p.phase === 'idle' && p.attackCd > 0.02);
        const blocked = reach.hit;
        const color = blocked ? PALETTE.textFaint : VAYNE_COLOR;
        out.markers.push({
          kind: 'line',
          x: p.pos.x,
          y: p.pos.y,
          x2: to.x,
          y2: to.y,
          halfWidth: p.radius * 0.5,
          color,
          alpha: free ? 0.5 : 0.22,
          fill: free ? 0.16 : 0.05,
          rise: 1.1,
        });
        out.markers.push({
          kind: 'ring',
          x: to.x,
          y: to.y,
          radius: p.radius + 6,
          color,
          alpha: free ? 0.62 + 0.14 * Math.sin(t * 7) : 0.26,
          width: blocked ? 2 : 3,
          dash: blocked ? 14 : 0,
          rise: 1.15,
        });
      }
    }

    if (this.inFinalHour) {
      out.markers.push({
        kind: 'ring',
        x: p.pos.x,
        y: p.pos.y,
        radius: p.radius + 26 + Math.sin(t * 4) * 5,
        color: VAYNE_COLOR,
        alpha: 0.55,
        width: 3,
        dash: 18,
        spin: 0.8,
        rise: 1.4,
      });
    }
  }

  private panOf(p: Vec2): number {
    return this.s.panOf(p);
  }
}

/** Fraction of tumbles that were taken in a free window, 0..1. */
export const tumbleRhythm = (st: VayneStats): number =>
  st.tumbles > 0 ? st.tumblesClean / st.tumbles : 0;

/** Bolt procs against the most that could have been earned from those hits. */
export const boltEfficiency = (st: VayneStats): number => {
  const possible = Math.floor(st.attacksLanded / VAYNE_STATS.boltsPerProc);
  return possible > 0 ? clamp(st.boltProcs / possible, 0, 1) : 0;
};

/** Wall stuns against condemns landed. */
export const wallRate = (st: VayneStats): number =>
  st.condemnHits > 0 ? st.condemnWallStuns / st.condemnHits : 0;

/**
 * Fraction of tumbles that went somewhere useful — away from the nearest
 * threat and not into a wall.
 *
 * Deliberately separate from the rhythm. Rhythm is *when* you pressed it and
 * is the first thing to learn; this is *where* it sent you, which is the thing
 * that stops mattering only once the timing is automatic.
 */
export const tumbleDirection = (st: VayneStats): number =>
  st.tumbles > 0 ? clamp(1 - (st.tumblesInward + st.tumblesBlocked * 0.5) / st.tumbles, 0, 1) : 0;

/**
 * Where the tumbles actually landed her, 0..1.
 *
 * The full read, and the one the drills score: landing out of their reach is
 * most of it, landing out of their reach *and* still inside her own is all of
 * it, and landing next to somebody else is worse than not having pressed it.
 *
 * A tumble that no threat was near is neither credited nor charged — the
 * question does not arise, and answering it anyway would price walking around
 * an empty arena as good positioning.
 */
export const tumblePlacement = (st: VayneStats): number => {
  const judged = st.tumblesToSafety + st.tumblesIntoCrowd;
  if (judged < 1) return 0;
  const good = st.tumblesKeptRange * 1 + (st.tumblesToSafety - st.tumblesKeptRange) * 0.55;
  return clamp((good - st.tumblesIntoCrowd * 0.8) / Math.max(1, st.tumblesToSafety + st.tumblesIntoCrowd), 0, 1);
};

/**
 * How much of the wall work was the player's doing, 0..1.
 *
 * Two halves, because there are two ways to be given a stun you did not earn:
 * the target was already in a corner (a wide angle), or it wandered into one
 * without you moving at all. This credits narrow angles, and credits them
 * again when the angle did not exist a moment before you walked into it.
 */
export const wallCraft = (st: VayneStats): number => {
  if (st.condemnWallStuns < 1) return 0;
  const narrow = clamp(st.condemnAngleSum / st.condemnWallStuns, 0, 1);
  const made = clamp(st.condemnCreated / st.condemnWallStuns, 0, 1);
  return clamp(narrow * 0.5 + made * 0.5, 0, 1);
};
