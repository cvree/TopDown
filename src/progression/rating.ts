import { clamp } from '../engine/math';
import { RATING_MAX } from './ranks';
import type { AxisWeights, SkillAxis } from './skills';

/**
 * Rating movement is performance-driven, not attendance-driven.
 *
 * Each run produces a *performance* in 0..1 and the difficulty it was played
 * at. Those two give an "expected rating" — the rating a player who performs
 * like that consistently deserves. Your rating then moves a fraction of the
 * way toward it. Playing more runs at your current level converges to your
 * current rating and stops; the only way up is to perform better, or to
 * perform well at a higher difficulty.
 */

/** Highest rating reachable by a flawless run at a given difficulty. */
export const ceilingForDifficulty = (difficulty: number): number =>
  1400 + 2200 * clamp(difficulty, 0, 1);

export const expectedRating = (performance: number, difficulty: number): number => {
  const p = clamp(performance, 0, 1);
  const ceiling = ceilingForDifficulty(difficulty);
  // The exponent means the last few percent of performance are worth the most.
  return clamp(ceiling * (0.14 + 0.86 * Math.pow(p, 1.22)), 0, RATING_MAX);
};

export interface RatingUpdate {
  before: number;
  after: number;
  delta: number;
  expected: number;
  /** Confidence-weighted step size actually used. */
  k: number;
}

/** Bigger steps while we still know little about the player. */
export const kFactor = (samples: number): number => {
  if (samples < 1) return 1;
  if (samples < 3) return 0.55;
  if (samples < 8) return 0.34;
  if (samples < 20) return 0.2;
  return 0.13;
};

/**
 * How far a single run may move an axis.
 *
 * The first run on an axis is allowed to place you outright — holding a
 * genuinely Platinum player at Iron for ten runs would be both wrong and
 * miserable. After that the cap tightens sharply, so rank stops being
 * something you can walk into and starts being something you hold.
 */
export const maxGainFor = (samples: number): number => {
  if (samples < 1) return 1600;
  if (samples < 3) return 240;
  if (samples < 8) return 140;
  return 95;
};

export const MAX_GAIN = 95;
export const MAX_LOSS = 55;

export const updateRating = (
  current: number,
  samples: number,
  performance: number,
  difficulty: number,
): RatingUpdate => {
  const expected = expectedRating(performance, difficulty);
  const k = kFactor(samples);
  let delta = (expected - current) * k;
  delta = clamp(delta, -MAX_LOSS, maxGainFor(samples));
  // A near-flawless run should never feel like nothing happened.
  if (performance > 0.9 && delta > 0) delta = Math.max(delta, 6);
  const after = clamp(current + delta, 0, RATING_MAX);
  return { before: current, after, delta: after - current, expected, k };
};

/**
 * Overall rating is a weighted blend of the axes, so a player is not defined
 * by their single best drill. Axes with no data are ignored rather than
 * counted as zero.
 */
export const overallRating = (
  ratings: Record<SkillAxis, number>,
  samples: Record<SkillAxis, number>,
): number => {
  const weights: Record<SkillAxis, number> = {
    movement: 1.0,
    aim: 1.0,
    skillshot: 1.25,
    dodging: 1.15,
    kiting: 1.3,
    spacing: 1.1,
    targeting: 1.0,
    combat: 1.35,
    lastHitting: 0.75,
  };
  let sum = 0;
  let wsum = 0;
  for (const axis of Object.keys(ratings) as SkillAxis[]) {
    const n = samples[axis] ?? 0;
    if (n <= 0) continue;
    // Confidence ramps in over the first few runs on an axis.
    const conf = Math.min(1, n / 4);
    const w = weights[axis] * conf;
    sum += ratings[axis] * w;
    wsum += w;
  }
  return wsum > 0 ? sum / wsum : 0;
};

/** Splits one run's performance across the axes the drill trains. */
export const distribute = (
  weights: AxisWeights,
  axisPerformance: Partial<Record<SkillAxis, number>>,
  overall: number,
): { axis: SkillAxis; performance: number; weight: number }[] => {
  const out: { axis: SkillAxis; performance: number; weight: number }[] = [];
  for (const [axis, weight] of Object.entries(weights) as [SkillAxis, number][]) {
    if (!weight) continue;
    out.push({ axis, performance: clamp(axisPerformance[axis] ?? overall, 0, 1), weight });
  }
  return out;
};
