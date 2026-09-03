/**
 * The coach.
 *
 * Everything here answers one of the five questions the product exists to
 * answer: how good am I, what am I bad at, why, what should I train next, and
 * am I improving. It reads only what has actually been recorded — if the data
 * is not there, the answer is "not enough data yet", never a plausible number.
 *
 * Nothing in this module mutates the profile. It is all queries.
 */

import { clamp, mean } from '../engine/math';
import { DRILLS, DRILL_LIST, drillsForAxis, pressureOf, type DrillId } from '../drills/catalog';
import { ERRORS, type ErrorCode } from './errors';
import { isApmDrill } from './apm';
import { isVayneStage, stageUnlocked, VAYNE_STAGES } from './vayne';
import { AXIS_LABEL, SKILL_AXES, type SkillAxis } from './skills';
import type { HistoryEntry, Profile } from './profile';

const DAY = 86400000;

/* ------------------------------------------------------------------ errors */

export interface ErrorSummary {
  code: ErrorCode;
  /** Total occurrences inside the window. */
  occurrences: number;
  /** Runs inside the window that contained it. */
  runs: number;
  /** Mean share of the opportunities to make it, 0..1. */
  rate: number;
  /** The same rate over the window before this one, or null if untrained. */
  previousRate: number | null;
  /** Where it happens most. */
  worstDrill: DrillId;
}

/** The mistakes made in the last `days` days, most frequent first. */
export const errorRollup = (p: Profile, days = 7): ErrorSummary[] => {
  const now = Date.now();
  const from = now - days * DAY;
  const prevFrom = from - days * DAY;
  const window = p.errorLog.filter((e) => e.t >= from);
  const prev = p.errorLog.filter((e) => e.t >= prevFrom && e.t < from);
  const byCode = new Map<ErrorCode, ErrorSummary>();

  for (const e of window) {
    const cur = byCode.get(e.code);
    if (!cur) {
      byCode.set(e.code, {
        code: e.code,
        occurrences: e.count,
        runs: 1,
        rate: e.rate,
        previousRate: null,
        worstDrill: e.drill,
      });
    } else {
      cur.occurrences += e.count;
      cur.runs += 1;
      // Running mean, so one enormous run cannot define the rate.
      cur.rate += (e.rate - cur.rate) / cur.runs;
    }
  }
  // The drill each error shows up in most is where the fix should be tested.
  const drillCounts = new Map<string, number>();
  for (const e of window) {
    const k = `${e.code}|${e.drill}`;
    drillCounts.set(k, (drillCounts.get(k) ?? 0) + e.count);
  }
  for (const s of byCode.values()) {
    let best = s.worstDrill;
    let bestN = -1;
    for (const [k, n] of drillCounts) {
      const [code, drill] = k.split('|');
      if (code === s.code && n > bestN) {
        bestN = n;
        best = drill as DrillId;
      }
    }
    s.worstDrill = best;
    const before = prev.filter((e) => e.code === s.code);
    s.previousRate = before.length >= 2 ? mean(before.map((e) => e.rate)) : null;
  }

  return [...byCode.values()].sort((a, b) => b.occurrences - a.occurrences);
};

export interface ErrorWeek {
  /** "This week", "1 week ago", … */
  label: string;
  /** Mean rate that week, or null if the mistake was never measurable. */
  rate: number | null;
  runs: number;
}

/**
 * One mistake, week by week. This is the chart a player wants most: a bad
 * habit visibly disappearing.
 */
export const errorWeeks = (p: Profile, code: ErrorCode, weeks = 4): ErrorWeek[] => {
  const now = Date.now();
  const out: ErrorWeek[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const to = now - i * 7 * DAY;
    const from = to - 7 * DAY;
    const hits = p.errorLog.filter((e) => e.code === code && e.t >= from && e.t < to);
    out.push({
      label: i === 0 ? 'This week' : i === 1 ? 'Last week' : `${i} weeks ago`,
      rate: hits.length ? mean(hits.map((e) => e.rate)) : null,
      runs: hits.length,
    });
  }
  return out;
};

/* ------------------------------------------------------- pressure retention */

export interface Retention {
  axis: SkillAxis;
  /** Mean performance where the mechanic is trained on its own. */
  isolated: number;
  /** Mean performance where something is fighting back. */
  live: number;
  /** live / isolated, clamped. 1 means it holds up completely. */
  retention: number;
  isolatedRuns: number;
  liveRuns: number;
}

const axisPerf = (h: HistoryEntry, axis: SkillAxis): number | null => {
  const v = h.axes?.[axis];
  if (typeof v === 'number') return v;
  // Runs recorded before per-axis performance was kept still count, at the
  // run's overall performance — which is what the rating system used for them.
  return DRILLS[h.drill].axes[axis] !== undefined ? h.performance : null;
};

/**
 * How much of each mechanic survives contact with an opponent.
 *
 * "I can do it in the practice tool" is the most common thing a player
 * believes about themselves. This is the number that checks it.
 */
export const pressureRetention = (p: Profile, minRuns = 3): Retention[] => {
  const out: Retention[] = [];
  for (const axis of SKILL_AXES) {
    const iso: number[] = [];
    const live: number[] = [];
    for (const h of p.history) {
      const v = axisPerf(h, axis);
      if (v === null) continue;
      if (pressureOf(h.drill) === 'live') live.push(v);
      else iso.push(v);
    }
    if (iso.length < minRuns || live.length < minRuns) continue;
    const i = mean(iso);
    const l = mean(live);
    out.push({
      axis,
      isolated: i,
      live: l,
      retention: i > 0.02 ? clamp(l / i, 0, 1.4) : 0,
      isolatedRuns: iso.length,
      liveRuns: live.length,
    });
  }
  return out.sort((a, b) => a.retention - b.retention);
};

/** One number for the whole profile, when there is enough to say it. */
export const overallRetention = (p: Profile): number | null => {
  const rs = pressureRetention(p);
  return rs.length ? mean(rs.map((r) => r.retention)) : null;
};

/* ------------------------------------------------------ transfer readiness */

export type TransferStage = 'FOUNDATION' | 'ISOLATED' | 'COMBINED' | 'PRESSURE' | 'TRANSFER';

export interface TransferRow {
  stage: TransferStage;
  /** 0..100, or null where it has not been attempted enough to score. */
  score: number | null;
  mastered: boolean;
  runs: number;
}

/**
 * A skill, staged from "can do it once" to "still does it in a fight".
 *
 * Each stage is a real bucket of runs: the drills that train the axis, split
 * by how much pressure they were played under and how hard they were played.
 */
export const transferLadder = (p: Profile, axis: SkillAxis): TransferRow[] => {
  const runs = p.history.filter((h) => axisPerf(h, axis) !== null);
  const bucket = (
    stage: TransferStage,
    pick: (h: HistoryEntry) => boolean,
  ): TransferRow => {
    const rs = runs.filter(pick);
    if (rs.length < 2) return { stage, score: null, mastered: false, runs: rs.length };
    // The best three runs, not the mean of everything: a stage is cleared by
    // what you can do repeatably, not dragged down by the day you learned it.
    const top = rs
      .map((h) => axisPerf(h, axis) as number)
      .sort((a, b) => b - a)
      .slice(0, 3);
    const score = mean(top) * 100;
    return { stage, score, mastered: score >= 82, runs: rs.length };
  };

  return [
    bucket('FOUNDATION', (h) => pressureOf(h.drill) !== 'live' && h.difficulty < 0.45),
    bucket('ISOLATED', (h) => pressureOf(h.drill) === 'isolated'),
    bucket('COMBINED', (h) => pressureOf(h.drill) === 'applied'),
    bucket('PRESSURE', (h) => pressureOf(h.drill) === 'live'),
    bucket('TRANSFER', (h) => pressureOf(h.drill) === 'live' && h.difficulty >= 0.55),
  ];
};

/* --------------------------------------------------------------- plateaus */

export interface Plateau {
  drill: DrillId;
  /** Runs across the flat stretch. */
  runs: number;
  /** Mean performance across it, 0..1. */
  level: number;
  /** The mistake most responsible, if one stands out. */
  limiter: ErrorCode | null;
  /** A different drill that trains the way out. */
  detour: DrillId;
}

/**
 * Six or more recent runs of one drill that go nowhere.
 *
 * "Try again" is the wrong advice for a plateau — the limiting skill is
 * usually somewhere else, and the way through is a detour into it.
 */
export const detectPlateau = (p: Profile, drill: DrillId, minRuns = 6): Plateau | null => {
  const runs = p.history.filter((h) => h.drill === drill).slice(-8);
  if (runs.length < minRuns) return null;
  const perfs = runs.map((h) => h.performance);
  const first = mean(perfs.slice(0, Math.floor(perfs.length / 2)));
  const last = mean(perfs.slice(Math.floor(perfs.length / 2)));
  const spread = Math.max(...perfs) - Math.min(...perfs);
  // Flat means both: no trend, and no wild swings that would explain one.
  if (Math.abs(last - first) > 0.05 || spread > 0.28) return null;

  const since = runs[0].t;
  const errs = p.errorLog.filter((e) => e.drill === drill && e.t >= since);
  const byCode = new Map<ErrorCode, number>();
  for (const e of errs) byCode.set(e.code, (byCode.get(e.code) ?? 0) + e.rate);
  const limiter = [...byCode.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // The detour is the drill that trains the limiter — unless that is the
  // drill you are already stuck on, in which case go one axis sideways.
  let detour = limiter ? ERRORS[limiter].fix : drill;
  if (detour === drill) {
    const axis = (Object.keys(DRILLS[drill].axes)[0] ?? 'movement') as SkillAxis;
    detour = drillsForAxis(axis).find((d) => d.id !== drill)?.id ?? drill;
  }

  return { drill, runs: runs.length, level: mean(perfs), limiter, detour };
};

export const plateaus = (p: Profile): Plateau[] => {
  const seen = new Set<DrillId>();
  const out: Plateau[] = [];
  for (const h of [...p.history].reverse()) {
    if (seen.has(h.drill)) continue;
    seen.add(h.drill);
    const pl = detectPlateau(p, h.drill);
    if (pl) out.push(pl);
  }
  return out;
};

/* --------------------------------------------------------------- progress */

export interface AxisGain {
  axis: SkillAxis;
  label: string;
  from: number;
  to: number;
  delta: number;
}

/**
 * Per-axis rating change across a window, from the daily snapshots.
 *
 * Returns an empty list rather than a fabricated one when there is no mark
 * old enough to subtract from.
 */
export const axisGains = (p: Profile, days = 30): AxisGain[] => {
  const cutoff = Date.now() - days * DAY;
  const marks = p.dailyMarks.filter((m) => m.ratings);
  if (marks.length < 2) return [];
  const older = marks.filter((m) => new Date(m.date).getTime() <= cutoff);
  const base = older.length ? older[older.length - 1] : marks[0];
  if (base === marks[marks.length - 1]) return [];
  const out: AxisGain[] = [];
  for (const axis of SKILL_AXES) {
    const from = base.ratings?.[axis] ?? 0;
    const to = p.ratings[axis];
    if (from === 0 && to === 0) continue;
    out.push({ axis, label: AXIS_LABEL[axis], from, to, delta: to - from });
  }
  return out.sort((a, b) => b.delta - a.delta);
};

/** Overall rating change across the same window, or null if unknowable. */
export const overallGain = (p: Profile, days = 30): { from: number; to: number; delta: number } | null => {
  const cutoff = Date.now() - days * DAY;
  if (p.dailyMarks.length < 2) return null;
  const older = p.dailyMarks.filter((m) => new Date(m.date).getTime() <= cutoff);
  const base = older.length ? older[older.length - 1] : p.dailyMarks[0];
  if (base === p.dailyMarks[p.dailyMarks.length - 1]) return null;
  return { from: base.overall, to: p.overall, delta: p.overall - base.overall };
};

/* -------------------------------------------------------- recommendations */

export interface Recommendation {
  drill: DrillId;
  /** Why this, now. One sentence, with the number that justifies it. */
  reason: string;
  /** The heading the UI leads with: what this fixes. */
  headline: string;
  /** Higher sorts first. */
  priority: number;
  kind: 'weakness' | 'error' | 'plateau' | 'untrained' | 'pressure' | 'progression';
}

const playable = (p: Profile, id: DrillId): boolean => {
  if (!isVayneStage(id)) return true;
  const stage = VAYNE_STAGES.find((s) => s.id === id);
  return stage ? stageUnlocked(p.vayne, stage) : true;
};

const lastPlayed = (p: Profile, id: DrillId): number => {
  for (let i = p.history.length - 1; i >= 0; i--) if (p.history[i].drill === id) return p.history[i].t;
  return 0;
};

/**
 * What to train next, and why.
 *
 * Deliberately not "your lowest number, forever": the same drill recommended
 * every day stops being a recommendation. Candidates come from weaknesses,
 * recurring mistakes, plateaus, untrained axes and pressure collapse, and
 * anything played in the last few hours is pushed down the list.
 */
export const recommend = (p: Profile, count = 3): Recommendation[] => {
  const out: Recommendation[] = [];
  const add = (r: Recommendation) => {
    if (!playable(p, r.drill)) return;
    if (out.some((o) => o.drill === r.drill)) return;
    out.push(r);
  };

  // 1. The mistakes actually being made, weighted by how much they cost.
  for (const e of errorRollup(p, 7).slice(0, 4)) {
    const meta = ERRORS[e.code];
    add({
      drill: meta.fix,
      kind: 'error',
      headline: meta.label,
      reason: `${e.occurrences} ${meta.unit} across ${e.runs} run${e.runs === 1 ? '' : 's'} this week. ${meta.cost}`,
      priority: 74 + e.rate * 26 * meta.impact,
    });
  }

  // 2. Axes with no data at all — the profile is guessing there.
  for (const axis of SKILL_AXES) {
    if (p.samples[axis] > 0) continue;
    const d = drillsForAxis(axis).find((x) => !isApmDrill(x.id) && playable(p, x.id));
    if (!d) continue;
    add({
      drill: d.id,
      kind: 'untrained',
      headline: `${AXIS_LABEL[axis]} — unmeasured`,
      reason: `No ${AXIS_LABEL[axis].toLowerCase()} data yet. One run turns a guess into a rating.`,
      priority: 82,
    });
  }

  // 3. Mechanics that fall apart under pressure.
  for (const r of pressureRetention(p)) {
    if (r.retention > 0.82) continue;
    const d = DRILL_LIST.find((x) => pressureOf(x.id) === 'live' && x.axes[r.axis] !== undefined);
    if (!d) continue;
    add({
      drill: d.id,
      kind: 'pressure',
      headline: `${AXIS_LABEL[r.axis]} under pressure`,
      reason: `${Math.round(r.isolated * 100)}% isolated, ${Math.round(r.live * 100)}% in a fight — ${Math.round(
        r.retention * 100,
      )}% retention. The mechanic is there; it just does not survive contact.`,
      priority: 76 + (1 - r.retention) * 20,
    });
  }

  // 4. Plateaus, answered with the detour rather than another attempt.
  for (const pl of plateaus(p).slice(0, 2)) {
    add({
      drill: pl.detour,
      kind: 'plateau',
      headline: `${DRILLS[pl.drill].name} has stalled`,
      reason: `${pl.runs} runs sitting near ${Math.round(pl.level * 100)}. ${
        pl.limiter ? `${ERRORS[pl.limiter].label} is the limiter — train that instead.` : 'Train the skill under it instead.'
      }`,
      priority: 70,
    });
  }

  // 5. The weakest measured axis, always a candidate but never the only one.
  const rated = SKILL_AXES.filter((a) => p.samples[a] > 0);
  if (rated.length) {
    const weak = rated.reduce((a, b) => (p.ratings[a] <= p.ratings[b] ? a : b));
    const gap = p.overall - p.ratings[weak];
    const d = drillsForAxis(weak).find((x) => playable(p, x.id));
    if (d) {
      add({
        drill: d.id,
        kind: 'weakness',
        headline: `${AXIS_LABEL[weak]} is your floor`,
        reason:
          gap > 100
            ? `${Math.round(gap)} rating below your overall. It is the single thing holding the number down.`
            : `Your lowest axis at ${Math.round(p.ratings[weak])}, though the profile is fairly even.`,
        priority: 68 + clamp(gap / 12, 0, 20),
      });
    }
  }

  // Freshness. A drill played in the last two hours is not the answer to
  // "what now", however badly it went.
  const now = Date.now();
  for (const r of out) {
    const age = now - lastPlayed(p, r.drill);
    if (age < 2 * 3600000) r.priority -= 30;
    else if (age < 12 * 3600000) r.priority -= 10;
  }

  return out.sort((a, b) => b.priority - a.priority).slice(0, count);
};

/* -------------------------------------------------------------- insights */

export interface Insight {
  id: string;
  kind: 'good' | 'warn' | 'info';
  title: string;
  body: string;
  drill?: DrillId;
}

/**
 * Findings worth interrupting someone for.
 *
 * Every one of these is a comparison between two things the profile actually
 * measured. There is no template that fires on an empty profile.
 */
export const insights = (p: Profile): Insight[] => {
  const out: Insight[] = [];

  // A mistake that is genuinely going away.
  for (const e of errorRollup(p, 7)) {
    if (e.previousRate === null || e.runs < 2) continue;
    const drop = e.previousRate - e.rate;
    if (drop > 0.05) {
      out.push({
        id: `fixed-${e.code}`,
        kind: 'good',
        title: `${ERRORS[e.code].label} is fading`,
        body: `Down from ${Math.round(e.previousRate * 100)}% to ${Math.round(
          e.rate * 100,
        )}% of opportunities across ${e.runs} runs. Keep the drill in rotation until it stops appearing at all.`,
        drill: ERRORS[e.code].fix,
      });
    } else if (drop < -0.06) {
      out.push({
        id: `worse-${e.code}`,
        kind: 'warn',
        title: `${ERRORS[e.code].label} is coming back`,
        body: `Up from ${Math.round(e.previousRate * 100)}% to ${Math.round(e.rate * 100)}% this week, mostly in ${
          DRILLS[e.worstDrill].name
        }. ${ERRORS[e.code].when}`,
        drill: ERRORS[e.code].fix,
      });
    }
  }

  // A mechanic that exists in isolation and not in a fight.
  for (const r of pressureRetention(p)) {
    if (r.retention > 0.8 || r.retention <= 0) continue;
    out.push({
      id: `pressure-${r.axis}`,
      kind: 'warn',
      title: `${AXIS_LABEL[r.axis]} does not survive contact`,
      body: `You score ${Math.round(r.isolated * 100)}% on ${AXIS_LABEL[
        r.axis
      ].toLowerCase()} drills and ${Math.round(
        r.live * 100,
      )}% when something is fighting back. That is a ${Math.round(
        (1 - r.retention) * 100,
      )}% drop under pressure — the mechanic is learned, the habit is not.`,
    });
    break;
  }

  // A plateau, named.
  const pl = plateaus(p)[0];
  if (pl) {
    out.push({
      id: `plateau-${pl.drill}`,
      kind: 'info',
      title: `${DRILLS[pl.drill].name} has plateaued`,
      body: `${pl.runs} runs within a few points of ${Math.round(pl.level * 100)}. ${
        pl.limiter
          ? `${ERRORS[pl.limiter].label} is what is capping it — ${DRILLS[pl.detour].name} trains that directly.`
          : `A detour into ${DRILLS[pl.detour].name} will move it further than another attempt will.`
      }`,
      drill: pl.detour,
    });
  }

  // Real growth, stated plainly.
  const gains = axisGains(p, 30);
  const top = gains[0];
  if (top && top.delta > 40) {
    out.push({
      id: `growth-${top.axis}`,
      kind: 'good',
      title: `${top.label} is climbing fast`,
      body: `+${Math.round(top.delta)} rating in thirty days, from ${Math.round(top.from)} to ${Math.round(
        top.to,
      )}. It is the fastest-moving thing in your profile.`,
    });
  }

  return out.slice(0, 4);
};

/* ---------------------------------------------------------- style read */

/**
 * The profile, in a sentence or three.
 *
 * A radar chart says the same thing, but nobody reads a radar chart and
 * concludes "my awareness is what is stopping me".
 */
export const styleRead = (p: Profile): string[] => {
  const rated = SKILL_AXES.filter((a) => p.samples[a] > 0);
  if (rated.length < 3) return [];
  const sorted = [...rated].sort((a, b) => p.ratings[b] - p.ratings[a]);
  const best = sorted[0];
  const second = sorted[1];
  const worst = sorted[sorted.length - 1];
  const lines: string[] = [];

  const spread = p.ratings[best] - p.ratings[worst];
  lines.push(
    `Strongest at ${AXIS_LABEL[best].toLowerCase()} (${Math.round(p.ratings[best])}), with ${AXIS_LABEL[
      second
    ].toLowerCase()} close behind.`,
  );
  lines.push(
    spread > 400
      ? `Your largest limiting factor is ${AXIS_LABEL[worst].toLowerCase()} at ${Math.round(
          p.ratings[worst],
        )} — ${Math.round(spread)} points below your best, and the gap is what your overall rating is paying for.`
      : `The profile is unusually even: ${Math.round(spread)} points separate your best axis from your worst, so progress now comes from raising the whole thing rather than patching a hole.`,
  );

  const ret = pressureRetention(p)[0];
  if (ret && ret.retention < 0.85) {
    lines.push(
      `${AXIS_LABEL[ret.axis]} deteriorates significantly once something is fighting back — ${Math.round(
        ret.isolated * 100,
      )}% isolated against ${Math.round(ret.live * 100)}% live.`,
    );
  }
  return lines;
};
