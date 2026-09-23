/**
 * Where the verification gate's test run happens (PAN-3965).
 *
 * One full-suite run per push, on CI. For a project with CI configured the
 * verification gate runs typecheck and lint locally and treats the CI test job
 * on the PR head as the test gate: the gate named `test` is dropped from the
 * local gate list, merge readiness already requires green PR checks, and a red
 * CI test job reaches the work agent through `ci-failure-feedback.ts`.
 *
 * `projects.yaml` decides per project:
 *
 *   verification:
 *     tests: ci | local
 *
 * Unset, the mode is `ci` only when the project has a GitHub repo and one of
 * its GitHub Actions workflows runs on pull requests (or on pushes to feature
 * branches) AND defines a job whose check name `isCiTestCheckName` recognizes.
 * Anything less (release-only, docs, schedule or dispatch workflows, or a test
 * job named something the matcher misses) keeps the local test gate: dropping
 * it would leave no test run anywhere (review of #3993).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import yaml from 'js-yaml';

import type { ProjectConfig } from '../projects.js';
import type { QualityGateConfig } from '../workspace-config.js';

export type VerificationTestsMode = 'ci' | 'local';

/** The mode and why it was chosen: logged and recorded in the verification artifact. */
export interface VerificationTestsModeDecision {
  mode: VerificationTestsMode;
  reason: string;
}

/** The quality gate the CI test job replaces. Other gates always run locally. */
export const TEST_GATE_NAME = 'test';

export interface WorkflowFile {
  /** File name inside `.github/workflows/`. */
  name: string;
  content: string;
}

export interface VerificationTestsModeDeps {
  /** The GitHub Actions workflow files in `dir` (a `.github/workflows` directory). */
  readWorkflowFiles?: (dir: string) => WorkflowFile[];
}

function defaultReadWorkflowFiles(dir: string): WorkflowFile[] {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
      .sort()
      .flatMap((name) => {
        try {
          return [{ name, content: readFileSync(join(dir, name), 'utf-8') }];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/**
 * True when a CI check name is the project's test job: a check named
 * `test`/`tests`, optionally with a matrix suffix (`test (22)`) or a
 * `test-`/`test:` qualifier. `Clean install + server smoke test` is not it.
 */
export function isCiTestCheckName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /^tests?(?:\s*\(.*\)|[-_:].*)?$/i.test(name.trim());
}

/** A GitHub Actions branch-filter glob as a RegExp (`*` stays inside one path segment). */
function branchGlobToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]!;
    if (ch === '*' && glob[i + 1] === '*') {
      source += '.*';
      i += 1;
    } else if (ch === '*') {
      source += '[^/]*';
    } else {
      source += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/** Any `feature/<issue>` branch: the branch a work agent pushes. */
const SAMPLE_FEATURE_BRANCH = 'feature/pan-1';

function asStringList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** True when a `push` trigger fires for a pushed feature branch. */
function pushRunsOnFeatureBranches(push: unknown): boolean {
  if (push === null || push === undefined) return true;
  if (typeof push !== 'object') return false;
  const filters = push as Record<string, unknown>;
  if ('branches' in filters) {
    return asStringList(filters.branches)
      .some((pattern) => !pattern.startsWith('!') && branchGlobToRegExp(pattern).test(SAMPLE_FEATURE_BRANCH));
  }
  if ('branches-ignore' in filters) {
    return !asStringList(filters['branches-ignore'])
      .some((pattern) => branchGlobToRegExp(pattern).test(SAMPLE_FEATURE_BRANCH));
  }
  // A tags-only push filter never fires for a branch push.
  return !('tags' in filters) && !('tags-ignore' in filters);
}

const PULL_REQUEST_EVENTS = new Set(['pull_request', 'pull_request_target']);

/** True when a workflow's `on:` runs it for a feature branch's pull request. */
function triggersOnPullRequests(on: unknown): boolean {
  if (typeof on === 'string') return PULL_REQUEST_EVENTS.has(on) || on === 'push';
  if (Array.isArray(on)) {
    return on.some((event) => typeof event === 'string' && (PULL_REQUEST_EVENTS.has(event) || event === 'push'));
  }
  if (!on || typeof on !== 'object') return false;
  const events = on as Record<string, unknown>;
  if (Object.keys(events).some((event) => PULL_REQUEST_EVENTS.has(event))) return true;
  return 'push' in events && pushRunsOnFeatureBranches(events.push);
}

/**
 * The check name of the test job this workflow runs on pull requests, or null.
 * A job's check name is its `name:` when set, else its id.
 */
export function findPullRequestTestJob(workflowYaml: string): string | null {
  let doc: unknown;
  try {
    doc = yaml.load(workflowYaml);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;
  const workflow = doc as Record<string, unknown>;
  // A YAML 1.1 reader keys a bare `on:` as boolean true.
  const on = 'on' in workflow ? workflow.on : workflow['true'];
  if (!triggersOnPullRequests(on)) return null;
  const jobs = workflow.jobs;
  if (!jobs || typeof jobs !== 'object') return null;
  for (const [id, job] of Object.entries(jobs as Record<string, unknown>)) {
    const named = job && typeof job === 'object' ? (job as Record<string, unknown>).name : undefined;
    const checkName = typeof named === 'string' && named.trim().length > 0 ? named : id;
    if (isCiTestCheckName(checkName)) return checkName;
  }
  return null;
}

export type GitHubActionsTestJob =
  | { found: true; workflow: string; job: string }
  | { found: false; reason: string };

/**
 * Where the project's pull requests run a test job on GitHub Actions: the
 * workflow file and job, or why none qualifies.
 */
export function detectGitHubActionsTestJobSync(
  project: Pick<ProjectConfig, 'github_repo' | 'path' | 'workspace'>,
  deps: VerificationTestsModeDeps = {},
): GitHubActionsTestJob {
  if (!project.github_repo) return { found: false, reason: 'no github_repo configured' };
  if (!project.path) return { found: false, reason: 'no project path configured' };
  const readWorkflows = deps.readWorkflowFiles ?? defaultReadWorkflowFiles;
  const roots = [
    project.path,
    ...(project.workspace?.repos ?? [])
      .filter((repo) => typeof repo.path === 'string' && repo.path.length > 0)
      .map((repo) => (isAbsolute(repo.path) ? repo.path : join(project.path, repo.path))),
  ];
  let sawWorkflow = false;
  for (const root of roots) {
    const dir = join(root, '.github', 'workflows');
    for (const file of readWorkflows(dir)) {
      sawWorkflow = true;
      const job = findPullRequestTestJob(file.content);
      if (job) return { found: true, workflow: relative(project.path, join(dir, file.name)), job };
    }
  }
  return {
    found: false,
    reason: sawWorkflow
      ? 'no GitHub Actions workflow runs a test job (a check named test, tests, test-*, test (…)) on pull requests'
      : 'no GitHub Actions workflows',
  };
}

/**
 * The project's test-gate mode and the reason: the explicit
 * `verification.tests` key, else `ci` when a GitHub Actions workflow runs a
 * recognizable test job on pull requests, else `local`. An unknown project
 * keeps the local test gate.
 */
export function resolveVerificationTestsModeDecision(
  project: Pick<ProjectConfig, 'github_repo' | 'path' | 'workspace' | 'verification'> | null | undefined,
  deps: VerificationTestsModeDeps = {},
): VerificationTestsModeDecision {
  if (!project) return { mode: 'local', reason: 'project not found' };
  const explicit = project.verification?.tests;
  if (explicit === 'ci' || explicit === 'local') {
    return { mode: explicit, reason: `verification.tests: ${explicit} in projects.yaml` };
  }
  if (explicit !== undefined) {
    console.warn(`[verification] Ignoring verification.tests=${String(explicit)} for ${project.path}: expected ci or local`);
  }
  const detected = detectGitHubActionsTestJobSync(project, deps);
  return detected.found
    ? { mode: 'ci', reason: `${detected.workflow} runs test job "${detected.job}" on pull requests` }
    : { mode: 'local', reason: detected.reason };
}

/** The project's test-gate mode; see {@link resolveVerificationTestsModeDecision}. */
export function resolveVerificationTestsMode(
  project: Pick<ProjectConfig, 'github_repo' | 'path' | 'workspace' | 'verification'> | null | undefined,
  deps: VerificationTestsModeDeps = {},
): VerificationTestsMode {
  return resolveVerificationTestsModeDecision(project, deps).mode;
}

/**
 * The gates the verification runner executes on the host. In `ci` mode the
 * `test` gate is removed and named in `deferredToCi`.
 */
export function selectLocalVerificationGates(
  gates: Record<string, QualityGateConfig>,
  mode: VerificationTestsMode,
): { gates: Record<string, QualityGateConfig>; deferredToCi: string[] } {
  if (mode !== 'ci' || !(TEST_GATE_NAME in gates)) return { gates, deferredToCi: [] };
  const local = Object.fromEntries(Object.entries(gates).filter(([name]) => name !== TEST_GATE_NAME));
  return { gates: local, deferredToCi: [TEST_GATE_NAME] };
}
