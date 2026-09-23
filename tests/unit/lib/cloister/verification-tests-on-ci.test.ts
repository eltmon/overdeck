/**
 * PAN-3965: one full-suite run per push, on CI.
 *
 * A CI-configured project's verification gate runs no test gate on the host —
 * asserted through the verification artifact's gate list — while
 * `verification.tests: local` keeps the local test run.
 */
import { mkdtempSync, rmSync } from 'node:fs';
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
vi.mock('../../../../src/lib/agents.js', () => ({
  clearAgentPaused: vi.fn(() => Effect.void),
  getAgentStateSync: vi.fn(() => null),
  messageAgent: vi.fn(async () => ({ delivered: true, queuedToMail: false })),
  setAgentPaused: vi.fn(() => Effect.void),
  stopAgent: vi.fn(() => Effect.void),
}));
vi.mock('../../../../src/lib/telemetry/pipeline.js', () => ({ capturePipelineStageForIssue: vi.fn() }));
vi.mock('../../../../src/lib/github-app.js', () => ({ postOverdeckTestsStatus: vi.fn(async () => undefined) }));
vi.mock('../../../../src/lib/xbrief/acceptance-criteria.js', () => ({ getXBriefACStatusSync: vi.fn(() => null) }));
vi.mock('../../../../src/lib/work/done-preflight.js', () => ({ checkIncompletePlanItemsPromise: vi.fn(async () => []) }));

import { runVerificationForIssueInProcess } from '../../../../src/lib/cloister/verification-runner.js';
import { readVerificationArtifact } from '../../../../src/lib/cloister/verification-artifact.js';
import { readPipelineJournal } from '../../../../src/lib/cloister/pipeline-journal.js';
import {
  isCiTestCheckName,
  resolveVerificationTestsMode,
  selectLocalVerificationGates,
} from '../../../../src/lib/cloister/verification-tests-mode.js';

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
    expect(readPipelineJournal(workspacePath).map((entry) => entry.type)).toEqual(['verification.started', 'verification.passed']);
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

describe('resolveVerificationTestsMode', () => {
  const base = { path: '/p', github_repo: 'o/r' };

  it('defaults to ci when the GitHub repo has Actions workflows', () => {
    expect(resolveVerificationTestsMode(base, { hasWorkflowFiles: (dir) => dir === '/p/.github/workflows' })).toBe('ci');
  });

  it('finds workflows in a polyrepo member repo', () => {
    const polyrepo = { ...base, workspace: { repos: [{ name: 'fe', path: 'fe' }] } } as Parameters<typeof resolveVerificationTestsMode>[0];
    expect(resolveVerificationTestsMode(polyrepo, { hasWorkflowFiles: (dir) => dir === '/p/fe/.github/workflows' })).toBe('ci');
  });

  it('defaults to local with no workflows or no GitHub repo', () => {
    expect(resolveVerificationTestsMode(base, { hasWorkflowFiles: () => false })).toBe('local');
    expect(resolveVerificationTestsMode({ path: '/p' }, { hasWorkflowFiles: () => true })).toBe('local');
    expect(resolveVerificationTestsMode(null)).toBe('local');
  });

  it('an explicit key wins over detection', () => {
    expect(resolveVerificationTestsMode({ ...base, verification: { tests: 'local' } }, { hasWorkflowFiles: () => true })).toBe('local');
    expect(resolveVerificationTestsMode({ path: '/p', verification: { tests: 'ci' } }, { hasWorkflowFiles: () => false })).toBe('ci');
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
    expect(isCiTestCheckName('Clean install + server smoke test')).toBe(false);
    expect(isCiTestCheckName('lint')).toBe(false);
    expect(isCiTestCheckName('testing-tools')).toBe(false);
    expect(isCiTestCheckName(undefined)).toBe(false);
  });
});
