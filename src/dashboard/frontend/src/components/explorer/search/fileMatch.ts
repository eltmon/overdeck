// Go to file match tiers, ranking and highlight ranges (PAN-5289 §6.6, B-D6).
//
// The server's searchFiles and these client functions use the same tiers, so
// an exact file name always ranks above a fuzzy match. One JSON case table
// (__tests__/file-match-cases.json) drives the server and client tests.
//
// Tiers (first true wins; q = query trimmed and lowercased, p = path lowercased,
// base = text after the last '/' of p):
//   0  q has no '/' and base === q
//   1  q has no '/' and base starts with q
//   2  q has no '/' and base contains q
//   3  p contains q
//   4  q (whitespace removed) is a left-to-right subsequence of p
// An empty q matches nothing.

export type FileMatchTier = 0 | 1 | 2 | 3 | 4

/** [start, end) offsets into the full path. */
export type MatchRange = readonly [number, number]

/** Matched positions of the greedy left-to-right subsequence scan, or null. */
function fuzzyPositions(p: string, query: string): number[] | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (q === '') return null
  const positions: number[] = []
  let from = 0
  for (const ch of q) {
    const i = p.indexOf(ch, from)
    if (i < 0) return null
    positions.push(i)
    from = i + 1
  }
  return positions
}

export function fileMatchTier(path: string, query: string): FileMatchTier | null {
  const q = query.trim().toLowerCase()
  if (q === '') return null
  const p = path.toLowerCase()
  if (!q.includes('/')) {
    const base = p.slice(p.lastIndexOf('/') + 1)
    if (base === q) return 0
    if (base.startsWith(q)) return 1
    if (base.includes(q)) return 2
  }
  if (p.includes(q)) return 3
  return fuzzyPositions(p, query) ? 4 : null
}

/** Drop non-matches; stable-sort by tier, then changed-here first; otherwise keep the given (server) order. */
export function rankFileMatches(paths: readonly string[], query: string, changed: ReadonlySet<string>): string[] {
  const ranked: Array<{ path: string; tier: FileMatchTier; changed: number; index: number }> = []
  paths.forEach((path, index) => {
    const tier = fileMatchTier(path, query)
    if (tier !== null) ranked.push({ path, tier, changed: changed.has(path) ? 0 : 1, index })
  })
  ranked.sort((a, b) => a.tier - b.tier || a.changed - b.changed || a.index - b.index)
  return ranked.map((r) => r.path)
}

/** Highlight ranges over the full path for the match tier of `query`. */
export function matchRanges(path: string, query: string): MatchRange[] {
  const tier = fileMatchTier(path, query)
  if (tier === null) return []
  const q = query.trim().toLowerCase()
  const p = path.toLowerCase()
  if (tier <= 2) {
    const baseStart = p.lastIndexOf('/') + 1
    const start = baseStart + p.slice(baseStart).indexOf(q)
    return [[start, start + q.length]]
  }
  if (tier === 3) {
    const start = p.indexOf(q)
    return [[start, start + q.length]]
  }
  return (fuzzyPositions(p, query) ?? []).map((i) => [i, i + 1] as const)
}
