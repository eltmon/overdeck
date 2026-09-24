/**
 * Checkpoint Manager — captures git refs at turn boundaries and computes diffs.
 *
 * Uses hidden refs under `refs/pan/turn/<turnId>` with a temporary git index
 * to capture the full working tree state (including uncommitted changes).
 * All operations use execAsync (never execSync) per CLAUDE.md rules.
 *
 * Mirrors T3Code's CheckpointStore pattern for 1:1 upstream compatibility.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { Effect } from 'effect'
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodePath from '@effect/platform-node/NodePath'
import { CheckpointError, GitError, InvalidAgentIdError, VcsError } from '../errors.js'
import { PAN_RUNTIME_SUBDIRS } from '../state-plane.js'

const execFileAsync = promisify(execFile)

const CHECKPOINT_REF_PREFIX = 'refs/pan/turn'

// Agent IDs must be alphanumeric + hyphens/underscores to be safe as ref path segments.
const SAFE_AGENT_ID_RE = /^[a-zA-Z0-9_-]+$/
function assertSafeAgentId(agentId: string): void {
  if (!SAFE_AGENT_ID_RE.test(agentId)) {
    throw new Error(`Unsafe agentId for checkpoint ref: ${agentId}`)
  }
}
const CHECKPOINT_AUTHOR_NAME = 'Overdeck'
const CHECKPOINT_AUTHOR_EMAIL = 'overdeck@users.noreply.github.com'

// ─── Non-git capture targets (PAN-3725) ──────────────────────────────────────
//
// Some agent workspaces are not git repositories at all — polyrepo wrapper
// directories that only contain sibling repos, or worktrees whose parent gitdir
// metadata was pruned. Every capture there fails with "fatal: not a git
// repository", and the activity-driven capture path retries on every event,
// which filled the dashboard log with thousands of identical CheckpointErrors.
// The first such failure permanently disables the target for this process; the
// set is in-memory only, so a workspace that later becomes a real repo is
// retried after the next dashboard restart.
const disabledCheckpointTargets = new Set<string>()
const NON_GIT_REPO_RE = /not a git repository/i

/** True when checkpoint capture for this workspace has been disabled. */
export function isCheckpointTargetDisabled(cwd: string): boolean {
  return disabledCheckpointTargets.has(cwd)
}

/** Disable a workspace (once, with one warning) when capture failed for lack of a git repo. */
function noteCheckpointCaptureFailure(cwd: string, cause: unknown): void {
  if (!NON_GIT_REPO_RE.test(String(cause))) return
  if (disabledCheckpointTargets.has(cwd)) return
  disabledCheckpointTargets.add(cwd)
  console.warn(`[checkpoint] Disabled checkpoint capture for ${cwd} — not a git repository`)
}

export function checkpointStateExclusions(): string[] {
  return [
    '.overdeck',
    ...PAN_RUNTIME_SUBDIRS.map((path) => `.pan/${path.slice(0, -1)}`),
    '.pan/continue.json',
    '.pan/spec.vbrief.json',
  ]
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TurnDiffFileChange {
  readonly path: string
  readonly kind?: string      // A(dded), M(odified), D(eleted), R(enamed)
  readonly additions: number
  readonly deletions: number
}

// ─── Ref helpers ──────────────────────────────────────────────────────────────

function checkpointRef(agentId: string, turnId: string): string {
  return `${CHECKPOINT_REF_PREFIX}/${agentId}/${turnId}`
}

// ─── Core operations ─────────────────────────────────────────────────────────

/**
 * Resolve HEAD commit SHA. Returns null if no commits exist.
 */
async function resolveHeadCommit(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
      cwd,
      encoding: 'utf-8',
    })
    const sha = stdout.trim()
    return sha.length > 0 ? sha : null
  } catch {
    return null
  }
}

/**
 * Resolve a checkpoint ref to its commit SHA. Returns null if not found.
 */
async function resolveCheckpointCommit(cwd: string, agentId: string, turnId: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', '--quiet', `${checkpointRef(agentId, turnId)}^{commit}`], {
      cwd,
      encoding: 'utf-8',
    })
    const sha = stdout.trim()
    return sha.length > 0 ? sha : null
  } catch {
    return null
  }
}

async function captureCheckpointPromise(cwd: string, agentId: string, turnId: string): Promise<void> {
  assertSafeAgentId(agentId)
  const tempDir = await mkdtemp(join(tmpdir(), 'pan-checkpoint-'))
  const tempIndex = join(tempDir, `index-${randomUUID()}`)

  try {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_INDEX_FILE: tempIndex,
      GIT_AUTHOR_NAME: CHECKPOINT_AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: CHECKPOINT_AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: CHECKPOINT_AUTHOR_NAME,
      GIT_COMMITTER_EMAIL: CHECKPOINT_AUTHOR_EMAIL,
    }

    // Seed temp index from HEAD if it exists
    const headExists = await resolveHeadCommit(cwd)
    if (headExists) {
      await execFileAsync('git', ['read-tree', 'HEAD'], { cwd, env })
    }

    // Stage all working tree changes into temp index.
    // Use --ignore-errors-on-unreadable-file equivalent: if git add -A fails due to a
    // transiently-deleted temp file (agents write and remove .tmp files rapidly),
    // fall back to `git add -u` which only stages changes to already-tracked files.
    // This still captures all meaningful code edits; it just won't add new untracked files
    // if the -A pass fails. Better than dropping the entire checkpoint.
    try {
      await execFileAsync('git', ['add', '-A', '--', '.'], { cwd, env })
    } catch {
      await execFileAsync('git', ['add', '-u', '--', '.'], { cwd, env })
    }

    // Explicitly exclude workspace-only .pan/ artifacts from checkpoints.
    // Per CLAUDE.md's four-artifact model: spec on main is immutable;
    // workspace-side continue state (`.pan/continue.json`) and workspace-side
    // spec (`.pan/spec.vbrief.json`) must never escape the workspace via
    // checkpoint commits. These files are gitignored but may still be tracked
    // on older branches (once tracked, gitignore stops applying). Without this
    // removal, read-tree HEAD copies them into the temp index and they leak
    // into checkpoint commits. When the workspace is later rebased, these files
    // can be dropped as "already upstream", causing the verification gate to
    // lose AC progress (PAN-1215).
    try {
      await execFileAsync('git', ['rm', '-r', '--cached', '--ignore-unmatch', ...checkpointStateExclusions()], { cwd, env })
    } catch {
      // Non-fatal — files may not exist in the temp index
    }

    // Write tree from temp index
    const { stdout: treeOid } = await execFileAsync('git', ['write-tree'], { cwd, env })
    const tree = treeOid.trim()
    if (!tree) {
      throw new Error('git write-tree returned empty tree oid')
    }

    // Create commit from tree
    const message = `pan checkpoint turnId=${turnId}`
    const { stdout: commitOid } = await execFileAsync('git', ['commit-tree', tree, '-m', message], { cwd, env })
    const commit = commitOid.trim()
    if (!commit) {
      throw new Error('git commit-tree returned empty commit oid')
    }

    // Point the hidden ref at the new commit
    await execFileAsync('git', ['update-ref', checkpointRef(agentId, turnId), commit], { cwd })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function deleteCheckpointPromise(cwd: string, agentId: string, turnId: string): Promise<void> {
  assertSafeAgentId(agentId)
  try {
    await execFileAsync('git', ['update-ref', '-d', checkpointRef(agentId, turnId)], {
      cwd,
      encoding: 'utf-8',
    })
  } catch {
    // No-op if ref doesn't exist
  }
}

async function diffCheckpointsPromise(cwd: string, agentId: string, fromTurnId: string, toTurnId: string, filePath?: string): Promise<string> {
  assertSafeAgentId(agentId)
  const fromCommit = await resolveCheckpointCommit(cwd, agentId, fromTurnId)
  const toCommit = await resolveCheckpointCommit(cwd, agentId, toTurnId)

  if (!fromCommit || !toCommit) {
    throw new Error(`Checkpoint ref unavailable for diff: from=${fromTurnId}(${fromCommit}) to=${toTurnId}(${toCommit})`)
  }

  const args = ['diff', '--patch', '--minimal', '--no-color', fromCommit, toCommit]
  if (filePath) args.push('--', filePath)

  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })

  return stdout
}

async function diffCheckpointFilesPromise(
  cwd: string,
  agentId: string,
  fromTurnId: string,
  toTurnId: string,
): Promise<TurnDiffFileChange[]> {
  assertSafeAgentId(agentId)
  const fromCommit = await resolveCheckpointCommit(cwd, agentId, fromTurnId)
  const toCommit = await resolveCheckpointCommit(cwd, agentId, toTurnId)

  if (!fromCommit || !toCommit) {
    throw new Error(`Checkpoint ref unavailable for diff: from=${fromTurnId}(${fromCommit}) to=${toTurnId}(${toCommit})`)
  }

  // Get additions/deletions per file
  const { stdout: numstat } = await execFileAsync('git', [
    'diff', '--numstat', '--no-color', fromCommit, toCommit,
  ], { cwd, encoding: 'utf-8' })

  // Get file status (A/M/D/R) per file
  const { stdout: nameStatus } = await execFileAsync('git', [
    'diff', '--name-status', '--no-color', fromCommit, toCommit,
  ], { cwd, encoding: 'utf-8' })

  // Parse name-status into a map
  const statusMap = new Map<string, string>()
  for (const line of nameStatus.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length >= 2) {
      statusMap.set(parts[parts.length - 1], parts[0])
    }
  }

  // Parse numstat and combine with status
  const files: TurnDiffFileChange[] = []
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue
    const [addStr, delStr, ...pathParts] = line.split('\t')
    const path = pathParts.join('\t') // handle paths with tabs
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

async function getCheckpointTimestampPromise(cwd: string, agentId: string, turnId: string): Promise<string> {
  assertSafeAgentId(agentId)
  try {
    const commit = await resolveCheckpointCommit(cwd, agentId, turnId)
    if (!commit) return new Date().toISOString()
    const { stdout } = await execFileAsync('git', [
      'log', '-1', '--format=%cI', commit,
    ], { cwd, encoding: 'utf-8' })
    const ts = stdout.trim()
    return ts || new Date().toISOString()
  } catch {
    return new Date().toISOString()
  }
}

async function listCheckpointsPromise(cwd: string, agentId: string): Promise<string[]> {
  assertSafeAgentId(agentId)
  const { stdout } = await execFileAsync('git', [
    'for-each-ref', '--format=%(refname:strip=4)', `${CHECKPOINT_REF_PREFIX}/${agentId}/`,
  ], { cwd, encoding: 'utf-8' })
  return stdout.split('\n').filter(Boolean).sort()
}

/** Delete all checkpoint refs for a set of agent IDs. */
export async function pruneCheckpointRefsForAgents(cwd: string, agentIds: string[]): Promise<number> {
  // Multi-repo projects (e.g. MYN) have a projectPath that is a plain folder of
  // repos, not a git repo itself. Checkpoint refs can only live in a git repo,
  // so a non-git cwd means there is nothing to prune.
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd, encoding: 'utf-8' })
  } catch {
    console.log(`[checkpoint] ${cwd} is not a git repository — no checkpoint refs to prune`)
    return 0
  }
  let totalRefs = 0
  for (const agentId of agentIds) {
    assertSafeAgentId(agentId)
    const turns = await Effect.runPromise(listCheckpoints(cwd, agentId))
    if (turns.length === 0) continue
    for (const turnId of turns) {
      await Effect.runPromise(deleteCheckpoint(cwd, agentId, turnId))
    }
    console.log(`[checkpoint] Pruned ${turns.length} ref(s) for agent ${agentId}`)
    totalRefs += turns.length
  }
  if (totalRefs === 0) {
    console.log(`[checkpoint] No checkpoint refs found for agents: ${agentIds.join(', ')}`)
  }
  return totalRefs
}

/** One-time migration: delete legacy unscoped checkpoint refs. */
export async function deleteLegacyCheckpointRefs(cwd: string): Promise<number> {
  try {
    // Old layout: refs/pan/turn/<turnId> — exactly 3 components (strip=3 gives the turnId directly, no slash)
    // New layout: refs/pan/turn/<agentId>/<turnId> — has a slash in strip=3 output
    const { stdout } = await execFileAsync('git', [
      'for-each-ref', '--format=%(refname)', `${CHECKPOINT_REF_PREFIX}/`,
    ], { cwd, encoding: 'utf-8' })
    const refs = stdout.split('\n').filter(Boolean)
    const legacyRefs = refs.filter(ref => {
      // Count slash components: refs/pan/turn/X has 4 parts; refs/pan/turn/A/B has 5 parts
      return ref.split('/').length === 4
    })
    for (const ref of legacyRefs) {
      try {
        await execFileAsync('git', ['update-ref', '-d', ref], { cwd, encoding: 'utf-8' })
      } catch {
        // Best-effort
      }
    }
    return legacyRefs.length
  } catch {
    return 0
  }
}

/** Compute unified diff of the workspace against the main branch. */
export async function diffAgainstMain(cwd: string, filePath?: string): Promise<string> {
  const args = ['diff', '--patch', '--minimal', '--no-color', 'main...HEAD']
  if (filePath) args.push('--', filePath)
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
  return stdout
}

/** Get file change summary of the workspace against the main branch. */
export async function diffAgainstMainFiles(cwd: string): Promise<TurnDiffFileChange[]> {
  // Get additions/deletions per file
  const { stdout: numstat } = await execFileAsync('git', [
    'diff', '--numstat', '--no-color', 'main...HEAD',
  ], { cwd, encoding: 'utf-8' })

  // Get file status (A/M/D/R) per file
  const { stdout: nameStatus } = await execFileAsync('git', [
    'diff', '--name-status', '--no-color', 'main...HEAD',
  ], { cwd, encoding: 'utf-8' })

  // Parse name-status into a map
  const statusMap = new Map<string, string>()
  for (const line of nameStatus.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length >= 2) {
      statusMap.set(parts[parts.length - 1], parts[0])
    }
  }

  // Parse numstat and combine with status
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

/** Find the commit SHA at the given timestamp (rev-list --before). */
export async function findCommitAtTime(cwd: string, isoTimestamp: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', [
      'rev-list', '-1', `--before=${isoTimestamp}`, 'HEAD',
    ], { cwd, encoding: 'utf-8' })
    const sha = stdout.trim()
    return sha.length > 0 ? sha : null
  } catch {
    return null
  }
}

/** Diff specific file paths against HEAD. */
export async function diffFilesAgainstHead(cwd: string, filePaths: string[]): Promise<TurnDiffFileChange[]> {
  if (filePaths.length === 0) return []

  const [numstatResult, nameStatusResult] = await Promise.all([
    execFileAsync('git', ['diff', '--numstat', '--no-color', 'HEAD', '--', ...filePaths], { cwd, encoding: 'utf-8' }),
    execFileAsync('git', ['diff', '--name-status', '--no-color', 'HEAD', '--', ...filePaths], { cwd, encoding: 'utf-8' }),
  ])

  return parseNumstatWithStatus(numstatResult.stdout, nameStatusResult.stdout)
}

/** Patch diff since a given base commit. */
export async function diffPatchSinceCommit(cwd: string, baseCommit: string, filePath?: string): Promise<string> {
  const args = ['diff', '--patch', '--minimal', '--no-color', baseCommit]
  if (filePath) args.push('--', filePath)
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
  return stdout
}

/** Patch diff for specific file paths against HEAD. */
export async function diffPatchFilesAgainstHead(cwd: string, filePaths: string[]): Promise<string> {
  if (filePaths.length === 0) return ''
  const { stdout } = await execFileAsync('git', [
    'diff', '--patch', '--minimal', '--no-color', 'HEAD', '--', ...filePaths,
  ], { cwd, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
  return stdout
}

function parseNumstatWithStatus(numstat: string, nameStatus: string): TurnDiffFileChange[] {
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

// ─── Effect variants (PAN-1249, additive) ────────────────────────────────────
//
// These wrap the existing Promise-based functions so Effect-native callers can
// use checkpoint operations with typed error channels. The underlying impl is
// unchanged — failures are mapped to CheckpointError / InvalidAgentIdError /
// VcsError / GitError so callers can narrow via Effect.catchTag.
//
// The existing Promise functions remain canonical; these are an additive
// surface for the perf-driver migration (PAN-1249).

function assertSafeAgentIdProgram(agentId: string): Effect.Effect<void, InvalidAgentIdError> {
  return SAFE_AGENT_ID_RE.test(agentId)
    ? Effect.void
    : Effect.fail(new InvalidAgentIdError({ agentId }))
}

/** Capture a checkpoint at the current working tree state. */
export function captureCheckpoint(
  cwd: string,
  agentId: string,
  turnId: string,
): Effect.Effect<void, CheckpointError | InvalidAgentIdError> {
  return Effect.gen(function* () {
    yield* assertSafeAgentIdProgram(agentId)
    // Never spawn git again for a workspace already known not to be a git repo.
    if (isCheckpointTargetDisabled(cwd)) return
    yield* Effect.tryPromise({
      try: () => captureCheckpointPromise(cwd, agentId, turnId),
      catch: (cause) => {
        noteCheckpointCaptureFailure(cwd, cause)
        return new CheckpointError({ agentId, operation: 'capture', message: String(cause), cause })
      },
    })
  })
}

/** Delete a checkpoint ref. No-op if it doesn't exist. */
export function deleteCheckpoint(
  cwd: string,
  agentId: string,
  turnId: string,
): Effect.Effect<void, InvalidAgentIdError> {
  return Effect.gen(function* () {
    yield* assertSafeAgentIdProgram(agentId)
    yield* Effect.promise(() => deleteCheckpointPromise(cwd, agentId, turnId))
  })
}

/** Compute unified diff between two checkpoints. */
export function diffCheckpoints(
  cwd: string,
  agentId: string,
  fromTurnId: string,
  toTurnId: string,
  filePath?: string,
): Effect.Effect<string, CheckpointError | InvalidAgentIdError> {
  return Effect.gen(function* () {
    yield* assertSafeAgentIdProgram(agentId)
    return yield* Effect.tryPromise({
      try: () => diffCheckpointsPromise(cwd, agentId, fromTurnId, toTurnId, filePath),
      catch: (cause) =>
        new CheckpointError({ agentId, operation: 'diff', message: String(cause), cause }),
    })
  })
}

/** Get file change summary between two checkpoints. */
export function diffCheckpointFiles(
  cwd: string,
  agentId: string,
  fromTurnId: string,
  toTurnId: string,
): Effect.Effect<TurnDiffFileChange[], CheckpointError | InvalidAgentIdError> {
  return Effect.gen(function* () {
    yield* assertSafeAgentIdProgram(agentId)
    return yield* Effect.tryPromise({
      try: () => diffCheckpointFilesPromise(cwd, agentId, fromTurnId, toTurnId),
      catch: (cause) =>
        new CheckpointError({ agentId, operation: 'diff-files', message: String(cause), cause }),
    })
  })
}

/** Get the committer date (ISO 8601) of a checkpoint commit. */
export function getCheckpointTimestamp(
  cwd: string,
  agentId: string,
  turnId: string,
): Effect.Effect<string, InvalidAgentIdError> {
  return Effect.gen(function* () {
    yield* assertSafeAgentIdProgram(agentId)
    return yield* Effect.promise(() => getCheckpointTimestampPromise(cwd, agentId, turnId))
  })
}

/** Get the list of checkpoint turn IDs for a workspace. */
export function listCheckpoints(
  cwd: string,
  agentId: string,
): Effect.Effect<string[], InvalidAgentIdError> {
  return Effect.gen(function* () {
    yield* assertSafeAgentIdProgram(agentId)
    return yield* Effect.promise(() => listCheckpointsPromise(cwd, agentId))
  })
}

// ─── Effect-native git runner (for callers that want typed GitError) ──────────
//
// Exposed for downstream perf-driver work. Internal use only for now —
// existing call sites remain on execFileAsync until they migrate.

interface CheckpointGitResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}
