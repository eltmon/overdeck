/**
 * PAN-1728: the verification runner runs the required `plan-integrity` check
 * after test-skip and before the quality gates. A failure short-circuits the
 * quality gates and emits `verification.failed { failedCheck: 'plan-integrity' }`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFindProject, mockRunQualityGates, mockTestSkip, mockPlanIntegrity } = vi.hoisted(() => ({
  mockFindProject: vi.fn(),
  mockRunQualityGates: vi.fn(),
  mockTestSkip: vi.fn(),
  mockPlanIntegrity: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  findProjectByPath: mockFindProject,
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/cloister/validation.js', () => ({
  DEFAULT_GATES: {
    typecheck: { command: 'npm run typecheck' },
    lint: { command: 'npm run lint' },
  },
  runQualityGates: async (gates: Record<string, unknown>, ...rest: unknown[]) => {
    mockRunQualityGates(gates, ...rest);
    return Object.keys(gates).map((name) => ({ name, passed: true, required: true, output: '', durationMs: 1 }));
  },
}));

vi.mock('../../../../src/lib/cloister/pr-facts.js', () => ({
  getPrFacts: vi.fn(async () => ({ merged: false, open: true, exists: true })),
}));
vi.mock('../../../../src/lib/cloister/test-skip-run.js', () => ({ evaluateTestSkipGate: mockTestSkip }));
vi.mock('../../../../src/lib/cloister/plan-integrity-run.js', () => ({ evaluatePlanIntegrityGate: mockPlanIntegrity }));
vi.mock('../../../../src/lib/cloister/verification-check-run.js', () => ({
  postVerificationCheckRun: vi.fn(async () => null),
}));
vi.mock('../../../../src/lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));
vi.mock('../../../../src/lib/cloister/feedback-target.js', () => ({
  resolveIssueFeedbackTarget: vi.fn(async () => ({ needsYou: true, reason: 'no agent in this test' })),
  surfaceIssueFeedbackNeedsYou: vi.fn(async () => undefined),
}));
vi.mock('../../../../src/lib/agents.js', () => ({
  clearAgentPaused: vi.fn(() => Effect.void),
  getAgentState: vi.fn(() => null),
  messageAgent: vi.fn(async () => ({ delivered: true, queuedToMail: false })),
  setAgentPaused: vi.fn(() => Effect.void),
  stopAgent: vi.fn(() => Effect.void),
}));
vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: vi.fn(async () => ({ success: true, filePath: '/tmp/feedback.md' })),
}));
vi.mock('../../../../src/lib/telemetry/pipeline.js', () => ({ capturePipelineStageForIssue: vi.fn() }));
vi.mock('../../../../src/lib/github-app.js', () => ({ postOverdeckTestsStatus: vi.fn(async () => undefined) }));
vi.mock('../../../../src/lib/xbrief/acceptance-criteria.js', () => ({ getXBriefACStatus: vi.fn(() => null) }));
vi.mock('../../../../src/lib/work/done-preflight.js', () => ({ checkIncompletePlanItems: vi.fn(async () => []) }));

import { runVerificationForIssueInProcess } from '../../../../src/lib/cloister/verification-runner.js';
import { readVerificationArtifact } from '../../../../src/lib/cloister/verification-artifact.js';
import { readPipelineJournal } from '../../../../src/lib/cloister/pipeline-journal.js';

let workspacePath: string;

function project() {
  return {
    name: 'Overdeck',
    path: workspacePath,
    github_repo: 'eltmon/overdeck',
    // Polyrepo skips the dependency install the runner does for a monorepo.
    workspace: { type: 'polyrepo', default_branch: 'main' },
    quality_gates: { typecheck: { command: 'npm run typecheck' }, lint: { command: 'npm run lint' } },
    verification: { tests: 'ci' as const },
  };
}

async function verify() {
  return runVerificationForIssueInProcess(
    'PAN-1728', workspacePath, { isRemote: false }, 'test', { syncTargetBranch: false, skipPlanChecklist: true },
  );
}

describe('verification runner plan-integrity check (PAN-1728)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspacePath = mkdtempSync(join(tmpdir(), 'pan-1728-verify-'));
    mockFindProject.mockReturnValue(project());
    mockTestSkip.mockResolvedValue({ failed: false, evidence: '', waiverApplied: false });
    mockPlanIntegrity.mockResolvedValue({ failed: false, evidence: 'reference: trailer abcd1234' });
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('fails as plan-integrity without running the quality gates, and journals verification.failed', async () => {
    mockPlanIntegrity.mockResolvedValue({ failed: true, evidence: 'item x.ac1: changed status' });

    const outcome = await verify();

    expect(outcome).toMatchObject({ outcome: 'failed', failedCheck: 'plan-integrity' });
    expect(mockRunQualityGates).not.toHaveBeenCalled();
    expect(mockPlanIntegrity).toHaveBeenCalledWith('PAN-1728', workspacePath, expect.any(Array));
    const journal = readPipelineJournal(workspacePath);
    expect(journal.at(-1)).toMatchObject({ type: 'verification.failed', data: { failedCheck: 'plan-integrity' } });
  });

  it('records the plan-integrity evidence on its gate row in the verification artifact', async () => {
    mockPlanIntegrity.mockResolvedValue({ failed: true, evidence: 'item x.ac1: changed status' });

    await verify();

    const artifact = readVerificationArtifact(workspacePath);
    expect(artifact?.gates).toEqual([
      expect.objectContaining({ name: 'plan-integrity', passed: false, required: true, output: 'item x.ac1: changed status' }),
    ]);
  });

  it('runs the quality gates and passes when plan-integrity passes', async () => {
    const outcome = await verify();

    expect(outcome).toEqual({ outcome: 'passed' });
    expect(mockRunQualityGates).toHaveBeenCalledTimes(1);
    expect(readVerificationArtifact(workspacePath)?.gates.map((gate) => gate.name)).toEqual(['typecheck', 'lint']);
  });

  it('does not evaluate plan-integrity when the test-skip gate fails', async () => {
    mockTestSkip.mockResolvedValue({ failed: true, evidence: 'src/a.test.ts: [skip] it.skip(', waiverApplied: false });

    const outcome = await verify();

    expect(outcome).toMatchObject({ outcome: 'failed', failedCheck: 'test-skip' });
    expect(mockPlanIntegrity).not.toHaveBeenCalled();
    expect(mockRunQualityGates).not.toHaveBeenCalled();
  });
});
