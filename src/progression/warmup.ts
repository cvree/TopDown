import { APM_MODES, levelDifficulty, recommendedLevel } from './apm';
import { errorRollup } from './coach';
import { ERRORS, type ErrorCode } from './errors';
import { DRILLS, isDrillId, type DrillId } from '../drills/catalog';
import { championOf, practiceFor } from '../drills/modes';
import type { Profile } from './profile';

/**
 * THE WARM-UP.
 *
 * Everything else in this client is a menu, and a menu is the right screen for
 * somebody who knows what they want. The warm-up is for the other nine days in
 * ten: one button, ten minutes, and the order a coach would use — measure the
 * hands, fix one thing twice, keep the fingers honest, then do it under
 * pressure — ending on a single sentence to take into the next game.
 *
 * The shape comes from the research rather than from taste, and where the
 * research is silent the file says so:
 *
 *  - **Spacing beats volume.** In League's own new-player data, spreading
 *    practice across days went with better outcomes than cramming it (PLOS
 *    ONE, 2022, observational). So the unit is a short daily block and
 *    "come back tomorrow" is a *successful* end state, not a failure to
 *    continue. Ten minutes is our product default, not a proven optimum.
 *  - **Blocked, then combined.** A mechanic is learnt fastest in a block of
 *    the same thing and kept best when it has to survive among other
 *    demands. So the focus is played twice in a row, then a combined mode
 *    asks for it with an opponent attached.
 *  - **Yesterday's mistake first.** The focus is the mistake you made most in
 *    the last two days, re-shown before anything new.
 *  - **Stop when you are getting worse.** A second set clearly worse than the
 *    first on a day your reaction time is well off your own normal is not
 *    practice, it is rehearsing tiredness. The routine ends early and says
 *    so, and it still counts.
 *  - **A streak that forgives.** Any finished warm-up counts, however short.
 *    Every seven days in a row banks a freeze, up to two, and a freeze covers
 *    a missed day automatically. A streak that punishes hard enough to
 *    compete with ranked games is a streak working against its owner.
 */

// ===================================================================== tests

/**
 * The four reaction tests.
 *
 * Skill Gap sells these as a warm-up in their own right and they are useful
 * for one thing above all: they are a *thermometer*. Measured the same way
 * every day on the same machine, a simple reaction time moves with sleep,
 * warmth and tiredness far more than with skill, which is exactly why the
 * warm-up opens on one — it tells the routine what kind of day it is.
 *
 * Every figure includes the browser, the display and the input device. They
 * are comparable with yourself on the same setup and with nobody else.
 */
export type ReactionTestId = 'visual' | 'audio' | 'choice' | 'aim';

export const REACTION_TESTS: ReactionTestId[] = ['visual', 'audio', 'choice', 'aim'];

export interface ReactionTestMeta {
  id: ReactionTestId;
  label: string;
  /** What you do, in one line. */
  ask: string;
  /** Why it is here, in one line. */
  why: string;
  trials: number;
  accent: string;
}

export const REACTION_META: Record<ReactionTestId, ReactionTestMeta> = {
  visual: {
    id: 'visual',
    label: 'SEE IT',
    ask: 'The screen lights. Press anything, as fast as you can.',
    why: 'Simple reaction to light — the warm-up’s thermometer.',
    trials: 5,
    accent: '#58e0ff',
  },
  audio: {
    id: 'audio',
    label: 'HEAR IT',
    ask: 'Nothing on screen changes. A tone plays. Press anything.',
    why: 'Sound reaches the brain faster than light does. Most people are quicker here.',
    trials: 5,
    accent: '#a878ff',
  },
  choice: {
    id: 'choice',
    label: 'CHOOSE IT',
    ask: 'One of your four ability keys lights up. Press that one.',
    why: 'Four answers are slower than one. The gap between this and SEE IT is the price of choosing.',
    trials: 8,
    accent: '#ffcf5c',
  },
  aim: {
    id: 'aim',
    label: 'CLICK IT',
    ask: 'A target appears somewhere. Put the cursor on it and click.',
    why: 'Reaction plus travel: the gesture every last hit is made of.',
    trials: 8,
    accent: '#4fd47c',
  },
};

/** One finished test. `median` is the headline; smaller is better. */
export interface ReactionRun {
  t: number;
  /** Median reaction, ms. */
  median: number;
  /** Median absolute deviation, ms — how steady you were. */
  spread: number;
  /** Share of trials answered correctly (choice / aim); 1 for simple tests. */
  accuracy: number;
  trials: number;
  /** Presses before the cue. Those trials are repeated, not scored. */
  falseStarts: number;
}

export interface ReactionRecord {
  best: number | null;
  runs: ReactionRun[];
}

/** Median of a list, or NaN for an empty one. */
export const median = (xs: readonly number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Median absolute deviation: robust to the one trial where you blinked. */
export const mad = (xs: readonly number[]): number => {
  if (!xs.length) return NaN;
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
};

/**
 * Turn a set of trials into a run.
 *
 * A wrong answer on the choice or aim tests is not a reaction time at all, so
 * it is left out of the median and counted against accuracy instead — folding
 * it in would reward guessing fast.
 */
export const summariseTrials = (
  trials: readonly { ms: number; correct: boolean }[],
  falseStarts: number,
  t = Date.now(),
): ReactionRun => {
  const good = trials.filter((x) => x.correct && Number.isFinite(x.ms) && x.ms > 0).map((x) => x.ms);
  return {
    t,
    median: Math.round(median(good)),
    spread: Math.round(mad(good)),
    accuracy: trials.length ? good.length / trials.length : 0,
    trials: trials.length,
    falseStarts,
  };
};

/** Your normal: the median of your last ten runs of a test, before this one. */
export const reactionBaseline = (rec: ReactionRecord | undefined, exclude?: ReactionRun): number | null => {
  if (!rec) return null;
  const runs = rec.runs.filter((r) => r !== exclude && Number.isFinite(r.median)).slice(-10);
  if (runs.length < 3) return null;
  return median(runs.map((r) => r.median));
};

/**
 * What kind of day it is, from one calibration against your own normal.
 *
 * 'slow' is ten per cent or more over your median — a margin comfortably
 * wider than the day-to-day wobble of a five-trial median, so it fires on a
 * real difference rather than on noise. It is our threshold; no paper hands
 * one over.
 */
export type DayRead = 'sharp' | 'normal' | 'slow' | 'unknown';

export const readDay = (run: ReactionRun | null, baseline: number | null): DayRead => {
  if (!run || !Number.isFinite(run.median) || baseline === null) return 'unknown';
  const r = run.median / baseline;
  if (r >= 1.1) return 'slow';
  if (r <= 0.95) return 'sharp';
  return 'normal';
};

// ==================================================================== ledger

export interface WarmupRep {
  drill: DrillId;
  score: number;
  performance: number;
}

export interface WarmupSession {
  date: string;
  t: number;
  focus: DrillId | null;
  focusError: ErrorCode | null;
  reps: WarmupRep[];
  calibration: number | null;
  day: DayRead;
  stoppedEarly: boolean;
  /**
   * Why it stopped early: the stop rule firing, or the player leaving after
   * the two sets. Different sentences, because one is the routine protecting
   * you and the other is you deciding — and telling somebody who chose to
   * leave that they were getting worse would be inventing a diagnosis.
   */
  stopReason: StopReason | null;
  intention: string | null;
}

export type StopReason = 'rule' | 'left';

export interface WarmupProgress {
  reaction: Record<ReactionTestId, ReactionRecord>;
  streak: number;
  bestStreak: number;
  lastDate: string | null;
  freezes: number;
  /** Days a freeze was spent on, so the calendar can draw them. */
  frozen: string[];
  sessions: WarmupSession[];
}

export const MAX_FREEZES = 2;
export const FREEZE_EVERY = 7;

export const emptyWarmup = (): WarmupProgress => ({
  reaction: { visual: { best: null, runs: [] }, audio: { best: null, runs: [] }, choice: { best: null, runs: [] }, aim: { best: null, runs: [] } },
  streak: 0,
  bestStreak: 0,
  lastDate: null,
  freezes: 0,
  frozen: [],
  sessions: [],
});

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Repair whatever a stored profile hands back into something playable. */
export const normalizeWarmup = (raw: unknown): WarmupProgress => {
  const out = emptyWarmup();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Partial<Record<keyof WarmupProgress, unknown>>;
  const reaction = (r.reaction && typeof r.reaction === 'object' ? r.reaction : {}) as Record<string, unknown>;
  for (const id of REACTION_TESTS) {
    const rec = reaction[id] as { best?: unknown; runs?: unknown } | undefined;
    if (!rec || typeof rec !== 'object') continue;
    const runs = Array.isArray(rec.runs)
      ? (rec.runs as Partial<ReactionRun>[])
          .filter((x) => x && typeof x === 'object')
          .map((x) => ({
            t: num(x.t, 0),
            median: num(x.median, NaN),
            spread: num(x.spread, 0),
            accuracy: Math.max(0, Math.min(1, num(x.accuracy, 1))),
            trials: num(x.trials, 0),
            falseStarts: num(x.falseStarts, 0),
          }))
          .filter((x) => Number.isFinite(x.median) && x.median > 0)
          .slice(-60)
      : [];
    const best = num(rec.best, NaN);
    out.reaction[id] = { best: Number.isFinite(best) && best > 0 ? best : runs.length ? Math.min(...runs.map((x) => x.median)) : null, runs };
  }
  out.streak = Math.max(0, Math.floor(num(r.streak, 0)));
  out.bestStreak = Math.max(out.streak, Math.floor(num(r.bestStreak, 0)));
  out.lastDate = isDate(r.lastDate) ? r.lastDate : null;
  out.freezes = Math.max(0, Math.min(MAX_FREEZES, Math.floor(num(r.freezes, 0))));
  out.frozen = Array.isArray(r.frozen) ? (r.frozen as unknown[]).filter(isDate).slice(-60) : [];
  out.sessions = Array.isArray(r.sessions)
    ? (r.sessions as Partial<WarmupSession>[])
        .filter((s) => s && typeof s === 'object' && isDate(s.date))
        .map((s) => ({
          date: s.date as string,
          t: num(s.t, 0),
          focus: isDrillId(s.focus) ? s.focus : null,
          focusError: typeof s.focusError === 'string' && s.focusError in ERRORS ? (s.focusError as ErrorCode) : null,
          reps: Array.isArray(s.reps)
            ? (s.reps as Partial<WarmupRep>[])
                .filter((x) => x && isDrillId(x.drill))
                .map((x) => ({ drill: x.drill as DrillId, score: num(x.score, 0), performance: Math.max(0, Math.min(1, num(x.performance, 0))) }))
            : [],
          calibration: Number.isFinite(num(s.calibration, NaN)) ? num(s.calibration, NaN) : null,
          day: (s.day === 'sharp' || s.day === 'normal' || s.day === 'slow' ? s.day : 'unknown') as DayRead,
          stoppedEarly: s.stoppedEarly === true,
          stopReason: (s.stopReason === 'rule' || s.stopReason === 'left' ? s.stopReason : s.stoppedEarly === true ? 'rule' : null) as StopReason | null,
          intention: typeof s.intention === 'string' ? s.intention : null,
        }))
        .slice(-90)
    : [];
  return out;
};

/** Record a finished reaction test. Returns true on a new personal best. */
export const recordReaction = (w: WarmupProgress, id: ReactionTestId, run: ReactionRun): boolean => {
  if (!Number.isFinite(run.median) || run.median <= 0) return false;
  const rec = w.reaction[id];
  rec.runs.push(run);
  if (rec.runs.length > 60) rec.runs.shift();
  // A best set by guessing on the choice test is not a best.
  const counts = id === 'visual' || id === 'audio' || run.accuracy >= 0.75;
  if (counts && (rec.best === null || run.median < rec.best)) {
    rec.best = run.median;
    return true;
  }
  return false;
};

// ==================================================================== streak

const dayNumber = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

const dateOf = (n: number): string => {
  const d = new Date(n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

export type StreakState = 'done' | 'alive' | 'frozen' | 'broken' | 'none';

/**
 * Where the streak stands today, without changing it.
 *
 *  - done: today's warm-up is finished.
 *  - alive: yesterday was, so today keeps it going.
 *  - frozen: days were missed, but banked freezes cover every one of them.
 *  - broken: more days were missed than there are freezes.
 *  - none: there has never been a streak.
 */
export const streakState = (w: WarmupProgress, today: string): { state: StreakState; missed: number } => {
  if (!w.lastDate || w.streak === 0) return { state: 'none', missed: 0 };
  const gap = dayNumber(today) - dayNumber(w.lastDate);
  if (gap <= 0) return { state: 'done', missed: 0 };
  if (gap === 1) return { state: 'alive', missed: 0 };
  const missed = gap - 1;
  return { state: missed <= w.freezes ? 'frozen' : 'broken', missed };
};

/**
 * Close the day: a warm-up was finished today.
 *
 * Missed days are paid for with freezes first; if there are not enough, the
 * streak starts again at one. A freeze is earned for every seventh day in a
 * row, to a bank of two.
 */
export const completeDay = (w: WarmupProgress, today: string): { extended: boolean; froze: number; earned: boolean } => {
  const { state, missed } = streakState(w, today);
  if (state === 'done') return { extended: false, froze: 0, earned: false };
  let froze = 0;
  if (state === 'frozen') {
    froze = missed;
    w.freezes -= missed;
    const last = dayNumber(w.lastDate as string);
    for (let i = 1; i <= missed; i++) w.frozen.push(dateOf(last + i));
    if (w.frozen.length > 60) w.frozen.splice(0, w.frozen.length - 60);
  }
  w.streak = state === 'alive' || state === 'frozen' ? w.streak + 1 : 1;
  w.bestStreak = Math.max(w.bestStreak, w.streak);
  w.lastDate = today;
  let earned = false;
  if (w.streak % FREEZE_EVERY === 0 && w.freezes < MAX_FREEZES) {
    w.freezes++;
    earned = true;
  }
  return { extended: true, froze, earned };
};

// =================================================================== routine

export type WarmupStepKind = 'calibrate' | 'block' | 'hands' | 'pressure';

export interface WarmupStep {
  kind: WarmupStepKind;
  /** Absent on the calibration step, which is a reaction test. */
  drill?: DrillId;
  level?: number;
  difficulty?: number;
  label: string;
  reason: string;
  minutes: number;
}

export interface WarmupPlan {
  date: string;
  focus: DrillId;
  focusError: ErrorCode | null;
  /** The line the screen leads with. */
  headline: string;
  steps: WarmupStep[];
  minutes: number;
}

/** What a mode is, to a player: the menu's name for it. */
export const drillName = (id: DrillId): string => DRILLS[id]?.name ?? id;

/**
 * The mistake worth fixing today: the most frequent one in the last two days.
 *
 * Two days rather than one so a single session's worth of noise cannot pick
 * the focus, and rather than a week so it is still *yesterday's* mistake.
 */
export const focusError = (p: Profile): ErrorCode | null => errorRollup(p, 2)[0]?.code ?? null;

/**
 * The rotation a profile with nothing to fix walks through.
 *
 * Range first because every other mode assumes it, then each piece of Vayne,
 * then the wheel — one a day, so a week of warm-ups touches all of them.
 */
const ROTATION: DrillId[] = ['rangecheck', 'vayneTumble', 'vayneBolts', 'tfPick', 'vayneCondemn', 'tfGold', 'rangecheck'];

/** The pressure mode that follows a focus: the same champion, with somebody against you. */
const pressureFor = (focus: DrillId): DrillId => (championOf(focus)?.id === 'twisted' && focus !== 'rangecheck' ? 'tfPressure' : 'caitlynDodge');

export const buildWarmup = (p: Profile, today: string): WarmupPlan => {
  const n = dayNumber(today);
  const err = focusError(p);
  const focus = err ? practiceFor(ERRORS[err].fix) : p.history.length === 0 ? 'rangecheck' : ROTATION[n % ROTATION.length];
  // The two-at-once benches are worth it once the one-thing ones are easy, so
  // a new player's rotation is the isolated half only.
  const benches = p.history.length < 10 ? APM_MODES.filter((m) => m.kind === 'isolated') : APM_MODES;
  const lab = benches[n % benches.length];
  const level = recommendedLevel(p.apm, lab.id);
  const pressure = pressureFor(focus);

  const headline = err
    ? `Yesterday’s mistake: ${ERRORS[err].label.toUpperCase()}. The first two sets are about that.`
    : p.history.length === 0
      ? 'Your first warm-up. It starts where every mode does: knowing your own reach.'
      : `Nothing repeating in the last two days, so today is ${drillName(focus)}.`;

  const steps: WarmupStep[] = [
    { kind: 'calibrate', label: 'CALIBRATE', reason: 'Five reactions to light. It tells the routine what kind of day this is.', minutes: 0.5 },
    {
      kind: 'block',
      drill: focus,
      label: 'FIX · SET 1',
      reason: err ? `${ERRORS[err].meaning} This mode is where that stops.` : 'One piece, on its own, with nothing else asked of you.',
      minutes: 1.4,
    },
    { kind: 'block', drill: focus, label: 'FIX · SET 2', reason: 'The same minute again. The only score that matters today is this one against the last.', minutes: 1.4 },
    {
      kind: 'hands',
      drill: lab.id,
      level,
      difficulty: levelDifficulty(level),
      label: 'HANDS',
      reason: `${drillName(lab.id)}, level ${level}: the lab rung you have not beaten. A different bench every day.`,
      minutes: 1.4,
    },
    {
      kind: 'pressure',
      drill: pressure,
      label: 'UNDER PRESSURE',
      reason: 'The same habit with somebody against you, which is the only place it has to work.',
      minutes: 1.4,
    },
  ];
  return {
    date: today,
    focus,
    focusError: err,
    headline,
    steps,
    minutes: Math.round(steps.reduce((a, s) => a + s.minutes, 0) + 1.5),
  };
};

/**
 * Whether to stop after the second set.
 *
 * Both conditions, never one: a worse second set on its own is ordinary
 * variance, and a slow reaction on its own is a cold morning. Together they
 * are a player getting worse at the thing they came to fix.
 */
export const STOP_DROP = 0.12;

export const shouldStop = (set1: number | undefined, set2: number | undefined, day: DayRead): boolean =>
  set1 !== undefined && set2 !== undefined && day === 'slow' && set2 < set1 - STOP_DROP;

/**
 * The sentence to take into the next game.
 *
 * One, and phrased as a thing to *do* in a ranked lane rather than a thing to
 * feel. Written per mistake, because "focus on spacing" is not an
 * instruction and "stand where your ring ends" is.
 */
export const INTENTIONS: Record<ErrorCode, string> = {
  EARLY_MOVE: 'Let every auto leave before you move. Watch the missile, then click.',
  HELD_FIRE: 'When the attack is up and they are in range, let go of the keys and shoot.',
  OVERSTEP: 'Trade from the edge of your range, then step back out. Never stand inside theirs to wait.',
  RANGE_LOSS: 'Tap Space before a trade to check where your ring ends, then stand on it.',
  ROOTED: 'Between autos, move. Every backswing you stand still in is free damage for them.',
  LATE_DODGE: 'Step off the line when the cast starts, not when the missile is in the air.',
  HAZARD_STAND: 'The moment something is drawn on the floor under you, leave it.',
  TARGET_DROP: 'When the fight changes who is killable, switch in one click and commit.',
  CURSOR_OVERTRAVEL: 'Slow the hand down by a hair. One accurate click beats two fast ones.',
  PANIC_CLICK: 'One command, once. If it did not work, the second click will not either.',
  MISSED_SHOT: 'Aim where they are going, not where they are. Lead the walk.',
  CS_MISS: 'Start the auto when the bar reaches your damage line — before it gets there, not after.',
  INCONSISTENT: 'Take the same breath before every trade. Steady beats fast.',
  CHIP_DAMAGE: 'Every time you take a poke, give one back or walk out of range. No free hits.',
};

export const intentionFor = (err: ErrorCode | null, focus: DrillId): string =>
  err
    ? INTENTIONS[err]
    : focus === 'rangecheck'
      ? INTENTIONS.RANGE_LOSS
      : championOf(focus)?.id === 'twisted'
        ? 'Lock the card the first time it comes round. Waiting for the second pass is a second and a half standing still.'
        : INTENTIONS.OVERSTEP;

/** Close a routine into a session record and extend the streak. */
export const finishWarmup = (
  p: Profile,
  plan: WarmupPlan,
  reps: WarmupRep[],
  calibration: ReactionRun | null,
  day: DayRead,
  stopped: StopReason | null,
): { session: WarmupSession; streak: ReturnType<typeof completeDay> } => {
  const session: WarmupSession = {
    date: plan.date,
    t: Date.now(),
    focus: plan.focus,
    focusError: plan.focusError,
    reps,
    calibration: calibration?.median ?? null,
    day,
    stoppedEarly: stopped !== null,
    stopReason: stopped,
    intention: intentionFor(plan.focusError, plan.focus),
  };
  p.warmup.sessions.push(session);
  if (p.warmup.sessions.length > 90) p.warmup.sessions.shift();
  return { session, streak: completeDay(p.warmup, plan.date) };
};

/** The last finished warm-up that trained the same focus, for "vs last time". */
export const lastWarmupOn = (w: WarmupProgress, focus: DrillId, before: number): WarmupSession | null => {
  for (let i = w.sessions.length - 1; i >= 0; i--) {
    const s = w.sessions[i];
    if (s.t < before && s.focus === focus && s.reps.length >= 2) return s;
  }
  return null;
};
