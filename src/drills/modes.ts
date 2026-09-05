import type { DrillId } from './catalog';

/**
 * The two ways to play anything.
 *
 * The trainer used to offer a different shape of run per section — a
 * calibration sequence, a daily queue, an APM rung, an endurance toggle, a
 * course of gated stages — and the cost of that was a player who had to learn
 * the *client* before they could practise. There are only ever two questions
 * worth asking at a menu:
 *
 *  - **PLAY** — one minute. A fixed, comparable, repeatable rep. Every mode is
 *    the same length, so a score in one is a score in any other and "again" is
 *    always a minute away.
 *  - **SURVIVE** — no clock. It runs until you are dead or until you have made
 *    the mode's defining mistake three times, and it gets harder the longer
 *    you last. The number it gives back is how long you lasted.
 *
 * That is the whole mode system. Nothing else in the client needs to know
 * about it beyond the duration it implies and the strike budget it grants.
 */
export type RunMode = 'play' | 'survive';

/** PLAY is one minute, for every mode, always. */
export const PLAY_SECONDS = 60;

/** How many defining mistakes SURVIVE forgives before it ends the run. */
export const SURVIVE_STRIKES = 3;

/**
 * Seconds of survival over which the pressure ramps from the mode's opening
 * difficulty to its hardest. Two and a half minutes: long enough that the
 * first minute is recognisably the PLAY run, short enough that a good player
 * meets the ceiling inside one sitting.
 */
export const SURVIVE_RAMP = 150;

/** How much of the difficulty range the ramp is allowed to add. */
export const SURVIVE_RAMP_RANGE = 0.5;

export interface ModeMeta {
  id: RunMode;
  label: string;
  /** The line on the button. */
  tagline: string;
  /** What the run actually does, in one sentence. */
  blurb: string;
  accent: string;
}

export const RUN_MODES: Record<RunMode, ModeMeta> = {
  play: {
    id: 'play',
    label: 'PLAY',
    tagline: '1 minute',
    blurb: 'One minute, scored. The same length every time, so the numbers mean something.',
    accent: '#58e0ff',
  },
  survive: {
    id: 'survive',
    label: 'SURVIVE',
    tagline: 'until you die',
    blurb: `No clock. It ramps until it beats you — three mistakes or one death and it is over.`,
    accent: '#ff5fa8',
  },
};

export const RUN_MODE_LIST: ModeMeta[] = [RUN_MODES.play, RUN_MODES.survive];

/** How long a run of `mode` lasts. Zero means "until it ends itself". */
export const durationFor = (mode: RunMode): number => (mode === 'play' ? PLAY_SECONDS : 0);

/**
 * The practice list, in the order it is taught.
 *
 * One champion. Every mode on this list spawns Vayne with the parts of her kit
 * that mode is about, so there is never a run where the hands you are training
 * are not the hands you play with.
 */
export const PRACTICE_MODES: DrillId[] = ['vayneTumble', 'vayneBolts', 'vayneCondemn', 'vayneHunt'];

export const isPracticeMode = (id: DrillId): boolean => PRACTICE_MODES.includes(id);
