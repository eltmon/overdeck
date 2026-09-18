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
import { join, relative, resolve, sep } from 'path'
import { findProjectByPathSync, resolveInfraRepo } from '../projects.js'
import {
  PAN_DIRNAME,
  PAN_CONTINUES_DIRNAME,
  PAN_DRAFTS_DIRNAME,
  PAN_SPECS_DIRNAME,
  type ProjectPanPaths,
} from './types.js'

/**
 * The checkout a path belongs to: its workspace worktree when the path is
 * inside `<project>/workspaces/<name>/`, otherwise the project root. Callers
 * hand this function anything from a project root to a nested `process.cwd()`,
 * so the answer must not depend on how deep the path is.
 */
function checkoutRootFor(project: { path: string }, somePath: string): string {
  const rel = relative(resolve(project.path), resolve(somePath))
  if (rel && !rel.startsWith('..')) {
    const [first, second] = rel.split(sep)
    if (first === 'workspaces' && second) return join(resolve(project.path), 'workspaces', second)
  }
  return resolve(project.path)
}

/**
 * The checkout that holds `.pan/` for `projectRoot`: the `pan_records.repo`
 * sub-repo when the project config names one, otherwise the checkout itself.
 * An unregistered path is its own plan home.
 *
 * Idempotent over depth — a nested path inside a checkout resolves to the same
 * plan home as the checkout root, so a CLI invoked from a subdirectory writes
 * the same `.pan/` a CLI invoked from the root does.
 */
export function resolvePlanHome(projectRoot: string): string {
  const project = findProjectByPathSync(projectRoot)
  if (!project) return projectRoot
  return resolveInfraRepo(project, checkoutRootFor(project, projectRoot)).repoPath
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
