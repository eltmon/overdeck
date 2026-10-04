/**
 * Two-ref diff compare for any allowed local repository (PAN-4503).
 *
 * The compare routes take a repository path and two refs from the browser, so
 * this module is a security boundary:
 * - A repository is accepted only inside a registered project root or its
 *   workspaces dir, or exactly at an unarchived conversation's cwd (PRD D4).
 *   Conversation cwds are exact-match only, so a conversation started in the
 *   home directory does not open every repository under it.
 * - A ref is shape-checked before any git process starts, then resolved with
 *   `rev-parse --verify --end-of-options`; later git commands only ever see the
 *   resolved SHAs (PRD D5).
 *
 * Every git call is `execFile` with an argument array. Failures are a typed
 * result rather than a throw, so the route maps each one to a 400 with a code.
 */

import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import { listProjectsAsync } from '../projects.js'
import { listConversations } from '../overdeck/conversations.js'
import { diffOptionArgs, parseNumstatWithStatus, type DiffOptions, type TurnDiffFileChange } from './diff-output.js'

export type CompareErrorCode =
  | 'INVALID_REPO' | 'REPO_NOT_ALLOWED' | 'NOT_A_GIT_REPO'
  | 'INVALID_REF' | 'UNKNOWN_REF' | 'INVALID_MODE' | 'NO_MERGE_BASE'

export interface CompareError { code: CompareErrorCode; error: string }

export type CompareMode = 'two-dot' | 'three-dot'

export interface CompareResponse {
  repoRoot: string
  mode: CompareMode
  base: { ref: string; sha: string }
  head: { ref: string; sha: string }
  /** Set in three-dot mode only. */
  mergeBase: string | null
  files: TurnDiffFileChange[]
  /** Present only when a `file` was requested (PRD Decision D3). */
  diff?: string
}

export type CompareResult<T> = { ok: true; value: T } | { ok: false; failure: CompareError }

/** Realpath'd roots: `containing` accepts any path inside; `exact` accepts only the path itself. */
export interface AllowedDiffRoots { containing: string[]; exact: string[] }

const MAX_REPO_PATH_LENGTH = 4096
const MAX_REF_LENGTH = 256
const REF_SHAPE_RE = /^[A-Za-z0-9._/@{}~^+-]+$/

function ok<T>(value: T): CompareResult<T> {
  return { ok: true, value }
}

function fail<T>(code: CompareErrorCode, error: string): CompareResult<T> {
  return { ok: false, failure: { code, error } }
}

/** Run git with an argument array in `cwd` and resolve with stdout. */
function runGit(cwd: string, args: string[], maxBuffer = 10 * 1024 * 1024): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('git', args, { cwd, encoding: 'utf-8', maxBuffer }, (error, stdout) => {
      if (error) reject(error)
      else resolvePromise(stdout)
    })
  })
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

function isInsidePath(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${sep}`)
}

/** Realpath'd allowed roots (PRD Decision D4). Paths that do not exist are skipped. */
export async function resolveAllowedDiffRoots(): Promise<AllowedDiffRoots> {
  const containing: string[] = []
  for (const { config } of await listProjectsAsync()) {
    if (!config.path) continue
    const projectRoot = await realpathOrNull(config.path)
    if (projectRoot) containing.push(projectRoot)
    const workspacesDir = await realpathOrNull(resolve(config.path, config.workspace?.workspaces_dir ?? 'workspaces'))
    if (workspacesDir) containing.push(workspacesDir)
  }

  const exact: string[] = []
  for (const conversation of listConversations()) {
    if (!conversation.cwd) continue
    const cwd = await realpathOrNull(conversation.cwd)
    if (cwd) exact.push(cwd)
  }

  return { containing, exact }
}

/** Shape check only — never spawns git (PRD Decision D5 stage 1). */
export function validateRefShape(ref: string | null): CompareResult<string> {
  if (!ref) return fail('INVALID_REF', 'Ref is required')
  if (ref.length > MAX_REF_LENGTH) return fail('INVALID_REF', `Ref is longer than ${MAX_REF_LENGTH} characters`)
  if (ref.startsWith('-')) return fail('INVALID_REF', 'Ref must not start with "-"')
  if (ref.includes('..')) return fail('INVALID_REF', 'Ref must not contain ".."')
  if (!REF_SHAPE_RE.test(ref)) return fail('INVALID_REF', `Ref contains characters git refs cannot use: ${ref}`)
  return ok(ref)
}

/** Absolute path → realpath → allowed-roots check → `git rev-parse --show-toplevel`. */
export async function resolveCompareRepo(repo: string | null, roots: AllowedDiffRoots): Promise<CompareResult<string>> {
  if (!repo) return fail('INVALID_REPO', 'repo is required')
  if (repo.length > MAX_REPO_PATH_LENGTH) return fail('INVALID_REPO', 'repo path is too long')
  if (!isAbsolute(repo)) return fail('INVALID_REPO', 'repo must be an absolute path')

  const real = await realpathOrNull(repo)
  if (!real) return fail('INVALID_REPO', `repo does not exist: ${repo}`)

  const allowed = roots.containing.some((root) => isInsidePath(root, real)) || roots.exact.includes(real)
  if (!allowed) {
    return fail('REPO_NOT_ALLOWED', 'repo is outside the registered projects, their workspaces, and conversation directories')
  }

  try {
    const topLevel = (await runGit(real, ['rev-parse', '--show-toplevel'])).trim()
    if (!topLevel) return fail('NOT_A_GIT_REPO', `repo is not a git repository: ${repo}`)
    return ok(topLevel)
  } catch {
    return fail('NOT_A_GIT_REPO', `repo is not a git repository: ${repo}`)
  }
}

/** `git rev-parse --verify --quiet --end-of-options <ref>^{commit}` → 40-char SHA (PRD D5 stage 2). */
export async function resolveCommit(repoRoot: string, ref: string): Promise<CompareResult<string>> {
  try {
    const sha = (await runGit(repoRoot, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`])).trim()
    if (/^[0-9a-f]{40,64}$/.test(sha)) return ok(sha)
  } catch {
    // fall through: the ref does not name a commit
  }
  return fail('UNKNOWN_REF', `Ref does not resolve to a commit: ${ref}`)
}

/** Narrow a `mode` query value; absent means two-dot (PRD Decision D6). */
export function parseCompareMode(mode: string | null): CompareResult<CompareMode> {
  if (mode === null || mode === '' || mode === 'two-dot') return ok('two-dot')
  if (mode === 'three-dot') return ok('three-dot')
  return fail('INVALID_MODE', `mode must be two-dot or three-dot, got: ${mode}`)
}

/**
 * Diff two resolved commits. Two-dot diffs base → head; three-dot diffs
 * merge-base(base, head) → head. The file list always comes back; the patch
 * only for the one requested `file`.
 */
export async function compareRefs(input: {
  repoRoot: string
  base: { ref: string; sha: string }
  head: { ref: string; sha: string }
  mode: CompareMode
  file?: string
  options?: DiffOptions
}): Promise<CompareResult<CompareResponse>> {
  const { repoRoot, base, head, mode, file, options = {} } = input

  let mergeBase: string | null = null
  if (mode === 'three-dot') {
    try {
      mergeBase = (await runGit(repoRoot, ['merge-base', base.sha, head.sha])).trim() || null
    } catch {
      mergeBase = null
    }
    if (!mergeBase) return fail('NO_MERGE_BASE', `${base.ref} and ${head.ref} share no history`)
  }
  const from = mergeBase ?? base.sha

  // --no-renames + core.quotePath=false key numstat and name-status paths identically (PRD D7).
  const listArgs = ['-c', 'core.quotePath=false', 'diff', '--no-renames']
  const [numstat, nameStatus] = await Promise.all([
    runGit(repoRoot, [...listArgs, '--numstat', '--no-color', ...diffOptionArgs(options), from, head.sha]),
    runGit(repoRoot, [...listArgs, '--name-status', '--no-color', from, head.sha]),
  ])
  const files = parseNumstatWithStatus(numstat, nameStatus)

  const response: CompareResponse = { repoRoot, mode, base, head, mergeBase, files }
  if (file) {
    response.diff = await runGit(
      repoRoot,
      [...listArgs, '--patch', '--minimal', '--no-color', ...diffOptionArgs(options), from, head.sha, '--', file],
      50 * 1024 * 1024,
    )
  }
  return ok(response)
}
