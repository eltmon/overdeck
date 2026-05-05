/**
 * Canonical lists of paths that destructive workspace operations must respect.
 *
 * Two lists, two semantics — do not conflate:
 *
 * - RESTART_PRESERVE: state that must survive ANY workspace-restart op.
 *   Lose any of these and the agent's progress is gone.
 *
 * - WORKSPACE_ARTIFACTS: regenerable build outputs that must NOT be wiped
 *   by `git clean` (would force expensive re-render / reinstall) but ARE
 *   legitimate to delete during a deliberate rebuild.
 *
 * Use these constants from any code path that runs `git clean -e ...`,
 * `rm -rf` over a workspace, or copies files between locations.
 */

/**
 * Workspace state that must survive a restart-from-plan or similar op.
 *
 * If this list is incomplete, an automatic restart can destroy the agent's
 * planning artifacts, beads, and the workspace-local orchestration state.
 */
export const RESTART_PRESERVE = [
  '.pan',
  '.beads',
] as const;

/**
 * Regenerable workspace build artifacts.
 *
 * `git clean` MUST exclude these. They are expensive or impossible to
 * regenerate from scratch without running the full workspace setup flow,
 * and losing them silently breaks running containers.
 *
 * NOT a security boundary — code that intentionally rebuilds a workspace
 * (e.g. `pan workspace destroy`) is allowed to delete these.
 */
export const WORKSPACE_ARTIFACTS = [
  '.devcontainer',     // rendered docker compose + Dockerfile + dev script
  '.env',              // workspace env vars (ports, URLs, secrets)
  '.env.local',
  'node_modules',
  'dev',               // symlink to .devcontainer/dev
  'fe/.env.local',     // sub-repo env files (polyrepo workspaces)
  'api/.env.local',
] as const;

/**
 * Combined list of every path that `git clean -fd` must exclude.
 * Use this directly when constructing a `git clean` command line.
 */
export const GIT_CLEAN_EXCLUDES = [
  ...RESTART_PRESERVE,
  ...WORKSPACE_ARTIFACTS,
] as const;

/**
 * Format the exclude list as `-e <path>` flags for `git clean`.
 */
export function gitCleanExcludeFlags(extra: readonly string[] = []): string {
  const all = [...GIT_CLEAN_EXCLUDES, ...extra];
  return all.map(p => `-e ${JSON.stringify(p)}`).join(' ');
}
