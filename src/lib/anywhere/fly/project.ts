/**
 * The project on a Fly machine (PAN-4652 WI-9, FR-9).
 *
 * `ensureFlyProject()` clones a home project onto the VM over HTTPS into
 * `/workspace/<projectKey>` and registers it there with `pan project clone`, so
 * the VM's projects.yaml carries the same key and `github_repo`. The clone
 * outlasts the 60 s exec deadline, so it runs detached and is polled. Only
 * GitHub projects qualify: the image has no `glab` and GitHub credentials are
 * the ones `syncAllCredentials` copied.
 *
 * `ensureFlyWorkspace()` (PAN-4734 D-3) adds the issue's git worktree under
 * that clone, `workspaces/feature-<issue>`, where `pan task` on the VM looks
 * for the plan. It uses `git worktree add`, not `pan workspace create`: the
 * latter refuses below a 10 GiB free-disk floor and installs dependencies.
 *
 * Every value that reaches the remote shell is validated against a fixed
 * grammar first, so the command needs no quoting.
 */
import type { ProjectConfig } from '../../projects.js';
import { getProjectSync } from '../../projects.js';
import type { FlyApiClient, FlyExecResult } from '../../remote/fly-api.js';
import { detached, FlyMachineError, loadFlyApi, pollUntil } from './provision.js';

const PROJECT_LOG = '/tmp/pan-project.log';
const PROJECT_EXIT = '/tmp/pan-project.exit';
const EXEC_TIMEOUT_SECONDS = 60;
/** The clone deadline of `cloneDetached` in remote-workspace.ts. */
const CLONE_POLL = { intervalMs: 5_000, limitMs: 20 * 60_000 };

const GITHUB_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PROJECT_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const ISSUE_PREFIX_RE = /^[A-Za-z][A-Za-z0-9]*$/;
const ISSUE_ID_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
/** The git identity of a remote work agent (`remote-workspace.ts`). */
const AGENT_GIT_IDENTITY = 'git config user.email "panopticon-agent[bot]@users.noreply.github.com" && git config user.name "panopticon-agent[bot]"';

export interface FlyProjectDeps {
  api: Pick<FlyApiClient, 'execCommand'>;
  getProject: (key: string) => ProjectConfig | null;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

async function resolveDeps(overrides: Partial<FlyProjectDeps>): Promise<FlyProjectDeps> {
  return {
    api: overrides.api ?? await loadFlyApi(),
    getProject: overrides.getProject ?? getProjectSync,
    now: overrides.now ?? Date.now,
    sleep: overrides.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}

function fail(message: string, detail: Record<string, unknown> = {}): never {
  throw new FlyMachineError('project-failed', message, detail);
}

/** The `pan project clone` command for a home project, or a `project-failed` error before anything runs. */
function cloneCommand(projectKey: string, project: ProjectConfig | null): string {
  if (!project) fail(`No project ${projectKey} is registered on this machine.`, { projectKey });
  if (!project.github_repo) fail(`Only GitHub projects can run on a Fly machine; ${projectKey} has no github_repo.`, { projectKey });
  if (!GITHUB_REPO_RE.test(project.github_repo)) fail(`${projectKey} has an unexpected github_repo: ${project.github_repo}`, { projectKey });
  if (!PROJECT_KEY_RE.test(projectKey)) fail(`Project key ${projectKey} cannot be used as a directory name on the Fly machine.`, { projectKey });
  const prefix = project.issue_prefix && ISSUE_PREFIX_RE.test(project.issue_prefix) ? ` --issue-prefix ${project.issue_prefix}` : '';
  return `pan project clone https://github.com/${project.github_repo}.git --parent /workspace --name ${projectKey}${prefix}`;
}

export async function ensureFlyProject(
  machine: { appName: string; machineId: string },
  projectKey: string,
  overrides: Partial<FlyProjectDeps> = {},
): Promise<void> {
  // Validate before resolving deps: a bad project must not even load a Fly client.
  const clone = cloneCommand(projectKey, (overrides.getProject ?? getProjectSync)(projectKey));
  const deps = await resolveDeps(overrides);
  const exec = (command: string): Promise<FlyExecResult> =>
    deps.api.execCommand(machine.appName, machine.machineId, ['/bin/sh', '-c', command], EXEC_TIMEOUT_SECONDS);

  const start = await exec(`rm -f ${PROJECT_EXIT} && ${detached(`${clone} > ${PROJECT_LOG} 2>&1; echo $? > ${PROJECT_EXIT}`)}`);
  if (start.exit_code !== 0) fail(`Could not start the clone of ${projectKey} on Fly machine ${machine.machineId}: ${start.stderr.trim()}`, { projectKey });

  let code = '';
  const finished = await pollUntil(deps, CLONE_POLL, async () => {
    code = (await exec(`cat ${PROJECT_EXIT}`)).stdout.trim();
    return code !== '';
  });
  if (!finished) fail(`Cloning ${projectKey} on Fly machine ${machine.machineId} did not finish within 20 min.`, { projectKey });
  if (code !== '0') {
    const tail = (await exec(`tail -n 20 ${PROJECT_LOG}`).catch(() => null))?.stdout ?? '';
    fail(`pan project clone of ${projectKey} on Fly machine ${machine.machineId} exited ${code}:\n${tail}`, { projectKey, log: tail });
  }

  const listed = await exec('pan project list --json');
  let keys: string[] = [];
  try {
    keys = Object.keys(JSON.parse(listed.stdout) as Record<string, unknown>);
  } catch {
    // Not JSON: no projects are registered.
  }
  if (!keys.includes(projectKey)) fail(`Fly machine ${machine.machineId} does not list project ${projectKey} after the clone.`, { projectKey });
}

/**
 * Create the issue's worktree, `/workspace/<projectKey>/workspaces/feature-<issue>`,
 * on its pushed feature branch, and return its path. Fails with
 * `workspace-failed` and the remote stderr.
 */
export async function ensureFlyWorkspace(
  machine: { appName: string; machineId: string },
  projectKey: string,
  issueId: string,
  overrides: Partial<FlyProjectDeps> = {},
): Promise<string> {
  const failWorkspace = (message: string): never => {
    throw new FlyMachineError('workspace-failed', message, { projectKey, issueId });
  };
  if (!PROJECT_KEY_RE.test(projectKey)) failWorkspace(`Project key ${projectKey} cannot be used as a directory name on the Fly machine.`);
  if (!ISSUE_ID_RE.test(issueId)) failWorkspace(`${issueId} is not an issue id.`);
  const deps = await resolveDeps(overrides);
  const exec = (command: string): Promise<FlyExecResult> =>
    deps.api.execCommand(machine.appName, machine.machineId, ['/bin/sh', '-c', command], EXEC_TIMEOUT_SECONDS);

  const issue = issueId.toLowerCase();
  const branch = `feature/${issue}`;
  const relative = `workspaces/feature-${issue}`;
  const projectDir = `/workspace/${projectKey}`;
  const worktree = `${projectDir}/${relative}`;
  const created = await exec(
    `cd ${projectDir} && ${AGENT_GIT_IDENTITY} && git fetch origin ${branch} && git worktree add -b ${branch} ${relative} origin/${branch}`,
  );
  if (created.exit_code !== 0) {
    failWorkspace(`Could not create the ${branch} worktree on Fly machine ${machine.machineId} (exit ${created.exit_code}): ${created.stderr.trim()}`);
  }
  const current = (await exec(`git -C ${worktree} branch --show-current`)).stdout.trim();
  if (current !== branch) failWorkspace(`The worktree on Fly machine ${machine.machineId} is on ${current || 'no branch'}, not ${branch}.`);
  return worktree;
}
