/**
 * Error intelligence.
 *
 * A score tells a player how well the run went. It does not tell them *how*
 * they failed, and "how" is the only part they can act on. This module reads
 * one run's telemetry and names the specific mistakes in it — from the same
 * numbers the rating system uses, so an error can never be invented for
 * flavour. If the telemetry does not support a claim, no claim is made.
 *
 * Every code carries four things a player actually needs: what it means, when
 * it happens, what it costs, and which drill fixes it.
 */

import { clamp, mean, median } from '../engine/math';
import type { DrillId } from '../drills/catalog';
import { DRILLS } from '../drills/catalog';
import type { DerivedMetrics, RunMetrics } from '../engine/metrics';
import type { SkillAxis } from './skills';

export const ERROR_CODES = [
  'EARLY_MOVE',
  'HELD_FIRE',
  'OVERSTEP',
  'RANGE_LOSS',
  'ROOTED',
  'LATE_DODGE',
  'HAZARD_STAND',
  'TARGET_DROP',
  'CURSOR_OVERTRAVEL',
  'PANIC_CLICK',
  'MISSED_SHOT',
  'CS_MISS',
  'INCONSISTENT',
  'CHIP_DAMAGE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Same guard as the catalogue's, for codes read back out of a saved profile. */
export const isErrorCode = (v: unknown): v is ErrorCode =>
  typeof v === 'string' && (ERROR_CODES as readonly string[]).includes(v);

export interface ErrorMeta {
  code: ErrorCode;
  /** Two words, screaming. This is what the UI leads with. */
  label: string;
  /** What the mistake actually is. */
  meaning: string;
  /** The moment it happens, in play terms. */
  when: string;
  /** What it costs you, stated in currency the player cares about. */
  cost: string;
  /** The drill that trains it away. */
  fix: DrillId;
  axis: SkillAxis;
  /** How much a unit of this error hurts, 0..1. Orders the limiter list. */
  impact: number;
  /** What `count` is counting, for display: "12 cancelled attacks". */
  unit: string;
}

export const ERRORS: Record<ErrorCode, ErrorMeta> = {
  EARLY_MOVE: {
    code: 'EARLY_MOVE',
    label: 'Early Move',
    meaning: 'You moved before the attack actually left your hands, so the windup was thrown away.',
    when: 'Between pressing attack and the projectile releasing — the ~250ms you have to stay committed for.',
    cost: 'Every cancelled attack is a full attack of damage deleted, and the animation time spent on it too.',
    fix: 'kite',
    axis: 'kiting',
    impact: 1,
    unit: 'cancelled attacks',
  },
  HELD_FIRE: {
    code: 'HELD_FIRE',
    label: 'Held Fire',
    meaning: 'Your attack was off cooldown and the target was in range, but a movement key was still down.',
    when: 'The far side of the orbwalk: the moment you should stop moving and let the attack go.',
    cost: 'Damage you were entitled to and did not take. Invisible in a replay — only the clock sees it.',
    fix: 'kite',
    axis: 'kiting',
    impact: 0.85,
    unit: 'attacks of lost damage',
  },
  OVERSTEP: {
    code: 'OVERSTEP',
    label: 'Overstep',
    meaning: 'You entered enemy threat range and stayed there instead of trading from your own edge.',
    when: 'Just after attacking, when the pull toward the target is strongest.',
    cost: 'Free damage taken for range you did not need. It is what turns a won trade into an even one.',
    fix: 'spacing',
    axis: 'spacing',
    impact: 0.9,
    unit: 'seconds inside enemy range',
  },
  RANGE_LOSS: {
    code: 'RANGE_LOSS',
    label: 'Range Loss',
    meaning: 'You drifted outside your own attack range and stopped being a threat at all.',
    when: 'While repositioning under pressure — the retreat overshoots and the attack never restarts.',
    cost: 'Uptime. You are safe and doing nothing, which loses the trade slowly instead of quickly.',
    fix: 'rangecheck',
    axis: 'spacing',
    impact: 0.7,
    unit: 'units off your range edge',
  },
  ROOTED: {
    code: 'ROOTED',
    label: 'Rooted',
    meaning: 'You stood still through windows where moving was completely free.',
    when: 'The backswing, after the projectile has left and before the attack timer comes up.',
    cost: 'Free distance, every single cycle. It is the difference between kiting and standing and shooting.',
    fix: 'kite',
    axis: 'kiting',
    impact: 0.8,
    unit: 'seconds standing still',
  },
  LATE_DODGE: {
    code: 'LATE_DODGE',
    label: 'Late Dodge',
    meaning: 'You reacted to a telegraph after it was already too late to be somewhere else.',
    when: 'On the second and third skillshot of a wave, when attention is already spent.',
    cost: 'Health you cannot trade back, and the pressure that follows losing it.',
    fix: 'dodge',
    axis: 'dodging',
    impact: 0.95,
    unit: 'projectiles taken',
  },
  HAZARD_STAND: {
    code: 'HAZARD_STAND',
    label: 'Hazard Stand',
    meaning: 'You stayed inside a ground hazard that was visible the whole time.',
    when: 'While focused on the attack — the floor stops existing.',
    cost: 'Damage over time that nobody had to aim. The cheapest health anyone will ever take from you.',
    fix: 'dodge',
    axis: 'dodging',
    impact: 0.75,
    unit: 'seconds in the fire',
  },
  TARGET_DROP: {
    code: 'TARGET_DROP',
    label: 'Target Drop',
    meaning: 'The priority target changed and you took too long to commit to the new one.',
    when: 'The instant a fight reshuffles — a dive, a flank, a low-health switch.',
    cost: 'Attacks spent on the wrong unit, which is the same as attacks not spent at all.',
    fix: 'targetswitch',
    axis: 'targeting',
    impact: 0.8,
    unit: 'slow switches',
  },
  CURSOR_OVERTRAVEL: {
    code: 'CURSOR_OVERTRAVEL',
    label: 'Cursor Overtravel',
    meaning: 'Your commands landed away from what you meant, and needed a correction to fix.',
    when: 'On long cursor travel, when the hand overshoots and comes back.',
    cost: 'Milliseconds per command, on every command. It sets the ceiling for everything above it.',
    fix: 'aim',
    axis: 'aim',
    impact: 0.6,
    unit: 'imprecise commands',
  },
  PANIC_CLICK: {
    code: 'PANIC_CLICK',
    label: 'Panic Click',
    meaning: 'You issued the same command repeatedly instead of once, correctly.',
    when: 'Under pressure, when the hands start moving faster than the decisions.',
    cost: 'Nothing directly — but it is what a hand does instead of thinking, and it hides real inputs.',
    fix: 'movement',
    axis: 'movement',
    impact: 0.45,
    unit: 'redundant commands',
  },
  MISSED_SHOT: {
    code: 'MISSED_SHOT',
    label: 'Missed Shot',
    meaning: 'Shots that did not connect — the lead was wrong, or the target was already gone.',
    when: 'Against anything moving laterally, especially after it has changed direction once.',
    cost: 'A cooldown for nothing, and the position you gave up to throw it.',
    fix: 'skillshot',
    axis: 'skillshot',
    impact: 0.85,
    unit: 'shots missed',
  },
  CS_MISS: {
    code: 'CS_MISS',
    label: 'CS Miss',
    meaning: 'Killing blows you started and did not land.',
    when: 'When two minions come into range together, or a turret shot lands first.',
    cost: 'Gold. It is the one mistake here with a direct, countable price in a real game.',
    fix: 'lasthit',
    axis: 'lastHitting',
    impact: 0.7,
    unit: 'minions lost',
  },
  INCONSISTENT: {
    code: 'INCONSISTENT',
    label: 'Inconsistent',
    meaning: 'Your reactions are spread wide — fast sometimes, slow often, unpredictably.',
    when: 'Across the whole run. It is a steadiness problem, not a speed problem.',
    cost: 'You cannot build habits on a number that moves. Consistency is what makes a mechanic transfer.',
    fix: 'aim',
    axis: 'aim',
    impact: 0.6,
    unit: 'slow outliers',
  },
  CHIP_DAMAGE: {
    code: 'CHIP_DAMAGE',
    label: 'Chip Damage',
    meaning: 'You finished well below full health without a single big mistake — it came off in pieces.',
    when: 'Across a long fight, from auto attacks you chose to stand inside.',
    cost: 'The health that decides whether the next fight is winnable at all.',
    fix: 'duel1v1',
    axis: 'combat',
    impact: 0.65,
    unit: 'hits taken',
  },
};

/** One error, as measured in one run. */
export interface DetectedError {
  code: ErrorCode;
  /** Occurrences, in the code's own unit. */
  count: number;
  /** 0..1 share of the opportunities to make it. This is what trends. */
  rate: number;
  /** rate × impact — what orders the limiter list. */
  weight: number;
  /** One sentence, with this run's actual numbers in it. */
  detail: string;
}

const push = (
  out: DetectedError[],
  code: ErrorCode,
  count: number,
  rate: number,
  detail: string,
): void => {
  const r = clamp(rate, 0, 1);
  out.push({ code, count: Math.max(0, Math.round(count)), rate: r, weight: r * ERRORS[code].impact, detail });
};

/**
 * Reads a finished run and names the mistakes in it.
 *
 * Thresholds are deliberately above noise: a single cancelled attack in a
 * sixty-second run is not a habit, and calling it one would make the whole
 * system untrustworthy. Nothing is emitted without enough opportunities to
 * have been measured.
 */
export const detectErrors = (
  drill: DrillId,
  m: RunMetrics,
  d: DerivedMetrics,
): DetectedError[] => {
  const out: DetectedError[] = [];
  const dur = Math.max(1, m.duration);

  if (m.attacksStarted >= 6 && m.attacksCancelled >= 2 && d.cancelRate > 0.06) {
    const byMove = m.windupBreaks;
    push(
      out,
      'EARLY_MOVE',
      m.attacksCancelled,
      d.cancelRate,
      byMove > 0
        ? `${m.attacksCancelled} of ${m.attacksStarted} windups thrown away — ${byMove} of them by taking a direction mid-attack.`
        : `${m.attacksCancelled} of ${m.attacksStarted} windups thrown away by moving before release.`,
    );
  }

  if (m.heldFire > 0.4 && d.triggerDiscipline < 0.86 && m.attacksStarted >= 5) {
    const cycle = m.theoreticalAttacks > 0 ? dur / m.theoreticalAttacks : 1;
    push(
      out,
      'HELD_FIRE',
      m.heldFire / Math.max(0.15, cycle),
      1 - d.triggerDiscipline,
      `${m.heldFire.toFixed(1)}s loaded and not firing — ${Math.round(d.triggerDelay)}ms of held keys per attack.`,
    );
  }

  if (m.spacingSamples > 0) {
    const exposure = m.dangerExposure / dur;
    if (exposure > 0.2 && m.dangerExposure > 2) {
      push(
        out,
        'OVERSTEP',
        m.dangerExposure,
        exposure,
        `${Math.round(exposure * 100)}% of the run inside the nearest enemy's range — ${m.dangerExposure.toFixed(1)}s of it.`,
      );
    } else if (d.avgSpacingError > 95 && exposure < 0.18) {
      push(
        out,
        'RANGE_LOSS',
        d.avgSpacingError,
        clamp(d.avgSpacingError / 260, 0, 1),
        `Averaged ${Math.round(d.avgSpacingError)} units off your range edge, almost all of it too far out.`,
      );
    }
  }

  if (m.freeWindow > 5 && d.moveEfficiency < 0.62) {
    const still = m.freeWindow - m.freeWindowMoving;
    push(
      out,
      'ROOTED',
      still,
      1 - d.moveEfficiency,
      `${still.toFixed(1)}s of free movement never taken — you used ${Math.round(d.moveEfficiency * 100)}% of the windows you had.`,
    );
  }

  if (m.projectilesFaced >= 5 && d.dodgeRate < 0.82) {
    push(
      out,
      'LATE_DODGE',
      m.projectilesFaced - m.projectilesDodged,
      1 - d.dodgeRate,
      `${m.projectilesFaced - m.projectilesDodged} of ${m.projectilesFaced} telegraphs landed on you.`,
    );
  }

  if (m.hazardExposure > 0.8) {
    push(
      out,
      'HAZARD_STAND',
      m.hazardExposure,
      clamp(m.hazardExposure / (dur * 0.25), 0, 1),
      `${m.hazardExposure.toFixed(1)}s standing inside a hazard that was on the floor the whole time.`,
    );
  }

  if (m.targetSwitchTimes.length >= 3) {
    const slow = m.targetSwitchTimes.filter((t) => t > 520);
    if (slow.length >= 2) {
      push(
        out,
        'TARGET_DROP',
        slow.length,
        slow.length / m.targetSwitchTimes.length,
        `${slow.length} of ${m.targetSwitchTimes.length} switches took over half a second — median ${Math.round(d.avgTargetSwitch)}ms.`,
      );
    }
  }

  if (m.clickErrors.length >= 6) {
    const off = m.clickErrors.filter((e) => e > 62);
    if (off.length / m.clickErrors.length > 0.22) {
      push(
        out,
        'CURSOR_OVERTRAVEL',
        off.length,
        off.length / m.clickErrors.length,
        `${off.length} of ${m.clickErrors.length} commands landed over 62 units off, averaging ${Math.round(mean(m.clickErrors))}.`,
      );
    }
  }

  if (m.clicks >= 24 && d.redundantClickRate > 0.14) {
    push(
      out,
      'PANIC_CLICK',
      m.redundantClicks,
      d.redundantClickRate,
      `${m.redundantClicks} of ${m.clicks} commands repeated the one before it inside 120ms.`,
    );
  }

  // Aim is only judged where the drill actually asks for aimed shots — an
  // orbwalking drill's auto attacks are not a skillshot accuracy claim.
  const aimed = DRILLS[drill].abilities.length > 0 || DRILLS[drill].axes.skillshot;
  if (aimed && m.shotsFired >= 6 && d.accuracy < 0.72) {
    push(
      out,
      'MISSED_SHOT',
      m.shotsFired - m.shotsHit,
      1 - d.accuracy,
      `${m.shotsHit} of ${m.shotsFired} landed — ${Math.round(d.accuracy * 100)}% on a target that was moving.`,
    );
  }

  if (m.csAttempts >= 8 && d.csAccuracy < 0.86) {
    push(
      out,
      'CS_MISS',
      m.csMissed,
      1 - d.csAccuracy,
      `${m.csSuccess} of ${m.csAttempts} killing blows secured — ${m.csMissed} minions lost outright.`,
    );
  }

  if (m.reactionTimes.length >= 8 && d.reactionConsistency < 0.45) {
    const med = median(m.reactionTimes);
    const slow = m.reactionTimes.filter((t) => t > med * 1.6);
    push(
      out,
      'INCONSISTENT',
      slow.length,
      1 - d.reactionConsistency,
      `Median ${Math.round(med)}ms, but ${slow.length} reactions came in over ${Math.round(med * 1.6)}ms.`,
    );
  }

  if (m.hitsTaken >= 4 && d.hpRetained < 0.65 && m.duration > 15) {
    push(
      out,
      'CHIP_DAMAGE',
      m.hitsTaken,
      1 - d.hpRetained,
      `${m.hitsTaken} hits taken for ${Math.round(d.hpLostCapped)} health — ${Math.round(d.hpRetained * 100)}% left at the end.`,
    );
  }

  return out.sort((a, b) => b.weight - a.weight);
};

/** The one mistake that cost this run the most, if any did. */
export const primaryLimiter = (errors: DetectedError[]): DetectedError | null =>
  errors.length && errors[0].weight > 0.08 ? errors[0] : null;
