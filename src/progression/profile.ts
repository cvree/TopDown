import { DEFAULT_HERO, isHeroId, type HeroId } from '../engine/heroes';
import { VERSION } from '../patchnotes/notes';
import { sanitizeOverrides } from '../engine/input';
import { clamp, mean } from '../engine/math';
import type { DerivedMetrics, RunMetrics, TimelineMark } from '../engine/metrics';
import { DRILLS, isDrillId, type DrillId } from '../drills/catalog';
import type { RunMode } from '../drills/modes';
import { detectErrors, isErrorCode, primaryLimiter, type DetectedError, type ErrorCode } from './errors';
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
  normalizeVayneProgress,
  type VayneProgress,
  type VayneRunReport,
} from './vayne';
import {
  applyWasdRun,
  emptyWasdProgress,
  isWasdModuleId,
  normalizeWasdProgress,
  type WasdProgress,
  type WasdRunReport,
} from './wasd';
import {
  applyEzrealRun,
  emptyEzrealProgress,
  isEzrealStage,
  normalizeEzrealProgress,
  type EzrealProgress,
  type EzrealRunReport,
} from './ezreal';

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
  /** Which of the two run shapes this was. */
  mode: RunMode;
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
  /** How long the run lasted, in seconds. The headline of a SURVIVE run. */
  seconds: number;
  /** Defining mistakes made. SURVIVE ends on the third; PLAY only counts. */
  strikes: number;
  /** What went well and what cost the run, in plain language. */
  helped: string[];
  hurt: string[];
  advice: string;
}

/**
 * Enough of a run to draw it again next to the one you just played.
 *
 * Deliberately small: the path at a fifth of the recorded resolution and the
 * event marks without their positions. A ghost is a shape and a rhythm, not a
 * second copy of the telemetry, and this has to survive in localStorage
 * beside every other drill.
 */
export interface BestReplay {
  /** Downsampled path, a quarter of a second per point. */
  path: { x: number; y: number }[];
  /** Seconds per path sample, so the drawer does not have to assume. */
  step: number;
  /** The event timeline, kinds only. */
  marks: { t: number; k: TimelineMark['kind'] }[];
  score: number;
  at: number;
}

export interface BestRecord {
  score: number;
  metrics: Record<string, number>;
  at: number;
  /** The record run itself, for the replay's ghost. Absent on old profiles. */
  replay?: BestReplay;
}

/** Every fifth sample, capped — about a minute and a half of path. */
const GHOST_STRIDE = 5;
const GHOST_MAX_POINTS = 420;
const GHOST_MAX_MARKS = 320;

const captureReplay = (result: RunResult): BestReplay => {
  const path: { x: number; y: number }[] = [];
  for (let i = 0; i < result.metrics.path.length; i += GHOST_STRIDE) {
    const pt = result.metrics.path[i];
    // One decimal is well under a pixel at arena scale and roughly halves the
    // stored size.
    path.push({ x: Math.round(pt.x * 10) / 10, y: Math.round(pt.y * 10) / 10 });
    if (path.length >= GHOST_MAX_POINTS) break;
  }
  const marks = result.metrics.timeline
    .slice(0, GHOST_MAX_MARKS)
    .map((m) => ({ t: Math.round(m.t * 100) / 100, k: m.kind }));
  return { path, step: 0.05 * GHOST_STRIDE, marks, score: result.score, at: Date.now() };
};

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
  /** Which mistakes this run contained. Written for every run from v1.4. */
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


export interface DailyState {
  /** ISO date (local) of the day currently in progress. */
  date: string;
  completed: DrillId[];
  streak: number;
  lastCompletedDate: string | null;
  startOverall: number;
}

/**
 * The three answers to "when is my attack range drawn".
 *
 * A type rather than a boolean because the middle answer is the interesting
 * one, and a boolean has no room for it.
 */
export type RangeDisplay = 'check' | 'always' | 'off';

export const RANGE_DISPLAYS: RangeDisplay[] = ['check', 'always', 'off'];

const isRangeDisplay = (v: unknown): v is RangeDisplay =>
  typeof v === 'string' && (RANGE_DISPLAYS as string[]).includes(v);

/**
 * What a stored profile's range setting means to this build.
 *
 * Profiles written before the ring became a check hold a boolean. `false`
 * meant "never draw it", which is still a thing this build can do and still
 * what that player asked for, so it is honoured. `true` meant "always draw
 * it", and it is *not* honoured: it was the default nobody chose, and leaving
 * every existing profile with a permanent ring would quietly opt the entire
 * playerbase out of the feature. They get the check, which is the same
 * information for the price of one key.
 */
const readRangeDisplay = (raw: Partial<AppSettings> & { showRange?: unknown } | undefined): RangeDisplay => {
  if (isRangeDisplay(raw?.rangeDisplay)) return raw.rangeDisplay;
  if (raw?.showRange === false) return 'off';
  return DEFAULT_SETTINGS.rangeDisplay;
};

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
  /**
   * When your own attack range is drawn.
   *
   * `check` is the shipped answer and the one every mode is balanced around:
   * nothing is drawn until you centre the camera, and centring it paints your
   * reach for just under a second. A ring that is always there is a number
   * you read instead of a distance you know — it makes the trainer easier and
   * the game it trains for harder, which is exactly backwards. The other two
   * exist because a player who has never seen the ring cannot calibrate
   * against it (`always`), and a player who has stopped needing it should be
   * able to say so (`off`).
   */
  rangeDisplay: RangeDisplay;
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
  /**
   * Fog of war in the modes built around it.
   *
   * On by default, because the mode it belongs to — a whole fight, with
   * terrain — is not the same exercise with the lights up: finding the second
   * opponent is half of what makes it hard, and it is the half that transfers
   * furthest. Off is for a player still learning the kit, who would otherwise
   * be learning two things at once.
   */
  fogOfWar: boolean;
  /** The browser-gesture warning has been read and dismissed. */
  gestureNoticeDismissed: boolean;
  /**
   * Strip the HUD to what a run needs while it is happening.
   *
   * Everything analytical — the live figures, the difficulty read-out, the
   * frame counter, the brief — belongs after the drill rather than during it.
   * Off by default, because a player who has never seen the figures cannot
   * decide they are in the way.
   */
  focusMode: boolean;
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
  /**
   * The longest SURVIVE run of each mode.
   *
   * Kept apart from `bests` on purpose. A one-minute PLAY score and an
   * open-ended SURVIVE score are not the same number measured twice — the
   * second one grows simply by lasting — so letting a survive run into the
   * score record would quietly retire every play record on the profile.
   */
  survive: Partial<Record<DrillId, { seconds: number; score: number; at: number }>>;
  history: HistoryEntry[];
  daily: DailyState;
  settings: AppSettings;
  totalRuns: number;
  totalSeconds: number;
  /** The champion track. Separate from the general ladder on purpose. */
  vayne: VayneProgress;
  ezreal: EzrealProgress;
  /** The APM trainer's own ladder: thirteen modes, ten explicit levels each. */
  apm: ApmProgress;
  /** The WASD academy: nine modules, taken in order, played on the keys. */
  wasd: WasdProgress;
  /** Overall rating recorded at the start of each local day, for trends. */
  dailyMarks: { date: string; overall: number; ratings?: Record<SkillAxis, number> }[];
  /** Every mistake the trainer has measured, newest last. Capped. */
  errorLog: ErrorLogEntry[];
  /** Skill test records, keyed by test. Independent of the drill ladder. */
  /**
   * Personal bests as they happened, newest last.
   *
   * The `bests` map already holds the *values*, but it cannot answer "what did
   * I improve this week", which is the one question a home screen has to
   * answer before anything else. So each beaten record is also appended here,
   * with what it beat and when — a short, capped log rather than a second
   * source of truth.
   */
  recentBests: RecentBest[];
}

/** One beaten record, kept so the home screen can say what got better. */
export interface RecentBest {
  drill: DrillId;
  id: string;
  label: string;
  value: number;
  previous: number;
  format: KeyMetric['format'];
  direction: MetricDirection;
  at: number;
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
  movementScheme: 'wasd',
  tumbleAim: 'hands',
  rangeDisplay: 'check',
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
  fogOfWar: true,
  gestureNoticeDismissed: false,
  focusMode: false,
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
  survive: {},
  history: [],
  daily: { date: todayKey(), completed: [], streak: 0, lastCompletedDate: null, startOverall: 0 },
  settings: { ...DEFAULT_SETTINGS },
  totalRuns: 0,
  totalSeconds: 0,
  vayne: emptyVayneProgress(),
  ezreal: emptyEzrealProgress(),
  apm: emptyApmProgress(),
  wasd: emptyWasdProgress(),
  dailyMarks: [],
  errorLog: [],
  recentBests: [],
});

/**
 * DRILLS THAT NO LONGER EXIST.
 *
 * A saved profile is stamped with a version, and that version has not moved
 * since the first release — but the catalogue underneath it has. The lab
 * replaced thirteen in-game APM modes with thirteen bench modes under new
 * ids, and every profile written before that still names the old ones in its
 * history, its records, its error log and today's completed list.
 *
 * Read straight back, those names hand the client an `undefined` where a
 * drill should be, and the first screen that asks one for its axes dies on
 * it. That screen is Today, which is the screen the client opens on: the
 * failure card's two ways out are "back to today" and "reload", so a
 * returning player was locked out of their own profile with no way back in.
 *
 * So every stored reference is checked against the catalogue on the way in
 * and anything that no longer names a drill is dropped. Dropped rather than
 * remapped, because the bench modes are not the old modes renamed — they are
 * a different instrument, measured differently — and carrying a score across
 * would invent a record nobody set.
 *
 * What a returning player keeps is everything the ladder is actually made of:
 * ratings, samples, difficulty, totals, rank and peak are stored per *axis*,
 * not per drill, so the rank they left with is the rank they come back to.
 * What they lose is the runs and records belonging to drills that are gone,
 * which is the only honest reading of them.
 */
const keepKnownDrills = <T>(list: unknown, drillOf: (x: T) => unknown, cap: number): T[] =>
  Array.isArray(list) ? (list as T[]).filter((x) => x && isDrillId(drillOf(x))).slice(-cap) : [];

const keepKnownBests = (raw: unknown): Partial<Record<DrillId, BestRecord>> => {
  const out: Partial<Record<DrillId, BestRecord>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, rec] of Object.entries(raw as Record<string, BestRecord>)) {
    if (isDrillId(id) && rec) out[id] = rec;
  }
  return out;
};

const keepKnownSurvive = (raw: unknown): Profile['survive'] => {
  const out: Profile['survive'] = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, rec] of Object.entries(raw as Record<string, { seconds?: unknown; score?: unknown; at?: unknown }>)) {
    if (!isDrillId(id) || !rec) continue;
    const seconds = Number(rec.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0) continue;
    out[id] = {
      seconds,
      score: Number.isFinite(Number(rec.score)) ? Number(rec.score) : 0,
      at: Number.isFinite(Number(rec.at)) ? Number(rec.at) : Date.now(),
    };
  }
  return out;
};


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
      settings: {
        ...p.settings,
        ...parsed.settings,
        // A champion from a build whose roster has since changed reads back as
        // the default everywhere it is drawn, so it is normalised here too —
        // otherwise settings shows a roster with nothing selected in it.
        hero: isHeroId(parsed.settings?.hero) ? parsed.settings.hero : p.settings.hero,
        // The one setting whose *meaning* changed rather than its value.
        rangeDisplay: readRangeDisplay(parsed.settings),
        // Rebinds are the one setting stored as a free-form map, so they are
        // the one setting a half-written profile can hand back as nonsense.
        // Cleaning them here means a stored binding for an action this build
        // no longer has — or one that is simply not a binding — never reaches
        // the input system or the settings screen's changed-from-default
        // counts.
        bindings: sanitizeOverrides('click', parsed.settings?.bindings),
        wasdBindings: sanitizeOverrides('wasd', parsed.settings?.wasdBindings),
      },
      // A profile written before champion select existed is not dragged back
      // through onboarding if it has already been placed — it simply keeps the
      // default body until its owner goes and changes it.
      onboarded: parsed.onboarded ?? Boolean(parsed.placed),
      // A profile written before patch notes existed has genuinely not read
      // them, so it keeps null and gets the mark. Which releases it missed is
      // unknowable, so the notes screen highlights the current one rather than
      // inventing a history for it.
      seenVersion: parsed.seenVersion ?? null,
      // Today's completed list is a list of drill ids like any other, and a
      // stale one in it would strike the plan's ticks out against nothing.
      daily: {
        ...p.daily,
        ...parsed.daily,
        completed: Array.isArray(parsed.daily?.completed) ? parsed.daily.completed.filter(isDrillId) : [],
      },
      // The two champion tracks are repaired rather than merged, for the same
      // reason the ladders below are: a profile written before one existed —
      // or before a stage did, or with a stage half-written — has to come back
      // playable rather than come back with a hole in the middle of it.
      vayne: normalizeVayneProgress(parsed.vayne),
      ezreal: normalizeEzrealProgress(parsed.ezreal),
      // The APM ladder is repaired rather than merged: a profile written
      // before it existed, or before a mode did, has to come back playable.
      apm: normalizeApmProgress(parsed.apm),
      bests: keepKnownBests(parsed.bests),
      // Written from the modes release. An older profile has never played a
      // survive run, so it comes back with none rather than with a record
      // invented out of its play scores.
      survive: keepKnownSurvive(parsed.survive),
      history: keepKnownDrills<HistoryEntry>(parsed.history, (h) => h.drill, 400),
      dailyMarks: Array.isArray(parsed.dailyMarks) ? parsed.dailyMarks.slice(-120) : [],
      // Written from v1.4. An older profile starts it empty rather than having
      // a history of mistakes invented for it. Both halves of a logged mistake
      // are names that can go stale: the drill it happened in, and the code.
      errorLog: keepKnownDrills<ErrorLogEntry>(parsed.errorLog, (e) => e.drill, 800).filter((e) =>
        isErrorCode(e.code),
      ),
      // Same for the academy: a profile written before it existed comes back
      // with an empty course rather than a crash on modules.wasdMove.
      wasd: normalizeWasdProgress(parsed.wasd),
      recentBests: keepKnownDrills<RecentBest>(parsed.recentBests, (b) => b.drill, 60),
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
  /** Present only for runs on the Ezreal path. */
  ezreal: EzrealRunReport | null;
  /** Present only for runs in the APM trainer. */
  apm: ApmRunReport | null;
  /** Present only for runs in the WASD academy. */
  wasd: WasdRunReport | null;
  /**
   * The best run of this drill as it stood *before* this one — the thing the
   * replay draws a ghost of. Null on a first run, when there is nothing to
   * compare against and pretending otherwise would be theatre.
   */
  ghost: BestReplay | null;
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

/**
 * Runs before a profile is ranked.
 *
 * There is no calibration sequence any more — a screen that made you play five
 * drills before it would tell you anything was a toll gate, and the two-mode
 * menu exists precisely so that the first thing a new player does is press
 * PLAY. So placement is simply the first few runs: they seed the ladder from
 * what they measured rather than nudging it, and the rank appears once there
 * is enough behind it to be worth printing.
 */
export const PLACEMENT_RUNS = 3;

export interface RunContext {
  /** Forces the seeding behaviour. Defaults to "this profile is not placed". */
  placement?: boolean;
  /** The APM ladder rung this run was played at. */
  level?: number;
  /** A double-length APM run, which may set rate records but never a score. */
  endurance?: boolean;
}

export const applyRun = (p: Profile, result: RunResult, opts: RunContext = {}): ProgressReport => {
  const calibrating = opts.placement ?? !p.placed;
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
    const upd = updateRating(before, calibrating ? 0 : samples, part.performance, result.difficulty);
    const after = calibrating && samples === 0 ? upd.expected : upd.after;
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
  // Held before the record is rewritten below: the ghost the results screen
  // draws is the best you had coming in, not the one you may just have set.
  const ghostBefore = prevBest?.replay ?? null;
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
      p.recentBests.push({
        drill: result.drill,
        id: km.id,
        label: km.label,
        value: km.value,
        previous: prev as number,
        format: km.format,
        direction: km.direction,
        at: Date.now(),
      });
    }
  }
  // A double-length run accumulates a longer score by construction, so it is
  // allowed to set rate records and never a score record.
  if (p.recentBests.length > 60) p.recentBests.splice(0, p.recentBests.length - 60);
  // A survive run is scored the same way an endurance run always was: it is
  // long by construction, so it may set rate records and never a score record.
  const openEnded = opts.endurance || result.mode === 'survive';
  if (result.mode === 'survive') {
    const prevSurvive = p.survive[result.drill];
    if (!prevSurvive || result.seconds > prevSurvive.seconds) {
      p.survive[result.drill] = { seconds: result.seconds, score: result.score, at: Date.now() };
    }
  }
  const newBestScore = !openEnded && prevBest !== null && result.score > prevBest.score;
  const previousBestScore = prevBest?.score ?? null;
  // `at` is when the record was *set*, not when the drill was last played.
  // Stamping it every run would make "set this week" mean "played this week",
  // which is a different and much less interesting claim.
  const recordMoved = prevBest === null || newBestScore || personalBests.length > 0;
  // The ghost belongs to the run holding the score record, so it is only
  // replaced when the score is. An endurance run never holds it, by the same
  // rule that stops it setting one.
  const keepGhost = !newBestScore || openEnded;
  p.bests[result.drill] = {
    score: openEnded ? (prevBest?.score ?? 0) : Math.max(result.score, prevBest?.score ?? 0),
    metrics: bestMetrics,
    at: recordMoved ? Date.now() : prevBest.at,
    replay:
      keepGhost && prevBest?.replay
        ? prevBest.replay
        : openEnded
          ? prevBest?.replay
          : captureReplay(result),
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

  const ezreal = isEzrealStage(result.drill)
    ? applyEzrealRun(
        p.ezreal,
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

  // The academy keeps the last run's headline numbers for the same reason the
  // champion path does: so it can name the habit that is costing you rather
  // than only the score that resulted from it.
  const wasd = isWasdModuleId(result.drill)
    ? applyWasdRun(
        p.wasd,
        result.drill,
        result.performance,
        result.difficulty,
        result.score,
        Object.fromEntries(result.keyMetrics.map((k) => [k.id, k.value])),
      )
    : null;

  adaptDifficulty(p, result.drill, result.performance);
  p.totalRuns++;
  if (!p.placed && p.totalRuns >= PLACEMENT_RUNS) {
    p.placed = true;
    p.placementRuns = p.totalRuns;
  }
  p.totalSeconds += result.metrics.duration;

  const today = todayKey();
  if (!p.dailyMarks.length || p.dailyMarks[p.dailyMarks.length - 1].date !== today) {
    p.dailyMarks.push({ date: today, overall: p.overall, ratings: { ...p.ratings } });
    if (p.dailyMarks.length > 120) p.dailyMarks.shift();
  } else {
    const mark = p.dailyMarks[p.dailyMarks.length - 1];
    mark.overall = p.overall;
    // The per-axis snapshot is what makes a 30-day skill change statable at
    // all — without a mark from thirty days ago there is nothing to subtract.
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
    ghost: ghostBefore,
    errors,
    limiter,
    limiterWas,
    vayne,
    ezreal,
    apm,
    wasd,
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

