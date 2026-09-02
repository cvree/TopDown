import { clamp } from '../engine/math';
import { DRILLS, VAYNE_SEQUENCE, type DrillId } from '../drills/catalog';

/**
 * The Vayne path.
 *
 * The trainer's ladder rates nine general axes and does not care which
 * champion you play. This is the other thing: an ordered course through one
 * champion, gated so you cannot skip the part you are bad at, and a mastery
 * number that only moves when your *best* run on a stage improves — so it is a
 * record of what you can do, not of how long you sat here.
 *
 * Difficulty is baked into mastery on purpose. A flawless Tumble run at the
 * lowest setting is a real achievement and it is worth about half of the same
 * run at the top, because the whole claim of the final title is that nothing
 * in the drill can still surprise you.
 */

export type VayneStageId = 'vayneTumble' | 'vayneBolts' | 'vayneCondemn' | 'vayneHunt';

export interface VayneStage {
  id: VayneStageId;
  /** Position in the course, from 1. */
  step: number;
  title: string;
  /** What this stage is for, in one line. */
  purpose: string;
  /** Performance needed to unlock the next stage. */
  gate: number;
  /** Share of total mastery this stage carries. */
  weight: number;
}

export const VAYNE_STAGES: VayneStage[] = [
  {
    id: 'vayneTumble',
    step: 1,
    title: 'The rhythm',
    purpose: 'Q in the backswing, every time it is up, without ever throwing an attack away.',
    gate: 0.55,
    weight: 0.22,
  },
  {
    id: 'vayneBolts',
    step: 2,
    title: 'The third hit',
    purpose: 'Finish every stack. Switching at two is the mistake that defines a bad Vayne.',
    gate: 0.58,
    weight: 0.22,
  },
  {
    id: 'vayneCondemn',
    step: 3,
    title: 'The wall',
    purpose: 'Stand so terrain is behind them before the fight, then turn a knockback into a stun.',
    gate: 0.58,
    weight: 0.22,
  },
  {
    id: 'vayneHunt',
    step: 4,
    title: 'The hunt',
    purpose: 'All of it at once, against two opponents who are trying to kill you.',
    gate: 0.6,
    weight: 0.34,
  },
];

export const VAYNE_STAGE_IDS: VayneStageId[] = VAYNE_STAGES.map((s) => s.id);

export const isVayneStage = (id: DrillId): id is VayneStageId =>
  (VAYNE_SEQUENCE as DrillId[]).includes(id);

export interface VayneStageRecord {
  /** Best performance ever recorded on this stage, 0..1. */
  best: number;
  /** The difficulty that best run was played at. */
  difficulty: number;
  bestScore: number;
  runs: number;
}

export interface VayneProgress {
  stages: Record<VayneStageId, VayneStageRecord>;
  /** 0..100. Derived, stored only so the client can render it without maths. */
  mastery: number;
  /** Highest mastery ever held, so a bad run never takes a title away. */
  peak: number;
}

export const emptyVayneProgress = (): VayneProgress => ({
  stages: VAYNE_STAGE_IDS.reduce(
    (acc, id) => {
      acc[id] = { best: 0, difficulty: 0, bestScore: 0, runs: 0 };
      return acc;
    },
    {} as Record<VayneStageId, VayneStageRecord>,
  ),
  mastery: 0,
  peak: 0,
});

/** How much a stage's best run is worth, difficulty included. */
export const stageValue = (rec: VayneStageRecord): number =>
  clamp(rec.best, 0, 1) * (0.55 + 0.45 * clamp(rec.difficulty, 0, 1));

export const computeMastery = (p: VayneProgress): number => {
  let total = 0;
  for (const stage of VAYNE_STAGES) total += stageValue(p.stages[stage.id]) * stage.weight;
  return clamp(total * 100, 0, 100);
};

/** Stars for a stage: the gate, then two harder marks above it. */
export const stageStars = (stage: VayneStage, rec: VayneStageRecord): 0 | 1 | 2 | 3 => {
  if (rec.best >= 0.85) return 3;
  if (rec.best >= 0.72) return 2;
  if (rec.best >= stage.gate) return 1;
  return 0;
};

/** A stage is playable once the one before it has been cleared. */
export const stageUnlocked = (p: VayneProgress, stage: VayneStage): boolean => {
  if (stage.step === 1) return true;
  const prev = VAYNE_STAGES[stage.step - 2];
  return p.stages[prev.id].best >= prev.gate;
};

export const nextVayneStage = (p: VayneProgress): VayneStage => {
  for (const stage of VAYNE_STAGES) {
    if (!stageUnlocked(p, stage)) return VAYNE_STAGES[stage.step - 2];
    if (p.stages[stage.id].best < stage.gate) return stage;
  }
  // Everything cleared: the one with the most room left is the one to run.
  return [...VAYNE_STAGES].sort((a, b) => stageValue(p.stages[a.id]) - stageValue(p.stages[b.id]))[0];
};

export interface VayneTitle {
  name: string;
  /** Mastery at which it is earned. */
  at: number;
  blurb: string;
}

/**
 * The ladder.
 *
 * The last rung is deliberately hard to reach and deliberately honest about
 * what it means: it is a claim about these drills, at their top difficulty,
 * and it says so on the screen that awards it.
 */
export const VAYNE_TITLES: VayneTitle[] = [
  { name: 'RECRUIT', at: 0, blurb: 'You have picked her up. That is the whole of it so far.' },
  { name: 'TUMBLER', at: 18, blurb: 'The Q is starting to land in the backswing rather than through the attack.' },
  { name: 'SILVER BOLTED', at: 34, blurb: 'You finish stacks. Tanks have started to matter less.' },
  { name: 'WALL ARTIST', at: 50, blurb: 'You choose where you stand before the fight arrives.' },
  { name: 'FINAL HOUR', at: 64, blurb: 'The kit is one motion now, not four buttons.' },
  { name: 'NIGHT HUNTER', at: 78, blurb: 'Two opponents and terrain, and it goes your way.' },
  { name: 'THE GREATEST VAYNE', at: 92, blurb: 'Every stage at three stars, at a difficulty with nothing left to teach you.' },
];

export const titleFor = (mastery: number): VayneTitle => {
  let out = VAYNE_TITLES[0];
  for (const t of VAYNE_TITLES) if (mastery >= t.at) out = t;
  return out;
};

export const nextTitle = (mastery: number): VayneTitle | null =>
  VAYNE_TITLES.find((t) => t.at > mastery) ?? null;

/**
 * Records a run. Returns what changed, so the client can say so out loud.
 *
 * Only an improvement on your best moves anything. A worse run is still a run
 * — it counts toward the run tally and it still feeds the general ladder —
 * but it cannot take mastery away, because mastery is a statement about your
 * ceiling and your ceiling did not fall.
 */
export interface VayneRunReport {
  stage: VayneStage;
  improved: boolean;
  previousBest: number;
  best: number;
  starsBefore: 0 | 1 | 2 | 3;
  starsAfter: 0 | 1 | 2 | 3;
  masteryBefore: number;
  masteryAfter: number;
  titleBefore: VayneTitle;
  titleAfter: VayneTitle;
  /** The stage this run unlocked, if any. */
  unlocked: VayneStage | null;
}

export const applyVayneRun = (
  p: VayneProgress,
  drill: DrillId,
  performance: number,
  difficulty: number,
  score: number,
): VayneRunReport | null => {
  if (!isVayneStage(drill)) return null;
  const stage = VAYNE_STAGES[VAYNE_STAGE_IDS.indexOf(drill)];
  const rec = p.stages[drill];
  const masteryBefore = p.mastery;
  const titleBefore = titleFor(p.peak);
  const starsBefore = stageStars(stage, rec);
  const previousBest = rec.best;
  const clearedBefore = rec.best >= stage.gate;

  rec.runs += 1;
  rec.bestScore = Math.max(rec.bestScore, score);
  const improved = performance > rec.best;
  if (improved) {
    rec.best = clamp(performance, 0, 1);
    rec.difficulty = clamp(difficulty, 0, 1);
  }

  p.mastery = computeMastery(p);
  p.peak = Math.max(p.peak, p.mastery);

  const nowCleared = rec.best >= stage.gate;
  const unlocked =
    !clearedBefore && nowCleared && stage.step < VAYNE_STAGES.length ? VAYNE_STAGES[stage.step] : null;

  return {
    stage,
    improved,
    previousBest,
    best: rec.best,
    starsBefore,
    starsAfter: stageStars(stage, rec),
    masteryBefore,
    masteryAfter: p.mastery,
    titleBefore,
    titleAfter: titleFor(p.peak),
    unlocked,
  };
};

/** The name of the drill behind a stage, for the client. */
export const stageName = (id: VayneStageId): string => DRILLS[id].name;
