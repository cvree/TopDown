import { clamp, dist, mean, median, percentile, stdev } from './math';
import type { Actor, Vec2 } from './types';
import type { World, WorldEvent } from './world';

export interface TimelineMark {
  t: number;
  kind: 'attack' | 'cancel' | 'move' | 'hit' | 'kill' | 'taken' | 'dodge' | 'graze';
}

export interface RunMetrics {
  duration: number;

  // --- attack economy -------------------------------------------------
  attacksStarted: number;
  attacksCompleted: number;
  attacksCancelled: number;
  /** Attacks the player could have landed if they never wasted a window. */
  theoreticalAttacks: number;
  damageDealt: number;

  // --- orbwalking -----------------------------------------------------
  /** Seconds where moving was free (not mid-windup) and an attack was on cooldown. */
  freeWindow: number;
  /** Of that, seconds actually spent moving. */
  freeWindowMoving: number;
  /** Seconds spent in windup — committed, unable to move. */
  committedTime: number;

  // --- spacing --------------------------------------------------------
  spacingSamples: number;
  spacingErrorSum: number;
  /**
   * The free-trade pocket, in seconds: close enough to hit them, far enough
   * that they cannot hit you.
   *
   * This is the whole of spacing reduced to one number. Every other spacing
   * figure — average error, time too close, distance held — describes where
   * you were standing. This one says whether standing there was *profitable*,
   * which is the only question a lane ever asks.
   */
  advantageTime: number;
  /** Seconds inside their reach: they can trade back, so the trade is not free. */
  overstepTime: number;
  /** Seconds out of your own reach, doing nothing to anybody. */
  passiveTime: number;
  /** Seconds with a live enemy on the field at all — the denominator. */
  engagedTime: number;
  /** Seconds spent in the pocket while actually attacking from it. */
  advantageTrading: number;
  /** Seconds spent inside the nearest enemy's attack range. */
  dangerExposure: number;
  /** Seconds spent inside an active or telegraphed hazard. */
  hazardExposure: number;

  // --- dodging --------------------------------------------------------
  projectilesFaced: number;
  projectilesDodged: number;
  nearMisses: number;
  hitsTaken: number;
  hpLost: number;

  // --- aim / targeting -------------------------------------------------
  shotsFired: number;
  shotsHit: number;
  reactionTimes: number[];
  targetSwitchTimes: number[];
  /** Distance from the click to the intended target centre, in units. */
  clickErrors: number[];

  // --- last hitting ------------------------------------------------------
  csAttempts: number;
  csSuccess: number;
  csPerfect: number;
  csMissed: number;

  // --- attack timing ------------------------------------------------------
  /**
   * Per attack, the seconds between the shot becoming possible and being
   * taken.
   *
   * This is the number the whole trainer is about. An attack cycle is only
   * ever wasted at one of two ends: you took the shot late, or you gave the
   * windup away. Everything else — chain length, DPS uptime, damage — is
   * downstream of these, and none of them can tell you *which* end you are
   * losing on. This can.
   */
  attackLateness: number[];
  /** Seconds the attack was up, a target was in range, and nothing was fired. */
  attackDowntime: number;
  /** Seconds spent in backswing, and of those, seconds spent actually moving. */
  backswingTime: number;
  backswingMoving: number;
  /** Explicit fire commands issued, how many were premature, and what they cost. */
  attackCommands: number;
  earlyCommands: number;
  /** Seconds of standing still bought by a premature fire command. */
  haltTime: number;

  // --- direct control (WASD) ---------------------------------------------
  /**
   * Seconds the shot was loaded — attack off cooldown, target in range — and a
   * movement key was still down holding it back.
   *
   * This is the one mistake WASD can make that clicking cannot. A click that
   * arrives after the attack timer is up costs nothing; a key that is still
   * down costs every frame it stays down, and it is completely invisible
   * unless something counts it.
   */
  heldFire: number;
  /** Windups broken by taking a direction, rather than by a click or a dash. */
  windupBreaks: number;

  // --- inputs -----------------------------------------------------------
  clicks: number;
  redundantClicks: number;

  // --- outcome -----------------------------------------------------------
  kills: number;
  survived: boolean;
  survivalTime: number;
  targetsHit: number;
  targetsMissed: number;
  score: number;
  maxChain: number;

  // --- visualisation series ---------------------------------------------
  path: Vec2[];
  cursorPath: Vec2[];
  timeline: TimelineMark[];
  hpSeries: { t: number; hp: number }[];
  chainSeries: { t: number; chain: number }[];
}

export const emptyMetrics = (): RunMetrics => ({
  duration: 0,
  attacksStarted: 0,
  attacksCompleted: 0,
  attacksCancelled: 0,
  theoreticalAttacks: 0,
  damageDealt: 0,
  freeWindow: 0,
  freeWindowMoving: 0,
  committedTime: 0,
  spacingSamples: 0,
  spacingErrorSum: 0,
  advantageTime: 0,
  overstepTime: 0,
  passiveTime: 0,
  engagedTime: 0,
  advantageTrading: 0,
  dangerExposure: 0,
  hazardExposure: 0,
  projectilesFaced: 0,
  projectilesDodged: 0,
  nearMisses: 0,
  hitsTaken: 0,
  hpLost: 0,
  shotsFired: 0,
  shotsHit: 0,
  reactionTimes: [],
  targetSwitchTimes: [],
  clickErrors: [],
  csAttempts: 0,
  csSuccess: 0,
  csPerfect: 0,
  csMissed: 0,
  attackLateness: [],
  attackDowntime: 0,
  backswingTime: 0,
  backswingMoving: 0,
  attackCommands: 0,
  earlyCommands: 0,
  haltTime: 0,
  heldFire: 0,
  windupBreaks: 0,
  clicks: 0,
  redundantClicks: 0,
  kills: 0,
  survived: true,
  survivalTime: 0,
  targetsHit: 0,
  targetsMissed: 0,
  score: 0,
  maxChain: 0,
  path: [],
  cursorPath: [],
  timeline: [],
  hpSeries: [],
  chainSeries: [],
});

/** Derived numbers the results screen and the rating system both read. */
export interface DerivedMetrics {
  orbwalkEfficiency: number; // 0..1
  attackEfficiency: number; // completed / theoretical
  moveEfficiency: number; // free window used
  cancelRate: number; // cancelled / started
  dpsUptime: number; // 0..1
  avgSpacingError: number; // units
  /**
   * Share of the engaged run spent where you could hit them and they could
   * not hit you. APEX's core spacing number.
   */
  advantageousSpacing: number;
  /** Share of the engaged run spent inside their reach. */
  overstepRate: number;
  /** Of the time held in the pocket, how much of it was spent trading from it. */
  pocketUse: number;
  dodgeRate: number; // 0..1
  accuracy: number; // 0..1
  avgReaction: number; // ms
  reactionConsistency: number; // 0..1, higher is steadier
  avgTargetSwitch: number; // ms
  csAccuracy: number; // 0..1
  redundantClickRate: number; // 0..1
  /** Median milliseconds between a shot becoming possible and being taken. */
  attackLatency: number;
  /** 1 = every attack taken the instant it came up. */
  attackPunctuality: number;
  /** Share of backswing seconds spent moving. Standing through it is free damage thrown away. */
  backswingUse: number;
  /** Share of the run in which an attack was available on a live target and refused. */
  downtimeRate: number;
  /** 1 = no fire command was ever issued before the timer was up. */
  commandDiscipline: number;
  /**
   * The single honest read on the attack cycle: taken on time, backswing
   * spent moving, windup never thrown away, no dead air.
   */
  attackTiming: number;
  /** Milliseconds of held fire per attack. Always 0 under the click scheme. */
  triggerDelay: number;
  /** 1 = the keys were never down while the shot was ready. */
  triggerDiscipline: number;
  hpRetained: number; // 0..1
  reactionP10: number;
  reactionP90: number;
  /** hpLost never exceeds the health bar, for display. */
  hpLostCapped: number;
}

/** Maps a raw value onto 0..1 where `good` scores 1 and `bad` scores 0. */
const band01 = (value: number, bad: number, good: number): number => {
  if (good === bad) return 0;
  return clamp((value - bad) / (good - bad), 0, 1);
};

export const derive = (m: RunMetrics, maxHp = 720): DerivedMetrics => {
  const attackEfficiency = m.theoreticalAttacks > 0 ? clamp(m.attacksCompleted / m.theoreticalAttacks, 0, 1) : 0;
  const moveEfficiency = m.freeWindow > 0.15 ? clamp(m.freeWindowMoving / m.freeWindow, 0, 1) : 0;
  const cancelRate = m.attacksStarted > 0 ? m.attacksCancelled / m.attacksStarted : 0;
  // Orbwalking is landing your attacks *and* using every free frame to move.
  // The geometric term is what stops one half carrying the other: a player who
  // only attacks, or only moves, cannot score like one who does both.
  const combined = Math.sqrt(Math.max(0, attackEfficiency) * Math.max(0, moveEfficiency));
  const orbwalkEfficiency = clamp(
    combined * 0.62 + (attackEfficiency * 0.5 + moveEfficiency * 0.5) * 0.38 - cancelRate * 0.3,
    0,
    1,
  );
  // Held fire, priced in the currency it is actually spent in: a third of an
  // attack cycle lost per attack is a third of your damage gone, whatever the
  // champion's attack speed happens to be.
  const cycleLen = m.theoreticalAttacks > 0 ? m.duration / m.theoreticalAttacks : 1;
  // Denominated against at least one attack, so a player who never releases
  // the keys at all is scored as the worst case rather than, by dividing by
  // zero attacks, as the best one.
  const heldPerAttack = m.heldFire / Math.max(1, m.attacksStarted);
  const rt = m.reactionTimes;
  const sd = stdev(rt);

  // Punctuality is measured against the cycle, not against a fixed number of
  // milliseconds: a third of a cycle late is a third of your damage gone
  // whether the champion attacks twice a second or once every two seconds.
  const lateness = m.attackLateness.length ? median(m.attackLateness) : 0;
  const attackPunctuality = m.attackLateness.length
    ? clamp(1 - lateness / Math.max(0.08, cycleLen * 0.4), 0, 1)
    : 0;
  const backswingUse = m.backswingTime > 0.2 ? clamp(m.backswingMoving / m.backswingTime, 0, 1) : 0;
  const downtimeRate = m.duration > 0.5 ? clamp(m.attackDowntime / m.duration, 0, 1) : 0;
  const commandDiscipline = m.attackCommands > 0 ? clamp(1 - m.earlyCommands / m.attackCommands, 0, 1) : 1;
  // Weighted so that no single half can carry a run: punctuality is the
  // largest term, but a player who fires on the tick and then stands through
  // every backswing is not orbwalking and does not get to score as if he is.
  const attackTiming = clamp(
    attackPunctuality * 0.4 +
      backswingUse * 0.3 +
      band01(downtimeRate, 0.35, 0.02) * 0.18 +
      band01(cancelRate, 0.25, 0) * 0.12,
    0,
    1,
  );

  return {
    attackLatency: lateness * 1000,
    attackPunctuality,
    backswingUse,
    downtimeRate,
    commandDiscipline,
    attackTiming,
    orbwalkEfficiency,
    attackEfficiency,
    moveEfficiency,
    cancelRate,
    dpsUptime: attackEfficiency,
    avgSpacingError: m.spacingSamples > 0 ? m.spacingErrorSum / m.spacingSamples : 0,
    advantageousSpacing: m.engagedTime > 0.5 ? clamp(m.advantageTime / m.engagedTime, 0, 1) : 0,
    overstepRate: m.engagedTime > 0.5 ? clamp(m.overstepTime / m.engagedTime, 0, 1) : 0,
    // Holding the pocket and never firing from it is not spacing, it is
    // hiding at a flattering distance. This is the term that says so.
    pocketUse: m.advantageTime > 0.5 ? clamp(m.advantageTrading / m.advantageTime, 0, 1) : 0,
    dodgeRate: m.projectilesFaced > 0 ? clamp(m.projectilesDodged / m.projectilesFaced, 0, 1) : 1,
    accuracy: m.shotsFired > 0 ? clamp(m.shotsHit / m.shotsFired, 0, 1) : 0,
    avgReaction: rt.length ? median(rt) : 0,
    reactionConsistency: rt.length > 2 ? clamp(1 - sd / 260, 0, 1) : 0,
    avgTargetSwitch: m.targetSwitchTimes.length ? median(m.targetSwitchTimes) : 0,
    csAccuracy: m.csAttempts > 0 ? clamp(m.csSuccess / m.csAttempts, 0, 1) : 0,
    redundantClickRate: m.clicks > 0 ? m.redundantClicks / m.clicks : 0,
    triggerDelay: heldPerAttack * 1000,
    triggerDiscipline: clamp(1 - heldPerAttack / Math.max(0.05, cycleLen * 0.33), 0, 1),
    hpRetained: clamp(1 - m.hpLost / maxHp, 0, 1),
    hpLostCapped: Math.min(m.hpLost, maxHp),
    reactionP10: rt.length ? percentile(rt, 0.1) : 0,
    reactionP90: rt.length ? percentile(rt, 0.9) : 0,
  };
};

/**
 * Live recorder. Drills feed it world events plus a per-step sample; it owns
 * every number the results screen shows so the drills stay focused on rules.
 */
export class MetricsRecorder {
  readonly m: RunMetrics = emptyMetrics();
  private pathAccum = 0;
  private cursorAccum = 0;
  private seriesAccum = 0;
  private lastClick: { pos: Vec2; t: number } | null = null;
  /**
   * World time at which the current shot first became takeable, or null if it
   * is not takeable right now.
   *
   * The whole attack-timing read hangs off this one variable: the instant the
   * cooldown ends with something in range, the clock starts, and the attack
   * that eventually begins is stamped with how long it ran. It is deliberately
   * *not* reset by moving out of range and back — drifting out of range and
   * back in is one of the ways a shot is taken late, and hiding it would make
   * the number flattering rather than useful.
   */
  private readySince: number | null = null;

  reset(): void {
    Object.assign(this.m, emptyMetrics());
    this.pathAccum = 0;
    this.cursorAccum = 0;
    this.seriesAccum = 0;
    this.lastClick = null;
    this.readySince = null;
  }

  /**
   * An explicit fire command, and what it is about to cost.
   *
   * `cost` is the seconds of standing still the world has just committed to,
   * which is zero when the press landed on the tick and grows the earlier it
   * was. Counting the command *and* its cost is what lets the score tell a
   * player who times one attack badly apart from one who is holding the button
   * down: both show early commands, only the second shows seconds of them.
   */
  noteFireCommand(cost: number): void {
    this.m.attackCommands++;
    if (cost > 0.06) {
      this.m.earlyCommands++;
      this.m.haltTime += cost;
    }
  }

  /**
   * A windup thrown away by taking a direction rather than by clicking.
   *
   * The world cannot tell the two apart — it sees one `attackCancel` either
   * way — but the coaching has to, because the fix is a different hand.
   */
  noteWindupBreak(): void {
    this.m.windupBreaks++;
  }

  /** Consume this step's world events. */
  ingest(events: readonly WorldEvent[], world: World): void {
    const pid = world.playerId;
    for (const e of events) {
      switch (e.type) {
        case 'attackStart':
          if (e.actorId === pid) {
            this.m.attacksStarted++;
            this.m.timeline.push({ t: world.time, kind: 'attack' });
            if (this.readySince !== null) this.m.attackLateness.push(Math.max(0, world.time - this.readySince));
            this.readySince = null;
          }
          break;
        case 'attackRelease':
          if (e.actorId === pid) {
            this.m.attacksCompleted++;
            this.m.shotsFired++;
          }
          break;
        case 'attackCancel':
          if (e.actorId === pid) {
            this.m.attacksCancelled++;
            this.m.timeline.push({ t: world.time, kind: 'cancel' });
          }
          break;
        case 'moveOrder':
          if (e.actorId === pid) this.m.timeline.push({ t: world.time, kind: 'move' });
          break;
        case 'attackLand':
          if (e.actorId === pid) {
            this.m.shotsHit++;
            this.m.timeline.push({ t: world.time, kind: 'hit' });
          }
          break;
        case 'damage':
          if (e.actorId === pid) this.m.damageDealt += e.amount ?? 0;
          if (e.targetId === pid) {
            this.m.hitsTaken++;
            this.m.hpLost += e.amount ?? 0;
            this.m.timeline.push({ t: world.time, kind: 'taken' });
          }
          break;
        case 'death':
          if (e.byPlayer) {
            this.m.kills++;
            this.m.timeline.push({ t: world.time, kind: 'kill' });
          }
          if (e.actorId === pid) {
            this.m.survived = false;
          }
          break;
        case 'graze':
          this.m.nearMisses++;
          this.m.timeline.push({ t: world.time, kind: 'graze' });
          break;
        case 'projectileSpawn':
          if (e.actorId !== pid) this.m.projectilesFaced++;
          break;
        case 'dodgedProjectile':
          this.m.projectilesDodged++;
          this.m.timeline.push({ t: world.time, kind: 'dodge' });
          break;
        default:
          break;
      }
    }
  }

  /** Called once per sim step with the current state. */
  sample(world: World, player: Actor, cursorWorld: Vec2, dt: number, chain: number): void {
    const m = this.m;
    m.duration = world.time;
    if (player.alive) m.survivalTime = world.time;

    const cycle = 1 / Math.max(0.05, player.attack.attackSpeed);
    m.theoreticalAttacks = world.time / cycle;

    // Free window: moving costs nothing (not mid-windup) and the attack timer
    // has not come up yet. Using that window is the definition of orbwalking.
    const free = player.phase !== 'windup' && player.attackCd > 0.01;
    if (free) {
      m.freeWindow += dt;
      if (Math.hypot(player.vel.x, player.vel.y) > 8) m.freeWindowMoving += dt;
    }
    if (player.phase === 'windup') m.committedTime += dt;

    // ---- the attack cycle, measured -------------------------------------
    const moving = Math.hypot(player.vel.x, player.vel.y) > 8;
    if (player.phase === 'backswing') {
      m.backswingTime += dt;
      if (moving) m.backswingMoving += dt;
    }
    // A shot is takeable when the timer is up, nothing is mid-swing, and
    // something hostile is standing inside your reach. Anything else is not
    // the player's fault and must not be charged to them.
    const takeable =
      player.attackCd <= 0 && player.phase !== 'windup' && world.findTarget(player, player.pos, player.attack.range) !== null;
    if (takeable) {
      if (this.readySince === null) this.readySince = world.time;
      if (player.phase === 'idle') m.attackDowntime += dt;
    } else if (player.attackCd > 0.001) {
      // The cooldown running again means the shot was taken (or the window is
      // legitimately gone); either way the clock stops.
      this.readySince = null;
    }

    // Held fire. Under direct control the world refuses to start an attack
    // while a direction is down, so these are seconds in which the champion
    // was in range, loaded, and deliberately not shooting.
    if (player.directControl && player.moveDir && player.attackCd <= 0 && player.phase !== 'windup') {
      const held = world.byId(player.targetId);
      if (held && held.alive && dist(player.pos, held.pos) - held.radius <= player.attack.range) {
        m.heldFire += dt;
      }
    }

    // Spacing: how close to "max range" the player is holding against the
    // nearest enemy. Standing at max range is the ideal, being inside it is
    // an error, being out of range is a bigger error.
    let nearest: Actor | null = null;
    let nd = Infinity;
    for (const a of world.actors) {
      if (!a.alive || a.team !== 'enemy') continue;
      const d = dist(player.pos, a.pos);
      if (d < nd) {
        nd = d;
        nearest = a;
      }
    }
    if (nearest) {
      const ideal = player.attack.range + nearest.radius - 20;
      m.spacingSamples++;
      m.spacingErrorSum += Math.abs(nd - ideal);
      const theirReach = nearest.attack.range + player.radius;
      const myReach = player.attack.range + nearest.radius;
      if (nd <= theirReach) m.dangerExposure += dt;

      // The pocket. Measured against the nearest live threat only, because a
      // second enemy behind you is a different mistake with its own name.
      m.engagedTime += dt;
      if (nd <= theirReach) {
        m.overstepTime += dt;
      } else if (nd <= myReach) {
        m.advantageTime += dt;
        // Trading from it means the attack cycle is running, not that a shot
        // happens to be in the air this instant.
        if (player.phase !== 'idle' || player.attackCd > 0.05) m.advantageTrading += dt;
      } else {
        m.passiveTime += dt;
      }
    }
    for (const h of world.hazards) {
      if (h.team !== 'enemy') continue;
      if (world.hazardHits(h, player.pos, player.radius)) {
        m.hazardExposure += dt;
        break;
      }
    }

    this.pathAccum += dt;
    if (this.pathAccum >= 0.05) {
      this.pathAccum = 0;
      m.path.push({ x: player.pos.x, y: player.pos.y });
      m.cursorPath.push({ x: cursorWorld.x, y: cursorWorld.y });
    }
    this.seriesAccum += dt;
    if (this.seriesAccum >= 0.15) {
      this.seriesAccum = 0;
      m.hpSeries.push({ t: world.time, hp: player.hp / player.maxHp });
      m.chainSeries.push({ t: world.time, chain });
    }
    if (chain > m.maxChain) m.maxChain = chain;
    void this.cursorAccum;
  }

  /** Records a click for redundancy analysis (spam clicking the same spot). */
  noteClick(pos: Vec2, t: number): void {
    this.m.clicks++;
    const last = this.lastClick;
    if (last && t - last.t < 0.12 && dist(last.pos, pos) < 55) {
      this.m.redundantClicks++;
    }
    this.lastClick = { pos: { ...pos }, t };
  }

  noteReaction(ms: number): void {
    if (ms > 40 && ms < 3000) this.m.reactionTimes.push(ms);
  }

  noteTargetSwitch(ms: number): void {
    if (ms > 30 && ms < 4000) this.m.targetSwitchTimes.push(ms);
  }

  noteClickError(units: number): void {
    this.m.clickErrors.push(units);
  }
}

export const summarizeReaction = (rt: number[]): { avg: number; best: number; sd: number } => ({
  avg: rt.length ? mean(rt) : 0,
  best: rt.length ? Math.min(...rt) : 0,
  sd: stdev(rt),
});
