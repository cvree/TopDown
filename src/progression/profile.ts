import { DEFAULT_HERO, type HeroId } from '../engine/heroes';
import { VERSION } from '../patchnotes/notes';
import { clamp, mean } from '../engine/math';
import type { DerivedMetrics, RunMetrics } from '../engine/metrics';
import { DRILLS, type DrillId } from '../drills/catalog';
import { gradeTest, TESTS, type TestId } from '../tests/catalog';
import { detectErrors, primaryLimiter, type DetectedError, type ErrorCode } from './errors';
import { planFrom, planSession, type SessionPlan } from './plan';
import {
  applyApmRun,
  emptyApmProgress,
  isApmDrill,
  levelDifficulty,
  normalizeApmProgress,
  recommendedLevel,
  type ApmProgress,
  type ApmRunReport,
} from './apm';
import { isDemotion, isPromotion, rankFromRating, type RankInfo } from './ranks';
import { distribute, overallRating, updateRating } from './rating';
import { AXIS_LABEL, SKILL_AXES, type SkillAxis } from './skills';
import {
  applyVayneRun,
  emptyVayneProgress,
  isVayneStage,
  type VayneProgress,
  type VayneRunReport,
} from './vayne';

const STORAGE_KEY = 'apex.profile.v1';
const PROFILE_VERSION = 1;

export type MetricDirection = 'higher' | 'lower';

export interface KeyMetric {
  id: string;
  label: string;
  value: number;
  format: 'pct' | 'ms' | 'units' | 'int' | 'sec';
  direction: MetricDirection;
}

export interface RunResult {
  drill: DrillId;
  seed: number;
  difficulty: number;
  score: number;
  /** 0..1 overall quality of the run — the only thing rating listens to. */
  performance: number;
  axisPerformance: Partial<Record<SkillAxis, number>>;
  metrics: RunMetrics;
  derived: DerivedMetrics;
  /** Ordered; the first is the headline. */
  keyMetrics: KeyMetric[];
  endReason: 'time' | 'death' | 'complete' | 'abort';
  /** What went well and what cost the run, in plain language. */
  helped: string[];
  hurt: string[];
  advice: string;
}

export interface BestRecord {
  score: number;
  metrics: Record<string, number>;
  at: number;
}

export interface HistoryEntry {
  drill: DrillId;
  t: number;
  score: number;
  performance: number;
  difficulty: number;
  overall: number;
  key: number;
  keyId: string;
  /** Per-axis performance, so transfer can be compared axis by axis later. */
  axes?: Partial<Record<SkillAxis, number>>;
  /** Which mistakes this run contained. Written for every run from v1.3. */
  errors?: ErrorCode[];
}

/**
 * One mistake, once, with the run it happened in.
 *
 * Kept as a flat log rather than a running total because the interesting
 * question is not "how often do you do this" but "are you still doing it" —
 * and that can only be answered against a clock.
 */
export interface ErrorLogEntry {
  code: ErrorCode;
  t: number;
  drill: DrillId;
  /** Occurrences in that run. */
  count: number;
  /** Share of the opportunities to make it, 0..1. This is what trends. */
  rate: number;
}

/** A finished training session — the unit the Today page plans in. */
export interface SessionRecord {
  t: number;
  /** Local date key, so a calendar can group without re-deriving it. */
  date: string;
  /** What the session was for, in the planner's words. */
  focus: string;
  drills: DrillId[];
  seconds: number;
  /** Overall rating either side of the session. */
  from: number;
  to: number;
  /** Personal bests set during it. */
  bests: number;
  /** Total quality reps — scored actions across the session's runs. */
  reps: number;
}

/**
 * A skill test's record. Tests sit beside the ladder rather than inside it:
 * they do not move your drill rating, because a 20-second reaction instrument
 * should not be able to promote you. They keep their own bests, their own
 * grade, and their own trend.
 */
export interface TestRecord {
  /** The primary value of the best attempt, in the test's own unit. */
  best: number;
  /** That value graded onto the 0..3600 ladder. */
  bestRating: number;
  /** The most recent attempt's value, best or not. */
  last: number;
  attempts: number;
  /** When the best was set. */
  at: number;
  /** Every attempt, newest last, capped. Drawn as the test's trend line. */
  history: { t: number; value: number; rating: number }[];
}

export interface DailyState {
  /** ISO date (local) of the day currently in progress. */
  date: string;
  completed: DrillId[];
  streak: number;
  lastCompletedDate: string | null;
  startOverall: number;
  /**
   * Today's session, drawn up once and then left alone.
   *
   * It has to be stored rather than recomputed: the planner reads the profile,
   * the profile changes with every run, and a plan that rewrites itself
   * between two drills is not a plan.
   */
  plan: DrillId[];
  /** What the session is for, in the planner's words. */
  focus: string;
  /** Seconds trained today, across every run. */
  seconds: number;
  /** Quality reps today — successful actions, not inputs. */
  reps: number;
  /** Personal bests set today. */
  bests: number;
  /** When the first run of the day started. */
  startedAt: number | null;
}

export interface AppSettings {
  /**
   * The champion you wear in every drill that does not name its own. Look
   * only — see `src/engine/heroes.ts` for why nothing in the simulation is
   * allowed to read it.
   */
  hero: HeroId;
  quickCast: boolean;
  /** Click-to-move (League) or WASD. */
  movementScheme: 'click' | 'wasd';
  /**
   * Where a dash points under WASD: the keys you are holding, or the cursor.
   * Ignored entirely under the click scheme, where there are no keys to hold.
   */
  tumbleAim: 'hands' | 'cursor';
  showRange: boolean;
  lowFx: boolean;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  bindings: Record<string, { primary: string; secondary?: string }>;
  /** Rebinds that apply only under the WASD scheme; the two never collide. */
  wasdBindings: Record<string, { primary: string; secondary?: string }>;
  reduceShake: boolean;
  /** Pushing the cursor to the screen edge slides the camera, League-style. */
  edgePan: boolean;
  /** Champion name plates above units. Health bars are never hidden. */
  showNames: boolean;
  /** The browser-gesture warning has been read and dismissed. */
  gestureNoticeDismissed: boolean;
}

export interface Profile {
  version: number;
  name: string;
  createdAt: number;
  placed: boolean;
  placementRuns: number;
  /** The first-run flow — champion select — has been completed. */
  onboarded: boolean;
  /**
   * The newest release whose patch notes this player has read. Null means they
   * have never opened them, which for a brand-new profile is not the same as
   * being behind: everything is new to a new player, so nothing is marked.
   */
  seenVersion: string | null;
  ratings: Record<SkillAxis, number>;
  samples: Record<SkillAxis, number>;
  overall: number;
  peakOverall: number;
  /** Adaptive difficulty per axis, 0..1. */
  difficulty: Record<SkillAxis, number>;
  bests: Partial<Record<DrillId, BestRecord>>;
  history: HistoryEntry[];
  daily: DailyState;
  settings: AppSettings;
  totalRuns: number;
  totalSeconds: number;
  /** The champion track. Separate from the general ladder on purpose. */
  vayne: VayneProgress;
  /** The APM trainer's own ladder: thirteen modes, ten explicit levels each. */
  apm: ApmProgress;
  /**
   * Where the profile stood at the end of each local day.
   *
   * The per-axis snapshot is what makes a 30-day skill change statable at
   * all — a rating is a running value, so without a mark from thirty days ago
   * there is nothing to subtract. Written from v1.3; older marks carry only
   * the overall, and the UI says so rather than guessing the rest.
   */
  dailyMarks: { date: string; overall: number; ratings?: Record<SkillAxis, number> }[];
  /** Skill test records, keyed by test. Independent of the drill ladder. */
  tests: Partial<Record<TestId, TestRecord>>;
  /** Every mistake the trainer has measured, newest last. Capped. */
  errorLog: ErrorLogEntry[];
  /** Completed training sessions, newest last. Capped. */
  sessions: SessionRecord[];
}

const zeroAxis = <T>(v: T): Record<SkillAxis, T> =>
  SKILL_AXES.reduce((acc, a) => {
    acc[a] = v;
    return acc;
  }, {} as Record<SkillAxis, T>);

export const todayKey = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const yesterdayKey = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return todayKey(d);
};

export const DEFAULT_SETTINGS: AppSettings = {
  hero: DEFAULT_HERO,
  quickCast: true,
  movementScheme: 'click',
  tumbleAim: 'hands',
  showRange: true,
  lowFx: false,
  masterVolume: 0.75,
  sfxVolume: 0.9,
  musicVolume: 0.3,
  muted: false,
  bindings: {},
  wasdBindings: {},
  reduceShake: false,
  // Off by default: it moves the camera without being asked, and a player who
  // has never met it should not discover it mid-run.
  edgePan: false,
  showNames: true,
  gestureNoticeDismissed: false,
};

export const newProfile = (name = 'PLAYER'): Profile => ({
  version: PROFILE_VERSION,
  name,
  createdAt: Date.now(),
  placed: false,
  placementRuns: 0,
  onboarded: false,
  // A new profile has read nothing and is behind on nothing: it starts on the
  // current version so its first session is not decorated with "NEW" marks.
  seenVersion: VERSION,
  ratings: zeroAxis(0),
  samples: zeroAxis(0),
  overall: 0,
  peakOverall: 0,
  difficulty: zeroAxis(0.32),
  bests: {},
  history: [],
  daily: {
    date: todayKey(),
    completed: [],
    streak: 0,
    lastCompletedDate: null,
    startOverall: 0,
    plan: [],
    focus: '',
    seconds: 0,
    reps: 0,
    bests: 0,
    startedAt: null,
  },
  settings: { ...DEFAULT_SETTINGS },
  totalRuns: 0,
  totalSeconds: 0,
  vayne: emptyVayneProgress(),
  apm: emptyApmProgress(),
  dailyMarks: [],
  tests: {},
  errorLog: [],
  sessions: [],
});

export const loadProfile = (): Profile => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return newProfile();
    const parsed = JSON.parse(raw) as Profile;
    if (parsed.version !== PROFILE_VERSION) return newProfile();
    // Merge forward so a partially-written profile can't crash the app.
    const p = newProfile(parsed.name ?? 'PLAYER');
    return {
      ...p,
      ...parsed,
      ratings: { ...p.ratings, ...parsed.ratings },
      samples: { ...p.samples, ...parsed.samples },
      difficulty: { ...p.difficulty, ...parsed.difficulty },
      settings: { ...p.settings, ...parsed.settings },
      // A profile written before champion select existed is not dragged back
      // through onboarding if it has already been placed — it simply keeps the
      // default body until its owner goes and changes it.
      onboarded: parsed.onboarded ?? Boolean(parsed.placed),
      // A profile written before patch notes existed has genuinely not read
      // them, so it keeps null and gets the mark. Which releases it missed is
      // unknowable, so the notes screen highlights the current one rather than
      // inventing a history for it.
      seenVersion: parsed.seenVersion ?? null,
      daily: { ...p.daily, ...parsed.daily },
      // A profile written before the champion track existed simply starts it.
      vayne: parsed.vayne
        ? { ...p.vayne, ...parsed.vayne, stages: { ...p.vayne.stages, ...parsed.vayne.stages } }
        : p.vayne,
      // The APM ladder is repaired rather than merged: a profile written
      // before it existed, or before a mode did, has to come back playable.
      apm: normalizeApmProgress(parsed.apm),
      bests: parsed.bests ?? {},
      history: Array.isArray(parsed.history) ? parsed.history.slice(-400) : [],
      dailyMarks: Array.isArray(parsed.dailyMarks) ? parsed.dailyMarks.slice(-120) : [],
      // A profile written before the tests existed simply has none yet.
      tests: parsed.tests ?? {},
      // Both written from v1.3. An older profile starts them empty rather
      // than having a history invented for it.
      errorLog: Array.isArray(parsed.errorLog) ? parsed.errorLog.slice(-800) : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions.slice(-120) : [],
    };
  } catch {
    return newProfile();
  }
};

export const saveProfile = (p: Profile): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Storage full or blocked — the session still plays, it just won't persist.
  }
};

export const resetProfile = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

// -------------------------------------------------------------- progression

export interface AxisChange {
  axis: SkillAxis;
  before: number;
  after: number;
  delta: number;
  rankBefore: RankInfo;
  rankAfter: RankInfo;
  promoted: boolean;
}

export interface PersonalBest {
  id: string;
  label: string;
  value: number;
  previous: number | null;
  format: KeyMetric['format'];
}

export interface Improvement {
  label: string;
  previous: number;
  current: number;
  format: KeyMetric['format'];
  direction: MetricDirection;
}

export interface ProgressReport {
  drill: DrillId;
  axisChanges: AxisChange[];
  overallBefore: number;
  overallAfter: number;
  rankBefore: RankInfo;
  rankAfter: RankInfo;
  promoted: boolean;
  demoted: boolean;
  personalBests: PersonalBest[];
  newBestScore: boolean;
  previousBestScore: number | null;
  improvements: Improvement[];
  difficultyBefore: number;
  difficultyAfter: number;
  advice: string;
  /** Present only for runs on the Vayne path. */
  vayne: VayneRunReport | null;
  /** Present only for runs in the APM trainer. */
  apm: ApmRunReport | null;
  /** The mistakes this run contained, worst first. */
  errors: DetectedError[];
  /** The one that cost the most, if any cost enough to name. */
  limiter: DetectedError | null;
  /** How often that limiter used to happen, over the previous fortnight. */
  limiterWas: number | null;
}

/** Where the adaptive system tries to keep you: challenged, not drowning. */
const TARGET_BAND: [number, number] = [0.6, 0.78];

export const drillDifficulty = (p: Profile, drill: DrillId): number => {
  // The APM trainer does not infer a difficulty: a level is chosen, and the
  // level is the difficulty. Asked without one, it answers with the rung the
  // section would put you on.
  if (isApmDrill(drill)) return levelDifficulty(recommendedLevel(p.apm, drill));
  const axes = Object.entries(DRILLS[drill].axes) as [SkillAxis, number][];
  let sum = 0;
  let w = 0;
  for (const [axis, weight] of axes) {
    sum += p.difficulty[axis] * weight;
    w += weight;
  }
  return clamp(w > 0 ? sum / w : 0.35, 0.05, 1);
};

/** Difficulty moves per axis, independently, based on how the run went. */
const adaptDifficulty = (p: Profile, drill: DrillId, performance: number): void => {
  // Nothing adapts under an APM mode. Its ladder is explicit, and a system
  // quietly moving the rung under a player who chose it would make every
  // per-level record incomparable with the last one.
  if (isApmDrill(drill)) return;
  const axes = Object.entries(DRILLS[drill].axes) as [SkillAxis, number][];
  for (const [axis, weight] of axes) {
    if (!weight) continue;
    let step = 0;
    if (performance > TARGET_BAND[1]) step = 0.055 * weight * (1 + (performance - TARGET_BAND[1]) * 2);
    else if (performance < TARGET_BAND[0]) step = -0.05 * weight * (1 + (TARGET_BAND[0] - performance) * 1.6);
    p.difficulty[axis] = clamp(p.difficulty[axis] + step, 0.05, 1);
  }
};

const fmtCompare = (a: number, b: number, dir: MetricDirection): boolean =>
  dir === 'higher' ? a > b : a < b;

export interface RunContext {
  placement?: boolean;
  /** The APM ladder rung this run was played at. */
  level?: number;
  /** A double-length APM run, which may set rate records but never a score. */
  endurance?: boolean;
}

export const applyRun = (p: Profile, result: RunResult, opts: RunContext = {}): ProgressReport => {
  const overallBefore = p.overall;
  const rankBefore = rankFromRating(overallBefore);
  const difficultyBefore = drillDifficulty(p, result.drill);

  const parts = distribute(DRILLS[result.drill].axes, result.axisPerformance, result.performance);
  const axisChanges: AxisChange[] = [];

  for (const part of parts) {
    const before = p.ratings[part.axis];
    const samples = p.samples[part.axis];
    // Placement writes the expected rating straight in; there is no history to
    // blend with and the whole point is a fast, decisive read.
    const upd = updateRating(before, opts.placement ? 0 : samples, part.performance, result.difficulty);
    const after = opts.placement && samples === 0 ? upd.expected : upd.after;
    p.ratings[part.axis] = after;
    p.samples[part.axis] = samples + part.weight;
    axisChanges.push({
      axis: part.axis,
      before,
      after,
      delta: after - before,
      rankBefore: rankFromRating(before),
      rankAfter: rankFromRating(after),
      promoted: isPromotion(before, after),
    });
  }

  p.overall = overallRating(p.ratings, p.samples);
  p.peakOverall = Math.max(p.peakOverall, p.overall);
  const rankAfter = rankFromRating(p.overall);

  // Personal bests.
  const prevBest = p.bests[result.drill] ?? null;
  const personalBests: PersonalBest[] = [];
  const bestMetrics: Record<string, number> = { ...(prevBest?.metrics ?? {}) };
  for (const km of result.keyMetrics) {
    const prev = prevBest?.metrics[km.id];
    const improved = prev !== undefined && fmtCompare(km.value, prev, km.direction);
    if (prev === undefined || improved) bestMetrics[km.id] = km.value;
    // The first run of a drill records a baseline; celebrating it as a
    // "personal best" would make the badge meaningless.
    if (improved) {
      personalBests.push({ id: km.id, label: km.label, value: km.value, previous: prev ?? null, format: km.format });
    }
  }
  // A double-length run accumulates a longer score by construction, so it is
  // allowed to set rate records and never a score record.
  const newBestScore = !opts.endurance && prevBest !== null && result.score > prevBest.score;
  const previousBestScore = prevBest?.score ?? null;
  p.bests[result.drill] = {
    score: opts.endurance ? (prevBest?.score ?? 0) : Math.max(result.score, prevBest?.score ?? 0),
    metrics: bestMetrics,
    at: Date.now(),
  };

  // Improvement versus the previous run of the same drill.
  const lastRun = [...p.history].reverse().find((h) => h.drill === result.drill);
  const improvements: Improvement[] = [];
  const head = result.keyMetrics[0];
  if (lastRun && head && lastRun.keyId === head.id) {
    improvements.push({
      label: head.label,
      previous: lastRun.key,
      current: head.value,
      format: head.format,
      direction: head.direction,
    });
  }

  // What went wrong, named. Read straight off this run's telemetry, so a
  // mistake can only be reported if it was actually measured.
  const errors = detectErrors(result.drill, result.metrics, result.derived);
  const limiter = primaryLimiter(errors);
  const now = Date.now();

  // How often that same mistake used to happen, over the fortnight before
  // this run. It is what lets the results screen say "down from 23%".
  let limiterWas: number | null = null;
  if (limiter) {
    const since = now - 14 * 86400000;
    const prior = p.errorLog.filter((e) => e.code === limiter.code && e.t >= since);
    if (prior.length >= 3) limiterWas = mean(prior.map((e) => e.rate));
  }

  for (const e of errors) {
    p.errorLog.push({ code: e.code, t: now, drill: result.drill, count: e.count, rate: e.rate });
  }
  if (p.errorLog.length > 800) p.errorLog.splice(0, p.errorLog.length - 800);

  p.history.push({
    drill: result.drill,
    t: now,
    score: result.score,
    performance: result.performance,
    difficulty: result.difficulty,
    overall: p.overall,
    key: head?.value ?? 0,
    keyId: head?.id ?? '',
    axes: { ...result.axisPerformance },
    errors: errors.map((e) => e.code),
  });
  if (p.history.length > 400) p.history.splice(0, p.history.length - 400);

  // The champion path keeps the last run's headline numbers so it can name the
  // habit that is costing you, rather than only the score that resulted.
  const vayne = isVayneStage(result.drill)
    ? applyVayneRun(
        p.vayne,
        result.drill,
        result.performance,
        result.difficulty,
        result.score,
        Object.fromEntries(result.keyMetrics.map((k) => [k.id, k.value])),
        p.settings.movementScheme === 'wasd',
      )
    : null;

  // The rate the ladder records is the *correct* one — the number the mode's
  // score is built on — rather than the raw headline rate, so a level record
  // can never be set by mashing.
  const apm = isApmDrill(result.drill)
    ? applyApmRun(p.apm, {
        drill: result.drill,
        level: opts.level ?? recommendedLevel(p.apm, result.drill),
        performance: result.performance,
        score: result.score,
        apm: result.keyMetrics.find((m) => m.id === 'correctApm')?.value ?? 0,
        endurance: opts.endurance ?? false,
      })
    : null;

  adaptDifficulty(p, result.drill, result.performance);
  p.totalRuns++;
  p.totalSeconds += result.metrics.duration;

  // Today's running totals. Quality reps are successful actions — attacks
  // that landed, shots that hit, telegraphs dodged — never raw inputs, so the
  // number cannot be inflated by clicking faster.
  rollDaily(p);
  if (p.daily.startedAt === null) p.daily.startedAt = now;
  p.daily.seconds += result.metrics.duration;
  p.daily.reps +=
    result.metrics.attacksCompleted +
    result.metrics.shotsHit +
    result.metrics.projectilesDodged +
    result.metrics.csSuccess +
    result.metrics.targetsHit;
  p.daily.bests += personalBests.length + (newBestScore ? 1 : 0);

  const today = todayKey();
  if (!p.dailyMarks.length || p.dailyMarks[p.dailyMarks.length - 1].date !== today) {
    p.dailyMarks.push({ date: today, overall: p.overall, ratings: { ...p.ratings } });
    if (p.dailyMarks.length > 120) p.dailyMarks.shift();
  } else {
    const mark = p.dailyMarks[p.dailyMarks.length - 1];
    mark.overall = p.overall;
    mark.ratings = { ...p.ratings };
  }

  return {
    drill: result.drill,
    axisChanges,
    overallBefore,
    overallAfter: p.overall,
    rankBefore,
    rankAfter,
    promoted: isPromotion(overallBefore, p.overall) && p.placed,
    demoted: isDemotion(overallBefore, p.overall) && p.placed,
    personalBests,
    newBestScore,
    previousBestScore,
    improvements,
    difficultyBefore,
    difficultyAfter: drillDifficulty(p, result.drill),
    advice: result.advice,
    vayne,
    apm,
    errors,
    limiter,
    limiterWas,
  };
};

// ------------------------------------------------------------------- daily

export const rollDaily = (p: Profile): void => {
  const today = todayKey();
  if (p.daily.date === today) return;
  const wasComplete = p.daily.plan.length > 0 && p.daily.completed.length >= p.daily.plan.length;
  if (wasComplete) p.daily.lastCompletedDate = p.daily.date;
  // A streak survives one calendar day of gap and no more.
  if (p.daily.lastCompletedDate && p.daily.lastCompletedDate !== yesterdayKey() && p.daily.lastCompletedDate !== today) {
    p.daily.streak = 0;
  }
  p.daily = {
    date: today,
    completed: [],
    streak: p.daily.streak,
    lastCompletedDate: p.daily.lastCompletedDate,
    startOverall: p.overall,
    // A new day gets a new plan, drawn the first time it is asked for.
    plan: [],
    focus: '',
    seconds: 0,
    reps: 0,
    bests: 0,
    startedAt: null,
  };
};

/**
 * Draws today's session if it has not been drawn yet. Mutates `p`.
 *
 * Called from the Today screen rather than from `rollDaily`, because planning
 * reads the whole profile and the profile is not loaded yet when the day rolls
 * over at start-up.
 */
export const ensureDailyPlan = (p: Profile): void => {
  rollDaily(p);
  if (p.daily.plan.length > 0) return;
  const plan = planSession(p);
  p.daily.plan = plan.blocks.map((b) => b.drill);
  p.daily.focus = plan.focus;
};

/** The plan as the UI needs it: drills, wording and running time. */
export const dailyPlan = (p: Profile): SessionPlan =>
  planFrom(p, p.daily.plan, p.daily.focus) ?? planSession(p);

export const dailyComplete = (p: Profile): boolean =>
  p.daily.plan.length > 0 && p.daily.plan.every((d) => p.daily.completed.includes(d));

/**
 * Files today's session in the practice history. Mutates `p`.
 *
 * Idempotent for a given day: finishing the session twice — by replaying a
 * block, say — does not file it twice.
 */
export const recordSession = (p: Profile): SessionRecord | null => {
  if (!dailyComplete(p)) return null;
  if (p.sessions.some((s) => s.date === p.daily.date)) return null;
  const rec: SessionRecord = {
    t: Date.now(),
    date: p.daily.date,
    focus: p.daily.focus,
    drills: [...p.daily.plan],
    seconds: p.daily.seconds,
    from: p.daily.startOverall,
    to: p.overall,
    bests: p.daily.bests,
    reps: p.daily.reps,
  };
  p.sessions = [...p.sessions, rec].slice(-120);
  return rec;
};

export const markDailyComplete = (p: Profile, drill: DrillId): boolean => {
  rollDaily(p);
  // Only the session's own drills tick the session off. A quick run from the
  // drill rail is training, but it is not the plan.
  if (p.daily.plan.includes(drill) && !p.daily.completed.includes(drill)) p.daily.completed.push(drill);
  const done = dailyComplete(p);
  if (done && p.daily.lastCompletedDate !== p.daily.date) {
    p.daily.lastCompletedDate = p.daily.date;
    p.daily.streak += 1;
  }
  return done;
};

// ------------------------------------------------------------------ queries

export const bestAxis = (p: Profile): SkillAxis | null => {
  const rated = SKILL_AXES.filter((a) => p.samples[a] > 0);
  if (!rated.length) return null;
  return rated.reduce((a, b) => (p.ratings[a] >= p.ratings[b] ? a : b));
};

export const weakestAxis = (p: Profile): SkillAxis | null => {
  const rated = SKILL_AXES.filter((a) => p.samples[a] > 0);
  if (!rated.length) return null;
  return rated.reduce((a, b) => (p.ratings[a] <= p.ratings[b] ? a : b));
};

export const trainingPriority = (p: Profile): { axis: SkillAxis; label: string; reason: string } | null => {
  // An axis with no data is always the highest-value thing to run next: it is
  // the one place the profile is guessing rather than measuring.
  const untouched = SKILL_AXES.filter((a) => p.samples[a] === 0);
  if (untouched.length) {
    const a = untouched[0];
    return { axis: a, label: AXIS_LABEL[a], reason: 'No data yet — one run puts it on the map.' };
  }
  const weak = weakestAxis(p);
  if (!weak) return null;
  const gap = p.overall - p.ratings[weak];
  return {
    axis: weak,
    label: AXIS_LABEL[weak],
    reason: gap > 120 ? `${Math.round(gap)} rating behind your overall — it is what is holding you back.` : 'Your lowest axis, but the profile is even.',
  };
};

/** Percent change in overall rating across the last `days` days. */
export const recentImprovement = (p: Profile, days = 7): number => {
  if (p.dailyMarks.length < 2) {
    const recent = p.history.slice(-12);
    if (recent.length < 4) return 0;
    const older = mean(recent.slice(0, Math.floor(recent.length / 2)).map((h) => h.overall));
    const newer = mean(recent.slice(Math.floor(recent.length / 2)).map((h) => h.overall));
    return older > 0 ? ((newer - older) / older) * 100 : 0;
  }
  const cutoff = Date.now() - days * 86400000;
  const marks = p.dailyMarks.filter((m) => new Date(m.date).getTime() >= cutoff);
  const base = marks.length > 1 ? marks[0].overall : p.dailyMarks[Math.max(0, p.dailyMarks.length - days)].overall;
  return base > 0 ? ((p.overall - base) / base) * 100 : 0;
};

export const formatMetric = (v: number, f: KeyMetric['format']): string => {
  switch (f) {
    case 'pct':
      return `${Math.round(v * 100)}%`;
    case 'ms':
      return `${Math.round(v)}ms`;
    case 'units':
      return `${Math.round(v)}u`;
    case 'sec':
      return `${v.toFixed(1)}s`;
    default:
      return `${Math.round(v)}`;
  }
};

/* ------------------------------------------------------------ skill tests */

export interface TestReport {
  id: TestId;
  value: number;
  rating: number;
  /** The best before this attempt, or null if this was the first. */
  previousBest: number | null;
  previousRating: number;
  newBest: boolean;
  rankBefore: RankInfo;
  rankAfter: RankInfo;
  promoted: boolean;
  benchmarkBefore: number;
  benchmarkAfter: number;
  attempts: number;
}

/**
 * The mean of your best grade on every test you have attempted.
 *
 * Deliberately not an average over all twelve: a test you have never run
 * should read as absent, not as zero. Twelve tests you have all done badly is
 * a real number; two tests you have done well is a different, smaller claim,
 * and the UI says how many are in it.
 */
export const benchmarkRating = (p: Profile): number => {
  const rs = Object.values(p.tests ?? {}).map((r) => r.bestRating);
  return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
};

export const testsAttempted = (p: Profile): number => Object.keys(p.tests ?? {}).length;

/** Records an attempt and reports what it changed. Mutates `p`. */
export const applyTestRun = (p: Profile, id: TestId, value: number): TestReport => {
  const meta = TESTS[id];
  const rating = gradeTest(id, value);
  const prev = p.tests[id] ?? null;
  const benchmarkBefore = benchmarkRating(p);

  const better = !prev || (meta.primaryDirection === 'lower' ? value < prev.best : value > prev.best);
  const record: TestRecord = {
    best: better ? value : (prev as TestRecord).best,
    bestRating: better ? rating : (prev as TestRecord).bestRating,
    last: value,
    attempts: (prev?.attempts ?? 0) + 1,
    at: better ? Date.now() : (prev as TestRecord).at,
    history: [...(prev?.history ?? []), { t: Date.now(), value, rating }].slice(-40),
  };
  p.tests = { ...p.tests, [id]: record };

  const previousRating = prev?.bestRating ?? 0;
  return {
    id,
    value,
    rating,
    previousBest: prev?.best ?? null,
    previousRating,
    newBest: better && prev !== null,
    rankBefore: rankFromRating(previousRating),
    rankAfter: rankFromRating(record.bestRating),
    promoted: prev !== null && isPromotion(previousRating, record.bestRating),
    benchmarkBefore,
    benchmarkAfter: benchmarkRating(p),
    attempts: record.attempts,
  };
};
