import { clamp } from '../engine/math';
import { APM_DRILL_IDS, APM_TARGET_APM, isApmDrill, type ApmDrillId } from '../drills/apm';
import { DRILLS } from '../drills/catalog';
import { APM_LEVELS, CLEAR_AT, STAR_AT, levelDifficulty } from './apmladder';

/**
 * The APM trainer's own progression.
 *
 * The rest of the client hides difficulty: an axis carries a number, the
 * number moves after every run, and you are never asked what you want to play
 * at. That is right for a ladder — it keeps you in the band where rating is
 * measurable — and it is wrong for a hand-speed trainer, where the whole
 * activity is *choosing a rung and holding it until it is easy*.
 *
 * So the APM section is built the other way round: thirteen lab modes, ten
 * explicit levels each, one record per level. A level is a place you go back
 * to, beat, and leave behind. Your best on level 6 cannot be taken away by a
 * bad run on level 7, and nothing about the ladder is inferred — the number
 * on the rung is the difficulty the drill will be played at.
 *
 * Everything else here follows from that:
 *
 *  - Clearing a level opens the next one, so the ladder is walked rather than
 *    skipped, and a level cleared outright opens two, so a player who is
 *    plainly past a rung does not have to grind it.
 *  - Placement seeds where the ladder starts. An Expert-class player should not be
 *    made to click level 1 for eight minutes to reach the part that is hard.
 *  - Mastery weights the top of the ladder heavily, because three stars on
 *    level 10 is a different claim from three stars on level 1.
 */

/**
 * The ladder's geometry lives one file down, in `apmladder.ts`.
 *
 * It is re-exported here because this is where the rest of the client has
 * always asked for it, and it is *defined* there because the arena needs it
 * too now: the infinite run moves the rung while the player is standing on it,
 * and a drill importing this file would close a loop through the catalogue.
 */
export { APM_LEVELS, CLEAR_AT, STAR_AT, levelDifficulty };
export { difficultyLevel } from './apmladder';

export type ApmModeKind = 'isolated' | 'combined';

export interface ApmMode {
  id: ApmDrillId;
  kind: ApmModeKind;
  /** The input this mode actually counts. */
  counts: string;
  /** Why it is hard once the counting is understood. */
  pressure: string;
  /** A strong run's sustained rate, for the par figure on the ladder. */
  par: number;
  order: number;
}

/**
 * The modes, split the way the drill itself is built rather than by theme.
 *
 * Isolated modes ask one thing of one pair of hands. Combined modes run two
 * demands at once and are worth playing only once the isolated version of
 * each has stopped being interesting — which is the order the list is in.
 *
 * Two things are true of every rung of every one of them and are therefore
 * written down in none of them: the pads travel, further and faster the higher
 * the level, and the minimap runs its two-lane dodge on the summoner keys for
 * the whole run. What the level ladder scales is the mode *and* both of those.
 */
const MODE_TABLE: Omit<ApmMode, 'par' | 'order'>[] = [
  {
    id: 'apmPulse',
    kind: 'isolated',
    counts: 'A key, on the pad that is lit.',
    pressure: 'Nothing but cadence — except that the light repeats, so a hand on autopilot answers the wrong pad.',
  },
  {
    id: 'apmSequence',
    kind: 'isolated',
    counts: 'The front key of a rolling queue.',
    pressure: 'No mouse at all, and the window shrinks as you speed up.',
  },
  {
    id: 'apmChord',
    kind: 'isolated',
    counts: 'A pair of keys, landed together.',
    pressure: 'Graded on the gap between your two fingers, down to under fifty milliseconds.',
  },
  {
    id: 'apmGate',
    kind: 'isolated',
    counts: 'A key on a live pad — and the stillness on a barred one.',
    pressure: 'Half the prompts are asking you not to press, and pressing them costs the chain.',
  },
  {
    id: 'apmBuffer',
    kind: 'isolated',
    counts: 'One key, inside the last fraction of a second before a window opens.',
    pressure: 'Early is eaten, late is only reacting. The clock is visible and slightly irregular.',
  },
  {
    id: 'apmCancel',
    kind: 'isolated',
    counts: 'A start, and the cut that follows it.',
    pressure: 'The second press only means anything relative to the first, and its window closes to a tenth of a second.',
  },
  {
    id: 'apmVector',
    kind: 'isolated',
    counts: 'A movement command, in the called direction.',
    pressure: 'Nothing to dodge and nowhere to be — only how fast a decision becomes a heading.',
  },
  {
    id: 'apmField',
    kind: 'isolated',
    counts: 'A click inside a pad.',
    pressure: 'Graded in units from the centre, and the pads shrink as the chain grows.',
  },
  {
    id: 'apmHandoff',
    kind: 'combined',
    counts: 'A click, then a key, then a click.',
    pressure: 'Never twice with the same hand, and the seam between them is the measurement.',
  },
  {
    id: 'apmSplit',
    kind: 'combined',
    counts: 'The centre queue, and the lane keys the corner of the screen is asking for.',
    pressure: 'The board runs at double rate behind a queue that never stops, and neither is allowed to wait for the other.',
  },
  {
    id: 'apmUpkeep',
    kind: 'combined',
    counts: 'A wheel spent inside its grace period.',
    pressure: 'Self-paced: nothing prompts you, four clocks run at rates that do not divide, and one of them is locked.',
  },
  {
    id: 'apmSwitch',
    kind: 'combined',
    counts: 'A key or a click, in whichever bank was called.',
    pressure: 'The prompt keeps changing hand shape, and the mode prints what that costs you.',
  },
  {
    id: 'apmSustain',
    kind: 'combined',
    counts: 'A key, on a beat that never stops getting faster.',
    pressure: 'Drop two beats inside one step and the run ends where your hands actually end.',
  },
];

export const APM_MODES: ApmMode[] = MODE_TABLE.map((m, i) => ({
  ...m,
  par: APM_TARGET_APM[m.id],
  order: i + 1,
}));

export const APM_MODE_BY_ID: Record<ApmDrillId, ApmMode> = APM_MODES.reduce(
  (acc, m) => {
    acc[m.id] = m;
    return acc;
  },
  {} as Record<ApmDrillId, ApmMode>,
);

export const modesOfKind = (kind: ApmModeKind): ApmMode[] => APM_MODES.filter((m) => m.kind === kind);

// ------------------------------------------------------------------ records

export interface ApmLevelRecord {
  runs: number;
  /** Best performance ever recorded on this level, 0..1. */
  best: number;
  /** Best score at standard length. Endurance runs never write it. */
  bestScore: number;
  /** Best sustained *correct* actions per minute on this level. */
  bestApm: number;
}

/**
 * What the infinite run leaves behind.
 *
 * Not a level record, because an infinite run is not played at a level — the
 * floor moves the whole time, and writing its result onto whichever rung it
 * happened to finish on would corrupt the one thing the explicit ladder is
 * for. It keeps its own three numbers instead, and the only thing it is
 * allowed to do to the ladder proper is *open* rungs: holding level seven is
 * proof you may play level seven, and it is not proof that you cleared it.
 */
export interface ApmInfiniteRecord {
  runs: number;
  /** The highest rung ever held — the length-weighted mean of a whole run. */
  bestHeld: number;
  /** The highest the floor ever got, even for a moment. */
  bestPeak: number;
  /** The longest infinite run, in seconds. */
  bestSeconds: number;
  /** Best sustained correct actions a minute in an infinite run. */
  bestApm: number;
}

export interface ApmModeRecord {
  levels: ApmLevelRecord[];
  /** Highest level that may be played, 1..APM_LEVELS. */
  unlocked: number;
  /** The level the player last chose, so the screen reopens where they left. */
  lastLevel: number;
  runs: number;
  /** The open-ended run's own ledger. Synthesised for profiles without one. */
  infinite: ApmInfiniteRecord;
}

export interface ApmProgress {
  modes: Record<ApmDrillId, ApmModeRecord>;
  /** Whether the ladder's starting rung has been set from a placement. */
  seeded: boolean;
  /** The level placement opened, kept so the screen can say so. */
  seededTo: number;
  /** Highest sustained correct APM ever recorded, in any mode. */
  bestApm: number;
  bestApmMode: ApmDrillId | null;
  mastery: number;
  peak: number;
}

const emptyLevel = (): ApmLevelRecord => ({ runs: 0, best: 0, bestScore: 0, bestApm: 0 });

const emptyInfinite = (): ApmInfiniteRecord => ({
  runs: 0,
  bestHeld: 0,
  bestPeak: 0,
  bestSeconds: 0,
  bestApm: 0,
});

const emptyMode = (): ApmModeRecord => ({
  levels: Array.from({ length: APM_LEVELS }, emptyLevel),
  unlocked: 1,
  lastLevel: 1,
  runs: 0,
  infinite: emptyInfinite(),
});

export const emptyApmProgress = (): ApmProgress => ({
  modes: APM_DRILL_IDS.reduce(
    (acc, id) => {
      acc[id] = emptyMode();
      return acc;
    },
    {} as Record<ApmDrillId, ApmModeRecord>,
  ),
  seeded: false,
  seededTo: 1,
  bestApm: 0,
  bestApmMode: null,
  mastery: 0,
  peak: 0,
});

/**
 * Repairs a progress object loaded from storage.
 *
 * A profile written before this ladder existed, or one written when a mode did
 * not exist yet, has to come back as a playable ladder rather than as a crash
 * on `levels[3]`.
 */
export const normalizeApmProgress = (raw: Partial<ApmProgress> | undefined): ApmProgress => {
  const out = emptyApmProgress();
  if (!raw) return out;
  out.seeded = raw.seeded ?? false;
  out.seededTo = clamp(Math.round(raw.seededTo ?? 1), 1, APM_LEVELS);
  out.bestApm = Math.max(0, raw.bestApm ?? 0);
  out.bestApmMode = raw.bestApmMode && isApmDrill(raw.bestApmMode) ? raw.bestApmMode : null;
  for (const id of APM_DRILL_IDS) {
    const src = raw.modes?.[id];
    if (!src) continue;
    const rec = out.modes[id];
    rec.unlocked = clamp(Math.round(src.unlocked ?? 1), 1, APM_LEVELS);
    rec.lastLevel = clamp(Math.round(src.lastLevel ?? 1), 1, APM_LEVELS);
    rec.runs = Math.max(0, src.runs ?? 0);
    const inf = src.infinite;
    if (inf) {
      rec.infinite = {
        runs: Math.max(0, inf.runs ?? 0),
        bestHeld: clamp(inf.bestHeld ?? 0, 0, APM_LEVELS),
        bestPeak: clamp(inf.bestPeak ?? 0, 0, APM_LEVELS),
        bestSeconds: Math.max(0, inf.bestSeconds ?? 0),
        bestApm: Math.max(0, inf.bestApm ?? 0),
      };
    }
    if (Array.isArray(src.levels)) {
      for (let i = 0; i < APM_LEVELS; i++) {
        const lv = src.levels[i];
        if (!lv) continue;
        rec.levels[i] = {
          runs: Math.max(0, lv.runs ?? 0),
          best: clamp(lv.best ?? 0, 0, 1),
          bestScore: Math.max(0, lv.bestScore ?? 0),
          bestApm: Math.max(0, lv.bestApm ?? 0),
        };
      }
    }
  }
  out.mastery = computeApmMastery(out);
  out.peak = Math.max(out.mastery, raw.peak ?? 0);
  return out;
};

// ------------------------------------------------------------------ queries

export const levelStars = (rec: ApmLevelRecord): 0 | 1 | 2 | 3 => {
  if (rec.best >= STAR_AT[2]) return 3;
  if (rec.best >= STAR_AT[1]) return 2;
  if (rec.best >= STAR_AT[0]) return 1;
  return 0;
};

export const levelCleared = (rec: ApmLevelRecord): boolean => rec.best >= CLEAR_AT;

export const starsOn = (p: ApmProgress, id: ApmDrillId): number =>
  p.modes[id].levels.reduce((n, lv) => n + levelStars(lv), 0);

/**
 * How much of a mode has been taken, 0..100.
 *
 * Weighted by level, so the number keeps moving for exactly as long as there
 * is a harder rung left: three stars on level 10 is worth ten times three
 * stars on level 1, because it is.
 */
export const modeMastery = (rec: ApmModeRecord): number => {
  let got = 0;
  let max = 0;
  for (let i = 0; i < APM_LEVELS; i++) {
    const weight = i + 1;
    max += weight;
    got += (levelStars(rec.levels[i]) / 3) * weight;
  }
  return max > 0 ? (got / max) * 100 : 0;
};

export const computeApmMastery = (p: ApmProgress): number => {
  const total = APM_DRILL_IDS.reduce((sum, id) => sum + modeMastery(p.modes[id]), 0);
  return clamp(total / APM_DRILL_IDS.length, 0, 100);
};

/** The highest level cleared in a mode, or 0. */
export const clearedThrough = (rec: ApmModeRecord): number => {
  let out = 0;
  for (let i = 0; i < APM_LEVELS; i++) if (levelCleared(rec.levels[i])) out = i + 1;
  return out;
};

/**
 * The rung the section opens the mode on: the lowest one still uncleared.
 *
 * Not the highest unlocked — a player who was skipped ahead should land on the
 * rung they have not beaten, not on the one after it — and not the lowest
 * unstarred, because sending somebody back to a level they already cleared is
 * exactly the busywork an explicit ladder exists to remove. It is only ever a
 * suggestion: every unlocked rung stays playable, and a scrape is visible as a
 * single star for as long as it stands.
 */
export const recommendedLevel = (p: ApmProgress, id: ApmDrillId): number => {
  const rec = p.modes[id];
  for (let i = 0; i < rec.unlocked; i++) {
    if (!levelCleared(rec.levels[i])) return i + 1;
  }
  return rec.unlocked;
};

/** The mode the section suggests next: the one with the most left in it. */
export const nextApmMode = (p: ApmProgress): ApmMode => {
  const unplayed = APM_MODES.find((m) => p.modes[m.id].runs === 0);
  if (unplayed) return unplayed;
  return [...APM_MODES].sort((a, b) => modeMastery(p.modes[a.id]) - modeMastery(p.modes[b.id]))[0];
};

export interface ApmTitle {
  name: string;
  at: number;
  blurb: string;
}

export const APM_TITLES: ApmTitle[] = [
  { name: 'UNMEASURED', at: 0, blurb: 'Your hands have not been counted yet.' },
  { name: 'STEADY', at: 10, blurb: 'The rate is there. It is not there under pressure yet.' },
  { name: 'QUICK', at: 24, blurb: 'You have stopped waiting for certainty before committing.' },
  { name: 'FLUENT', at: 40, blurb: 'The chain survives a mistake now instead of ending at one.' },
  { name: 'RAPID', at: 56, blurb: 'Two demands at once, and neither hand is waiting on the other.' },
  { name: 'RELENTLESS', at: 72, blurb: 'The top half of the ladder is where you train.' },
  { name: 'INHUMAN', at: 88, blurb: 'Every mode taken at a level with nothing left to teach you.' },
];

export const apmTitleFor = (mastery: number): ApmTitle => {
  let out = APM_TITLES[0];
  for (const t of APM_TITLES) if (mastery >= t.at) out = t;
  return out;
};

export const nextApmTitle = (mastery: number): ApmTitle | null =>
  APM_TITLES.find((t) => t.at > mastery) ?? null;

/**
 * Opens the ladder at a rung that matches the player who already calibrated.
 *
 * Placement measures a general mechanical rating, and a player who placed at
 * A Refined-class player has already demonstrated the thing levels 1–3 exist to teach. They
 * still *own* those levels — nothing is skipped or awarded — they simply do
 * not have to walk up to the interesting part one run at a time.
 */
export const seedApmLadder = (p: ApmProgress, overallRating: number): number => {
  // 3600 is the top of the rank ladder; six of ten rungs is as far as a
  // placement is allowed to speak for you.
  const open = clamp(1 + Math.round((overallRating / 3600) * 6), 1, 6);
  for (const id of APM_DRILL_IDS) {
    p.modes[id].unlocked = Math.max(p.modes[id].unlocked, open);
    p.modes[id].lastLevel = Math.max(p.modes[id].lastLevel, open);
  }
  p.seeded = true;
  p.seededTo = open;
  return open;
};

// -------------------------------------------------------------------- runs

/** What an infinite run did, for the screen that has to say so. */
export interface ApmInfiniteReport {
  /** The rung the run stood on: the length-weighted mean of the floor. */
  held: number;
  /** The highest it reached, and the lowest it fell to. */
  peak: number;
  low: number;
  /** The rung the run opened on, and how long it lasted. */
  opened: number;
  seconds: number;
  /** The records this run was measured against, as they stood before it. */
  previousHeld: number;
  previousPeak: number;
  previousSeconds: number;
  heldRecord: boolean;
  peakRecord: boolean;
  longest: boolean;
  /** The rung this run opened in the ladder proper, if it opened one. */
  unlockedTo: number | null;
}

export interface ApmRunReport {
  mode: ApmMode;
  level: number;
  performance: number;
  cleared: boolean;
  /** This run is what cleared the level for the first time. */
  firstClear: boolean;
  starsBefore: 0 | 1 | 2 | 3;
  starsAfter: 0 | 1 | 2 | 3;
  previousBest: number;
  best: number;
  /** Correct actions a minute this run, and the level's record. */
  apm: number;
  bestApm: number;
  apmRecord: boolean;
  /** The level this run opened, if any. */
  unlockedTo: number | null;
  /** True when the clear was decisive enough to open two rungs at once. */
  skipped: boolean;
  masteryBefore: number;
  masteryAfter: number;
  titleBefore: ApmTitle;
  titleAfter: ApmTitle;
  /** Where the section will send them next. */
  nextLevel: number;
  endurance: boolean;
  /** Present exactly when this was an infinite run. */
  infinite: ApmInfiniteReport | null;
}

/** The floor's own account of an infinite run, read off its key metrics. */
export interface ApmInfiniteInput {
  held: number;
  peak: number;
  low: number;
  seconds: number;
}

export interface ApmRunInput {
  drill: ApmDrillId;
  level: number;
  performance: number;
  score: number;
  /** Sustained correct actions per minute, from the run's key metrics. */
  apm: number;
  endurance: boolean;
  /**
   * Set when the run had no rung to write to because the rung moved. The
   * level above is then the rung it *opened* on, which is a fact about where
   * the player pointed the menu rather than about what they played.
   */
  infinite?: ApmInfiniteInput;
}

/**
 * Records one run against the ladder.
 *
 * Only a better run moves a record. A worse run on a level you have already
 * three-starred is a warm-up, and the ladder treats it as one — it counts as a
 * run, it still feeds the general rating, and it takes nothing away.
 */
export const applyApmRun = (p: ApmProgress, run: ApmRunInput): ApmRunReport => {
  const mode = APM_MODE_BY_ID[run.drill];
  const rec = p.modes[run.drill];
  const level = clamp(Math.round(run.level), 1, APM_LEVELS);
  const lv = rec.levels[level - 1];

  const masteryBefore = p.mastery;
  const titleBefore = apmTitleFor(p.peak);
  const starsBefore = levelStars(lv);
  const previousBest = lv.best;
  const clearedBefore = levelCleared(lv);

  rec.runs += 1;
  if (run.apm > p.bestApm) {
    p.bestApm = run.apm;
    p.bestApmMode = run.drill;
  }

  // ------------------------------------------------------------- infinite
  //
  // A run whose floor moved is scored against itself and against nothing on
  // the ladder. It writes its own three records, it opens the rungs it proved
  // it can stand on, and it leaves every star exactly where it found it —
  // because a star is a claim about a *fixed* rung, and this run did not play
  // one.
  if (run.infinite) {
    const inf = rec.infinite;
    const held = clamp(run.infinite.held, 1, APM_LEVELS);
    const peak = clamp(run.infinite.peak, 1, APM_LEVELS);
    const previousHeld = inf.bestHeld;
    const previousPeak = inf.bestPeak;
    const previousSeconds = inf.bestSeconds;
    const previousApm = inf.bestApm;
    inf.runs += 1;
    inf.bestHeld = Math.max(inf.bestHeld, held);
    inf.bestPeak = Math.max(inf.bestPeak, peak);
    inf.bestSeconds = Math.max(inf.bestSeconds, run.infinite.seconds);
    inf.bestApm = Math.max(inf.bestApm, run.apm);
    // Holding a rung opens it. It does not clear it: access is a claim about
    // what you can survive, and a star is a claim about what you can beat.
    const openedBefore = rec.unlocked;
    rec.unlocked = clamp(Math.max(rec.unlocked, Math.floor(held)), 1, APM_LEVELS);
    rec.lastLevel = clamp(Math.round(held), 1, APM_LEVELS);

    p.mastery = computeApmMastery(p);
    p.peak = Math.max(p.peak, p.mastery);

    return {
      mode,
      level,
      performance: run.performance,
      cleared: levelCleared(lv),
      firstClear: false,
      starsBefore,
      starsAfter: starsBefore,
      previousBest,
      best: lv.best,
      apm: run.apm,
      bestApm: inf.bestApm,
      apmRecord: run.apm > previousApm,
      unlockedTo: null,
      skipped: false,
      masteryBefore,
      masteryAfter: p.mastery,
      titleBefore,
      titleAfter: apmTitleFor(p.peak),
      nextLevel: recommendedLevel(p, run.drill),
      endurance: true,
      infinite: {
        held,
        peak,
        low: clamp(run.infinite.low, 1, APM_LEVELS),
        opened: level,
        seconds: run.infinite.seconds,
        previousHeld,
        previousPeak,
        previousSeconds,
        heldRecord: held > previousHeld,
        peakRecord: peak > previousPeak,
        longest: run.infinite.seconds > previousSeconds,
        unlockedTo: rec.unlocked > openedBefore ? rec.unlocked : null,
      },
    };
  }

  rec.lastLevel = level;
  lv.runs += 1;
  if (run.performance > lv.best) lv.best = clamp(run.performance, 0, 1);
  // An endurance run is longer, so its score is not comparable with the
  // standard one. It can set a rate record — a rate is a rate — but never the
  // score record, which would otherwise be won by whoever played longest.
  if (!run.endurance) lv.bestScore = Math.max(lv.bestScore, run.score);
  const apmRecord = run.apm > lv.bestApm;
  lv.bestApm = Math.max(lv.bestApm, run.apm);

  const cleared = levelCleared(lv);
  const firstClear = cleared && !clearedBefore;
  // A clear opens the next rung; a run that is plainly past the rung opens two,
  // because making somebody grind a level they just three-starred is the exact
  // busywork an explicit ladder is supposed to remove.
  const skipped = firstClear && run.performance >= STAR_AT[2] && level >= rec.unlocked;
  const before = rec.unlocked;
  if (cleared) rec.unlocked = clamp(Math.max(rec.unlocked, level + (skipped ? 2 : 1)), 1, APM_LEVELS);
  const unlockedTo = rec.unlocked > before ? rec.unlocked : null;

  p.mastery = computeApmMastery(p);
  p.peak = Math.max(p.peak, p.mastery);

  return {
    mode,
    level,
    performance: run.performance,
    cleared,
    firstClear,
    starsBefore,
    starsAfter: levelStars(lv),
    previousBest,
    best: lv.best,
    apm: run.apm,
    bestApm: lv.bestApm,
    apmRecord,
    unlockedTo,
    skipped,
    masteryBefore,
    masteryAfter: p.mastery,
    titleBefore,
    titleAfter: apmTitleFor(p.peak),
    nextLevel: recommendedLevel(p, run.drill),
    endurance: run.endurance,
    infinite: null,
  };
};

/** The name the client prints for a mode. */
export const apmModeName = (id: ApmDrillId): string => DRILLS[id].name;

export { isApmDrill, APM_DRILL_IDS };
export type { ApmDrillId };
