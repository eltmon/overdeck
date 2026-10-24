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

const { mockFindProject, mockRunQualityGates, mockGateBody, mockGetPrFacts, mockEvaluateTestSkipGate } = vi.hoisted(() => ({
  mockFindProject: vi.fn(),
  mockRunQualityGates: vi.fn(),
  mockGateBody: vi.fn(),
  mockGetPrFacts: vi.fn(async () => ({ merged: false, open: true, exists: true })),
  mockEvaluateTestSkipGate: vi.fn(async () => ({ failed: false, evidence: '' })),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  findProjectByPath: mockFindProject,
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/cloister/validation.js', () => ({
  DEFAULT_GATES: {
    typecheck: { command: 'npm run typecheck' },
    lint: { command: 'npm run lint' },
    test: { command: 'npx vitest run --changed {{CHANGED_BASE}}' },
  },
  // Stand-in for the real gate runner: every gate it is handed "passes" unless
  // its body returns false, and the result list is exactly the gates that would
  // have run on the host. Like the real one, it asks `shouldStop` before each
  // gate and stops after a failed required gate (PAN-4531).
  runQualityGates: async (gates: Record<string, unknown>, path: unknown, phase: unknown, opts?: { shouldStop?: () => Promise<boolean> }) => {
    mockRunQualityGates(gates, path, phase, opts);
    const results = [];
    for (const name of Object.keys(gates)) {
      if (await opts?.shouldStop?.()) break;
      const passed = mockGateBody(name) !== false;
      results.push({ name, passed, required: true, output: '', durationMs: 1 });
      if (!passed) break;
    }
    return results;
  },
}));

vi.mock('../../../../src/lib/cloister/pr-facts.js', () => ({
  getPrFacts: mockGetPrFacts,
}));
vi.mock('../../../../src/lib/cloister/test-skip-run.js', () => ({
  evaluateTestSkipGate: mockEvaluateTestSkipGate,
}));
vi.mock('../../../../src/lib/cloister/plan-integrity-run.js', () => ({
  evaluatePlanIntegrityGate: vi.fn(async () => ({ failed: false, evidence: '' })),
}));
vi.mock('../../../../src/lib/cloister/verification-check-run.js', () => ({
  postVerificationCheckRun: vi.fn(async () => null),
}));
vi.mock('../../../../src/lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));
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
  getAgentState: vi.fn(() => null),
  messageAgent: vi.fn(async () => ({ delivered: true, queuedToMail: false })),
  setAgentPaused: (...args: unknown[]) => { mockSetAgentPaused(...args); return Effect.void; },
  stopAgent: (...args: unknown[]) => { mockStopAgent(...args); return Effect.void; },
}));
vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: vi.fn(async () => ({ success: true, filePath: '/tmp/feedback.md' })),
}));
vi.mock('../../../../src/lib/telemetry/pipeline.js', () => ({ capturePipelineStageForIssue: vi.fn() }));
vi.mock('../../../../src/lib/github-app.js', () => ({ postOverdeckTestsStatus: vi.fn(async () => undefined) }));
vi.mock('../../../../src/lib/xbrief/acceptance-criteria.js', () => ({ getXBriefACStatus: vi.fn(() => null) }));
vi.mock('../../../../src/lib/work/done-preflight.js', () => ({ checkIncompletePlanItems: vi.fn(async () => []) }));

import { runVerificationForIssueInProcess } from '../../../../src/lib/cloister/verification-runner.js';
import { readVerificationArtifact, writeVerificationArtifact } from '../../../../src/lib/cloister/verification-artifact.js';
import { readPipelineJournal } from '../../../../src/lib/cloister/pipeline-journal.js';
import {
  findPullRequestTestJob,
  isCiTestCheckName,
  isCiTestRollupCheck,
  isDaggerCloudTestCheck,
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
  return runVerificationForIssueInProcess(
    'PAN-3965', workspacePath, { isRemote: false }, 'test', { syncTargetBranch: false, skipPlanChecklist: true },
  );
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
    // PAN-4531: the head was known red before the run, so no local gate ran.
    expect(mockEvaluateTestSkipGate).not.toHaveBeenCalled();
    expect(mockRunQualityGates).not.toHaveBeenCalled();
    const artifact = readVerificationArtifact(workspacePath);
    expect(artifact?.notRun).toEqual(['typecheck', 'lint']);
    expect(artifact?.gates.find((gate) => gate.name === 'test')?.output)
      .toBe(`The CI test job already failed on this head (${head8}). Fix it and push a new commit; see .pan/feedback/ for the CI failure details.`);
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

  it('PAN-4527: verifying a new head B uses B\'s CI result, not the earlier head A\'s', async () => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: workspacePath, encoding: 'utf-8' }).trim();
    // The agent committed B after A's CI test job failed, and CI passed on B.
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'fix');
    writeVerificationArtifact(workspacePath, 'PAN-3965', [{ name: 'test', passed: true, required: true, output: 'CI green', durationMs: 0 }], {
      ranAt: '2026-09-23T00:10:00.000Z', head8: git('rev-parse', '--short=8', 'HEAD'), via: 'ci',
    });

    expect(await verify()).toEqual({ outcome: 'passed' });
  });
});

describe('a run whose outcome is decided mid-run (PAN-4531)', () => {
  let head8: string;

  beforeEach(() => {
    vi.clearAllMocks();
    workspacePath = mkdtempSync(join(tmpdir(), 'pan-4531-verify-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: workspacePath, encoding: 'utf-8' }).trim();
    git('init', '-q');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    head8 = git('rev-parse', '--short=8', 'HEAD');
    mockFindProject.mockReturnValue(project({ tests: 'ci' }));
  });

  afterEach(() => {
    mockGetPrFacts.mockImplementation(async () => ({ merged: false, open: true, exists: true }));
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('CI turning red during a gate stops the run before the next gate; it fails at test', async () => {
    // A post_push gate never runs in pre-push verification, so it is not "not run" either.
    mockFindProject.mockReturnValue({ ...project({ tests: 'ci' }), quality_gates: { ...PROJECT_GATES, smoke: { command: 'true', phase: 'post_push' } } });
    mockGateBody.mockImplementationOnce(() => {
      writeVerificationArtifact(workspacePath, 'PAN-3965', [{ name: 'test', passed: false, required: true, output: 'CI red', durationMs: 0 }], {
        ranAt: '2026-09-23T00:00:00.000Z', head8, via: 'ci',
      });
    });

    const outcome = await verify();

    expect(outcome).toMatchObject({ outcome: 'failed', failedCheck: 'test' });
    expect(mockGateBody.mock.calls.map(([name]) => name)).toEqual(['typecheck']);
    expect(readVerificationArtifact(workspacePath)?.notRun).toEqual(['lint']);
  });

  it('the PR merging during a gate stops the run before the next gate with the merged skip', async () => {
    mockGateBody.mockImplementationOnce(() => {
      mockGetPrFacts.mockImplementation(async () => ({ merged: true, open: false, exists: true }));
    });

    const outcome = await verify();

    expect(outcome).toMatchObject({ outcome: 'skipped' });
    expect(mockGateBody.mock.calls.map(([name]) => name)).toEqual(['typecheck']);
  });

  it('with CI passed or unknown, every gate runs as before', async () => {
    expect(await verify()).toEqual({ outcome: 'passed' });
    expect(mockGateBody.mock.calls.map(([name]) => name)).toEqual(['typecheck', 'lint']);
  });
});

describe('a red head whose verification merges the target branch in (PAN-4527)', () => {
  let root: string;

  beforeEach(() => {
    vi.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), 'pan-4527-verify-sync-'));
    const origin = join(root, 'origin.git');
    const upstream = join(root, 'upstream');
    workspacePath = join(root, 'workspace');
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf-8' }).trim();
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    execFileSync('git', ['clone', '-q', origin, upstream], { stdio: 'ignore' });
    git(upstream, 'checkout', '-q', '-b', 'main');
    git(upstream, 'commit', '-q', '--allow-empty', '-m', 'base');
    git(upstream, 'push', '-q', 'origin', 'main');
    execFileSync('git', ['clone', '-q', origin, workspacePath], { stdio: 'ignore' });
    git(workspacePath, 'config', 'user.name', 't');
    git(workspacePath, 'config', 'user.email', 't@t');
    git(workspacePath, 'checkout', '-q', '-b', 'feature/pan-3965');
    git(workspacePath, 'commit', '-q', '--allow-empty', '-m', 'work');
    // main moves on, so the verification's sync makes a local merge commit.
    git(upstream, 'commit', '-q', '--allow-empty', '-m', 'other PR');
    git(upstream, 'push', '-q', 'origin', 'main');
    mockFindProject.mockReturnValue(project({ tests: 'ci' }));
    writeVerificationArtifact(workspacePath, 'PAN-3965', [{ name: 'test', passed: false, required: true, output: 'CI red', durationMs: 0 }], {
      ranAt: '2026-09-23T00:00:00.000Z', head8: git(workspacePath, 'rev-parse', '--short=8', 'HEAD'), via: 'ci',
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('still fails test: the sync merge commit is the launch head, whose CI job is red', async () => {
    const outcome = await runVerificationForIssueInProcess(
      'PAN-3965', workspacePath, { isRemote: false }, 'test', { skipPlanChecklist: true },
    );

    expect(outcome).toMatchObject({ outcome: 'failed', failedCheck: 'test' });
    // The sync really did move HEAD to a merge commit.
    expect(execFileSync('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], { cwd: workspacePath, encoding: 'utf-8' }).trim().split(' ')).toHaveLength(3);
  });

  it('PAN-4531: an agent commit during a gate supersedes the run before the next gate', async () => {
    mockFindProject.mockReturnValue(project({ tests: 'local' }));
    mockGateBody.mockImplementationOnce(() => {
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'agent fix'], { cwd: workspacePath });
    });

    const outcome = await runVerificationForIssueInProcess(
      'PAN-3965', workspacePath, { isRemote: false }, 'test', { skipPlanChecklist: true },
    );

    expect(outcome).toMatchObject({ outcome: 'deferred', superseded: { to: execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: workspacePath, encoding: 'utf-8' }).trim() } });
    expect(mockGateBody.mock.calls.map(([name]) => name)).toEqual(['typecheck']);
    expect(readPipelineJournal(workspacePath).map((entry) => entry.type)).toEqual(['verification.started']);
  });

  it('PAN-4531: an agent commit during a gate that fails supersedes the failure', async () => {
    mockFindProject.mockReturnValue(project({ tests: 'local' }));
    mockGateBody.mockImplementationOnce(() => {
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'agent fix'], { cwd: workspacePath });
      return false;
    });

    const outcome = await runVerificationForIssueInProcess(
      'PAN-3965', workspacePath, { isRemote: false }, 'test', { skipPlanChecklist: true },
    );

    expect(outcome).toMatchObject({ outcome: 'deferred', superseded: { to: execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: workspacePath, encoding: 'utf-8' }).trim() } });
    expect(mockGateBody.mock.calls.map(([name]) => name)).toEqual(['typecheck']);
    expect(readPipelineJournal(workspacePath).map((entry) => entry.type)).toEqual(['verification.started']);
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

  it('names dagger.toml in the local reason when no workflow qualifies (PAN-4589)', () => {
    expect(resolveVerificationTestsModeDecision(base, { ...workflowsIn({}), fileExists: (p: string) => p === '/p/dagger.toml' }))
      .toEqual({ mode: 'local', reason: 'no GitHub Actions workflows; dagger.toml present; set verification.tests: ci if Dagger Cloud checks are on' });
  });

  it('leaves the reason unchanged with no dagger.toml (PAN-4589)', () => {
    expect(resolveVerificationTestsModeDecision(base, { ...workflowsIn({}), fileExists: () => false }))
      .toEqual({ mode: 'local', reason: 'no GitHub Actions workflows' });
  });

  it('stays ci with the workflow reason when a qualifying workflow exists alongside dagger.toml (PAN-4589)', () => {
    expect(resolveVerificationTestsModeDecision(
      base,
      { ...workflowsIn({ '/p/.github/workflows': at(PR_TEST_WORKFLOW) }), fileExists: (p: string) => p === '/p/dagger.toml' },
    )).toEqual({
      mode: 'ci',
      reason: '.github/workflows/ci.yml runs test job "test" on pull requests',
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

  it('counts a reusable-workflow test job, whose checks are named "test / <inner>" (review of #4017)', () => {
    expect(findPullRequestTestJob('on: pull_request\njobs:\n  test:\n    uses: ./.github/workflows/tests.yml\n')).toBe('test');
    expect(isCiTestCheckName('test / vitest')).toBe(true);
    expect(isCiTestCheckName('lint / test')).toBe(false);
  });

  it('honors pull_request branch filters against the PR base branch (review of #4017)', () => {
    const releaseOnly = 'on:\n  pull_request:\n    branches: ["release/*"]\njobs:\n  test: {}\n';
    expect(findPullRequestTestJob(releaseOnly)).toBeNull();
    expect(findPullRequestTestJob(releaseOnly, 'release/2026')).toBe('test');
    expect(findPullRequestTestJob('on:\n  pull_request:\n    branches-ignore: [main]\njobs:\n  test: {}\n')).toBeNull();
    expect(findPullRequestTestJob('on:\n  pull_request:\n    branches: [main, develop]\njobs:\n  test: {}\n')).toBe('test');
  });

  it('skips a test job whose if: cannot run on a pull request (review of #4017)', () => {
    const pushOnly = "on: [push, pull_request]\njobs:\n  test:\n    if: github.event_name == 'push'\n";
    const mainOnly = "on: pull_request\njobs:\n  test:\n    if: github.ref == 'refs/heads/main'\n";
    const prAllowed = "on: pull_request\njobs:\n  test:\n    if: github.event_name == 'pull_request' || github.event_name == 'push'\n";
    expect(findPullRequestTestJob(pushOnly)).toBeNull();
    expect(findPullRequestTestJob(mainOnly)).toBeNull();
    expect(findPullRequestTestJob(prAllowed)).toBe('test');
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

describe('isDaggerCloudTestCheck (PAN-4589)', () => {
  const daggerUrl = 'https://dagger.cloud/dagger/checks/github.com/dagger/dagger@abc?check=x';

  it('matches a Dagger Cloud check path whose segment the single-name matcher accepts', () => {
    expect(isDaggerCloudTestCheck('go-client/test', daggerUrl)).toBe(true);
    expect(isDaggerCloudTestCheck('golang/packages/tests/test', daggerUrl)).toBe(true);
    expect(isDaggerCloudTestCheck('vitest/projects/tests/test', daggerUrl)).toBe(true);
    expect(isDaggerCloudTestCheck('test-split/test-llm', daggerUrl)).toBe(true);
  });

  it('rejects a Dagger Cloud check path with no test segment', () => {
    expect(isDaggerCloudTestCheck('python-client/format', daggerUrl)).toBe(false);
    expect(isDaggerCloudTestCheck('helm/lint', daggerUrl)).toBe(false);
    expect(isDaggerCloudTestCheck('engine-lab/wcprof-report-test', daggerUrl)).toBe(false);
  });

  it('rejects a test-named check whose target URL is not Dagger Cloud', () => {
    expect(isDaggerCloudTestCheck('go-client/test', 'https://buildkite.com/o/p/builds/1')).toBe(false);
    expect(isDaggerCloudTestCheck('go-client/test', undefined)).toBe(false);
    expect(isDaggerCloudTestCheck('go-client/test', 'not a url')).toBe(false);
    expect(isDaggerCloudTestCheck('go-client/test', 'http://dagger.cloud/x')).toBe(false);
    expect(isDaggerCloudTestCheck('go-client/test', 'https://dagger.cloud.evil.example/x')).toBe(false);
  });
});

describe('isCiTestRollupCheck (PAN-4589)', () => {
  it('recognizes a check run by name and a commit status by context', () => {
    expect(isCiTestRollupCheck({ name: 'test (22)' })).toBe(true);
    expect(isCiTestRollupCheck({ name: 'lint' })).toBe(false);
    expect(isCiTestRollupCheck({ context: 'test', targetUrl: 'https://buildkite.com/x' })).toBe(true);
    expect(isCiTestRollupCheck({ context: 'go-client/test', targetUrl: 'https://buildkite.com/x' })).toBe(false);
  });
});
