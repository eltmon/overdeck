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
 * Unset, the mode is `ci` when the project has a GitHub repo with GitHub
 * Actions workflows (the forge whose failures the CI-failure relay routes back
 * to the agent), otherwise `local`.
 */
import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import type { ProjectConfig } from '../projects.js';
import type { QualityGateConfig } from '../workspace-config.js';

export type VerificationTestsMode = 'ci' | 'local';

/** The quality gate the CI test job replaces. Other gates always run locally. */
export const TEST_GATE_NAME = 'test';

export interface VerificationTestsModeDeps {
  /** True when `dir` holds at least one GitHub Actions workflow file. */
  hasWorkflowFiles?: (dir: string) => boolean;
}

function defaultHasWorkflowFiles(dir: string): boolean {
  try {
    if (!existsSync(dir)) return false;
    return readdirSync(dir).some((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
  } catch {
    return false;
  }
}

/** True when the project runs GitHub Actions CI on its PRs. */
export function hasGitHubActionsCiSync(
  project: Pick<ProjectConfig, 'github_repo' | 'path' | 'workspace'>,
  deps: VerificationTestsModeDeps = {},
): boolean {
  if (!project.github_repo || !project.path) return false;
  const hasWorkflows = deps.hasWorkflowFiles ?? defaultHasWorkflowFiles;
  const roots = [
    project.path,
    ...(project.workspace?.repos ?? [])
      .filter((repo) => typeof repo.path === 'string' && repo.path.length > 0)
      .map((repo) => (isAbsolute(repo.path) ? repo.path : join(project.path, repo.path))),
  ];
  return roots.some((root) => hasWorkflows(join(root, '.github', 'workflows')));
}

/**
 * The project's test-gate mode: the explicit `verification.tests` key, else
 * `ci` when GitHub Actions CI is configured, else `local`. An unknown project
 * keeps the local test gate.
 */
export function resolveVerificationTestsMode(
  project: Pick<ProjectConfig, 'github_repo' | 'path' | 'workspace' | 'verification'> | null | undefined,
  deps: VerificationTestsModeDeps = {},
): VerificationTestsMode {
  if (!project) return 'local';
  const explicit = project.verification?.tests;
  if (explicit === 'ci' || explicit === 'local') return explicit;
  if (explicit !== undefined) {
    console.warn(`[verification] Ignoring verification.tests=${String(explicit)} for ${project.path}: expected ci or local`);
  }
  return hasGitHubActionsCiSync(project, deps) ? 'ci' : 'local';
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

/**
 * True when a CI check name is the project's test job: a check named
 * `test`/`tests`, optionally with a matrix suffix (`test (22)`) or a
 * `test-`/`test:` qualifier. `Clean install + server smoke test` is not it.
 */
export function isCiTestCheckName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /^tests?(?:\s*\(.*\)|[-_:].*)?$/i.test(name.trim());
}
