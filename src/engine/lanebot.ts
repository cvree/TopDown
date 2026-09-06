/**
 * THE OTHER LANER.
 *
 * A lane phase trainer is only worth anything if the person on the other side
 * of the wave is doing the same job you are, well, and for reasons you can
 * name. A dummy that walks at you teaches nothing; a bot that farms perfectly
 * and never punishes teaches you to walk up whenever you like, which is worse
 * than nothing because it is a habit that will get you killed by a real
 * person at minute three.
 *
 * So this is written as a laner rather than as an opponent. Every frame it
 * asks the same short list of questions a human asks, in the same order:
 *
 *  1. **Am I about to die?** Health, the enemy wave, the turret behind me.
 *  2. **Can I kill them?** Not "are they low" — can I actually finish it,
 *     counting my own kit, their escape and the turret that will answer.
 *  3. **Is there a minion to take?** Farm is the job. It is the first thing a
 *     good laner does and the last thing a bad one thinks about.
 *  4. **Are they giving me a free hit?** Somebody committed to a last hit is
 *     somebody who cannot walk away for the next third of a second, and
 *     taking that hit is the whole of laning against a marksman.
 *  5. **Where should I be standing?** Behind my own wave, outside their
 *     turret, at the edge of my range and not theirs.
 *
 * ### What difficulty is allowed to change
 *
 * The same rule the rest of this engine keeps: never health, never damage,
 * never a cooldown. A challenger-tier laner is exactly as fragile as an
 * iron-tier one and hits exactly as hard. What changes is entirely
 * behavioural — how quickly it sees a minion enter its window, how often it
 * throws an attack away on a healthy one, whether it notices that you have
 * committed to a last hit, whether it holds the wave rather than shoving it,
 * whether it can count lethal, and whether it will take a fight it can win.
 *
 * That is not a softer knob than "more damage". It is a far harder one: an
 * opponent that never misses a last hit, punishes every one of yours, and
 * walks up the moment your wave dies is a genuinely difficult lane at exactly
 * League's numbers, and the player who beats it has learned something that
 * transfers on the first try.
 *
 * ### What is not modelled
 *
 * There is no shop, so neither side is saving for an item and neither gets one.
 * Mana *is* modelled — see the bar below — because without it a Peacemaker
 * every ten seconds is a Peacemaker every ten seconds for the whole lane, and
 * that is not an opponent, it is a metronome. What the shop's absence costs is
 * the second half of that decision: a real laner rations poke against the item
 * they are buying with the gold they are not spending on it. `discipline`
 * stands in for the judgement that is left: a low-tier laner throws the poke
 * at the wave because it is up, a high-tier one holds it for a target that
 * cannot step out of it and keeps enough for the ultimate.
 */
import { CAITLYN_MANA, CAITLYN_STATS, caitlynManaAt, type CaitlynKit } from './caitlyn';
import { incomingDamage, type Lane } from './lane';
import { levelFromXp } from './levels';
import { clamp, dist } from './math';
import type { Rng } from './rng';
import type { Actor, Vec2 } from './types';
import type { World } from './world';

/**
 * Everything difficulty is allowed to move, and nothing else.
 *
 * Each field is a behaviour with a name a player would recognise from a
 * post-game review of their own lane: how late they saw it, whether they
 * threw the attack away, whether they punished the step-up.
 */
export interface LaneBotTuning {
  /** Seconds a minion must sit inside the kill window before it is noticed. */
  reaction: number;
  /**
   * How much of the damage already in the air it counts, 0..1.
   *
   * The single most important number in the whole file, and the one that
   * separates a bronze last hit from a challenger one. An attack takes a
   * windup plus a missile's flight to arrive — better than half a second —
   * and in that time three other minions have hit the one you are aiming at.
   * A laner with no foresight fires when the bar is *already* under their
   * damage and is therefore always half a second late; one with full foresight
   * fires when the bar *will be* under their damage at the moment the bolt
   * lands, and takes the minion every time.
   *
   * It is the same arithmetic the mode draws on the health bar for the player
   * at the lower tiers. The bot is not doing anything a person cannot: it is
   * doing the thing the plate is teaching.
   */
  foresight: number;
  /** Chance per attack cycle of throwing one away at a healthy minion. */
  greed: number;
  /** Chance of taking a free hit on a laner who has just committed. */
  punish: number;
  /** How well it leads a skillshot at a moving target, 0..1. */
  lead: number;
  /** Health share it will fight down to before it disengages. */
  bravery: number;
  /** How willing it is to hold the wave rather than shove it, 0..1. */
  waveControl: number;
  /** How well it picks the moment for an ability rather than the cooldown. */
  discipline: number;
  /** Whether it will follow a kill under the enemy turret. */
  dives: boolean;
}

/**
 * The ladder, as behaviour.
 *
 * `t` runs 0..1 and every figure is interpolated across it, so a tier is a
 * point on a continuum rather than a separate AI. The two ends are written to
 * be recognisable rather than merely different:
 *
 *  - At **0** it sees a killable minion nearly half a second late, throws
 *    away one attack in two on a full-health one — which shoves its own wave
 *    into your turret and hands you the lane — and almost never notices that
 *    you have just walked up. It is a person who has not thought about any of
 *    this. You should out-farm it by fifty.
 *  - At **1** it is on the minion the instant the window opens, wastes
 *    essentially nothing, punishes four out of five of your last hits, holds
 *    the wave where it wants it, saves the Peacemaker for a target who cannot
 *    step out of it, counts lethal before it commits, and will come under
 *    your turret to finish you if the arithmetic says it survives. There is
 *    no trick to beating it: you have to farm cleanly under pressure, which
 *    is the entire skill the mode exists to build.
 */
export const laneTuning = (t: number): LaneBotTuning => {
  const level = clamp(t, 0, 1);
  const mix = (a: number, b: number): number => a + (b - a) * level;
  return {
    reaction: mix(0.46, 0.05),
    foresight: mix(0.1, 1),
    greed: mix(0.5, 0.02),
    punish: mix(0.04, 0.82),
    lead: mix(0.12, 0.95),
    bravery: mix(0.62, 0.2),
    waveControl: mix(0, 1),
    discipline: mix(0.1, 0.95),
    dives: level > 0.8,
  };
};

/** How the bot's own experience and gold are kept. */
export interface LaneBotLedger {
  cs: number;
  gold: number;
  xp: number;
  level: number;
  kills: number;
  deaths: number;
  /** Damage it has put on the player's champion, all sources. */
  damageDealt: number;
}

/** Where the bot would rather the wave sat, given how the lane is going. */
export type WavePlan = 'farm' | 'freeze' | 'shove' | 'retreat' | 'allIn';

const AGGRO_MEMORY = 2.5;

export class LaneBot {
  readonly tuning: LaneBotTuning;
  readonly ledger: LaneBotLedger = {
    cs: 0,
    gold: 0,
    xp: 0,
    level: 1,
    kills: 0,
    deaths: 0,
    damageDealt: 0,
  };
  /** Ability ranks, taken automatically off the champion's own skill order. */
  readonly ranks = { q: 1, w: 0, e: 0, r: 0 };

  /** What it is trying to do with the wave right now. Shown on the HUD. */
  plan: WavePlan = 'farm';

  /**
   * Mana, and the reason a lane has a rhythm at all.
   *
   * Without it every cooldown is the only limit and the lane becomes a
   * metronome of Peacemakers. With it, opening with three of them is a real
   * decision that costs the fourth — which is exactly the decision a laner is
   * making when they hold poke for a level six all-in.
   */
  mana: number;
  manaMax: number;
  private manaRegen: number;

  /** When each killable minion entered the window, for the reaction delay. */
  private noticed = new Map<number, number>();
  private decisionCd = 0;
  private repositionCd = 0;
  /**
   * One roll per attack cycle rather than one per decision tick.
   *
   * Without the latch a twelve-hertz loop turns a one-in-five chance into a
   * certainty. A temptation should arrive once per attack, which is how often
   * a person gets to give in to it.
   */
  private armed = false;
  private wantsGreed = false;
  private wantsPunish = false;

  constructor(
    readonly actor: Actor,
    private readonly kit: CaitlynKit,
    private readonly lane: Lane,
    private readonly rng: Rng,
    difficulty: number,
    private readonly skillOrder: readonly ('q' | 'w' | 'e' | 'r')[],
  ) {
    this.tuning = laneTuning(difficulty);
    const pool = caitlynManaAt(1);
    this.mana = pool.max;
    this.manaMax = pool.max;
    this.manaRegen = pool.regen;
    this.kit.autopilot = false;
    this.kit.lead = this.tuning.lead;
    this.kit.reaction = this.tuning.reaction;
    this.kit.applyLevel(1, this.ranks);
  }

  // ------------------------------------------------------------- levelling

  /**
   * Experience arrives from the drill, because the drill is what hears a
   * minion die. What happens to it is the bot's own business: a level is a
   * point in an ability and a step up every statistic, and both sides of the
   * lane take them off the same curve at the same moments.
   */
  gainXp(amount: number): boolean {
    this.ledger.xp += amount;
    const level = levelFromXp(this.ledger.xp);
    if (level <= this.ledger.level) return false;
    while (this.ledger.level < level) {
      const next = this.skillOrder[this.ledger.level - 1] ?? 'q';
      this.ranks[next] = Math.min(next === 'r' ? 3 : 5, this.ranks[next] + 1);
      this.ledger.level++;
    }
    this.kit.applyLevel(this.ledger.level, this.ranks);
    const pool = caitlynManaAt(this.ledger.level);
    // A level tops nobody up, but the new ceiling arrives with it.
    this.mana += pool.max - this.manaMax;
    this.manaMax = pool.max;
    this.manaRegen = pool.regen;
    return true;
  }

  // ----------------------------------------------------------------- frame

  update(world: World, dt: number): void {
    const me = this.actor;
    if (!me.alive) return;
    this.decisionCd -= dt;
    this.repositionCd -= dt;
    this.mana = Math.min(this.manaMax, this.mana + this.manaRegen * dt);

    const player = world.player;
    const mine = this.lane.enemyMinions();
    const theirs = this.lane.allyMinions();

    this.watchWindows(world, theirs);

    const ready = me.attackCd <= 0.001 && me.phase !== 'windup';
    if (!ready) this.armed = false;
    else if (!this.armed) {
      this.armed = true;
      this.wantsGreed = this.rng.next() < this.tuning.greed;
      this.wantsPunish = this.rng.next() < this.tuning.punish;
    }

    if (this.decisionCd > 0) return;
    this.decisionCd = 0.08;

    const seen = !!player && player.alive && world.canSee(me.team, player);
    this.plan = this.choosePlan(world, player, seen, mine, theirs);

    // A cast owns the body while it runs: she is rooted for it, and asking her
    // to walk somewhere in the middle of a Peacemaker would be a cancel she
    // did not ask for.
    if (this.kit.casting) return;

    if (this.plan === 'allIn' && player && seen) {
      if (this.commitToKill(world, player, ready)) return;
    }
    if (this.plan !== 'retreat' && this.takeLastHit(world, theirs, ready)) return;
    if (this.plan !== 'retreat' && this.setUpUnderTurret(world, theirs, ready)) return;
    if (player && seen && this.plan !== 'retreat' && this.trade(world, player, ready, theirs)) return;
    if (player && seen && this.spendKit(player, theirs)) return;
    if (ready && this.wantsGreed && this.plan !== 'retreat' && this.wasteOne(world, theirs)) return;

    this.hold(world, player, seen);
  }

  /**
   * Minion windows, and when each was noticed.
   *
   * A minion becomes *available* only once it has been inside the kill window
   * for `reaction` seconds — so a weak laner is forever a quarter-second late
   * and takes the minion after somebody else has finished it, and a strong one
   * is on it the instant the bar crosses the line. Everything a player
   * experiences as "this bot never misses a CS" is this map, the window below
   * it, and nothing else.
   */
  private watchWindows(world: World, targets: Actor[]): void {
    for (const m of targets) {
      const open = this.window(world, m);
      if (open && !this.noticed.has(m.id)) this.noticed.set(m.id, world.time);
      if (!open) this.noticed.delete(m.id);
    }
    for (const id of [...this.noticed.keys()]) if (!world.byId(id)?.alive) this.noticed.delete(id);
  }

  /**
   * Is this minion takeable by an attack started right now?
   *
   * Health at the moment the bolt would land, not health now: the windup plus
   * the flight is the horizon, and everything already thrown at the minion by
   * the rest of the lane happens inside it. `foresight` decides how much of
   * that the laner actually accounts for, which is the whole ladder.
   */
  private window(world: World, m: Actor): boolean {
    const me = this.actor;
    const cycle = 1 / Math.max(0.05, me.attack.attackSpeed);
    const gap = Math.max(0, dist(me.pos, m.pos) - m.radius);
    const travel = me.attack.projectileSpeed > 0 ? gap / me.attack.projectileSpeed : 0;
    const lead = cycle * me.attack.windupRatio + travel;
    const coming = incomingDamage(world, m, lead, { exclude: me.id }) * this.tuning.foresight;
    const at = m.hp - coming;
    // Already lost is not a window: an attack thrown at a minion the wave is
    // about to finish is an attack timer spent on nothing.
    return at > 0 && at <= me.attack.damage;
  }

  // ------------------------------------------------------------------ plan

  /**
   * What kind of lane it is playing this second.
   *
   * The plan is chosen before any button is pressed, because that is the order
   * a person does it in: you decide you are killing them, or that you are
   * behind and holding, and *then* your hands do something about it. It is
   * also the one piece of the bot's mind the HUD shows the player, so that
   * "why did it suddenly walk at me" is always answerable.
   */
  private choosePlan(
    world: World,
    player: Actor | undefined,
    seen: boolean,
    mine: Actor[],
    theirs: Actor[],
  ): WavePlan {
    const me = this.actor;
    const share = me.hp / me.maxHp;
    const underTheirTurret = this.insideTurret(this.lane.allyTurret, me.pos, 40);
    if (share < 0.28 || (underTheirTurret && !this.tuning.dives)) return 'retreat';
    if (player && seen && this.canKill(world, player)) return 'allIn';
    if (share < this.tuning.bravery * 0.55) return 'retreat';
    // Wave control is the half of laning nobody practises. A laner who is
    // ahead wants the wave to stay where it is — near their own side, so the
    // other one has to walk into the turret to farm it — and a laner who
    // wants to reset or recall shoves it. The bot only does either once its
    // tuning says it has thought about the wave at all.
    if (this.tuning.waveControl > 0.45) {
      const advantage = mine.length - theirs.length;
      if (advantage >= 2 && this.lane.frontX() < this.midX()) return 'freeze';
      if (theirs.length === 0 && mine.length >= 3) return 'shove';
    }
    return 'farm';
  }

  /**
   * Can it actually finish this?
   *
   * Not "are they low": how much damage it can put out before they are out of
   * reach, against how much health they have and what the turret behind them
   * will do about it. Counting the ultimate matters most — a Caitlyn who can
   * see the execute is a Caitlyn who is already walking forward — and so does
   * refusing the dive, which is the difference between a hard bot and a bot
   * that throws itself into your turret every two minutes.
   */
  private canKill(world: World, player: Actor): boolean {
    const me = this.actor;
    if (me.hp / me.maxHp < 0.4) return false;
    const gap = dist(me.pos, player.pos);
    // The execute: no walking required, and nothing the player does with their
    // feet stops it. If it kills, it is the correct button and a good laner
    // presses it every single time.
    if (this.ranks.r > 0 && this.kit.cdOf('r') <= 0 && gap < CAITLYN_STATS.rRange && player.hp <= this.kit.damage.r) {
      return true;
    }
    if (gap > CAITLYN_STATS.qRange) return false;
    const inTheirTurret = this.insideTurret(this.lane.allyTurret, player.pos, 0);
    if (inTheirTurret) {
      if (!this.tuning.dives) return false;
      if (me.hp / me.maxHp < 0.7) return false;
      // The dive's own arithmetic, and the half of it people forget: the
      // turret is already ramped if it has been shooting, and the shot that
      // kills a diver is nearly always the third one. A laner who cannot
      // survive two more of them at their current stack count is not diving,
      // they are dying with a kill they can nearly see.
      const turret = this.lane.allyTurret;
      const next = turret.attack.damage * (1 + 0.4 * this.lane.rampOf(turret));
      if (me.hp < next * 2.2) return false;
      // And it has to be a dive rather than a chase. A kill you are already
      // in range of is worth the turret shots; one you have to walk eight
      // hundred units into is a kill the other laner gets to cancel by
      // walking home, and you paid for it anyway.
      if (gap > me.attack.range * 1.15) return false;
    }
    // Two autos and a headshot inside the window it takes them to walk out of
    // range, plus a Peacemaker if it is up. Deliberately conservative: the
    // cost of a wrong "yes" is a death, and a laner who dies on a bad count
    // is a laner who is behind for the rest of the lane.
    const autos = me.attack.damage * 2 + me.attack.damage * this.kit.damage.headshot;
    const q = this.kit.cdOf('q') <= 0 && this.ranks.q > 0 ? this.kit.damage.q : 0;
    const r = this.ranks.r > 0 && this.kit.cdOf('r') <= 0 ? this.kit.damage.r : 0;
    // What is already on its way to them counts: a laner who ignores the
    // three minions currently shooting the person they are about to dive is a
    // laner who under-counts every kill in the game.
    const alreadyComing = incomingDamage(world, player, 1.2, {});
    return player.hp <= autos + q + r + alreadyComing;
  }

  // -------------------------------------------------------------- the hands

  /** The job: take the minion, and take it with one attack. */
  private takeLastHit(world: World, targets: Actor[], ready: boolean): boolean {
    if (!ready) return false;
    const me = this.actor;
    let best: Actor | null = null;
    for (const m of targets) {
      if (this.reach(m) > me.attack.range) continue;
      // Never double-commit: an attack already in the air is a minion already
      // secured, and a second one is a wasted attack timer.
      if (incomingDamage(world, m, Infinity, { only: me.id }) > 0) continue;
      const at = this.noticed.get(m.id);
      if (at === undefined || world.time - at < this.tuning.reaction) continue;
      if (!this.window(world, m)) continue;
      if (!best || m.hp < best.hp) best = m;
    }
    if (!best) return false;
    world.issueAttackTarget(me, best.id);
    this.armed = false;
    return true;
  }

  /**
   * Farming under your own turret, which is a different job entirely.
   *
   * A turret shot takes 152 off a minion and a level-one attack takes sixty,
   * so a caster that walks under your tower cannot be last-hit by waiting: by
   * the time it is inside your window the turret has already taken it. The
   * technique every good laner has and no bad one does is to *set it up* —
   * put attacks into the minion before the turret does, so that the shot
   * leaves it somewhere you can finish rather than somewhere it dies.
   *
   * It looks like the mistake the mode grades you for — hitting healthy
   * minions — and it is the exact opposite, because under your own turret the
   * wave is not going anywhere you did not already want it. That is why it is
   * gated behind foresight: it is a thing you do on purpose, and a laner who
   * does it by accident is simply pushing.
   */
  private setUpUnderTurret(world: World, targets: Actor[], ready: boolean): boolean {
    if (!ready || this.tuning.foresight < 0.55) return false;
    const me = this.actor;
    const turret = this.lane.enemyTurret;
    let best: Actor | null = null;
    for (const m of targets) {
      if (dist(m.pos, turret.pos) > turret.attack.range) continue;
      if (this.reach(m) > me.attack.range) continue;
      if (incomingDamage(world, m, Infinity, { only: me.id }) > 0) continue;
      // Anything already dying to what is in the air is not worth an attack:
      // that is the turret's minion now and there is nothing to be done.
      if (m.hp - incomingDamage(world, m, 0.9, { exclude: me.id }) <= 0) continue;
      if (!best || m.hp < best.hp) best = m;
    }
    if (!best) return false;
    world.issueAttackTarget(me, best.id);
    this.armed = false;
    return true;
  }

  /**
   * The free hit.
   *
   * This is the part of the bot a player will remember, and it is the part
   * that transfers hardest in the other direction: standing in an enemy
   * marksman's range while your own attack timer is spent is how a laner
   * loses half their health without ever seeing a fight start. It only takes
   * the trade when the trade is actually free — the wave is not about to turn
   * around on it, no turret is watching, and it is not the one who is low.
   */
  private trade(world: World, player: Actor, ready: boolean, theirMinions: Actor[]): boolean {
    if (!ready || !this.wantsPunish) return false;
    const me = this.actor;
    if (this.reach(player) > me.attack.range) return false;
    if (this.insideTurret(this.lane.allyTurret, me.pos, 60)) return false;
    if (me.hp / me.maxHp < this.tuning.bravery) return false;

    // Minion aggro, which is the real price of every trade in a lane: touch a
    // champion with a wave next to them and the wave turns around and answers.
    // A disciplined laner counts the wave before it swings; a careless one
    // does not, which is exactly what `discipline` decides here.
    const nearTheirs = theirMinions.filter((m) => dist(m.pos, me.pos) < 520).length;
    const nearMine = this.lane.enemyMinions().filter((m) => dist(m.pos, me.pos) < 520).length;
    if (nearTheirs > nearMine && this.rng.next() < this.tuning.discipline) return false;
    // Already being shot by the wave: get out rather than pile in.
    const beingHit = world.actors.some(
      (a) => a.alive && a.team === 'player' && a.isMinion && a.targetId === me.id && world.time - a.lastAttackAt < AGGRO_MEMORY,
    );
    if (beingHit && this.rng.next() < this.tuning.discipline) return false;

    // The read itself: are they committed? A champion mid-windup, or one whose
    // own attack timer has just gone, cannot both take their minion and step
    // away from this. A weak laner throws the attack whenever the cooldown is
    // up; a strong one waits for that half second.
    const committed =
      player.phase === 'windup' ||
      player.attackCd > 0.12 ||
      (player.targetId !== null && world.byId(player.targetId)?.isMinion === true);
    if (!committed && this.rng.next() < this.tuning.discipline * 0.8) return false;

    world.issueAttackTarget(me, player.id);
    this.wantsPunish = false;
    this.armed = false;
    return true;
  }

  /**
   * What to do with the four buttons.
   *
   * In cooldown order at the bottom of the ladder and in priority order at the
   * top, which is the whole difference between somebody with a keyboard and
   * somebody playing the champion:
   *
   *  - **R** is the execute. It goes out when it kills, and never otherwise.
   *  - **E** is the escape hatch. It goes out when somebody is inside her
   *    reach, because being inside her reach is the only thing she is afraid
   *    of.
   *  - **W** is ground control. It goes where the player is about to stand:
   *    on the minion they are walking up to take, or behind them when they
   *    are already walking away.
   *  - **Q** is the poke, and the discipline is entirely about *when*: at a
   *    rooted or netted target it cannot miss, at a walking one it usually
   *    does. A disciplined laner also throws it through the wave when the wave
   *    is lined up, because that is three minions and a poke at once.
   */
  private spendKit(player: Actor, theirMinions: Actor[]): boolean {
    const me = this.actor;
    if (!this.kit.ready) return false;
    const gap = dist(me.pos, player.pos);
    const pinned = player.rootedFor > 0 || player.slowFor > 0;

    if (this.ranks.r > 0 && player.hp <= this.kit.damage.r && gap < CAITLYN_STATS.rRange) {
      if (this.spend('r', () => this.kit.command('r', player))) return true;
    }
    if (this.ranks.e > 0 && gap < CAITLYN_STATS.eRange * 0.55) {
      if (this.spend('e', () => this.kit.command('e', player))) return true;
    }
    if (this.ranks.q > 0 && pinned && gap < CAITLYN_STATS.qRange) {
      if (this.spend('q', () => this.kit.command('q', player))) return true;
    }
    if (this.ranks.w > 0 && this.tuning.discipline > 0.4) {
      // The trap goes on the minion they are about to take. That is the whole
      // of zoning: the cost of the last hit stops being an attack timer and
      // becomes a second and a quarter of standing still in her range.
      const bait = this.nextCsOf(player, theirMinions);
      if (bait && dist(me.pos, bait.pos) < CAITLYN_STATS.wRange) {
        if (this.spend('w', () => this.kit.command('w', player, bait.pos))) return true;
      }
    }
    // The most common mistake in the game at the bottom of the ladder: the
    // Peacemaker goes into the wave because it is off cooldown and there is a
    // wave. It clears nothing, it shoves the lane toward the enemy turret, and
    // it means the poke is not in hand when the trade actually happens. A
    // disciplined laner never does it; an iron one does it nearly every time.
    if (this.ranks.q > 0 && this.tuning.discipline < 0.55 && theirMinions.length > 1) {
      if (this.rng.next() > this.tuning.discipline * 1.4) {
        let near: Actor | null = null;
        for (const m of theirMinions) {
          if (dist(me.pos, m.pos) > CAITLYN_STATS.qRange * 0.8) continue;
          if (!near || dist(me.pos, m.pos) < dist(me.pos, near.pos)) near = m;
        }
        if (near) {
          const wasted = near;
          if (this.spend('q', () => this.kit.command('q', wasted))) return true;
        }
      }
    }
    if (this.ranks.q > 0 && gap < CAITLYN_STATS.qRange * 0.9) {
      // Saved for a target who cannot answer it, in proportion to how much
      // judgement this tier has. At the bottom it simply fires.
      const willing = !this.tuning.discipline || this.rng.next() > this.tuning.discipline * 0.72;
      const throughWave = this.linedUp(player, theirMinions) && this.tuning.discipline > 0.5;
      // Holding mana for the fight rather than spending the pool on poke is
      // the difference between a laner and somebody pressing a button. A
      // disciplined one keeps enough for the ultimate it is going to want.
      const reserve = this.ranks.r > 0 && this.tuning.discipline > 0.6 ? CAITLYN_MANA.cost.r : 0;
      const affordable = this.mana - CAITLYN_MANA.cost.q >= reserve;
      if ((willing || throughWave) && affordable) {
        if (this.spend('q', () => this.kit.command('q', player))) return true;
      }
    }
    return false;
  }

  /**
   * Press it, and pay for it — but only if it actually went out.
   *
   * The kit refuses a cast it cannot make (no cooldown, no angle, no line of
   * sight), and a laner who was charged mana for a cast that never happened
   * would slowly lose a lane to a bug rather than to an opponent.
   */
  private spend(slot: 'q' | 'w' | 'e' | 'r', cast: () => boolean): boolean {
    const cost = CAITLYN_MANA.cost[slot];
    if (this.mana < cost) return false;
    if (!cast()) return false;
    this.mana -= cost;
    return true;
  }

  /** The minion the player is most likely walking up to take. */
  private nextCsOf(player: Actor, theirMinions: Actor[]): Actor | null {
    let best: Actor | null = null;
    let bestHp = Infinity;
    for (const m of theirMinions) {
      if (dist(player.pos, m.pos) > player.attack.range + 260) continue;
      if (m.hp > player.attack.damage * 2.2) continue;
      if (m.hp < bestHp) {
        bestHp = m.hp;
        best = m;
      }
    }
    return best;
  }

  /** True when a Peacemaker aimed at the player also crosses their wave. */
  private linedUp(player: Actor, theirMinions: Actor[]): boolean {
    const me = this.actor;
    const dx = player.pos.x - me.pos.x;
    const dy = player.pos.y - me.pos.y;
    const len = Math.hypot(dx, dy) || 1;
    let crossed = 0;
    for (const m of theirMinions) {
      const t = ((m.pos.x - me.pos.x) * dx + (m.pos.y - me.pos.y) * dy) / (len * len);
      if (t < 0 || t > 1) continue;
      const px = me.pos.x + dx * t;
      const py = me.pos.y + dy * t;
      if (Math.hypot(m.pos.x - px, m.pos.y - py) < CAITLYN_STATS.qWidth / 2 + m.radius) crossed++;
    }
    return crossed >= 2;
  }

  /**
   * The mistake, performed on purpose.
   *
   * A weak laner attacks a healthy minion because the attack was available,
   * and the cost is that the wave is now pushing toward their own turret. It
   * is here so the player can watch somebody else make the mistake the drill
   * is grading *them* on — and so that beating a low tier hands you a shoved
   * wave to punish, which is the correct reward.
   */
  private wasteOne(world: World, theirMinions: Actor[]): boolean {
    const me = this.actor;
    const near = theirMinions.filter((m) => this.reach(m) <= me.attack.range);
    if (!near.length) return false;
    world.issueAttackTarget(me, near[this.rng.int(0, near.length)].id);
    this.wantsGreed = false;
    this.armed = false;
    return true;
  }

  /** Walk at them and finish it. */
  private commitToKill(world: World, player: Actor, ready: boolean): boolean {
    const me = this.actor;
    if (this.spendKit(player, this.lane.allyMinions())) return true;
    if (ready && this.reach(player) <= me.attack.range) {
      world.issueAttackTarget(me, player.id);
      this.armed = false;
      return true;
    }
    if (me.phase !== 'windup') {
      me.order = { kind: 'attackMove', pos: { ...player.pos } };
    }
    return true;
  }

  // -------------------------------------------------------------- the feet

  /**
   * Where a laner stands when it is not doing anything else.
   *
   * Four constraints, and every one of them is something a coach would say:
   * behind your own wave, out of their turret, at the edge of your range
   * rather than theirs, and off the exact line they are walking so that a
   * skillshot has to be aimed. The freeze adds a fifth — stand *behind* the
   * minions rather than beside them, so the wave stops moving.
   */
  private hold(world: World, player: Actor | undefined, seen: boolean): void {
    const me = this.actor;
    if (me.phase === 'idle') me.targetId = null;
    if (this.repositionCd > 0) return;
    this.repositionCd = 0.3;

    const front = this.lane.frontX();
    const hurt = me.hp / me.maxHp < 0.35;
    let goalX: number;
    switch (this.plan) {
      case 'retreat':
        goalX = Math.max(front + 420, this.lane.enemyTurret.pos.x - 300);
        break;
      case 'freeze':
        // Hold at the back of the wave: it stops the minions being pulled
        // forward by anything of hers and keeps the fight on her side.
        goalX = front + 320;
        break;
      case 'shove':
        goalX = front - 60;
        break;
      default:
        goalX = front + (hurt ? 340 : 150);
    }
    // Never inside the enemy turret unless a kill is actually on.
    const safeX = this.lane.allyTurret.pos.x + this.lane.allyTurret.attack.range + 110;
    if (this.plan !== 'allIn') goalX = Math.max(goalX, safeX);
    goalX = Math.min(goalX, this.lane.enemyGate.x + 160);

    // Off the line. A laner standing exactly level with you is a laner whose
    // skillshots are aimed for them; stepping to one side of the lane means a
    // Peacemaker has to be led, and means yours does too.
    const drift = player && seen ? Math.sign(me.pos.y - player.pos.y) || 1 : 1;
    const goalY = this.lane.laneY + drift * (this.plan === 'retreat' ? 40 : 110);

    if (Math.hypot(goalX - me.pos.x, goalY - me.pos.y) > 60 && me.phase !== 'windup') {
      world.issueMove(me, { x: goalX, y: goalY });
    }
  }

  // ------------------------------------------------------------- utilities

  private reach(a: Actor): number {
    return dist(this.actor.pos, a.pos) - a.radius;
  }

  private midX(): number {
    return (this.lane.allyTurret.pos.x + this.lane.enemyTurret.pos.x) / 2;
  }

  private insideTurret(turret: Actor, pos: Vec2, margin: number): boolean {
    return dist(pos, turret.pos) < turret.attack.range - margin;
  }
}
