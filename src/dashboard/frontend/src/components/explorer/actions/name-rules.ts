// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: src/renderer/src/components/right-sidebar/file-explorer/mutations/useFileDuplicate.ts @ c6b9ac9549b
/**
 * Name and path rules for explorer write actions (PAN-5190, D-E10–D-E13).
 *
 * Pure functions, no React and no I/O. Only the duplicate copy-name loop is
 * ported from Orca; it is extended to folders and checks the loaded siblings
 * instead of asking the server whether each candidate exists. The server is
 * still the authority: a name taken after the listing loaded answers
 * ALREADY_EXISTS, and the caller retries with `skip + 1`.
 */

import { baseName, parentPath } from '../tree/explorer-tree-model'

/** Join a root-relative folder and a name; the root is ''. */
export function joinPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`
}

/** True when `path` is `base` or inside it. Every path is under the root (''). */
export function isAtOrUnder(path: string, base: string): boolean {
  if (base === '') return true
  return path === base || path.startsWith(`${base}/`)
}

/** Map a path through a rename of `from` to `to`; unrelated paths are unchanged. */
export function rewritePath(path: string, from: string, to: string): string {
  if (path === from) return to
  if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`
  return path
}

/**
 * Validate an inline name (D-E11). `current` is the name being renamed, so
 * keeping it is valid. Siblings compare exactly.
 */
export function validateEntryName(
  raw: string,
  siblings: readonly string[],
  current?: string,
): { name: string } | { error: string } {
  const name = raw.trim()
  if (name === '') return { error: 'Enter a name.' }
  if (name === '.' || name === '..') return { error: 'This name is reserved.' }
  if (/[/\\\0]/.test(name)) return { error: 'Names cannot contain / or \\.' }
  if (name.toLowerCase() === '.git') return { error: 'Overdeck does not write .git folders.' }
  if (name !== current && siblings.includes(name)) return { error: `${name} already exists here.` }
  return { name }
}

/**
 * The first free copy name for `name` among `siblings` (D-E12): `<stem> copy<ext>`,
 * then `<stem> copy 2<ext>`, `<stem> copy 3<ext>`, … The stem is the text before
 * the last `.` unless that dot is the first character. `skip` passes over the
 * first n free candidates, for a retry after ALREADY_EXISTS.
 */
export function duplicateName(name: string, siblings: readonly string[], skip = 0): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  const taken = new Set(siblings)
  let free = 0
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? `${stem} copy${ext}` : `${stem} copy ${n}${ext}`
    if (taken.has(candidate)) continue
    if (free === skip) return candidate
    free += 1
  }
}

/** Drop duplicates and every path whose ancestor folder is also listed; keeps input order. */
export function topLevelPaths(paths: readonly string[]): string[] {
  const unique = [...new Set(paths)]
  return unique.filter((path) => !unique.some((other) => other !== path && path.startsWith(`${other}/`)))
}

/**
 * Plan a move of `sources` into `destDir` (D-E13). A source already in
 * `destDir` is a no-op and is omitted. A source that `destDir` is, or is
 * inside, is listed in `intoItself`.
 */
export function planMoves(
  sources: readonly string[],
  destDir: string,
): { moves: { from: string; to: string }[]; intoItself: string[] } {
  const moves: { from: string; to: string }[] = []
  const intoItself: string[] = []
  for (const source of topLevelPaths(sources)) {
    if (parentPath(source) === destDir) continue
    if (isAtOrUnder(destDir, source)) {
      intoItself.push(source)
      continue
    }
    moves.push({ from: source, to: joinPath(destDir, baseName(source)) })
  }
  return { moves, intoItself }
}
