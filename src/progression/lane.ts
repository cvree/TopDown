/**
 * The lane ladder.
 *
 * Two things live here and they are both deliberately data rather than
 * behaviour: the five opponents the lane can be played against, and what the
 * profile remembers about each of them.
 *
 * They are kept out of the drill because they are read by three quite
 * different places — the menu, which draws the ladder; the drill, which turns
 * a tier into a difficulty; and the profile, which stores a record per tier —
 * and a menu that had to import a simulation to print a card would drag the
 * whole engine into the first screen of the client.
 *
 * The records are kept apart from the ordinary `bests` map for the same reason
 * the survive records are: a creep score set against IRON and one set against
 * CHALLENGER are not the same number measured twice. Folding them together
 * would quietly retire a real record with an easy one, which is the single
 * most demoralising thing a trainer can do.
 */

export interface LaneTier {
  id: string;
  label: string;
  /** What this opponent is, in one line, on the menu. */
  blurb: string;
  /** 0..1 — the number the whole difficulty system is expressed in. */
  difficulty: number;
  /** The creep score a minute this tier holds, and therefore your bar. */
  expect: number;
  accent: string;
}

/**
 * Five opponents.
 *
 * Named after ranks because that is the language a player thinks in, and each
 * calibrated to a creep score a minute that a laner of that rank genuinely
 * holds. The number on the card is what the bot farms if you leave it alone,
 * and it is also the bar the mode holds you to.
 *
 * The top of the ladder is meant to be unpleasant. A challenger-tier laner
 * takes essentially every minion, punishes almost every last hit you commit
 * to, holds the wave where it wants it, saves the Peacemaker for the moment
 * you cannot dodge it, counts lethal before it walks at you, and will come
 * under your turret to finish the job. Nothing about it is inflated — it has
 * your health bar and your damage — and there is no way to beat it except to
 * farm well while being harassed, which is the entire point of the mode.
 */
export const LANE_TIERS: LaneTier[] = [
  {
    id: 'iron',
    label: 'IRON',
    blurb: 'Sees the minion late and swings at healthy ones. Shoves its own wave into your turret and hands you the lane.',
    difficulty: 0.06,
    expect: 3.4,
    accent: '#9aa4b2',
  },
  {
    id: 'silver',
    label: 'SILVER',
    blurb: 'Farms most of what it can reach and sometimes notices you walking up. Trades without counting the wave.',
    difficulty: 0.32,
    expect: 5.2,
    accent: '#7fd2ff',
  },
  {
    id: 'gold',
    label: 'GOLD',
    blurb: 'Takes its farm, punishes the last hits you telegraph, and stops walking into your minions to do it.',
    difficulty: 0.55,
    expect: 6.8,
    accent: '#ffd166',
  },
  {
    id: 'diamond',
    label: 'DIAMOND',
    blurb: 'Near-perfect farm, holds the wave on its own side, and spends the Peacemaker on targets that cannot dodge it.',
    difficulty: 0.78,
    expect: 8.4,
    accent: '#8f7bff',
  },
  {
    id: 'challenger',
    label: 'CHALLENGER',
    blurb: 'Misses nothing, punishes everything, freezes you off the wave, counts lethal, and dives you when it is right.',
    difficulty: 1,
    expect: 10.2,
    accent: '#ff4d6d',
  },
];

/** The tier a raw difficulty belongs to — whichever is nearest. */
export const laneTierOf = (difficulty: number): LaneTier =>
  LANE_TIERS.reduce((best, t) =>
    Math.abs(t.difficulty - difficulty) < Math.abs(best.difficulty - difficulty) ? t : best,
  );

/** How long a lane runs for. The menu offers these three and nothing else. */
export interface LaneLength {
  id: string;
  label: string;
  seconds: number;
  blurb: string;
}

/**
 * Three lengths, and the reason there are three.
 *
 * A trainer lives or dies on how cheap a repetition is, and ten minutes is not
 * cheap. So the mode is a spammer first: two and a half minutes is five waves
 * and a cannon, long enough to contain a real lane and short enough to run
 * again the moment it goes badly — and running it again is one key. The longer
 * two exist because some things only happen later: the first ultimate at level
 * six, a wave that has been held for three minutes, the moment somebody is two
 * levels down and the lane is simply over.
 */
export const LANE_LENGTHS: LaneLength[] = [
  { id: 'short', label: 'FIVE WAVES', seconds: 150, blurb: '2:30 · one cannon' },
  { id: 'mid', label: 'FIRST SIX', seconds: 330, blurb: '5:30 · through level 6' },
  { id: 'full', label: 'FULL LANE', seconds: 540, blurb: '9:00 · to ten minutes' },
];

export const laneLengthOf = (seconds: number): LaneLength =>
  LANE_LENGTHS.reduce((best, l) =>
    Math.abs(l.seconds - seconds) < Math.abs(best.seconds - seconds) ? l : best,
  );

/** What the profile keeps about one tier of the ladder. */
export interface LaneTierRecord {
  runs: number;
  bestScore: number;
  /** The number a lane is actually read in. */
  bestCsPerMin: number;
  /** The best creep-score difference against that opponent. A win is above 0. */
  bestCsLead: number;
  /** Lanes finished with more gold than the opponent. */
  wins: number;
  at: number;
}

export interface LaneProgress {
  tiers: Record<string, LaneTierRecord>;
}

const emptyRecord = (): LaneTierRecord => ({
  runs: 0,
  bestScore: 0,
  bestCsPerMin: 0,
  bestCsLead: -999,
  wins: 0,
  at: 0,
});

export const emptyLaneProgress = (): LaneProgress => ({
  tiers: Object.fromEntries(LANE_TIERS.map((t) => [t.id, emptyRecord()])),
});

/**
 * Repair a stored ladder rather than merging it.
 *
 * A profile written before this mode existed, or before a tier did, has to
 * come back playable — the client opens on the menu that draws these, and a
 * missing tier there is a blank card and a thrown exception rather than a
 * missing record.
 */
export const normalizeLaneProgress = (raw: unknown): LaneProgress => {
  const out = emptyLaneProgress();
  const stored = (raw as LaneProgress | undefined)?.tiers;
  if (!stored || typeof stored !== 'object') return out;
  for (const tier of LANE_TIERS) {
    const rec = (stored as Record<string, Partial<LaneTierRecord>>)[tier.id];
    if (!rec || typeof rec !== 'object') continue;
    const num = (v: unknown, fallback: number): number =>
      Number.isFinite(Number(v)) ? Number(v) : fallback;
    out.tiers[tier.id] = {
      runs: Math.max(0, Math.round(num(rec.runs, 0))),
      bestScore: Math.max(0, num(rec.bestScore, 0)),
      bestCsPerMin: Math.max(0, num(rec.bestCsPerMin, 0)),
      bestCsLead: num(rec.bestCsLead, -999),
      wins: Math.max(0, Math.round(num(rec.wins, 0))),
      at: Math.max(0, num(rec.at, 0)),
    };
  }
  return out;
};

export interface LaneRunSummary {
  tier: string;
  score: number;
  csPerMin: number;
  csLead: number;
  goldLead: number;
}

/** Fold one finished lane into the ladder, and say whether anything moved. */
export const applyLaneRun = (
  progress: LaneProgress,
  run: LaneRunSummary,
): { record: LaneTierRecord; improved: boolean } => {
  const rec = progress.tiers[run.tier] ?? emptyRecord();
  const improved = run.csPerMin > rec.bestCsPerMin || run.score > rec.bestScore;
  progress.tiers[run.tier] = {
    runs: rec.runs + 1,
    bestScore: Math.max(rec.bestScore, run.score),
    bestCsPerMin: Math.max(rec.bestCsPerMin, run.csPerMin),
    bestCsLead: Math.max(rec.bestCsLead, run.csLead),
    wins: rec.wins + (run.goldLead > 0 ? 1 : 0),
    at: improved ? Date.now() : rec.at,
  };
  return { record: progress.tiers[run.tier], improved };
};
