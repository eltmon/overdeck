/** Index patches preserve the complete tracker rows and their exact ordering. */
export interface IssueDelta {
  readonly length: number
  readonly changes: ReadonlyArray<{ readonly index: number; readonly issue: unknown }>
}

export function createIssueDelta(previous: readonly unknown[], next: readonly unknown[]): IssueDelta | null {
  const changes: Array<{ index: number; issue: unknown }> = []
  for (let index = 0; index < next.length; index++) {
    if (index >= previous.length || JSON.stringify(previous[index]) !== JSON.stringify(next[index])) {
      changes.push({ index, issue: next[index] })
    }
  }
  return changes.length || previous.length !== next.length ? { length: next.length, changes } : null
}

export function applyIssueDelta(previous: readonly unknown[], delta: IssueDelta): unknown[] {
  const next = previous.slice(0, delta.length)
  for (const { index, issue } of delta.changes) next[index] = issue
  return next
}
