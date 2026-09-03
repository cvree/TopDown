import { DAILY_SEQUENCE, DRILLS, DRILL_LIST, type DrillId } from '../drills/catalog';
import { isApmDrill } from './apm';
import { todayKey, trainingPriority, weakestAxis, type Profile } from './profile';
import { AXIS_LABEL, SKILL_AXES, type SkillAxis } from './skills';
import { nextVayneStage } from './vayne';
import { moduleUnlocked, nextWasdModule, type WasdModule } from './wasd';

/**
 * TODAY'S SESSION.
 *
 * The client used to open on a list of everything, which is the correct screen
 * for the fortieth session and the wrong one for the fourth: a player who has
 * to choose between thirty-six drills before they can start has been given a
 * decision instead of a session.
 *
 * So this builds one. It is short on purpose — ten to twenty minutes, five or
 * six pieces — and every piece is there for a stated reason, because a plan
 * you cannot argue with is a plan you will not follow. The order is the order
 * a coach would use: warm the hands, take the next thing you are learning,
 * attack the thing you are worst at, keep the champion moving, then put it all
 * together against something that fights back.
 *
 * It is deterministic for a given day and profile, so it does not reshuffle
 * under you between one glance and the next, and it is fully re-derived after
 * every run, so finishing a piece changes what the rest of it says.
 */

export type PlanKind = 'warmup' | 'course' | 'weakness' | 'champion' | 'tempo' | 'integration';

export interface PlanItem {
  drill: DrillId;
  kind: PlanKind;
  /** The section heading this piece belongs under. */
  label: string;
  /** Why this drill, today, in one sentence. */
  reason: string;
  minutes: number;
  /** Already run at some point today. */
  done: boolean;
}

export interface TrainingPlan {
  date: string;
  items: PlanItem[];
  /** Total estimated minutes, including countdowns and results screens. */
  minutes: number;
  /** What today is about, in three or four words. */
  headline: string;
  /** The axis the session is built around, if there is one. */
  focus: SkillAxis | null;
  /** Pieces finished today. */
  done: number;
}

/** A drill's length in minutes, with the countdown and the results screen in. */
export const drillMinutes = (id: DrillId): number => {
  const d = DRILLS[id].duration;
  // An open-ended drill runs until you lose; ninety seconds is the honest
  // median for one and it is better to over-promise the clock than under.
  return ((d > 0 ? d : 90) + 22) / 60;
};

/** The drill that trains an axis hardest, ignoring the ladders and courses. */
const drillForAxis = (axis: SkillAxis, exclude: Set<DrillId>): DrillId | null => {
  let best: DrillId | null = null;
  let bestWeight = 0;
  for (const meta of DRILL_LIST) {
    if (exclude.has(meta.id)) continue;
    // The APM ladder and the two courses are chosen by their own screens; a
    // plan that reaches into them would fight those screens for the same slot.
    if (isApmDrill(meta.id) || meta.group === 'VAYNE' || meta.group === 'WASD') continue;
    const w = meta.axes[axis] ?? 0;
    if (w > bestWeight) {
      bestWeight = w;
      best = meta.id;
    }
  }
  return best;
};

/** The second-weakest rated axis, for a session that needs a second target. */
const secondWeakest = (p: Profile, first: SkillAxis | null): SkillAxis | null => {
  const rated = SKILL_AXES.filter((a) => p.samples[a] > 0 && a !== first);
  if (!rated.length) return null;
  return rated.reduce((a, b) => (p.ratings[a] <= p.ratings[b] ? a : b));
};

/** The academy module today's session should carry, if the course is live. */
export const courseModule = (p: Profile): WasdModule | null => {
  const next = nextWasdModule(p.wasd);
  return moduleUnlocked(p.wasd, next) ? next : null;
};

/**
 * The most pieces a session may have.
 *
 * Six is the number of distinct *reasons* a piece can be here, and a session
 * longer than that stops being a session and becomes a to-do list — which is
 * the thing this screen exists to replace.
 */
const MAX_PIECES = 6;

export const buildPlan = (p: Profile): TrainingPlan => {
  const date = todayKey();
  const doneToday = new Set(p.daily.completed);
  const items: PlanItem[] = [];
  const used = new Set<DrillId>();

  const push = (drill: DrillId, kind: PlanKind, label: string, reason: string): void => {
    if (used.has(drill) || items.length >= MAX_PIECES) return;
    used.add(drill);
    items.push({ drill, kind, label, reason, minutes: drillMinutes(drill), done: doneToday.has(drill) });
  };

  // 1 — the warm-up. Alternates by day so it does not become furniture.
  const warm: DrillId = date.charCodeAt(date.length - 1) % 2 === 0 ? 'movement' : 'aim';
  push(warm, 'warmup', 'Warm up', 'Two minutes of nothing at stake. Your first thirty seconds are never your real ones.');

  // 2 — the course. The academy is the thing being learnt rather than
  // maintained, so it goes second, while the hands are fresh.
  const mod = courseModule(p);
  if (mod) {
    const rec = p.wasd.modules[mod.id];
    push(
      mod.id,
      'course',
      'The course',
      rec.runs === 0
        ? `New module: ${mod.purpose}`
        : rec.best < mod.gate
          ? `${Math.round(rec.best * 100)}% best, ${Math.round(mod.gate * 100)}% to clear — ${mod.title.toLowerCase()} is what is next.`
          : `Cleared. This run is for the second and third star.`,
    );
  }

  // 3 — the weakness. The whole reason a plan beats a menu.
  const priority = trainingPriority(p);
  const focus = priority?.axis ?? weakestAxis(p);
  if (focus) {
    const d = drillForAxis(focus, used);
    if (d) push(d, 'weakness', 'Your weakest axis', `${AXIS_LABEL[focus]} — ${priority?.reason ?? 'your lowest axis.'}`);
  }

  // 4 — the champion, but only once the path has been started. Nobody wants a
  // plan that keeps recommending a course they have decided against.
  const vayneRuns = Object.values(p.vayne.stages).reduce((n, s) => n + s.runs, 0);
  if (vayneRuns > 0) {
    const stage = nextVayneStage(p.vayne);
    push(stage.id, 'champion', 'Your champion', `${stage.title} — ${stage.purpose}`);
  }

  // 5 — a second target, so the middle of the session is not one drill long.
  const second = secondWeakest(p, focus);
  if (second) {
    const d = drillForAxis(second, used);
    if (d) push(d, 'weakness', 'Second target', `${AXIS_LABEL[second]} is your next lowest, and it is quick to move.`);
  }

  // 6 — integration. Always last, always something that fights back: the
  // point of a session is the thing you can do at the end of it.
  const finisher: DrillId = p.overall > 1900 ? 'duel1v2' : 'duel1v1';
  push(finisher, 'integration', 'Put it together', 'Everything above, against something that answers. This is where it either transferred or did not.');

  // Top up toward the bottom of the ten-minute band rather than past the top
  // of it: a plan nobody finishes is worse than a short one.
  const total = () => items.reduce((n, i) => n + i.minutes, 0);
  const fillers = DAILY_SEQUENCE.filter((d) => !used.has(d));
  for (const f of fillers) {
    if (total() >= 10) break;
    push(f, 'tempo', 'Maintenance', 'Short, familiar, and it keeps the axis it trains from going stale.');
  }

  const minutes = total();
  const done = items.filter((i) => i.done).length;
  return {
    date,
    items,
    minutes,
    headline: mod
      ? `${mod.title.toUpperCase()} · ${focus ? AXIS_LABEL[focus].toUpperCase() : 'MAINTENANCE'}`
      : focus
        ? `${AXIS_LABEL[focus].toUpperCase()} FOCUS`
        : 'MAINTENANCE',
    focus: focus ?? null,
    done,
  };
};

/** The first unfinished piece — what the one big button starts. */
export const nextInPlan = (plan: TrainingPlan): PlanItem | null =>
  plan.items.find((i) => !i.done) ?? null;

/** Every piece still to do, in order: the queue the session button runs. */
export const planQueue = (plan: TrainingPlan): DrillId[] => plan.items.filter((i) => !i.done).map((i) => i.drill);

/* ---------------------------------------------------------------- history */

export interface SessionSummary {
  /** When the session ended. */
  at: number;
  runs: number;
  drills: DrillId[];
  minutes: number;
  ratingBefore: number;
  ratingAfter: number;
  /** The best single run of the session, by performance. */
  best: { drill: DrillId; performance: number } | null;
  /** The worst, which is usually the more useful of the two. */
  worst: { drill: DrillId; performance: number } | null;
  /** True when it is the session still in progress. */
  live: boolean;
}

/** Runs closer together than this are one sitting. */
const SESSION_GAP_MS = 40 * 60 * 1000;

/**
 * The last sitting, reconstructed from the run history.
 *
 * Sessions are not stored as an entity anywhere and deliberately so: a session
 * is just runs that happened near each other, and inferring it from the
 * timestamps means every profile ever written already has them.
 */
export const lastSession = (p: Profile, includeLive = false): SessionSummary | null => {
  const h = p.history;
  if (!h.length) return null;
  const groups: (typeof h)[] = [];
  let current: typeof h = [];
  for (const entry of h) {
    const prev = current[current.length - 1];
    if (prev && entry.t - prev.t > SESSION_GAP_MS) {
      groups.push(current);
      current = [];
    }
    current.push(entry);
  }
  if (current.length) groups.push(current);

  const live = Date.now() - h[h.length - 1].t < SESSION_GAP_MS;
  const pick = live && !includeLive ? groups[groups.length - 2] : groups[groups.length - 1];
  if (!pick || !pick.length) return null;

  const first = pick[0];
  const last = pick[pick.length - 1];
  const sorted = [...pick].sort((a, b) => b.performance - a.performance);
  return {
    at: last.t,
    runs: pick.length,
    drills: [...new Set(pick.map((e) => e.drill))],
    minutes: pick.reduce((n, e) => n + drillMinutes(e.drill), 0),
    // The rating before the first run of the sitting is the rating after the
    // run before it, which is the previous entry in the same list.
    ratingBefore: (() => {
      const i = h.indexOf(first);
      return i > 0 ? h[i - 1].overall : first.overall;
    })(),
    ratingAfter: last.overall,
    best: sorted.length ? { drill: sorted[0].drill, performance: sorted[0].performance } : null,
    worst: sorted.length > 1 ? { drill: sorted[sorted.length - 1].drill, performance: sorted[sorted.length - 1].performance } : null,
    live: live && includeLive,
  };
};

/* -------------------------------------------------------- strong and weak */

export interface AxisReading {
  axis: SkillAxis;
  rating: number;
  /** Rating distance from your overall — the reason it is on this list. */
  gap: number;
  /** Change over the last few runs that touched it. */
  trend: number;
}

/**
 * The axes worth naming, split into what is carrying you and what is not.
 *
 * Only rated axes appear: an axis with no runs behind it is not a weakness,
 * it is an unknown, and the home screen says that separately.
 */
export const axisReadings = (p: Profile): {
  strengths: AxisReading[];
  weaknesses: AxisReading[];
  unrated: SkillAxis[];
  /** Every rated axis, in catalogue order. What Progress draws. */
  all: AxisReading[];
} => {
  const rated = SKILL_AXES.filter((a) => p.samples[a] > 0);
  const unrated = SKILL_AXES.filter((a) => p.samples[a] === 0);
  const readings: AxisReading[] = rated.map((axis) => ({
    axis,
    rating: p.ratings[axis],
    gap: p.ratings[axis] - p.overall,
    trend: axisTrend(p, axis),
  }));
  const byGap = [...readings].sort((a, b) => b.gap - a.gap);
  return {
    strengths: byGap.slice(0, 3).filter((r) => r.gap > 0 || readings.length < 4),
    weaknesses: [...byGap].reverse().slice(0, 3),
    unrated,
    all: readings,
  };
};

/**
 * Rating change over a window of days, read from the daily marks.
 *
 * The marks are one overall rating per local day, written the first time
 * anything is run that day, so the oldest mark inside the window is the
 * rating you started the window on. A profile with fewer marks than the
 * window asks for answers over what it has rather than refusing.
 */
export const changeOverDays = (
  p: Profile,
  days = 30,
): { delta: number; from: number; to: number; days: number } | null => {
  if (p.dailyMarks.length < 2) return null;
  const cutoff = Date.now() - days * 86400000;
  const inWindow = p.dailyMarks.filter((m) => new Date(m.date).getTime() >= cutoff);
  const marks = inWindow.length >= 2 ? inWindow : p.dailyMarks;
  const from = marks[0].overall;
  const to = p.overall;
  const spanned = Math.max(
    1,
    Math.round((Date.now() - new Date(marks[0].date).getTime()) / 86400000),
  );
  return { delta: to - from, from, to, days: Math.min(days, spanned) };
};

/**
 * How an axis has moved recently, as a rating delta.
 *
 * Read from the drills that train it rather than from a stored per-axis
 * series: the history keeps overall rating per run, and a run of a
 * movement drill moving your overall up is a movement improvement.
 */
const axisTrend = (p: Profile, axis: SkillAxis): number => {
  const runs = p.history.filter((h) => (DRILLS[h.drill].axes[axis] ?? 0) > 0.3);
  if (runs.length < 4) return 0;
  const recent = runs.slice(-6);
  const older = runs.slice(-12, -6);
  if (!older.length) return 0;
  const mean = (xs: typeof runs) => xs.reduce((n, x) => n + x.performance, 0) / xs.length;
  return (mean(recent) - mean(older)) * 100;
};

/* ------------------------------------------------------------ improvements */

export interface Improved {
  label: string;
  drill: DrillId;
  /** Percentage improvement over what it beat. */
  delta: number;
  value: number;
  format: 'pct' | 'ms' | 'units' | 'int' | 'sec';
  at: number;
}

/** What actually got better lately, newest first, deduplicated by metric. */
export const recentImprovements = (p: Profile, days = 7, limit = 5): Improved[] => {
  const cutoff = Date.now() - days * 86400000;
  const seen = new Set<string>();
  const out: Improved[] = [];
  for (let i = p.recentBests.length - 1; i >= 0; i--) {
    const b = p.recentBests[i];
    if (b.at < cutoff) break;
    const key = `${b.drill}:${b.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const base = Math.abs(b.previous) > 0.0001 ? Math.abs(b.previous) : 1;
    const raw = ((b.value - b.previous) / base) * 100;
    out.push({
      label: b.label,
      drill: b.drill,
      delta: b.direction === 'lower' ? -raw : raw,
      value: b.value,
      format: b.format,
      at: b.at,
    });
    if (out.length >= limit) break;
  }
  return out;
};
