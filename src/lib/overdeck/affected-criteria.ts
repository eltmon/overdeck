const MIN_CRITERION = 1;
const MAX_CRITERION = 7;

function addCriterion(values: Set<number>, raw: string): void {
  if (!/^-?\d+$/.test(raw)) return;

  const value = Number.parseInt(raw, 10);
  if (Number.isInteger(value) && value >= MIN_CRITERION && value <= MAX_CRITERION) {
    values.add(value);
  }
}

export function parseAffectedCriteria(
  body: string | null | undefined,
  labels: readonly string[] = [],
): number[] {
  const criteria = new Set<number>();
  const text = body ?? '';
  const trailerPattern = /^(?:Flywheel-)?Affects-Criterion:[ \t]*([0-9, \t-]+)[ \t]*$/gim;

  for (const match of text.matchAll(trailerPattern)) {
    for (const raw of (match[1] ?? '').split(/[,\s]+/)) {
      if (raw) addCriterion(criteria, raw);
    }
  }

  for (const label of labels) {
    const match = label.match(/^affects-criterion-(\d+)$/);
    if (match?.[1]) addCriterion(criteria, match[1]);
  }

  return [...criteria].sort((a, b) => a - b);
}
