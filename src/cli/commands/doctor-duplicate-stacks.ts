/**
 * Duplicate/mismatched Docker compose stack doctor check (PAN-3049).
 *
 * A workspace's declared compose project name (e.g. `myn-feature-<issue>`)
 * can end up running alongside — or instead of — the `overdeck-feature-<issue>`
 * fallback when a caller resolves the name before the devcontainer name has
 * a chance to be declared/rendered. This check is read-only: it stops
 * nothing itself, only reports what a human/agent should run.
 *
 * This check never emits an automatic teardown command when >=2 projects
 * are running for one issue. `docker ps` proves a container is running, not
 * that it is serving correctly, and no container-name heuristic (init-only,
 * excluding known support-container names, etc.) can substitute for a real
 * application health check — three review cycles each found a different
 * false positive that kind of heuristic let through. Reconciling which
 * duplicate is safe to stop is always left to `pan workspace rebuild` plus
 * an operator decision, never inferred here.
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
  resolveCanonicalProject: (issueId: string) => string | null,
): CheckResult[] {
  const projectsByIssue = new Map<string, Set<string>>();
  for (const container of containers) {
    if (!container.composeProject) continue;
    const issueId =
      inferIssueIdFromStackContainerName(container.composeProject) ??
      inferIssueIdFromStackContainerName(container.name);
    if (!issueId) continue;
    const projects = projectsByIssue.get(issueId) ?? new Set<string>();
    projects.add(container.composeProject);
    projectsByIssue.set(issueId, projects);
  }

  const results: CheckResult[] = [];
  for (const issueId of [...projectsByIssue.keys()].sort()) {
    const runningProjects = [...projectsByIssue.get(issueId)!].sort();
    const canonical = resolveCanonicalProject(issueId);

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
    // This check has no application-health signal — `docker ps` presence
    // proves a container is running, not that it is serving correctly, and
    // no container-name heuristic (init-only, non-support-container, etc.)
    // can substitute for a real health check (three review cycles each
    // found a different false-positive this kind of heuristic let through).
    // Always emit diagnosis-only guidance here; never a teardown command.
    // Reconciling which duplicate is safe to stop is an operator/`pan
    // workspace rebuild`-guided action, not something this check infers.
    results.push({
      name: `Duplicate Docker stack (${issueId})`,
      status: 'warn',
      message: canonical
        ? `${issueId} has ${runningProjects.length} running compose projects (canonical: ${canonical}): ${runningProjects.join(', ')}`
        : `${issueId} has ${runningProjects.length} running compose projects and no resolvable canonical name: ${runningProjects.join(', ')}`,
      fix: `Run \`pan workspace rebuild ${issueId}\` to confirm the canonical stack is healthy, then use \`docker ps\`/\`pan doctor\` output to decide which of the running projects (${runningProjects.join(', ')}) is safe to stop manually — this check does not have enough information to name one automatically.`,
    });
  }

  return results;
}

function resolveCanonicalComposeProjectForDoctor(issueId: string): string | null {
  const resolvedProject = resolveProjectFromIssueSync(issueId);
  const projectConfig = resolvedProject ? getProjectSync(resolvedProject.projectKey) : null;
  const workspacePath = defaultWorkspacePath(issueId, projectConfig);
  return tryComposeProjectNameForWorkspace(workspacePath, issueId);
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
