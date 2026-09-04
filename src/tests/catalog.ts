/**
 * The test catalogue.
 *
 * Twelve instruments in three families. Each one measures a single thing you
 * actually use in a game, reports one honest number, and grades that number
 * against the same ladder the drills use — so "GOLD reaction, DIAMOND recall"
 * is a sentence the app can say about you and mean it.
 *
 * The anchors below are the opinionated part. They are set so that the middle
 * of each ladder lands near where a competent ranked player actually sits, and
 * so the APEX class is genuinely rare rather than a participation reward.
 */

import { RATING_MAX } from '../progression/ranks';
import type { Fmt } from './types';

export type TestId =
  | 'flashReact'
  | 'soundCue'
  | 'keyCast'
  | 'dodgeRead'
  | 'flick'
  | 'lead'
  | 'csClock'
  | 'track'
  | 'mapRecall'
  | 'cooldowns'
  | 'execute'
  | 'comboRecall';

export type TestGroup = 'REFLEX' | 'PRECISION' | 'MIND';

export interface TestMeta {
  id: TestId;
  name: string;
  tagline: string;
  /** What the test asks of you, in one sentence. */
  brief: string;
  /** Why it matters in a real game. */
  transfers: string;
  group: TestGroup;
  accent: string;
  /** The headline number's label and unit. */
  primaryLabel: string;
  primaryFormat: Fmt;
  primaryDirection: 'higher' | 'lower';
  /** Roughly how long a run takes, for the card. */
  seconds: number;
  /** Input the test reads, shown as chips on the card. */
  input: ('mouse' | 'keys')[];
  /** Keys the test binds, if any — drawn as keycaps on the detail panel. */
  keys?: string[];
  /** [value, rating] pairs, ordered from worst to best. */
  anchors: [number, number][];
  order: number;
}

export const TESTS: Record<TestId, TestMeta> = {
  /* ----------------------------------------------------------- REFLEX ---- */
  flashReact: {
    id: 'flashReact',
    name: 'FLASH REACTION',
    tagline: 'The 250ms that saves your life',
    brief: 'The screen goes hostile. Hit FLASH the instant it does — and not one frame before.',
    transfers: 'The single fastest thing you will ever have to do: burning Flash on a hook you only just saw.',
    group: 'REFLEX',
    accent: '#ffcf6b',
    primaryLabel: 'MEDIAN REACTION',
    primaryFormat: 'ms',
    primaryDirection: 'lower',
    seconds: 40,
    input: ['keys'],
    keys: ['F'],
    anchors: [
      [400, 0],
      [320, 600],
      [285, 1200],
      [260, 1800],
      [240, 2400],
      [220, 2800],
      [200, 3200],
      [180, RATING_MAX],
    ],
    order: 1,
  },
  soundCue: {
    id: 'soundCue',
    name: 'SOUND CUE',
    tagline: 'Hear it before you see it',
    brief: 'Eyes closed, effectively. One sound means danger and the others do not. React only to danger.',
    transfers: 'Recognising a summoner spell or an ultimate by its audio and moving before it renders.',
    group: 'REFLEX',
    accent: '#a878ff',
    primaryLabel: 'MEDIAN REACTION',
    primaryFormat: 'ms',
    primaryDirection: 'lower',
    seconds: 40,
    input: ['keys'],
    keys: ['SPACE'],
    anchors: [
      [460, 0],
      [380, 600],
      [335, 1200],
      [300, 1800],
      [272, 2400],
      [248, 2800],
      [225, 3200],
      [200, RATING_MAX],
    ],
    order: 2,
  },
  keyCast: {
    id: 'keyCast',
    name: 'CAST REFLEX',
    tagline: 'Right key, first time',
    brief: 'One ability lights up on the bar. Press exactly that key. Wrong key costs you more than slow.',
    transfers: 'Casting the ability you meant when the fight starts, instead of the one next to it.',
    group: 'REFLEX',
    accent: '#58e0ff',
    primaryLabel: 'MEDIAN CAST',
    primaryFormat: 'ms',
    primaryDirection: 'lower',
    seconds: 40,
    input: ['keys'],
    keys: ['Q', 'W', 'E', 'R', 'D', 'F'],
    anchors: [
      [640, 0],
      [530, 600],
      [468, 1200],
      [420, 1800],
      [382, 2400],
      [350, 2800],
      [318, 3200],
      [285, RATING_MAX],
    ],
    order: 3,
  },
  dodgeRead: {
    id: 'dodgeRead',
    name: 'DODGE READ',
    tagline: 'Move the correct way',
    brief: 'A skillshot charges at you from one side. Step perpendicular to it — the safe way, not any way.',
    transfers: 'Sidestepping instead of running down the line of the skillshot, which is the mistake.',
    group: 'REFLEX',
    accent: '#5ce1a8',
    // Not a plain reaction time: the cost of a hit is divided across the
    // dodges that worked, so a fast guess scores worse than a slow read.
    primaryLabel: 'PER CLEAN DODGE',
    primaryFormat: 'ms',
    primaryDirection: 'lower',
    seconds: 45,
    input: ['keys'],
    keys: ['W', 'A', 'S', 'D'],
    anchors: [
      [760, 0],
      [620, 600],
      [540, 1200],
      [478, 1800],
      [428, 2400],
      [388, 2800],
      [348, 3200],
      [305, RATING_MAX],
    ],
    order: 4,
  },

  /* -------------------------------------------------------- PRECISION ---- */
  flick: {
    id: 'flick',
    name: 'FLICK',
    tagline: 'Cursor on the champion',
    brief: 'Targets surface one at a time. Put the cursor on each one and click. Misses cost time.',
    transfers: 'Right-clicking the champion you meant instead of the minion standing next to them.',
    group: 'PRECISION',
    accent: '#7ceaff',
    primaryLabel: 'MEDIAN ACQUIRE',
    primaryFormat: 'ms',
    primaryDirection: 'lower',
    seconds: 35,
    input: ['mouse'],
    anchors: [
      [960, 0],
      [780, 600],
      [672, 1200],
      [592, 1800],
      [526, 2400],
      [472, 2800],
      [418, 3200],
      [360, RATING_MAX],
    ],
    order: 5,
  },
  lead: {
    id: 'lead',
    name: 'PREDICTION',
    tagline: 'Aim where they will be',
    brief: 'A champion runs. Your skillshot has travel time. Click the point that meets them, not the point they are on.',
    transfers: 'Leading a moving target — the difference between a skillshot champion and a skillshot enjoyer.',
    group: 'PRECISION',
    accent: '#ff6bd6',
    primaryLabel: 'HIT RATE',
    primaryFormat: 'pct',
    primaryDirection: 'higher',
    seconds: 45,
    input: ['mouse'],
    anchors: [
      [0.18, 0],
      [0.34, 600],
      [0.46, 1200],
      [0.57, 1800],
      [0.68, 2400],
      [0.77, 2800],
      [0.86, 3200],
      [0.95, RATING_MAX],
    ],
    order: 6,
  },
  csClock: {
    id: 'csClock',
    name: 'LAST HIT CLOCK',
    tagline: 'Not early, not late',
    brief: 'A minion bleeds out on a timer. Fire the instant its health would hit zero — your shot has windup.',
    transfers: 'CS under pressure: reading a falling health bar against your own attack animation.',
    group: 'PRECISION',
    accent: '#ffd166',
    primaryLabel: 'TIMING ERROR',
    primaryFormat: 'ms',
    primaryDirection: 'lower',
    seconds: 45,
    input: ['keys'],
    keys: ['SPACE'],
    anchors: [
      [170, 0],
      [128, 600],
      [104, 1200],
      [84, 1800],
      [66, 2400],
      [52, 2800],
      [39, 3200],
      [26, RATING_MAX],
    ],
    order: 7,
  },
  track: {
    id: 'track',
    name: 'TRACKING',
    tagline: 'Never lose them',
    brief: 'Hold the cursor on a champion that does not want to be held. No clicking — just stay on it.',
    transfers: 'Keeping your cursor where your next command has to go while everything else is happening.',
    group: 'PRECISION',
    accent: '#ff9f5c',
    primaryLabel: 'TIME ON TARGET',
    primaryFormat: 'pct',
    primaryDirection: 'higher',
    seconds: 30,
    input: ['mouse'],
    anchors: [
      [0.24, 0],
      [0.4, 600],
      [0.52, 1200],
      [0.62, 1800],
      [0.72, 2400],
      [0.8, 2800],
      [0.88, 3200],
      [0.95, RATING_MAX],
    ],
    order: 8,
  },

  /* ------------------------------------------------------------- MIND ---- */
  mapRecall: {
    id: 'mapRecall',
    name: 'MAP RECALL',
    tagline: 'What the minimap told you',
    brief: 'Enemies blink on the minimap and vanish. Click every position back, from memory.',
    transfers: 'The glance. You do not stare at the minimap — you photograph it and play off the photograph.',
    group: 'MIND',
    accent: '#c48bff',
    primaryLabel: 'RECALL ACCURACY',
    primaryFormat: 'pct',
    primaryDirection: 'higher',
    seconds: 60,
    input: ['mouse'],
    anchors: [
      [0.2, 0],
      [0.35, 600],
      [0.46, 1200],
      [0.57, 1800],
      [0.67, 2400],
      [0.76, 2800],
      [0.86, 3200],
      [0.95, RATING_MAX],
    ],
    order: 9,
  },
  cooldowns: {
    id: 'cooldowns',
    name: 'COOLDOWN TRACKER',
    tagline: 'Count their summoners',
    brief: 'Enemies burn spells in front of you. When one is asked for, say whether it is back up yet.',
    transfers: 'Knowing their Flash is down for forty more seconds — the read that wins the next play.',
    group: 'MIND',
    accent: '#0ac8b9',
    primaryLabel: 'CORRECT CALLS',
    primaryFormat: 'pct',
    primaryDirection: 'higher',
    seconds: 60,
    input: ['keys'],
    keys: ['◀ UP', 'DOWN ▶'],
    anchors: [
      [0.5, 0],
      [0.63, 600],
      [0.72, 1200],
      [0.8, 1800],
      [0.87, 2400],
      [0.92, 2800],
      [0.96, 3200],
      [1.0, RATING_MAX],
    ],
    order: 10,
  },
  execute: {
    id: 'execute',
    name: 'EXECUTE CHECK',
    tagline: 'Can you kill them?',
    brief: 'Their health, your damage, one second to answer. Commit or walk — being wrong is how you die.',
    transfers: 'The all-in decision. Most lost duels are arithmetic done half a second too late.',
    group: 'MIND',
    accent: '#e84057',
    primaryLabel: 'CORRECT CALLS',
    primaryFormat: 'pct',
    primaryDirection: 'higher',
    seconds: 50,
    input: ['keys'],
    keys: ['◀ NO', 'GO ▶'],
    anchors: [
      [0.5, 0],
      [0.62, 600],
      [0.71, 1200],
      [0.79, 1800],
      [0.86, 2400],
      [0.91, 2800],
      [0.95, 3200],
      [0.99, RATING_MAX],
    ],
    order: 11,
  },
  comboRecall: {
    id: 'comboRecall',
    name: 'COMBO MEMORY',
    tagline: 'Hands know it, not you',
    brief: 'A sequence flashes, then hides. Play it back clean and fast. One wrong key and the sequence dies.',
    transfers: 'Executing your combo while your eyes are on the fight rather than on your own ability bar.',
    group: 'MIND',
    accent: '#b98cff',
    primaryLabel: 'SEQUENCE TIME',
    primaryFormat: 'ms',
    primaryDirection: 'lower',
    seconds: 60,
    input: ['keys'],
    keys: ['Q', 'W', 'E', 'R'],
    anchors: [
      [4400, 0],
      [3550, 600],
      [3000, 1200],
      [2600, 1800],
      [2250, 2400],
      [1950, 2800],
      [1680, 3200],
      [1380, RATING_MAX],
    ],
    order: 12,
  },
};

export const TEST_LIST = Object.values(TESTS).sort((a, b) => a.order - b.order);

/** Same guard as the catalogue's, for ids read back out of a saved profile. */
export const isTestId = (v: unknown): v is TestId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(TESTS, v);

export const TEST_GROUPS: { id: TestGroup; title: string; blurb: string }[] = [
  { id: 'REFLEX', title: 'Reflex', blurb: 'How fast the signal gets from your eyes to your hand' },
  { id: 'PRECISION', title: 'Precision', blurb: 'Where the cursor lands and when the key goes down' },
  { id: 'MIND', title: 'Mind', blurb: 'What you remember, count and decide while it is happening' },
];

/**
 * Grade a raw value against a test's anchors. Returns a rating on the same
 * 0..3600 ladder the drills use, so a test tier and a drill tier mean the
 * same thing.
 */
export const gradeTest = (id: TestId, value: number): number => {
  const a = TESTS[id].anchors;
  if (!Number.isFinite(value)) return 0;
  const lowerIsBetter = a[0][0] > a[a.length - 1][0];

  for (let i = 0; i < a.length - 1; i++) {
    const [v0, r0] = a[i];
    const [v1, r1] = a[i + 1];
    const lo = Math.min(v0, v1);
    const hi = Math.max(v0, v1);
    if (value >= lo && value <= hi) {
      const t = v1 === v0 ? 0 : (value - v0) / (v1 - v0);
      return Math.max(0, Math.min(RATING_MAX, r0 + (r1 - r0) * t));
    }
  }
  // Off the end of the table in one direction or the other.
  const worst = a[0][0];
  if (lowerIsBetter) return value > worst ? 0 : RATING_MAX;
  return value < worst ? 0 : RATING_MAX;
};

/** The value you would need to hit to reach `rating` — used for "next tier". */
export const valueForRating = (id: TestId, rating: number): number => {
  const a = TESTS[id].anchors;
  for (let i = 0; i < a.length - 1; i++) {
    const [v0, r0] = a[i];
    const [v1, r1] = a[i + 1];
    if (rating >= r0 && rating <= r1) {
      const t = r1 === r0 ? 0 : (rating - r0) / (r1 - r0);
      return v0 + (v1 - v0) * t;
    }
  }
  return a[a.length - 1][0];
};

/** One formatter for every number a test can report. */
export const formatTestValue = (v: number, f: Fmt): string => {
  switch (f) {
    case 'ms':
      return `${Math.round(v)}`;
    case 'pct':
      return `${Math.round(v * 100)}`;
    case 'sec':
      return v.toFixed(1);
    case 'units':
      return `${Math.round(v)}`;
    case 'apm':
      return `${Math.round(v)}`;
    default:
      return `${Math.round(v)}`;
  }
};

export const unitFor = (f: Fmt): string =>
  f === 'ms' ? 'MS' : f === 'pct' ? '%' : f === 'sec' ? 'S' : f === 'units' ? 'PX' : f === 'apm' ? 'APM' : '';
