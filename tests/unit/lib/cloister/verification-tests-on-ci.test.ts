/**
 * PAN-3965: one full-suite run per push, on CI.
 *
 * A CI-configured project's verification gate runs no test gate on the host —
 * asserted through the verification artifact's gate list — while
 * `verification.tests: local` keeps the local test run.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFindProject, mockRunQualityGates } = vi.hoisted(() => ({
  mockFindProject: vi.fn(),
  mockRunQualityGates: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  findProjectByPathSync: mockFindProject,
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/cloister/validation.js', () => ({
  DEFAULT_GATES: {
    typecheck: { command: 'npm run typecheck' },
    lint: { command: 'npm run lint' },
    test: { command: 'npx vitest run --changed {{CHANGED_BASE}}' },
  },
  // Stand-in for the real gate runner: every gate it is handed "passes", and
  // the result list is exactly the gates that would have run on the host.
  runQualityGates: (gates: Record<string, unknown>, ...rest: unknown[]) => Effect.sync(() => {
    mockRunQualityGates(gates, ...rest);
    return Object.keys(gates).map((name) => ({ name, passed: true, required: true, output: '', durationMs: 1 }));
  }),
}));

vi.mock('../../../../src/lib/cloister/pr-facts.js', () => ({
  getPrFacts: vi.fn(async () => ({ merged: false, open: true, exists: true })),
}));
vi.mock('../../../../src/lib/cloister/test-skip-run.js', () => ({
  evaluateTestSkipGate: vi.fn(async () => ({ failed: false, evidence: '' })),
}));
vi.mock('../../../../src/lib/cloister/verification-check-run.js', () => ({
  postVerificationCheckRun: vi.fn(async () => null),
}));
vi.mock('../../../../src/lib/activity-logger.js', () => ({ emitActivityEntrySync: vi.fn() }));
vi.mock('../../../../src/lib/cloister/feedback-target.js', () => ({
  resolveIssueFeedbackTarget: vi.fn(async () => ({ needsYou: true, reason: 'no agent in this test' })),
  surfaceIssueFeedbackNeedsYou: vi.fn(async () => undefined),
}));
const { mockSetAgentPaused, mockStopAgent } = vi.hoisted(() => ({
  mockSetAgentPaused: vi.fn(),
  mockStopAgent: vi.fn(),
}));
vi.mock('../../../../src/lib/agents.js', () => ({
  clearAgentPaused: vi.fn(() => Effect.void),
  getAgentStateSync: vi.fn(() => null),
  messageAgent: vi.fn(async () => ({ delivered: true, queuedToMail: false })),
  setAgentPaused: (...args: unknown[]) => { mockSetAgentPaused(...args); return Effect.void; },
  stopAgent: (...args: unknown[]) => { mockStopAgent(...args); return Effect.void; },
}));
vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: vi.fn(() => Effect.succeed({ success: true, filePath: '/tmp/feedback.md' })),
}));
vi.mock('../../../../src/lib/telemetry/pipeline.js', () => ({ capturePipelineStageForIssue: vi.fn() }));
vi.mock('../../../../src/lib/github-app.js', () => ({ postOverdeckTestsStatus: vi.fn(async () => undefined) }));
vi.mock('../../../../src/lib/xbrief/acceptance-criteria.js', () => ({ getXBriefACStatusSync: vi.fn(() => null) }));
vi.mock('../../../../src/lib/work/done-preflight.js', () => ({ checkIncompletePlanItemsPromise: vi.fn(async () => []) }));

import { runVerificationForIssueInProcess } from '../../../../src/lib/cloister/verification-runner.js';
import { readVerificationArtifact, writeVerificationArtifact } from '../../../../src/lib/cloister/verification-artifact.js';
import { readPipelineJournal } from '../../../../src/lib/cloister/pipeline-journal.js';
import {
  findPullRequestTestJob,
  isCiTestCheckName,
  resolveVerificationTestsMode,
  resolveVerificationTestsModeDecision,
  selectLocalVerificationGates,
  type WorkflowFile,
} from '../../../../src/lib/cloister/verification-tests-mode.js';

/** A CI workflow with a `test` job on pull requests (the shape of this repo's ci.yml). */
const PR_TEST_WORKFLOW = `name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps: [{ run: npm run lint }]
  test:
    runs-on: ubuntu-latest
    needs: [lint]
    steps: [{ run: npm test }]
`;

/** lexerra's docs workflow: path-filtered, no test job. */
const DOCS_WORKFLOW = `name: docs
on:
  pull_request:
    paths: ['docs/**']
jobs:
  links:
    runs-on: ubuntu-latest
    steps: [{ run: lychee docs }]
`;

const RELEASE_WORKFLOW = `name: release
on:
  push:
    tags: ['v*']
  workflow_dispatch:
jobs:
  test:
    runs-on: ubuntu-latest
    steps: [{ run: npm test }]
`;

const SCHEDULED_TEST_WORKFLOW = `name: nightly
on:
  schedule:
    - cron: '0 3 * * *'
jobs:
  tests:
    runs-on: ubuntu-latest
    steps: [{ run: npm test }]
`;

const PROJECT_GATES = {
  typecheck: { command: 'npm run typecheck' },
  lint: { command: 'npm run lint' },
  test: { command: 'npx vitest run --changed {{CHANGED_BASE}}' },
};

let workspacePath: string;

function project(verification?: { tests?: 'ci' | 'local' }) {
  return {
    name: 'Overdeck',
    path: workspacePath,
    github_repo: 'eltmon/overdeck',
    // Polyrepo skips the dependency install the runner does for a monorepo.
    workspace: { type: 'polyrepo', default_branch: 'main' },
    quality_gates: PROJECT_GATES,
    ...(verification ? { verification } : {}),
  };
}

async function verify() {
  return Effect.runPromise(runVerificationForIssueInProcess(
    'PAN-3965', workspacePath, { isRemote: false }, 'test', { syncTargetBranch: false, skipPlanChecklist: true },
  ));
}

describe('verification gate with tests on CI (PAN-3965)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspacePath = mkdtempSync(join(tmpdir(), 'pan-3965-verify-'));
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('a CI-configured project runs typecheck and lint only; the artifact names test as deferred to CI', async () => {
    mockFindProject.mockReturnValue(project({ tests: 'ci' }));

    const outcome = await verify();

    expect(outcome).toEqual({ outcome: 'passed' });
    const gatesRun = Object.keys(mockRunQualityGates.mock.calls[0]![0] as Record<string, unknown>);
    expect(gatesRun).toEqual(['typecheck', 'lint']);
    const artifact = readVerificationArtifact(workspacePath);
    expect(artifact?.gates.map((gate) => gate.name)).toEqual(['typecheck', 'lint']);
    expect(artifact?.deferredToCi).toEqual(['test']);
    // Review of #3993: the artifact says where the test gate ran, and why.
    expect(artifact?.testsMode).toEqual({ mode: 'ci', reason: 'verification.tests: ci in projects.yaml' });
    expect(readPipelineJournal(workspacePath).map((entry) => entry.type)).toEqual(['verification.started', 'verification.passed']);
  });

  it('a GitHub project whose only workflow is not a PR test job keeps the local test gate, and says why', async () => {
    mkdirSync(join(workspacePath, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(workspacePath, '.github', 'workflows', 'docs.yml'), DOCS_WORKFLOW);
    mockFindProject.mockReturnValue(project());

    await verify();

    const gatesRun = Object.keys(mockRunQualityGates.mock.calls[0]![0] as Record<string, unknown>);
    expect(gatesRun).toEqual(['typecheck', 'lint', 'test']);
    const artifact = readVerificationArtifact(workspacePath);
    expect(artifact?.deferredToCi).toBeUndefined();
    expect(artifact?.testsMode).toEqual({
      mode: 'local',
      reason: expect.stringContaining('no GitHub Actions workflow runs a test job'),
    });
  });

  it('a GitHub project with a PR-triggered test job defers the test gate to CI', async () => {
    mkdirSync(join(workspacePath, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(workspacePath, '.github', 'workflows', 'ci.yml'), PR_TEST_WORKFLOW);
    mockFindProject.mockReturnValue(project());

    await verify();

    const gatesRun = Object.keys(mockRunQualityGates.mock.calls[0]![0] as Record<string, unknown>);
    expect(gatesRun).toEqual(['typecheck', 'lint']);
    expect(readVerificationArtifact(workspacePath)?.testsMode).toEqual({
      mode: 'ci',
      reason: '.github/workflows/ci.yml runs test job "test" on pull requests',
    });
  });

  it('verification.tests: local still runs the test gate on the host', async () => {
    mockFindProject.mockReturnValue(project({ tests: 'local' }));

    await verify();

    const gatesRun = Object.keys(mockRunQualityGates.mock.calls[0]![0] as Record<string, unknown>);
    expect(gatesRun).toEqual(['typecheck', 'lint', 'test']);
    const artifact = readVerificationArtifact(workspacePath);
    expect(artifact?.gates.map((gate) => gate.name)).toEqual(['typecheck', 'lint', 'test']);
    expect(artifact?.deferredToCi).toBeUndefined();
  });

  it('an unknown project keeps the default gates, test included', async () => {
    mockFindProject.mockReturnValue(null);

    await verify();

    const gatesRun = Object.keys(mockRunQualityGates.mock.calls[0]![0] as Record<string, unknown>);
    expect(gatesRun).toEqual(['typecheck', 'lint', 'test']);
  });
});

describe('a head whose CI test job is already red (PAN-3965)', () => {
  let head8: string;

  beforeEach(() => {
    vi.clearAllMocks();
    workspacePath = mkdtempSync(join(tmpdir(), 'pan-3965-verify-red-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: workspacePath, encoding: 'utf-8' }).trim();
    git('init', '-q');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    head8 = git('rev-parse', '--short=8', 'HEAD');
    mockFindProject.mockReturnValue(project({ tests: 'ci' }));
    // The CI relay recorded this head's red test job.
    writeVerificationArtifact(workspacePath, 'PAN-3965', [{ name: 'test', passed: false, required: true, output: 'CI red', durationMs: 0 }], {
      ranAt: '2026-09-23T00:00:00.000Z', head8, via: 'ci',
    });
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('re-requesting review on the same head fails test and counts against the same budget', async () => {
    const outcome = await verify();

    // One CI failure already recorded at this head + this run = 2 on `test` → no progress → pause.
    expect(outcome).toEqual({ outcome: 'failed', failedCheck: 'test', cycleCount: 2, maxCycles: 3 });
    expect(mockSetAgentPaused).toHaveBeenCalledWith('agent-pan-3965', expect.stringContaining('verification stuck after 2/3'), true);
    expect(mockStopAgent).toHaveBeenCalledWith('agent-pan-3965');
    expect(readPipelineJournal(workspacePath).at(-1)).toMatchObject({
      type: 'verification.failed',
      data: { failedCheck: 'test', cycleCount: 2 },
    });
  });

  it('a local-mode project ignores CI results and passes on its own gates', async () => {
    mockFindProject.mockReturnValue(project({ tests: 'local' }));

    expect(await verify()).toEqual({ outcome: 'passed' });
  });
});

describe('resolveVerificationTestsMode (review of #3993: a PR-triggered test job, not any workflow)', () => {
  const base = { path: '/p', github_repo: 'o/r' };
  const workflowsIn = (files: Record<string, WorkflowFile[]>) => ({
    readWorkflowFiles: (dir: string) => files[dir] ?? [],
  });
  const at = (content: string, name = 'ci.yml'): WorkflowFile[] => [{ name, content }];

  it('is ci when a workflow runs a test job on pull requests', () => {
    expect(resolveVerificationTestsModeDecision(base, workflowsIn({ '/p/.github/workflows': at(PR_TEST_WORKFLOW) }))).toEqual({
      mode: 'ci',
      reason: '.github/workflows/ci.yml runs test job "test" on pull requests',
    });
  });

  it('finds the test job in a polyrepo member repo', () => {
    const polyrepo = { ...base, workspace: { repos: [{ name: 'fe', path: 'fe' }] } } as Parameters<typeof resolveVerificationTestsMode>[0];
    expect(resolveVerificationTestsModeDecision(polyrepo, workflowsIn({ '/p/fe/.github/workflows': at(PR_TEST_WORKFLOW) }))).toEqual({
      mode: 'ci',
      reason: 'fe/.github/workflows/ci.yml runs test job "test" on pull requests',
    });
  });

  it('is local for release, docs, schedule and dispatch workflows (the lexerra case)', () => {
    const files = workflowsIn({
      '/p/.github/workflows': [
        { name: 'docs.yml', content: DOCS_WORKFLOW },
        { name: 'release.yml', content: RELEASE_WORKFLOW },
        { name: 'nightly.yml', content: SCHEDULED_TEST_WORKFLOW },
      ],
    });
    expect(resolveVerificationTestsModeDecision(base, files)).toEqual({
      mode: 'local',
      reason: 'no GitHub Actions workflow runs a test job (a check named test, tests, test-*, test (…)) on pull requests',
    });
  });

  it('is local when the PR workflow\'s test job has a name the matcher does not recognize', () => {
    const unrecognized = `on: pull_request\njobs:\n  unit-tests:\n    runs-on: ubuntu-latest\n    steps: [{ run: npm test }]\n`;
    expect(resolveVerificationTestsMode(base, workflowsIn({ '/p/.github/workflows': at(unrecognized) }))).toBe('local');
  });

  it('is local with no workflows, no GitHub repo, or no project', () => {
    expect(resolveVerificationTestsModeDecision(base, workflowsIn({}))).toEqual({ mode: 'local', reason: 'no GitHub Actions workflows' });
    expect(resolveVerificationTestsModeDecision({ path: '/p' }, workflowsIn({ '/p/.github/workflows': at(PR_TEST_WORKFLOW) })))
      .toEqual({ mode: 'local', reason: 'no github_repo configured' });
    expect(resolveVerificationTestsModeDecision(null)).toEqual({ mode: 'local', reason: 'project not found' });
  });

  it('an explicit key wins over detection', () => {
    expect(resolveVerificationTestsMode({ ...base, verification: { tests: 'local' } }, workflowsIn({ '/p/.github/workflows': at(PR_TEST_WORKFLOW) }))).toBe('local');
    expect(resolveVerificationTestsModeDecision({ path: '/p', verification: { tests: 'ci' } }, workflowsIn({}))).toEqual({
      mode: 'ci',
      reason: 'verification.tests: ci in projects.yaml',
    });
  });
});

describe('findPullRequestTestJob', () => {
  it('reads the job name, else the id, on pull_request, pull_request_target, and unfiltered or feature-branch pushes', () => {
    expect(findPullRequestTestJob(PR_TEST_WORKFLOW)).toBe('test');
    expect(findPullRequestTestJob('on: [push]\njobs:\n  build:\n    name: Test (${{ matrix.node }})\n')).toBe('Test (${{ matrix.node }})');
    expect(findPullRequestTestJob('on:\n  pull_request_target:\njobs:\n  tests: {}\n')).toBe('tests');
    expect(findPullRequestTestJob('on:\n  push:\n    branches: ["feature/**"]\njobs:\n  test-shard: {}\n')).toBe('test-shard');
    expect(findPullRequestTestJob('on:\n  push:\n    branches-ignore: [main]\njobs:\n  test: {}\n')).toBe('test');
  });

  it('ignores pushes the feature branch never makes, and non-test jobs', () => {
    expect(findPullRequestTestJob('on:\n  push:\n    branches: [main]\njobs:\n  test: {}\n')).toBeNull();
    expect(findPullRequestTestJob('on:\n  push:\n    tags: ["v*"]\njobs:\n  test: {}\n')).toBeNull();
    expect(findPullRequestTestJob('on:\n  push:\n    branches: ["*"]\njobs:\n  test: {}\n')).toBeNull();
    expect(findPullRequestTestJob('on: pull_request\njobs:\n  lint: {}\n  build:\n    name: Clean install + server smoke test\n')).toBeNull();
    expect(findPullRequestTestJob('not: [valid')).toBeNull();
  });
});

describe('selectLocalVerificationGates', () => {
  it('drops only the test gate in ci mode', () => {
    expect(selectLocalVerificationGates(PROJECT_GATES, 'ci')).toEqual({
      gates: { typecheck: PROJECT_GATES.typecheck, lint: PROJECT_GATES.lint },
      deferredToCi: ['test'],
    });
  });

  it('keeps every gate in local mode, and defers nothing when there is no test gate', () => {
    expect(selectLocalVerificationGates(PROJECT_GATES, 'local')).toEqual({ gates: PROJECT_GATES, deferredToCi: [] });
    const noTest = { lint: PROJECT_GATES.lint };
    expect(selectLocalVerificationGates(noTest, 'ci')).toEqual({ gates: noTest, deferredToCi: [] });
  });
});

describe('isCiTestCheckName', () => {
  it('matches the test job and its matrix legs, not every check that says "test"', () => {
    expect(isCiTestCheckName('test')).toBe(true);
    expect(isCiTestCheckName('tests')).toBe(true);
    expect(isCiTestCheckName('test (22)')).toBe(true);
    expect(isCiTestCheckName('test-unit')).toBe(true);
    expect(isCiTestCheckName('test-shard (1/4)')).toBe(true);
    expect(isCiTestCheckName('test-e2e')).toBe(true);
    expect(isCiTestCheckName('Clean install + server smoke test')).toBe(false);
    expect(isCiTestCheckName('lint')).toBe(false);
    expect(isCiTestCheckName('testing-tools')).toBe(false);
    expect(isCiTestCheckName(undefined)).toBe(false);
  });
});
