/**
 * The ranked ladder.
 *
 * This is a rank for *trainer mechanics* — the specific motor skills these
 * drills measure. It is deliberately not a prediction of anyone's League
 * ranked tier, and the UI says so wherever the rank appears.
 *
 * The classes are APEX's own, on purpose. Borrowing League's tier names put a
 * claim in the player's head that this trainer has no evidence for — "my
 * mechanics are Platinum" is a sentence about a ranked ladder these drills
 * have never measured. A player who reads "REFINED II" learns what APEX
 * actually knows: that their execution in these drills is refined, at this
 * difficulty, on this day. The bands, the divisions, the thresholds and the
 * emblems are unchanged; only the words are ours now.
 */

export const TIERS = [
  'FOUNDATION',
  'DEVELOPING',
  'PROFICIENT',
  'CALIBRATED',
  'REFINED',
  'ADVANCED',
  'EXPERT',
  'ELITE',
  'PEERLESS',
  'APEX',
] as const;

export type Tier = (typeof TIERS)[number];

/** Rating at which each class begins. Classes below ELITE are 400 wide. */
export const TIER_FLOOR: Record<Tier, number> = {
  FOUNDATION: 0,
  DEVELOPING: 400,
  PROFICIENT: 800,
  CALIBRATED: 1200,
  REFINED: 1600,
  ADVANCED: 2000,
  EXPERT: 2400,
  ELITE: 2800,
  PEERLESS: 3100,
  APEX: 3350,
};

export const RATING_MAX = 3600;

export interface RankInfo {
  tier: Tier;
  /** 1..4 where 1 is the highest division. Zero for ELITE and above. */
  division: number;
  /** "REFINED II" or "ELITE". */
  label: string;
  short: string;
  /** 0..1 progress through the current division (or through Master+ band). */
  progress: number;
  /** Rating needed for the next division/tier, or null at the top. */
  nextAt: number | null;
  tierIndex: number;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV'];

export const rankFromRating = (ratingRaw: number): RankInfo => {
  const rating = Math.max(0, Math.min(RATING_MAX, ratingRaw));
  let tier: Tier = 'FOUNDATION';
  for (const t of TIERS) if (rating >= TIER_FLOOR[t]) tier = t;
  const tierIndex = TIERS.indexOf(tier);

  // The top three classes have no divisions: at that point the number is the
  // interesting part and a roman numeral beside it is noise.
  if (tier === 'ELITE' || tier === 'PEERLESS' || tier === 'APEX') {
    const floor = TIER_FLOOR[tier];
    const next = tier === 'APEX' ? null : TIER_FLOOR[TIERS[tierIndex + 1]];
    const span = (next ?? RATING_MAX) - floor;
    return {
      tier,
      division: 0,
      label: tier,
      short: tier === 'PEERLESS' ? 'PRL' : tier.slice(0, 3),
      progress: span > 0 ? Math.min(1, (rating - floor) / span) : 1,
      nextAt: next,
      tierIndex,
    };
  }

  const floor = TIER_FLOOR[tier];
  const within = rating - floor;
  const divIdx = Math.min(3, Math.floor(within / 100)); // 0..3
  const division = 4 - divIdx; // IV at the bottom, I at the top
  const divFloor = floor + divIdx * 100;
  return {
    tier,
    division,
    label: `${tier} ${ROMAN[division]}`,
    short: `${tier.slice(0, 3)}${division}`,
    progress: (rating - divFloor) / 100,
    nextAt: divFloor + 100,
    tierIndex,
  };
};

/** True when `b` is a strictly higher rank than `a`. */
export const isPromotion = (a: number, b: number): boolean => {
  const ra = rankFromRating(a);
  const rb = rankFromRating(b);
  if (rb.tierIndex !== ra.tierIndex) return rb.tierIndex > ra.tierIndex;
  if (ra.division === 0 || rb.division === 0) return false;
  return rb.division < ra.division;
};

export const isDemotion = (a: number, b: number): boolean => isPromotion(b, a);

/** Rough share of players below this rating — used for the "TOP x%" readout. */
export const percentileForRating = (rating: number): number => {
  // A deliberately conservative curve: the APEX class should feel rare.
  const pts: [number, number][] = [
    [0, 0.0],
    [400, 0.07],
    [800, 0.2],
    [1200, 0.42],
    [1600, 0.64],
    [2000, 0.79],
    [2400, 0.9],
    [2800, 0.965],
    [3100, 0.99],
    [3350, 0.998],
    [3600, 0.9999],
  ];
  for (let i = 1; i < pts.length; i++) {
    if (rating <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const t = (rating - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  return 0.9999;
};
