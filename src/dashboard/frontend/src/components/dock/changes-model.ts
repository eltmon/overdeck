// Conversation change paths in explorer-root terms (PAN-5289 §6.5).
//
// `ConversationChanges` paths are repo paths, relative to `repoRoot`. An
// explorer root can be a folder inside that repo, so every path goes through
// `toRootPath` before it reaches the explorer (dots, filters, reveals). Pure.

import type { ConversationChanges } from '@overdeck/contracts'

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/** Repo path → root path; null when the path is outside the root's folder. */
export function toRootPath(repoRoot: string, rootAbs: string | null, repoPath: string): string | null {
  if (rootAbs === null) return repoPath
  const repo = trimSlash(repoRoot)
  const root = trimSlash(rootAbs)
  if (root === repo) return repoPath
  // The root must sit inside the repo for its paths to map.
  if (!root.startsWith(`${repo}/`)) return null
  const prefix = `${root.slice(repo.length + 1)}/`
  return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : null
}

/** Every uncommitted path and every commit's file paths, as root paths. */
export function changedPathsOf(changes: ConversationChanges, rootAbs: string | null): Set<string> {
  const paths = new Set<string>()
  const add = (repoPath: string): void => {
    const path = toRootPath(changes.repoRoot, rootAbs, repoPath)
    if (path !== null) paths.add(path)
  }
  for (const file of changes.uncommitted) add(file.path)
  for (const commit of changes.commits) for (const file of commit.files) add(file.path)
  return paths
}

/** Every parent folder of every path ('a/b/c.ts' → 'a', 'a/b'). */
export function ancestorFolders(paths: Iterable<string>): Set<string> {
  const folders = new Set<string>()
  for (const path of paths) {
    let slash = path.indexOf('/')
    while (slash > 0) {
      folders.add(path.slice(0, slash))
      slash = path.indexOf('/', slash + 1)
    }
  }
  return folders
}
