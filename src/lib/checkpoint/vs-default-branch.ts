/**
 * "vs main" for the diff panel (PAN-4501): the repository at `repoRoot` diffed
 * three-dot against its configured default branch. Shared by the agent and
 * conversation vs-main routes so both mean the same thing.
 */
import { resolveDefaultBranchForRepo } from '../project-repos.js'
import { diffAgainstBase, diffAgainstBaseFiles, resolveBaseRef, type TurnDiffFileChange } from './checkpoint-manager.js'

export interface VsDefaultBranchDiff {
  readonly baseBranch: string
  /** 'trunk' or 'origin/trunk'; null when the branch exists neither locally nor on origin. */
  readonly baseRef: string | null
  readonly files: TurnDiffFileChange[]
  /** Present only when `filePath` was given. */
  readonly diff?: string
}

export async function diffVsDefaultBranch(
  repoRoot: string,
  options: { projectKey?: string | null; filePath?: string } = {},
): Promise<VsDefaultBranchDiff> {
  const baseBranch = resolveDefaultBranchForRepo(repoRoot, options.projectKey)
  const baseRef = await resolveBaseRef(repoRoot, baseBranch)
  if (!baseRef) {
    return { baseBranch, baseRef: null, files: [], ...(options.filePath !== undefined && { diff: '' }) }
  }
  const files = await diffAgainstBaseFiles(repoRoot, baseRef)
  const diff = options.filePath !== undefined ? await diffAgainstBase(repoRoot, baseRef, options.filePath) : undefined
  return { baseBranch, baseRef, files, ...(diff !== undefined && { diff }) }
}
