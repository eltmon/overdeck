/**
 * Unit tests for the exported helpers in approve.ts.
 *
 * Tests `checkGhCli`, `findPRForBranch`, `mergePR`, and `updateLinearStatus`
 * by mocking `child_process.execSync` and the Linear SDK.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module-level mocks ─────────────────────────────────────────────────────

const mockExecSync = vi.fn();

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execSync: mockExecSync };
});

// Mock Linear SDK used by updateLinearStatus
const mockIssueUpdate = vi.fn();
const mockIssue = vi.fn();
const mockSearchIssues = vi.fn();

vi.mock('@linear/sdk', () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    searchIssues: mockSearchIssues,
    issue: mockIssue,
  })),
}));

// Suppress ora spinner
vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ text: '', succeed: vi.fn(), fail: vi.fn(), warn: vi.fn(), stop: vi.fn() }),
  }),
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentState: vi.fn().mockReturnValue(null),
  saveAgentState: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
}));

vi.mock('../../../../src/lib/shadow-mode.js', () => ({
  shouldSkipTrackerUpdate: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../../src/lib/shadow-state.js', () => ({
  markAsSynced: vi.fn(),
}));

vi.mock('../../../../src/lib/shadow-utils.js', () => ({
  getLinearApiKey: vi.fn().mockReturnValue(null),
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('checkGhCli', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecSync.mockReset();
  });

  it('returns true when gh is found', async () => {
    mockExecSync.mockReturnValue('/usr/bin/gh\n');
    const { checkGhCli } = await import('../../../../src/cli/commands/approve.js');
    expect(checkGhCli()).toBe(true);
  });

  it('returns false when gh is not found (execSync throws)', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('command not found'); });
    const { checkGhCli } = await import('../../../../src/cli/commands/approve.js');
    expect(checkGhCli()).toBe(false);
  });
});

describe('findPRForBranch', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecSync.mockReset();
  });

  it('returns PR number and url when a PR exists for the current branch', async () => {
    // execSync with encoding:'utf-8' returns a string
    mockExecSync
      .mockReturnValueOnce('feature/pan-714\n') // git rev-parse
      .mockReturnValueOnce(JSON.stringify([{ number: 42, url: 'https://github.com/foo/bar/pull/42' }]));

    const { findPRForBranch } = await import('../../../../src/cli/commands/approve.js');
    const result = findPRForBranch('/fake/workspace');
    expect(result).toEqual({ number: 42, url: 'https://github.com/foo/bar/pull/42' });
  });

  it('returns null when no PR exists for the branch', async () => {
    mockExecSync
      .mockReturnValueOnce('feature/pan-714\n')
      .mockReturnValueOnce('[]');

    const { findPRForBranch } = await import('../../../../src/cli/commands/approve.js');
    const result = findPRForBranch('/fake/workspace');
    expect(result).toBeNull();
  });

  it('returns null when git command throws', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('not a git repo'); });
    const { findPRForBranch } = await import('../../../../src/cli/commands/approve.js');
    const result = findPRForBranch('/fake/workspace');
    expect(result).toBeNull();
  });

  it('returns null when gh command throws', async () => {
    mockExecSync
      .mockReturnValueOnce('feature/pan-714\n')
      .mockImplementationOnce(() => { throw new Error('gh: command not found'); });
    const { findPRForBranch } = await import('../../../../src/cli/commands/approve.js');
    const result = findPRForBranch('/fake/workspace');
    expect(result).toBeNull();
  });
});

describe('mergePR', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecSync.mockReset();
  });

  it('returns { success: true } when gh pr merge succeeds', async () => {
    mockExecSync.mockReturnValue('');
    const { mergePR } = await import('../../../../src/cli/commands/approve.js');
    expect(mergePR('/fake/workspace', 42)).toEqual({ success: true });
  });

  it('returns { success: false, error } when gh pr merge fails', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('PR already merged'); });
    const { mergePR } = await import('../../../../src/cli/commands/approve.js');
    const result = mergePR('/fake/workspace', 42);
    expect(result.success).toBe(false);
    expect(result.error).toContain('PR already merged');
  });
});

describe('updateLinearStatus', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSearchIssues.mockReset();
    mockIssue.mockReset();
    mockIssueUpdate.mockReset();
  });

  it('returns false when issue is not found in Linear', async () => {
    mockSearchIssues.mockResolvedValue({ nodes: [] });
    const { updateLinearStatus } = await import('../../../../src/cli/commands/approve.js');
    const result = await updateLinearStatus('fake-api-key', 'PAN-714');
    expect(result).toBe(false);
  });

  it('returns false when the Done state is not found in the team', async () => {
    mockSearchIssues.mockResolvedValue({
      nodes: [{ id: 'issue-1', identifier: 'PAN-714' }],
    });
    mockIssue.mockResolvedValue({
      team: Promise.resolve({
        states: vi.fn().mockResolvedValue({ nodes: [] }),
      }),
      update: mockIssueUpdate,
    });

    const { updateLinearStatus } = await import('../../../../src/cli/commands/approve.js');
    const result = await updateLinearStatus('fake-api-key', 'PAN-714');
    expect(result).toBe(false);
  });

  it('returns true and calls issue.update when Done state is found', async () => {
    mockSearchIssues.mockResolvedValue({
      nodes: [{ id: 'issue-1', identifier: 'PAN-714' }],
    });
    mockIssue.mockResolvedValue({
      team: Promise.resolve({
        states: vi.fn().mockResolvedValue({
          nodes: [{ id: 'state-done', type: 'completed', name: 'Done' }],
        }),
      }),
      update: mockIssueUpdate.mockResolvedValue(undefined),
    });

    const { updateLinearStatus } = await import('../../../../src/cli/commands/approve.js');
    const result = await updateLinearStatus('fake-api-key', 'PAN-714');
    expect(result).toBe(true);
    expect(mockIssueUpdate).toHaveBeenCalledWith({ stateId: 'state-done' });
  });

  it('returns false when Linear SDK throws', async () => {
    mockSearchIssues.mockRejectedValue(new Error('Network error'));
    const { updateLinearStatus } = await import('../../../../src/cli/commands/approve.js');
    const result = await updateLinearStatus('fake-api-key', 'PAN-714');
    expect(result).toBe(false);
  });
});
