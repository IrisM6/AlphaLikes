/**
 * Percentile thresholds, used when colouring by rank instead of by fixed
 * cut-offs.
 *
 * The population is the set of like counts currently loaded in the item tree,
 * so "top 20%" means the top 20% of what the user is actually looking at.
 * Everything here is pure.
 */

/** Below this many values a percentile is noise, so nothing is returned. */
export const MIN_QUANTILE_SAMPLE = 5;

/**
 * Linear-interpolated percentile (the method spreadsheets call
 * `PERCENTILE.INC`). `p` is 0-100. `values` need not be sorted.
 */
export function percentile(values: number[], p: number): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) return null;

  const clamped = Math.min(100, Math.max(0, p));
  if (sorted.length === 1) return sorted[0];

  const rank = (clamped / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];

  const weight = rank - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

export interface QuantileThresholds {
  low: number;
  high: number;
  /** How many values the thresholds were derived from. */
  sampleSize: number;
}

/**
 * Derives the high/low cut-offs from a population.
 *
 * Returns `null` when the sample is too small or when it is degenerate (every
 * item the same count), in which case the caller keeps using fixed thresholds
 * rather than colouring everything one way.
 */
export function quantileThresholds(
  values: number[],
  lowPercent: number,
  highPercent: number,
): QuantileThresholds | null {
  const clean = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (clean.length < MIN_QUANTILE_SAMPLE) return null;

  const low = percentile(clean, lowPercent);
  const high = percentile(clean, highPercent);
  if (low === null || high === null) return null;
  if (high <= low) return null;

  return {
    low: Math.floor(low),
    high: Math.ceil(high),
    sampleSize: clean.length,
  };
}
