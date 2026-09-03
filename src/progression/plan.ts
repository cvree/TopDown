/**
 * The session planner.
 *
 * A day's training is not five drills chosen because they are always the same
 * five. It is a shape: warm the hands, attack the thing that is actually
 * wrong, support it with a second skill, put both into context, then test
 * whether any of it survives an opponent.
 *
 * The plan is fixed once per day. It has to be — a plan that reshuffles
 * between two drills is not a plan, and the numbers either side of it stop
 * being comparable.
 */

import { DRILLS, DRILL_LIST, drillsForAxis, pressureOf, type DrillId } from '../drills/catalog';
import { isApmDrill } from './apm';
import { recommend } from './coach';
import { isVayneStage, stageUnlocked, VAYNE_STAGES } from './vayne';
import { AXIS_LABEL, SKILL_AXES, type SkillAxis } from './skills';
import type { Profile } from './profile';

export type BlockRole = 'WARMUP' | 'PRIMARY' | 'SECONDARY' | 'COMBINED' | 'TRANSFER';

export interface SessionBlock {
  role: BlockRole;
  drill: DrillId;
  /** What this block is for, in two words. */
  label: string;
  /** Why this drill is in this slot today. */
  why: string;
  /** Planned length, seconds. Open-ended drills are estimated. */
  seconds: number;
}

export interface SessionPlan {
  /** The day it was drawn up for. */
  date: string;
  /** The session's purpose, in title case. */
  focus: string;
  /** One line under the title. */
  subtitle: string;
  blocks: SessionBlock[];
  minutes: number;
}

/** What a session aimed at each axis is called. */
const FOCUS_NAME: Record<SkillAxis, string> = {
  movement: 'Pathing Precision',
  aim: 'Command Precision',
  skillshot: 'Prediction & Leading',
  dodging: 'Threat Reading',
  kiting: 'Orbwalk Discipline',
  spacing: 'Range Discipline',
  targeting: 'Target Priority',
  combat: 'Live Combat',
  lastHitting: 'Lane Economy',
  tempo: 'Hand Speed',
};

/** An open-ended drill still costs time; this is what to budget for one. */
const PLANNED_SECONDS = (id: DrillId): number => (DRILLS[id].duration > 0 ? DRILLS[id].duration : 100);

const playable = (p: Profile, id: DrillId): boolean => {
  if (!isVayneStage(id)) return true;
  const stage = VAYNE_STAGES.find((s) => s.id === id);
  return stage ? stageUnlocked(p.vayne, stage) : true;
};

const primaryAxis = (id: DrillId): SkillAxis =>
  (Object.entries(DRILLS[id].axes).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? 'movement') as SkillAxis;

/**
 * Draws up today's session.
 *
 * Deterministic given a profile: the same profile on the same day produces
 * the same plan, which is what lets it be stored as a list of drills and
 * re-read all day without drifting.
 */
export const planSession = (p: Profile): SessionPlan => {
  const recs = recommend(p, 4);
  const used = new Set<DrillId>();
  const blocks: SessionBlock[] = [];

  const take = (role: BlockRole, drill: DrillId, label: string, why: string) => {
    if (used.has(drill)) return false;
    used.add(drill);
    blocks.push({ role, drill, label, why, seconds: PLANNED_SECONDS(drill) });
    return true;
  };

  // ---- warmup. A foundation drill on something you are already good at, so
  // the session opens with the hands working rather than with a diagnosis.
  const rated = SKILL_AXES.filter((a) => p.samples[a] > 0);
  const strong = rated.length ? rated.reduce((a, b) => (p.ratings[a] >= p.ratings[b] ? a : b)) : null;
  const warmCandidates = DRILL_LIST.filter(
    (d) => pressureOf(d.id) === 'isolated' && !isApmDrill(d.id) && d.duration > 0 && playable(p, d.id),
  );
  const warm =
    (strong && warmCandidates.find((d) => d.axes[strong] !== undefined)) ?? warmCandidates[0] ?? DRILL_LIST[0];
  take(
    'WARMUP',
    warm.id,
    'Warmup',
    strong
      ? `Opens on ${AXIS_LABEL[strong].toLowerCase()}, your strongest axis — hands first, diagnosis second.`
      : 'A short, clean opener before anything is measured seriously.',
  );

  // ---- the primary. Whatever the coach says is most wrong today.
  const first = recs[0];
  if (first && !used.has(first.drill)) {
    take('PRIMARY', first.drill, 'Primary weakness', first.reason);
  }

  // ---- the secondary, deliberately on a different axis from the primary.
  const firstAxis = blocks.find((b) => b.role === 'PRIMARY')?.drill;
  const secondary = recs
    .slice(1)
    .find((r) => !used.has(r.drill) && (!firstAxis || primaryAxis(r.drill) !== primaryAxis(firstAxis)));
  if (secondary) take('SECONDARY', secondary.drill, 'Secondary skill', secondary.reason);

  // ---- combined. The same mechanic, now in context rather than on a bench.
  const focusAxis = firstAxis ? primaryAxis(firstAxis) : (strong ?? 'kiting');
  const combined =
    drillsForAxis(focusAxis).find((d) => pressureOf(d.id) === 'applied' && !used.has(d.id) && playable(p, d.id)) ??
    DRILL_LIST.find((d) => pressureOf(d.id) === 'applied' && !used.has(d.id) && playable(p, d.id));
  if (combined) {
    take(
      'COMBINED',
      combined.id,
      'Combined drill',
      `Puts ${AXIS_LABEL[focusAxis].toLowerCase()} back into context, where it has to work alongside everything else.`,
    );
  }

  // ---- transfer. The only block with an opponent, and the only one that can
  // say whether any of the previous fifteen minutes actually took.
  const transfer =
    DRILL_LIST.find((d) => pressureOf(d.id) === 'live' && d.axes[focusAxis] !== undefined && playable(p, d.id)) ??
    DRILL_LIST.find((d) => pressureOf(d.id) === 'live' && playable(p, d.id));
  if (transfer && !used.has(transfer.id)) {
    take(
      'TRANSFER',
      transfer.id,
      'Transfer test',
      'Something that fights back. This is the block that decides whether today counted.',
    );
  }

  const seconds = blocks.reduce((a, b) => a + b.seconds, 0);
  const focus = FOCUS_NAME[focusAxis];

  return {
    date: '',
    focus,
    subtitle: blocks.some((b) => b.role === 'PRIMARY')
      ? `Built around ${AXIS_LABEL[focusAxis].toLowerCase()} — the thing currently costing you the most.`
      : 'A balanced opening session while the profile fills in.',
    blocks,
    // Rounded up: a plan that says 15 and takes 16 is worse than one that
    // says 16 and takes 15.
    minutes: Math.max(1, Math.ceil(seconds / 60)),
  };
};

/** Recovers the stored plan for today, or draws a new one. */
export const planFrom = (p: Profile, ids: DrillId[], focus: string): SessionPlan | null => {
  if (!ids.length) return null;
  const full = planSession(p);
  // The stored ids are the truth; the freshly-drawn plan only supplies the
  // wording for blocks that still match.
  const blocks: SessionBlock[] = ids.map((id, i) => {
    const match = full.blocks.find((b) => b.drill === id);
    return (
      match ?? {
        role: (['WARMUP', 'PRIMARY', 'SECONDARY', 'COMBINED', 'TRANSFER'] as BlockRole[])[
          Math.min(i, 4)
        ],
        drill: id,
        label: ['Warmup', 'Primary weakness', 'Secondary skill', 'Combined drill', 'Transfer test'][
          Math.min(i, 4)
        ],
        why: DRILLS[id].brief,
        seconds: PLANNED_SECONDS(id),
      }
    );
  });
  const seconds = blocks.reduce((a, b) => a + b.seconds, 0);
  return {
    date: '',
    focus: focus || full.focus,
    subtitle: full.subtitle,
    blocks,
    minutes: Math.max(1, Math.ceil(seconds / 60)),
  };
};
