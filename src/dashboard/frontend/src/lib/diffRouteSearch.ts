/**
 * Diff route search params — URL-based diff panel state.
 * Mirrors T3Code's apps/web/src/diffRouteSearch.ts for 1:1 upstream compatibility.
 */

export type DiffCompareMode = 'two-dot' | 'three-dot'

export interface DiffRouteSearch {
  diff?: '1' | undefined
  diffTurnId?: string | undefined
  diffFilePath?: string | undefined
  /** Compare view refs and mode (PAN-4503); kept only when diffTurnId is 'compare'. */
  diffBase?: string | undefined
  diffHead?: string | undefined
  diffMode?: DiffCompareMode | undefined
}

type DiffSearchKey = 'diff' | 'diffTurnId' | 'diffFilePath' | 'diffBase' | 'diffHead' | 'diffMode'

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
): Omit<T, DiffSearchKey> {
  const {
    diff: _diff,
    diffTurnId: _diffTurnId,
    diffFilePath: _diffFilePath,
    diffBase: _diffBase,
    diffHead: _diffHead,
    diffMode: _diffMode,
    ...rest
  } = params
  return rest as Omit<T, DiffSearchKey>
}

/** Build a diff fetch URL: `base` plus non-empty query params (PAN-4503). */
export function buildDiffFetchUrl(base: string, params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const query = search.toString()
  return query ? `${base}?${query}` : base
}

export function parseDiffRouteSearch(search: Record<string, unknown>): DiffRouteSearch {
  const diff = isDiffOpenValue(search.diff) ? '1' : undefined
  const diffTurnId = diff ? normalizeSearchString(search.diffTurnId) : undefined
  const diffFilePath = diff && diffTurnId ? normalizeSearchString(search.diffFilePath) : undefined
  const isCompare = diffTurnId === 'compare'
  const diffBase = isCompare ? normalizeSearchString(search.diffBase) : undefined
  const diffHead = isCompare ? normalizeSearchString(search.diffHead) : undefined
  const diffMode = isCompare && (search.diffMode === 'two-dot' || search.diffMode === 'three-dot')
    ? search.diffMode
    : undefined

  return {
    ...(diff ? { diff } : {}),
    ...(diffTurnId ? { diffTurnId } : {}),
    ...(diffFilePath ? { diffFilePath } : {}),
    ...(diffBase ? { diffBase } : {}),
    ...(diffHead ? { diffHead } : {}),
    ...(diffMode ? { diffMode } : {}),
  }
}
