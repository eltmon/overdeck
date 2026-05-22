import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    exec: vi.fn(),
    execFile: execFileMock,
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ isDirectory: () => false, mtimeMs: 0 })),
    rmSync: vi.fn(),
  };
});

vi.mock('../../../lib/agents.js', async () => {
  const { Effect } = await import('effect');
  const effectMock = (initial?: unknown) => {
    const wrap = (value: unknown) => {
      if (value && typeof value === 'object' && 'pipe' in value) return value;
      return Effect.succeed(value);
    };
    const fn: any = vi.fn(() => wrap(typeof initial === 'function' ? (initial as () => unknown)() : initial));
    fn.mockResolvedValue = (value: unknown) => fn.mockReturnValue(Effect.succeed(value));
    fn.mockRejectedValue = (error: unknown) => fn.mockReturnValue(Effect.fail(error));
    fn.mockResolvedValueOnce = (value: unknown) => fn.mockReturnValueOnce(Effect.succeed(value));
    fn.mockRejectedValueOnce = (error: unknown) => fn.mockReturnValueOnce(Effect.fail(error));
    const originalMockImplementation = fn.mockImplementation.bind(fn);
    fn.mockImplementation = (impl: (...args: unknown[]) => unknown) => originalMockImplementation((...args: unknown[]) => {
      const result = impl(...args);
      if (result && typeof result === 'object' && 'pipe' in result) return result;
      return Effect.promise(() => Promise.resolve(result));
    });
    return fn;
  };
  return {
  getAgentDir: vi.fn(),
  getAgentRuntimeState: vi.fn(),
  getAgentState: vi.fn(),
  getAgentStateEffect: effectMock(null),
  listRunningAgents: vi.fn(() => []),
  recordAgentFailureEffect: effectMock(null),
  resumeAgent: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  saveAgentState: vi.fn(),
  saveAgentStateEffect: effectMock(undefined),
  saveSessionId: vi.fn(),
  };
});

vi.mock('../../../lib/review-status.js', () => ({
  getReviewStatus: vi.fn(),
  loadReviewStatuses: vi.fn(() => ({})),
  setReviewStatus: vi.fn(),
}));

vi.mock('../../../lib/stashes.js', () => ({
  dropStash: vi.fn(async () => {}),
  isOlderThanDays: vi.fn(),
  listStashes: vi.fn(async () => []),
}));

vi.mock('../../../lib/tmux.js', async () => {
  const { Effect } = await import('effect');
  const effectMock = (initial?: unknown) => {
    const wrap = (value: unknown) => {
      if (value && typeof value === 'object' && 'pipe' in value) return value;
      return Effect.succeed(value);
    };
    const fn: any = vi.fn(() => wrap(typeof initial === 'function' ? (initial as () => unknown)() : initial));
    fn.mockResolvedValue = (value: unknown) => fn.mockReturnValue(Effect.succeed(value));
    fn.mockRejectedValue = (error: unknown) => fn.mockReturnValue(Effect.fail(error));
    fn.mockResolvedValueOnce = (value: unknown) => fn.mockReturnValueOnce(Effect.succeed(value));
    fn.mockRejectedValueOnce = (error: unknown) => fn.mockReturnValueOnce(Effect.fail(error));
    const originalMockImplementation = fn.mockImplementation.bind(fn);
    fn.mockImplementation = (impl: (...args: unknown[]) => unknown) => originalMockImplementation((...args: unknown[]) => {
      const result = impl(...args);
      if (result && typeof result === 'object' && 'pipe' in result) return result;
      return Effect.promise(() => Promise.resolve(result));
    });
    return fn;
  };
  return {
  buildTmuxCommandString: vi.fn(() => 'tmux'),
  capturePaneAsyncEffect: effectMock(''),
  createSessionAsyncEffect: effectMock(undefined),
  isPaneDeadAsyncEffect: effectMock(false),
  killSession: vi.fn(),
  killSessionAsyncEffect: effectMock(undefined),
  listPaneValues: vi.fn(() => []),
  listPaneValuesAsyncEffect: effectMock([]),
  listSessionNamesAsyncEffect: effectMock([]),
  sendKeysEffect: effectMock(undefined),
  sessionExists: vi.fn(() => false),
  sessionExistsAsyncEffect: effectMock(false),
  };
});

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityTts: vi.fn(),
}));
vi.mock('../../database/app-settings.js', () => ({ isDeaconGloballyPaused: vi.fn(() => false) }));
vi.mock('../../database/review-status-db.js', () => ({ markWorkspaceStuck: vi.fn() }));
vi.mock('../../lifecycle/archive-planning.js', () => ({ findWorkspacePath: vi.fn() }));
vi.mock('../../lifecycle/workflows.js', async () => {
  // PAN-1249: closeOut returns Effect<WorkflowResult>, not Promise.
  const { Effect } = await import('effect');
  return { closeOut: vi.fn(() => Effect.succeed({ success: true, steps: [] })) };
});
vi.mock('../../paths.js', () => ({ PANOPTICON_HOME: '/tmp/test-panopticon', AGENTS_DIR: '/tmp/test-agents' }));
vi.mock('../../persistent-logger.js', () => ({ logAgentLifecycle: vi.fn(), logDeaconEvent: vi.fn() }));
vi.mock('../../projects.js', () => ({
  getProject: vi.fn(() => null),
  listProjects: vi.fn(() => []),
  resolveProjectFromIssue: vi.fn(() => ({ projectKey: 'panopticon', projectPath: '/repo' })),
}));
vi.mock('../../shadow-state.js', () => ({ getShadowState: vi.fn(async () => null) }));
vi.mock('../../tracker-utils.js', () => ({ resolveGitHubIssue: vi.fn(() => ({ isGitHub: true, owner: 'eltmon', repo: 'panopticon-cli', number: 1190 })) }));
vi.mock('../../tracker/factory.js', () => ({ createTracker: vi.fn() }));
vi.mock('../config.js', async () => {
  const { Effect } = await import('effect');
  const effectMock = (initial?: unknown) => {
    const wrap = (value: unknown) => {
      if (value && typeof value === 'object' && 'pipe' in value) return value;
      return Effect.succeed(value);
    };
    const fn: any = vi.fn(() => wrap(typeof initial === 'function' ? (initial as () => unknown)() : initial));
    fn.mockResolvedValue = (value: unknown) => fn.mockReturnValue(Effect.succeed(value));
    fn.mockRejectedValue = (error: unknown) => fn.mockReturnValue(Effect.fail(error));
    fn.mockResolvedValueOnce = (value: unknown) => fn.mockReturnValueOnce(Effect.succeed(value));
    fn.mockRejectedValueOnce = (error: unknown) => fn.mockReturnValueOnce(Effect.fail(error));
    const originalMockImplementation = fn.mockImplementation.bind(fn);
    fn.mockImplementation = (impl: (...args: unknown[]) => unknown) => originalMockImplementation((...args: unknown[]) => {
      const result = impl(...args);
      if (result && typeof result === 'object' && 'pipe' in result) return result;
      return Effect.promise(() => Promise.resolve(result));
    });
    return fn;
  };
  return {
  loadCloisterConfig: vi.fn(() => ({ close_out: { auto: false, auto_delay_minutes: 60 }, monitoring: {} })),
  loadCloisterConfigEffect: effectMock({ close_out: { auto: false, auto_delay_minutes: 60 }, monitoring: {} }),
  };
});
vi.mock('../specialists.js', () => ({
  getAllProjectSpecialistStatuses: vi.fn(async () => []),
  getTmuxSessionName: vi.fn((name: string) => `specialist-${name}`),
  isRunning: vi.fn(async () => false),
}));

import { autoCloseOut } from '../deacon.js';
import { loadCloisterConfigEffect } from '../config.js';
import { loadReviewStatuses, setReviewStatus } from '../../../lib/review-status.js';
import { resolveProjectFromIssue } from '../../projects.js';
import { resolveGitHubIssue } from '../../tracker-utils.js';
import { emitActivityEntry } from '../../activity-logger.js';
import { closeOut } from '../../lifecycle/workflows.js';

const mockLoadCloisterConfig = vi.mocked(loadCloisterConfigEffect);
const mockLoadReviewStatuses = vi.mocked(loadReviewStatuses);
const mockSetReviewStatus = vi.mocked(setReviewStatus);
const mockResolveProjectFromIssue = vi.mocked(resolveProjectFromIssue);
const mockResolveGitHubIssue = vi.mocked(resolveGitHubIssue);
const mockEmitActivityEntry = vi.mocked(emitActivityEntry);
const mockCloseOut = vi.mocked(closeOut);

function installIssueView(labels: string[], state = 'OPEN') {
  execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
    const callback = cb!;
    callback(null, { stdout: JSON.stringify({ state, labels: labels.map(name => ({ name })) }), stderr: '' });
  });
}

const oldTimestamp = '2026-05-18T10:00:00.000Z';
const now = new Date('2026-05-18T12:00:00.000Z');

function mergedStatus(issueId: string, updatedAt = oldTimestamp) {
  return {
    issueId,
    reviewStatus: 'passed',
    testStatus: 'passed',
    mergeStatus: 'merged',
    readyForMerge: false,
    updatedAt,
  };
}

describe('autoCloseOut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCloisterConfig.mockResolvedValue({ close_out: { auto: true, auto_delay_minutes: 60 }, monitoring: {} } as any);
    mockLoadReviewStatuses.mockReturnValue({});
    mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'panopticon', projectPath: '/repo' } as any);
    mockResolveGitHubIssue.mockReturnValue({ isGitHub: true, owner: 'eltmon', repo: 'panopticon-cli', number: 1190 } as any);
    // PAN-1249: closeOut returns Effect; mock with Effect.succeed.
    mockCloseOut.mockReturnValue(Effect.succeed({ success: true, steps: [] }) as any);
    installIssueView(['verifying-on-main']);
  });

  it('returns without side effects when automatic close-out is disabled', async () => {
    mockLoadCloisterConfig.mockResolvedValue({ close_out: { auto: false, auto_delay_minutes: 60 }, monitoring: {} } as any);
    mockLoadReviewStatuses.mockReturnValue({ 'PAN-1190': mergedStatus('PAN-1190') } as any);

    const actions = await autoCloseOut(now);

    expect(actions).toEqual([]);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(mockCloseOut).not.toHaveBeenCalled();
    expect(mockEmitActivityEntry).not.toHaveBeenCalled();
    expect(mockSetReviewStatus).not.toHaveBeenCalled();
  });

  it('runs close-out with auto context for eligible verifying-on-main issues', async () => {
    mockLoadReviewStatuses.mockReturnValue({ 'PAN-1190': mergedStatus('PAN-1190') } as any);

    const actions = await autoCloseOut(now);

    expect(mockCloseOut).toHaveBeenCalledWith({
      issueId: 'PAN-1190',
      projectPath: '/repo',
      auto: true,
      github: { owner: 'eltmon', repo: 'panopticon-cli', number: 1190 },
    });
    expect(actions).toEqual(['Auto close-out completed for PAN-1190']);
    expect(mockEmitActivityEntry).toHaveBeenCalledWith({
      source: 'cloister',
      level: 'info',
      issueId: 'PAN-1190',
      message: 'Auto close-out completed for PAN-1190',
    });
  });

  it('skips non-merged, too-new, and non-verifying issues', async () => {
    mockLoadReviewStatuses.mockReturnValue({
      'PAN-1': { ...mergedStatus('PAN-1'), mergeStatus: 'pending' },
      'PAN-2': mergedStatus('PAN-2', '2026-05-18T11:30:00.000Z'),
      'PAN-3': mergedStatus('PAN-3'),
    } as any);
    installIssueView(['in-progress']);

    const actions = await autoCloseOut(now);

    expect(actions).toEqual([]);
    expect(mockCloseOut).not.toHaveBeenCalled();
  });

  it('records failure through review status and activity so retry backs off via updatedAt', async () => {
    mockLoadReviewStatuses.mockReturnValue({ 'PAN-1190': mergedStatus('PAN-1190') } as any);
    // PAN-1249: closeOut returns Effect; mock with Effect.succeed.
    mockCloseOut.mockReturnValue(Effect.succeed({
      success: false,
      steps: [{ step: 'close-out:archive', success: false, skipped: false, error: 'archive failed' }],
    }) as any);

    const actions = await autoCloseOut(now);

    expect(actions).toEqual(['Auto close-out failed for PAN-1190: archive failed']);
    expect(mockSetReviewStatus).toHaveBeenCalledWith(
      'PAN-1190',
      expect.objectContaining({
        mergeNotes: 'Auto close-out failed: archive failed',
        updatedAt: expect.any(String),
      }),
    );
    expect(mockEmitActivityEntry).toHaveBeenCalledWith({
      source: 'cloister',
      level: 'warn',
      issueId: 'PAN-1190',
      message: 'Auto close-out failed for PAN-1190: archive failed',
    });
  });
});
