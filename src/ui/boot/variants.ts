/**
 * THE COLD OPEN, IN SIX MOODS.
 *
 * The boot screen is the one screen every single player sees, every single
 * time, and a screen you see every time is a screen you stop looking at. So
 * it is not one screen: it is a small repertory company. Six *shows* — a
 * mood, a particle motif, a field behind the crest, a way the wordmark
 * arrives and a way the whole thing leaves — and one of them is cast at
 * random on every load.
 *
 * The rules the repertory obeys:
 *
 *  - **The identity never moves.** Gold leaf on black-blue, the crest dead
 *    centre, APEX under it in the display face. A player must never wonder
 *    whether they opened the right thing. Everything that varies is weather.
 *  - **Nothing varies that carries information.** The phase names are worded
 *    differently by different shows, but every wording names the same real
 *    piece of work; the bar, the manifest and the percentage are identical in
 *    all six.
 *  - **Never the same show twice in a row.** A random pick from six repeats
 *    about one load in six, which is exactly often enough for somebody to
 *    conclude it is not random at all. The last show is remembered and
 *    excluded.
 */

/** The particle motif: what is drifting through the frame. */
export type Motif = 'embers' | 'starfall' | 'motes' | 'sparks' | 'runes' | 'ash';
/** The field behind the crest: the one big slow shape under everything. */
export type Field = 'sunburst' | 'rings' | 'grid' | 'aurora' | 'shards' | 'horizon';
/** How the wordmark arrives. */
export type Reveal = 'strike' | 'unfurl' | 'forge';
/** How the whole card leaves when you press the key. */
export type Exit = 'flash' | 'iris' | 'shutter';

/**
 * The four real pieces of work the bar is measuring.
 *
 * These are milestones the arena actually reports, in the order it reaches
 * them — not a script. `boot` lands the moment the client's own code is
 * running, `scene` when the terrain, sky and shaders exist, `rigs` when the
 * champions have been built, `frame` when the first frame is on the glass.
 */
export const MILESTONES = ['boot', 'scene', 'rigs', 'frame'] as const;
export type Milestone = (typeof MILESTONES)[number];

export interface Show {
  /** Stable id, printed in the corner. Players notice these and compare them. */
  id: string;
  /** The show's name, printed in the corner beside the id. */
  name: string;
  motif: Motif;
  field: Field;
  reveal: Reveal;
  /** The secondary light in the frame. Gold is structure; this is weather. */
  tint: string;
  /** How many motes the motif wants. Dense fields get more, slow ones fewer. */
  motes: number;
  /** One line per milestone, in `MILESTONES` order. Same work, different voice. */
  phases: [string, string, string, string];
  /** What the gate says, under PRESS ANY KEY. */
  gateLine: string;
}

/**
 * The company.
 *
 * Six shows, deliberately close together. The temptation with a system like
 * this is to make one of them neon and one of them a wireframe, at which
 * point the product has six logos. These differ the way two takes of the
 * same shot differ: the light has moved, the weather has changed, the lens
 * is a little longer. You notice across loads, never within one.
 */
export const SHOWS: Show[] = [
  {
    id: 'I',
    name: 'FORGE',
    motif: 'embers',
    field: 'sunburst',
    reveal: 'strike',
    tint: '255, 170, 90',
    motes: 18,
    phases: ['WAKING THE CLIENT', 'RAISING THE TERRAIN', 'FORGING CHAMPIONS', 'LIGHTING THE RIFT'],
    gateLine: 'the anvil is hot',
  },
  {
    id: 'II',
    name: 'NIGHTFALL',
    motif: 'starfall',
    field: 'rings',
    reveal: 'unfurl',
    tint: '120, 180, 255',
    motes: 24,
    phases: ['WAKING THE CLIENT', 'CUTTING THE LANES', 'CALLING THE CHAMPIONS', 'HANGING THE SKY'],
    gateLine: 'the lane is dark and empty',
  },
  {
    id: 'III',
    name: 'TIDEGLASS',
    motif: 'motes',
    field: 'aurora',
    reveal: 'forge',
    tint: '90, 226, 214',
    motes: 14,
    phases: ['WAKING THE CLIENT', 'FLOODING THE VALLEY', 'SHAPING CHAMPIONS', 'WARMING THE RIFT'],
    gateLine: 'the water is still',
  },
  {
    id: 'IV',
    name: 'RELIC',
    motif: 'runes',
    field: 'grid',
    reveal: 'strike',
    tint: '176, 140, 255',
    motes: 12,
    phases: ['WAKING THE CLIENT', 'READING THE GROUND', 'BINDING CHAMPIONS', 'TURNING THE KEY'],
    gateLine: 'something is buried here',
  },
  {
    id: 'V',
    name: 'STORMFRONT',
    motif: 'sparks',
    field: 'shards',
    reveal: 'unfurl',
    tint: '150, 220, 255',
    motes: 26,
    phases: ['WAKING THE CLIENT', 'BREAKING THE GROUND', 'ARMING CHAMPIONS', 'CHARGING THE RIFT'],
    gateLine: 'the air is about to break',
  },
  {
    id: 'VI',
    name: 'FIRSTLIGHT',
    motif: 'ash',
    field: 'horizon',
    reveal: 'forge',
    tint: '255, 205, 150',
    motes: 16,
    phases: ['WAKING THE CLIENT', 'DRAWING THE HORIZON', 'WAKING CHAMPIONS', 'RAISING THE SUN'],
    gateLine: 'it is early, and quiet',
  },
];

/**
 * The line along the bottom.
 *
 * A loading screen with nothing to read on it is a loading screen people
 * spend looking at the percentage, and a percentage is the one thing on this
 * screen that can disappoint. So there is always exactly one sentence to
 * read, and it is always a true thing about playing this trainer rather than
 * flavour text — somebody who reads twenty of these over a fortnight should
 * come out of it measurably better.
 */
export const EPIGRAPHS: string[] = [
  'Attack-move keeps your feet under your damage. Every good kite is a hundred of them.',
  'A cancelled attack is not a mistake if the animation had already finished. Learn where that line is.',
  'Tumble is a reposition, not an escape. The best ones end closer to the fight.',
  'Last-hitting is not an aim problem. It is a patience problem with an aim problem inside it.',
  'Your hands are faster than your decisions. The lab measures the hands; the lane measures the rest.',
  'Every drill in here is one minute long. The improvement is in the tenth one, not the first.',
  'Condemn into terrain, not into space. A wall is worth more than the damage.',
  'Nobody has ever out-clicked a bad position. Move first, then press things.',
  'A streak broken at forty is worth more than a streak of five, restarted eight times.',
  'The score you keep is the median, not your best run. Your best run was luck and you know it.',
  'Stand still to shoot, move the instant it lands. That gap is the whole champion.',
  'If a drill feels easy, the level is wrong, not you. The arrows move for a reason.',
  'Practise the thing you avoid. It is not a coincidence that it is also the thing you are worst at.',
  'Watch the enemy cast bar, not the enemy. The champion tells you nothing the bar has not already said.',
  'Warm up your hands before you rank up your account. Two minutes here is worth a lost promo.',
  'You do not need to be fast everywhere. You need to be fast in the four seconds that decide it.',
];

/** How long the theatre takes, in seconds. Jittered a little per load. */
export interface Pacing {
  /** When the crest is struck. */
  strikeAt: number;
  /** When the loading furniture arrives. */
  loadAt: number;
  /** The floor on the load stage, so a fast machine still gets the ceremony. */
  minShow: number;
  /** The ceiling on the whole wait, however slow the machine is. */
  maxWait: number;
}

export interface Cast {
  show: Show;
  /**
   * How this load's card leaves. Cast beside the show rather than baked into
   * it: three exits over six shows is eighteen cold opens, and the door you
   * go through is the last thing you see, so it is the one worth varying
   * inside a show you have already recognised.
   */
  exit: Exit;
  epigraph: string;
  pacing: Pacing;
  /** Which way the crest's tick ring turns this time. */
  spin: 1 | -1;
  motes: Mote[];
}

/** One drifting particle, positioned and timed once at cast. */
export interface Mote {
  key: number;
  /** Percent across the frame. */
  x: number;
  /** Percent down the frame — the start line for motifs that do not rise. */
  y: number;
  size: number;
  /** Negative, so the field is already mid-flight on the first frame. */
  delay: number;
  duration: number;
  /** Sideways travel over the life of the mote, in px. */
  drift: number;
}

const LAST_SHOW_KEY = 'apex.boot.last';

const pick = <T>(list: readonly T[], rnd: () => number): T => list[Math.floor(rnd() * list.length) % list.length];

const motesFor = (show: Show, rnd: () => number): Mote[] =>
  Array.from({ length: show.motes }, (_, i) => {
    // Spread along the axis rather than scattered: an even field with jitter
    // reads as weather, a purely random one reads as clumps and gaps.
    const spread = (i + 0.5) / show.motes;
    const fast = show.motif === 'sparks';
    const slow = show.motif === 'motes' || show.motif === 'ash';
    return {
      key: i,
      x: spread * 100 + (rnd() * 9 - 4.5),
      y: rnd() * 100,
      size: (fast ? 1.4 : slow ? 2.4 : 2) + rnd() * (fast ? 2 : 3),
      delay: -rnd() * 16,
      duration: (fast ? 5 : slow ? 14 : 9) + rnd() * (fast ? 4 : 7),
      drift: Math.round(rnd() * (slow ? 120 : 70) - (slow ? 60 : 35)),
    };
  });

/**
 * Cast the show for this load.
 *
 * `rnd` is injectable so the whole thing can be exercised deterministically
 * from a test; in the client it is `Math.random` and the only state that
 * survives a reload is which show ran last.
 */
export function castBoot(rnd: () => number = Math.random): Cast {
  let last = '';
  try {
    last = localStorage.getItem(LAST_SHOW_KEY) ?? '';
  } catch {
    // Private mode, a wiped profile, a browser that has decided storage is a
    // permission. None of that is worth a black screen: we simply lose the
    // "never twice in a row" guarantee for this load.
  }
  const eligible = SHOWS.filter((s) => s.id !== last);
  const show = pick(eligible.length > 0 ? eligible : SHOWS, rnd);
  try {
    localStorage.setItem(LAST_SHOW_KEY, show.id);
  } catch {
    /* see above */
  }

  const jitter = (base: number, spread: number) => Number((base + (rnd() * 2 - 1) * spread).toFixed(3));

  return {
    show,
    exit: pick(['flash', 'iris', 'shutter'] as const, rnd),
    epigraph: pick(EPIGRAPHS, rnd),
    spin: rnd() < 0.5 ? 1 : -1,
    pacing: {
      strikeAt: jitter(0.34, 0.07),
      loadAt: jitter(1.42, 0.14),
      // The floor is what makes a fast machine feel expensive rather than
      // abrupt: even with everything already in memory, the crest finishes
      // drawing and the manifest ticks through before the gate opens.
      minShow: jitter(2.5, 0.35),
      // And the ceiling is what makes a slow one bearable. Past this the
      // player is let in regardless and the arena arrives behind them.
      maxWait: 9,
    },
    motes: motesFor(show, rnd),
  };
}
