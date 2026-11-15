// The lines a conversation changed in one file, for the code pane's gutter
// marks (PAN-5290 FR-6, C-D4). Pure path mapping plus the FR-5 fetch.

import type { ConversationChangedLines } from '@overdeck/contracts'

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/**
 * Root path → repo path, the inverse of `toRootPath` (dock/changes-model.ts).
 * Null when the root folder is outside the repo, such as another worktree:
 * the conversation's lines are not in that file's terms.
 */
export function toRepoPath(repoRoot: string, rootAbs: string | null, rootPath: string): string | null {
  if (rootAbs === null) return rootPath
  const repo = trimSlash(repoRoot)
  const root = trimSlash(rootAbs)
  if (root === repo) return rootPath
  if (!root.startsWith(`${repo}/`)) return null
  return `${root.slice(repo.length + 1)}/${rootPath}`
}

/** GET /api/conversations/:name/changes/lines (FR-5). */
export async function fetchChangedLines(name: string, repoPath: string): Promise<ConversationChangedLines> {
  const url = '/api/conversations/' + encodeURIComponent(name) + '/changes/lines?file=' + encodeURIComponent(repoPath)
  const res = await fetch(url)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? 'Failed to load changed lines')
  }
  return (await res.json()) as ConversationChangedLines
}
