import type { DrillId } from '../drills/catalog';
import { isDrillId } from '../drills/catalog';
import type { RunMode } from '../drills/modes';
import type { ReactionTestId, WarmupProgress } from './warmup';

/**
 * THE BENCHMARKS.
 *
 * Every score elsewhere in this client is measured at a difficulty the ladder
 * chose for you, which is right for practice and useless for comparison: your
 * 40,000 and a friend's 40,000 were played against different floors. KovaaK's
 * solved this years ago with benchmarks — a fixed set of scenarios, played at
 * fixed settings, with published thresholds — and this is that, for the
 * pieces of a lane.
 *
 * Every benchmark run is:
 *
 *  - **the same scenario** — one seed per benchmark, printed as a code, so the
 *    wave, the spawns and the opening are identical for everyone;
 *  - **the same difficulty** — 0.5, the middle of the range, whatever your
 *    ladder says;
 *  - **the same length** — a PLAY run, one minute.
 *
 * The thresholds are PROVISIONAL, and the screen says so. They are anchored
 * on the trainer's own scripted reference player — MASTER is exactly what it
 * scores on each scenario, and a test holds that true — rather than on the
 * distribution of real players, which is what they should be cut from and
 * will be once there is one. The research is blunt about this: a rank label
 * made of hand-authored cutoffs is a claim, and a claim should be labelled.
 *
 * The tier names are deliberately not League's. This is a benchmark of this
 * trainer, not an estimate of anybody's rank in a game it is not affiliated
 * with, and naming it IRON to CHALLENGER would pretend otherwise.
 */

export const BENCH_TIERS = ['ROOKIE', 'ADEPT', 'VETERAN', 'ELITE', 'MASTER', 'APEX'] as const;
export type BenchTier = (typeof BENCH_TIERS)[number];

export const BENCH_TIER_COLORS: Record<BenchTier, string> = {
  ROOKIE: '#8a8f98',
  ADEPT: '#4fd47c',
  VETERAN: '#38e0d0',
  ELITE: '#58a6ff',
  MASTER: '#a878ff',
  APEX: '#f0c247',
};

/** The difficulty every benchmark run is played at. */
export const BENCH_DIFFICULTY = 0.5;

export type BenchKind = 'drill' | 'reaction';

export interface BenchScenario {
  id: string;
  label: string;
  /** The skill this row measures, in two or three words. */
  skill: string;
  kind: BenchKind;
  drill?: DrillId;
  test?: ReactionTestId;
  seed?: number;
  /** Lower is better for the reaction rows; higher for the drills. */
  lowerIsBetter: boolean;
  /** Six thresholds, ROOKIE → APEX. */
  thresholds: readonly number[];
  unit: string;
}

/**
 * Thresholds as fractions of the reference player's score on the scenario.
 *
 * MASTER is the reference itself. APEX is a margin past it — except where the
 * reference is already at the ceiling of what the mode can pay, as on Pick a
 * Card, where the reference plays a perfect wheel: there APEX *is* the
 * reference, and MASTER sits three per cent under it.
 */
const PICK_MASTER = 0.97;
const FRACTIONS = [0.2, 0.4, 0.6, 0.8, 1, 1.15];
const cut = (reference: number, apex = 1.15): number[] =>
  // Floored, so the reference always clears its own MASTER line.
  FRACTIONS.map((f, i) => Math.floor(((i === 5 ? apex : f) * reference) / 100) * 100);

/**
 * The reference player's score on each scenario at its canonical seed.
 *
 * Measured by the simulation harness and pinned there, so a change to a mode
 * that moves what competent play scores fails a test instead of silently
 * making every benchmark easier or harder.
 */
export const BENCH_REFERENCE: Record<string, number> = {
  range: 34823,
  tumble: 71940,
  bolts: 70277,
  condemn: 51876,
  sheriff: 33079,
  pick: 19844,
  dagger: 16390,
};

export const BENCH_SCENARIOS: BenchScenario[] = [
  { id: 'range', label: 'RANGE', skill: 'knowing your reach', kind: 'drill', drill: 'rangecheck', seed: 26180001, lowerIsBetter: false, thresholds: cut(BENCH_REFERENCE.range), unit: 'pts' },
  { id: 'tumble', label: 'TUMBLE', skill: 'moving between shots', kind: 'drill', drill: 'vayneTumble', seed: 26180002, lowerIsBetter: false, thresholds: cut(BENCH_REFERENCE.tumble), unit: 'pts' },
  { id: 'bolts', label: 'SILVER BOLTS', skill: 'finishing a target', kind: 'drill', drill: 'vayneBolts', seed: 26180003, lowerIsBetter: false, thresholds: cut(BENCH_REFERENCE.bolts), unit: 'pts' },
  { id: 'condemn', label: 'CONDEMN', skill: 'angles before fights', kind: 'drill', drill: 'vayneCondemn', seed: 26180004, lowerIsBetter: false, thresholds: cut(BENCH_REFERENCE.condemn), unit: 'pts' },
  { id: 'sheriff', label: 'SHERIFF', skill: 'reading an opponent', kind: 'drill', drill: 'caitlynDodge', seed: 26180005, lowerIsBetter: false, thresholds: cut(BENCH_REFERENCE.sheriff), unit: 'pts' },
  { id: 'pick', label: 'PICK A CARD', skill: 'choosing on a clock', kind: 'drill', drill: 'tfPick', seed: 26180006, lowerIsBetter: false, thresholds: cut(BENCH_REFERENCE.pick * PICK_MASTER, 1 / PICK_MASTER), unit: 'pts' },
  { id: 'dagger', label: 'PREPARATION', skill: 'being there when it lands', kind: 'drill', drill: 'katPrep', seed: 26180007, lowerIsBetter: false, thresholds: cut(BENCH_REFERENCE.dagger), unit: 'pts' },
  // Browser, screen and mouse included — so these two compare you with
  // yourself far better than with anybody else, and the screen says so.
  { id: 'see', label: 'SEE IT', skill: 'raw reaction', kind: 'reaction', test: 'visual', lowerIsBetter: true, thresholds: [420, 350, 300, 265, 240, 220], unit: 'ms' },
  { id: 'choose', label: 'CHOOSE IT', skill: 'reaction with a choice', kind: 'reaction', test: 'choice', lowerIsBetter: true, thresholds: [700, 590, 510, 450, 405, 370], unit: 'ms' },
];

/**
 * The seeds are the scenarios. A benchmark played on any other seed is a
 * different minute, so these are pinned alongside the thresholds.
 */
export const benchFor = (drill: DrillId, seed: number): BenchScenario | null =>
  BENCH_SCENARIOS.find((b) => b.kind === 'drill' && b.drill === drill && b.seed === seed) ?? null;

export interface BenchRecord {
  best: number;
  at: number;
  runs: number;
}

export type BenchRecords = Partial<Record<string, BenchRecord>>;

export const normalizeBench = (raw: unknown): BenchRecords => {
  const out: BenchRecords = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const b of BENCH_SCENARIOS) {
    if (b.kind !== 'drill') continue;
    const r = (raw as Record<string, { best?: unknown; at?: unknown; runs?: unknown }>)[b.id];
    if (!r || typeof r !== 'object') continue;
    const best = Number(r.best);
    if (!Number.isFinite(best) || best < 0) continue;
    out[b.id] = { best, at: Number(r.at) || 0, runs: Math.max(1, Math.floor(Number(r.runs) || 1)) };
  }
  return out;
};

/** Record a finished benchmark run. True when it beat the record. */
export const recordBench = (recs: BenchRecords, id: string, score: number, t = Date.now()): boolean => {
  const cur = recs[id];
  if (!cur) {
    recs[id] = { best: score, at: t, runs: 1 };
    return true;
  }
  cur.runs++;
  if (score > cur.best) {
    cur.best = score;
    cur.at = t;
    return true;
  }
  return false;
};

/** The value a scenario is currently scored on, or null if never played. */
export const benchValue = (b: BenchScenario, recs: BenchRecords, warmup: WarmupProgress): number | null => {
  if (b.kind === 'reaction' && b.test) return warmup.reaction[b.test]?.best ?? null;
  return recs[b.id]?.best ?? null;
};

/**
 * Where a value sits: the tier reached (-1 for below ROOKIE) and progress
 * toward the next one, 0..1 — which is also the fractional part of the
 * scenario's points.
 */
export const benchPlace = (b: BenchScenario, value: number | null): { tier: number; toNext: number; points: number } => {
  if (value === null || !Number.isFinite(value)) return { tier: -1, toNext: 0, points: 0 };
  const t = b.thresholds;
  const beats = (i: number) => (b.lowerIsBetter ? value <= t[i] : value >= t[i]);
  let tier = -1;
  for (let i = 0; i < t.length; i++) if (beats(i)) tier = i;
  if (tier === t.length - 1) return { tier, toNext: 1, points: t.length };
  // Below ROOKIE, progress is measured from zero (or from twice the ROOKIE
  // time on the reaction rows) so the first minute still moves the bar.
  const from = tier < 0 ? (b.lowerIsBetter ? t[0] * 2 : 0) : t[tier];
  const to = t[tier + 1];
  const toNext = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return { tier, toNext, points: tier + 1 + toNext };
};

export interface BenchSummary {
  /** Sum of points, out of `max`. A continuous number that moves every run. */
  points: number;
  max: number;
  /**
   * The overall tier: the highest one reached on at least six of the nine
   * scenarios. Six rather than all nine so a row or two you have never played
   * does not hold the rest hostage, and rather than a mean so the badge
   * cannot be bought with two extraordinary rows.
   */
  tier: number;
  played: number;
}

export const BENCH_QUORUM = 6;

export const benchSummary = (recs: BenchRecords, warmup: WarmupProgress): BenchSummary => {
  const places = BENCH_SCENARIOS.map((b) => benchPlace(b, benchValue(b, recs, warmup)));
  let tier = -1;
  for (let i = 0; i < BENCH_TIERS.length; i++) {
    if (places.filter((p) => p.tier >= i).length >= BENCH_QUORUM) tier = i;
  }
  return {
    points: Math.round(places.reduce((a, p) => a + p.points, 0) * 10) / 10,
    max: BENCH_SCENARIOS.length * BENCH_TIERS.length,
    tier,
    played: BENCH_SCENARIOS.filter((b) => benchValue(b, recs, warmup) !== null).length,
  };
};

// ================================================================== codes

/**
 * SCENARIO CODES.
 *
 * Rocket League's training packs spread because a code is a thing you can
 * paste into a chat. Every run here is already a seed and a difficulty, so a
 * code is just those, written down: the mode, the shape of run, the
 * difficulty, the seed and a check letter so a typo fails loudly instead of
 * starting a different minute.
 *
 * The same code opens the same *start* — the same spawns, the same wave, the
 * same opening move from whoever is on the other side. After that the other
 * side answers what you do, so two players on one code are comparable in the
 * way two runners on one course are, not in the way two recordings are.
 *
 * Readable on purpose: `vayneTumble-P50-3f9a2c-K`. A player should be able to
 * see which mode a friend has sent them before pasting it.
 */
const MODE_CHAR: Partial<Record<RunMode, string>> = { play: 'P', survive: 'S' };
const CHAR_MODE: Record<string, RunMode> = { P: 'play', S: 'survive' };
const CHECK = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const checkLetter = (body: string): string => {
  let h = 7;
  for (let i = 0; i < body.length; i++) h = (h * 31 + body.charCodeAt(i)) >>> 0;
  return CHECK[h % CHECK.length];
};

export interface ScenarioCode {
  drill: DrillId;
  mode: RunMode;
  /** 0..1, stored to the hundredth. */
  difficulty: number;
  seed: number;
}

/** Null for a run that has no code — the lab's moving floors, and the lane. */
export const encodeScenario = (s: ScenarioCode): string | null => {
  const m = MODE_CHAR[s.mode];
  if (!m || s.drill === 'lanePhase') return null;
  const d = Math.max(0, Math.min(100, Math.round(s.difficulty * 100)));
  const body = `${s.drill}-${m}${d}-${(s.seed >>> 0).toString(36)}`;
  return `${body}-${checkLetter(body)}`;
};

export const decodeScenario = (raw: string): ScenarioCode | { error: string } => {
  const code = raw.trim().replace(/\s+/g, '');
  const parts = code.split('-');
  if (parts.length !== 4) return { error: 'A code has four parts separated by dashes.' };
  const [drill, md, seed36, check] = parts;
  const body = `${drill}-${md}-${seed36}`;
  if (checkLetter(body) !== check.toUpperCase()) return { error: 'That code has a typo in it — the check letter does not match.' };
  if (!isDrillId(drill)) return { error: `No mode called “${drill}” in this build.` };
  const mode = CHAR_MODE[md[0]?.toUpperCase()];
  const d = Number(md.slice(1));
  if (!mode || !Number.isInteger(d) || d < 0 || d > 100) return { error: 'The middle part should look like P50 or S35.' };
  const seed = parseInt(seed36, 36);
  if (!Number.isFinite(seed) || seed < 0 || seed > 0xffffffff) return { error: 'The seed part is not a number this build can read.' };
  return { drill, mode, difficulty: d / 100, seed };
};

export const benchCode = (b: BenchScenario): string | null =>
  b.kind === 'drill' && b.drill && b.seed !== undefined
    ? encodeScenario({ drill: b.drill, mode: 'play', difficulty: BENCH_DIFFICULTY, seed: b.seed })
    : null;
