/**
 * Mathematical anomaly isolation and fuzzy deduplication algorithms.
 */

export function calculateMedian(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Calculates Modified Z-Score using Median Absolute Deviation (MAD).
 * M_i = 0.6745 * |x_i - median| / MAD
 * Highly resistant to extreme outliers compared to standard mean-based Z-score.
 */
export function calculateModifiedZScoreOutliers(
  nums: number[],
  threshold = 3.5,
): { isOutlier: boolean; value: number; zScore: number }[] {
  if (nums.length < 3) {
    return nums.map((v) => ({ isOutlier: false, value: v, zScore: 0 }));
  }

  const med = calculateMedian(nums);
  const absDeviations = nums.map((x) => Math.abs(x - med));
  const mad = calculateMedian(absDeviations);

  // If MAD is zero (e.g. repeated numbers), fallback to mean absolute deviation
  const safeMad = mad === 0 ? absDeviations.reduce((a, b) => a + b, 0) / absDeviations.length : mad;

  return nums.map((val, idx) => {
    const diff = absDeviations[idx]!;
    const zScore = safeMad > 0 ? (0.6745 * diff) / safeMad : 0;
    return {
      value: val,
      zScore,
      isOutlier: zScore > threshold,
    };
  });
}

/**
 * Tukey's Fences IQR Outlier Detection:
 * Flags values < Q1 - k*IQR or > Q3 + k*IQR
 */
export function calculateTukeyIQROutliers(
  nums: number[],
  multiplier = 1.5,
): { isOutlier: boolean; value: number }[] {
  if (nums.length < 4) {
    return nums.map((v) => ({ isOutlier: false, value: v }));
  }

  const sorted = [...nums].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]!;
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;

  if (iqr === 0) {
    return nums.map((v) => ({ isOutlier: false, value: v }));
  }

  const lowerBound = q1 - multiplier * iqr;
  const upperBound = q3 + multiplier * iqr;

  return nums.map((val) => ({
    value: val,
    isOutlier: val < lowerBound || val > upperBound,
  }));
}

/**
 * Character 3-gram Jaccard similarity for near-duplicate text detection.
 */
export function calculateNgramSimilarity(s1: string, s2: string, n = 3): number {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const a = s1.toLowerCase().trim();
  const b = s2.toLowerCase().trim();
  if (a === b) return 1;
  if (a.length < n || b.length < n) return 0;

  const setA = new Set<string>();
  for (let i = 0; i <= a.length - n; i++) setA.add(a.slice(i, i + n));

  const setB = new Set<string>();
  for (let i = 0; i <= b.length - n; i++) setB.add(b.slice(i, i + n));

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}
