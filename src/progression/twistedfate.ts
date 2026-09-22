import { asNumber, clamp } from '../engine/math';
import { DRILLS, TWISTED_SEQUENCE, type DrillId } from '../drills/catalog';
import { TWISTED_DRILL_IDS, twistedStage, type TwistedDrillId } from '../drills/twistedfate';

/**
 * The Twisted Fate path's progression.
 *
 * Nine stages in a fixed order, each gated on the one before it, for the same
 * reason the other two champion paths are: you cannot be asked to hold a card
 * through an approach until you can take one off the wheel at all, and you
 * cannot be asked to use the stun until you can reliably buy one.
 *
 * Mastery is a claim about your ceiling, so it only ever moves when your best
 * run on a stage improves, and it is weighted by the difficulty that run was
 * played at — a flawless first stage on the lowest setting is a real thing and
 * it is worth about half of the same run at the top.
 */

export type TwistedStageId = TwistedDrillId;

export interface TwistedStage {
  id: TwistedStageId;
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

const PURPOSE: Record<TwistedStageId, { title: string; purpose: string }> = {
  tfPick: {
    title: 'The wheel',
    purpose: 'Three faces, half a second each, in the same order forever. Take the one you were asked for the first time it comes round.',
  },
  tfGold: {
    title: 'Gold',
    purpose: 'The card that stuns, and the attack that has to carry it to somebody who minds.',
  },
  tfWild: {
    title: 'The fan',
    purpose: 'Three cards, one press, and they go through people. Aim along the line, not at the body.',
  },
  tfDeck: {
    title: 'Count to four',
    purpose: 'Every fourth attack is worth three of the others, and it lands wherever you were already pointing.',
  },
  tfHold: {
    title: 'Loaded',
    purpose: 'A card waits forever. Lock it before you need it, and walk into contact already holding it.',
  },
  tfPressure: {
    title: 'The wheel, moving',
    purpose: 'The same choice with the floor going out from under you. Standing still is what made it easy.',
  },
  tfCombo: {
    title: 'The set-up',
    purpose: 'Gold, cards, attack — all of it inside the second and a half the stun bought you.',
  },
  tfGate: {
    title: 'The gate',
    purpose: 'A channel you have to survive, and a place on the far side of the floor worth arriving at.',
  },
  tfFight: {
    title: 'The fight',
    purpose: 'Choose, aim, count, hold and arrive — at the same time, against people trying to kill you.',
  },
};

/** Later stages ask for more, so they are worth more. */
const WEIGHT: Record<TwistedStage['phase'], number> = {
  LEARN: 0.6,
  ISOLATED: 0.85,
  COMBINED: 1,
  PRESSURE: 1.25,
  TRANSFER: 1.35,
  TEST: 1.9,
};

const rawWeights = TWISTED_DRILL_IDS.map((id) => WEIGHT[twistedStage(id).stage]);
const weightSum = rawWeights.reduce((a, b) => a + b, 0);

export const TWISTED_STAGES: TwistedStage[] = TWISTED_DRILL_IDS.map((id, i) => ({
  id,
  step: i + 1,
  phase: twistedStage(id).stage,
  title: PURPOSE[id].title,
  purpose: PURPOSE[id].purpose,
  // The gate rises along the path, but only a little: it is there to stop you
  // skipping a stage you cannot do, not to keep you on one you can.
  gate: 0.52 + i * 0.012,
  weight: rawWeights[i] / weightSum,
}));

export const TWISTED_STAGE_IDS: TwistedStageId[] = TWISTED_STAGES.map((s) => s.id);

export const isTwistedStage = (id: DrillId): id is TwistedStageId =>
  (TWISTED_SEQUENCE as DrillId[]).includes(id);

export interface TwistedStageRecord {
  best: number;
  difficulty: number;
  bestScore: number;
  runs: number;
  /** The most recent run's headline numbers, keyed by metric id. */
  habits?: Record<string, number>;
  onKeys?: boolean;
}

export interface TwistedProgress {
  stages: Record<TwistedStageId, TwistedStageRecord>;
  mastery: number;
  peak: number;
}

export const emptyTwistedProgress = (): TwistedProgress => ({
  stages: TWISTED_STAGE_IDS.reduce(
    (acc, id) => {
      acc[id] = { best: 0, difficulty: 0, bestScore: 0, runs: 0 };
      return acc;
    },
    {} as Record<TwistedStageId, TwistedStageRecord>,
  ),
  mastery: 0,
  peak: 0,
});

/** Repairs a progress object loaded from storage, whatever shape it is in. */
export const normalizeTwistedProgress = (raw: Partial<TwistedProgress> | undefined): TwistedProgress => {
  const out = emptyTwistedProgress();
  if (!raw) return out;
  for (const id of TWISTED_STAGE_IDS) {
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
  out.mastery = computeTwistedMastery(out);
  out.peak = Math.max(out.mastery, asNumber(raw.peak));
  return out;
};

export const tfStageValue = (rec: TwistedStageRecord): number =>
  clamp(rec.best, 0, 1) * (0.55 + 0.45 * clamp(rec.difficulty, 0, 1));

export const computeTwistedMastery = (p: TwistedProgress): number => {
  let total = 0;
  for (const stage of TWISTED_STAGES) total += tfStageValue(p.stages[stage.id]) * stage.weight;
  return clamp(total * 100, 0, 100);
};

export const tfStageStars = (stage: TwistedStage, rec: TwistedStageRecord): 0 | 1 | 2 | 3 => {
  if (rec.best >= 0.85) return 3;
  if (rec.best >= 0.72) return 2;
  if (rec.best >= stage.gate) return 1;
  return 0;
};

export const tfStageUnlocked = (p: TwistedProgress, stage: TwistedStage): boolean => {
  if (stage.step === 1) return true;
  const prev = TWISTED_STAGES[stage.step - 2];
  return p.stages[prev.id].best >= prev.gate;
};

export const nextTwistedStage = (p: TwistedProgress): TwistedStage => {
  for (const stage of TWISTED_STAGES) {
    if (!tfStageUnlocked(p, stage)) return TWISTED_STAGES[stage.step - 2];
    if (p.stages[stage.id].best < stage.gate) return stage;
  }
  return [...TWISTED_STAGES].sort((a, b) => tfStageValue(p.stages[a.id]) - tfStageValue(p.stages[b.id]))[0];
};

export interface TwistedTitle {
  name: string;
  at: number;
  blurb: string;
}

export const TWISTED_TITLES: TwistedTitle[] = [
  { name: 'MARK', at: 0, blurb: 'You are the one being dealt to. Nothing on the table is yours yet.' },
  { name: 'DEALER', at: 16, blurb: 'The wheel stops where you meant it to, most of the time.' },
  { name: 'SHARP', at: 30, blurb: 'Gold arrives the first time it comes round, and it arrives on somebody who minds.' },
  { name: 'MECHANIC', at: 44, blurb: 'You are counting to four without looking, and the fourth one lands where it pays.' },
  { name: 'GRIFTER', at: 58, blurb: 'The card is on your hand before the fight is. That is the whole trick.' },
  { name: 'HIGH ROLLER', at: 72, blurb: 'A stun is a sentence you finish, not a thing that happens to somebody.' },
  { name: 'CARD MASTER', at: 88, blurb: 'Choose, aim, count, hold and arrive — all of it, at once, at a difficulty with nothing left to teach you.' },
];

export const tfTitleFor = (mastery: number): TwistedTitle => {
  let out = TWISTED_TITLES[0];
  for (const t of TWISTED_TITLES) if (mastery >= t.at) out = t;
  return out;
};

export const nextTwistedTitle = (mastery: number): TwistedTitle | null =>
  TWISTED_TITLES.find((t) => t.at > mastery) ?? null;

export interface TwistedRunReport {
  stage: TwistedStage;
  improved: boolean;
  previousBest: number;
  best: number;
  starsBefore: 0 | 1 | 2 | 3;
  starsAfter: 0 | 1 | 2 | 3;
  masteryBefore: number;
  masteryAfter: number;
  titleBefore: TwistedTitle;
  titleAfter: TwistedTitle;
  unlocked: TwistedStage | null;
}

export const applyTwistedRun = (
  p: TwistedProgress,
  drill: DrillId,
  performance: number,
  difficulty: number,
  score: number,
  habits: Record<string, number> = {},
  onKeys = false,
): TwistedRunReport | null => {
  if (!isTwistedStage(drill)) return null;
  const stage = TWISTED_STAGES[TWISTED_STAGE_IDS.indexOf(drill)];
  const rec = p.stages[drill];
  const masteryBefore = p.mastery;
  const titleBefore = tfTitleFor(p.peak);
  const starsBefore = tfStageStars(stage, rec);
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

  p.mastery = computeTwistedMastery(p);
  p.peak = Math.max(p.peak, p.mastery);

  const nowCleared = rec.best >= stage.gate;
  const unlocked =
    !clearedBefore && nowCleared && stage.step < TWISTED_STAGES.length ? TWISTED_STAGES[stage.step] : null;

  return {
    stage,
    improved,
    previousBest,
    best: rec.best,
    starsBefore,
    starsAfter: tfStageStars(stage, rec),
    masteryBefore,
    masteryAfter: p.mastery,
    titleBefore,
    titleAfter: tfTitleFor(p.peak),
    unlocked,
  };
};

export const tfStageName = (id: TwistedStageId): string => DRILLS[id].name;
