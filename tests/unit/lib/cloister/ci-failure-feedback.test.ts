/**
 * Tests for ci-failure-feedback.ts (PAN-1801)
 */
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Effect } from 'effect';
import { relayCiFailureFeedback, resetCiFailureFeedbackStateForTests } from '../../../../src/lib/cloister/ci-failure-feedback.js';
import { readPipelineJournal } from '../../../../src/lib/cloister/pipeline-journal.js';
import type { PrFacts } from '../../../../src/lib/cloister/pr-facts.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const mockGetAgentStateSync = vi.fn();
const mockMessageAgent = vi.fn();

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentStateSync: (...args: Parameters<typeof mockGetAgentStateSync>) => mockGetAgentStateSync(...args),
  messageAgent: (...args: Parameters<typeof mockMessageAgent>) => mockMessageAgent(...args),
}));

const mockResolveProjectFromIssueSync = vi.fn();
const mockFindProjectByPathSync = vi.fn();

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: (...args: Parameters<typeof mockResolveProjectFromIssueSync>) => mockResolveProjectFromIssueSync(...args),
  findProjectByPathSync: (...args: Parameters<typeof mockFindProjectByPathSync>) => mockFindProjectByPathSync(...args),
}));

const mockWriteFeedbackFile = vi.fn();

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
  mockWriteFeedbackFile.mockReturnValue(Effect.succeed({
    success: true,
    filePath: '/tmp/overdeck/workspaces/feature-pan-1801/.pan/feedback/001-ci-monitor-failed.md',
    relativePath: '.pan/feedback/001-ci-monitor-failed.md',
  }));
  mockMessageAgent.mockResolvedValue({ delivered: true, queuedToMail: false });
  // No project config → the local test gate; the CI test-gate path stays off.
  mockFindProjectByPathSync.mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

    const result = await Effect.runPromise(relayCiFailureFeedback({
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      prUrl: 'https://github.com/test-owner/test-repo/pull/42',
      source: 'check_run:test',
    }));

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

    await Effect.runPromise(relayCiFailureFeedback({
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      prUrl: 'https://github.com/test-owner/test-repo/pull/42',
      source: 'check_run:test',
    }));

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

    await Effect.runPromise(relayCiFailureFeedback(opts));
    await Effect.runPromise(relayCiFailureFeedback(opts));

    expect(execFile).toHaveBeenCalledTimes(4); // 2 list + 2 view (only once because debounced)
    expect(mockMessageAgent).toHaveBeenCalledTimes(1);
  });

  it('skips feedback when no work agent exists', async () => {
    mockGetAgentStateSync.mockReturnValue(null);

    const result = await Effect.runPromise(relayCiFailureFeedback({
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      source: 'check_run:test',
    }));

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

    const result = await Effect.runPromise(relayCiFailureFeedback({
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      source: 'check_run:test',
    }));

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

    const result = await Effect.runPromise(relayCiFailureFeedback({
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      source: 'check_run:test',
    }));

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

    const result = await Effect.runPromise(relayCiFailureFeedback({
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      source: 'status:ci',
    }));

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

    const result = await Effect.runPromise(relayCiFailureFeedback({
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      source: 'polling_reconciliation',
    }));

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

    const result = await Effect.runPromise(relayCiFailureFeedback({
      issueId: 'PAN-1801',
      repo: 'test-owner/test-repo',
      prNumber: 42,
      headSha: 'abc123def456',
      headRef: 'feature/pan-1801',
      source: 'check_run:test',
    }));

    expect(result.agentMessageSent).toBe(false);
    expect(mockWriteFeedbackFile).not.toHaveBeenCalled();
  });
});

describe('PAN-3965: the CI test job is the verification test gate', () => {
  let projectPath: string;
  let workspacePath: string;

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

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'pan-3965-ci-'));
    workspacePath = join(projectPath, 'workspaces', 'feature-pan-1801');
    mkdirSync(workspacePath, { recursive: true });
    mockResolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck', projectName: 'Overdeck', projectPath });
    mockFindProjectByPathSync.mockReturnValue({ name: 'Overdeck', path: projectPath, verification: { tests: 'ci' } });
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('journals verification.failed { failedCheck: test } and tells the agent it owes rework', async () => {
    makeGhMocks();
    const readPrFacts = vi.fn(async () => facts({ checks: 'red', testChecks: 'red' }));

    const result = await Effect.runPromise(relayCiFailureFeedback(relayOpts, { readPrFacts }));

    expect(result.testGateFailed).toBe(true);
    expect(result.agentMessageSent).toBe(true);
    const failed = readPipelineJournal(workspacePath).filter((entry) => entry.type === 'verification.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      issueId: 'PAN-1801',
      source: 'ci:check_run:test',
      data: { failedCheck: 'test', head: 'abc123de', via: 'ci', prNumber: 42 },
    });
    expect(mockMessageAgent).toHaveBeenCalledWith(
      'agent-pan-1801',
      expect.stringContaining('Failed check: test'),
      'internal',
      { owesRework: true, feedbackRedelivery: true },
    );
    expect(mockWriteFeedbackFile).toHaveBeenCalledWith(expect.objectContaining({
      markdownBody: expect.stringContaining('the CI test job is the verification test gate'),
    }));
  });

  it('journals once per head even when several webhooks report the same red test job', async () => {
    makeGhMocks();
    const readPrFacts = vi.fn(async () => facts({ checks: 'red', testChecks: 'red' }));

    await Effect.runPromise(relayCiFailureFeedback(relayOpts, { readPrFacts }));
    await Effect.runPromise(relayCiFailureFeedback({ ...relayOpts, source: 'check_suite' }, { readPrFacts }));

    expect(readPipelineJournal(workspacePath).filter((entry) => entry.type === 'verification.failed')).toHaveLength(1);
    expect(mockMessageAgent).toHaveBeenCalledTimes(1);
  });

  it('journals the failure even when no work agent is live to tell', async () => {
    mockGetAgentStateSync.mockReturnValue(null);
    const readPrFacts = vi.fn(async () => facts({ checks: 'red', testChecks: 'red' }));

    const result = await Effect.runPromise(relayCiFailureFeedback(relayOpts, { readPrFacts }));

    expect(result).toEqual({ agentMessageSent: false, testGateFailed: true });
    expect(readPipelineJournal(workspacePath).map((entry) => entry.type)).toEqual(['verification.failed']);
  });

  it('does not journal a test failure when only a non-test check is red', async () => {
    makeGhMocks();
    const readPrFacts = vi.fn(async () => facts({ checks: 'red', testChecks: 'green' }));

    const result = await Effect.runPromise(relayCiFailureFeedback(relayOpts, { readPrFacts }));

    expect(result.testGateFailed).toBeUndefined();
    expect(readPipelineJournal(workspacePath)).toEqual([]);
    expect(mockMessageAgent).toHaveBeenCalledWith(
      'agent-pan-1801',
      expect.stringContaining('SPECIALIST FEEDBACK'),
      'internal',
      {},
    );
  });

  it('ignores a red test job reported for a head the PR has moved past', async () => {
    makeGhMocks();
    const readPrFacts = vi.fn(async () => facts({ headSha: 'newer0000000', checks: 'red', testChecks: 'red' }));

    const result = await Effect.runPromise(relayCiFailureFeedback(relayOpts, { readPrFacts }));

    expect(result.testGateFailed).toBeUndefined();
    expect(readPipelineJournal(workspacePath)).toEqual([]);
  });

  it('leaves a verification.tests: local project to the local gate', async () => {
    makeGhMocks();
    mockFindProjectByPathSync.mockReturnValue({ name: 'Overdeck', path: projectPath, verification: { tests: 'local' } });
    const readPrFacts = vi.fn(async () => facts({ checks: 'red', testChecks: 'red' }));

    const result = await Effect.runPromise(relayCiFailureFeedback(relayOpts, { readPrFacts }));

    expect(readPrFacts).not.toHaveBeenCalled();
    expect(result.testGateFailed).toBeUndefined();
    expect(readPipelineJournal(workspacePath)).toEqual([]);
  });

  it('reports the message as unsent when delivery is refused', async () => {
    makeGhMocks();
    mockMessageAgent.mockResolvedValue({ delivered: false, queuedToMail: false, reason: 'pane gone' });
    const readPrFacts = vi.fn(async () => facts({ checks: 'red', testChecks: 'red' }));

    const result = await Effect.runPromise(relayCiFailureFeedback(relayOpts, { readPrFacts }));

    expect(result.agentMessageSent).toBe(false);
    expect(result.testGateFailed).toBe(true);
  });
});
