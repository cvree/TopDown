import { asNumber, clamp } from '../engine/math';
import { DRILLS, XERATH_SEQUENCE, type DrillId } from '../drills/catalog';
import { XERATH_DRILL_IDS, xerathStage, type XerathDrillId } from '../drills/xerath';

/**
 * The Xerath path's progression.
 *
 * Nine stages in a fixed order, each gated on the one before it, for the same
 * reason the other champion paths are: you cannot be asked to keep a band
 * against an assassin until the pulse goes out at the right length without
 * thought, and you cannot be asked to finish a fight from across the map until
 * a stunned body is something your hands already punish.
 *
 * Mastery is a claim about your ceiling, so it only ever moves when your best
 * run on a stage improves, and it is weighted by the difficulty that run was
 * played at — a flawless first stage on the lowest setting is a real thing and
 * it is worth about half of the same run at the top.
 */

export type XerathStageId = XerathDrillId;

export interface XerathStage {
  id: XerathStageId;
  step: number;
  /** Where this sits in the learn → test arc. */
  phase: 'LEARN' | 'ISOLATED' | 'COMBINED' | 'PRESSURE' | 'TRANSFER' | 'TEST';
  title: string;
  purpose: string;
  /** Performance needed to open the next stage. */
  gate: number;
  /** Share of total mastery this stage carries. */
  weight: number;
}

const PURPOSE: Record<XerathStageId, { title: string; purpose: string }> = {
  xerPulse: {
    title: 'The pulse',
    purpose: 'The charge is the range. Land it, and let go the moment the end of the line is past them.',
  },
  xerEye: {
    title: 'The Eye',
    purpose: 'It lands three quarters of a second late. Put the centre where they are walking to.',
  },
  xerOrb: {
    title: 'The orb',
    purpose: 'It stops on the first body and stuns longer the farther it flew. Land it, from far away.',
  },
  xerEdge: {
    title: 'The band',
    purpose: 'Outside their red ring, inside your blue one. Live there, and hit from there.',
  },
  xerCombo: {
    title: 'The combo',
    purpose: 'A stunned body cannot juke. Orb first, then the Eye on its feet and the pulse through it.',
  },
  xerRetreat: {
    title: 'The retreat',
    purpose: 'They are coming for you. Orb them while they are still far out, and pulse them on the way back.',
  },
  xerRite: {
    title: 'The Rite',
    purpose: 'Four shots from across the map. Lead them, and make every shot a different guess.',
  },
  xerWave: {
    title: 'The lane',
    purpose: 'Over the wave with the pulse, never into it with the orb, and never inside their range.',
  },
  xerFight: {
    title: 'The artillery',
    purpose: 'The band, the pulse, the orb and the Rite — at once, against people trying to reach you.',
  },
};

/** Later stages ask for more, so they are worth more. */
const WEIGHT: Record<XerathStage['phase'], number> = {
  LEARN: 0.6,
  ISOLATED: 0.85,
  COMBINED: 1,
  PRESSURE: 1.25,
  TRANSFER: 1.35,
  TEST: 1.9,
};

const rawWeights = XERATH_DRILL_IDS.map((id) => WEIGHT[xerathStage(id).stage]);
const weightSum = rawWeights.reduce((a, b) => a + b, 0);

export const XERATH_STAGES: XerathStage[] = XERATH_DRILL_IDS.map((id, i) => ({
  id,
  step: i + 1,
  phase: xerathStage(id).stage,
  title: PURPOSE[id].title,
  purpose: PURPOSE[id].purpose,
  // The gate rises along the path, but only a little: it is there to stop you
  // skipping a stage you cannot do, not to keep you on one you can.
  gate: 0.52 + i * 0.012,
  weight: rawWeights[i] / weightSum,
}));

export const XERATH_STAGE_IDS: XerathStageId[] = XERATH_STAGES.map((s) => s.id);

export const isXerathStage = (id: DrillId): id is XerathStageId =>
  (XERATH_SEQUENCE as DrillId[]).includes(id);

export interface XerathStageRecord {
  best: number;
  difficulty: number;
  bestScore: number;
  runs: number;
  /** The most recent run's headline numbers, keyed by metric id. */
  habits?: Record<string, number>;
  onKeys?: boolean;
}

export interface XerathProgress {
  stages: Record<XerathStageId, XerathStageRecord>;
  mastery: number;
  peak: number;
}

export const emptyXerathProgress = (): XerathProgress => ({
  stages: XERATH_STAGE_IDS.reduce(
    (acc, id) => {
      acc[id] = { best: 0, difficulty: 0, bestScore: 0, runs: 0 };
      return acc;
    },
    {} as Record<XerathStageId, XerathStageRecord>,
  ),
  mastery: 0,
  peak: 0,
});

/** Repairs a progress object loaded from storage, whatever shape it is in. */
export const normalizeXerathProgress = (raw: Partial<XerathProgress> | undefined): XerathProgress => {
  const out = emptyXerathProgress();
  if (!raw) return out;
  for (const id of XERATH_STAGE_IDS) {
    const src = raw.stages?.[id];
    if (!src) continue;
    out.stages[id] = {
      best: clamp(asNumber(src.best), 0, 1),
      difficulty: clamp(asNumber(src.difficulty), 0, 1),
      bestScore: Math.max(0, asNumber(src.bestScore)),
      runs: Math.max(0, asNumber(src.runs)),
      habits: src.habits ?? undefined,
      onKeys: src.onKeys ?? undefined,
    };
  }
  out.mastery = computeXerathMastery(out);
  out.peak = Math.max(out.mastery, asNumber(raw.peak));
  return out;
};

export const xerStageValue = (rec: XerathStageRecord): number =>
  clamp(rec.best, 0, 1) * (0.55 + 0.45 * clamp(rec.difficulty, 0, 1));

export const computeXerathMastery = (p: XerathProgress): number => {
  let total = 0;
  for (const stage of XERATH_STAGES) total += xerStageValue(p.stages[stage.id]) * stage.weight;
  return clamp(total * 100, 0, 100);
};

export const xerStageStars = (stage: XerathStage, rec: XerathStageRecord): 0 | 1 | 2 | 3 => {
  if (rec.best >= 0.85) return 3;
  if (rec.best >= 0.72) return 2;
  if (rec.best >= stage.gate) return 1;
  return 0;
};

export const xerStageUnlocked = (p: XerathProgress, stage: XerathStage): boolean => {
  if (stage.step === 1) return true;
  const prev = XERATH_STAGES[stage.step - 2];
  return p.stages[prev.id].best >= prev.gate;
};

export const nextXerathStage = (p: XerathProgress): XerathStage => {
  for (const stage of XERATH_STAGES) {
    if (!xerStageUnlocked(p, stage)) return XERATH_STAGES[stage.step - 2];
    if (p.stages[stage.id].best < stage.gate) return stage;
  }
  return [...XERATH_STAGES].sort((a, b) => xerStageValue(p.stages[a.id]) - xerStageValue(p.stages[b.id]))[0];
};

export interface XerathTitle {
  name: string;
  at: number;
  blurb: string;
}

export const XERATH_TITLES: XerathTitle[] = [
  { name: 'APPRENTICE', at: 0, blurb: 'You hold Q until it is full, every time, and stand there slowed while you do.' },
  { name: 'ADEPT', at: 16, blurb: 'The pulse goes out when it reaches, and it reaches them.' },
  { name: 'SEER', at: 30, blurb: 'Your Eyes land on the centre, because you aimed where they were going.' },
  { name: 'STORMCALLER', at: 44, blurb: 'You stand in the band, and the orb goes out long.' },
  { name: 'SHURIMAN ARTILLERY', at: 58, blurb: 'Stun, then everything. Nothing you throw at a stunned body misses.' },
  { name: 'ARCANE ASCENDANT', at: 72, blurb: 'Divers sleep before they arrive, and the Rite finishes what runs.' },
  { name: 'MAGUS ASCENDANT', at: 88, blurb: 'The whole kit, from the whole distance, at a difficulty with nothing left to teach you.' },
];

export const xerTitleFor = (mastery: number): XerathTitle => {
  let out = XERATH_TITLES[0];
  for (const t of XERATH_TITLES) if (mastery >= t.at) out = t;
  return out;
};

export const nextXerathTitle = (mastery: number): XerathTitle | null =>
  XERATH_TITLES.find((t) => t.at > mastery) ?? null;

export interface XerathRunReport {
  stage: XerathStage;
  improved: boolean;
  previousBest: number;
  best: number;
  starsBefore: 0 | 1 | 2 | 3;
  starsAfter: 0 | 1 | 2 | 3;
  masteryBefore: number;
  masteryAfter: number;
  titleBefore: XerathTitle;
  titleAfter: XerathTitle;
  unlocked: XerathStage | null;
}

export const applyXerathRun = (
  p: XerathProgress,
  drill: DrillId,
  performance: number,
  difficulty: number,
  score: number,
  habits: Record<string, number> = {},
  onKeys = false,
): XerathRunReport | null => {
  if (!isXerathStage(drill)) return null;
  const stage = XERATH_STAGES[XERATH_STAGE_IDS.indexOf(drill)];
  const rec = p.stages[drill];
  const masteryBefore = p.mastery;
  const titleBefore = xerTitleFor(p.peak);
  const starsBefore = xerStageStars(stage, rec);
  const previousBest = rec.best;
  const clearedBefore = rec.best >= stage.gate;

  rec.runs += 1;
  rec.bestScore = Math.max(rec.bestScore, score);
  rec.habits = habits;
  rec.onKeys = onKeys;
  const improved = performance > rec.best;
  if (improved) {
    rec.best = clamp(performance, 0, 1);
    rec.difficulty = clamp(difficulty, 0, 1);
  }

  p.mastery = computeXerathMastery(p);
  p.peak = Math.max(p.peak, p.mastery);

  const nowCleared = rec.best >= stage.gate;
  const unlocked =
    !clearedBefore && nowCleared && stage.step < XERATH_STAGES.length ? XERATH_STAGES[stage.step] : null;

  return {
    stage,
    improved,
    previousBest,
    best: rec.best,
    starsBefore,
    starsAfter: xerStageStars(stage, rec),
    masteryBefore,
    masteryAfter: p.mastery,
    titleBefore,
    titleAfter: xerTitleFor(p.peak),
    unlocked,
  };
};

export const xerStageName = (id: XerathStageId): string => DRILLS[id].name;
