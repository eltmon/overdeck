/**
 * Command-level tests for approveCommand behavior.
 *
 * Covers:
 *  - agent-not-found: returns without doing anything
 *  - happy-path: PR found and merged, tracker updated
 *  - pr-not-found: command completes without error even when no PR exists
 *  - shadow-mode: calls markAsSynced instead of Linear update
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

// ── Module-level mocks ─────────────────────────────────────────────────────

const mockExecSync = vi.fn();
const mockGetAgentState = vi.fn();
const mockSaveAgentState = vi.fn();
const mockMarkAsSynced = vi.fn();
const mockShouldSkipTrackerUpdate = vi.fn();
const mockGetLinearApiKey = vi.fn();

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execSync: mockExecSync };
});

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentState: mockGetAgentState,
  saveAgentState: mockSaveAgentState,
  saveAgentRuntimeState: vi.fn(),
}));

vi.mock('../../../../src/lib/shadow-mode.js', () => ({
  shouldSkipTrackerUpdate: mockShouldSkipTrackerUpdate,
}));

vi.mock('../../../../src/lib/shadow-state.js', () => ({
  markAsSynced: mockMarkAsSynced,
}));

vi.mock('../../../../src/lib/shadow-utils.js', () => ({
  getLinearApiKey: mockGetLinearApiKey,
}));

vi.mock('@linear/sdk', () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    searchIssues: vi.fn().mockResolvedValue({ nodes: [] }),
    issue: vi.fn(),
  })),
}));

vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ text: '', succeed: vi.fn(), fail: vi.fn(), warn: vi.fn(), stop: vi.fn() }),
  }),
}));

vi.mock('../../../../src/lib/paths.js', () => ({
  AGENTS_DIR: '/tmp/pan-test-agents',
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeState(extra: Record<string, unknown> = {}) {
  return {
    id: 'agent-pan-714',
    issueId: 'PAN-714',
    workspace: '/fake/workspace',
    status: 'stopped',
    lastActivity: new Date().toISOString(),
    ...extra,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

// approveCommand constructs agentId as 'agent-pan-714' from 'PAN-714'
const TEST_AGENTS_DIR = '/tmp/pan-test-agents';
const TEST_AGENT_DIR = join(TEST_AGENTS_DIR, 'agent-pan-714');

describe('approveCommand', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    mockExecSync.mockReset();
    mockGetAgentState.mockReset();
    mockSaveAgentState.mockReset();
    mockMarkAsSynced.mockReset();
    mockShouldSkipTrackerUpdate.mockReset();
    mockGetLinearApiKey.mockReset();

    // Create the agent directory so writeFileSync('approved') does not throw ENOENT
    mkdirSync(TEST_AGENT_DIR, { recursive: true });

    // Suppress process.exit and capture the spy for assertion
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    // Remove agent guard env var
    delete process.env.PANOPTICON_AGENT_ID;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PANOPTICON_AGENT_ID;
    rmSync(TEST_AGENTS_DIR, { recursive: true, force: true });
  });

  it('returns early when agent state is not found', async () => {
    mockGetAgentState.mockReturnValue(null);

    const { approveCommand } = await import('../../../../src/cli/commands/approve.js');
    await expect(approveCommand('PAN-714')).resolves.not.toThrow();

    // No tracker calls — state was not found
    expect(mockShouldSkipTrackerUpdate).not.toHaveBeenCalled();
  });

  it('calls process.exit(1) when running as an agent (PANOPTICON_AGENT_ID is set)', async () => {
    process.env.PANOPTICON_AGENT_ID = 'agent-pan-714';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    const { approveCommand } = await import('../../../../src/cli/commands/approve.js');
    await approveCommand('PAN-714');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('shadow mode: calls markAsSynced instead of Linear update', async () => {
    mockGetAgentState.mockReturnValue(makeState());
    mockShouldSkipTrackerUpdate.mockResolvedValue(true);
    mockMarkAsSynced.mockResolvedValue({ success: true });
    // gh not available — skip PR merge
    mockExecSync.mockImplementation(() => { throw new Error('gh not found'); });

    const { approveCommand } = await import('../../../../src/cli/commands/approve.js');
    await approveCommand('PAN-714');

    expect(mockMarkAsSynced).toHaveBeenCalledWith('PAN-714', 'closed');
    expect(mockGetLinearApiKey).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it('happy path: no PR found — command completes without error', async () => {
    mockGetAgentState.mockReturnValue(makeState());
    mockShouldSkipTrackerUpdate.mockResolvedValue(false);
    mockGetLinearApiKey.mockReturnValue(null); // no linear key

    // gh found, but no PR
    mockExecSync
      .mockReturnValueOnce('/usr/bin/gh') // which gh
      .mockReturnValueOnce('feature/pan-714\n') // git rev-parse
      .mockReturnValueOnce('[]'); // gh pr list → no PR

    const { approveCommand } = await import('../../../../src/cli/commands/approve.js');
    await approveCommand('PAN-714');

    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it('happy path: PR found and merged successfully', async () => {
    mockGetAgentState.mockReturnValue(makeState());
    mockShouldSkipTrackerUpdate.mockResolvedValue(false);
    mockGetLinearApiKey.mockReturnValue(null);

    mockExecSync
      .mockReturnValueOnce('/usr/bin/gh') // which gh
      .mockReturnValueOnce('feature/pan-714\n') // git rev-parse
      .mockReturnValueOnce(JSON.stringify([{ number: 99, url: 'https://github.com/foo/bar/pull/99' }])) // gh pr list
      .mockReturnValueOnce(''); // gh pr merge → success

    const { approveCommand } = await import('../../../../src/cli/commands/approve.js');
    await approveCommand('PAN-714');

    expect(exitSpy).not.toHaveBeenCalledWith(1);
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('gh pr merge 99'),
      expect.anything(),
    );
  });
});
