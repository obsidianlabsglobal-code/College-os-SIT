/** Chart data contract: parts of one bounded whole. Counts are exact; widths are derived, never stored. */
export type Segment = { label: string; value: number; tone: 1 | 2 | 3 };

/** Percent widths for each segment of `total`; the remainder is the unfilled track. */
export function segmentWidths(parts: Segment[], total: number) {
  if (!Number.isInteger(total) || total < 0) throw new RangeError("Total must be a non-negative integer.");
  if (parts.some(p => !Number.isInteger(p.value) || p.value < 0)) throw new RangeError("Segment values must be non-negative integers.");
  const sum = parts.reduce((s, p) => s + p.value, 0);
  if (sum > total) throw new RangeError("Segments exceed the total.");
  return parts.map(p => total === 0 ? 0 : 100 * p.value / total);
}
