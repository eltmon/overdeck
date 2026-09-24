/**
 * Tests for ci-failure-feedback.ts (PAN-1801)
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  recordCiTestGatePass,
  relayCiFailureFeedback,
  resetCiFailureFeedbackStateForTests,
} from '../../../../src/lib/cloister/ci-failure-feedback.js';
import { readPipelineJournal } from '../../../../src/lib/cloister/pipeline-journal.js';
import {
  verificationArtifactPath,
  writeVerificationArtifact,
  type VerificationArtifact,
} from '../../../../src/lib/cloister/verification-artifact.js';
import type { PrFacts } from '../../../../src/lib/cloister/pr-facts.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const mockGetAgentStateSync = vi.fn();
const mockMessageAgent = vi.fn();

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentState: (...args: Parameters<typeof mockGetAgentStateSync>) => mockGetAgentStateSync(...args),
  messageAgent: (...args: Parameters<typeof mockMessageAgent>) => mockMessageAgent(...args),
}));

const mockResolveProjectFromIssueSync = vi.fn();
const mockFindProjectByPathSync = vi.fn();

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: (...args: Parameters<typeof mockResolveProjectFromIssueSync>) => mockResolveProjectFromIssueSync(...args),
  findProjectByPath: (...args: Parameters<typeof mockFindProjectByPathSync>) => mockFindProjectByPathSync(...args),
}));

const mockWriteFeedbackFile = vi.fn();
const mockEscalate = vi.fn(async () => undefined);
/** Resolves the door's delivery outcome: true = the agent accepted the message. */
const mockDeliverVerificationFeedback = vi.fn(async (): Promise<boolean> => true);
const mockLiftStuckPause = vi.fn(async (): Promise<boolean> => false);

// PAN-3965: the attempt rule (verification-cycles) is the real one; only the
// side effects — pause, delivery, activity announcement — are observed.
vi.mock('../../../../src/lib/cloister/verification-escalation.js', () => ({
  announceVerificationFailure: vi.fn(),
  escalateVerificationStuck: (...args: unknown[]) => mockEscalate(...(args as [])),
  deliverVerificationFeedback: (...args: unknown[]) => mockDeliverVerificationFeedback(...(args as [])),
  liftVerificationStuckPause: (...args: unknown[]) => mockLiftStuckPause(...(args as [])),
}));

vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: (...args: Parameters<typeof mockWriteFeedbackFile>) => mockWriteFeedbackFile(...args),
}));

function makeExecFileMock(
  responses: Array<{
    cmd: string;
    args: string[];
    stdout: string;
    stderr?: string;
    error?: Error;
  }>,
) {
  return vi.fn((file: string, args: string[], _opts: unknown, callback: (err: Error | null, stdout?: string, stderr?: string) => void) => {
    const joined = args.join(' ');
    const match = responses.find((r) => file === r.cmd && joined.includes(r.args.join(' ')));
    if (match) {
      if (match.error) {
        callback(match.error, '', match.stderr ?? '');
      } else {
        callback(null, match.stdout, match.stderr ?? '');
      }
    } else {
      callback(new Error(`Unexpected execFile call: ${file} ${joined}`), '', '');
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCiFailureFeedbackStateForTests();
  mockGetAgentStateSync.mockReturnValue({
    id: 'agent-pan-1801',
    issueId: 'PAN-1801',
    role: 'work',
    status: 'running',
    workspace: '/tmp/overdeck/workspaces/feature-pan-1801',
    model: 'claude-sonnet-4-6',
    startedAt: new Date().toISOString(),
  });
  mockResolveProjectFromIssueSync.mockReturnValue({
    projectPath: '/tmp/overdeck',
  });
  mockWriteFeedbackFile.mockResolvedValue({
    success: true,
    filePath: '/tmp/overdeck/workspaces/feature-pan-1801/.pan/feedback/001-ci-monitor-failed.md',
    relativePath: '.pan/feedback/001-ci-monitor-failed.md',
  });
  mockMessageAgent.mockResolvedValue({ delivered: true, queuedToMail: false });
  // No project config → the local test gate; the CI test-gate path stays off.
  mockFindProjectByPathSync.mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** `gh run list` reports a failing test run on `headSha` for the feature branch. */
function makeGhMocksForHead(headSha: string) {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(makeExecFileMock([
    {
      cmd: 'gh',
      args: ['run', 'list', '--repo', 'test-owner/test-repo', '--branch', 'main', '--status', 'failure'],
      stdout: '[]',
    },
    {
      cmd: 'gh',
      args: ['run', 'list', '--repo', 'test-owner/test-repo', '--branch', 'feature/pan-1801', '--status', 'failure'],
      stdout: JSON.stringify([{ databaseId: 30, name: 'test', workflowName: 'CI', headSha, conclusion: 'failure' }]),
    },
    { cmd: 'gh', args: ['run', 'view', '30'], stdout: 'FAIL src/x.test.ts' },
  ]));
}

function makeGhMocks(logExcerpt = 'FAIL: assertion failed') {
  const execFileMock = makeExecFileMock([
    {
      cmd: 'gh',
      args: ['run', 'list', '--repo', 'test-owner/test-repo', '--branch', 'main', '--status', 'failure'],
      stdout: JSON.stringify([
        { databaseId: 10, name: 'main-lint', workflowName: 'CI', headSha: 'main-sha', conclusion: 'failure' },
      ]),
    },
    {
      cmd: 'gh',
      args: ['run', 'list', '--repo', 'test-owner/test-repo', '--branch', 'feature/pan-1801', '--status', 'failure'],
      stdout: JSON.stringify([
        { databaseId: 20, name: 'pr-test', workflowName: 'CI', headSha: 'abc123def456', conclusion: 'failure' },
        { databaseId: 21, name: 'main-lint', workflowName: 'CI', headSha: 'abc123def456', conclusion: 'failure' },
      ]),
    },
    {
      cmd: 'gh',
      args: ['run', 'view', '20'],
      stdout: logExcerpt,
    },
    {
      cmd: 'gh',
      args: ['run', 'view', '21'],
      stdout: 'lint error on main',
    },
  ]);
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(execFileMock);
}

describe('relayCiFailureFeedback', () => {
  it('writes feedback and messages the work agent', async () => {
    makeGhMocks();

    const result = await relayCiFailureFeedback({
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      prUrl: 'https://github.com/test-owner/test-repo/pull/42',
      source: 'check_run:test',
    });

    expect(result.agentMessageSent).toBe(true);
    expect(result.feedbackPath).toBe('/tmp/overdeck/workspaces/feature-pan-1801/.pan/feedback/001-ci-monitor-failed.md');
    expect(mockMessageAgent).toHaveBeenCalledWith(
      'agent-pan-1801',
      expect.stringContaining('SPECIALIST FEEDBACK: ci-monitor reported CI FAILED for PAN-1801'),
      'internal',
      {},
    );
    expect(mockWriteFeedbackFile).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-1801',
      specialist: 'ci-monitor',
      outcome: 'failed',
    }));
  });

  it('labels failures inherited from main', async () => {
    makeGhMocks();

    await relayCiFailureFeedback({
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      prUrl: 'https://github.com/test-owner/test-repo/pull/42',
      source: 'check_run:test',
    });

    const markdownBody = mockWriteFeedbackFile.mock.calls[0][0].markdownBody as string;
    expect(markdownBody).toContain('### pr-test');
    expect(markdownBody).toContain('### main-lint [INHERITED FROM MAIN — also failing on main]');
  });

  it('debounces duplicate feedback for the same head SHA', async () => {
    makeGhMocks();

    const opts = {
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      prUrl: 'https://github.com/test-owner/test-repo/pull/42',
      source: 'check_run:test',
    };

    await relayCiFailureFeedback(opts);
    await relayCiFailureFeedback(opts);

    expect(execFile).toHaveBeenCalledTimes(4); // 2 list + 2 view (only once because debounced)
    expect(mockMessageAgent).toHaveBeenCalledTimes(1);
  });

  it('skips feedback when no work agent exists', async () => {
    mockGetAgentStateSync.mockReturnValue(null);

    const result = await relayCiFailureFeedback({
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      source: 'check_run:test',
    });

    expect(result.agentMessageSent).toBe(false);
    expect(execFile).not.toHaveBeenCalled();
    expect(mockWriteFeedbackFile).not.toHaveBeenCalled();
  });

  it('skips feedback for non-work agent roles', async () => {
    mockGetAgentStateSync.mockReturnValue({
      id: 'agent-pan-1801',
      issueId: 'PAN-1801',
      role: 'review',
      status: 'running',
      workspace: '/tmp',
      model: 'claude-sonnet-4-6',
      startedAt: new Date().toISOString(),
    });

    const result = await relayCiFailureFeedback({
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      source: 'check_run:test',
    });

    expect(result.agentMessageSent).toBe(false);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('still messages the agent when gh log fetch fails', async () => {
    const execFileMock = makeExecFileMock([
      {
        cmd: 'gh',
        args: ['run', 'list', '--repo', 'test-owner/test-repo', '--branch', 'main', '--status', 'failure'],
        stdout: JSON.stringify([]),
      },
      {
        cmd: 'gh',
        args: ['run', 'list', '--repo', 'test-owner/test-repo', '--branch', 'feature/pan-1801', '--status', 'failure'],
        stdout: JSON.stringify([
          { databaseId: 20, name: 'pr-test', workflowName: 'CI', headSha: 'abc123def456', conclusion: 'failure' },
        ]),
      },
      {
        cmd: 'gh',
        args: ['run', 'view', '20'],
        stdout: '',
        error: new Error('network error'),
      },
    ]);
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(execFileMock);

    const result = await relayCiFailureFeedback({
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      source: 'check_run:test',
    });

    expect(result.agentMessageSent).toBe(true);
    const markdownBody = mockWriteFeedbackFile.mock.calls[0][0].markdownBody as string;
    expect(markdownBody).toContain('*(No log excerpt available.)*');
  });

  it('includes a status source even when no failing run is found', async () => {
    const execFileMock = makeExecFileMock([
      {
        cmd: 'gh',
        args: ['run', 'list', '--repo', 'test-owner/test-repo', '--branch', 'main', '--status', 'failure'],
        stdout: JSON.stringify([]),
      },
      {
        cmd: 'gh',
        args: ['run', 'list', '--repo', 'test-owner/test-repo', '--branch', 'feature/pan-1801', '--status', 'failure'],
        stdout: JSON.stringify([]),
      },
    ]);
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(execFileMock);

    const result = await relayCiFailureFeedback({
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      source: 'status:ci',
    });

    expect(result.agentMessageSent).toBe(true);
    const markdownBody = mockWriteFeedbackFile.mock.calls[0][0].markdownBody as string;
    expect(markdownBody).toContain('no failing workflow runs were found');
  });

  it('includes a polling source even when no failing run is found', async () => {
    const execFileMock = makeExecFileMock([
      {
        cmd: 'gh',
        args: ['run', 'list', '--repo', 'test-owner/test-repo', '--branch', 'main', '--status', 'failure'],
        stdout: JSON.stringify([]),
      },
      {
        cmd: 'gh',
        args: ['run', 'list', '--repo', 'test-owner/test-repo', '--branch', 'feature/pan-1801', '--status', 'failure'],
        stdout: JSON.stringify([]),
      },
    ]);
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(execFileMock);

    const result = await relayCiFailureFeedback({
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      source: 'polling_reconciliation',
    });

    expect(result.agentMessageSent).toBe(true);
    const markdownBody = mockWriteFeedbackFile.mock.calls[0][0].markdownBody as string;
    expect(markdownBody).toContain('no failing workflow runs were found');
  });

  it('skips non-status sources when no failing run is found', async () => {
    const execFileMock = makeExecFileMock([
      {
        cmd: 'gh',
        args: ['run', 'list', '--repo', 'test-owner/test-repo', '--branch', 'main', '--status', 'failure'],
        stdout: JSON.stringify([]),
      },
      {
        cmd: 'gh',
        args: ['run', 'list', '--repo', 'test-owner/test-repo', '--branch', 'feature/pan-1801', '--status', 'failure'],
        stdout: JSON.stringify([]),
      },
    ]);
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(execFileMock);

    const result = await relayCiFailureFeedback({
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      source: 'check_run:test',
    });

    expect(result.agentMessageSent).toBe(false);
    expect(mockWriteFeedbackFile).not.toHaveBeenCalled();
  });
});

describe('PAN-3965: the CI test job is the verification test gate', () => {
  let projectPath: string;
  let workspacePath: string;
  let clock = Date.parse('2026-09-23T00:00:00.000Z');

  const relayOpts = {
    issueId: 'PAN-1801',
    repo: 'test-owner/test-repo',
    prNumber: 42,
    headSha: 'abc123def456',
    headRef: 'feature/pan-1801',
    prUrl: 'https://github.com/test-owner/test-repo/pull/42',
    source: 'check_run:test',
  };

  function facts(overrides: Partial<PrFacts>): PrFacts {
    return {
      issueId: 'PAN-1801', forge: 'github', url: relayOpts.prUrl, number: 42,
      exists: true, open: true, merged: false, closed: false, draft: false,
      headSha: 'abc123def456', headBranch: 'feature/pan-1801',
      reviewDecision: null, approved: false, changesRequested: false,
      mergeable: true, mergeableState: 'mergeable', checks: 'green', testChecks: 'green',
      ...overrides,
    };
  }

  /** A red test job on `headSha`: the PR reader and `gh run list` both report it. */
  async function redHead(headSha: string) {
    tick();
    makeGhMocksForHead(headSha);
    const readPrFacts = vi.fn(async () => facts({ headSha, checks: 'red', testChecks: 'red' }));
    return relayCiFailureFeedback({ ...relayOpts, headSha }, { readPrFacts });
  }

  async function greenHead(headSha: string) {
    tick();
    const readPrFacts = vi.fn(async () => facts({ headSha, checks: 'green', testChecks: 'green' }));
    return recordCiTestGatePass({ issueId: 'PAN-1801', headSha, headRef: 'feature/pan-1801', source: 'check_run:test' }, { readPrFacts });
  }

  /** Per-run artifacts are named and ordered by timestamp; advance it between events. */
  function tick() {
    clock += 60_000;
    vi.setSystemTime(clock);
  }

  function failedEntries() {
    return readPipelineJournal(workspacePath).filter((entry) => entry.type === 'verification.failed');
  }

  /** The immutable per-run verification artifacts, oldest first. */
  function runArtifacts(): VerificationArtifact[] {
    const dir = join(workspacePath, '.overdeck', 'verification');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).sort().map((name) => JSON.parse(readFileSync(join(dir, name), 'utf-8')) as VerificationArtifact);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    projectPath = mkdtempSync(join(tmpdir(), 'pan-3965-ci-'));
    workspacePath = join(projectPath, 'workspaces', 'feature-pan-1801');
    mkdirSync(workspacePath, { recursive: true });
    mockResolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck', projectName: 'Overdeck', projectPath });
    mockFindProjectByPathSync.mockReturnValue({ name: 'Overdeck', path: projectPath, verification: { tests: 'ci' } });
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('records the failure, journals verification.failed { failedCheck: test, cycleCount }, and delivers it as verification feedback', async () => {
    const result = await redHead('abc123def456');

    expect(result).toMatchObject({ testGateFailed: true, agentMessageSent: true, cycleCount: 1, escalated: false });
    expect(failedEntries()).toHaveLength(1);
    expect(failedEntries()[0]).toMatchObject({
      issueId: 'PAN-1801',
      source: 'ci:check_run:test',
      data: { failedCheck: 'test', cycleCount: 1, head: 'abc123de', via: 'ci', prNumber: 42 },
    });
    expect(mockEscalate).not.toHaveBeenCalled();
    expect(mockDeliverVerificationFeedback).toHaveBeenCalledWith(
      'PAN-1801',
      expect.stringContaining('Failed check: test'),
      expect.objectContaining({ failedCheck: 'test', via: 'ci' }),
      'ci-failure-feedback',
    );
    expect(mockMessageAgent).not.toHaveBeenCalled();
    expect(mockWriteFeedbackFile).toHaveBeenCalledWith(expect.objectContaining({
      markdownBody: expect.stringContaining('the CI test job is the verification test gate'),
    }));
    // The failure is a per-run verification artifact, counted like a local gate run.
    expect(runArtifacts()).toEqual([
      expect.objectContaining({ outcome: 'failed', failedCheck: 'test', via: 'ci', head8: 'abc123de' }),
    ]);
    // Review of #3993 (L1): verification-latest.json stays the local gate run's record,
    // as it does for a CI pass.
    expect(existsSync(verificationArtifactPath(workspacePath))).toBe(false);
  });

  it('keeps verification-latest.json as the local gate wrote it through a red then green CI head (review of #3993)', async () => {
    tick();
    writeVerificationArtifact(workspacePath, 'PAN-1801', [
      { name: 'typecheck', passed: true, required: true, output: '', durationMs: 1 },
      { name: 'lint', passed: true, required: true, output: '', durationMs: 1 },
    ], { ranAt: new Date().toISOString(), head8: 'abc123de' });

    await redHead('abc123def456');
    await greenHead('bbbbbbbb2222');

    const latest = JSON.parse(readFileSync(verificationArtifactPath(workspacePath), 'utf-8')) as VerificationArtifact;
    expect(latest).toMatchObject({ outcome: 'passed', gates: [{ name: 'typecheck' }, { name: 'lint' }] });
    expect(latest.via).toBeUndefined();
  });

  it('three consecutive red heads pause the agent exactly as the local gate does at the budget', async () => {
    const first = await redHead('aaaaaaaa1111');
    const second = await redHead('bbbbbbbb2222');
    expect(first).toMatchObject({ cycleCount: 1, escalated: false });
    expect(second).toMatchObject({ cycleCount: 2, escalated: false });
    expect(mockEscalate).not.toHaveBeenCalled();

    const third = await redHead('cccccccc3333');

    expect(third).toMatchObject({ cycleCount: 3, escalated: true });
    expect(mockEscalate).toHaveBeenCalledTimes(1);
    expect(mockEscalate).toHaveBeenCalledWith('PAN-1801', 'test', 3, expect.any(String), 'ci-failure-feedback');
    expect(mockDeliverVerificationFeedback).toHaveBeenLastCalledWith(
      'PAN-1801',
      expect.stringContaining('VERIFICATION STUCK for PAN-1801'),
      expect.objectContaining({ failedCheck: 'test' }),
      'ci-failure-feedback',
    );
    expect(failedEntries().map((entry) => entry.data?.cycleCount)).toEqual([1, 2, 3]);
  });

  it('a green CI test job on a head resets the count', async () => {
    await redHead('aaaaaaaa1111');
    await redHead('bbbbbbbb2222');
    expect(await greenHead('cccccccc3333')).toBe(true);

    const next = await redHead('dddddddd4444');

    expect(next).toMatchObject({ cycleCount: 1, escalated: false });
    expect(mockEscalate).not.toHaveBeenCalled();
  });

  it('a green CI test job lifts the stuck pause, as a local gate pass does (#4019 review)', async () => {
    await redHead('aaaaaaaa1111');
    await redHead('bbbbbbbb2222');
    await redHead('cccccccc3333');
    expect(mockEscalate).toHaveBeenCalledTimes(1);
    expect(mockLiftStuckPause).not.toHaveBeenCalled();

    expect(await greenHead('dddddddd4444')).toBe(true);

    expect(mockLiftStuckPause).toHaveBeenCalledTimes(1);
    expect(mockLiftStuckPause).toHaveBeenCalledWith('PAN-1801', 'ci-failure-feedback');
  });

  it('a green report that the PR checks do not confirm records nothing', async () => {
    tick();
    const readPrFacts = vi.fn(async () => facts({ headSha: 'cccccccc3333', testChecks: 'pending' }));
    const recorded = await recordCiTestGatePass(
      { issueId: 'PAN-1801', headSha: 'cccccccc3333', headRef: 'feature/pan-1801', source: 'check_run:test (22)' },
      { readPrFacts },
    );
    expect(recorded).toBe(false);
    expect(mockLiftStuckPause).not.toHaveBeenCalled();
  });

  it('local gate failures at the same head count toward the same budget', async () => {
    const head8 = 'abc123de';
    tick();
    writeVerificationArtifact(workspacePath, 'PAN-1801', [{ name: 'lint', passed: false, required: true, output: 'x', durationMs: 1 }], { ranAt: new Date().toISOString(), head8 });
    tick();
    writeVerificationArtifact(workspacePath, 'PAN-1801', [{ name: 'lint', passed: false, required: true, output: 'x', durationMs: 1 }], { ranAt: new Date().toISOString(), head8 });

    const result = await redHead('abc123def456');

    expect(result).toMatchObject({ cycleCount: 3, escalated: true });
    expect(mockEscalate).toHaveBeenCalledWith('PAN-1801', 'test', 3, expect.any(String), 'ci-failure-feedback');
  });

  it('counts and delivers a head once however many webhooks report its red test job', async () => {
    await redHead('abc123def456');
    const again = await relayCiFailureFeedback(
      { ...relayOpts, source: 'check_suite' },
      { readPrFacts: vi.fn(async () => facts({ checks: 'red', testChecks: 'red' })) },
    );
    // A restart loses the in-memory memo; the per-run artifact still says this head was counted.
    resetCiFailureFeedbackStateForTests();
    const afterRestart = await redHead('abc123def456');

    expect(again).toMatchObject({ testGateFailed: true, agentMessageSent: false });
    expect(again.cycleCount).toBeUndefined();
    expect(afterRestart).toMatchObject({ testGateFailed: true, agentMessageSent: false });
    expect(afterRestart.cycleCount).toBeUndefined();
    expect(failedEntries()).toHaveLength(1);
    // Review of #3993 (L3): the record is the idempotency key; a replay delivers nothing.
    expect(mockDeliverVerificationFeedback).toHaveBeenCalledTimes(1);
  });

  it('a replay after a restart of the head that exhausted the budget neither re-delivers nor re-escalates (review of #3993)', async () => {
    await redHead('aaaaaaaa1111');
    await redHead('bbbbbbbb2222');
    const third = await redHead('cccccccc3333');
    expect(third).toMatchObject({ cycleCount: 3, escalated: true });
    expect(mockEscalate).toHaveBeenCalledTimes(1);
    expect(mockDeliverVerificationFeedback).toHaveBeenCalledTimes(3);

    resetCiFailureFeedbackStateForTests();
    const replay = await redHead('cccccccc3333');

    expect(replay).toMatchObject({ testGateFailed: true, agentMessageSent: false });
    expect(mockEscalate).toHaveBeenCalledTimes(1);
    // No fourth delivery: an owes-rework message would lift the stuck pause.
    expect(mockDeliverVerificationFeedback).toHaveBeenCalledTimes(3);
    expect(failedEntries()).toHaveLength(3);
  });

  it('concurrent webhooks for one red head count it once and do not escalate (review of #3993, H1)', async () => {
    tick();
    makeGhMocksForHead('abc123def456');
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const readPrFacts = vi.fn(async () => {
      await gate;
      return facts({ checks: 'red', testChecks: 'red' });
    });

    const a = relayCiFailureFeedback({ ...relayOpts, source: 'check_run:test-shard (1/4)' }, { readPrFacts });
    const b = relayCiFailureFeedback({ ...relayOpts, source: 'check_run:test-shard (2/4)' }, { readPrFacts });
    const c = relayCiFailureFeedback({ ...relayOpts, source: 'check_suite' }, { readPrFacts });
    release();
    const [ra, rb, rc] = await Promise.all([a, b, c]);

    expect(ra).toMatchObject({ testGateFailed: true, cycleCount: 1, escalated: false, agentMessageSent: true });
    expect(rb.cycleCount).toBeUndefined();
    expect(rc.cycleCount).toBeUndefined();
    // The later relays waited for the first and saw its record: no second PR read.
    expect(readPrFacts).toHaveBeenCalledTimes(1);
    expect(failedEntries()).toHaveLength(1);
    expect(failedEntries()[0]?.data).toMatchObject({ cycleCount: 1 });
    expect(runArtifacts()).toHaveLength(1);
    expect(mockEscalate).not.toHaveBeenCalled();
    expect(mockDeliverVerificationFeedback).toHaveBeenCalledTimes(1);
  });

  it('reports agentMessageSent false when the feedback door did not deliver (review of #3993, L2)', async () => {
    mockDeliverVerificationFeedback.mockResolvedValueOnce(false);

    const result = await redHead('abc123def456');

    expect(result).toMatchObject({ testGateFailed: true, cycleCount: 1, agentMessageSent: false });
  });

  it.each(['strike/pan-1801', 'bypass/pan-1801'])(
    'does not count or route a red test job on %s to the work agent (review of #3993, M1)',
    async (headRef) => {
      (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(makeExecFileMock([
        { cmd: 'gh', args: ['run', 'list', '--repo', 'test-owner/test-repo', '--branch', 'main', '--status', 'failure'], stdout: '[]' },
        {
          cmd: 'gh',
          args: ['run', 'list', '--repo', 'test-owner/test-repo', '--branch', headRef, '--status', 'failure'],
          stdout: JSON.stringify([{ databaseId: 40, name: 'test', workflowName: 'CI', headSha: 'abc123def456', conclusion: 'failure' }]),
        },
        { cmd: 'gh', args: ['run', 'view', '40'], stdout: 'FAIL src/x.test.ts' },
      ]));
      const readPrFacts = vi.fn(async () => facts({ headBranch: headRef, checks: 'red', testChecks: 'red' }));

      const result = await relayCiFailureFeedback({ ...relayOpts, headRef }, { readPrFacts });
      const passRecorded = await recordCiTestGatePass(
        { issueId: 'PAN-1801', headSha: 'abc123def456', headRef, source: 'check_run:test' },
        { readPrFacts: vi.fn(async () => facts({ headBranch: headRef, testChecks: 'green' })) },
      );

      expect(result.testGateFailed).toBeUndefined();
      expect(result.cycleCount).toBeUndefined();
      expect(readPrFacts).not.toHaveBeenCalled();
      expect(readPipelineJournal(workspacePath)).toEqual([]);
      expect(runArtifacts()).toEqual([]);
      expect(mockDeliverVerificationFeedback).not.toHaveBeenCalled();
      expect(mockEscalate).not.toHaveBeenCalled();
      expect(passRecorded).toBe(false);
      // Pre-#3993 behaviour: the plain CI FAILED message, only to a live work agent.
      expect(mockMessageAgent).toHaveBeenCalledWith('agent-pan-1801', expect.stringContaining('SPECIALIST FEEDBACK'), 'internal', {});
    },
  );

  it.each(['CANCELLED', 'TIMED_OUT', 'STARTUP_FAILURE'])(
    'does not count a test job whose failing checks all ended %s (review of #3993, M3)',
    async (conclusion) => {
      makeGhMocks();
      const readPrFacts = vi.fn(async () => facts({
        checks: 'red',
        testChecks: 'red',
        testCheckFailures: [{ name: 'test-shard (1/4)', conclusion }, { name: 'test-shard (2/4)', conclusion }],
      }));
      const readDefaultBranchFailingTestChecks = vi.fn(async () => new Set<string>());

      const result = await relayCiFailureFeedback(relayOpts, { readPrFacts, readDefaultBranchFailingTestChecks });

      expect(result.testGateFailed).toBeUndefined();
      expect(failedEntries()).toEqual([]);
      expect(runArtifacts()).toEqual([]);
      expect(mockEscalate).not.toHaveBeenCalled();
      expect(mockDeliverVerificationFeedback).not.toHaveBeenCalled();
      expect(readDefaultBranchFailingTestChecks).not.toHaveBeenCalled();
    },
  );

  it('does not count a test failure that is also failing on the default branch (review of #3993, M3)', async () => {
    makeGhMocks();
    const readPrFacts = vi.fn(async () => facts({
      checks: 'red',
      testChecks: 'red',
      testCheckFailures: [{ name: 'test-shard (1/4)', conclusion: 'FAILURE' }, { name: 'test-shard (3/4)', conclusion: 'CANCELLED' }],
    }));
    const readDefaultBranchFailingTestChecks = vi.fn(async () => new Set(['test-shard (1/4)']));

    const result = await relayCiFailureFeedback(relayOpts, { readPrFacts, readDefaultBranchFailingTestChecks });

    expect(readDefaultBranchFailingTestChecks).toHaveBeenCalledWith('test-owner/test-repo');
    expect(result.testGateFailed).toBeUndefined();
    expect(failedEntries()).toEqual([]);
    expect(mockEscalate).not.toHaveBeenCalled();
    expect(mockDeliverVerificationFeedback).not.toHaveBeenCalled();
    // The agent still hears about the red CI run, as before #3993.
    expect(mockMessageAgent).toHaveBeenCalledWith('agent-pan-1801', expect.stringContaining('SPECIALIST FEEDBACK'), 'internal', {});
  });

  it('does not count while the default branch\'s test verdict is unknown (review of #4017)', async () => {
    makeGhMocks();
    const readPrFacts = vi.fn(async () => facts({
      checks: 'red',
      testChecks: 'red',
      testCheckFailures: [{ name: 'test-shard (1/4)', conclusion: 'FAILURE' }],
    }));
    const readDefaultBranchFailingTestChecks = vi.fn(async () => null);

    const result = await relayCiFailureFeedback(relayOpts, { readPrFacts, readDefaultBranchFailingTestChecks });

    expect(result.testGateFailed).toBeUndefined();
    expect(failedEntries()).toEqual([]);
    expect(runArtifacts()).toEqual([]);
    expect(mockEscalate).not.toHaveBeenCalled();
    // The failure is still reported, as a plain CI FAILED message.
    expect(mockMessageAgent).toHaveBeenCalledWith('agent-pan-1801', expect.stringContaining('SPECIALIST FEEDBACK'), 'internal', {});
  });

  it('reads main\'s newest finished test run, not a HEAD still in progress (review of #4017)', async () => {
    // HEAD's shards are still running; the commit before it finished with shard 1 red.
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(makeExecFileMock([
      { cmd: 'gh', args: ['api', 'repos/test-owner/test-repo/commits?per_page=10'], stdout: JSON.stringify(['main-head', 'main-prev']) },
      {
        cmd: 'gh',
        args: ['api', 'repos/test-owner/test-repo/commits/main-head/check-runs'],
        stdout: JSON.stringify([
          { name: 'test-shard (1/4)', status: 'in_progress', conclusion: null },
          { name: 'lint', status: 'completed', conclusion: 'success' },
        ]),
      },
      {
        cmd: 'gh',
        args: ['api', 'repos/test-owner/test-repo/commits/main-prev/check-runs'],
        stdout: JSON.stringify([
          { name: 'test-shard (1/4)', status: 'completed', conclusion: 'failure' },
          { name: 'test-shard (2/4)', status: 'completed', conclusion: 'success' },
        ]),
      },
      { cmd: 'gh', args: ['run', 'list', '--repo', 'test-owner/test-repo', '--branch', 'main'], stdout: '[]' },
      { cmd: 'gh', args: ['run', 'list', '--repo', 'test-owner/test-repo', '--branch', 'feature/pan-1801'], stdout: '[]' },
    ]));
    const readPrFacts = vi.fn(async () => facts({
      checks: 'red',
      testChecks: 'red',
      testCheckFailures: [{ name: 'test-shard (1/4)', conclusion: 'FAILURE' }],
    }));

    const result = await relayCiFailureFeedback(relayOpts, { readPrFacts });

    expect(result.testGateFailed).toBeUndefined();
    expect(failedEntries()).toEqual([]);
    expect(mockEscalate).not.toHaveBeenCalled();
  });

  it('a feedback-file write failure records nothing, surfaces needs-you, and the next report retries (review of #4017)', async () => {
    const surfaceNeedsYou = vi.fn(async () => undefined);
    mockWriteFeedbackFile.mockResolvedValueOnce({ success: false, error: 'EACCES' });
    tick();
    makeGhMocksForHead('abc123def456');
    const readPrFacts = vi.fn(async () => facts({ checks: 'red', testChecks: 'red' }));

    const failed = await relayCiFailureFeedback(relayOpts, { readPrFacts, surfaceNeedsYou });

    expect(failed).toEqual({ agentMessageSent: false });
    expect(surfaceNeedsYou).toHaveBeenCalledWith('PAN-1801', expect.stringContaining('could not write the feedback file (EACCES)'), expect.objectContaining({ failedCheck: 'test' }));
    expect(failedEntries()).toEqual([]);
    expect(runArtifacts()).toEqual([]);
    expect(mockDeliverVerificationFeedback).not.toHaveBeenCalled();

    // A restart in between changes nothing: there is no record to replay.
    resetCiFailureFeedbackStateForTests();
    const retried = await relayCiFailureFeedback({ ...relayOpts, source: 'check_suite' }, { readPrFacts, surfaceNeedsYou });

    expect(retried).toMatchObject({ testGateFailed: true, cycleCount: 1, agentMessageSent: true });
    expect(failedEntries()).toHaveLength(1);
    expect(runArtifacts()).toHaveLength(1);
    expect(mockDeliverVerificationFeedback).toHaveBeenCalledTimes(1);
  });

  it('surfaces needs-you when the feedback door throws after the head was recorded (review of #4017)', async () => {
    const surfaceNeedsYou = vi.fn(async () => undefined);
    mockDeliverVerificationFeedback.mockRejectedValueOnce(new Error('forge unreachable'));
    tick();
    makeGhMocksForHead('abc123def456');
    const readPrFacts = vi.fn(async () => facts({ checks: 'red', testChecks: 'red' }));

    const result = await relayCiFailureFeedback(relayOpts, { readPrFacts, surfaceNeedsYou });

    expect(result).toMatchObject({ testGateFailed: true, agentMessageSent: false });
    expect(surfaceNeedsYou).toHaveBeenCalledWith('PAN-1801', expect.stringContaining('was not delivered: forge unreachable'), expect.anything());
  });

  it('counts a test failure the default branch does not share (review of #3993, M3)', async () => {
    tick();
    makeGhMocksForHead('abc123def456');
    const readPrFacts = vi.fn(async () => facts({
      checks: 'red',
      testChecks: 'red',
      testCheckFailures: [{ name: 'test-shard (1/4)', conclusion: 'FAILURE' }, { name: 'test-shard (2/4)', conclusion: 'FAILURE' }],
    }));
    const readDefaultBranchFailingTestChecks = vi.fn(async () => new Set(['test-shard (1/4)']));

    const result = await relayCiFailureFeedback(relayOpts, { readPrFacts, readDefaultBranchFailingTestChecks });

    expect(result).toMatchObject({ testGateFailed: true, cycleCount: 1 });
    expect(failedEntries()).toHaveLength(1);
  });

  it('a red test job still reaches the agent after an earlier non-test failure on the same head', async () => {
    makeGhMocks();
    const readPrFacts = vi.fn()
      .mockResolvedValueOnce(facts({ checks: 'red', testChecks: 'pending' }))
      .mockResolvedValue(facts({ checks: 'red', testChecks: 'red' }));

    const first = await relayCiFailureFeedback({ ...relayOpts, source: 'check_run:lint' }, { readPrFacts });
    tick();
    const second = await relayCiFailureFeedback(relayOpts, { readPrFacts });

    expect(first.testGateFailed).toBeUndefined();
    expect(mockMessageAgent).toHaveBeenCalledWith('agent-pan-1801', expect.stringContaining('SPECIALIST FEEDBACK'), 'internal', {});
    expect(second).toMatchObject({ testGateFailed: true, agentMessageSent: true });
    expect(mockDeliverVerificationFeedback).toHaveBeenCalledTimes(1);
  });

  it('delivers a test-gate failure even when no work-agent row exists (the feedback door resurrects)', async () => {
    mockGetAgentStateSync.mockReturnValue(null);

    const result = await redHead('abc123def456');

    expect(result).toMatchObject({ testGateFailed: true, cycleCount: 1 });
    expect(failedEntries()).toHaveLength(1);
    expect(mockDeliverVerificationFeedback).toHaveBeenCalledTimes(1);
  });

  it('does not count a test failure when only a non-test check is red', async () => {
    makeGhMocks();
    const readPrFacts = vi.fn(async () => facts({ checks: 'red', testChecks: 'green' }));

    const result = await relayCiFailureFeedback(relayOpts, { readPrFacts });

    expect(result.testGateFailed).toBeUndefined();
    expect(readPipelineJournal(workspacePath)).toEqual([]);
    expect(mockMessageAgent).toHaveBeenCalledWith('agent-pan-1801', expect.stringContaining('SPECIALIST FEEDBACK'), 'internal', {});
  });

  it('ignores a red test job reported for a head the PR has moved past', async () => {
    makeGhMocks();
    const readPrFacts = vi.fn(async () => facts({ headSha: 'newer0000000', checks: 'red', testChecks: 'red' }));

    const result = await relayCiFailureFeedback(relayOpts, { readPrFacts });

    expect(result.testGateFailed).toBeUndefined();
    expect(readPipelineJournal(workspacePath)).toEqual([]);
  });

  it('leaves a verification.tests: local project to the local gate', async () => {
    makeGhMocks();
    mockFindProjectByPathSync.mockReturnValue({ name: 'Overdeck', path: projectPath, verification: { tests: 'local' } });
    const readPrFacts = vi.fn(async () => facts({ checks: 'red', testChecks: 'red' }));

    const result = await relayCiFailureFeedback(relayOpts, { readPrFacts });
    const passRecorded = await recordCiTestGatePass(
      { issueId: 'PAN-1801', headSha: 'abc123def456', headRef: 'feature/pan-1801', source: 'check_run:test' },
      { readPrFacts },
    );

    expect(readPrFacts).not.toHaveBeenCalled();
    expect(result.testGateFailed).toBeUndefined();
    expect(passRecorded).toBe(false);
    expect(readPipelineJournal(workspacePath)).toEqual([]);
  });
});
