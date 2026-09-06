/**
 * The two averages the lab reports with, kept apart on purpose.
 *
 * Nearly every figure a mode prints is a median: one 900ms fumble should not
 * move a number that describes a hundred clean presses, and a mean is exactly
 * the statistic that lets it. The mean is kept for the samples where the
 * outlier *is* the thing being measured — a heading error, where being wildly
 * wrong once is the whole story.
 */

/** The middle of a set of samples. */
export const median = (xs: readonly number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

export const mean = (xs: readonly number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
