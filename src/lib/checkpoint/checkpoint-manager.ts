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

function checkpointRef(turnId: string): string {
  return `${CHECKPOINT_REF_PREFIX}/${turnId}`
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
async function resolveCheckpointCommit(cwd: string, turnId: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', '--quiet', `${checkpointRef(turnId)}^{commit}`], {
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
export async function captureCheckpoint(cwd: string, turnId: string): Promise<void> {
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

    // Stage all working tree changes into temp index
    await execFileAsync('git', ['add', '-A', '--', '.'], { cwd, env })

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
    await execFileAsync('git', ['update-ref', checkpointRef(turnId), commit], { cwd })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

/**
 * Check whether a checkpoint exists for the given turn.
 */
export async function hasCheckpoint(cwd: string, turnId: string): Promise<boolean> {
  const commit = await resolveCheckpointCommit(cwd, turnId)
  return commit !== null
}

/**
 * Delete a checkpoint ref. No-op if it doesn't exist.
 */
export async function deleteCheckpoint(cwd: string, turnId: string): Promise<void> {
  try {
    await execFileAsync('git', ['update-ref', '-d', checkpointRef(turnId)], {
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
export async function diffCheckpoints(cwd: string, fromTurnId: string, toTurnId: string): Promise<string> {
  const fromCommit = await resolveCheckpointCommit(cwd, fromTurnId)
  const toCommit = await resolveCheckpointCommit(cwd, toTurnId)

  if (!fromCommit || !toCommit) {
    throw new Error(`Checkpoint ref unavailable for diff: from=${fromTurnId}(${fromCommit}) to=${toTurnId}(${toCommit})`)
  }

  const { stdout } = await execFileAsync('git', [
    'diff', '--patch', '--minimal', '--no-color', fromCommit, toCommit,
  ], { cwd, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })

  return stdout
}

/**
 * Compute diff between a checkpoint and the current HEAD.
 * Useful for showing what changed since a specific turn.
 */
export async function diffCheckpointToHead(cwd: string, turnId: string): Promise<string> {
  const checkpointCommit = await resolveCheckpointCommit(cwd, turnId)
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
  fromTurnId: string,
  toTurnId: string,
): Promise<TurnDiffFileChange[]> {
  const fromCommit = await resolveCheckpointCommit(cwd, fromTurnId)
  const toCommit = await resolveCheckpointCommit(cwd, toTurnId)

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
export async function getCheckpointTimestamp(cwd: string, turnId: string): Promise<string> {
  try {
    const commit = await resolveCheckpointCommit(cwd, turnId)
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
export async function listCheckpoints(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', [
      'for-each-ref', '--format=%(refname:strip=3)', `${CHECKPOINT_REF_PREFIX}/`,
    ], { cwd, encoding: 'utf-8' })
    return stdout.split('\n').filter(Boolean).sort()
  } catch {
    return []
  }
}

/**
 * Delete all checkpoint refs for a workspace.
 */
export async function deleteAllCheckpoints(cwd: string): Promise<void> {
  const turns = await listCheckpoints(cwd)
  for (const turnId of turns) {
    await deleteCheckpoint(cwd, turnId)
  }
}

/**
 * Compute unified diff of the workspace against the main branch.
 * Uses `git diff main...HEAD` (three-dot) to show changes on the
 * feature branch since it diverged from main.
 */
export async function diffAgainstMain(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', [
    'diff', '--patch', '--minimal', '--no-color', 'main...HEAD',
  ], { cwd, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
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
