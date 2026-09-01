import { clamp, mean } from '../engine/math';
import type { DerivedMetrics, RunMetrics } from '../engine/metrics';
import { DRILLS, type DrillId } from '../drills/catalog';
import { isDemotion, isPromotion, rankFromRating, type RankInfo } from './ranks';
import { distribute, overallRating, updateRating } from './rating';
import { AXIS_LABEL, SKILL_AXES, type SkillAxis } from './skills';

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
}

export interface DailyState {
  /** ISO date (local) of the day currently in progress. */
  date: string;
  completed: DrillId[];
  streak: number;
  lastCompletedDate: string | null;
  startOverall: number;
}

export interface AppSettings {
  quickCast: boolean;
  showRange: boolean;
  lowFx: boolean;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  bindings: Record<string, { primary: string; secondary?: string }>;
  reduceShake: boolean;
}

export interface Profile {
  version: number;
  name: string;
  createdAt: number;
  placed: boolean;
  placementRuns: number;
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
  /** Overall rating recorded at the start of each local day, for trends. */
  dailyMarks: { date: string; overall: number }[];
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
  quickCast: true,
  showRange: true,
  lowFx: false,
  masterVolume: 0.75,
  sfxVolume: 0.9,
  musicVolume: 0.3,
  muted: false,
  bindings: {},
  reduceShake: false,
};

export const newProfile = (name = 'PLAYER'): Profile => ({
  version: PROFILE_VERSION,
  name,
  createdAt: Date.now(),
  placed: false,
  placementRuns: 0,
  ratings: zeroAxis(0),
  samples: zeroAxis(0),
  overall: 0,
  peakOverall: 0,
  difficulty: zeroAxis(0.32),
  bests: {},
  history: [],
  daily: { date: todayKey(), completed: [], streak: 0, lastCompletedDate: null, startOverall: 0 },
  settings: { ...DEFAULT_SETTINGS },
  totalRuns: 0,
  totalSeconds: 0,
  dailyMarks: [],
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
      daily: { ...p.daily, ...parsed.daily },
      bests: parsed.bests ?? {},
      history: Array.isArray(parsed.history) ? parsed.history.slice(-400) : [],
      dailyMarks: Array.isArray(parsed.dailyMarks) ? parsed.dailyMarks.slice(-120) : [],
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
}

/** Where the adaptive system tries to keep you: challenged, not drowning. */
const TARGET_BAND: [number, number] = [0.6, 0.78];

export const drillDifficulty = (p: Profile, drill: DrillId): number => {
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

export const applyRun = (p: Profile, result: RunResult, opts: { placement?: boolean } = {}): ProgressReport => {
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
  const newBestScore = prevBest !== null && result.score > prevBest.score;
  const previousBestScore = prevBest?.score ?? null;
  p.bests[result.drill] = {
    score: Math.max(result.score, prevBest?.score ?? 0),
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

  p.history.push({
    drill: result.drill,
    t: Date.now(),
    score: result.score,
    performance: result.performance,
    difficulty: result.difficulty,
    overall: p.overall,
    key: head?.value ?? 0,
    keyId: head?.id ?? '',
  });
  if (p.history.length > 400) p.history.splice(0, p.history.length - 400);

  adaptDifficulty(p, result.drill, result.performance);
  p.totalRuns++;
  p.totalSeconds += result.metrics.duration;

  const today = todayKey();
  if (!p.dailyMarks.length || p.dailyMarks[p.dailyMarks.length - 1].date !== today) {
    p.dailyMarks.push({ date: today, overall: p.overall });
    if (p.dailyMarks.length > 120) p.dailyMarks.shift();
  } else {
    p.dailyMarks[p.dailyMarks.length - 1].overall = p.overall;
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
  };
};

// ------------------------------------------------------------------- daily

export const rollDaily = (p: Profile): void => {
  const today = todayKey();
  if (p.daily.date === today) return;
  const wasComplete = p.daily.completed.length >= 5;
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
  };
};

export const markDailyComplete = (p: Profile, drill: DrillId): boolean => {
  rollDaily(p);
  if (!p.daily.completed.includes(drill)) p.daily.completed.push(drill);
  const done = p.daily.completed.length >= 5;
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
