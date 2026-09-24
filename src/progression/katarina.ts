import { asNumber, clamp } from '../engine/math';
import { DRILLS, KATARINA_SEQUENCE, type DrillId } from '../drills/catalog';
import { KATARINA_DRILL_IDS, katarinaStage, type KatarinaDrillId } from '../drills/katarina';

/**
 * The Katarina path's progression.
 *
 * Nine stages in a fixed order, each gated on the one before it, for the same
 * reason the other champion paths are: you cannot be asked to meet a blade's
 * dagger until you can meet one dropped at your own feet, and you cannot be
 * asked to join a fight at the right moment until a reset is something your
 * hands already do.
 *
 * Mastery is a claim about your ceiling, so it only ever moves when your best
 * run on a stage improves, and it is weighted by the difficulty that run was
 * played at — a flawless first stage on the lowest setting is a real thing and
 * it is worth about half of the same run at the top.
 */

export type KatarinaStageId = KatarinaDrillId;

export interface KatarinaStage {
  id: KatarinaStageId;
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

const PURPOSE: Record<KatarinaStageId, { title: string; purpose: string }> = {
  katPrep: {
    title: 'The dagger',
    purpose: 'It goes up where you stand and comes down a second and a quarter later. Be on it, with somebody inside the slash.',
  },
  katBlade: {
    title: 'The blade',
    purpose: 'It lands behind the first thing it hits. Throw at what is in front of them and it lands on them.',
  },
  katShunpo: {
    title: 'The blink',
    purpose: 'Shunpo onto a dagger and it takes it — and taking it hands the blink back. Run the floor on one cooldown.',
  },
  katBlink: {
    title: 'Blade, then blink',
    purpose: 'Throw it, then be there the instant it lands. Early is nothing to land on; late is nobody in the slash.',
  },
  katDance: {
    title: 'The dance',
    purpose: 'In, drop, take — and do not let the haste carry you away from your own dagger.',
  },
  katReset: {
    title: 'The reset',
    purpose: 'A kill is a cooldown. Arrive at the next one with every button back.',
  },
  katLotus: {
    title: 'The lotus',
    purpose: 'Spin when they are all inside, and do not move. Leave by blinking, never by walking.',
  },
  katEntry: {
    title: 'The entry',
    purpose: 'A fight is already happening. Join it when it is ready to be finished, not when you are ready to start it.',
  },
  katFight: {
    title: 'The spin',
    purpose: 'Throw, drop, blink, take, spin and reset — at the same time, against people trying to kill you.',
  },
};

/** Later stages ask for more, so they are worth more. */
const WEIGHT: Record<KatarinaStage['phase'], number> = {
  LEARN: 0.6,
  ISOLATED: 0.85,
  COMBINED: 1,
  PRESSURE: 1.25,
  TRANSFER: 1.35,
  TEST: 1.9,
};

const rawWeights = KATARINA_DRILL_IDS.map((id) => WEIGHT[katarinaStage(id).stage]);
const weightSum = rawWeights.reduce((a, b) => a + b, 0);

export const KATARINA_STAGES: KatarinaStage[] = KATARINA_DRILL_IDS.map((id, i) => ({
  id,
  step: i + 1,
  phase: katarinaStage(id).stage,
  title: PURPOSE[id].title,
  purpose: PURPOSE[id].purpose,
  // The gate rises along the path, but only a little: it is there to stop you
  // skipping a stage you cannot do, not to keep you on one you can.
  gate: 0.52 + i * 0.012,
  weight: rawWeights[i] / weightSum,
}));

export const KATARINA_STAGE_IDS: KatarinaStageId[] = KATARINA_STAGES.map((s) => s.id);

export const isKatarinaStage = (id: DrillId): id is KatarinaStageId =>
  (KATARINA_SEQUENCE as DrillId[]).includes(id);

export interface KatarinaStageRecord {
  best: number;
  difficulty: number;
  bestScore: number;
  runs: number;
  /** The most recent run's headline numbers, keyed by metric id. */
  habits?: Record<string, number>;
  onKeys?: boolean;
}

export interface KatarinaProgress {
  stages: Record<KatarinaStageId, KatarinaStageRecord>;
  mastery: number;
  peak: number;
}

export const emptyKatarinaProgress = (): KatarinaProgress => ({
  stages: KATARINA_STAGE_IDS.reduce(
    (acc, id) => {
      acc[id] = { best: 0, difficulty: 0, bestScore: 0, runs: 0 };
      return acc;
    },
    {} as Record<KatarinaStageId, KatarinaStageRecord>,
  ),
  mastery: 0,
  peak: 0,
});

/** Repairs a progress object loaded from storage, whatever shape it is in. */
export const normalizeKatarinaProgress = (raw: Partial<KatarinaProgress> | undefined): KatarinaProgress => {
  const out = emptyKatarinaProgress();
  if (!raw) return out;
  for (const id of KATARINA_STAGE_IDS) {
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
  out.mastery = computeKatarinaMastery(out);
  out.peak = Math.max(out.mastery, asNumber(raw.peak));
  return out;
};

export const katStageValue = (rec: KatarinaStageRecord): number =>
  clamp(rec.best, 0, 1) * (0.55 + 0.45 * clamp(rec.difficulty, 0, 1));

export const computeKatarinaMastery = (p: KatarinaProgress): number => {
  let total = 0;
  for (const stage of KATARINA_STAGES) total += katStageValue(p.stages[stage.id]) * stage.weight;
  return clamp(total * 100, 0, 100);
};

export const katStageStars = (stage: KatarinaStage, rec: KatarinaStageRecord): 0 | 1 | 2 | 3 => {
  if (rec.best >= 0.85) return 3;
  if (rec.best >= 0.72) return 2;
  if (rec.best >= stage.gate) return 1;
  return 0;
};

export const katStageUnlocked = (p: KatarinaProgress, stage: KatarinaStage): boolean => {
  if (stage.step === 1) return true;
  const prev = KATARINA_STAGES[stage.step - 2];
  return p.stages[prev.id].best >= prev.gate;
};

export const nextKatarinaStage = (p: KatarinaProgress): KatarinaStage => {
  for (const stage of KATARINA_STAGES) {
    if (!katStageUnlocked(p, stage)) return KATARINA_STAGES[stage.step - 2];
    if (p.stages[stage.id].best < stage.gate) return stage;
  }
  return [...KATARINA_STAGES].sort((a, b) => katStageValue(p.stages[a.id]) - katStageValue(p.stages[b.id]))[0];
};

export interface KatarinaTitle {
  name: string;
  at: number;
  blurb: string;
}

export const KATARINA_TITLES: KatarinaTitle[] = [
  { name: 'RECRUIT', at: 0, blurb: 'You throw daggers. The floor keeps most of them.' },
  { name: 'CUTTHROAT', at: 16, blurb: 'You are standing where it lands, more often than not.' },
  { name: 'KNIFE', at: 30, blurb: 'The blade comes down on somebody, because you chose who it bounced off.' },
  { name: 'SHADOWSTEP', at: 44, blurb: 'Shunpo comes back as fast as you spend it. The route was the plan.' },
  { name: 'EXECUTIONER', at: 58, blurb: 'A kill is a cooldown, and you arrive at the next one with the kit up.' },
  { name: 'DU COUTEAU', at: 72, blurb: 'You wait for the fight, and then you finish it.' },
  { name: 'SINISTER BLADE', at: 88, blurb: 'Throw, drop, blink, take, spin and reset — all of it, at once, at a difficulty with nothing left to teach you.' },
];

export const katTitleFor = (mastery: number): KatarinaTitle => {
  let out = KATARINA_TITLES[0];
  for (const t of KATARINA_TITLES) if (mastery >= t.at) out = t;
  return out;
};

export const nextKatarinaTitle = (mastery: number): KatarinaTitle | null =>
  KATARINA_TITLES.find((t) => t.at > mastery) ?? null;

export interface KatarinaRunReport {
  stage: KatarinaStage;
  improved: boolean;
  previousBest: number;
  best: number;
  starsBefore: 0 | 1 | 2 | 3;
  starsAfter: 0 | 1 | 2 | 3;
  masteryBefore: number;
  masteryAfter: number;
  titleBefore: KatarinaTitle;
  titleAfter: KatarinaTitle;
  unlocked: KatarinaStage | null;
}

export const applyKatarinaRun = (
  p: KatarinaProgress,
  drill: DrillId,
  performance: number,
  difficulty: number,
  score: number,
  habits: Record<string, number> = {},
  onKeys = false,
): KatarinaRunReport | null => {
  if (!isKatarinaStage(drill)) return null;
  const stage = KATARINA_STAGES[KATARINA_STAGE_IDS.indexOf(drill)];
  const rec = p.stages[drill];
  const masteryBefore = p.mastery;
  const titleBefore = katTitleFor(p.peak);
  const starsBefore = katStageStars(stage, rec);
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

  p.mastery = computeKatarinaMastery(p);
  p.peak = Math.max(p.peak, p.mastery);

  const nowCleared = rec.best >= stage.gate;
  const unlocked =
    !clearedBefore && nowCleared && stage.step < KATARINA_STAGES.length ? KATARINA_STAGES[stage.step] : null;

  return {
    stage,
    improved,
    previousBest,
    best: rec.best,
    starsBefore,
    starsAfter: katStageStars(stage, rec),
    masteryBefore,
    masteryAfter: p.mastery,
    titleBefore,
    titleAfter: katTitleFor(p.peak),
    unlocked,
  };
};

export const katStageName = (id: KatarinaStageId): string => DRILLS[id].name;
