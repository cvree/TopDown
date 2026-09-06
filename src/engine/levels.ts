/**
 * Levels — the clock the first ten minutes are actually played on.
 *
 * Every other mode in this trainer hands you a champion at a fixed level,
 * because a sixty second rep about one gesture has no business changing the
 * numbers underneath it halfway through. A lane phase is the opposite: the
 * whole of it is a race between two people to arrive at the next number first,
 * and every fight in it is decided before it starts by who is standing there
 * with the extra point.
 *
 * So the curve is League's, exactly, and both champions in the lane are built
 * off it:
 *
 *  - **The thresholds.** Level two costs 280 experience and each level after
 *    that costs a hundred more than the last — 380, 480, 580 — which is what
 *    makes the early levels arrive in a rush and the later ones crawl.
 *  - **The growth formula.** League does not add a flat amount per level; it
 *    adds `growth × (n − 1) × (0.7025 + 0.0175 × (n − 1))`, which starts below
 *    the stated growth figure and ends above it. That curve is why level one
 *    is so much flimsier than the tooltip suggests and level nine so much
 *    sturdier.
 *
 * Nothing here is a balance decision. It is arithmetic, written down once, so
 * that a Vayne at level three in this client is the same Vayne at level three
 * that the player is about to go and lose a lane with.
 */

/** Experience needed to leave each level, League's own table. */
export const XP_TO_NEXT = (level: number): number => 180 + 100 * level;

/** Cumulative experience at which each level is reached. Index 0 is level 1. */
export const XP_THRESHOLDS: number[] = (() => {
  const out = [0];
  let total = 0;
  for (let level = 1; level < 18; level++) {
    total += XP_TO_NEXT(level);
    out.push(total);
  }
  return out;
})();

export const MAX_LEVEL = 18;

/** The level a given amount of banked experience buys. */
export const levelFromXp = (xp: number): number => {
  let level = 1;
  while (level < MAX_LEVEL && xp >= XP_THRESHOLDS[level]) level++;
  return level;
};

/** How far through the current level a given amount of experience is, 0..1. */
export const levelProgress = (xp: number): number => {
  const level = levelFromXp(xp);
  if (level >= MAX_LEVEL) return 1;
  const from = XP_THRESHOLDS[level - 1];
  const to = XP_THRESHOLDS[level];
  return Math.max(0, Math.min(1, (xp - from) / Math.max(1, to - from)));
};

/**
 * A stat at a level, on League's growth curve.
 *
 * `base` is the level-one value and `growth` the per-level figure from the
 * champion's own stat block. The bracket is League's, unmodified.
 */
export const grown = (base: number, growth: number, level: number): number => {
  const n = Math.max(1, Math.min(MAX_LEVEL, Math.round(level))) - 1;
  return base + growth * n * (0.7025 + 0.0175 * n);
};

/**
 * Attack speed, which League grows as a percentage of the *base* rather than
 * as a flat addition — so a champion with a low base and a high growth is
 * still slow at level one, which is exactly the thing a lane phase has to be
 * honest about.
 */
export const grownAttackSpeed = (base: number, growthPct: number, level: number): number => {
  const n = Math.max(1, Math.min(MAX_LEVEL, Math.round(level))) - 1;
  return base * (1 + (growthPct / 100) * n * (0.7025 + 0.0175 * n));
};

/**
 * How experience is shared out in a solo lane.
 *
 * League grants a minion's experience to every enemy champion inside this
 * radius of it when it dies, split between them; in a one-against-one lane
 * that means whoever was close enough gets all of it, and whoever stepped away
 * to be safe gets none of it. That trade — safety against experience — is one
 * of the two or three real decisions in the first ten minutes, and it only
 * exists because this number is finite.
 */
export const XP_RADIUS = 1400;
