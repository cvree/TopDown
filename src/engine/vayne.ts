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
 * The trinket lives here too, on D, and is the one thing on the bar that is
 * not the champion — not levelled, not hers, and on the same key at level one
 * as at eighteen. It sits in the kit because that is where the hands are.
 *
 * The kit owns its own state and stats and knows nothing about drills, so all
 * four Vayne drills and the gauntlet share exactly one implementation of the
 * champion.
 */
import { audio } from './audio';
import type { AbilitySlot } from './input';
import { grown, grownAttackSpeed } from './levels';
import { clamp, dist, norm } from './math';
import { PALETTE } from './palette';
import type { DrillPaint } from './paint';
import type { AbilityView, Session } from './session';
import type { Actor, Vec2 } from './types';
import type { WorldEvent } from './world';

export const VAYNE_COLOR = '#c86bff';
export const VAYNE_SILVER = '#e6f0ff';
/** Vision is its own colour on the floor: nothing else in the kit is green. */
export const WARD_COLOR = '#7ce8a4';
/** The ward's own footprint, only ever used to keep it out of walls. */
const WARD_RADIUS = 10;

/** Which parts of the kit a drill hands the player, and at what rank. */
export interface VayneLoadout {
  tumble?: boolean;
  bolts?: boolean;
  condemn?: boolean;
  finalHour?: boolean;
  /**
   * The trinket, which defaults to *on*.
   *
   * Every other flag here defaults to off because every other flag is a piece
   * of the champion a mode chooses to hand you. A ward is not part of the kit
   * and never was: it is not levelled, it is not hers, and in a real game it
   * is on the same key whether you are level one or level eighteen. Making the
   * modes opt out rather than in is the same statement — the trinket is part
   * of the hands, not part of the champion.
   */
  ward?: boolean;
  /** Defaults to the laning Vayne — one point in everything. */
  ranks?: Partial<VayneRanks>;
  /**
   * Charge League's own cooldowns rather than the practice share.
   *
   * Every mode in this client shortens Condemn and shortens the trinket, and
   * both of those decisions are about the *length of a rep*: a sixty second
   * run against League's twenty second cooldown contains three condemns, two
   * of which arrive with nothing in front of a wall. A lane phase is ten
   * minutes long. It contains her real kit at her real cooldowns, and it has
   * to, because counting an opponent's cooldown — and being counted — is one
   * of the things the mode exists to teach.
   */
  leagueCooldowns?: boolean;
}

/**
 * Ability ranks.
 *
 * League's numbers are not one number, they are five, and which of the five
 * you are playing with is most of what a rank of Vayne feels like. A level-3
 * Vayne with one point in Q lives on a six second cooldown and has to earn
 * every tumble; a level-13 Vayne with Q maxed has one every two seconds and
 * plays a different champion. Both are real, so both are here, and each mode
 * says which Vayne it is putting you behind rather than inventing a number
 * that is nobody's.
 */
export interface VayneRanks {
  /** 1..5 */
  q: number;
  /** 1..5 */
  w: number;
  /** 1..5 */
  e: number;
  /** 1..3 */
  r: number;
}

/** A level 5 Vayne with a point in each of Q, W and E: the laning champion. */
export const LANE_RANKS: VayneRanks = { q: 1, w: 1, e: 1, r: 1 };
/** A level 11 Vayne with Q maxed: the champion the mid-game is played on. */
export const FIGHT_RANKS: VayneRanks = { q: 4, w: 3, e: 1, r: 1 };

const rank = <T>(table: readonly T[], r: number): T => table[Math.min(table.length, Math.max(1, Math.round(r))) - 1];

/**
 * The Night Hunter, in numbers.
 *
 * Where a value is League's, it is League's — the attack range, the tumble
 * distance, the condemn's cast range and stun, the bolt count, the passive's
 * bonus. Where League's value depends on things this trainer does not model —
 * items, runes, levels, mana — the number here is a stated choice standing in
 * for a specific Vayne, and says which one in its comment. Nothing here is a
 * number that felt about right.
 */
export const VAYNE_STATS = {
  /**
   * A level 9 Vayne's health pool. League's base is 550 at level 1 and grows
   * ~103 a level; the drills need a body that can take a couple of mistakes
   * without the run being over, and this is the honest level for that.
   */
  hp: 1420,
  /** League: Vayne's base movement speed is 330. */
  moveSpeed: 330,
  radius: 28,
  attack: {
    /**
     * League: 0.658 base attack speed, which nobody actually plays at. This is
     * a level 9 Vayne with a first item and level-up growth — roughly 0.95 —
     * because the whole orbwalk rhythm is a function of the attack timer and
     * practising it at a speed you never fight at trains the wrong rhythm.
     */
    attackSpeed: 0.95,
    /**
     * League: Vayne's attack windup is 16.67% of her attack cycle. This is the
     * committed part — once it is running, cancelling costs you the shot.
     */
    windupRatio: 0.1667,
    /**
     * The rest of the animation, which is yours to cancel. League's backswing
     * is a fixed animation length rather than a share of the cycle; at the
     * attack speed above the two work out to about a fifth of it.
     */
    backswingRatio: 0.21,
    /** League: 550. */
    range: 550,
    /** A level 9 Vayne's attack damage, before Silver Bolts. */
    damage: 62,
    /** League: Vayne's bolt travel speed is 2500. */
    projectileSpeed: 2500,
  },

  // ------------------------------------------------------------- passive
  /** League: Night Hunter grants 30 movement speed toward a nearby enemy. */
  huntBonusMs: 30,
  /** How near "nearby" is, in units. */
  huntRange: 1200,

  // ------------------------------------------------------------------- Q
  /** League: Tumble is a 300 unit dash. */
  tumbleRange: 300,
  /** League: 6 / 5 / 4 / 3 / 2 seconds. */
  tumbleCdByRank: [6, 5, 4, 3, 2],
  /**
   * How long the roll itself takes, in seconds.
   *
   * This is the single most important number in the champion and the one the
   * trainer used to get wrong: the old tumble was a teleport, and a teleport
   * cannot be mistimed. In League the dash takes about a quarter of a second,
   * during which Vayne cannot attack — which is exactly why tumbling with an
   * attack already up is a real cost and why the backswing is the only free
   * place to spend it.
   */
  tumbleTime: 0.25,
  /** Extra damage on the attack that follows a tumble. */
  tumbleEmpower: 40,

  // ------------------------------------------------------------------- W
  /** League: every third hit on the same target. */
  boltsPerProc: 3,
  /** League: 4 / 5.5 / 7 / 8.5 / 10% of the target's maximum health, as true damage. */
  boltsMaxHpByRank: [0.04, 0.055, 0.07, 0.085, 0.1],
  /** League: 40 / 45 / 50 / 55 / 60 flat, alongside the health share. */
  boltsFlatByRank: [40, 45, 50, 55, 60],
  /** League: stacks fall off five seconds after the last hit on that target. */
  boltsDecay: 5,

  // ------------------------------------------------------------------- E
  /** League: 550 cast range, the same as her attack. */
  condemnRange: 550,
  /** League: 20 / 18 / 16 / 14 / 12 seconds. */
  condemnCdByRank: [20, 18, 16, 14, 12],
  /**
   * How much of that cooldown a *practice* run actually charges.
   *
   * The one number about the champion herself that is deliberately not
   * League's — the trinket below is not hers — and it is the difference
   * between a trainer and a simulator. Condemn's real cooldown
   * is built for a game with twenty-five minutes in it: at rank one you get
   * three casts in a sixty second run, and two of them arrive while nothing is
   * standing in front of a wall. A mechanic you touch three times an hour is a
   * mechanic you never learn, and the whole claim this client makes is that a
   * rep is cheap and repeatable.
   *
   * So every mode charges this share of the real figure — a little under half,
   * which turns a minute into eight or ten real attempts at the same question
   * without making the ability free. The rank table above still decides the
   * shape (a maxed E is still meaningfully faster than a single point), and
   * the practice screen prints both numbers rather than quietly showing the
   * trainer's and calling it League's.
   */
  condemnPracticeShare: 0.45,
  /**
   * League: Condemn has a 0.25s cast time, and Vayne is rooted for it. It is
   * why a condemn thrown at a diver already on top of you is not free.
   */
  condemnCast: 0.25,
  /** League: the target is knocked back 470 units. */
  condemnPush: 470,
  condemnDamage: 90,
  /** The bonus for slamming them into terrain, on top of the base damage. */
  condemnWallDamage: 90,
  /** League: 1.5 seconds. */
  condemnStun: 1.5,

  // ------------------------------------------------------------------- R
  /** League: 70 / 60 / 50 seconds. */
  finalHourCdByRank: [70, 60, 50],
  /** League: 8 / 10 / 12 seconds. */
  finalHourDurationByRank: [8, 10, 12],
  /** Bonus attack damage during the window, as a multiplier on her attack. */
  finalHourDamage: 1.28,
  /** League: Tumble's cooldown is halved for the duration. */
  finalHourTumbleCdShare: 0.5,
  /** League: a tumble during Final Hour grants 1 second of invisibility. */
  finalHourStealth: 1,

  // ------------------------------------------------------------- trinket
  /** League: a trinket ward is thrown up to 600 units. */
  wardRange: 600,
  /** League: a stealth ward lights 1100 units around itself. */
  wardSight: 1100,
  /**
   * Cooldown and lifetime, and neither of these is League's.
   *
   * League's trinket is balanced for a game with objectives in it: it comes
   * back every couple of minutes and the ward it leaves stands for a minute
   * and a half. Both of those numbers are about *holding* a piece of the map,
   * which is a macro skill and not one a sixty second rep can rehearse.
   *
   * What a rep can rehearse is the habit underneath it — that vision is
   * something you spend, at a moment you chose, on the piece of ground the
   * next ten seconds happen on. So the trinket here comes back fast enough to
   * be part of a fight rather than part of a plan, and what it leaves burns
   * down fast enough that placing one is never a thing you did once at the
   * start of the run and forgot. You are meant to ward five or six times a
   * minute, badly at first, and to notice which of them told you something.
   */
  wardCd: 12,
  wardLife: 8,
  /** How many of hers may be alight at once. */
  wardMax: 2,
} as const;

/** Tumble's cooldown at a given rank, in seconds. */
/**
 * Vayne's stat block, for the one mode that plays her from level one.
 *
 * Everything in `VAYNE_STATS` above is a snapshot of one specific mid-game
 * Vayne, which is the right thing for a drill about a gesture and the wrong
 * thing for a lane phase: the first ten minutes of a game of League are a
 * fight between two numbers that change every ninety seconds, and a champion
 * whose numbers do not change cannot be in that fight.
 *
 * These are her League figures, growth included, and they are only ever read
 * by the lane. Two notes on what is folded in and what is left out:
 *
 *  - **Armour is folded into the health pool.** This engine has no
 *    resistances, and adding a mitigation system for a lane in which both
 *    champions deal physical damage would be two systems doing one
 *    multiplication. So the pool a lane champion carries is their real pool
 *    multiplied by their physical mitigation — the health they *behave* as
 *    though they have. Trades therefore last as long as League's, which is the
 *    property that actually matters.
 *  - **Items and runes are not modelled.** There is no shop in a ten minute
 *    lane trainer, so both sides play the whole phase on base statistics.
 *    Every figure below is what the champion is worth naked, which makes the
 *    lane a little slower than a real one and keeps it exactly symmetrical.
 */
/**
 * The warding totem, at League's own figures.
 *
 * The trinket every other mode carries is deliberately not League's — twelve
 * seconds and eight of life, because spending vision on the next ten seconds
 * is a habit a one minute rep can build and holding a piece of the map for two
 * minutes is not. A lane phase is the one run long enough for the real thing,
 * and the real thing is a very different object: one charge, a long wait, and
 * a ward that stands for a minute and a half. Which bush it goes in, and at
 * what minute, is a decision you get to make about four times in ten minutes,
 * and that scarcity is the whole of why vision is a skill.
 */
export const LEAGUE_TRINKET = { cd: 150, life: 90, max: 1 } as const;

/**
 * Mana, which only the lane has.
 *
 * No other mode in this client models it, and no other mode should: a sixty
 * second rep about one gesture would be a rep about a resource bar, and the
 * gesture is the subject. A lane phase is the opposite case — mana is one of
 * the two or three things that *shape* the first ten minutes of a game of
 * League, and a lane without it is a lane where both champions throw every
 * ability the instant it is up. That single omission would make the enemy
 * laner's poke roughly twice as frequent as any real one, which is not a
 * harder lane, it is a different game.
 *
 * League's figures for Vayne: 232 mana growing 35 a level, regenerating 6.97
 * every five seconds and growing 0.65. Tumble costs 30, Condemn 90, Final Hour
 * 80, and Silver Bolts is a passive that costs nothing.
 */
export const VAYNE_MANA = {
  base: 232,
  growth: 35,
  /** Mana per five seconds, and its growth per level. */
  regen: 6.97,
  regenGrowth: 0.65,
  cost: { q: 30, w: 0, e: 90, r: 80, d: 0, f: 0 },
} as const;

/** Vayne's mana pool and regeneration at a level. */
export const vayneManaAt = (level: number): { max: number; regen: number } => ({
  max: Math.round(grown(VAYNE_MANA.base, VAYNE_MANA.growth, level)),
  regen: grown(VAYNE_MANA.regen, VAYNE_MANA.regenGrowth, level) / 5,
});

export const VAYNE_GROWTH = {
  /** League: 550 health, growing 103 a level. */
  hp: { base: 550, growth: 103 },
  /** League: 23 armour, growing 4.2 a level. Folded into the pool, see above. */
  armor: { base: 23, growth: 4.2 },
  /** League: 60 attack damage, growing 3.3 a level. */
  ad: { base: 60, growth: 3.3 },
  /** League: 0.658 base attack speed, growing 3.3% a level. */
  attackSpeed: { base: 0.658, growthPct: 3.3 },
} as const;

/** Vayne as she actually is at a given level, before items and runes. */
export const vayneAtLevel = (level: number): { hp: number; ad: number; attackSpeed: number } => {
  const armor = grown(VAYNE_GROWTH.armor.base, VAYNE_GROWTH.armor.growth, level);
  return {
    hp: Math.round(grown(VAYNE_GROWTH.hp.base, VAYNE_GROWTH.hp.growth, level) * (1 + armor / 100)),
    ad: Math.round(grown(VAYNE_GROWTH.ad.base, VAYNE_GROWTH.ad.growth, level)),
    attackSpeed: grownAttackSpeed(VAYNE_GROWTH.attackSpeed.base, VAYNE_GROWTH.attackSpeed.growthPct, level),
  };
};

/**
 * The order the points go in.
 *
 * League's standard Vayne: one point in Q at level one because the lane is
 * unplayable without an escape, W second because Silver Bolts is where the
 * damage lives, E third for the answer to somebody walking at you, and then Q
 * maxed first with the ultimate taken the moment it is available. The lane
 * mode takes them automatically off this list rather than opening a menu
 * mid-run, and prints which one arrived.
 */
export const VAYNE_SKILL_ORDER: (keyof VayneRanks)[] = [
  'q', 'w', 'e', 'q', 'q', 'r', 'q', 'w', 'q', 'w', 'r', 'w', 'w', 'e', 'e', 'r', 'e', 'e',
];

export const tumbleCdAt = (r: number): number => rank(VAYNE_STATS.tumbleCdByRank, r);
/** Condemn's cooldown at a given rank in League, in seconds. */
export const condemnCdAt = (r: number): number => rank(VAYNE_STATS.condemnCdByRank, r);

/**
 * Condemn's cooldown as every mode in this trainer actually charges it.
 *
 * This is the figure the kit, the HUD and the scoring all run on; `condemnCdAt`
 * remains League's, and stays exported because the practice screen quotes both
 * and a number the player cannot check against the game is worth nothing.
 */
export const condemnPracticeCdAt = (r: number): number =>
  Math.round(condemnCdAt(r) * VAYNE_STATS.condemnPracticeShare * 10) / 10;

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
  /**
   * Summed quality of where each judged tumble put her, 0..1 each.
   *
   * The counts above are yes/no answers, and a 300 unit tumble is short
   * enough that "did it leave their reach" and "did it keep mine" are both
   * usually yes — which made a tumble straight backwards look nearly as good
   * as one taken sideways. This is the graded version: the best landing spot
   * is just inside her own attack range and outside theirs, and every unit
   * past that is distance bought by giving up the trade.
   */
  tumblePlaceSum: number;
  /** How many tumbles `tumblePlaceSum` has an opinion about. */
  tumblePlaceJudged: number;
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

  /** Wards placed, and the ones that burned down without ever lighting a body. */
  wards: number;
  wardsIdle: number;
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
  tumblePlaceSum: 0,
  tumblePlaceJudged: 0,
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
  wards: 0,
  wardsIdle: 0,
});

interface PendingHit {
  targetId: number;
  amount: number;
  kind: 'bolts' | 'empower' | 'condemn' | 'wall';
}

export class VayneKit {
  readonly stats: VayneStats = emptyStats();
  readonly loadout: Required<VayneLoadout>;
  /** Seconds left of Condemn's cast time, during which she is planted. */
  condemnCastLeft = 0;
  private condemnTargetId: number | null = null;

  /** Seconds remaining on each ability. */
  tumbleCd = 0;
  condemnCd = 0;
  hourCd = 0;
  hourLeft = 0;
  wardCd = 0;
  /** Ids of the wards she owns, so the kit can tell hers from anyone's. */
  private wardIds = new Set<number>();
  /** Which of those have lit an enemy at least once. */
  private wardSaw = new Set<number>();

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

  readonly ranks: VayneRanks;

  constructor(
    private readonly s: Session,
    loadout: VayneLoadout = { tumble: true, bolts: true, condemn: true, finalHour: false },
  ) {
    this.loadout = {
      tumble: loadout.tumble ?? false,
      bolts: loadout.bolts ?? false,
      condemn: loadout.condemn ?? false,
      finalHour: loadout.finalHour ?? false,
      ward: loadout.ward ?? true,
      ranks: loadout.ranks ?? {},
      leagueCooldowns: loadout.leagueCooldowns ?? false,
    };
    this.ranks = { ...LANE_RANKS, ...(loadout.ranks ?? {}) };
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
      this.nightHunter(me);
      this.trailAccum += dt;
      if (this.trailAccum >= 0.1) {
        this.trailAccum = 0;
        this.trail.push({ t: this.s.world.time, pos: { ...me.pos } });
        while (this.trail.length && this.s.world.time - this.trail[0].t > 2.2) this.trail.shift();
      }
    }
    // Condemn's quarter second. She is rooted for it, and if she is knocked
    // about or killed inside it the cast is simply gone — which is the whole
    // reason a condemn thrown late at a diver already on top of you is not a
    // free answer.
    if (this.condemnCastLeft > 0) {
      this.condemnCastLeft = Math.max(0, this.condemnCastLeft - dt);
      if (this.condemnCastLeft === 0) this.releaseCondemn();
      else if (me && me.alive) me.rootedFor = Math.max(me.rootedFor, this.condemnCastLeft);
    }

    if (this.tumbleCd > 0) this.tumbleCd = Math.max(0, this.tumbleCd - dt);
    if (this.condemnCd > 0) this.condemnCd = Math.max(0, this.condemnCd - dt);
    if (this.wardCd > 0) this.wardCd = Math.max(0, this.wardCd - dt);
    this.watchWards();
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

  /**
   * Passive — Night Hunter.
   *
   * League: thirty movement speed while she is moving *toward* a nearby enemy
   * champion. Thirty is not a lot on paper and is enormous in practice: it is
   * why a Vayne who steps in between attacks closes ground she should not be
   * able to close, and why she can chase a retreating target through a whole
   * attack cycle. Leaving it out made every one of her drills a fraction
   * slower than the champion actually is, in the one direction that matters.
   */
  private nightHunter(me: Actor): void {
    let bonus = 0;
    const heading = me.moveDir ?? (Math.hypot(me.vel.x, me.vel.y) > 1 ? norm(me.vel.x, me.vel.y) : null);
    if (heading) {
      for (const e of this.s.world.actors) {
        if (!e.alive || e.team === me.team || e.unitKind === 'turret') continue;
        const dx = e.pos.x - me.pos.x;
        const dy = e.pos.y - me.pos.y;
        if (Math.hypot(dx, dy) > VAYNE_STATS.huntRange) continue;
        if (heading.x * dx + heading.y * dy <= 0) continue;
        bonus = VAYNE_STATS.huntBonusMs;
        break;
      }
    }
    me.moveSpeed = VAYNE_STATS.moveSpeed + bonus;
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
      const amount = target.maxHp * this.boltsShare + this.boltsFlat;
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
      case 'd':
        return this.ward(at);
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
    // A dash is a dash: crowd control stops it, and so does being already in
    // one. Both are League, and both are the difference between a tumble you
    // have to time and a button that always works.
    if (p.rootedFor > 0 || p.dash) return 'refused';

    const dir = this.tumbleDir(p.pos, at);
    if (!dir) return 'refused';
    const reach = this.s.world.terrainAlong(p.pos, dir, VAYNE_STATS.tumbleRange, p.radius);
    const from = { ...p.pos };
    // Where the roll will *end*. Every read below is about the position she is
    // buying, not the one she is leaving, and the body does not get there for
    // another quarter of a second.
    const to = { x: from.x + dir.x * reach.distance, y: from.y + dir.y * reach.distance };

    const wasWindup = p.phase === 'windup';
    const target = this.s.world.byId(p.targetId);
    const inRange = !!target && target.alive && dist(p.pos, target.pos) - target.radius <= p.attack.range;
    /**
     * Whether this tumble costs an attack.
     *
     * Not "is the attack off cooldown" — "will the attack be ready before the
     * roll is over". The dash takes a quarter of a second during which she
     * cannot shoot, so any tumble taken with less than that left on the attack
     * timer is delaying a shot she could have been taking. Anything longer and
     * the attack is coming back regardless of where she is standing, which is
     * exactly why the backswing is free: the timer has a whole cycle to run.
     */
    const attackUp = p.attackCd <= VAYNE_STATS.tumbleTime;
    // Read before the dash moves her: "which way did that go" is a question
    // about where she was standing when the key went down.
    const threat = this.nearestThreat();

    // The roll. Real distance over real time, at League's speed — which is
    // what makes the timing question a timing question: for a quarter of a
    // second she is committed and cannot shoot, so a tumble taken with an
    // attack up costs that attack's worth of damage whether or not it was
    // "wasted" by the animation.
    this.s.world.dash(p, dir, reach.distance, VAYNE_STATS.tumbleRange / VAYNE_STATS.tumbleTime);

    if (wasWindup) {
      // League: casting Tumble during the windup throws the attack away. It is
      // the single most expensive mistake in the champion.
      p.phase = 'idle';
      p.phaseTime = 0;
      this.s.world.emit({ type: 'attackCancel', actorId: p.id, amount: 0 });
      this.stats.tumblesWasted++;
      this.lastTumbleQuality = 'wasted';
      this.s.micro('TUMBLED THE WINDUP', from, PALETTE.danger);
    } else if (attackUp && inRange) {
      this.stats.tumblesGreedy++;
      this.lastTumbleQuality = 'greedy';
      this.s.micro('ATTACK WAS UP', from, PALETTE.textDim);
    } else {
      this.stats.tumblesClean++;
      this.lastTumbleQuality = 'clean';
      // League: the backswing is animation, not commitment. Cancelling it with
      // the dash is free distance on an attack you have already been paid for.
      if (p.phase === 'backswing') {
        p.phase = 'idle';
        p.phaseTime = 0;
        this.s.micro('TUMBLE CANCEL', from, VAYNE_COLOR);
      }
    }

    // Which way it went is its own read, separate from when it was pressed. A
    // perfectly timed tumble into the person chasing you is still a tumble
    // into the person chasing you, and under WASD — where the mouse is on the
    // target and the keys are on the escape — it is the easy mistake to make.
    if (threat && dir.x * (threat.pos.x - from.x) + dir.y * (threat.pos.y - from.y) > 0) {
      this.stats.tumblesInward++;
    }
    if (reach.hit) this.stats.tumblesBlocked++;

    // Where it *puts* her. Direction is only half the read: a tumble taken
    // perfectly on the beat, in a sensible direction, that ends outside her
    // own attack range has still bought distance by giving up the trade, and
    // that is the trade-off the ability actually asks about.
    if (threat) {
      const gap = dist(to, threat.pos);
      /** The far edge of her own reach, and of theirs. */
      const own = p.attack.range + threat.radius;
      const theirs = threat.attack.range + p.radius;
      const safe = gap > theirs;
      if (safe) this.stats.tumblesToSafety++;
      if (safe && gap <= own) this.stats.tumblesKeptRange++;
      // The graded read. Landing just inside her own range and outside theirs
      // is the whole ability; landing on top of them bought nothing, and
      // landing past her own range bought distance with the trade.
      this.stats.tumblePlaceJudged++;
      this.stats.tumblePlaceSum +=
        gap <= theirs
          ? 0.1
          : gap <= own
            ? 0.6 + 0.4 * clamp((gap - theirs) / Math.max(1, own - theirs), 0, 1)
            : clamp(0.6 - (gap - own) / Math.max(1, own), 0, 0.6);
      // And whether she lands nearer to somebody else's fist than she left.
      for (const other of this.s.world.actors) {
        if (!other.alive || other.team === p.team || other.id === threat.id) continue;
        if (dist(to, other.pos) >= dist(from, other.pos)) continue;
        if (dist(to, other.pos) <= other.attack.range + p.radius) {
          this.stats.tumblesIntoCrowd++;
          this.s.micro('INTO THE SECOND ONE', to, PALETTE.danger);
          break;
        }
      }
    }

    this.stats.tumbles++;
    this.lastTumbleAt = this.s.world.time;
    this.empowered = true;
    this.tumbleCd = this.tumbleCdTotal;
    if (this.inFinalHour) p.invisibleFor = VAYNE_STATS.finalHourStealth;

    this.s.fx.trace([from, to], VAYNE_COLOR, 0.45, 5);
    this.s.fx.ring(from.x, from.y, 6, 92, 0.34, VAYNE_COLOR, 3, 'shock');
    this.s.fx.burst(to.x, to.y, 12, { color: VAYNE_COLOR, speed: 250, life: 0.35, size: 2.2 });
    audio.play('dodge', { pan: this.panOf(to) });
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
    if (this.condemnCd > 0 || this.condemnCastLeft > 0) return 'refused';
    if (p.dash) return 'refused';

    const target = this.pickCondemnTarget(at);
    if (!target) return 'noTarget';

    // League: a quarter of a second of cast time, standing still, before
    // anything happens. It is short enough to be invisible when you cast it
    // early and long enough to kill you when you cast it late.
    this.condemnCd = this.condemnCdTotal;
    this.condemnCastLeft = VAYNE_STATS.condemnCast;
    this.condemnTargetId = target.id;
    this.stats.condemnCasts++;
    p.rootedFor = Math.max(p.rootedFor, VAYNE_STATS.condemnCast);
    if (p.phase === 'windup') {
      p.phase = 'idle';
      p.phaseTime = 0;
      this.s.world.emit({ type: 'attackCancel', actorId: p.id, amount: 0 });
    }
    audio.play('castE', { pan: this.panOf(target.pos) });
    return 'cast';
  }

  /**
   * The other end of Condemn's cast time.
   *
   * Everything that makes the ability interesting is resolved here rather than
   * on the keypress, because a quarter of a second is long enough for the
   * answer to change: the target moves, and the wall that was behind them when
   * you pressed E may not be behind them when the bolt lands.
   */
  private releaseCondemn(): void {
    const p = this.s.world.player;
    const target = this.s.world.byId(this.condemnTargetId);
    this.condemnTargetId = null;
    if (!p || !p.alive) return;
    if (!target || !target.alive) {
      this.s.micro('CONDEMN WHIFFED', p.pos, PALETTE.textDim);
      return;
    }

    this.stats.condemnHits++;
    this.lastCondemnAt = this.s.world.time;

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

  /**
   * The trinket — a ward, thrown at the cursor.
   *
   * The one thing on the bar that is not the champion, and the only one whose
   * whole payoff arrives later. Everything else Vayne presses answers a
   * question she has right now; this answers one she is about to have, which
   * is why it is the ability people never learn: at the moment you spend it,
   * spending it feels like nothing happened.
   *
   * Two rules make it a decision rather than a reflex. It lands where the
   * throw actually reaches — terrain stops it, so a ward flung at the far side
   * of a wall lands in front of the wall and lights the wrong ground, exactly
   * as it does in League. And it is placed at the *cursor*, never at her feet,
   * so warding is a thing you aim at a piece of the map, not a button you hold
   * down while standing somewhere.
   */
  private ward(at: Vec2): VayneCastResult {
    if (!this.loadout.ward) return 'locked';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    if (this.wardCd > 0) return 'refused';

    const dx = at.x - p.pos.x;
    const dy = at.y - p.pos.y;
    const d = Math.hypot(dx, dy);
    const dir = d < 1 ? { x: Math.cos(p.facing), y: Math.sin(p.facing) } : { x: dx / d, y: dy / d };
    const throwTo = Math.min(d, VAYNE_STATS.wardRange);
    const reach = this.s.world.terrainAlong(p.pos, dir, throwTo, WARD_RADIUS);
    const pos = { x: p.pos.x + dir.x * reach.distance, y: p.pos.y + dir.y * reach.distance };

    const trinket = this.trinket;
    const ward = this.s.world.placeWard('player', pos, VAYNE_STATS.wardSight, trinket.life, trinket.max);
    this.wardIds.add(ward.id);
    this.wardCd = trinket.cd;
    this.stats.wards++;

    this.s.fx.trace([{ ...p.pos }, pos], WARD_COLOR, 0.35, 3);
    this.s.fx.ring(pos.x, pos.y, 4, 78, 0.45, WARD_COLOR, 3, 'pulse');
    this.s.fx.burst(pos.x, pos.y, 9, { color: WARD_COLOR, speed: 170, life: 0.4, size: 1.8 });
    // No sound here: the session plays the summoner voice for any slot that
    // fires, and a second one from the kit would be the same cast twice.
    return 'cast';
  }

  /**
   * Did that ward ever show her anything?
   *
   * A ward is scored on the only thing a ward is for. Not where it was put —
   * there is no such thing as a correct piece of ground in the abstract — but
   * whether, at any point in its eight seconds, it was the reason she could
   * see somebody. A ward that burns down having lit nothing but empty floor is
   * the mistake, and it is a mistake with two quite different causes worth
   * telling apart later: warding ground the fight was never going to reach,
   * and warding ground she was standing on anyway.
   */
  private watchWards(): void {
    if (this.wardIds.size === 0) return;
    const live = new Set<number>();
    for (const w of this.s.world.wards) {
      if (!this.wardIds.has(w.id)) continue;
      live.add(w.id);
      if (this.wardSaw.has(w.id)) continue;
      for (const e of this.s.world.actors) {
        if (!e.alive || e.team === 'player') continue;
        if (Math.hypot(e.pos.x - w.pos.x, e.pos.y - w.pos.y) > w.radius) continue;
        this.wardSaw.add(w.id);
        break;
      }
    }
    for (const id of this.wardIds) {
      if (live.has(id)) continue;
      this.wardIds.delete(id);
      if (this.wardSaw.has(id)) this.wardSaw.delete(id);
      else this.stats.wardsIdle++;
    }
  }

  private finalHour(): VayneCastResult {
    if (!this.loadout.finalHour) return 'locked';
    if (this.hourCd > 0) return 'refused';
    const p = this.s.world.player;
    if (!p || !p.alive) return 'refused';
    this.hourCd = rank(VAYNE_STATS.finalHourCdByRank, this.ranks.r);
    this.hourLeft = rank(VAYNE_STATS.finalHourDurationByRank, this.ranks.r);
    this.stats.finalHours++;
    // The shorter cooldown applies at once rather than at the next cast, so
    // the ultimate does not feel like it starts one tumble late.
    this.tumbleCd = Math.min(this.tumbleCd, this.tumbleCdTotal);
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
            ? { ...a, name: 'CONDEMN', locked: false, cd: clamp(this.condemnCd / this.condemnCdTotal, 0, 1) }
            : a;
        case 'r':
          return this.loadout.finalHour
            ? {
                ...a,
                name: this.inFinalHour ? `HOUR ${this.hourLeft.toFixed(0)}s` : 'FINAL HOUR',
                locked: false,
                cd: clamp(this.hourCd / rank(VAYNE_STATS.finalHourCdByRank, this.ranks.r), 0, 1),
                highlight: this.inFinalHour,
              }
            : a;
        case 'd':
          return this.loadout.ward
            ? {
                ...a,
                name: `WARD ${this.wardsOut}/${this.trinket.max}`,
                locked: false,
                cd: clamp(this.wardCd / this.trinket.cd, 0, 1),
                // Lit when it is up and she has none out: the moment the
                // trinket is a decision rather than a spare charge.
                highlight: this.wardCd <= 0 && this.wardsOut === 0,
              }
            : a;
        default:
          return a;
      }
    });
  }

  /** Tumble's full cooldown right now: rank, halved inside Final Hour. */
  get tumbleCdTotal(): number {
    const base = tumbleCdAt(this.ranks.q);
    return this.inFinalHour ? base * VAYNE_STATS.finalHourTumbleCdShare : base;
  }

  get condemnCdTotal(): number {
    return this.loadout.leagueCooldowns ? condemnCdAt(this.ranks.e) : condemnPracticeCdAt(this.ranks.e);
  }

  /** The trinket this run is carrying: the rep's, or League's own totem. */
  get trinket(): { cd: number; life: number; max: number } {
    return this.loadout.leagueCooldowns
      ? LEAGUE_TRINKET
      : { cd: VAYNE_STATS.wardCd, life: VAYNE_STATS.wardLife, max: VAYNE_STATS.wardMax };
  }

  /** How many of hers are alight right now. */
  get wardsOut(): number {
    return this.s.world.wards.reduce((n, w) => (this.wardIds.has(w.id) ? n + 1 : n), 0);
  }

  /** The share of the target's maximum health the third bolt takes. */
  get boltsShare(): number {
    return rank(VAYNE_STATS.boltsMaxHpByRank, this.ranks.w);
  }

  get boltsFlat(): number {
    return rank(VAYNE_STATS.boltsFlatByRank, this.ranks.w);
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
      const target = this.condemnCd <= 0 && this.condemnCastLeft <= 0 ? this.pickCondemnTarget(cursor) : null;
      if (target) {
        // Drawn from where they will be when the cast lands, not from where
        // they are now. The quarter second is the ability, and an indicator
        // that ignored it would be teaching the player to press E a quarter of
        // a second too late for the rest of their life.
        const lead = {
          x: target.pos.x + target.vel.x * VAYNE_STATS.condemnCast,
          y: target.pos.y + target.vel.y * VAYNE_STATS.condemnCast,
        };
        const dir = norm(lead.x - p.pos.x, lead.y - p.pos.y);
        const path = this.s.world.terrainAlong(lead, dir, VAYNE_STATS.condemnPush, target.radius);
        out.markers.push({
          kind: 'line',
          x: lead.x,
          y: lead.y,
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

    // The wards. Three things drawn about each one, because a ward answers
    // three questions and only one of them is "where is it": the circle it
    // lights, how long that circle has left, and the pip itself, which is the
    // bit you look for when you are deciding whether you still have cover.
    for (const w of this.s.world.wards) {
      if (w.team !== 'player') continue;
      const left = clamp(w.life / Math.max(0.001, w.maxLife), 0, 1);
      // Fading, and quickening: a ward on its last two seconds blinks, which
      // is the only warning a player gets that the ground is about to go dark.
      const dying = left < 0.25;
      const pulse = dying ? 0.5 + 0.5 * Math.sin(t * 14) : 1;
      out.markers.push({
        kind: 'ring',
        x: w.pos.x,
        y: w.pos.y,
        radius: w.radius,
        color: WARD_COLOR,
        alpha: 0.06 + 0.08 * left,
        width: 2,
        dash: 96,
        spin: 0.05,
        rise: 0.9,
      });
      out.markers.push({
        kind: 'ring',
        x: w.pos.x,
        y: w.pos.y,
        radius: 26,
        color: WARD_COLOR,
        alpha: (0.35 + 0.45 * left) * pulse,
        width: 3,
        progress: left,
        rise: 1.05,
      });
      out.markers.push({
        kind: 'disc',
        x: w.pos.x,
        y: w.pos.y,
        radius: 7,
        color: WARD_COLOR,
        alpha: 0.75 * pulse,
        rise: 1.06,
      });
    }

    if (this.loadout.ward && this.wardCd <= 0) {
      // Where the throw would actually land, and only while it is up. A
      // trinket range indicator that is on the floor permanently is furniture;
      // one that appears the moment the ward is ready is a prompt.
      const dx = cursor.x - p.pos.x;
      const dy = cursor.y - p.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > 1) {
        const dir = { x: dx / d, y: dy / d };
        const reach = this.s.world.terrainAlong(p.pos, dir, Math.min(d, VAYNE_STATS.wardRange), WARD_RADIUS);
        out.markers.push({
          kind: 'cross',
          x: p.pos.x + dir.x * reach.distance,
          y: p.pos.y + dir.y * reach.distance,
          radius: 16,
          color: WARD_COLOR,
          alpha: 0.3 + 0.12 * Math.sin(t * 6),
          width: 2,
          rise: 1,
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
  if (st.tumblePlaceJudged < 1) return 0;
  const placed = st.tumblePlaceSum / st.tumblePlaceJudged;
  // Landing next to a second opponent is worse than not having pressed it, so
  // it is charged against the average rather than merely left uncredited.
  const crowd = st.tumblesIntoCrowd / st.tumblePlaceJudged;
  return clamp(placed - crowd * 0.8, 0, 1);
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
