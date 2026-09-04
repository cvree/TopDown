import { clamp } from '../engine/math';
import { DRILLS, WASD_SEQUENCE, type DrillId } from '../drills/catalog';

/**
 * THE WASD ACADEMY.
 *
 * The trainer's ladder rates ten mechanical axes and does not care how you
 * drive. The Vayne path is one champion, learned in order. This is the third
 * shape: one *control scheme*, taught from the four keys upward, because the
 * scheme is not a setting — it is a set of motor skills that nobody is born
 * with and that no amount of playing normally will isolate for you.
 *
 * The course is gated, and it is gated hard, because the dependencies here are
 * real rather than pedagogical. You cannot learn to attack while moving until
 * stopping is reliable. You cannot kite until you know which stretch of the
 * attack a key is free in. You cannot multitask at all until each of the
 * things being tasked is something your hands do without being watched.
 *
 * Mastery weights the later modules more heavily and folds difficulty in, so
 * the number keeps moving for as long as there is a harder version of the
 * thing you are already able to do.
 */

export type WasdModuleId =
  | 'wasdMove'
  | 'wasdIndep'
  | 'wasdStrafe'
  | 'wasdAimMove'
  | 'wasdCadence'
  | 'wasdKite'
  | 'wasdOffKite'
  | 'wasdDefKite'
  | 'wasdMulti';

export interface WasdModule {
  id: WasdModuleId;
  /** Position in the course, from 1. */
  step: number;
  /** The short name, without the number. */
  title: string;
  /** What the module is for, in one line. */
  purpose: string;
  /** The thing it teaches that the click scheme cannot express at all. */
  onlyHere: string;
  /** Performance needed to open the next module. */
  gate: number;
  /** Share of total mastery. */
  weight: number;
  /** Roughly how long a run takes, for the session planner. */
  minutes: number;
}

export const WASD_MODULES: WasdModule[] = [
  {
    id: 'wasdMove',
    step: 1,
    title: 'Movement',
    purpose: 'Cardinals, diagonals, snap reversals, terrain, and stopping exactly where you meant to.',
    onlyHere: 'A held key has no destination in it. The release is the destination, and it has to be learnt.',
    gate: 0.55,
    weight: 0.1,
    minutes: 1.5,
  },
  {
    id: 'wasdIndep',
    step: 2,
    title: 'Cursor independence',
    purpose: 'Feet one way, cursor the other, for as much of the run as you can hold it.',
    onlyHere: 'Under a mouse, where you are going and where you are looking are one instruction. Here they are two.',
    gate: 0.56,
    weight: 0.13,
    minutes: 1.5,
  },
  {
    id: 'wasdStrafe',
    step: 3,
    title: 'Strafing',
    purpose: 'Move across the line rather than along it, and change on no rhythm anybody can lead.',
    onlyHere: 'Direction changes cost nothing but a key, so they can be irregular in a way clicking never is.',
    gate: 0.56,
    weight: 0.1,
    minutes: 1.5,
  },
  {
    id: 'wasdAimMove',
    step: 4,
    title: 'Aim while moving',
    purpose: 'Acquire and commit without the pause. Accuracy, acquisition time and uptime, measured apart.',
    onlyHere: 'Your aiming hand is not also your walking hand, so there is no reason left to stop.',
    gate: 0.57,
    weight: 0.11,
    minutes: 1.3,
  },
  {
    id: 'wasdCadence',
    step: 5,
    title: 'Attack cadence',
    purpose: 'The four stretches of an attack, and which of them a held key destroys.',
    onlyHere: 'A key does not only cancel an attack, it prevents one. The release is the trigger.',
    gate: 0.58,
    weight: 0.14,
    minutes: 1.5,
  },
  {
    id: 'wasdKite',
    step: 6,
    title: 'Kiting',
    purpose: 'The full cycle, scored on when each command landed rather than how many you sent.',
    onlyHere: 'The step out of the backswing is a key, which is faster and far more repeatable than a click.',
    gate: 0.58,
    weight: 0.13,
    minutes: 1.4,
  },
  {
    id: 'wasdOffKite',
    step: 7,
    title: 'Offensive kiting',
    purpose: 'It runs; you follow at the outer edge of your range and never one step deeper.',
    onlyHere: 'You can chase with your feet while your cursor stays pinned to something that is leaving.',
    gate: 0.58,
    weight: 0.1,
    minutes: 1.4,
  },
  {
    id: 'wasdDefKite',
    step: 8,
    title: 'Defensive kiting',
    purpose: 'They come to you. Everything you deal from outside their reach counts; the rest barely does.',
    onlyHere: 'Retreating and firing forward are one motion instead of two competing clicks.',
    gate: 0.58,
    weight: 0.1,
    minutes: 1.4,
  },
  {
    id: 'wasdMulti',
    step: 9,
    title: 'Multitasking',
    purpose: 'Feet, attacks, two cooldowns, telegraphs and a moving priority target. A very small teamfight.',
    onlyHere: 'Everything above, at the same time, which is the only state a real fight is ever in.',
    gate: 0.6,
    weight: 0.09,
    minutes: 1.8,
  },
];

export const WASD_MODULE_IDS: WasdModuleId[] = WASD_MODULES.map((m) => m.id);

export const isWasdModuleId = (id: DrillId): id is WasdModuleId =>
  (WASD_SEQUENCE as DrillId[]).includes(id);

export const moduleOf = (id: WasdModuleId): WasdModule =>
  WASD_MODULES[WASD_MODULE_IDS.indexOf(id)];

// ------------------------------------------------------------------ records

export interface WasdModuleRecord {
  /** Best performance ever recorded, 0..1. */
  best: number;
  /** The difficulty that best run was played at. */
  difficulty: number;
  bestScore: number;
  runs: number;
  /**
   * The *last* run's headline numbers, keyed by metric id.
   *
   * Deliberately the last rather than the best, for the same reason the
   * champion path does it: mastery is a claim about your ceiling and must never
   * fall, while a habit is a claim about how you are playing now — and that is
   * exactly the thing that is allowed to get worse.
   */
  habits?: Record<string, number>;
  at: number;
}

export interface WasdProgress {
  modules: Record<WasdModuleId, WasdModuleRecord>;
  /** 0..100, derived. Stored so the client can draw it without maths. */
  mastery: number;
  /** Highest mastery ever held, so one bad run never takes a title away. */
  peak: number;
}

const emptyRecord = (): WasdModuleRecord => ({ best: 0, difficulty: 0, bestScore: 0, runs: 0, at: 0 });

export const emptyWasdProgress = (): WasdProgress => ({
  modules: WASD_MODULE_IDS.reduce(
    (acc, id) => {
      acc[id] = emptyRecord();
      return acc;
    },
    {} as Record<WasdModuleId, WasdModuleRecord>,
  ),
  mastery: 0,
  peak: 0,
});

/** Repairs a progress object loaded from storage, whatever shape it is in. */
export const normalizeWasdProgress = (raw: Partial<WasdProgress> | undefined): WasdProgress => {
  const out = emptyWasdProgress();
  if (!raw) return out;
  for (const id of WASD_MODULE_IDS) {
    const src = raw.modules?.[id];
    if (!src) continue;
    out.modules[id] = {
      best: clamp(src.best ?? 0, 0, 1),
      difficulty: clamp(src.difficulty ?? 0, 0, 1),
      bestScore: Math.max(0, src.bestScore ?? 0),
      runs: Math.max(0, src.runs ?? 0),
      habits: src.habits ?? undefined,
      at: src.at ?? 0,
    };
  }
  out.mastery = computeWasdMastery(out);
  out.peak = Math.max(out.mastery, raw.peak ?? 0);
  return out;
};

// ------------------------------------------------------------------ queries

/** What a module's best run is worth, difficulty folded in. */
export const moduleValue = (rec: WasdModuleRecord): number =>
  clamp(rec.best, 0, 1) * (0.55 + 0.45 * clamp(rec.difficulty, 0, 1));

export const computeWasdMastery = (p: WasdProgress): number => {
  let total = 0;
  for (const m of WASD_MODULES) total += moduleValue(p.modules[m.id]) * m.weight;
  return clamp(total * 100, 0, 100);
};

export const moduleStars = (m: WasdModule, rec: WasdModuleRecord): 0 | 1 | 2 | 3 => {
  if (rec.best >= 0.85) return 3;
  if (rec.best >= 0.72) return 2;
  if (rec.best >= m.gate) return 1;
  return 0;
};

export const moduleCleared = (m: WasdModule, rec: WasdModuleRecord): boolean => rec.best >= m.gate;

/** A module is playable once the one before it has been cleared. */
export const moduleUnlocked = (p: WasdProgress, m: WasdModule): boolean => {
  if (m.step === 1) return true;
  const prev = WASD_MODULES[m.step - 2];
  return p.modules[prev.id].best >= prev.gate;
};

export const clearedCount = (p: WasdProgress): number =>
  WASD_MODULES.filter((m) => moduleCleared(m, p.modules[m.id])).length;

/** The module the academy sends you to next. */
export const nextWasdModule = (p: WasdProgress): WasdModule => {
  for (const m of WASD_MODULES) {
    if (!moduleUnlocked(p, m)) return WASD_MODULES[m.step - 2];
    if (p.modules[m.id].best < m.gate) return m;
  }
  // All cleared: the one with the most room left in it.
  return [...WASD_MODULES].sort((a, b) => moduleValue(p.modules[a.id]) - moduleValue(p.modules[b.id]))[0];
};

export interface WasdTitle {
  name: string;
  at: number;
  blurb: string;
}

export const WASD_TITLES: WasdTitle[] = [
  { name: 'MOUSE HANDS', at: 0, blurb: 'Your left hand is still a passenger.' },
  { name: 'FOUR KEYS', at: 14, blurb: 'You go where you meant to, and you stop when you meant to.' },
  { name: 'TWO HANDS', at: 28, blurb: 'Your cursor has stopped asking your feet for permission.' },
  { name: 'HARD TARGET', at: 42, blurb: 'You are missed by things that used to hit you.' },
  { name: 'CADENCED', at: 56, blurb: 'You know which part of an attack is yours and which part is not.' },
  { name: 'ORBWALKER', at: 70, blurb: 'The cycle holds without you thinking about it.' },
  { name: 'UNTOUCHABLE', at: 84, blurb: 'You deal damage from places nobody can answer from.' },
  { name: 'FULL LOAD', at: 94, blurb: 'Nine modules, at a difficulty with nothing left to teach you.' },
];

export const wasdTitleFor = (mastery: number): WasdTitle => {
  let out = WASD_TITLES[0];
  for (const t of WASD_TITLES) if (mastery >= t.at) out = t;
  return out;
};

export const nextWasdTitle = (mastery: number): WasdTitle | null =>
  WASD_TITLES.find((t) => t.at > mastery) ?? null;

// --------------------------------------------------------------------- runs

export interface WasdRunReport {
  module: WasdModule;
  improved: boolean;
  previousBest: number;
  best: number;
  starsBefore: 0 | 1 | 2 | 3;
  starsAfter: 0 | 1 | 2 | 3;
  masteryBefore: number;
  masteryAfter: number;
  titleBefore: WasdTitle;
  titleAfter: WasdTitle;
  /** The module this run opened, if any. */
  unlocked: WasdModule | null;
}

/**
 * Records one run against the course.
 *
 * Only an improvement moves anything. A worse run still counts as a run and
 * still feeds the general ladder; it cannot take mastery away, because your
 * ceiling did not fall because you had one bad ninety seconds.
 */
export const applyWasdRun = (
  p: WasdProgress,
  drill: DrillId,
  performance: number,
  difficulty: number,
  score: number,
  habits: Record<string, number> = {},
): WasdRunReport | null => {
  if (!isWasdModuleId(drill)) return null;
  const mod = moduleOf(drill);
  const rec = p.modules[drill];
  const masteryBefore = p.mastery;
  const titleBefore = wasdTitleFor(p.peak);
  const starsBefore = moduleStars(mod, rec);
  const previousBest = rec.best;
  const clearedBefore = moduleCleared(mod, rec);

  rec.runs += 1;
  rec.bestScore = Math.max(rec.bestScore, score);
  rec.habits = habits;
  const improved = performance > rec.best;
  if (improved) {
    rec.best = clamp(performance, 0, 1);
    rec.difficulty = clamp(difficulty, 0, 1);
    rec.at = Date.now();
  }

  p.mastery = computeWasdMastery(p);
  p.peak = Math.max(p.peak, p.mastery);

  const nowCleared = moduleCleared(mod, rec);
  const unlocked =
    !clearedBefore && nowCleared && mod.step < WASD_MODULES.length ? WASD_MODULES[mod.step] : null;

  return {
    module: mod,
    improved,
    previousBest,
    best: rec.best,
    starsBefore,
    starsAfter: moduleStars(mod, rec),
    masteryBefore,
    masteryAfter: p.mastery,
    titleBefore,
    titleAfter: wasdTitleFor(p.peak),
    unlocked,
  };
};

/** The name the client prints for a module. */
export const wasdModuleName = (id: WasdModuleId): string => DRILLS[id].name;

/* ------------------------------------------------------------- diagnosis */

/**
 * The habits, and what each one costs.
 *
 * Nine modules produce sixty numbers between them and a player looking at
 * sixty numbers learns nothing. This table is what lets the academy name the
 * single thing costing the most right now, in a sentence, with the module that
 * fixes it one click away.
 */
export interface WasdHabit {
  module: WasdModuleId;
  /** The key-metric id the module reports it under. */
  id: string;
  label: string;
  /** The value at which this habit has stopped costing anything. */
  good: number;
  /** Set when the metric is better lower — the gap is then measured the other way. */
  lowerIsBetter?: boolean;
  /** The scale a "lower is better" metric is judged against. */
  scale?: number;
  fix: string;
}

export const WASD_HABITS: WasdHabit[] = [
  {
    module: 'wasdMove',
    id: 'stopError',
    label: 'Stopping where you meant to',
    good: 18,
    lowerIsBetter: true,
    scale: 70,
    fix: 'Release before you arrive. Under the keys you carry about a body-length past the moment your hand lifts.',
  },
  {
    module: 'wasdMove',
    id: 'pathEff',
    label: 'Arriving in one motion',
    good: 0.82,
    fix: 'Pick the diagonal and hold it, rather than going across and then down. Two motions is twice the distance.',
  },
  {
    module: 'wasdIndep',
    id: 'independence',
    label: 'Hands pointing different ways',
    good: 0.42,
    fix: 'The whole scheme is here. Hold a direction and deliberately point the cursor elsewhere — it feels wrong for a minute and then never again.',
  },
  {
    module: 'wasdIndep',
    id: 'aimUptime',
    label: 'Holding the cursor on target',
    good: 0.78,
    fix: 'Put the cursor on the mark and then forget the mouse exists. Your left hand can solve the rest without it.',
  },
  {
    module: 'wasdStrafe',
    id: 'lateral',
    label: 'Moving across the line',
    good: 0.62,
    fix: 'Running at a skillshot and running from it are the same mistake. Only movement across it changes the angle.',
  },
  {
    module: 'wasdStrafe',
    id: 'irregular',
    label: 'Being unreadable',
    good: 0.5,
    fix: 'Vary how long you hold each direction. Anything on a rhythm can be led, and it will be.',
  },
  {
    module: 'wasdAimMove',
    id: 'movingHits',
    label: 'Taking targets on the move',
    good: 0.8,
    fix: 'You are releasing the keys to click. You never have to — the cursor is a separate hand.',
  },
  {
    module: 'wasdCadence',
    id: 'freeWindow',
    label: 'Using the free window',
    good: 0.78,
    fix: 'The backswing is movement you have already paid for. Step the instant the shot leaves.',
  },
  {
    module: 'wasdCadence',
    id: 'trigger',
    label: 'Letting go to shoot',
    good: 120,
    lowerIsBetter: true,
    scale: 500,
    fix: 'A held key does not delay the attack, it prevents it. Release, shoot, hold again — one beat each.',
  },
  {
    module: 'wasdKite',
    id: 'stepDelay',
    label: 'Stepping on the beat',
    good: 200,
    lowerIsBetter: true,
    scale: 700,
    fix: 'The step belongs at the front of the backswing, not at the end of it. Late is a window you only half used.',
  },
  {
    module: 'wasdKite',
    id: 'closing',
    label: 'Not closing when in range',
    good: 2,
    lowerIsBetter: true,
    scale: 14,
    fix: 'You are walking toward things you can already hit. Once you are in range, every step forward is free damage for them.',
  },
  {
    module: 'wasdOffKite',
    id: 'edgeShots',
    label: 'Chasing from the edge',
    good: 0.65,
    fix: 'Following is not chasing. Step, shoot, step — never two steps between attacks.',
  },
  {
    module: 'wasdDefKite',
    id: 'safeShots',
    label: 'Dealing damage from outside their reach',
    good: 0.75,
    fix: 'Step first, shoot second. The urge to get one more attack in is what closes the gap.',
  },
  {
    module: 'wasdMulti',
    id: 'load',
    label: 'Carrying the whole load',
    good: 0.72,
    fix: 'Something specific is being dropped under load. The module names it — give that one part a deliberate thought per exchange.',
  },
];

export interface WasdDiagnosis {
  habit: WasdHabit;
  value: number;
  /** How far short it is, 0..1. The reason this one was picked. */
  gap: number;
}

/**
 * The one habit costing the most right now, or null when there is not enough
 * evidence. Reads the last run on each module, because "what should I go and
 * fix" is a question about how you are playing now.
 */
export const diagnoseWasd = (p: WasdProgress): WasdDiagnosis | null => {
  let worst: WasdDiagnosis | null = null;
  for (const habit of WASD_HABITS) {
    const rec = p.modules[habit.module];
    if (!rec || rec.runs === 0) continue;
    const value = rec.habits?.[habit.id];
    if (value === undefined || !Number.isFinite(value)) continue;
    const gap = habit.lowerIsBetter
      ? clamp((value - habit.good) / Math.max(1, habit.scale ?? 1), 0, 1)
      : clamp((habit.good - value) / Math.max(0.01, habit.good), 0, 1);
    if (gap <= 0.06) continue;
    if (!worst || gap > worst.gap) worst = { habit, value, gap };
  }
  return worst;
};
