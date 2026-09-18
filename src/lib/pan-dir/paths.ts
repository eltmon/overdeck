/**
 * Project plan-home path authority (PAN-3917).
 *
 * Planning artifacts live in `.pan/` inside the repo they describe. There is no
 * state worktree and no migration marker: `getProjectPanPaths` is unconditional.
 *
 * A polyrepo project may nominate one of its sub-repos as the plan home through
 * `pan_records.repo` in `projects.yaml` (MYN uses `infra`). `resolvePlanHome`
 * resolves that sub-repo relative to the root it is given, so an agent working
 * in a worktree writes — and commits — the plan inside that same worktree.
 */
import { join } from 'path'
import { findProjectByPathSync, resolveInfraRepo } from '../projects.js'
import {
  PAN_DIRNAME,
  PAN_CONTINUES_DIRNAME,
  PAN_DRAFTS_DIRNAME,
  PAN_SPECS_DIRNAME,
  type ProjectPanPaths,
} from './types.js'

/**
 * The checkout that holds `.pan/` for `projectRoot`: the `pan_records.repo`
 * sub-repo when the project config names one, otherwise `projectRoot` itself.
 * An unregistered path is its own plan home.
 */
export function resolvePlanHome(projectRoot: string): string {
  const project = findProjectByPathSync(projectRoot)
  if (!project) return projectRoot
  return resolveInfraRepo(project, projectRoot).repoPath
}

export function getProjectPanPaths(projectRoot: string): ProjectPanPaths {
  const panDir = join(resolvePlanHome(projectRoot), PAN_DIRNAME)
  return {
    panDir,
    specsDir: join(panDir, PAN_SPECS_DIRNAME),
    draftsDir: join(panDir, PAN_DRAFTS_DIRNAME),
    continuesDir: join(panDir, PAN_CONTINUES_DIRNAME),
  }
}
