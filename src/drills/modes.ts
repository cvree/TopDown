import type { DrillId } from './catalog';

/**
 * The ways to play anything.
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
 * There is now a third, and it is not a third question at the menu: INFINITE
 * is the lab's own shape and the lab's alone, reached by right-clicking a
 * bench rather than by a button next to the other two. It has no clock and no
 * rung — the floor moves under you for as long as you play, up while you are
 * winning and down while you are not — so it cannot be a length or a strike
 * budget the way the other two are, and the only thing the rest of the client
 * needs to know about it is that it is open-ended and never sets a score.
 *
 * Nothing else in the client needs to know about any of it beyond the duration
 * each implies and the strike budget it grants.
 */
export type RunMode = 'play' | 'survive' | 'infinite';

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
  infinite: {
    id: 'infinite',
    label: 'INFINITE',
    tagline: 'until you stop',
    blurb:
      'No clock and no rung. The level rises while you are winning and falls while you are not, and where it settles is the score.',
    accent: '#c58bff',
  },
};

/**
 * The two buttons a card offers.
 *
 * INFINITE is deliberately not on it. It is one mode's shape rather than a
 * third question, and putting it in this list would print it on every champion
 * card in the client — none of which has a floor that could move.
 */
export const RUN_MODE_LIST: ModeMeta[] = [RUN_MODES.play, RUN_MODES.survive];

/** How long a run of `mode` lasts. Zero means "until it ends itself". */
export const durationFor = (mode: RunMode): number => (mode === 'play' ? PLAY_SECONDS : 0);

/**
 * Whether a run's length was decided by the player rather than by the mode.
 *
 * Both open-ended shapes are long by construction, so neither is allowed to
 * set a score record — a number that only goes up with time on the clock is
 * not a record, it is a stopwatch. They can still set rate records, because a
 * rate is a rate however long you held it.
 */
export const isOpenEnded = (mode: RunMode): boolean => mode !== 'play';

/**
 * The practice list, in the order it is taught.
 *
 * One champion. Every mode on this list spawns Vayne with the parts of her kit
 * that mode is about, so there is never a run where the hands you are training
 * are not the hands you play with.
 *
 * RANGE comes first and hands you no kit at all, because it is the one thing
 * every other mode already assumes you know. Tumbling to a good position, and
 * condemning from one, and holding a stack through a trade are all the same
 * sentence with the same missing word in it: *how far away is far enough*. A
 * player who cannot answer that is practising four abilities on top of a hole.
 */
export const PRACTICE_MODES: DrillId[] = [
  'rangecheck',
  'vayneTumble',
  'vayneBolts',
  'vayneCondemn',
  'vayneHunt',
  // And one that is not about you at all. Everything above this line asks what
  // your hands did; SHERIFF asks what you did about somebody else's, which is
  // the half of a lane no amount of solo practice reaches.
  'caitlynDodge',
];

export const isPracticeMode = (id: DrillId): boolean => PRACTICE_MODES.includes(id);

/**
 * The practice mode that trains a given drill's mechanic.
 *
 * The rating system, the error log and the coach all still speak in terms of
 * the whole drill catalogue — that is where the axes and the diagnoses come
 * from, and none of it stopped being true. What did change is that this client
 * only ever puts you behind one champion, so a recommendation has to arrive as
 * something the menu can actually start. This is that translation, and it is
 * deliberately blunt: three of Vayne's four modes are about one ability each,
 * so anything that is not a kiting, targeting or spacing problem is a problem
 * you have with the whole champion at once.
 */
export const practiceFor = (id: DrillId): DrillId => {
  if (isPracticeMode(id)) return id;
  switch (id) {
    // Dodging has its own mode now, and it is the only one with somebody on
    // the other end of the telegraph. A diagnosis that says you moved late, or
    // stood in something that was drawn on the floor the whole time, is a
    // diagnosis about reading an opponent — so it lands on the opponent.
    case 'dodge':
      return 'caitlynDodge';
    // Kiting and movement are the tumble: when to spend it and where it puts
    // you are the two questions both of those drills ask.
    case 'kite':
    case 'movement':
    case 'wasdKite':
    case 'wasdOffKite':
    case 'wasdDefKite':
      return 'vayneTumble';
    // Anything about which unit you are hitting and whether you finished with
    // it is Silver Bolts.
    case 'targetswitch':
    case 'lasthit':
    // A lane that went badly is nearly always a farming problem wearing a
    // fight's clothes, and Silver Bolts is where the client practises "which
    // unit am I hitting and did I finish it".
    case 'lanePhase':
    case 'aim':
      return 'vayneBolts';
    // Anything about the edge of your own reach is the mode built on it.
    case 'spacing':
      return 'rangecheck';
    // Skillshots are Condemn: both are about where you were standing before
    // the answer was needed.
    case 'skillshot':
      return 'vayneCondemn';
    default:
      return 'vayneHunt';
  }
};
