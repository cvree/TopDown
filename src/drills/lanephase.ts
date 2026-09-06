import { audio } from '../engine/audio';
import { CAITLYN_COLOR, CAITLYN_LANE, CAITLYN_STATS, CaitlynKit, caitlynAtLevel } from '../engine/caitlyn';
import type { AbilitySlot } from '../engine/input';
import { LEAGUE_RULES, Lane, incomingDamage, pendingHits, sumPending, type PendingHit } from '../engine/lane';
import { LaneBot } from '../engine/lanebot';
import { XP_RADIUS, levelFromXp, levelProgress } from '../engine/levels';
import { clamp, dist } from '../engine/math';
import { PALETTE } from '../engine/palette';
import type { DrillPaint } from '../engine/paint';
import type { AbilityView, HudField, Session } from '../engine/session';
import type { Actor, Brush, Vec2, Wall } from '../engine/types';
import { VAYNE_MANA, VAYNE_SKILL_ORDER, vayneAtLevel, vayneManaAt } from '../engine/vayne';
import type { WorldEvent } from '../engine/world';
import { laneTierOf, type LaneTier } from '../progression/lane';
import { band, count, pct, rate, type DrillOutcome } from './base';
import { VayneDrill } from './vaynebase';

/**
 * LANE PHASE — the first ten minutes, against somebody.
 *
 * Everything else in this client is a rep: sixty seconds, one mechanic, one
 * number at the end. This is the other thing a trainer owes a player, and no
 * amount of reps adds up to it — the actual job, played end to end, against
 * an opponent doing the same job, with all of it happening at once.
 *
 * ### Why it is built exactly like this
 *
 * A lane is not a farming drill with a champion standing next to it. It is
 * four clocks running against each other, and every real decision in the first
 * ten minutes is about which clock you are prepared to lose:
 *
 *  - **The wave clock.** Thirteen minions every thirty seconds, a siege minion
 *    every third wave, all of it fighting the wave opposite. What that wave is
 *    doing decides where you are allowed to stand.
 *  - **The attack clock.** Your last hit is not a click, it is a windup plus a
 *    missile, and the health bar you are aiming at is being changed by six
 *    other bodies while you commit to it.
 *  - **The level clock.** Two hundred and eighty experience is level two, and
 *    the first person to it wins the next thirty seconds. Standing back to be
 *    safe costs you a share of the wave you were not near enough to earn.
 *  - **The health clock.** Every step into their range is a trade, and it is
 *    only a good one if you can count what it cost.
 *
 * Because all four run at once, this mode is the only one in the client that
 * can measure the thing a player actually wants to know: not whether their
 * hands are quick, but whether they can farm cleanly while somebody is making
 * it expensive. That is what "excelling at lane" means and it is a different
 * skill from any single mechanic in it.
 *
 * ### Everything is League's
 *
 * The minions are League's minions, health, gold and experience alike; the
 * turret is League's outer turret, 775 units, 152 a shot, ramping forty per
 * cent a shot into a champion; the wave clock is thirty seconds; the level
 * curve, respawn timers and passive gold are all League's. Both champions
 * start at level one on base statistics and grow off League's own curve.
 *
 * Mana is modelled here and nowhere else in the client, because it is one of
 * the two or three things that give the first ten minutes their shape: a
 * Peacemaker every ten seconds for a whole lane is not a lane, it is a
 * metronome, and the thing that stops it is a bar rather than a cooldown.
 *
 * What is *not* modelled is stated rather than hidden: there is no shop, so
 * gold is the scoreboard rather than a purchase; there is no jungler, so
 * nobody is about to walk out of the river; and resistances are folded into
 * the health pools rather than simulated, because both champions in this lane
 * deal physical damage and one multiplication is exact where two systems would
 * be theatre. Every one of those makes the lane cleaner rather than easier,
 * and none of them changes what a last hit is.
 */

// ---------------------------------------------------------------- the clock

/**
 * The minute the run opens on.
 *
 * League's first wave leaves the base at 0:05 and meets in the middle at about
 * 1:05, and a trainer that made you stand in an empty lane for a minute to be
 * faithful about it would be faithful about the wrong thing. So the clock
 * starts where the lane does: 1:05, with wave one walking in. Every wave after
 * that arrives exactly thirty seconds apart, which means the wave numbers and
 * the cannon minutes line up with the ones a player already counts.
 */
const START_CLOCK = 65;

/**
 * League's base respawn wait, by level.
 *
 * These are the real figures, and the time-of-game multiplier that stretches
 * them later on is not modelled because it does not begin until fifteen
 * minutes — which is to say, this table is exact for every death this mode can
 * contain.
 */
const RESPAWN_BY_LEVEL = [6, 6, 8, 8, 10, 10, 12, 12, 14, 16, 20, 21, 26, 28.5, 32.5, 34.5, 36.5, 42.5];

/** League: passive gold starts at 1:50 and pays 20.4 every ten seconds. */
const PASSIVE_GOLD_FROM = 110;
const PASSIVE_GOLD_PER_SEC = 2.04;

/** League: a kill on an even champion is 300 gold before shutdowns and streaks. */
const KILL_GOLD = 300;

/** League: what a kill on an equal-level champion is worth in experience. */
const CHAMPION_KILL_XP = [42, 114, 144, 174, 204, 234, 264, 294, 324, 354, 384, 414, 444, 474, 504, 534, 564, 594];

/** League: recall is an eight second channel, broken by damage or movement. */
const RECALL_CHANNEL = 8;

/** How long the mode waits before sweeping a lane's worth of dead minions. */
const REAP_EVERY = 4;

/** What each slot is called when a level hands it to you. */
const ABILITY_NAMES = { q: 'TUMBLE', w: 'SILVER BOLTS', e: 'CONDEMN', r: 'FINAL HOUR' } as const;

const table = (t: readonly number[], level: number): number =>
  t[Math.min(t.length, Math.max(1, Math.round(level))) - 1];

export class LanePhaseDrill extends VayneDrill {
  private lane!: Lane;
  private sheriff!: CaitlynKit;
  private bot!: LaneBot;
  private tier: LaneTier;

  // ------------------------------------------------------------ your lane
  private cs = 0;
  private gold = 0;
  private xp = 0;
  private level = 1;
  private ranks = { q: 0, w: 0, e: 0, r: 0 };
  /** Points actually spent, so a level can never drift ahead of the bar. */
  private pointsSpent = 0;
  private kills = 0;
  private deaths = 0;
  /** The other bar. See `VAYNE_MANA` for why this mode has one and no other does. */
  private mana = 0;
  private manaMax = 0;
  private manaRegen = 0;
  /** Casts refused for want of mana, which is a lane mistake with a name. */
  private dryCasts = 0;
  private cannons = 0;
  private underTurret = 0;
  private perfect = 0;
  private missed = 0;
  private missedLate = 0;
  private missedEarly = 0;
  private missedToTurret = 0;
  private wastedHits = 0;
  private wastedDamage = 0;
  private attacksThrown = 0;
  /** Enemy minions that have died at all, yours or not: the denominator. */
  private enemyMinionsLost = 0;
  /** The same figure for her side of the wave, which is the bot's denominator. */
  private allyMinionsLost = 0;
  private damageToRival = 0;
  private damageTaken = 0;
  private minionHitsTaken = 0;
  private turretHitsTaken = 0;
  /** Seconds spent standing inside the enemy laner's reach. */
  private timeInHerRange = 0;
  /** Seconds spent close enough to a dying minion to be paid for it. */
  private timeInXpRange = 0;

  private hits = new Map<number, number>();
  private spent = new Map<number, number>();
  private pending: PendingHit[] = [];

  // ------------------------------------------------------------- lifecycle
  private deadFor = 0;
  private rivalDeadFor = 0;
  private recallLeft = 0;
  private recallFrom: Vec2 | null = null;
  private recalls = 0;
  private rivalRecallLeft = 0;
  private lastHurtAt = -99;
  private reapCd = REAP_EVERY;
  private taughtAggro = false;
  private taughtTurret = false;
  private lastWaveBanner = 0;

  constructor(s: Session) {
    // Level one: no points spent, so nothing is on the bar but the trinket.
    // Every ability arrives when the lane pays for it, which is the whole
    // reason the first two minutes of a game of League feel the way they do.
    super(s, {
      tumble: false,
      bolts: false,
      condemn: false,
      finalHour: false,
      ward: true,
      leagueCooldowns: true,
      ranks: { q: 1, w: 1, e: 1, r: 1 },
    });
    this.tier = laneTierOf(s.config.difficulty);
  }

  private get d(): number {
    return this.s.config.difficulty;
  }

  /**
   * How much the mode draws for you.
   *
   * The same three steps the gesture drill uses, keyed off the tier rather
   * than off a slider: below gold you get the full plate — what is already on
   * its way to this minion, where your attack lands it, and a word for the
   * mistake — at gold and diamond you keep the plate and lose the prompt, and
   * at challenger the health bar is the health bar. The read never changes;
   * only whether the client is doing it for you.
   */
  private get coach(): 'full' | 'marks' | 'off' {
    return this.d < 0.4 ? 'full' : this.d < 0.7 ? 'marks' : 'off';
  }

  /** A lane survives a death. That is what a lane *is*. */
  get survivesDeath(): boolean {
    return true;
  }

  /** The game clock, in seconds, as League would show it. */
  get clock(): number {
    return START_CLOCK + this.s.elapsed;
  }

  // ------------------------------------------------------------------ setup

  setup(): void {
    const { w, h } = this.s.world.bounds;
    this.terrain();
    this.lane = new Lane(this.s.world, this.s.rng, {
      bounds: { w, h },
      difficulty: this.d,
      rules: LEAGUE_RULES,
      turretInset: 0.09,
    });
    if (this.s.config.fogOfWar !== false) this.s.world.enableVision();

    this.spawnVayne({ x: this.lane.allyGate.x + 420, y: this.lane.laneY + 150 });
    // Level one comes with a point in it, exactly as it does in a game.
    this.spendPoints();
    this.applyPlayerLevel();
    this.spawnRival();
  }

  /**
   * The lane as a piece of ground.
   *
   * Two walls running the length of it and four bushes — a pair flanking the
   * middle and one on each half — which is the shape of every solo lane in the
   * game and is load-bearing rather than decoration:
   *
   *  - **The walls** are what a Condemn is for. A knockback in open ground is
   *    a nuisance; a knockback into the lane wall is a stun and half your
   *    damage, and the whole skill is having stood on the right side of the
   *    lane before the fight started.
   *  - **The bushes** are the only place in the lane where somebody can stop
   *    being visible. They are where a level two all-in comes from, they are
   *    where you go to break the line on a Peacemaker, and they are the reason
   *    the trinket in your D slot is worth pressing.
   */
  private terrain(): void {
    const { w, h } = this.s.world.bounds;
    const midY = h * 0.5;
    const walls: Wall[] = [
      { x: w * 0.5, y: midY - 560, w: w * 0.92, h: 150 },
      { x: w * 0.5, y: midY + 560, w: w * 0.92, h: 150 },
    ];
    this.s.world.walls = walls;
    const brush: Brush[] = [
      { x: w * 0.5, y: midY - 330, w: 460, h: 170 },
      { x: w * 0.5, y: midY + 330, w: 460, h: 170 },
      { x: w * 0.22, y: midY + 330, w: 380, h: 170 },
      { x: w * 0.78, y: midY - 330, w: 380, h: 170 },
    ];
    this.s.world.brush = brush;
  }

  /**
   * The other laner.
   *
   * A real champion with a real kit, because the alternative — a body with a
   * basic attack — cannot teach the half of laning that is about somebody
   * else's cooldowns. Caitlyn is the matchup on purpose: 650 range against
   * Vayne's 550 means every trade in this lane starts from behind, and every
   * unit of that gap has to be taken deliberately, at a moment you chose, or
   * not at all. It is the hardest fair lane this client can field, and it is
   * one a player will actually meet.
   */
  private spawnRival(): Actor {
    const stats = caitlynAtLevel(1);
    const a = this.s.world.spawnActor({
      pos: { x: this.lane.enemyGate.x - 420, y: this.lane.laneY - 150 },
      team: 'enemy',
      maxHp: stats.hp,
      radius: CAITLYN_STATS.radius,
      moveSpeed: CAITLYN_STATS.moveSpeed,
      unitKind: 'champion',
      archetype: 'ranger',
      label: 'CAITLYN',
      attack: { ...CAITLYN_STATS.attack },
    });
    this.sheriff = new CaitlynKit(this.s, { peacemaker: true, trap: true, net: true, ace: true });
    this.sheriff.attach(a);
    // A lane phase charges her real cooldowns, for the same reason it charges
    // yours: ten minutes is long enough to contain them, and counting them is
    // half of what a laning phase is.
    this.sheriff.cdShare = 1;
    this.bot = new LaneBot(a, this.sheriff, this.lane, this.s.rng, this.d, CAITLYN_LANE.skillOrder);
    this.lane.rival = a;
    return a;
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    super.update(dt);
    this.lane.update(dt);
    this.clockKeeping(dt);

    const p = this.s.world.player;
    const her = this.bot.actor;

    if (p && !p.alive) this.waitToRespawn(dt);
    else if (p) this.stepRecall(dt, p);

    // Her kit first, then her head. The kit owns her cooldowns, her traps and
    // the cast she is halfway through; the bot owns what she does next, and it
    // has to be looking at a kit whose clocks have already ticked this frame.
    this.sheriff.update(dt);
    if (her.alive) {
      if (this.rivalRecallLeft > 0) this.stepRivalRecall(dt, her);
      else this.bot.update(this.s.world, dt);
      this.considerRivalRecall();
    } else {
      this.waitForRival(dt, her);
    }

    this.regenerate(dt, p);
    this.sample(dt, p, her);

    for (const e of this.lane.drainEvents()) {
      if (this.s.world.time - this.lastWaveBanner < 0.5) continue;
      this.lastWaveBanner = this.s.world.time;
      if (e.kind === 'cannon') {
        this.s.setBanner(`WAVE ${e.wave} · CANNON · 60 GOLD`, 1.6);
        audio.play('announce', { intensity: 0.5 });
      }
    }

    // Twenty waves of thirteen minions is a lot of bodies to leave lying
    // about, and unit separation compares every pair of them.
    this.reapCd -= dt;
    if (this.reapCd <= 0) {
      this.reapCd = REAP_EVERY;
      this.s.world.reapMinions();
    }
  }

  /**
   * Passive gold, which League starts paying at 1:50 and never stops.
   *
   * Both sides of the lane are paid it, and that matters more than it looks:
   * the gold difference is the number the mode leads with, and one that
   * counted only your own trickle would read as a lead you had not earned.
   */
  private clockKeeping(dt: number): void {
    if (this.clock < PASSIVE_GOLD_FROM) return;
    this.gold += PASSIVE_GOLD_PER_SEC * dt;
    this.bot.ledger.gold += PASSIVE_GOLD_PER_SEC * dt;
  }

  /**
   * Health regeneration, at League's rate, which is to say hardly any.
   *
   * A laner regenerates about a health point a second at level one. That is
   * nothing next to a trade, and it is supposed to be: the reason a lane phase
   * has a shape at all is that health does not come back on its own, so being
   * chipped is a real state you have to do something about — hold, disengage,
   * or spend eight seconds recalling and give up two waves of experience for
   * a full bar. That decision is the mode.
   */
  private regenerate(dt: number, p: Actor | undefined): void {
    const her = this.bot.actor;
    const rate = (hp5: number): number => hp5 / 5;
    if (p && p.alive && p.hp < p.maxHp) {
      // League: Vayne regenerates 3.5 health every five seconds, +0.55 a level.
      p.hp = Math.min(p.maxHp, p.hp + rate(3.5 + 0.55 * (this.level - 1)) * dt);
    }
    this.mana = Math.min(this.manaMax, this.mana + this.manaRegen * dt);
    if (her.alive && her.hp < her.maxHp) {
      // League: Caitlyn regenerates 3.5 every five seconds, +0.55 a level.
      her.hp = Math.min(her.maxHp, her.hp + rate(3.5 + 0.55 * (this.bot.ledger.level - 1)) * dt);
    }
  }

  /** Two running totals that only mean anything measured every frame. */
  private sample(dt: number, p: Actor | undefined, her: Actor): void {
    if (!p || !p.alive) return;
    if (her.alive && dist(p.pos, her.pos) <= her.attack.range + p.radius) this.timeInHerRange += dt;
    const front = this.lane.frontX();
    if (Math.abs(p.pos.x - front) <= XP_RADIUS) this.timeInXpRange += dt;
  }

  // ------------------------------------------------------------- levelling

  /**
   * Experience arrives, and with it a point.
   *
   * The skill order is taken automatically off the champion's standard one
   * rather than opened as a menu mid-run, because a mode about laning should
   * not stop to ask a question every ninety seconds — and because the standard
   * order is standard for good reasons the player can look up. What the mode
   * does owe you is to say which button just appeared, loudly, since a level
   * that arrives unnoticed is a level you do not use.
   */
  private gainXp(amount: number): void {
    this.xp += amount;
    const level = levelFromXp(this.xp);
    if (level <= this.level) return;
    this.level = level;
    const taken = this.spendPoints();
    this.applyPlayerLevel();
    const name = taken ? ABILITY_NAMES[taken] : '';
    this.s.setBanner(`LEVEL ${this.level}${name ? ` · ${name}` : ''}`, 1.6);
    audio.play('abilityReady');
    const p = this.s.world.player;
    if (p) this.s.fx.ring(p.pos.x, p.pos.y, p.radius, p.radius + 190, 0.5, PALETTE.good, 4, 'shock');
  }

  /**
   * Take every point the level has paid for, and return the last one taken.
   *
   * A champion has one point at level one — that is the whole of the level one
   * invade, and a mode that handed you an empty bar until level two would be
   * modelling a game nobody plays. So points are spent up to the level rather
   * than on the transition into it, which also means a run cannot drift a
   * point behind the level it is printing.
   */
  private spendPoints(): keyof typeof ABILITY_NAMES | null {
    let last: keyof typeof ABILITY_NAMES | null = null;
    while (this.pointsSpent < this.level && this.pointsSpent < VAYNE_SKILL_ORDER.length) {
      const slot = VAYNE_SKILL_ORDER[this.pointsSpent];
      this.pointsSpent++;
      this.ranks[slot] = Math.min(slot === 'r' ? 3 : 5, this.ranks[slot] + 1);
      this.kit.ranks[slot] = Math.max(1, this.ranks[slot]);
      if (slot === 'q') this.kit.loadout.tumble = true;
      if (slot === 'w') this.kit.loadout.bolts = true;
      if (slot === 'e') this.kit.loadout.condemn = true;
      if (slot === 'r') this.kit.loadout.finalHour = true;
      last = slot;
    }
    return last;
  }

  /** Rebuild the champion's body around the level she has actually reached. */
  private applyPlayerLevel(): void {
    const p = this.s.world.player;
    if (!p) return;
    const stats = vayneAtLevel(this.level);
    const share = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    p.maxHp = stats.hp;
    p.hp = Math.min(stats.hp, stats.hp * share);
    p.attack.damage = stats.ad;
    p.attack.attackSpeed = stats.attackSpeed;
    const pool = vayneManaAt(this.level);
    // A level raises the ceiling and hands you the difference; it does not
    // refill you. That is League, and it is why a level six all-in is
    // something you have to have saved for.
    this.mana = this.manaMax > 0 ? this.mana + (pool.max - this.manaMax) : pool.max;
    this.manaMax = pool.max;
    this.manaRegen = pool.regen;
  }

  // ------------------------------------------------------- death and recall

  /** League's respawn wait, and then a body at the fountain to walk back with. */
  private waitToRespawn(dt: number): void {
    this.deadFor -= dt;
    if (this.deadFor > 0) return;
    const p = this.s.world.player;
    if (!p) return;
    p.alive = true;
    p.hp = p.maxHp;
    this.mana = this.manaMax;
    p.phase = 'idle';
    p.phaseTime = 0;
    p.attackCd = 0;
    p.order = null;
    p.targetId = null;
    p.rootedFor = 0;
    p.slowFor = 0;
    this.s.world.place(p, 60, this.lane.laneY);
    this.s.setBanner('BACK IN THE LANE', 1.4);
  }

  private waitForRival(dt: number, her: Actor): void {
    this.rivalDeadFor -= dt;
    if (this.rivalDeadFor > 0) return;
    her.alive = true;
    her.hp = her.maxHp;
    her.phase = 'idle';
    her.phaseTime = 0;
    her.attackCd = 0;
    her.order = null;
    her.targetId = null;
    her.rootedFor = 0;
    her.slowFor = 0;
    this.s.world.place(her, this.s.world.bounds.w - 60, this.lane.laneY);
    this.sheriff.attach(her);
    this.sheriff.cdShare = 1;
    this.sheriff.autopilot = false;
    this.sheriff.applyLevel(this.bot.ledger.level, this.bot.ranks);
    her.hp = her.maxHp;
    this.bot.mana = this.bot.manaMax;
  }

  /**
   * The back.
   *
   * Eight seconds of standing still, broken by a step or a hit, and then a
   * full health bar at the cost of every minion that dies while you are gone.
   * It is on the bar because it is a decision rather than a mechanic, and it
   * is the decision that separates a laner who is losing from a laner who has
   * lost: at forty per cent health with the wave pushing toward you, taking
   * eight seconds now is cheap and taking them in thirty seconds is a death.
   */
  private stepRecall(dt: number, p: Actor): void {
    if (this.recallLeft <= 0) return;
    const moved = this.recallFrom ? dist(this.recallFrom, p.pos) : 0;
    if (moved > 12 || this.s.world.time - this.lastHurtAt < 0.2) {
      this.recallLeft = 0;
      this.recallFrom = null;
      this.s.micro('RECALL BROKEN', p.pos, PALETTE.danger);
      return;
    }
    this.recallLeft -= dt;
    if (this.recallLeft > 0) return;
    this.recalls++;
    this.recallFrom = null;
    p.hp = p.maxHp;
    this.mana = this.manaMax;
    p.order = null;
    p.targetId = null;
    this.s.world.place(p, 60, this.lane.laneY);
    this.s.setBanner('BASE · FULL HEALTH', 1.3);
    audio.play('resultsReveal', 0.6);
  }

  /** She backs for exactly the same reasons, and pays exactly the same price. */
  private considerRivalRecall(): void {
    const her = this.bot.actor;
    if (this.rivalRecallLeft > 0 || !her.alive) return;
    if (her.hp / her.maxHp > 0.3) return;
    if (this.bot.tuning.discipline < 0.3) return;
    const p = this.s.world.player;
    if (p && p.alive && dist(p.pos, her.pos) < 1000) return;
    if (dist(her.pos, this.lane.enemyTurret.pos) > this.lane.enemyTurret.attack.range) return;
    this.rivalRecallLeft = RECALL_CHANNEL;
    this.s.setBanner('CAITLYN IS RECALLING', 1.4);
  }

  private stepRivalRecall(dt: number, her: Actor): void {
    const p = this.s.world.player;
    if (p && p.alive && dist(p.pos, her.pos) < 700) {
      this.rivalRecallLeft = 0;
      return;
    }
    her.rootedFor = Math.max(her.rootedFor, 0.1);
    this.rivalRecallLeft -= dt;
    if (this.rivalRecallLeft > 0) return;
    her.hp = her.maxHp;
    this.bot.mana = this.bot.manaMax;
    her.order = null;
    her.targetId = null;
    this.s.world.place(her, this.s.world.bounds.w - 60, this.lane.laneY);
  }

  // ----------------------------------------------------------------- input

  onAbility(slot: AbilitySlot, at: Vec2): void {
    if (slot !== 'f') {
      const cost = VAYNE_MANA.cost[slot] ?? 0;
      if (cost > this.mana) {
        // Refused, and said so. A cast that silently does nothing is the
        // single most infuriating thing a client can do, and in a lane the
        // reason is nearly always the bar you were not watching.
        this.dryCasts++;
        const p = this.s.world.player;
        if (p) this.s.micro('NO MANA', p.pos, PALETTE.warn);
        return;
      }
      if (this.kit.cast(slot, at) === 'cast') this.mana -= cost;
      return;
    }
    const p = this.s.world.player;
    if (!p || !p.alive) return;
    if (this.recallLeft > 0) {
      this.recallLeft = 0;
      this.recallFrom = null;
      return;
    }
    this.recallLeft = RECALL_CHANNEL;
    this.recallFrom = { ...p.pos };
    this.s.micro('RECALLING', p.pos, PALETTE.accent);
  }

  abilities(): AbilityView[] {
    return super.abilities().map((a) =>
      a.slot === 'f'
        ? {
            ...a,
            name: this.recallLeft > 0 ? `RECALL ${this.recallLeft.toFixed(1)}s` : 'RECALL',
            locked: false,
            cd: this.recallLeft > 0 ? this.recallLeft / RECALL_CHANNEL : 0,
            highlight: this.recallLeft > 0,
          }
        : a,
    );
  }

  // ---------------------------------------------------------------- the read

  /**
   * Where a minion's health will be when an attack started now lands.
   *
   * The same arithmetic the gesture drill does, and it has to be, because it
   * is the arithmetic the player's own eyes are being trained to do: your
   * windup plus your missile's flight, minus everything already thrown by
   * everybody else. Your own committed damage is excluded — asking "should I
   * attack this" while counting the attack you already made is how a minion
   * eats two of your attacks and buys you nothing.
   */
  private read(m: Actor, p: Actor): {
    incoming: number;
    hpAtLanding: number;
    hpSoon: number;
    mineInFlight: number;
    inRange: boolean;
  } {
    const cycle = 1 / Math.max(0.05, p.attack.attackSpeed);
    const gap = Math.max(0, dist(p.pos, m.pos) - m.radius);
    const travel = p.attack.projectileSpeed > 0 ? gap / p.attack.projectileSpeed : 0;
    const windup = p.phase === 'windup' && p.targetId === m.id ? p.phaseTime : cycle * p.attack.windupRatio;
    const lead = windup + travel;
    const hits = pendingHits(this.s.world, m, this.pending);
    return {
      incoming: sumPending(hits, lead, { exclude: p.id }),
      hpAtLanding: m.hp - sumPending(hits, lead, { exclude: p.id }),
      hpSoon: m.hp - sumPending(hits, lead + 1.2, { exclude: p.id }),
      mineInFlight: sumPending(hits, Infinity, { only: p.id }),
      inRange: gap <= p.attack.range,
    };
  }

  // ----------------------------------------------------------------- paint

  paint(out: DrillPaint, t: number): void {
    super.paint(out, t);
    const p = this.s.world.player;
    if (!p) return;
    const coach = this.coach;

    // The lane itself, drawn as a road. The arena floor is generated terrain
    // with no opinion about where a lane is, and a wave walking left to right
    // across open ground reads as a brawl rather than as a lane.
    out.markers.push({
      kind: 'line',
      x: this.lane.allyGate.x - 200,
      y: this.lane.laneY,
      x2: this.lane.enemyGate.x + 200,
      y2: this.lane.laneY,
      halfWidth: 210,
      color: PALETTE.textFaint,
      alpha: 0.14,
      fill: 1,
      rise: 0.4,
    });

    for (const turret of [this.lane.allyTurret, this.lane.enemyTurret]) {
      const ally = turret.team === 'player';
      const inside = dist(p.pos, turret.pos) < turret.attack.range;
      const hot = !ally && inside;
      out.markers.push({
        kind: 'ring',
        x: turret.pos.x,
        y: turret.pos.y,
        radius: turret.attack.range,
        color: ally ? PALETTE.accentDim : PALETTE.danger,
        alpha: hot ? 0.34 + 0.16 * Math.sin(t * 6) : 0.085,
        width: hot ? 4 : 2,
        dash: 110,
        spin: ally ? 0.05 : -0.05,
      });
      const victim = this.s.world.byId(turret.targetId);
      if (victim?.alive && turret.phase === 'windup') {
        out.markers.push({
          kind: 'line',
          x: turret.pos.x,
          y: turret.pos.y,
          x2: victim.pos.x,
          y2: victim.pos.y,
          halfWidth: 3,
          color: ally ? PALETTE.accent : PALETTE.warn,
          alpha: 0.5,
          rise: 2,
        });
      }
    }

    // Her reach, and yours.
    //
    // The hundred units between 650 and 550 is the entire matchup, and below
    // challenger the mode draws it, because a gap you cannot see is a gap you
    // learn by dying to it four hundred times. At the top it is gone and the
    // spacing is yours to hold — which is the same promise every other mode
    // in this client makes about a range indicator.
    const her = this.bot.actor;
    if (her.alive && coach !== 'off' && this.s.world.visible(her)) {
      out.markers.push({
        kind: 'ring',
        x: her.pos.x,
        y: her.pos.y,
        radius: her.attack.range,
        color: CAITLYN_COLOR,
        alpha: 0.16,
        width: 2,
        dash: 60,
      });
    }

    for (const m of this.lane.enemyMinions()) {
      const r = this.read(m, p);
      const threshold = p.attack.damage / m.maxHp;
      const incomingShare = Math.min(m.hp / m.maxHp, r.incoming / m.maxHp);

      let tone: 'ready' | 'soon' | 'losing' | undefined;
      let note: string | undefined;
      if (r.mineInFlight > 0) {
        tone = 'ready';
        note = coach === 'off' ? undefined : 'IN FLIGHT';
      } else if (r.hpAtLanding <= 0) {
        tone = 'losing';
        note = coach === 'full' ? 'GONE' : undefined;
      } else if (r.hpAtLanding <= p.attack.damage) {
        tone = 'ready';
        note = coach === 'full' ? (r.inRange ? 'FIRE' : 'WALK UP') : undefined;
      } else if (r.hpSoon <= p.attack.damage) {
        tone = 'soon';
      }

      out.plates.push({
        actorId: m.id,
        // The damage-in-flight wash survives every coaching level, including
        // the one that draws nothing else. Those missiles and windups are
        // already on the screen; aggregating them onto the bar is legibility
        // rather than advice. The tick and the tone name the decision, so they
        // are the parts that go.
        incoming: incomingShare,
        threshold: coach === 'off' ? undefined : threshold,
        tone: coach === 'off' ? undefined : tone,
        note,
      });

      if (m.unitKind === 'cannon') {
        out.billboards.push({ kind: 'caret', x: m.pos.x, y: m.pos.y, color: PALETTE.warn, lift: 190 });
      }
    }

    // What she is doing, in one word, above her head. Not a hint — the plan
    // is already legible from where she is standing and what she is shooting;
    // naming it is what turns "the bot suddenly walked at me" into "she
    // counted lethal and I did not".
    if (her.alive && this.s.world.visible(her) && coach !== 'off') {
      const label =
        this.rivalRecallLeft > 0
          ? 'RECALLING'
          : this.bot.plan === 'allIn'
            ? 'GOING FOR IT'
            : this.bot.plan === 'retreat'
              ? 'BACKING OFF'
              : this.bot.plan === 'freeze'
                ? 'HOLDING THE WAVE'
                : this.bot.plan === 'shove'
                  ? 'SHOVING'
                  : 'FARMING';
      out.billboards.push({
        kind: 'label',
        x: her.pos.x,
        y: her.pos.y,
        text: label,
        color: CAITLYN_COLOR,
        size: 14,
      });
    }

    if (this.recallLeft > 0 && p.alive) {
      out.billboards.push({
        kind: 'timerBar',
        x: p.pos.x,
        y: p.pos.y,
        progress: 1 - this.recallLeft / RECALL_CHANNEL,
        color: PALETTE.accent,
        lift: 150,
      });
    }
  }

  // ---------------------------------------------------------------- events

  onEvents(events: readonly WorldEvent[]): void {
    super.onEvents(events);
    const pid = this.s.world.playerId;
    const her = this.bot.actor;
    for (const e of events) {
      if (e.type === 'attackRelease' && e.actorId != null) {
        const a = this.s.world.byId(e.actorId);
        if (a?.unitKind === 'turret') this.lane.noteTurretShot(a.id);
        if (e.actorId === pid) {
          const t = this.s.world.byId(e.targetId);
          if (t?.isMinion && t.team === 'enemy') this.attacksThrown++;
        }
      }

      if (e.type === 'attackLand' && e.actorId === pid && e.targetId != null) {
        const t = this.s.world.byId(e.targetId);
        if (t?.isMinion && t.team === 'enemy') {
          this.hits.set(t.id, (this.hits.get(t.id) ?? 0) + 1);
          this.spent.set(t.id, (this.spent.get(t.id) ?? 0) + (e.amount ?? 0));
        }
      }

      if (e.type === 'damage') {
        if (e.targetId === pid) this.notePlayerHurt(e);
        else if (e.targetId === her.id && e.actorId === pid) this.damageToRival += e.amount ?? 0;
      }
      if (e.type === 'death' && e.actorId != null) this.noteDeath(e, pid);
    }
    this.sheriff.onEvents(events);
  }

  private notePlayerHurt(e: WorldEvent): void {
    const src = this.s.world.byId(e.actorId);
    this.lastHurtAt = this.s.world.time;
    this.damageTaken += e.amount ?? 0;
    if (!src) return;
    if (src.isMinion) {
      this.minionHitsTaken++;
      if (!this.taughtAggro) {
        this.taughtAggro = true;
        this.s.setBanner('MINION AGGRO · THEY ANSWER WHEN YOU TOUCH A CHAMPION', 2.6);
      }
    } else if (src.unitKind === 'turret') {
      this.turretHitsTaken++;
      if (!this.taughtTurret) {
        this.taughtTurret = true;
        this.s.setBanner('TURRET AGGRO · EVERY SHOT HURTS MORE THAN THE LAST', 2.6);
      }
    }
  }

  /**
   * Somebody died, and who it was decides four different ledgers.
   *
   * Minions pay gold to whoever landed the killing blow and experience to
   * whichever champion was near enough — those are two separate questions in
   * League and they are two separate questions here, which is exactly why
   * standing back to be safe still costs you something even when you were
   * never going to get the last hit.
   */
  private noteDeath(e: WorldEvent, pid: number): void {
    const victim = this.s.world.byId(e.actorId);
    if (!victim || !e.pos) return;
    const killer = this.s.world.byId(e.targetId);
    const her = this.bot.actor;

    if (victim.id === pid) {
      this.deaths++;
      this.deadFor = table(RESPAWN_BY_LEVEL, this.level);
      this.recallLeft = 0;
      // A kill is a champion's kill. Dying to the wave or to the turret still
      // costs you the respawn and the minutes, and it pays her nothing —
      // which is exactly League, and worth being exact about, because "I fed
      // them" and "I threw a lane away to a caster minion" are different
      // mistakes with different fixes.
      if (killer && killer.id === her.id) {
        this.bot.ledger.kills++;
        this.bot.ledger.gold += KILL_GOLD;
        this.bot.gainXp(table(CHAMPION_KILL_XP, this.level));
      }
      this.s.setBanner(`KILLED · BACK IN ${this.deadFor.toFixed(0)}s`, 2.2);
      return;
    }

    if (victim.id === her.id) {
      this.bot.ledger.deaths++;
      this.rivalDeadFor = table(RESPAWN_BY_LEVEL, this.bot.ledger.level);
      this.rivalRecallLeft = 0;
      if (e.byPlayer) {
        this.kills++;
        this.gold += KILL_GOLD;
        this.gainXp(table(CHAMPION_KILL_XP, this.bot.ledger.level));
        this.s.setBanner('KILL · 300 GOLD', 1.8);
      }
      return;
    }

    if (!victim.isMinion) return;
    const p = this.s.world.player;
    const xp = this.lane.xpFor(victim);

    // Their minion: your farm, your experience.
    if (victim.team === 'enemy') {
      this.enemyMinionsLost++;
      if (p && p.alive && dist(p.pos, victim.pos) <= XP_RADIUS) this.gainXp(xp);
      this.creditYourFarm(victim, killer, e, pid);
      return;
    }

    // Your minion: hers.
    this.allyMinionsLost++;
    if (her.alive && dist(her.pos, victim.pos) <= XP_RADIUS) {
      this.bot.gainXp(xp);
    }
    if (killer && killer.id === her.id) {
      this.bot.ledger.cs++;
      this.bot.ledger.gold += victim.goldValue ?? 0;
    }
  }

  /** The last-hit ledger, and the three different ways one gets away. */
  private creditYourFarm(victim: Actor, killer: Actor | undefined, e: WorldEvent, pid: number): void {
    const hits = this.hits.get(victim.id) ?? 0;
    if (e.byPlayer) {
      this.cs++;
      this.gold += victim.goldValue ?? 0;
      if (victim.unitKind === 'cannon') this.cannons++;
      if (dist(victim.pos, this.lane.allyTurret.pos) < this.lane.allyTurret.attack.range) this.underTurret++;
      audio.play('pickup', { intensity: 0.7, pan: this.s.panOf(victim.pos) });
      if (hits <= 1) {
        this.perfect++;
        this.s.chain++;
        this.s.chainBest = Math.max(this.s.chainBest, this.s.chain);
        audio.setComboPitch(this.s.chain);
        audio.play('perfect');
        this.s.micro(`+${victim.goldValue ?? 0}`, victim.pos, PALETTE.good);
      } else {
        this.wastedHits += hits - 1;
        this.s.micro(`+${victim.goldValue ?? 0} · ${hits} HITS`, victim.pos, PALETTE.warn);
      }
    } else {
      this.missed++;
      this.s.chain = 0;
      audio.setComboPitch(0);
      this.wastedDamage += this.spent.get(victim.id) ?? 0;
      if (killer?.unitKind === 'turret') this.missedToTurret++;
      const committed = incomingDamage(this.s.world, victim, 3, { only: pid }) > 0;
      if (committed) {
        this.missedLate++;
        this.s.micro('TOO LATE', victim.pos, PALETTE.danger);
      } else if (hits > 0) {
        this.missedEarly++;
        this.s.micro('TOO EARLY', victim.pos, PALETTE.danger);
      } else if (victim.unitKind === 'cannon') {
        this.s.micro('CANNON LOST · 60 GOLD', victim.pos, PALETTE.danger);
      }
    }
    this.hits.delete(victim.id);
    this.spent.delete(victim.id);
  }

  // ------------------------------------------------------------------- hud

  /** mm:ss, because a lane is read on a game clock and nothing else. */
  private static clockText(s: number): string {
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  hudFields(): HudField[] {
    const perMin = this.cs / Math.max(0.2, this.s.elapsed / 60);
    const lead = this.cs - this.bot.ledger.cs;
    const goldLead = Math.round(this.gold - this.bot.ledger.gold);
    return [
      { label: 'CLOCK', value: LanePhaseDrill.clockText(this.clock), tone: 'neutral' },
      {
        label: `CS · ${perMin.toFixed(1)}/MIN`,
        value: `${this.cs}`,
        bar: clamp(perMin / this.tier.expect, 0, 1),
        tone: perMin >= this.tier.expect ? 'good' : perMin >= this.tier.expect * 0.7 ? 'warn' : 'bad',
      },
      {
        label: 'LEVEL',
        value: `${this.level}`,
        bar: levelProgress(this.xp),
        tone: this.level > this.bot.ledger.level ? 'good' : this.level < this.bot.ledger.level ? 'bad' : 'neutral',
      },
      {
        label: 'MANA',
        value: `${Math.round(this.mana)}`,
        bar: this.manaMax > 0 ? this.mana / this.manaMax : 0,
        tone: this.mana < this.manaMax * 0.2 ? 'warn' : 'neutral',
      },
      {
        label: 'GOLD LEAD',
        value: `${goldLead >= 0 ? '+' : ''}${goldLead}`,
        tone: goldLead > 0 ? 'good' : goldLead < 0 ? 'bad' : 'neutral',
      },
      {
        label: `CAITLYN · LV ${this.bot.ledger.level}`,
        value: `${this.bot.ledger.cs} CS`,
        tone: lead > 0 ? 'good' : lead < 0 ? 'bad' : 'neutral',
      },
      {
        label: 'KDA',
        value: `${this.kills} / ${this.deaths}`,
        tone: this.deaths === 0 ? 'good' : this.deaths > this.kills ? 'bad' : 'neutral',
      },
    ];
  }

  liveScore(): number {
    return Math.max(
      0,
      Math.round(
        this.gold +
          (this.gold - this.bot.ledger.gold) +
          this.cs * 8 +
          this.kills * 220 -
          this.deaths * 320 -
          this.wastedHits * 20,
      ),
    );
  }

  // --------------------------------------------------------------- outcome

  /**
   * The lane report.
   *
   * Deliberately the numbers a coach would read off a replay rather than the
   * numbers a game gives you. Creep score a minute is first because it is the
   * one figure that decides whether a lane went well, the differentials are
   * next because a lane is a comparison and not a solo run, and the mistakes
   * are named by cause — too late, too early, given to your own turret —
   * because "you missed nine" is a fact and "you started nine of them after
   * the bar had already gone" is a fix.
   */
  outcome(): DrillOutcome {
    const minutes = Math.max(0.2, this.s.elapsed / 60);
    const perMin = this.cs / minutes;
    const attempts = this.cs + this.missed;
    const acc = attempts > 0 ? this.cs / attempts : 0;
    const share = this.enemyMinionsLost > 0 ? this.cs / this.enemyMinionsLost : 0;
    const goldLead = this.gold - this.bot.ledger.gold;
    const csLead = this.cs - this.bot.ledger.cs;
    const perCs = this.cs > 0 ? this.attacksThrown / this.cs : 0;
    // How much of the lane you spent near enough to the wave to be paid for
    // it. Experience is shared by proximity in League, so this is the exact
    // price of playing safe, and it is invisible without being counted.
    const xpShare = clamp(this.timeInXpRange / Math.max(1, this.s.elapsed), 0, 1);

    // Every term is a lane outcome rather than an input. Farm against the
    // tier's own benchmark carries it, because that is what the tier claims to
    // be; the share of the wave that ended up yours is next, because it is the
    // half of farming that is about *not losing minions* rather than about
    // taking them; the gold difference is the lane in one number; and dying is
    // the one thing that can undo all three.
    const farm = band(perMin, 0.6, this.tier.expect);
    const kept = clamp(share, 0, 1);
    const lead = clamp(0.5 + goldLead / 1400, 0, 1);
    const safety = this.deaths === 0 ? 1 : band(this.deaths, 4, 0);
    const engaged = clamp(this.cs / Math.max(6, minutes * 4), 0, 1);
    const raw = farm * 0.4 + kept * 0.2 + lead * 0.25 + safety * 0.15;
    const performance = clamp(raw * (0.35 + 0.65 * engaged), 0, 1);

    const helped: string[] = [];
    const hurt: string[] = [];
    if (perMin >= this.tier.expect) {
      helped.push(`${perMin.toFixed(1)} CS a minute — at or above what ${this.tier.label} farms.`);
    }
    if (csLead > 0) helped.push(`You out-farmed Caitlyn ${this.cs} to ${this.bot.ledger.cs}.`);
    if (goldLead > 300) helped.push(`${Math.round(goldLead)} gold ahead when the lane ended.`);
    if (this.level > this.bot.ledger.level) {
      helped.push(`You finished the lane a level up — ${this.level} against ${this.bot.ledger.level}.`);
    }
    if (this.cannons > 0) helped.push(`${this.cannons} cannon minion${this.cannons > 1 ? 's' : ''} secured, 60 gold each.`);
    if (this.underTurret > 2) helped.push(`${this.underTurret} last hits taken under your own turret.`);
    if (this.deaths === 0 && this.s.elapsed > 100) helped.push('You did not die once.');
    if (xpShare > 0.9) helped.push('You were in experience range of the wave for almost the whole lane.');
    if (this.recalls > 0 && this.deaths === 0) helped.push(`${this.recalls} recall${this.recalls > 1 ? 's' : ''} rather than ${this.recalls > 1 ? 'deaths' : 'a death'}.`);
    if (this.kills > 0) helped.push(`${this.kills} kill${this.kills > 1 ? 's' : ''} on the enemy laner.`);

    if (perMin < this.tier.expect * 0.75) {
      hurt.push(`${perMin.toFixed(1)} CS a minute against ${this.tier.label}'s ${this.tier.expect.toFixed(1)} — the lane was farmed by somebody else.`);
    }
    if (this.deaths > 0) {
      hurt.push(`${this.deaths} death${this.deaths > 1 ? 's' : ''}, each one a respawn timer and the wave you were not there for.`);
    }
    if (this.missedLate > 2) hurt.push(`${this.missedLate} minions died with your attack already in the air — you started late.`);
    if (this.missedEarly > 2) hurt.push(`${this.missedEarly} you had already chipped were finished by your own wave.`);
    if (this.missedToTurret > 2) hurt.push(`${this.missedToTurret} went to your own turret — under tower the turret shoots first and you follow.`);
    if (perCs > 1.6) hurt.push(`${perCs.toFixed(1)} attacks per minion secured — the rest of them shoved your wave.`);
    if (this.timeInHerRange > this.s.elapsed * 0.45) {
      hurt.push(`You spent ${Math.round((this.timeInHerRange / Math.max(1, this.s.elapsed)) * 100)}% of the lane inside her 650 range, and she reaches a hundred units further than you do.`);
    }
    if (this.turretHitsTaken > 0) hurt.push(`The enemy turret hit you ${this.turretHitsTaken} times.`);
    if (this.wastedDamage > 400)
      hurt.push(`${Math.round(this.wastedDamage)} damage went into minions somebody else finished — that damage bought you nothing and your attack timer was on cooldown for the one you wanted.`);
    if (this.dryCasts > 2)
      hurt.push(`${this.dryCasts} casts refused for want of mana. In a lane the bar you are not watching is the one that decides the fight.`);
    if (this.deaths > 0 && this.recalls === 0)
      hurt.push('You never went home. Eight seconds and a wave is the cheapest thing in a lane; a death is the most expensive.');
    if (xpShare < 0.72)
      hurt.push(`You were close enough to be paid for the wave ${Math.round(xpShare * 100)}% of the lane — experience is shared by proximity, so standing back to be safe is a level you did not take.`);
    if (this.minionHitsTaken > 10) hurt.push(`The wave hit you ${this.minionHitsTaken} times — that is minion aggro, and it is the price of touching a champion with a wave next to you.`);

    const advice =
      this.deaths > 1
        ? 'Nothing in a lane is worth two deaths. Take the trade you can count and back off from the one you cannot: recall on F costs eight seconds and a wave, and a death costs both plus the timer.'
        : this.missedLate > this.missedEarly && this.missedLate > 2
          ? 'Start the attack before the bar reaches your damage line. Your windup and your bolt both take time, and the plate on every minion shows you exactly how much.'
          : this.missedEarly > 2
            ? 'Stop chipping healthy minions. That damage was going to be dealt by your own wave anyway, and it puts your attack timer on cooldown for the minion you actually wanted.'
            : perMin < this.tier.expect * 0.8
              ? 'Farm first. Every second spent looking at her is a minion walking past you, and the lead you are trying to make with a trade is smaller than the one you are giving away.'
              : this.timeInHerRange > this.s.elapsed * 0.45
                ? 'Hold your spacing. She reaches 650 and you reach 550: stand at the back of your wave and step in only for the minion you are taking.'
                : `Move up a tier. ${this.tier.label} is not punishing you any more, and the next one takes the minion you are half a second late on.`;

    return {
      score: this.liveScore(),
      performance,
      axisPerformance: {
        lastHitting: clamp(farm * 0.7 + kept * 0.3, 0, 1),
        spacing: clamp(1 - this.timeInHerRange / Math.max(1, this.s.elapsed), 0, 1),
        combat: clamp(0.5 + (this.kills - this.deaths) * 0.2 + (goldLead > 0 ? 0.1 : -0.1), 0, 1),
      },
      keyMetrics: [
        rate('csPerMin', 'CS PER MINUTE', Math.round(perMin * 10) / 10),
        count('cs', 'CREEP SCORE', this.cs),
        count('csLead', 'CS DIFFERENCE', csLead),
        count('goldLead', 'GOLD DIFFERENCE', Math.round(goldLead)),
        pct('csAcc', 'LAST HIT ACCURACY', acc),
        count('level', 'LEVEL REACHED', this.level),
        count('deaths', 'DEATHS', this.deaths, 'lower'),
        count('missed', 'MISSED CS', this.missed, 'lower'),
        pct('xpShare', 'TIME IN XP RANGE', xpShare),
      ],
      helped,
      hurt,
      advice,
    };
  }
}
