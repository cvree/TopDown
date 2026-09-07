import { clamp } from '../engine/math';

/**
 * THE RUNGS.
 *
 * The lab's ladder geometry and nothing else: how many levels there are, what
 * difficulty each one is played at, and how to read a level back out of a
 * difficulty again.
 *
 * It is a file of its own rather than four lines inside `apm.ts` because the
 * arena needs it now. The infinite run moves the rung while the player is
 * standing on it, so a drill has to be able to ask what difficulty a level is
 * — and `apm.ts` is the wrong thing for a drill to import, because it reaches
 * back into the drill catalogue and closing that loop would put half the
 * client inside a cycle for the sake of one linear function.
 *
 * The mapping is deliberately linear and deliberately continuous. Level 1 is
 * gentle, level 10 is past anything the adaptive system would ever choose for
 * you, and every point in between is a real place to stand: the tide parks
 * players at 6.4 all the time, and a ladder that could only answer for whole
 * numbers would have to lie about where they were.
 */

export const APM_LEVELS = 10;

/** The performance a run needs to clear the level it was played at. */
export const CLEAR_AT = 0.6;

/** The two marks above the clear, for the second and third star. */
export const STAR_AT: [number, number, number] = [CLEAR_AT, 0.74, 0.88];

/** The difficulty a level is played at. Fractional levels are meant. */
export const levelDifficulty = (level: number): number =>
  clamp(0.08 + (clamp(level, 1, APM_LEVELS) - 1) * 0.1, 0.05, 1);

/** The rung a difficulty belongs to — `levelDifficulty` run backwards. */
export const difficultyLevel = (difficulty: number): number =>
  clamp((difficulty - 0.08) / 0.1 + 1, 1, APM_LEVELS);
