import { DRILLS, type DrillId } from '../drills/catalog';
import { practiceFor } from '../drills/modes';
import { clamp } from '../engine/math';
import { APM_LEVELS, isApmDrill, levelDifficulty, recommendedLevel } from '../progression/apm';
import { recommend } from '../progression/coach';
import { LANE_LENGTHS, LANE_TIERS } from '../progression/lane';
import { buildPlan } from '../progression/plan';
import type { Profile } from '../progression/profile';

/**
 * WHAT TO PLAY NEXT.
 *
 * The coach has always been able to answer this — `recommend()` reads the
 * mistakes, the untrained axes and the plateaus and names a drill — and the
 * menu never asked it. This is the menu asking: one drill, why, and exactly
 * how to start it, so the biggest button on PLAY and the "next" on a results
 * screen are the same answer to the same question.
 *
 * Nothing here scores, rates or moves a ladder. It reads the profile and hands
 * back a run to start, on the same settings the drill's own card would use.
 */

const DAY = 86_400_000;

/** How a run is started from the menu: the drill and the settings its card would pick. */
export interface StartSpec {
  drill: DrillId;
  opts: { difficulty?: number; duration?: number; level?: number };
}

export interface NextPick extends StartSpec {
  /** Why this one, in one line. */
  why: string;
  source: 'first' | 'coach' | 'plan';
}

/**
 * The lane's quick settings: the opponent its card opens on and the shortest
 * length. A button that stopped to ask "who, and how long" would not be one
 * button.
 */
export const LANE_QUICK = { difficulty: LANE_TIERS[1].difficulty, duration: LANE_LENGTHS[0].seconds };

/**
 * The drill the menu can actually start for a pick made by the coach or the
 * plan. Both still speak the whole catalogue; the menu offers the lab, three
 * champions and the lane, and `practiceFor` is the existing translation.
 */
export const onMenu = (id: DrillId): DrillId => (isApmDrill(id) || id === 'lanePhase' ? id : practiceFor(id));

/** The settings a drill's own card would start it on. */
export const startSpec = (p: Profile, drill: DrillId): StartSpec => {
  if (isApmDrill(drill)) {
    const level = clamp(Math.round(recommendedLevel(p.apm, drill)), 1, APM_LEVELS);
    return { drill, opts: { level, difficulty: levelDifficulty(level) } };
  }
  if (drill === 'lanePhase') return { drill, opts: { ...LANE_QUICK } };
  return { drill, opts: {} };
};

/** The very first run: PULSE at level one, the same run the walkthrough ends on. */
const FIRST: NextPick = {
  drill: 'apmPulse',
  opts: { level: 1, difficulty: levelDifficulty(1) },
  why: 'Your first thirty seconds — two keys, one lit square.',
  source: 'first',
};

/**
 * The one drill PLAY NEXT starts.
 *
 * The coach's top pick first; failing that, the first unfinished piece of
 * today's plan; failing both, PULSE. A profile that has never finished a run
 * goes straight to PULSE at level one — the coach's answer for nobody is
 * "every axis is unmeasured", which is true and is not where anybody starts.
 *
 * `avoid` is the drill that was just played: the results screen asks for the
 * *next* drill, and "the one you just finished" is the button beside it.
 */
export const pickNext = (p: Profile, avoid?: DrillId): NextPick => {
  if (p.history.length === 0 && avoid === undefined) return FIRST;
  try {
    for (const r of recommend(p, 6)) {
      const drill = onMenu(r.drill);
      if (drill === avoid) continue;
      return { ...startSpec(p, drill), why: r.headline, source: 'coach' };
    }
    for (const item of buildPlan(p).items) {
      if (item.done) continue;
      const drill = onMenu(item.drill);
      if (drill === avoid) continue;
      return { ...startSpec(p, drill), why: `${item.label} — ${item.reason}`, source: 'plan' };
    }
  } catch {
    // A profile the coach cannot read still gets a button.
  }
  return avoid === 'apmPulse' ? { ...startSpec(p, 'vayneTumble'), why: 'Something with a champion in it.', source: 'plan' } : FIRST;
};

// ---------------------------------------------------------------- records

/** This drill's last `n` scores, oldest first. */
export const recentScores = (p: Profile, id: DrillId, n = 5): number[] => {
  const out: number[] = [];
  for (let i = p.history.length - 1; i >= 0 && out.length < n; i--) {
    const h = p.history[i];
    if (h.drill === id && Number.isFinite(h.score)) out.push(h.score);
  }
  return out.reverse();
};

/** Runs of this drill on record. */
export const runsOf = (p: Profile, id: DrillId): number => p.history.reduce((n, h) => n + (h.drill === id ? 1 : 0), 0);

/** Whole days since this drill was last played, or null if it never has been. */
export const daysSince = (p: Profile, id: DrillId, now = Date.now()): number | null => {
  for (let i = p.history.length - 1; i >= 0; i--) {
    if (p.history[i].drill === id) return Math.max(0, Math.floor((now - p.history[i].t) / DAY));
  }
  return null;
};

/** A favourite untouched for this long says so on its card. */
export const STALE_DAYS = 3;

/**
 * Whether the latest run of this drill is its best, and recent.
 *
 * Read off the history rather than off the record's timestamp, because the
 * record is stamped on a drill's first run too — and a first run is a
 * baseline, not a best.
 */
export const freshBest = (p: Profile, id: DrillId, now = Date.now()): boolean => {
  let last: { score: number; t: number } | null = null;
  let before = -Infinity;
  for (const h of p.history) {
    if (h.drill !== id) continue;
    if (last) before = Math.max(before, last.score);
    last = { score: h.score, t: h.t };
  }
  return !!last && before > -Infinity && last.score > before && now - last.t < 2 * DAY;
};

/** A drill's display name, safe for an id a stored profile hands back. */
export const nameOf = (id: DrillId): string => DRILLS[id]?.name ?? String(id);
