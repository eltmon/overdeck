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
import { Effect, Layer, Stream } from 'effect'
import { ChildProcess } from 'effect/unstable/process'
import * as NodeChildProcessSpawner from '@effect/platform-node/NodeChildProcessSpawner'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodePath from '@effect/platform-node/NodePath'
import { CheckpointError, GitError, InvalidAgentIdError, VcsError } from '../errors.js'

const execFileAsync = promisify(execFile)

const checkpointSpawnerLayer = NodeChildProcessSpawner.layer.pipe(
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
)

const CHECKPOINT_REF_PREFIX = 'refs/pan/turn'

// Agent IDs must be alphanumeric + hyphens/underscores to be safe as ref path segments.
const SAFE_AGENT_ID_RE = /^[a-zA-Z0-9_-]+$/
function assertSafeAgentId(agentId: string): void {
  if (!SAFE_AGENT_ID_RE.test(agentId)) {
    throw new Error(`Unsafe agentId for checkpoint ref: ${agentId}`)
  }
}
const CHECKPOINT_AUTHOR_NAME = 'Panopticon'
const CHECKPOINT_AUTHOR_EMAIL = 'panopticon@users.noreply.github.com'

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

/**
 * Capture a checkpoint at the current working tree state.
 *
 * Uses a temporary git index to include uncommitted changes in the checkpoint
 * without affecting the user's staging area. Creates a hidden ref that persists
 * until explicitly deleted.
 */
export async function captureCheckpoint(cwd: string, agentId: string, turnId: string): Promise<void> {
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
      await execFileAsync('git', ['rm', '--cached', '--ignore-unmatch', '.pan/continue.json', '.pan/spec.vbrief.json'], { cwd, env })
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

/**
 * Check whether a checkpoint exists for the given turn.
 */
export async function hasCheckpoint(cwd: string, agentId: string, turnId: string): Promise<boolean> {
  assertSafeAgentId(agentId)
  const commit = await resolveCheckpointCommit(cwd, agentId, turnId)
  return commit !== null
}

/**
 * Delete a checkpoint ref. No-op if it doesn't exist.
 */
export async function deleteCheckpoint(cwd: string, agentId: string, turnId: string): Promise<void> {
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

/**
 * Compute unified diff between two checkpoints.
 * Returns the raw git diff output.
 */
export async function diffCheckpoints(cwd: string, agentId: string, fromTurnId: string, toTurnId: string, filePath?: string): Promise<string> {
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

/**
 * Compute diff between a checkpoint and the current HEAD.
 * Useful for showing what changed since a specific turn.
 */
export async function diffCheckpointToHead(cwd: string, agentId: string, turnId: string): Promise<string> {
  assertSafeAgentId(agentId)
  const checkpointCommit = await resolveCheckpointCommit(cwd, agentId, turnId)
  if (!checkpointCommit) {
    throw new Error(`Checkpoint ref unavailable: ${turnId}`)
  }

  const { stdout } = await execFileAsync('git', [
    'diff', '--patch', '--minimal', '--no-color', checkpointCommit, 'HEAD',
  ], { cwd, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })

  return stdout
}

/**
 * Get file change summary between two checkpoints.
 * Returns per-file additions/deletions without the full patch.
 */
export async function diffCheckpointFiles(
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

/**
 * Get the committer date (ISO 8601) of a checkpoint commit.
 * Returns current time as fallback if the ref can't be resolved.
 */
export async function getCheckpointTimestamp(cwd: string, agentId: string, turnId: string): Promise<string> {
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

/**
 * Get the list of checkpoint turn IDs for a workspace.
 */
export async function listCheckpoints(cwd: string, agentId: string): Promise<string[]> {
  assertSafeAgentId(agentId)
  const { stdout } = await execFileAsync('git', [
    'for-each-ref', '--format=%(refname:strip=4)', `${CHECKPOINT_REF_PREFIX}/${agentId}/`,
  ], { cwd, encoding: 'utf-8' })
  return stdout.split('\n').filter(Boolean).sort()
}

/**
 * Delete all checkpoint refs for a workspace.
 */
export async function deleteAllCheckpoints(cwd: string, agentId: string): Promise<void> {
  assertSafeAgentId(agentId)
  const turns = await listCheckpoints(cwd, agentId)
  for (const turnId of turns) {
    await deleteCheckpoint(cwd, agentId, turnId)
  }
}

/**
 * Delete all checkpoint refs for a set of agent IDs.
 * Used at workspace teardown (merge/close-out) to clean up refs for specific agents.
 */
export async function pruneCheckpointRefsForAgents(cwd: string, agentIds: string[]): Promise<number> {
  let totalRefs = 0
  for (const agentId of agentIds) {
    assertSafeAgentId(agentId)
    const turns = await listCheckpoints(cwd, agentId)
    if (turns.length === 0) continue
    for (const turnId of turns) {
      await deleteCheckpoint(cwd, agentId, turnId)
    }
    console.log(`[checkpoint] Pruned ${turns.length} ref(s) for agent ${agentId}`)
    totalRefs += turns.length
  }
  if (totalRefs === 0) {
    console.log(`[checkpoint] No checkpoint refs found for agents: ${agentIds.join(', ')}`)
  }
  return totalRefs
}

/**
 * Delete all checkpoint refs older than olderThanDays days across all agents.
 * Safety net for abandoned workspaces whose postMergeLifecycle was never called.
 */
export async function pruneStaleCheckpointRefs(cwd: string, olderThanDays: number): Promise<number> {
  try {
    const { stdout } = await execFileAsync('git', [
      'for-each-ref',
      '--format=%(creatordate:unix) %(refname)',
      `${CHECKPOINT_REF_PREFIX}/`,
    ], { cwd, encoding: 'utf-8' })

    const allRefs = stdout.split('\n').filter(Boolean)
    const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 86400
    const staleRefs = allRefs.flatMap(line => {
      const spaceIdx = line.indexOf(' ')
      if (spaceIdx === -1) return []
      const ts = parseInt(line.slice(0, spaceIdx), 10)
      const ref = line.slice(spaceIdx + 1).trim()
      return ts < cutoff && ref ? [ref] : []
    })

    console.log(`[checkpoint] Global stale sweep: ${allRefs.length} total ref(s), ${staleRefs.length} older than ${olderThanDays} days`)

    let pruned = 0
    for (const ref of staleRefs) {
      try {
        await execFileAsync('git', ['update-ref', '-d', ref], { cwd, encoding: 'utf-8' })
        pruned++
      } catch (err) {
        console.warn(`[checkpoint] Could not delete stale ref ${ref}: ${err}`)
      }
    }
    if (pruned > 0) {
      console.log(`[checkpoint] Pruned ${pruned} stale checkpoint ref(s) older than ${olderThanDays} days`)
    }
    return pruned
  } catch (err) {
    console.warn(`[checkpoint] Stale ref sweep failed: ${err}`)
    return 0
  }
}

/**
 * One-time migration: delete legacy unscoped checkpoint refs (refs/pan/turn/<turnId>)
 * that were created before per-agent namespacing was introduced.
 * Safe to run multiple times (no-op if already migrated).
 */
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

/**
 * Compute unified diff of the workspace against the main branch.
 * Uses `git diff main...HEAD` (three-dot) to show changes on the
 * feature branch since it diverged from main.
 */
export async function diffAgainstMain(cwd: string, filePath?: string): Promise<string> {
  const args = ['diff', '--patch', '--minimal', '--no-color', 'main...HEAD']
  if (filePath) args.push('--', filePath)
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
  return stdout
}

/**
 * Get file change summary of the workspace against the main branch.
 */
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

// ─── Conversation diff helpers ───────────────────────────────────────────────

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

export async function diffSinceCommit(cwd: string, baseCommit: string): Promise<TurnDiffFileChange[]> {
  const [numstatResult, nameStatusResult] = await Promise.all([
    execFileAsync('git', ['diff', '--numstat', '--no-color', baseCommit], { cwd, encoding: 'utf-8' }),
    execFileAsync('git', ['diff', '--name-status', '--no-color', baseCommit], { cwd, encoding: 'utf-8' }),
  ])

  return parseNumstatWithStatus(numstatResult.stdout, nameStatusResult.stdout)
}

export async function diffFilesAgainstHead(cwd: string, filePaths: string[]): Promise<TurnDiffFileChange[]> {
  if (filePaths.length === 0) return []

  const [numstatResult, nameStatusResult] = await Promise.all([
    execFileAsync('git', ['diff', '--numstat', '--no-color', 'HEAD', '--', ...filePaths], { cwd, encoding: 'utf-8' }),
    execFileAsync('git', ['diff', '--name-status', '--no-color', 'HEAD', '--', ...filePaths], { cwd, encoding: 'utf-8' }),
  ])

  return parseNumstatWithStatus(numstatResult.stdout, nameStatusResult.stdout)
}

export async function diffPatchSinceCommit(cwd: string, baseCommit: string, filePath?: string): Promise<string> {
  const args = ['diff', '--patch', '--minimal', '--no-color', baseCommit]
  if (filePath) args.push('--', filePath)
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
  return stdout
}

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

function assertSafeAgentIdEffect(agentId: string): Effect.Effect<void, InvalidAgentIdError> {
  return SAFE_AGENT_ID_RE.test(agentId)
    ? Effect.void
    : Effect.fail(new InvalidAgentIdError({ agentId }))
}

/** Capture a checkpoint at the current working tree state. */
export function captureCheckpointEffect(
  cwd: string,
  agentId: string,
  turnId: string,
): Effect.Effect<void, CheckpointError | InvalidAgentIdError> {
  return Effect.gen(function* () {
    yield* assertSafeAgentIdEffect(agentId)
    yield* Effect.tryPromise({
      try: () => captureCheckpoint(cwd, agentId, turnId),
      catch: (cause) =>
        new CheckpointError({ agentId, operation: 'capture', message: String(cause), cause }),
    })
  })
}

/** Check whether a checkpoint exists for the given turn. */
export function hasCheckpointEffect(
  cwd: string,
  agentId: string,
  turnId: string,
): Effect.Effect<boolean, InvalidAgentIdError> {
  return Effect.gen(function* () {
    yield* assertSafeAgentIdEffect(agentId)
    return yield* Effect.promise(() => hasCheckpoint(cwd, agentId, turnId))
  })
}

/** Delete a checkpoint ref. No-op if it doesn't exist. */
export function deleteCheckpointEffect(
  cwd: string,
  agentId: string,
  turnId: string,
): Effect.Effect<void, InvalidAgentIdError> {
  return Effect.gen(function* () {
    yield* assertSafeAgentIdEffect(agentId)
    yield* Effect.promise(() => deleteCheckpoint(cwd, agentId, turnId))
  })
}

/** Compute unified diff between two checkpoints. */
export function diffCheckpointsEffect(
  cwd: string,
  agentId: string,
  fromTurnId: string,
  toTurnId: string,
  filePath?: string,
): Effect.Effect<string, CheckpointError | InvalidAgentIdError> {
  return Effect.gen(function* () {
    yield* assertSafeAgentIdEffect(agentId)
    return yield* Effect.tryPromise({
      try: () => diffCheckpoints(cwd, agentId, fromTurnId, toTurnId, filePath),
      catch: (cause) =>
        new CheckpointError({ agentId, operation: 'diff', message: String(cause), cause }),
    })
  })
}

/** Compute diff between a checkpoint and the current HEAD. */
export function diffCheckpointToHeadEffect(
  cwd: string,
  agentId: string,
  turnId: string,
): Effect.Effect<string, CheckpointError | InvalidAgentIdError> {
  return Effect.gen(function* () {
    yield* assertSafeAgentIdEffect(agentId)
    return yield* Effect.tryPromise({
      try: () => diffCheckpointToHead(cwd, agentId, turnId),
      catch: (cause) =>
        new CheckpointError({ agentId, operation: 'diff-to-head', message: String(cause), cause }),
    })
  })
}

/** Get file change summary between two checkpoints. */
export function diffCheckpointFilesEffect(
  cwd: string,
  agentId: string,
  fromTurnId: string,
  toTurnId: string,
): Effect.Effect<TurnDiffFileChange[], CheckpointError | InvalidAgentIdError> {
  return Effect.gen(function* () {
    yield* assertSafeAgentIdEffect(agentId)
    return yield* Effect.tryPromise({
      try: () => diffCheckpointFiles(cwd, agentId, fromTurnId, toTurnId),
      catch: (cause) =>
        new CheckpointError({ agentId, operation: 'diff-files', message: String(cause), cause }),
    })
  })
}

/** Get the committer date (ISO 8601) of a checkpoint commit. */
export function getCheckpointTimestampEffect(
  cwd: string,
  agentId: string,
  turnId: string,
): Effect.Effect<string, InvalidAgentIdError> {
  return Effect.gen(function* () {
    yield* assertSafeAgentIdEffect(agentId)
    return yield* Effect.promise(() => getCheckpointTimestamp(cwd, agentId, turnId))
  })
}

/** Get the list of checkpoint turn IDs for a workspace. */
export function listCheckpointsEffect(
  cwd: string,
  agentId: string,
): Effect.Effect<string[], InvalidAgentIdError> {
  return Effect.gen(function* () {
    yield* assertSafeAgentIdEffect(agentId)
    return yield* Effect.promise(() => listCheckpoints(cwd, agentId))
  })
}

/** Delete all checkpoint refs for a workspace. */
export function deleteAllCheckpointsEffect(
  cwd: string,
  agentId: string,
): Effect.Effect<void, InvalidAgentIdError> {
  return Effect.gen(function* () {
    yield* assertSafeAgentIdEffect(agentId)
    yield* Effect.promise(() => deleteAllCheckpoints(cwd, agentId))
  })
}

/** Delete all checkpoint refs for a set of agent IDs. */
export function pruneCheckpointRefsForAgentsEffect(
  cwd: string,
  agentIds: string[],
): Effect.Effect<number> {
  return Effect.promise(() => pruneCheckpointRefsForAgents(cwd, agentIds))
}

/** Delete all checkpoint refs older than olderThanDays days. */
export function pruneStaleCheckpointRefsEffect(
  cwd: string,
  olderThanDays: number,
): Effect.Effect<number> {
  return Effect.promise(() => pruneStaleCheckpointRefs(cwd, olderThanDays))
}

/** One-time migration: delete legacy unscoped checkpoint refs. */
export function deleteLegacyCheckpointRefsEffect(cwd: string): Effect.Effect<number> {
  return Effect.promise(() => deleteLegacyCheckpointRefs(cwd))
}

/** Compute unified diff of the workspace against the main branch. */
export function diffAgainstMainEffect(
  cwd: string,
  filePath?: string,
): Effect.Effect<string, VcsError> {
  return Effect.tryPromise({
    try: () => diffAgainstMain(cwd, filePath),
    catch: (cause) =>
      new VcsError({ operation: 'diff-against-main', message: String(cause), cause }),
  })
}

/** Get file change summary of the workspace against the main branch. */
export function diffAgainstMainFilesEffect(
  cwd: string,
): Effect.Effect<TurnDiffFileChange[], VcsError> {
  return Effect.tryPromise({
    try: () => diffAgainstMainFiles(cwd),
    catch: (cause) =>
      new VcsError({ operation: 'diff-against-main-files', message: String(cause), cause }),
  })
}

/** Find the commit SHA at the given timestamp (rev-list --before). */
export function findCommitAtTimeEffect(
  cwd: string,
  isoTimestamp: string,
): Effect.Effect<string | null> {
  return Effect.promise(() => findCommitAtTime(cwd, isoTimestamp))
}

/** Diff since a given base commit. */
export function diffSinceCommitEffect(
  cwd: string,
  baseCommit: string,
): Effect.Effect<TurnDiffFileChange[], VcsError> {
  return Effect.tryPromise({
    try: () => diffSinceCommit(cwd, baseCommit),
    catch: (cause) =>
      new VcsError({ operation: 'diff-since-commit', message: String(cause), cause }),
  })
}

/** Diff specific file paths against HEAD. */
export function diffFilesAgainstHeadEffect(
  cwd: string,
  filePaths: string[],
): Effect.Effect<TurnDiffFileChange[], VcsError> {
  return Effect.tryPromise({
    try: () => diffFilesAgainstHead(cwd, filePaths),
    catch: (cause) =>
      new VcsError({ operation: 'diff-files-against-head', message: String(cause), cause }),
  })
}

/** Patch diff since a given base commit. */
export function diffPatchSinceCommitEffect(
  cwd: string,
  baseCommit: string,
  filePath?: string,
): Effect.Effect<string, VcsError> {
  return Effect.tryPromise({
    try: () => diffPatchSinceCommit(cwd, baseCommit, filePath),
    catch: (cause) =>
      new VcsError({ operation: 'diff-patch-since-commit', message: String(cause), cause }),
  })
}

/** Patch diff for specific file paths against HEAD. */
export function diffPatchFilesAgainstHeadEffect(
  cwd: string,
  filePaths: string[],
): Effect.Effect<string, VcsError> {
  return Effect.tryPromise({
    try: () => diffPatchFilesAgainstHead(cwd, filePaths),
    catch: (cause) =>
      new VcsError({ operation: 'diff-patch-files-against-head', message: String(cause), cause }),
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

/** Run a git subcommand under ChildProcessSpawner. */
export function runCheckpointGit(
  args: readonly string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Effect.Effect<CheckpointGitResult, GitError> {
  return Effect.gen(function* () {
    const handle = yield* ChildProcess.make('git', [...args], {
      cwd,
      ...(env ? { env } : {}),
    })
    const stdoutBuf = yield* Stream.runFold(
      handle.stdout,
      () => Buffer.alloc(0),
      (acc, chunk) => Buffer.concat([acc, Buffer.from(chunk)]),
    )
    const stderrBuf = yield* Stream.runFold(
      handle.stderr,
      () => Buffer.alloc(0),
      (acc, chunk) => Buffer.concat([acc, Buffer.from(chunk)]),
    )
    const exitCode = yield* handle.exitCode
    if (exitCode !== 0) {
      return yield* Effect.fail(
        new GitError({
          command: ['git', ...args],
          stderr: stderrBuf.toString('utf-8'),
          exitCode,
        }),
      )
    }
    return {
      stdout: stdoutBuf.toString('utf-8'),
      stderr: stderrBuf.toString('utf-8'),
      exitCode,
    }
  }).pipe(
    Effect.scoped,
    Effect.provide(checkpointSpawnerLayer),
    Effect.catchCause((cause) =>
      Effect.fail(
        new GitError({
          command: ['git', ...args],
          stderr: String(cause),
          exitCode: -1,
          cause,
        }),
      ),
    ),
  )
}
