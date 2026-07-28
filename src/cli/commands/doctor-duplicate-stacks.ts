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
    // among the running set — otherwise we cannot safely tell which stack is
    // the real one, and must not point the operator at stopping all of them.
    const canonicalConfirmedRunning = canonical !== null && runningProjects.includes(canonical);
    if (!canonicalConfirmedRunning) {
      results.push({
        name: `Duplicate Docker stack (${issueId})`,
        status: 'warn',
        message: canonical
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
