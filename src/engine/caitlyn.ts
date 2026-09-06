/**
 * The Sheriff of Piltover's kit — the other side of the fight.
 *
 * Every champion the trainer has modelled so far is a champion it hands
 * *you*. This one it points at you, and that changes what a kit has to be.
 * A playable kit answers "what does this button cost me"; an opponent's kit
 * answers "what am I being asked to read, and how long have I got" — so every
 * ability here is written telegraph-first, with the window it gives you stated
 * as a number rather than left to feel about right.
 *
 * She is the right champion to be on the other end of a dodging drill for four
 * reasons, and they are the four buttons:
 *
 *  - **Q Piltover Peacemaker** is a long, wide, slow-committing line. It is
 *    aimed *before* it is fired, so it is beatable by one movement made early
 *    and unbeatable by five made late. That single sentence is the whole
 *    skill this mode exists to build.
 *  - **W Yordle Snap Trap** deals no damage at all, exactly as in League. It
 *    takes your feet away for a second and a quarter and hands her a free
 *    headshot — so the cost of stepping in one is never the trap, it is the
 *    Q you can no longer dodge. That is the honest lesson about ground
 *    control and it cannot be taught by something that merely hurts.
 *  - **E 90 Caliber Net** is the short-range answer to walking at her: it
 *    slows you, marks you, and throws her backwards out of your reach. It is
 *    what makes closing the gap a decision rather than a formality.
 *  - **R Ace in the Hole** is a lock-on. Nothing you do with your feet beats
 *    it; the only answer is terrain between the two of you before the channel
 *    ends. It is the one ability in the trainer whose dodge is a *position*.
 *
 * The kit owns her abilities and nothing else. Her feet are an `EnemyBrain`
 * like any other bot's, her body is an ordinary `Actor`, and the drill that
 * fields her decides how hard she is and what happens when she dies. Where
 * League's own number is knowable it is used and cited; where it depends on
 * items, levels or runes, the figure here stands for one specific Caitlyn and
 * says which.
 */
import { audio } from './audio';
import { clamp, dist, norm } from './math';
import type { DrillPaint } from './paint';
import { PALETTE } from './palette';
import type { Session } from './session';
import type { Actor, Vec2 } from './types';
import type { WorldEvent } from './world';

/** Piltover gold. Her livery, her telegraphs and her card, all one colour. */
export const CAITLYN_COLOR = '#ffb02e';
/** The trap's own colour: a different warning from the one you can outrun. */
export const CAITLYN_TRAP = '#ff7ad9';
/** The ultimate's beam. Deliberately the loudest thing on the floor. */
export const CAITLYN_ACE = '#ff4d6d';

/**
 * The Sheriff, in numbers.
 *
 * League's figures where League has one: the attack range, the missile ranges
 * and widths, the cast and channel times, the trap's arming delay and root,
 * the net's slow, the headshot counter. The cooldowns are League's too — and
 * then divided, once, by `practiceShare`, for the reason given there.
 */
export const CAITLYN_STATS = {
  /**
   * A level 9 Caitlyn's health pool. League's base is 580 growing ~107 a
   * level. The drill scales nothing about this: an opponent who gets harder by
   * getting fatter is the one thing the AI in this trainer has never done.
   */
  hp: 1440,
  /** League: 325 base movement speed. */
  moveSpeed: 325,
  radius: 28,
  attack: {
    /**
     * League: 0.681 base. This is a level 9 Caitlyn with a first item, which
     * is the Caitlyn a laner actually meets.
     */
    attackSpeed: 0.85,
    /** League: her attack windup is a quarter of the cycle. */
    windupRatio: 0.25,
    backswingRatio: 0.28,
    /** League: 650, the longest basic attack range in the game bar none. */
    range: 650,
    /**
     * Deliberately below what a level 9 Caitlyn's attack is worth.
     *
     * This is the one place her numbers are bent, and the reason is the mode:
     * a Sheriff whose basic attacks out-damage her whole kit is an opponent
     * you lose to by standing in the wrong place rather than by failing to
     * dodge, and the drill would then be scoring a spacing mistake through a
     * dodging metric. Two thirds of what she is worth in a real lane leaves
     * the auto as pressure and the abilities as the thing that kills you,
     * which is the ledger the results screen is about to print.
     */
    damage: 24,
    /** League: her attack missile travels at 2500. */
    projectileSpeed: 2500,
    projectileColor: CAITLYN_COLOR,
  },

  // --------------------------------------------------------------- passive
  /**
   * Headshot. League: every sixth basic attack against the same target — or
   * the first attack on a trapped or netted one — lands for bonus damage.
   *
   * It is here because it is the price of standing in her range doing nothing:
   * the counter runs whether or not you are paying attention, and a trap turns
   * it from a sixth attack into the next one.
   */
  headshotEvery: 6,
  /** How much more a headshot lands for, as a share of the basic attack. */
  headshotBonus: 1.4,

  // --------------------------------------------------------------------- Q
  /** League: 1250 range, 90 units wide, 2200 missile speed. */
  qRange: 1250,
  qWidth: 90,
  qSpeed: 2200,
  /**
   * League: 0.625s of cast time, during which she is rooted and the direction
   * is already locked. This is the window, and the whole mode is built on the
   * fact that it is a real one — long enough to beat, short enough that you
   * have to start moving on the telegraph rather than on the missile.
   */
  qCast: 0.625,
  /** League: 10 seconds at one point in Q. */
  qCd: 10,
  /** A level 9 Caitlyn's Q, roughly. It hurts; it is not meant to kill. */
  qDamage: 132,

  // --------------------------------------------------------------------- W
  /** League: placed up to 800 units away, arms in one second, lasts 30. */
  wRange: 800,
  wArm: 1.0,
  /** League: the trap's own radius. */
  wRadius: 78,
  /**
   * League: 30 seconds on the floor. Twelve here, and at most three at a time,
   * because a minute-long rep carpeted in permanent traps stops being a floor
   * you have to read and becomes a floor you cannot use.
   */
  wLife: 12,
  wMax: 3,
  /** League: the snare is 1.5 seconds. */
  wRoot: 1.25,
  /** League: 20 seconds at one point in W. */
  wCd: 20,

  // --------------------------------------------------------------------- E
  /** League: 750 range, 1600 missile speed, 60 units wide. */
  eRange: 750,
  eSpeed: 1600,
  eWidth: 60,
  /** League: a 50% slow decaying over one second. */
  eSlow: 0.5,
  eSlowFor: 1.0,
  /** League: it throws her 390 units in the opposite direction. */
  eSelfPush: 390,
  eSelfSpeed: 1100,
  eDamage: 80,
  /** League: 16 seconds at one point in E. */
  eCd: 16,

  // --------------------------------------------------------------------- R
  /** League: 2000 range at one point in R. */
  rRange: 2000,
  /**
   * League: a one second channel, and then a missile that cannot miss.
   *
   * The channel is here in full and the missile is not: it resolves the
   * instant the channel ends, and the line of sight question is asked exactly
   * once, at that moment. That is a deliberate simplification and it makes the
   * ability *harder* to answer rather than easier — a flight time would be a
   * second window and a second chance, and the read this teaches is that the
   * wall has to be found during the channel or not at all.
   */
  rChannel: 1.0,
  rDamage: 300,
  /** League: 90 seconds at one point in R. Practice cuts it, see below. */
  rCd: 90,

  /**
   * The share of League's cooldown every ability on this list actually pays.
   *
   * The same decision the Vayne path makes about Condemn, made for the same
   * reason and in the other direction. A minute against a Caitlyn on League's
   * literal cooldowns is six Peacemakers, three traps and no ultimate at all —
   * which is a fair fight and a useless drill, because the thing being trained
   * is the dodge and you cannot practise six of anything. At 45% it is a
   * dozen Qs, a trap every nine seconds and two ultimates a minute: still her
   * kit, still her windows, at the density a rep needs.
   */
  practiceShare: 0.45,
} as const;

/** What the mode scores. Everything is counted where it happens: here. */
export interface CaitlynStats {
  /** Peacemakers thrown, and how many of them missed. */
  qCasts: number;
  qDodged: number;
  qHits: number;
  /** Qs dodged while she was aiming at a body that could not move — free. */
  qFreeHits: number;

  trapsPlaced: number;
  /** Traps that armed and then expired without ever taking your feet. */
  trapsAvoided: number;
  trapsTriggered: number;

  netCasts: number;
  netDodged: number;
  netHits: number;

  /** Ultimates started, and how each of them ended. */
  aceCasts: number;
  /** Channels that found terrain between the two of you before landing. */
  aceBlocked: number;
  aceHits: number;

  /** Headshots landed on you. The cost of standing in 650 units of range. */
  headshots: number;
  /** Everything she has taken off you, autos and abilities together. */
  damageDealt: number;
  /**
   * The dodge ledger, and it is deliberately narrower than the one above.
   *
   * `threatDamage` is what her *dodgeable* abilities aimed at you — the
   * Peacemaker, the net and the ultimate — and `dodgeableTaken` is how much of
   * it arrived. Basic attacks and headshots are in neither, because nothing
   * you do with your feet stops a basic attack once you are in her range:
   * counting them would fold a spacing mistake into a dodging number and make
   * the one figure the mode leads with mean two different things at once.
   */
  threatDamage: number;
  dodgeableTaken: number;
}

const emptyStats = (): CaitlynStats => ({
  qCasts: 0,
  qDodged: 0,
  qHits: 0,
  qFreeHits: 0,
  trapsPlaced: 0,
  trapsAvoided: 0,
  trapsTriggered: 0,
  netCasts: 0,
  netDodged: 0,
  netHits: 0,
  aceCasts: 0,
  aceBlocked: 0,
  aceHits: 0,
  headshots: 0,
  damageDealt: 0,
  threatDamage: 0,
  dodgeableTaken: 0,
});

/**
 * The net's own cast time.
 *
 * Not one of League's numbers — hers is effectively instant — and short on
 * purpose: the net is meant to be answered by not standing next to her rather
 * than by reacting to it, so it gets just enough of a tell to be visible and
 * not enough to be dodged on sight.
 */
const NET_CAST = 0.15;

/** A trap on the floor, arming or armed. */
export interface SnapTrap {
  id: number;
  pos: Vec2;
  /** Seconds left before it can catch anything. */
  arm: number;
  /** Seconds left on the floor. */
  life: number;
  sprung: boolean;
}

/** A missile of hers the kit is still waiting to hear about. */
interface Shot {
  id: number;
  slot: 'q' | 'e';
  /** True when it was aimed at a player who was already unable to move. */
  free: boolean;
}

/** Which button she is in the middle of, and how much of it is left. */
export type CaitlynCastSlot = 'q' | 'e' | 'r';

/**
 * A committed cast, exposed because it *is* the telegraph.
 *
 * Everything a player is entitled to know while a window is open lives on this
 * object — which button, which way, how long is left — so the drill's paint
 * pass, the HUD and the headless reference player all read the same record of
 * it rather than three separate inferences about what she might be doing.
 */
export interface CaitlynCast {
  slot: CaitlynCastSlot;
  /** Locked at the press. Nothing about the aim changes after this. */
  dir: Vec2;
  /** The point the telegraph is drawn to. */
  to: Vec2;
  left: number;
  total: number;
  /** Only R keeps a victim: it is a lock-on, not a skillshot. */
  lockId: number | null;
  free: boolean;
}

/** How the mode wants her to behave. Everything else is her own. */
export interface CaitlynLoadout {
  peacemaker?: boolean;
  trap?: boolean;
  net?: boolean;
  ace?: boolean;
}

/**
 * League's cooldown for one of her abilities, as this trainer charges it.
 *
 * Exported because the practice screen prints both numbers, and a screen that
 * quoted a figure the simulation did not use would be the one dishonest thing
 * on it.
 */
export const caitlynCd = (leagueCd: number): number =>
  Math.round(leagueCd * CAITLYN_STATS.practiceShare * 10) / 10;

export class CaitlynKit {
  readonly stats: CaitlynStats = emptyStats();
  readonly loadout: Required<CaitlynLoadout>;

  /** Her body, once a drill has handed her one. Null while she is reloading. */
  actor: Actor | null = null;

  qCd = 0;
  wCd = 0;
  eCd = 0;
  rCd = 0;

  /** Live traps, in placement order. */
  readonly traps: SnapTrap[] = [];
  /** The cast she is committed to, or null. */
  cast: CaitlynCast | null = null;

  private shots: Shot[] = [];
  private trapId = 1;
  /** Basic attacks landed on the current target, for the headshot counter. */
  private hsCount = 0;
  /** Set by a trap or a net: the next attack is a headshot whatever the count. */
  private hsPrimed = false;
  /** Seconds until she is allowed to consider pressing anything again. */
  private decisionCd = 0;
  /** True once she has been on the floor at least once this run. */
  private deployed = false;
  /**
   * How well she leads a moving target, 0..1, and how long she takes to
   * notice a change. Both come from the drill's difficulty, and they are the
   * *only* things it is allowed to change — she throws the same number of
   * Peacemakers at every setting, which is what keeps a dodge rate set on one
   * difficulty comparable with a dodge rate set on another.
   */
  lead = 0.6;
  reaction = 0.22;

  constructor(
    private readonly s: Session,
    loadout: CaitlynLoadout = { peacemaker: true, trap: true, net: true, ace: true },
  ) {
    this.loadout = {
      peacemaker: loadout.peacemaker ?? false,
      trap: loadout.trap ?? false,
      net: loadout.net ?? false,
      ace: loadout.ace ?? false,
    };
  }

  // ------------------------------------------------------------------ body

  /**
   * Dress an ordinary bot as the Sheriff.
   *
   * The drill spawns the body and the brain — that plumbing belongs to the
   * drill base and is the same for every opponent in the trainer — and this
   * turns it into her: her numbers, her silhouette, her name over the bar. The
   * archetype it was spawned as stops mattering the moment this runs, except
   * that its brain is still the thing walking her around.
   */
  attach(a: Actor): Actor {
    this.actor = a;
    a.maxHp = CAITLYN_STATS.hp;
    a.hp = CAITLYN_STATS.hp;
    a.moveSpeed = CAITLYN_STATS.moveSpeed;
    a.radius = CAITLYN_STATS.radius;
    a.attack = { ...CAITLYN_STATS.attack };
    a.label = 'CAITLYN';
    a.visual = 'caitlyn';
    this.hsCount = 0;
    this.hsPrimed = false;
    // What is up when she arrives.
    //
    // Nothing, on the first body: an opponent who opens a rep with her whole
    // kit is testing your reflexes at second zero and your patience
    // afterwards, so she earns the first Peacemaker like anybody else.
    //
    // On a later body these are floors rather than values, and the difference
    // matters twice. Her cooldowns keep running while she is off the floor, as
    // League's do, so a fresh body must never *shorten* one — otherwise
    // putting her down would hand you her ultimate sooner and the offensive
    // half of the mode would be punishing the player for playing it. And she
    // still needs a moment on re-entry, because a Peacemaker fired on the
    // frame she reappears eight hundred units away is a telegraph nobody was
    // looking at yet.
    if (!this.deployed) {
      this.deployed = true;
      this.qCd = 1.4;
      this.wCd = 3.5;
      this.eCd = 6;
      this.rCd = 14;
    } else {
      this.qCd = Math.max(this.qCd, 1.4);
      this.wCd = Math.max(this.wCd, 2);
      this.eCd = Math.max(this.eCd, 2.5);
      this.rCd = Math.max(this.rCd, 8);
    }
    return a;
  }

  /** True while she is rooted mid-cast — the window you are being given. */
  get casting(): boolean {
    return this.cast !== null;
  }

  /** Whichever cooldown a HUD wants to lead with: the Peacemaker's. */
  get peacemakerCd(): number {
    return this.qCd;
  }

  // ----------------------------------------------------------------- frame

  /** Called from the drill's `update`, i.e. before the world steps. */
  update(dt: number): void {
    const me = this.actor;
    const player = this.s.world.player;
    if (this.qCd > 0) this.qCd = Math.max(0, this.qCd - dt);
    if (this.wCd > 0) this.wCd = Math.max(0, this.wCd - dt);
    if (this.eCd > 0) this.eCd = Math.max(0, this.eCd - dt);
    if (this.rCd > 0) this.rCd = Math.max(0, this.rCd - dt);
    if (this.decisionCd > 0) this.decisionCd = Math.max(0, this.decisionCd - dt);

    this.stepTraps(dt, player);
    this.reapShots();

    if (!me || !me.alive) {
      // A dead Caitlyn does not finish her cast. The traps stay: they are on
      // the floor, not in her hands, which is exactly why they are the part of
      // her kit that outlives her.
      this.cast = null;
      return;
    }
    if (!player || !player.alive) {
      this.cast = null;
      return;
    }

    if (this.cast) {
      this.stepCast(dt, me, player);
      return;
    }
    this.decide(dt, me, player);
  }

  /**
   * The committed part of a cast.
   *
   * She is rooted for it and her attack timer is held down for it, so a cast
   * is a real thing she spends rather than a free extra. That matters twice
   * over in a dodge drill: it is why the telegraph is trustworthy, and it is
   * why walking *at* her during a Peacemaker is a punish rather than a death
   * wish.
   */
  private stepCast(dt: number, me: Actor, player: Actor): void {
    const c = this.cast;
    if (!c) return;
    c.left = Math.max(0, c.left - dt);
    me.rootedFor = Math.max(me.rootedFor, c.left);
    me.attackCd = Math.max(me.attackCd, c.left);
    me.facing = Math.atan2(c.dir.y, c.dir.x);
    if (c.left > 0) return;
    this.cast = null;
    switch (c.slot) {
      case 'q':
        this.firePeacemaker(me, c);
        break;
      case 'e':
        this.fireNet(me, c);
        break;
      case 'r':
        this.fireAce(me, c, player);
        break;
    }
  }

  /**
   * What she does next.
   *
   * The order is a real Caitlyn's, and every line of it is a situation the
   * player is meant to learn to recognise:
   *
   *  1. Somebody who cannot move is somebody who cannot dodge, so a rooted or
   *     netted target gets the Peacemaker immediately. This is the punish the
   *     trap exists to set up, and it is why a trap is never "only a root".
   *  2. Somebody standing on top of her gets the net and the 390 units of
   *     ground it buys her back.
   *  3. The ultimate goes out when it is up and she has line of sight, because
   *     the answer to it is terrain and terrain is always available.
   *  4. Otherwise: a Peacemaker on cooldown, and a trap on the floor between
   *     reps.
   */
  private decide(dt: number, me: Actor, player: Actor): void {
    void dt;
    if (this.decisionCd > 0) return;
    if (!this.s.world.canSee(me.team, player)) return;
    const d = dist(me.pos, player.pos);
    const pinned = player.rootedFor > 0 || player.slowFor > 0;

    // Each of these returns false when it refuses itself — no angle, no line
    // of sight, nowhere to put the trap — and the list falls through to the
    // next option rather than standing there. A champion who spends a frame
    // deciding not to do something should spend it doing something else.
    if (this.loadout.peacemaker && this.qCd <= 0 && pinned && d < CAITLYN_STATS.qRange) {
      if (this.startPeacemaker(me, player, true)) return;
    }
    if (this.loadout.net && this.eCd <= 0 && d < CAITLYN_STATS.eRange * 0.62) {
      if (this.startNet(me, player)) return;
    }
    if (this.loadout.ace && this.rCd <= 0 && d < CAITLYN_STATS.rRange) {
      if (this.startAce(me, player)) return;
    }
    if (this.loadout.peacemaker && this.qCd <= 0 && d < CAITLYN_STATS.qRange * 0.92) {
      if (this.startPeacemaker(me, player, false)) return;
    }
    if (this.loadout.trap && this.wCd <= 0 && d < CAITLYN_STATS.wRange) {
      this.placeTrap(me, player);
    }
  }

  // -------------------------------------------------------------------- Q

  /**
   * Where a shot at a moving target is pointed.
   *
   * The lead is the difficulty knob, and it is the honest one. Same window,
   * same telegraph, same number of casts at every setting — a harder Sheriff
   * simply reads you better, which is what a harder opponent means everywhere
   * else in this engine too.
   *
   * The horizon it reads over is the whole commitment, cast time included, and
   * that is the entire reason a high-level Caitlyn is hard to dodge. Her
   * direction locks the instant she presses, so a shot aimed only at where the
   * missile will find you is beaten by any sidestep at all. A shot aimed at
   * where you will be in six tenths of a second plus flight is aimed at the
   * dodge you were *already making when she pressed* — so the answer stops
   * being "move" and becomes "do not be predictable before the lane appears,
   * and change what you are doing once it has". That is the skill, and it is
   * the one thing that should separate a difficulty from the one below it.
   */
  private aimAt(from: Vec2, player: Actor, travel: number, commit: number): Vec2 {
    const flight = dist(from, player.pos) / Math.max(1, travel);
    const t = commit + flight + this.reaction * (1 - this.lead);
    return {
      x: player.pos.x + player.vel.x * t * this.lead,
      y: player.pos.y + player.vel.y * t * this.lead,
    };
  }

  private startPeacemaker(me: Actor, player: Actor, free: boolean): boolean {
    const aim = this.aimAt(me.pos, player, CAITLYN_STATS.qSpeed, CAITLYN_STATS.qCast);
    const dir = norm(aim.x - me.pos.x, aim.y - me.pos.y);
    if (dir.x === 0 && dir.y === 0) return false;
    this.qCd = caitlynCd(CAITLYN_STATS.qCd);
    this.decisionCd = 0.35;
    this.stats.qCasts++;
    this.stats.threatDamage += CAITLYN_STATS.qDamage;
    this.cast = {
      slot: 'q',
      dir,
      to: { x: me.pos.x + dir.x * CAITLYN_STATS.qRange, y: me.pos.y + dir.y * CAITLYN_STATS.qRange },
      left: CAITLYN_STATS.qCast,
      total: CAITLYN_STATS.qCast,
      lockId: null,
      free,
    };
    audio.play('enemyCast', { intensity: 0.9, pan: this.s.panOf(me.pos) });
    this.s.fx.ring(me.pos.x, me.pos.y, me.radius, me.radius + 46, CAITLYN_STATS.qCast, CAITLYN_COLOR, 3, 'pulse');
    return true;
  }

  private firePeacemaker(me: Actor, c: CaitlynCast): void {
    const p = this.s.world.spawnProjectile({
      pos: { ...me.pos },
      team: me.team,
      ownerId: me.id,
      vel: { x: c.dir.x * CAITLYN_STATS.qSpeed, y: c.dir.y * CAITLYN_STATS.qSpeed },
      speed: CAITLYN_STATS.qSpeed,
      damage: CAITLYN_STATS.qDamage,
      radius: CAITLYN_STATS.qWidth / 2,
      // League's Q pierces everything in the line. Here it matters for one
      // reason beyond fidelity: a missile that is never consumed by the first
      // body it touches is a missile whose whole flight is a dodge window.
      pierce: true,
      shape: 'wave',
      maxLife: CAITLYN_STATS.qRange / CAITLYN_STATS.qSpeed + 0.05,
      color: CAITLYN_COLOR,
    });
    this.shots.push({ id: p.id, slot: 'q', free: c.free });
    audio.play('hazardFire', { intensity: 0.9, pan: this.s.panOf(me.pos) });
  }

  // -------------------------------------------------------------------- W

  /**
   * Where a trap goes.
   *
   * Never under her own feet and never quite under yours: a trap dropped on a
   * standing target is a coin flip, and one dropped where a standing target is
   * about to be is a read. So she alternates between the ground you are
   * walking onto and the ground behind you — the two places a real Caitlyn
   * puts them, and between them they cover both halves of the habit: watch
   * where you are going, and do not back into what you have already passed.
   */
  private placeTrap(me: Actor, player: Actor): void {
    const v = Math.hypot(player.vel.x, player.vel.y);
    // Standing still is its own answer: a real Caitlyn drops one straight
    // under a target who is not going anywhere, and so does this one. It is
    // the cheapest lesson in the mode — being stationary in front of her is
    // not neutral, it is a decision, and it is the wrong one.
    const dir = v > 20 ? norm(player.vel.x, player.vel.y) : { x: 0, y: 0 };
    const reach = dir.x === 0 && dir.y === 0 ? 0 : this.s.rng.chance(0.62) ? 150 + this.lead * 130 : -170;
    const at = {
      x: clamp(player.pos.x + dir.x * reach, 60, this.s.world.bounds.w - 60),
      y: clamp(player.pos.y + dir.y * reach, 60, this.s.world.bounds.h - 60),
    };
    if (dist(me.pos, at) > CAITLYN_STATS.wRange) return;

    this.wCd = caitlynCd(CAITLYN_STATS.wCd);
    this.decisionCd = 0.5;
    this.stats.trapsPlaced++;
    this.traps.push({ id: this.trapId++, pos: at, arm: CAITLYN_STATS.wArm, life: CAITLYN_STATS.wLife, sprung: false });
    // Oldest first: League caps how many are on the floor, and a cap that
    // silently dropped the newest one would make the ability worse the more
    // she used it.
    while (this.traps.length > CAITLYN_STATS.wMax) this.traps.shift();
    audio.play('enemyCast', { intensity: 0.6, pan: this.s.panOf(at) });
    this.s.fx.ring(at.x, at.y, 6, CAITLYN_STATS.wRadius, CAITLYN_STATS.wArm, CAITLYN_TRAP, 2.5, 'pulse');
  }

  private stepTraps(dt: number, player: Actor | undefined): void {
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const t = this.traps[i];
      if (t.arm > 0) t.arm = Math.max(0, t.arm - dt);
      t.life -= dt;
      if (t.life <= 0 || t.sprung) {
        // A trap that ran its full twelve seconds without catching anybody is
        // ground you successfully refused to walk on, and it is counted as
        // such — otherwise the only trap that ever appears in a score is the
        // one you stepped in, and avoiding them would be worth nothing.
        if (!t.sprung) this.stats.trapsAvoided++;
        this.traps.splice(i, 1);
        continue;
      }
      if (!player || !player.alive || t.arm > 0) continue;
      if (dist(t.pos, player.pos) > CAITLYN_STATS.wRadius + player.radius) continue;
      this.spring(t, player);
      this.traps.splice(i, 1);
    }
  }

  /**
   * Stepping in one.
   *
   * No damage, exactly as in League. What it costs is the second and a
   * quarter you cannot move and the headshot she now has in hand — and the
   * Peacemaker that follows, which `decide` throws at a rooted target on its
   * very next look. The trap is not the punishment. The trap is the setup.
   */
  private spring(t: SnapTrap, player: Actor): void {
    t.sprung = true;
    this.stats.trapsTriggered++;
    this.hsPrimed = true;
    player.rootedFor = Math.max(player.rootedFor, CAITLYN_STATS.wRoot);
    audio.play('fail', { intensity: 0.8, pan: this.s.panOf(t.pos) });
    this.s.fx.ring(t.pos.x, t.pos.y, CAITLYN_STATS.wRadius, 18, 0.35, CAITLYN_TRAP, 4, 'shock');
    this.s.micro('TRAPPED', player.pos, CAITLYN_TRAP);
    this.s.fx.addFlash(0.07, CAITLYN_TRAP);
  }

  // -------------------------------------------------------------------- E

  private startNet(me: Actor, player: Actor): boolean {
    const aim = this.aimAt(me.pos, player, CAITLYN_STATS.eSpeed, NET_CAST);
    const dir = norm(aim.x - me.pos.x, aim.y - me.pos.y);
    if (dir.x === 0 && dir.y === 0) return false;
    this.eCd = caitlynCd(CAITLYN_STATS.eCd);
    this.decisionCd = 0.3;
    this.stats.netCasts++;
    this.stats.threatDamage += CAITLYN_STATS.eDamage;
    this.cast = {
      slot: 'e',
      dir,
      to: { x: me.pos.x + dir.x * CAITLYN_STATS.eRange, y: me.pos.y + dir.y * CAITLYN_STATS.eRange },
      // Short, because it is a panic button and a panic button you can walk
      // out of is not one. It is beaten by not being there, not by reacting.
      left: NET_CAST,
      total: NET_CAST,
      lockId: null,
      free: player.rootedFor > 0,
    };
    audio.play('castE', { intensity: 0.7, pan: this.s.panOf(me.pos) });
    return true;
  }

  private fireNet(me: Actor, c: CaitlynCast): void {
    const p = this.s.world.spawnProjectile({
      pos: { ...me.pos },
      team: me.team,
      ownerId: me.id,
      vel: { x: c.dir.x * CAITLYN_STATS.eSpeed, y: c.dir.y * CAITLYN_STATS.eSpeed },
      speed: CAITLYN_STATS.eSpeed,
      damage: CAITLYN_STATS.eDamage,
      radius: CAITLYN_STATS.eWidth / 2,
      pierce: true,
      shape: 'orb',
      maxLife: CAITLYN_STATS.eRange / CAITLYN_STATS.eSpeed + 0.05,
      effect: { slow: { factor: 1 - CAITLYN_STATS.eSlow, dur: CAITLYN_STATS.eSlowFor } },
      color: CAITLYN_COLOR,
    });
    this.shots.push({ id: p.id, slot: 'e', free: c.free });
    // And the half of the ability that is about her rather than you: it throws
    // her backwards out of whatever just walked into her. Clipped to terrain,
    // so a net cast with her back to a wall buys her nothing.
    const back = { x: -c.dir.x, y: -c.dir.y };
    const room = this.s.world.terrainAlong(me.pos, back, CAITLYN_STATS.eSelfPush, me.radius);
    this.s.world.dash(me, back, room.distance, CAITLYN_STATS.eSelfSpeed);
  }

  // -------------------------------------------------------------------- R

  private startAce(me: Actor, player: Actor): boolean {
    // Never opened into a wall. She is choosing to spend ninety seconds of
    // cooldown, and a lock-on thrown at somebody already behind terrain is a
    // cast she would have to be blind to make.
    if (!this.lineOfSight(me.pos, player.pos)) return false;
    this.rCd = caitlynCd(CAITLYN_STATS.rCd);
    this.decisionCd = 0.6;
    this.stats.aceCasts++;
    this.stats.threatDamage += CAITLYN_STATS.rDamage;
    const dir = norm(player.pos.x - me.pos.x, player.pos.y - me.pos.y);
    this.cast = {
      slot: 'r',
      dir,
      to: { ...player.pos },
      left: CAITLYN_STATS.rChannel,
      total: CAITLYN_STATS.rChannel,
      lockId: player.id,
      free: false,
    };
    audio.play('castR', { intensity: 1.1, pan: this.s.panOf(me.pos) });
    this.s.setBanner('ACE IN THE HOLE', 1.1);
    this.s.fx.addFlash(0.05, CAITLYN_ACE);
    return true;
  }

  /**
   * The lock-on lands.
   *
   * Nothing about where you are standing saves you and nothing about how fast
   * you moved does either — the only question the ability ever asks is whether
   * there is terrain on the line at the moment it arrives. That is deliberate:
   * every other dodge in this mode is a movement, and exactly one of them is a
   * *place*, which is the read a player has to build separately.
   */
  private fireAce(me: Actor, c: CaitlynCast, player: Actor): void {
    const victim = this.s.world.byId(c.lockId ?? -1) ?? player;
    if (!victim.alive) return;
    if (!this.lineOfSight(me.pos, victim.pos)) {
      this.stats.aceBlocked++;
      this.s.micro('BLOCKED', victim.pos, PALETTE.good);
      audio.play('nearMiss', { intensity: 1.2, pan: this.s.panOf(victim.pos) });
      this.s.fx.ring(victim.pos.x, victim.pos.y, 20, 150, 0.45, PALETTE.good, 3, 'shock');
      return;
    }
    this.stats.aceHits++;
    this.stats.damageDealt += CAITLYN_STATS.rDamage;
    this.stats.dodgeableTaken += CAITLYN_STATS.rDamage;
    this.s.world.damage(victim, CAITLYN_STATS.rDamage, me);
    this.s.fx.addFlash(0.14, CAITLYN_ACE);
    this.s.fx.ring(victim.pos.x, victim.pos.y, 8, 170, 0.4, CAITLYN_ACE, 5, 'shock');
    audio.play('hazardFire', { intensity: 1.3, pan: this.s.panOf(victim.pos) });
  }

  /** Is there terrain on the line between these two points? */
  private lineOfSight(from: Vec2, to: Vec2): boolean {
    const d = dist(from, to);
    if (d < 1) return true;
    const dir = { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
    // A quarter of the body's width: an ultimate that clipped the very corner
    // of a rock and called it blocked would teach hiding behind nothing.
    const reach = this.s.world.terrainAlong(from, dir, d, 8);
    return !reach.hit || reach.distance >= d - 2;
  }

  // ------------------------------------------------------------- accounting

  /**
   * Missiles that are gone and never reported a hit were dodged.
   *
   * Checked against the world's own projectile list rather than against a
   * timer, so a Peacemaker that expired at the edge of the arena and one that
   * flew past your shoulder are counted the same way — as things that did not
   * hit you, which is the only claim the score makes about them.
   */
  private reapShots(): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i];
      if (this.s.world.projectiles.some((p) => p.id === shot.id)) continue;
      this.shots.splice(i, 1);
      if (shot.slot === 'q') this.stats.qDodged++;
      else this.stats.netDodged++;
    }
  }

  /**
   * Missiles land after the champion that fired them has stopped mattering.
   *
   * A Peacemaker in flight when she dies still arrives, and it is still a
   * Peacemaker you failed to dodge — so a missile is matched on the shot id
   * the world hands back rather than on who owns the body. Only the basic
   * attack, which has no id to match, needs her still to be here.
   */
  onEvents(events: readonly WorldEvent[]): void {
    const pid = this.s.world.playerId;
    const me = this.actor;
    for (const e of events) {
      if (e.type !== 'attackLand' || e.targetId !== pid) continue;
      const shot = e.meta !== undefined ? this.shots.find((sh) => sh.id === e.meta) : undefined;
      if (shot) this.onShotLanded(shot, e);
      else if (me && e.actorId === me.id) this.onAutoLanded(e);
    }
  }

  private onShotLanded(shot: Shot, e: WorldEvent): void {
    this.shots = this.shots.filter((s) => s.id !== shot.id);
    const player = this.s.world.player;
    if (shot.slot === 'q') {
      this.stats.qHits++;
      if (shot.free) this.stats.qFreeHits++;
      this.stats.damageDealt += CAITLYN_STATS.qDamage;
      this.stats.dodgeableTaken += CAITLYN_STATS.qDamage;
      if (player) this.s.micro('PEACEMAKER', player.pos, CAITLYN_COLOR);
    } else {
      this.stats.netHits++;
      this.stats.damageDealt += CAITLYN_STATS.eDamage;
      this.stats.dodgeableTaken += CAITLYN_STATS.eDamage;
      // League: a netted target is headshot-marked exactly as a trapped one is.
      this.hsPrimed = true;
      if (player) this.s.micro('NETTED', player.pos, CAITLYN_COLOR);
    }
    void e;
  }

  /**
   * Headshot, on the basic attack that earned it.
   *
   * The bonus is applied after the fact rather than by inflating her attack
   * profile, because the counter belongs to the passive and the attack profile
   * belongs to the body — and a drill that read her damage off the body would
   * be told a different number every sixth shot.
   */
  private onAutoLanded(e: WorldEvent): void {
    const me = this.actor;
    const player = this.s.world.player;
    this.stats.damageDealt += e.amount ?? 0;
    if (!me || !player || !player.alive) return;
    this.hsCount++;
    const due = this.hsPrimed || this.hsCount >= CAITLYN_STATS.headshotEvery;
    if (!due) return;
    this.hsCount = 0;
    this.hsPrimed = false;
    const bonus = Math.round(me.attack.damage * CAITLYN_STATS.headshotBonus);
    this.stats.headshots++;
    this.stats.damageDealt += bonus;
    this.s.world.damage(player, bonus, me);
    this.s.micro('HEADSHOT', player.pos, CAITLYN_COLOR);
    audio.play('perfect', { intensity: 0.7, pan: this.s.panOf(player.pos) });
  }

  /**
   * She is off the floor.
   *
   * The cast goes and the body goes; the traps stay, because they are on the
   * ground rather than in her hands and a mode that swept them up on her death
   * would be teaching that killing her makes the floor safe. Missiles already
   * in flight stay tracked too — see `onEvents`.
   */
  retire(): void {
    this.cast = null;
    this.actor = null;
  }

  // ------------------------------------------------------------------ paint

  /**
   * Every window she is giving you, drawn on the floor she is giving it on.
   *
   * There is one rule here and the whole mode rests on it: nothing is ever
   * drawn that the player is not entitled to react to. The Peacemaker's lane
   * appears the instant the cast commits and fills as the window closes; the
   * trap's footprint is drawn while it arms and drawn differently once it can
   * catch you; the ultimate's line is drawn from her to you and goes green the
   * moment terrain breaks it, so the answer is legible *while there is still
   * time to take it*.
   */
  paint(out: DrillPaint, t: number): void {
    const me = this.actor;

    for (const trap of this.traps) {
      const arming = trap.arm > 0;
      out.markers.push({
        kind: 'ring',
        x: trap.pos.x,
        y: trap.pos.y,
        radius: CAITLYN_STATS.wRadius,
        color: CAITLYN_TRAP,
        alpha: arming ? 0.35 : 0.72,
        width: arming ? 2 : 3.5,
        dash: arming ? 26 : 0,
        spin: arming ? 1.1 : 0,
        // The interior fills as it arms, and then it is simply live. An armed
        // trap must never look like a fading one: it lasts twelve seconds and
        // a decaying ring would read as "nearly gone" for eleven of them.
        fill: arming ? 0.05 + (1 - trap.arm / CAITLYN_STATS.wArm) * 0.14 : 0.2,
        rise: 1.4,
      });
      if (!arming) {
        out.markers.push({
          kind: 'cross',
          x: trap.pos.x,
          y: trap.pos.y,
          radius: CAITLYN_STATS.wRadius * 0.42,
          color: CAITLYN_TRAP,
          alpha: 0.5 + 0.18 * Math.sin(t * 5 + trap.id),
          width: 2.5,
          rise: 1.5,
        });
      }
    }

    if (!me || !me.alive) return;
    const c = this.cast;
    if (!c) return;
    const progress = 1 - c.left / Math.max(0.0001, c.total);

    if (c.slot === 'q' || c.slot === 'e') {
      const half = (c.slot === 'q' ? CAITLYN_STATS.qWidth : CAITLYN_STATS.eWidth) / 2;
      out.markers.push({
        kind: 'line',
        x: me.pos.x,
        y: me.pos.y,
        x2: c.to.x,
        y2: c.to.y,
        halfWidth: half,
        color: CAITLYN_COLOR,
        alpha: 0.5 + progress * 0.35,
        // The lane fills up as the window closes. A lane that is nearly full
        // is a lane you are already too late to leave, and it says so without
        // a number.
        fill: 0.1 + progress * 0.34,
        progress,
        width: 3,
        rise: 2.4,
      });
      return;
    }

    // The ultimate. Two marks: the line, and whether it is currently broken.
    const player = this.s.world.byId(c.lockId ?? -1) ?? this.s.world.player;
    if (!player) return;
    const clear = this.lineOfSight(me.pos, player.pos);
    const color = clear ? CAITLYN_ACE : PALETTE.good;
    out.markers.push({
      kind: 'line',
      x: me.pos.x,
      y: me.pos.y,
      x2: player.pos.x,
      y2: player.pos.y,
      halfWidth: 14 + progress * 12,
      color,
      alpha: clear ? 0.55 + progress * 0.4 : 0.5,
      fill: clear ? 0.2 + progress * 0.4 : 0.12,
      width: 3,
      rise: 2.6,
    });
    out.markers.push({
      kind: 'ring',
      x: player.pos.x,
      y: player.pos.y,
      radius: player.radius + 26 + (1 - progress) * 44,
      color,
      alpha: 0.8,
      width: 4,
      rise: 2.6,
    });
    out.billboards.push({
      kind: 'label',
      x: me.pos.x,
      y: me.pos.y,
      text: clear ? 'ACE IN THE HOLE' : 'BLOCKED',
      color,
      size: 16,
      sub: clear ? 'BREAK LINE OF SIGHT' : 'HOLD IT',
    });
    out.billboards.push({
      kind: 'timerBar',
      x: player.pos.x,
      y: player.pos.y,
      progress: 1 - progress,
      color,
      width: 130,
      lift: 44,
    });
  }
}
