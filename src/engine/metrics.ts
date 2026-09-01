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
  dodgeRate: number; // 0..1
  accuracy: number; // 0..1
  avgReaction: number; // ms
  reactionConsistency: number; // 0..1, higher is steadier
  avgTargetSwitch: number; // ms
  csAccuracy: number; // 0..1
  redundantClickRate: number; // 0..1
  hpRetained: number; // 0..1
  reactionP10: number;
  reactionP90: number;
  /** hpLost never exceeds the health bar, for display. */
  hpLostCapped: number;
}

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
  const rt = m.reactionTimes;
  const sd = stdev(rt);
  return {
    orbwalkEfficiency,
    attackEfficiency,
    moveEfficiency,
    cancelRate,
    dpsUptime: attackEfficiency,
    avgSpacingError: m.spacingSamples > 0 ? m.spacingErrorSum / m.spacingSamples : 0,
    dodgeRate: m.projectilesFaced > 0 ? clamp(m.projectilesDodged / m.projectilesFaced, 0, 1) : 1,
    accuracy: m.shotsFired > 0 ? clamp(m.shotsHit / m.shotsFired, 0, 1) : 0,
    avgReaction: rt.length ? median(rt) : 0,
    reactionConsistency: rt.length > 2 ? clamp(1 - sd / 260, 0, 1) : 0,
    avgTargetSwitch: m.targetSwitchTimes.length ? median(m.targetSwitchTimes) : 0,
    csAccuracy: m.csAttempts > 0 ? clamp(m.csSuccess / m.csAttempts, 0, 1) : 0,
    redundantClickRate: m.clicks > 0 ? m.redundantClicks / m.clicks : 0,
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

  reset(): void {
    Object.assign(this.m, emptyMetrics());
    this.pathAccum = 0;
    this.cursorAccum = 0;
    this.seriesAccum = 0;
    this.lastClick = null;
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
      const moving = Math.hypot(player.vel.x, player.vel.y) > 8;
      if (moving) m.freeWindowMoving += dt;
    }
    if (player.phase === 'windup') m.committedTime += dt;

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
      if (nd <= nearest.attack.range + player.radius) m.dangerExposure += dt;
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
