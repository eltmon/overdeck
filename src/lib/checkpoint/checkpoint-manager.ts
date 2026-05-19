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
import { mkdtemp, rm, writeFile } from 'fs/promises'

const execFileAsync = promisify(execFile)

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
    // These files are gitignored but may still be tracked on older branches (once
    // tracked, gitignore stops applying). Without this removal, read-tree HEAD
    // copies them into the temp index and they leak into checkpoint commits.
    // When the workspace is later rebased, these files can be dropped as "already
    // upstream", causing the verification gate to lose AC progress (PAN-1215).
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
    // Best-effort: missing ref is tolerated
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
  try {
    // List only refs scoped to this agent: refs/pan/turn/<agentId>/<turnId>
    // strip=4 removes the first 4 slash-delimited components, yielding just <turnId>
    const { stdout } = await execFileAsync('git', [
      'for-each-ref', '--format=%(refname:strip=4)', `${CHECKPOINT_REF_PREFIX}/${agentId}/`,
    ], { cwd, encoding: 'utf-8' })
    return stdout.split('\n').filter(Boolean).sort()
  } catch {
    return []
  }
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
    try {
      assertSafeAgentId(agentId)
      const turns = await listCheckpoints(cwd, agentId)
      if (turns.length === 0) continue
      for (const turnId of turns) {
        await deleteCheckpoint(cwd, agentId, turnId)
      }
      console.log(`[checkpoint] Pruned ${turns.length} ref(s) for agent ${agentId}`)
      totalRefs += turns.length
    } catch (err) {
      console.warn(`[checkpoint] Could not prune refs for agent ${agentId}: ${err}`)
    }
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
