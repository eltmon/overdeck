/**
 * Duplicate/mismatched Docker compose stack doctor check (PAN-3049).
 *
 * A workspace's declared compose project name (e.g. `myn-feature-<issue>`)
 * can end up running alongside — or instead of — the `overdeck-feature-<issue>`
 * fallback when a caller resolves the name before the devcontainer name has
 * a chance to be declared/rendered. This check is read-only: it stops
 * nothing itself, only reports what a human/agent should run.
 */
import { exec } from 'child_process';
import { promisify } from 'util';

import { getProjectSync, resolveProjectFromIssueSync } from '../../lib/projects.js';
import {
  defaultWorkspacePath,
  inferIssueIdFromStackContainerName,
  tryComposeProjectNameForWorkspace,
} from '../../lib/workspace/stack-health.js';

const execAsync = promisify(exec);

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-inotify.ts / doctor-state-worktree.ts) because importing it would
// create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export interface DuplicateStackContainerRow {
  name: string;
  composeProject?: string;
}

/** Canonical compose project name for an issue, plus where to run compose commands from. */
export interface CanonicalProjectInfo {
  project: string | null;
  workspacePath: string | null;
}

// One-shot/setup containers (init, migrations, test runners) can be
// "running" (mid-execution) without the canonical stack actually serving
// anything yet. Recommending a foreign-stack teardown on the strength of an
// init container alone can remove the only working stack while the
// canonical one is still initializing (review finding).
const NON_SERVICE_CONTAINER_RE = /(?:^|[-_])(?:init|setup|migrate|test-unit)(?:$|[-_])/i;

/**
 * Group running containers by issue (via `inferIssueIdFromStackContainerName`)
 * and flag any issue whose running stack doesn't match its canonical
 * compose-project name.
 *
 * `resolveCanonicalProject` is injected so tests can exercise this without
 * touching Docker or the filesystem; the real doctor check resolves it via
 * `tryComposeProjectNameForWorkspace` + `defaultWorkspacePath`.
 */
export function diagnoseDuplicateComposeStacks(
  containers: DuplicateStackContainerRow[],
  resolveCanonicalProject: (issueId: string) => CanonicalProjectInfo,
): CheckResult[] {
  const projectsByIssue = new Map<string, Map<string, string[]>>();
  for (const container of containers) {
    if (!container.composeProject) continue;
    const issueId =
      inferIssueIdFromStackContainerName(container.composeProject) ??
      inferIssueIdFromStackContainerName(container.name);
    if (!issueId) continue;
    const projects = projectsByIssue.get(issueId) ?? new Map<string, string[]>();
    const names = projects.get(container.composeProject) ?? [];
    names.push(container.name);
    projects.set(container.composeProject, names);
    projectsByIssue.set(issueId, projects);
  }

  const results: CheckResult[] = [];
  for (const issueId of [...projectsByIssue.keys()].sort()) {
    const projectContainers = projectsByIssue.get(issueId)!;
    const runningProjects = [...projectContainers.keys()].sort();
    const { project: canonical, workspacePath } = resolveCanonicalProject(issueId);

    if (runningProjects.length === 1) {
      // Healthy: the single running stack IS the canonical one. Silent.
      if (canonical && runningProjects[0] === canonical) continue;
      // Unresolvable canonical — nothing to safely compare against. Silent.
      if (!canonical) continue;

      const onlyName = runningProjects[0];
      results.push({
        name: `Duplicate Docker stack (${issueId})`,
        status: 'warn',
        message: `${issueId}'s only running stack is ${onlyName}, not its canonical name ${canonical}`,
        fix: `Stack runs under non-canonical name ${onlyName} and may be serving a live agent — run \`pan workspace rebuild ${issueId}\` and only stop ${onlyName} after the canonical stack is healthy.`,
      });
      continue;
    }

    // ≥2 distinct running compose projects for the same issue — a duplicate.
    // Only recommend stopping a project when the canonical one is confirmed
    // running AND has at least one real service container up (not just an
    // init/setup container) — otherwise we cannot safely tell whether the
    // canonical stack is actually serving anything yet, and must not point
    // the operator at stopping the foreign stack that might be the only one
    // actually working.
    const canonicalNames = canonical ? projectContainers.get(canonical) ?? [] : [];
    const canonicalHasRunningService = canonicalNames.some((name) => !NON_SERVICE_CONTAINER_RE.test(name));
    const canonicalConfirmedHealthy = canonical !== null && canonicalHasRunningService;
    if (!canonicalConfirmedHealthy) {
      const canonicalPresentButNotHealthy = canonical !== null && runningProjects.includes(canonical);
      results.push({
        name: `Duplicate Docker stack (${issueId})`,
        status: 'warn',
        message: canonicalPresentButNotHealthy
          ? `${issueId}'s canonical project ${canonical} is present but has no running service container yet (only init/setup): ${runningProjects.join(', ')}`
          : canonical
            ? `${issueId} has ${runningProjects.length} running compose projects, none matching its canonical name ${canonical}: ${runningProjects.join(', ')}`
            : `${issueId} has ${runningProjects.length} running compose projects and no resolvable canonical name: ${runningProjects.join(', ')}`,
        fix: `Run \`pan workspace rebuild ${issueId}\` to bring the canonical stack up, then run \`pan doctor\` again once it is healthy to see which of the running projects is safe to stop.`,
      });
      continue;
    }

    const foreign = runningProjects.filter((project) => project !== canonical);
    const composeDir = workspacePath ? `${workspacePath}/.devcontainer` : null;
    results.push({
      name: `Duplicate Docker stack (${issueId})`,
      status: 'warn',
      message: `${issueId} has ${runningProjects.length} running compose projects (canonical: ${canonical}): ${runningProjects.join(', ')}`,
      fix: foreign
        .map((name) =>
          composeDir
            ? `foreign stack ${name} is a duplicate: (cd "${composeDir}" && docker compose -p "${name}" down -v --remove-orphans)`
            : `foreign stack ${name} is a duplicate: docker compose -p "${name}" down -v --remove-orphans (run from the workspace's .devcontainer directory)`,
        )
        .join('\n'),
    });
  }

  return results;
}

function resolveCanonicalComposeProjectForDoctor(issueId: string): CanonicalProjectInfo {
  const resolvedProject = resolveProjectFromIssueSync(issueId);
  const projectConfig = resolvedProject ? getProjectSync(resolvedProject.projectKey) : null;
  const workspacePath = defaultWorkspacePath(issueId, projectConfig);
  return { project: tryComposeProjectNameForWorkspace(workspacePath, issueId), workspacePath };
}

export async function checkDuplicateComposeStacks(): Promise<CheckResult[]> {
  try {
    const { stdout } = await execAsync(
      `docker ps --format '{{.Names}}\t{{.Label "com.docker.compose.project"}}'`,
    );
    const containers: DuplicateStackContainerRow[] = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, composeProject] = line.split('\t');
        return { name, composeProject: composeProject || undefined };
      });
    return diagnoseDuplicateComposeStacks(containers, resolveCanonicalComposeProjectForDoctor);
  } catch {
    return [];
  }
}
