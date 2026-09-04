import { clamp } from '../engine/math';
import { DRILLS, EZREAL_SEQUENCE, type DrillId } from '../drills/catalog';
import { EZREAL_DRILL_IDS, ezrealStage, type EzrealDrillId } from '../drills/ezreal';

/**
 * The Ezreal path's progression.
 *
 * Ten stages in a fixed order, each gated on the one before it, so nothing
 * stays permanently isolated: you cannot reach the stage where a hunter is on
 * you until you can land the shot with nothing on you, and you cannot reach
 * the fight until you can do all six of the pieces it is made of.
 *
 * Mastery is a claim about your ceiling, so it only ever moves when your best
 * run on a stage improves, and it is weighted by the difficulty that run was
 * played at — a flawless first stage on the lowest setting is a real thing and
 * it is worth about half of the same run at the top.
 */

export type EzrealStageId = EzrealDrillId;

export interface EzrealStage {
  id: EzrealStageId;
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

const PURPOSE: Record<EzrealStageId, { title: string; purpose: string }> = {
  ezQ: { title: 'The missile', purpose: 'Learn its travel time and its width against something that is not going anywhere.' },
  ezLead: { title: 'The lead', purpose: 'Aim at the arrival rather than the departure.' },
  ezStrafe: { title: 'Both feet busy', purpose: 'Land it while the keys are doing something else. Standing still stops counting here.' },
  ezThread: { title: 'The gap', purpose: 'Do not feed the cooldown to a minion. Find the lane and use it before it shuts.' },
  ezWeave: { title: 'The weave', purpose: 'Q out of the backswing. The missile goes between your attacks, not instead of them.' },
  ezMaxRange: { title: 'The outer quarter', purpose: 'Poke from where nothing can answer, and stay there.' },
  ezKite: { title: 'Under pressure', purpose: 'Keep the cycle, the distance and the aim while something is coming for you.' },
  ezShift: { title: 'The blink', purpose: 'Out of their reach and still inside your own. Sideways, not backwards.' },
  ezSwitch: { title: 'The transfer', purpose: 'Move the missile onto the target that matters, before it changes again.' },
  ezFight: { title: 'The fight', purpose: 'Move, aim, attack, dodge and decide — at the same time, against people trying to kill you.' },
};

/** Later stages ask for more, so they are worth more. */
const WEIGHT: Record<EzrealStage['phase'], number> = {
  LEARN: 0.6,
  ISOLATED: 0.85,
  COMBINED: 1,
  PRESSURE: 1.25,
  TRANSFER: 1.35,
  TEST: 1.9,
};

const rawWeights = EZREAL_DRILL_IDS.map((id) => WEIGHT[ezrealStage(id).stage]);
const weightSum = rawWeights.reduce((a, b) => a + b, 0);

export const EZREAL_STAGES: EzrealStage[] = EZREAL_DRILL_IDS.map((id, i) => ({
  id,
  step: i + 1,
  phase: ezrealStage(id).stage,
  title: PURPOSE[id].title,
  purpose: PURPOSE[id].purpose,
  // The gate rises along the path, but only a little: it is there to stop you
  // skipping a stage you cannot do, not to keep you on one you can.
  gate: 0.52 + i * 0.012,
  weight: rawWeights[i] / weightSum,
}));

export const EZREAL_STAGE_IDS: EzrealStageId[] = EZREAL_STAGES.map((s) => s.id);

export const isEzrealStage = (id: DrillId): id is EzrealStageId =>
  (EZREAL_SEQUENCE as DrillId[]).includes(id);

export interface EzrealStageRecord {
  best: number;
  difficulty: number;
  bestScore: number;
  runs: number;
  /** The most recent run's headline numbers, keyed by metric id. */
  habits?: Record<string, number>;
  onKeys?: boolean;
}

export interface EzrealProgress {
  stages: Record<EzrealStageId, EzrealStageRecord>;
  mastery: number;
  peak: number;
}

export const emptyEzrealProgress = (): EzrealProgress => ({
  stages: EZREAL_STAGE_IDS.reduce(
    (acc, id) => {
      acc[id] = { best: 0, difficulty: 0, bestScore: 0, runs: 0 };
      return acc;
    },
    {} as Record<EzrealStageId, EzrealStageRecord>,
  ),
  mastery: 0,
  peak: 0,
});

/** Repairs a progress object loaded from storage, whatever shape it is in. */
export const normalizeEzrealProgress = (raw: Partial<EzrealProgress> | undefined): EzrealProgress => {
  const out = emptyEzrealProgress();
  if (!raw) return out;
  for (const id of EZREAL_STAGE_IDS) {
    const src = raw.stages?.[id];
    if (!src) continue;
    out.stages[id] = {
      best: clamp(src.best ?? 0, 0, 1),
      difficulty: clamp(src.difficulty ?? 0, 0, 1),
      bestScore: Math.max(0, src.bestScore ?? 0),
      runs: Math.max(0, src.runs ?? 0),
      habits: src.habits ?? undefined,
      onKeys: src.onKeys ?? undefined,
    };
  }
  out.mastery = computeEzrealMastery(out);
  out.peak = Math.max(out.mastery, raw.peak ?? 0);
  return out;
};

export const ezStageValue = (rec: EzrealStageRecord): number =>
  clamp(rec.best, 0, 1) * (0.55 + 0.45 * clamp(rec.difficulty, 0, 1));

export const computeEzrealMastery = (p: EzrealProgress): number => {
  let total = 0;
  for (const stage of EZREAL_STAGES) total += ezStageValue(p.stages[stage.id]) * stage.weight;
  return clamp(total * 100, 0, 100);
};

export const ezStageStars = (stage: EzrealStage, rec: EzrealStageRecord): 0 | 1 | 2 | 3 => {
  if (rec.best >= 0.85) return 3;
  if (rec.best >= 0.72) return 2;
  if (rec.best >= stage.gate) return 1;
  return 0;
};

export const ezStageUnlocked = (p: EzrealProgress, stage: EzrealStage): boolean => {
  if (stage.step === 1) return true;
  const prev = EZREAL_STAGES[stage.step - 2];
  return p.stages[prev.id].best >= prev.gate;
};

export const nextEzrealStage = (p: EzrealProgress): EzrealStage => {
  for (const stage of EZREAL_STAGES) {
    if (!ezStageUnlocked(p, stage)) return EZREAL_STAGES[stage.step - 2];
    if (p.stages[stage.id].best < stage.gate) return stage;
  }
  return [...EZREAL_STAGES].sort((a, b) => ezStageValue(p.stages[a.id]) - ezStageValue(p.stages[b.id]))[0];
};

export interface EzrealTitle {
  name: string;
  at: number;
  blurb: string;
}

export const EZREAL_TITLES: EzrealTitle[] = [
  { name: 'TOURIST', at: 0, blurb: 'You have the map out. Nothing on it is walked yet.' },
  { name: 'SHARPSHOOTER', at: 16, blurb: 'The missile lands on things that are not standing still.' },
  { name: 'STRAFER', at: 30, blurb: 'You have stopped planting your feet to aim.' },
  { name: 'THREADER', at: 44, blurb: 'Waves are something you shoot through rather than into.' },
  { name: 'WEAVER', at: 58, blurb: 'The Q is inside the attack cycle now, not in place of it.' },
  { name: 'ARCANIST', at: 72, blurb: 'The blink is repositioning. You have stopped using it to be frightened.' },
  { name: 'PRODIGAL EXPLORER', at: 88, blurb: 'Move, aim, attack, dodge and decide — all of it, at once, at a difficulty with nothing left to teach you.' },
];

export const ezTitleFor = (mastery: number): EzrealTitle => {
  let out = EZREAL_TITLES[0];
  for (const t of EZREAL_TITLES) if (mastery >= t.at) out = t;
  return out;
};

export const nextEzrealTitle = (mastery: number): EzrealTitle | null =>
  EZREAL_TITLES.find((t) => t.at > mastery) ?? null;

export interface EzrealRunReport {
  stage: EzrealStage;
  improved: boolean;
  previousBest: number;
  best: number;
  starsBefore: 0 | 1 | 2 | 3;
  starsAfter: 0 | 1 | 2 | 3;
  masteryBefore: number;
  masteryAfter: number;
  titleBefore: EzrealTitle;
  titleAfter: EzrealTitle;
  unlocked: EzrealStage | null;
}

export const applyEzrealRun = (
  p: EzrealProgress,
  drill: DrillId,
  performance: number,
  difficulty: number,
  score: number,
  habits: Record<string, number> = {},
  onKeys = false,
): EzrealRunReport | null => {
  if (!isEzrealStage(drill)) return null;
  const stage = EZREAL_STAGES[EZREAL_STAGE_IDS.indexOf(drill)];
  const rec = p.stages[drill];
  const masteryBefore = p.mastery;
  const titleBefore = ezTitleFor(p.peak);
  const starsBefore = ezStageStars(stage, rec);
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

  p.mastery = computeEzrealMastery(p);
  p.peak = Math.max(p.peak, p.mastery);

  const nowCleared = rec.best >= stage.gate;
  const unlocked =
    !clearedBefore && nowCleared && stage.step < EZREAL_STAGES.length ? EZREAL_STAGES[stage.step] : null;

  return {
    stage,
    improved,
    previousBest,
    best: rec.best,
    starsBefore,
    starsAfter: ezStageStars(stage, rec),
    masteryBefore,
    masteryAfter: p.mastery,
    titleBefore,
    titleAfter: ezTitleFor(p.peak),
    unlocked,
  };
};

export const ezStageName = (id: EzrealStageId): string => DRILLS[id].name;
