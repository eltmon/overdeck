const AFFECTS_CRITERION_TRAILER = /^\s*Flywheel-Affects-Criterion\s*:\s*(.+)$/gim
const AFFECTS_CRITERION_LABEL = /^affects-criterion-([1-7])$/

function addCriterion(criteria: Set<number>, raw: string): void {
  const id = Number(raw)
  if (Number.isInteger(id) && id >= 1 && id <= 7) {
    criteria.add(id)
  }
}

export function parseAffectedCriteria(body: string, labels: readonly string[]): number[] {
  const criteria = new Set<number>()

  for (const match of body.matchAll(AFFECTS_CRITERION_TRAILER)) {
    const value = match[1]
    if (!value) continue
    for (const token of value.split(/[\s,]+/)) {
      if (token) addCriterion(criteria, token)
    }
  }

  for (const label of labels) {
    const match = AFFECTS_CRITERION_LABEL.exec(label)
    if (match?.[1]) addCriterion(criteria, match[1])
  }

  return [...criteria].sort((a, b) => a - b)
}
