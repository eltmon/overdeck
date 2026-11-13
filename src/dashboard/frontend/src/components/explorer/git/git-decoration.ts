// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: src/renderer/src/lib/source-control/paths/git-path-decoration.ts @ c6b9ac9549b
/**
 * Git decoration for explorer rows (PAN-5186, WI-B5).
 *
 * Changes from Orca: the status set is Overdeck's (adds `conflicted`, drops
 * `copied`), and the folder priority is FR-4's — conflicted > deleted >
 * modified > renamed > added > untracked — instead of Orca's (D-B9). Deleted
 * files propagate to their folders. Colors are Tailwind text tokens, not CSS
 * variables. Committed-only changes (the branch's commits, no working-tree
 * change) are tracked separately so the row can mute their badge.
 */

import type { ExplorerGitStatusResult } from '@overdeck/contracts'

export type ExplorerGitStatus = 'untracked' | 'added' | 'modified' | 'deleted' | 'renamed' | 'conflicted'

export const STATUS_LETTER: Record<ExplorerGitStatus, string> = {
  untracked: 'U',
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  conflicted: 'C',
}

export const STATUS_PRIORITY: Record<ExplorerGitStatus, number> = {
  conflicted: 6,
  deleted: 5,
  modified: 4,
  renamed: 3,
  added: 2,
  untracked: 1,
}

export const STATUS_TEXT_CLASS: Record<ExplorerGitStatus, string> = {
  untracked: 'text-success',
  added: 'text-success',
  modified: 'text-warning',
  renamed: 'text-warning',
  deleted: 'text-destructive',
  conflicted: 'text-destructive',
}

export const IGNORED_TEXT_CLASS = 'italic text-faint-foreground'
export const COMMITTED_ONLY_BADGE_CLASS = 'text-muted-foreground'

export function dominantStatus(statuses: Iterable<ExplorerGitStatus>): ExplorerGitStatus | null {
  let dominant: ExplorerGitStatus | null = null
  let dominantPriority = -1
  for (const status of statuses) {
    const priority = STATUS_PRIORITY[status]
    if (priority > dominantPriority) {
      dominant = status
      dominantPriority = priority
    }
  }
  return dominant
}

export interface FileDecoration {
  status: ExplorerGitStatus
  staged: boolean
  committedOnly: boolean
}

export interface FolderDecoration {
  status: ExplorerGitStatus
  committedOnly: boolean
}

export interface Decorations {
  files: Map<string, FileDecoration>
  folders: Map<string, FolderDecoration>
}

export const EMPTY_DECORATIONS: Decorations = { files: new Map(), folders: new Map() }

/** Every ancestor folder of a root-relative path: 'a/b/c.ts' → ['a', 'a/b']. */
function ancestors(path: string): string[] {
  const segments = path.split('/')
  const out: string[] = []
  let current = ''
  for (const segment of segments.slice(0, -1)) {
    current = current ? `${current}/${segment}` : segment
    out.push(current)
  }
  return out
}

export function buildDecorations(
  result: Pick<ExplorerGitStatusResult, 'entries' | 'committed'>,
): Decorations {
  const files = new Map<string, FileDecoration>()

  // Working-tree entries win over committed entries for the same path.
  for (const entry of result.committed) {
    files.set(entry.path, { status: entry.status, staged: false, committedOnly: true })
  }
  for (const entry of result.entries) {
    const existing = files.get(entry.path)
    if (existing && !existing.committedOnly) {
      const status = dominantStatus([existing.status, entry.status]) ?? entry.status
      files.set(entry.path, { status, staged: existing.staged || entry.staged, committedOnly: false })
    } else {
      files.set(entry.path, { status: entry.status, staged: entry.staged, committedOnly: false })
    }
  }

  const working = new Map<string, ExplorerGitStatus[]>()
  const committed = new Map<string, ExplorerGitStatus[]>()
  for (const [path, decoration] of files) {
    const bucket = decoration.committedOnly ? committed : working
    for (const folder of ancestors(path)) {
      const list = bucket.get(folder)
      if (list) list.push(decoration.status)
      else bucket.set(folder, [decoration.status])
    }
  }

  const folders = new Map<string, FolderDecoration>()
  for (const [folder, statuses] of committed) {
    const status = dominantStatus(statuses)
    if (status) folders.set(folder, { status, committedOnly: true })
  }
  // A folder with any working-tree descendant takes the working-tree status.
  for (const [folder, statuses] of working) {
    const status = dominantStatus(statuses)
    if (status) folders.set(folder, { status, committedOnly: false })
  }

  return { files, folders }
}
