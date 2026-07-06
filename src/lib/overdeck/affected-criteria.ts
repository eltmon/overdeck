/**
 * Parse which v1.0 readiness criteria a substrate bug affects.
 *
 * Sources (unioned):
 * - A `Flywheel-Affects-Criterion:` trailer line in the issue body.
 * - GitHub labels matching `affects-criterion-<n>`.
 *
 * Only integers 1..7 are kept. The result is deduplicated and sorted ascending.
 */
export function parseAffectedCriteria(
  body: string | null | undefined,
  labels: readonly string[] = [],
): number[] {
  const criteria = new Set<number>();

  const text = body ?? '';
  const trailerMatch = text.match(/^(?:Flywheel-)?Affects-Criterion:\s*(.+)\s*$/im);
  if (trailerMatch?.[1]) {
    for (const raw of trailerMatch[1].split(/[,\s]+/)) {
      const n = Number.parseInt(raw, 10);
      if (Number.isInteger(n) && n >= 1 && n <= 7) {
        criteria.add(n);
      }
    }
  }

  for (const label of labels) {
    const match = label.match(/^affects-criterion-(\d+)$/i);
    if (match) {
      const n = Number.parseInt(match[1], 10);
      if (Number.isInteger(n) && n >= 1 && n <= 7) {
        criteria.add(n);
      }
    }
  }

  return [...criteria].sort((a, b) => a - b);
}
