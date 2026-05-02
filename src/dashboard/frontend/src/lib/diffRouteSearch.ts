/**
 * Diff route search params — URL-based diff panel state.
 * Mirrors T3Code's apps/web/src/diffRouteSearch.ts for 1:1 upstream compatibility.
 */

export interface DiffRouteSearch {
  diff?: '1' | undefined
  diffTurnId?: string | undefined
  diffFilePath?: string | undefined
}

function isDiffOpenValue(value: unknown): boolean {
  return value === '1' || value === 1 || value === true
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

export function stripDiffSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, 'diff' | 'diffTurnId' | 'diffFilePath'> {
  const { diff: _diff, diffTurnId: _diffTurnId, diffFilePath: _diffFilePath, ...rest } = params
  return rest as Omit<T, 'diff' | 'diffTurnId' | 'diffFilePath'>
}

export function parseDiffRouteSearch(search: Record<string, unknown>): DiffRouteSearch {
  const diff = isDiffOpenValue(search.diff) ? '1' : undefined
  const diffTurnId = diff ? normalizeSearchString(search.diffTurnId) : undefined
  const diffFilePath = diff && diffTurnId ? normalizeSearchString(search.diffFilePath) : undefined

  return {
    ...(diff ? { diff } : {}),
    ...(diffTurnId ? { diffTurnId } : {}),
    ...(diffFilePath ? { diffFilePath } : {}),
  }
}
