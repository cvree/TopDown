/**
 * The Magus Ascendant's kit.
 *
 * Vayne grades a distance from perfect, Twisted Fate a choice made in time and
 * Katarina a place reached before the dagger. Xerath grades the thing all
 * three of them assume and none of them can isolate: **the distance you keep
 * while you hit.** He is the artillery — the longest reach in this client by
 * a factor of two, and the slowest, most readable body on the floor — and
 * every one of his buttons is a promise about where somebody will be a beat
 * from now, made from somewhere they cannot reach you.
 *
 * So the kit is built around four facts, each of which a stage is about:
 *
 *  - **Arcanopulse is a charge, and the charge is the range.** It grows from
 *    seven hundred and fifty units to fourteen hundred and fifty over a second
 *    and a half, it slows him while it grows, and it lands half a second after
 *    it is let go. Holding it longer than the target needs is time spent slow
 *    and visible for nothing, and letting go early is a beam that stops short.
 *    The habit being built is *release the moment it reaches*.
 *  - **Everything lands late.** The pulse half a second after release, the Eye
 *    three quarters of a second after the cast, the Rite six tenths. A body
 *    that sees the telegraph and walks is out of it — so these grade the cast
 *    you made where they *will* be, and the cast you made on somebody who
 *    could not walk.
 *  - **Shocking Orb is the one that cannot be dodged late, and it is blocked.**
 *    A real missile, stopped by the first body it touches, minions included,
 *    and it stuns for longer the farther it flew — three quarters of a second
 *    point blank, two and a quarter at the end of its range. An orb thrown
 *    early at a diver is three times the orb thrown at their feet.
 *  - **Rite of the Arcane roots him.** Ten seconds of shots from across the map,
 *    and the body that fires them cannot move — the one moment the artillery
 *    is standing still on purpose, which is only safe if it was spaced first.
 *
 * As with the other kits, this one owns its state and knows nothing about
 * drills, so every Xerath stage shares one implementation of him.
 */
import { audio } from './audio';
import type { AbilitySlot } from './input';
import { clamp, dist, distToSegment, norm } from './math';
import { PALETTE } from './palette';
import type { AbilityView, Session } from './session';
import type { Actor, Vec2 } from './types';
import type { WorldEvent } from './world';

/** His arcane blue, the white of a pulse's core, and the Rite's violet. */
export const XER_BLUE = '#4fc3ff';
export const XER_CORE = '#e6f6ff';
export const XER_VIOLET = '#9b7bff';

export const XERATH_STATS = {
  hp: 596,
  moveSpeed: 340,
  radius: 30,
  attack: {
    // League's: a ranged auto at five hundred and twenty-five — which is short
    // for a mage and is the reason he does not want to be anywhere it reaches.
    attackSpeed: 0.658,
    windupRatio: 0.25,
    backswingRatio: 0.3,
    range: 525,
    damage: 55,
    projectileSpeed: 2000,
  },

  /** Q — Arcanopulse. A line that grows while the key is down. */
  qMinRange: 750,
  qMaxRange: 1450,
  /** Seconds from the first press to the full fourteen hundred and fifty. */
  qChargeTime: 1.5,
  /**
   * Seconds from the press after which the charge gives up on its own. The
   * pulse fizzles, and half the cooldown comes back — League's figure.
   */
  qHoldLimit: 4,
  qFizzleRefund: 0.5,
  /** League's beam is a hundred and forty-five wide. */
  qHalfWidth: 72,
  /** Seconds from the release to the beam landing. */
  qDelay: 0.5,
  qDamage: 150,
  /**
   * The slow he puts on himself while charging, at full charge.
   *
   * League slows him for as long as he holds it; here it builds with the
   * charge, to half his speed at full range. Either way the lesson is the
   * same: a held pulse is a slower Xerath, and the hold should end the moment
   * the line reaches.
   */
  qSelfSlow: 0.5,
  /** League's at rank five — Arcanopulse is the one every Xerath maxes first. */
  qCd: 5,
  qLeagueCd: 9,

  /** W — Eye of Destruction. A circle, and a centre worth most of it. */
  wRange: 1000,
  wRadius: 275,
  /** The sweet spot. A body touching it takes the bonus and the big slow. */
  wCentre: 50,
  wDelay: 0.75,
  wDamage: 100,
  /** League's: the centre deals two thirds again. */
  wCentreBonus: 0.667,
  wSlow: 0.25,
  wCentreSlow: 0.6,
  wSlowFor: 2.5,
  wCd: 10,
  wLeagueCd: 14,

  /** E — Shocking Orb. A real missile: it can be blocked and it can be dodged. */
  eRange: 1125,
  eSpeed: 1400,
  eRadius: 60,
  eDamage: 110,
  /** The stun, at point blank and at the end of the range. */
  eStunMin: 0.75,
  eStunMax: 2.25,
  eCd: 11,
  eLeagueCd: 13,

  /** R — Rite of the Arcane. */
  rRange: 5000,
  rRadius: 200,
  rDelay: 0.627,
  /** League's rank one. Every shot is a separate guess. */
  rShots: 4,
  /** The least time between two shots. */
  rRecast: 0.5,
  rChannel: 10,
  rDamage: 220,
  /**
   * League charges this in minutes. A rep has to contain more than one, and
   * the thing worth rehearsing is the volley itself — so it comes back in a
   * third of a minute and everything else about it is League's.
   */
  rCd: 20,
  rLeagueCd: 130,
} as const;

export interface XerathLoadout {
  arcanopulse?: boolean;
  eye?: boolean;
  orb?: boolean;
  rite?: boolean;
}

export type XerathCastResult = 'cast' | 'charging' | 'refused' | 'locked' | 'noTarget';

/** Something of his that will land, telegraphed, and when. */
export interface Blast {
  id: number;
  kind: 'q' | 'w' | 'r';
  /** A line from `from` to `to`, or a circle at `to`. */
  shape: 'line' | 'circle';
  from: Vec2;
  to: Vec2;
  radius: number;
  castAt: number;
  firesAt: number;
  /** Where he was standing when he cast it. */
  origin: Vec2;
  /** For a pulse: seconds it was charged before it was let go. */
  charged: number;
}

/** What a blast did, for the stage that grades blasts as they land. */
export interface BlastResult {
  blast: Blast;
  at: number;
  /** Enemy champions caught, by id. */
  champions: number[];
  /** Minions caught. */
  minions: number;
  /** True if an Eye's centre was on a champion. */
  centre: boolean;
  /** Champions caught who could not have walked: stunned or rooted. */
  held: number;
  /** A pulse aimed true that stopped short of the champion it was aimed at. */
  short: boolean;
  /** For a pulse: seconds of charge beyond what the farthest champion hit needed. */
  overcharge: number;
}

/** Everything the Xerath stages score, measured by the kit itself. */
export interface XerathStats {
  qCasts: number;
  /** Pulses that caught at least one champion. */
  qHits: number;
  /** Pulses aimed true that fell short — let go too early. */
  qShort: number;
  /** Pulses that fizzled in the hand — held past the limit. */
  qFizzles: number;
  /** Seconds of charge spent beyond what a landed pulse needed, summed. */
  qOverchargeSum: number;
  /** Seconds spent charging at all, summed. */
  qChargeTime: number;
  /** Longest pulse to land, in units from where he stood. */
  qLongest: number;

  wCasts: number;
  wHits: number;
  wCentre: number;

  eCasts: number;
  /** Orbs that reached a champion. */
  eHits: number;
  /** Orbs a minion took first. */
  eBlocked: number;
  /** Seconds of stun summed over champions. */
  eStunSum: number;
  /** Orbs that flew far enough to stun for at least a second and a half. */
  eLong: number;

  rCasts: number;
  rShots: number;
  rHits: number;

  /** Pulses and Eyes that landed on a champion held by a stun or a root. */
  followUps: number;
  attacksLanded: number;
}

const emptyStats = (): XerathStats => ({
  qCasts: 0,
  qHits: 0,
  qShort: 0,
  qFizzles: 0,
  qOverchargeSum: 0,
  qChargeTime: 0,
  qLongest: 0,
  wCasts: 0,
  wHits: 0,
  wCentre: 0,
  eCasts: 0,
  eHits: 0,
  eBlocked: 0,
  eStunSum: 0,
  eLong: 0,
  rCasts: 0,
  rShots: 0,
  rHits: 0,
  followUps: 0,
  attacksLanded: 0,
});

interface Orb {
  projectileId: number;
  from: Vec2;
}

interface RiteState {
  startedAt: number;
  endsAt: number;
  shotsLeft: number;
  nextShotAt: number;
}

/** How far a pulse charged for this long reaches. */
export const pulseRange = (held: number): number =>
  XERATH_STATS.qMinRange +
  (XERATH_STATS.qMaxRange - XERATH_STATS.qMinRange) * clamp(held / XERATH_STATS.qChargeTime, 0, 1);

/** How long a pulse has to charge to reach this far. */
export const chargeFor = (reach: number): number =>
  XERATH_STATS.qChargeTime *
  clamp((reach - XERATH_STATS.qMinRange) / (XERATH_STATS.qMaxRange - XERATH_STATS.qMinRange), 0, 1);

/** How long an orb that flew this far stuns for. */
export const orbStun = (travelled: number): number =>
  XERATH_STATS.eStunMin +
  (XERATH_STATS.eStunMax - XERATH_STATS.eStunMin) * clamp(travelled / XERATH_STATS.eRange, 0, 1);

export class XerathKit {
  readonly stats: XerathStats = emptyStats();
  readonly loadout: Required<XerathLoadout>;

  qCd = 0;
  wCd = 0;
  eCd = 0;
  rCd = 0;

  /** The pulse in the hand, if one is charging: when the press was. */
  charge: { startedAt: number } | null = null;
  /** Everything telegraphed and not yet landed. */
  readonly blasts: Blast[] = [];
  /** Everything that has landed, newest last, the last sixty-four of it. */
  readonly results: BlastResult[] = [];
  /**
   * How many blasts have landed, ever. A stage keeps its own count and reads
   * the difference off the end of `results` — by count rather than by blast
   * id, because blasts do not land in the order they were cast: an Eye thrown
   * before a pulse lands after it.
   */
  resolved = 0;
  /** The orb's last landing, for the stage that grades them. */
  lastOrb: { at: number; targetId: number; champion: boolean; stun: number; travelled: number } | null = null;
  /** The Rite, while he is in it. */
  rite: RiteState | null = null;

  private nextBlastId = 1;
  private orbs: Orb[] = [];
  /** When each enemy's orb stun ends, so a follow-up can be credited. */
  private stunnedUntil = new Map<number, number>();
  private readonly practice: Partial<Record<'q' | 'w' | 'e' | 'r', number>>;

  constructor(
    private readonly s: Session,
    loadout: XerathLoadout = { arcanopulse: true },
    practice: Partial<Record<'q' | 'w' | 'e' | 'r', number>> = {},
  ) {
    this.practice = practice;
    this.loadout = {
      arcanopulse: loadout.arcanopulse ?? false,
      eye: loadout.eye ?? false,
      orb: loadout.orb ?? false,
      rite: loadout.rite ?? false,
    };
  }

  /** Spawns the player as Xerath and returns him. */
  spawn(pos: Vec2): Actor {
    const p = this.s.world.spawnPlayer(pos, { ...XERATH_STATS.attack });
    p.maxHp = XERATH_STATS.hp;
    p.hp = XERATH_STATS.hp;
    p.moveSpeed = XERATH_STATS.moveSpeed;
    p.radius = XERATH_STATS.radius;
    p.label = 'XERATH';
    p.visual = 'xerath';
    return p;
  }

  /** The cooldown a slot is charged at on this stage. */
  cdOf(slot: 'q' | 'w' | 'e' | 'r'): number {
    const base = { q: XERATH_STATS.qCd, w: XERATH_STATS.wCd, e: XERATH_STATS.eCd, r: XERATH_STATS.rCd }[slot];
    return this.practice[slot] ?? base;
  }

  /** Seconds the pulse in the hand has been charging, or zero. */
  get held(): number {
    return this.charge ? this.s.world.time - this.charge.startedAt : 0;
  }

  /** How far the pulse in the hand would reach if it were let go now. */
  get reachNow(): number {
    return pulseRange(this.held);
  }

  /** True while he cannot do anything else: charging, or in the Rite. */
  get busy(): boolean {
    return this.charge !== null || this.rite !== null;
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    if (this.qCd > 0) this.qCd = Math.max(0, this.qCd - dt);
    if (this.wCd > 0) this.wCd = Math.max(0, this.wCd - dt);
    if (this.eCd > 0) this.eCd = Math.max(0, this.eCd - dt);
    if (this.rCd > 0) this.rCd = Math.max(0, this.rCd - dt);

    const p = this.s.world.player;
    const now = this.s.world.time;

    if (p && (!p.alive || (this.charge && now - this.charge.startedAt >= XERATH_STATS.qHoldLimit))) {
      if (this.charge) this.fizzle();
    }

    if (p) {
      if (this.charge) {
        this.stats.qChargeTime += dt;
        // Slower while it grows, and nothing else leaves his hands.
        const share = clamp(this.held / XERATH_STATS.qChargeTime, 0, 1);
        p.moveSpeed = XERATH_STATS.moveSpeed * (1 - XERATH_STATS.qSelfSlow * share);
        p.attackCd = Math.max(p.attackCd, 0.1);
        p.fireArmed = false;
      } else if (p.moveSpeed !== XERATH_STATS.moveSpeed) {
        p.moveSpeed = XERATH_STATS.moveSpeed;
      }
      if (this.rite) {
        p.rootedFor = Math.max(p.rootedFor, 0.12);
        p.attackCd = Math.max(p.attackCd, 0.1);
        p.fireArmed = false;
        p.order = null;
        const lastLands = this.blasts.some((b) => b.kind === 'r');
        if (now >= this.rite.endsAt || (this.rite.shotsLeft <= 0 && !lastLands)) this.rite = null;
      }
    }

    for (let i = 0; i < this.blasts.length; ) {
      const b = this.blasts[i];
      if (now >= b.firesAt) {
        this.blasts.splice(i, 1);
        this.resolve(b);
      } else i++;
    }

    for (let i = this.orbs.length - 1; i >= 0; i--) {
      if (this.s.world.projectiles.some((pr) => pr.id === this.orbs[i].projectileId)) continue;
      this.orbs.splice(i, 1);
    }
    for (const [id, until] of this.stunnedUntil) if (now > until) this.stunnedUntil.delete(id);
  }

  /** True if this body could not have walked out of something just now. */
  private isHeld(a: Actor): boolean {
    return a.rootedFor > 0.05 || (this.stunnedUntil.get(a.id) ?? -1) >= this.s.world.time;
  }

  private resolve(b: Blast): void {
    const p = this.s.world.player;
    const now = this.s.world.time;
    const champions: number[] = [];
    let minions = 0;
    let centre = false;
    let held = 0;
    let farthest = 0;
    let short = false;

    for (const a of this.s.world.actors) {
      if (!a.alive || a.team === 'player') continue;
      const reach = b.shape === 'line' ? distToSegment(a.pos, b.from, b.to) : dist(a.pos, b.to);
      if (reach > b.radius + a.radius) {
        // A pulse that was pointed at a champion and stopped before them: the
        // one miss that is the charge's fault rather than the aim's.
        if (b.kind === 'q' && !a.isMinion) {
          const d = norm(b.to.x - b.from.x, b.to.y - b.from.y);
          const rx = a.pos.x - b.from.x;
          const ry = a.pos.y - b.from.y;
          const along = rx * d.x + ry * d.y;
          const across = Math.abs(rx * d.y - ry * d.x);
          const len = dist(b.from, b.to);
          if (across <= b.radius + a.radius && along > len && along < len + 450) short = true;
        }
        continue;
      }
      let amount = b.kind === 'q' ? XERATH_STATS.qDamage : b.kind === 'r' ? XERATH_STATS.rDamage : XERATH_STATS.wDamage;
      const wasHeld = this.isHeld(a);
      if (b.kind === 'w') {
        const inCentre = dist(a.pos, b.to) <= XERATH_STATS.wCentre + a.radius;
        if (inCentre) amount *= 1 + XERATH_STATS.wCentreBonus;
        const slow = inCentre ? XERATH_STATS.wCentreSlow : XERATH_STATS.wSlow;
        a.slowFactor = Math.min(a.slowFactor, 1 - slow);
        a.slowFor = Math.max(a.slowFor, XERATH_STATS.wSlowFor);
        if (inCentre && !a.isMinion) centre = true;
      }
      this.s.world.damage(a, amount, p);
      if (a.isMinion) {
        minions++;
        continue;
      }
      champions.push(a.id);
      if (wasHeld) held++;
      farthest = Math.max(farthest, dist(b.origin, a.pos));
    }

    let overcharge = 0;
    if (b.kind === 'q') {
      this.stats.qCasts++;
      if (champions.length > 0) {
        this.stats.qHits++;
        this.stats.qLongest = Math.max(this.stats.qLongest, farthest);
        // What the hold cost beyond the reach that was used. Measured against
        // the farthest champion it caught, plus the width of a body, so a
        // pulse let go the moment it touched them owes nothing.
        overcharge = Math.max(0, b.charged - chargeFor(farthest + 40));
        this.stats.qOverchargeSum += overcharge;
      } else if (short) this.stats.qShort++;
    } else if (b.kind === 'w') {
      if (champions.length > 0) this.stats.wHits++;
      if (centre) this.stats.wCentre++;
    } else {
      this.stats.rShots++;
      if (champions.length > 0) this.stats.rHits++;
    }
    if (b.kind !== 'r' && held > 0) this.stats.followUps++;

    this.results.push({ blast: b, at: now, champions, minions, centre, held, short: champions.length === 0 && short, overcharge });
    if (this.results.length > 64) this.results.shift();
    this.resolved++;

    const color = b.kind === 'r' ? XER_VIOLET : XER_BLUE;
    if (b.shape === 'line') {
      this.s.fx.trace([{ ...b.from }, { ...b.to }], XER_CORE, 0.28, 10);
      this.s.fx.trace([{ ...b.from }, { ...b.to }], XER_BLUE, 0.4, 22);
    } else {
      this.s.fx.ring(b.to.x, b.to.y, 10, b.radius, 0.4, color, 5, 'shock');
      this.s.fx.burst(b.to.x, b.to.y, 18, { color, speed: 420, life: 0.35, size: 2.4 });
      if (centre) this.s.fx.ring(b.to.x, b.to.y, 4, XERATH_STATS.wCentre * 2, 0.35, XER_CORE, 4, 'impact');
    }
    if (champions.length > 0) this.s.fx.addShake(b.kind === 'r' ? 0.35 : 0.2);
    if (champions.length > 0 && p) audio.play(centre ? 'perfect' : 'attackLand', { pan: this.s.panOf(b.to) });
    else audio.play('hazardFire', { pan: this.s.panOf(b.to), intensity: 0.6 });
  }

  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    for (const e of events) {
      if (e.actorId !== pid || e.type !== 'attackLand') continue;
      const orb = e.meta !== undefined ? this.orbs.find((o) => o.projectileId === e.meta) : undefined;
      if (orb) this.onOrbLanded(orb, e);
      else this.stats.attacksLanded++;
    }
  }

  private onOrbLanded(orb: Orb, e: WorldEvent): void {
    const target = this.s.world.byId(e.targetId);
    const hitPos = e.pos ?? target?.pos;
    if (!target || !hitPos) return;
    const travelled = dist(orb.from, hitPos);
    const stun = orbStun(travelled);
    target.rootedFor = Math.max(target.rootedFor, stun);
    // A stun is not a root: whatever it was about to do is gone too.
    if (target.phase === 'windup') {
      target.phase = 'idle';
      target.phaseTime = 0;
      this.s.world.emit({ type: 'attackCancel', actorId: target.id, amount: 0 });
    }
    target.order = null;
    const now = this.s.world.time;
    this.stunnedUntil.set(target.id, now + stun);
    if (target.isMinion) {
      this.stats.eBlocked++;
      this.s.micro('BLOCKED', target.pos, PALETTE.warn);
    } else {
      this.stats.eHits++;
      this.stats.eStunSum += stun;
      if (stun >= 1.5) this.stats.eLong++;
      this.s.micro(`STUN ${stun.toFixed(1)}s`, target.pos, stun >= 1.5 ? PALETTE.good : XER_BLUE);
      this.s.fx.addShake(0.25);
    }
    this.lastOrb = { at: now, targetId: target.id, champion: !target.isMinion, stun, travelled };
    this.s.fx.ring(hitPos.x, hitPos.y, 6, 110, 0.45, XER_BLUE, 4, 'shock');
  }

  // ------------------------------------------------------------------ casts

  cast(slot: AbilitySlot, at: Vec2): XerathCastResult {
    switch (slot) {
      case 'q':
        return this.arcanopulse(at);
      case 'w':
        return this.eye(at);
      case 'e':
        return this.orb(at);
      case 'r':
        return this.riteCast(at);
      default:
        return 'locked';
    }
  }

  /** The key came up. Only the pulse cares. */
  release(slot: AbilitySlot, at: Vec2): void {
    if (slot === 'q' && this.charge) this.firePulse(at);
  }

  /**
   * Q — Arcanopulse.
   *
   * The first press starts the charge. Letting go of the key fires it — or,
   * without quick-cast, casting it again does. Either way the line goes where
   * the cursor is at the moment of release, as far as the charge has grown.
   */
  private arcanopulse(at: Vec2): XerathCastResult {
    if (!this.loadout.arcanopulse) return 'locked';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    if (this.charge) {
      this.firePulse(at);
      return 'cast';
    }
    if (this.rite || this.qCd > 0) return 'refused';
    this.charge = { startedAt: this.s.world.time };
    if (p.phase === 'windup') {
      p.phase = 'idle';
      p.phaseTime = 0;
      this.s.world.emit({ type: 'attackCancel', actorId: p.id, amount: 0 });
    }
    audio.play('castArm', { pan: this.s.panOf(p.pos) });
    return 'charging';
  }

  private firePulse(at: Vec2): void {
    const p = this.s.world.player;
    const c = this.charge;
    this.charge = null;
    if (!p || !c) return;
    const now = this.s.world.time;
    const reach = pulseRange(now - c.startedAt);
    let d = norm(at.x - p.pos.x, at.y - p.pos.y);
    if (d.x === 0 && d.y === 0) d = { x: Math.cos(p.facing), y: Math.sin(p.facing) };
    p.facing = Math.atan2(d.y, d.x);
    const from = { x: p.pos.x, y: p.pos.y };
    const to = { x: from.x + d.x * reach, y: from.y + d.y * reach };
    this.blasts.push({
      id: this.nextBlastId++,
      kind: 'q',
      shape: 'line',
      from,
      to,
      radius: XERATH_STATS.qHalfWidth,
      castAt: now,
      firesAt: now + XERATH_STATS.qDelay,
      origin: { ...from },
      charged: now - c.startedAt,
    });
    this.qCd = this.cdOf('q');
    p.moveSpeed = XERATH_STATS.moveSpeed;
    audio.play('castQ', { pan: this.s.panOf(p.pos) });
  }

  private fizzle(): void {
    const p = this.s.world.player;
    this.charge = null;
    this.stats.qFizzles++;
    this.qCd = this.cdOf('q') * (1 - XERATH_STATS.qFizzleRefund);
    if (p) {
      p.moveSpeed = XERATH_STATS.moveSpeed;
      this.s.micro('FIZZLED', p.pos, PALETTE.danger);
      this.s.fx.badFlash(0.14, PALETTE.danger);
      audio.play('castRefuse', { pan: this.s.panOf(p.pos) });
    }
  }

  /** A point within a cast range of him, along the line to the cursor. */
  private inReach(at: Vec2, range: number): Vec2 {
    const p = this.s.world.player as Actor;
    const g = dist(p.pos, at);
    if (g <= range) return { ...at };
    const d = norm(at.x - p.pos.x, at.y - p.pos.y);
    return { x: p.pos.x + d.x * range, y: p.pos.y + d.y * range };
  }

  /** W — Eye of Destruction: a circle under the cursor, three quarters of a second from now. */
  private eye(at: Vec2): XerathCastResult {
    if (!this.loadout.eye) return 'locked';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    if (this.busy || this.wCd > 0) return 'refused';
    const now = this.s.world.time;
    const to = this.inReach(at, XERATH_STATS.wRange);
    this.blasts.push({
      id: this.nextBlastId++,
      kind: 'w',
      shape: 'circle',
      from: { ...to },
      to,
      radius: XERATH_STATS.wRadius,
      castAt: now,
      firesAt: now + XERATH_STATS.wDelay,
      origin: { ...p.pos },
      charged: 0,
    });
    this.wCd = this.cdOf('w');
    this.stats.wCasts++;
    p.facing = Math.atan2(to.y - p.pos.y, to.x - p.pos.x);
    return 'cast';
  }

  /** E — Shocking Orb: a missile at the cursor, stopped by the first body it meets. */
  private orb(at: Vec2): XerathCastResult {
    if (!this.loadout.orb) return 'locked';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    if (this.busy || this.eCd > 0) return 'refused';
    let d = norm(at.x - p.pos.x, at.y - p.pos.y);
    if (d.x === 0 && d.y === 0) d = { x: Math.cos(p.facing), y: Math.sin(p.facing) };
    p.facing = Math.atan2(d.y, d.x);
    const shot = this.s.world.spawnProjectile({
      pos: { x: p.pos.x + d.x * p.radius, y: p.pos.y + d.y * p.radius },
      team: 'player',
      ownerId: p.id,
      vel: { x: d.x * XERATH_STATS.eSpeed, y: d.y * XERATH_STATS.eSpeed },
      speed: XERATH_STATS.eSpeed,
      damage: XERATH_STATS.eDamage,
      targetId: null,
      radius: XERATH_STATS.eRadius,
      shape: 'orb',
      color: XER_BLUE,
      maxLife: XERATH_STATS.eRange / XERATH_STATS.eSpeed,
    });
    this.orbs.push({ projectileId: shot.id, from: { ...p.pos } });
    this.eCd = this.cdOf('e');
    this.stats.eCasts++;
    return 'cast';
  }

  /**
   * R — Rite of the Arcane.
   *
   * The first press roots him and opens the volley; every press after it is a
   * shot at the cursor, no sooner than half a second after the one before.
   */
  private riteCast(at: Vec2): XerathCastResult {
    if (!this.loadout.rite) return 'locked';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    const now = this.s.world.time;
    if (this.rite) {
      const r = this.rite;
      if (r.shotsLeft <= 0 || now < r.nextShotAt) return 'refused';
      const to = this.inReach(at, XERATH_STATS.rRange);
      this.blasts.push({
        id: this.nextBlastId++,
        kind: 'r',
        shape: 'circle',
        from: { ...to },
        to,
        radius: XERATH_STATS.rRadius,
        castAt: now,
        firesAt: now + XERATH_STATS.rDelay,
        origin: { ...p.pos },
        charged: 0,
      });
      r.shotsLeft--;
      r.nextShotAt = now + XERATH_STATS.rRecast;
      audio.play('castR', { pan: this.s.panOf(to) });
      return 'cast';
    }
    if (this.charge || this.rCd > 0) return 'refused';
    this.rCd = this.cdOf('r');
    this.stats.rCasts++;
    this.rite = { startedAt: now, endsAt: now + XERATH_STATS.rChannel, shotsLeft: XERATH_STATS.rShots, nextShotAt: now + XERATH_STATS.rRecast };
    if (p.phase === 'windup') {
      p.phase = 'idle';
      p.phaseTime = 0;
      this.s.world.emit({ type: 'attackCancel', actorId: p.id, amount: 0 });
    }
    p.order = null;
    p.vel.x = 0;
    p.vel.y = 0;
    this.s.fx.ring(p.pos.x, p.pos.y, p.radius, p.radius + 160, 0.6, XER_VIOLET, 5, 'shock');
    return 'cast';
  }

  // -------------------------------------------------------------------- ui

  bar(base: AbilityView[]): AbilityView[] {
    return base.map((a) => {
      switch (a.slot) {
        case 'q':
          return this.loadout.arcanopulse
            ? { ...a, name: 'ARCANOPULSE', locked: false, highlight: this.charge !== null, cd: clamp(this.qCd / this.cdOf('q'), 0, 1) }
            : a;
        case 'w':
          return this.loadout.eye ? { ...a, name: 'EYE OF DESTRUCTION', locked: false, cd: clamp(this.wCd / this.cdOf('w'), 0, 1) } : a;
        case 'e':
          return this.loadout.orb ? { ...a, name: 'SHOCKING ORB', locked: false, cd: clamp(this.eCd / this.cdOf('e'), 0, 1) } : a;
        case 'r':
          return this.loadout.rite
            ? {
                ...a,
                name: 'RITE OF THE ARCANE',
                locked: false,
                highlight: this.rite !== null,
                // Inside the Rite the bar shows the volley, not the cooldown.
                cd: this.rite ? 0 : clamp(this.rCd / this.cdOf('r'), 0, 1),
              }
            : a;
        default:
          return a;
      }
    });
  }

  /** Was that missile one of his orbs? */
  wasOrb(projectileId: number): boolean {
    return this.orbs.some((o) => o.projectileId === projectileId);
  }

  /** Pulses that landed on a champion, of those that finished. */
  get pulseRate(): number {
    return this.stats.qCasts > 0 ? this.stats.qHits / this.stats.qCasts : 0;
  }

  /** Average seconds held past need, over pulses that landed. */
  get overcharge(): number {
    return this.stats.qHits > 0 ? this.stats.qOverchargeSum / this.stats.qHits : 0;
  }

  get eyeRate(): number {
    return this.stats.wCasts > 0 ? this.stats.wHits / this.stats.wCasts : 0;
  }

  get centreRate(): number {
    return this.stats.wCasts > 0 ? this.stats.wCentre / this.stats.wCasts : 0;
  }

  get orbRate(): number {
    return this.stats.eCasts > 0 ? this.stats.eHits / this.stats.eCasts : 0;
  }

  /** Average stun per orb that reached a champion. */
  get stunAvg(): number {
    return this.stats.eHits > 0 ? this.stats.eStunSum / this.stats.eHits : 0;
  }

  get riteRate(): number {
    return this.stats.rShots > 0 ? this.stats.rHits / this.stats.rShots : 0;
  }
}
