/**
 * Diff output helpers shared by every diff route (PAN-4503).
 *
 * Holds the per-request `DiffOptions` (today: ignore whitespace), the query
 * param that carries them, and the numstat + name-status parser that turns
 * `git diff` output into a file list. Imports nothing from checkpoint-manager
 * so either side can depend on this module without an import cycle.
 */

/** One changed file in a diff file list. */
export interface TurnDiffFileChange {
  readonly path: string
  readonly kind?: string      // A(dded), M(odified), D(eleted), R(enamed)
  readonly additions: number
  readonly deletions: number
}

/** Per-request git diff options shared by every diff route (PAN-4503). */
export interface DiffOptions {
  /** git -w: drop whitespace-only hunks from patches and whitespace-only files from numstat. */
  ignoreWhitespace?: boolean
}

export const IGNORE_WHITESPACE_PARAM = 'ignoreWhitespace'

/** Extra `git diff` args for these options. */
export function diffOptionArgs(options: DiffOptions = {}): string[] {
  return options.ignoreWhitespace ? ['-w'] : []
}

/** Read DiffOptions from a request's query string: `ignoreWhitespace=1|true` is on. */
export function diffOptionsFromSearchParams(params: URLSearchParams): DiffOptions {
  const raw = params.get(IGNORE_WHITESPACE_PARAM)
  return raw === '1' || raw === 'true' ? { ignoreWhitespace: true } : {}
}

/** Join `git diff --numstat` rows with their `--name-status` kind, sorted by path. */
export function parseNumstatWithStatus(numstat: string, nameStatus: string): TurnDiffFileChange[] {
  const statusMap = new Map<string, string>()
  for (const line of nameStatus.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length >= 2) {
      statusMap.set(parts[parts.length - 1], parts[0])
    }
  }

  const files: TurnDiffFileChange[] = []
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue
    const [addStr, delStr, ...pathParts] = line.split('\t')
    const path = pathParts.join('\t')
    if (!path) continue
    files.push({
      path,
      kind: statusMap.get(path),
      additions: parseInt(addStr, 10) || 0,
      deletions: parseInt(delStr, 10) || 0,
    })
  }

  return files.sort((a, b) => a.path.localeCompare(b.path))
}
