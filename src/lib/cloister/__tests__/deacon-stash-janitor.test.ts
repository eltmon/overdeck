import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/agents.js', () => ({
  messageAgent: vi.fn(async () => {}),
  listRunningAgents: vi.fn(),
  getAgentRuntimeState: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  getAgentDir: vi.fn(),
  getAgentState: vi.fn(),
  saveAgentState: vi.fn(),
  resumeAgent: vi.fn(),
}));

vi.mock('../../../lib/stashes.js', () => ({
  dropStash: vi.fn(async () => {}),
  isOlderThanDays: vi.fn(),
  listStashes: vi.fn(async () => []),
}));

vi.mock('../../../lib/review-status.js', () => ({
  setReviewStatus: vi.fn(),
  loadReviewStatuses: vi.fn(() => ({})),
  getReviewStatus: vi.fn(),
}));

vi.mock('../../database/review-status-db.js', () => ({ markWorkspaceStuck: vi.fn() }));
vi.mock('../../database/app-settings.js', () => ({ isDeaconGloballyPaused: vi.fn(() => false) }));
vi.mock('../../shadow-state.js', () => ({ getShadowState: vi.fn(async () => null) }));
vi.mock('../../projects.js', () => ({ resolveProjectFromIssue: vi.fn(), listProjects: vi.fn(() => [{ config: { path: '/repo' } }]), getProject: vi.fn(() => null) }));
vi.mock('../../lifecycle/archive-planning.js', () => ({ findWorkspacePath: vi.fn() }));
vi.mock('../../persistent-logger.js', () => ({ logDeaconEvent: vi.fn(), logAgentLifecycle: vi.fn() }));
vi.mock('../../activity-logger.js', () => ({ emitActivityEntry: vi.fn(), emitActivityTts: vi.fn() }));
vi.mock('../../config.js', () => ({ loadConfig: vi.fn(() => ({ trackers: { primary: 'linear', linear: { type: 'linear', api_key_env: 'LINEAR_API_KEY' } } })) }));
vi.mock('../../tracker/factory.js', () => ({ createTracker: vi.fn() }));
vi.mock('../specialists.js', () => ({
  getTmuxSessionName: vi.fn((t: string) => `specialist-${t}`),
  isRunning: vi.fn(async () => false),
  getAllProjectSpecialistStatuses: vi.fn(async () => []),
}));
vi.mock('../config.js', () => ({
  loadCloisterConfig: vi.fn(() => ({
    monitoring: {},
  })),
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
  capturePane: effectMock(''),
  createSession: effectMock(undefined),
  killSession: vi.fn(),
  killSession: effectMock(undefined),
  listPaneValues: vi.fn(() => []),
  listPaneValues: effectMock([]),
  listSessionNames: effectMock([]),
  sessionExists: vi.fn(() => false),
  sessionExists: effectMock(false),
  sendKeysEffect: effectMock(undefined),
  isPaneDead: effectMock(false),
  };
});
vi.mock('../../paths.js', () => ({
  PANOPTICON_HOME: '/tmp/test-panopticon',
  AGENTS_DIR: '/tmp/test-agents',
}));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn((path: string, opts?: any) => {
      if (String(path).includes('/workspaces') && opts?.withFileTypes) {
        return [{ isDirectory: () => true, name: 'feature-pan-879' }];
      }
      return [];
    }),
    statSync: vi.fn(() => ({ isDirectory: () => false, mtimeMs: 0 })),
    rmSync: vi.fn(),
  };
});

const execMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: execMock, execFile: vi.fn() };
});

import { cleanupOrphanedReviewSessions, cleanupSpawnAndOrphanedStashes, loadConfig, logNonCanonicalStashesOnStartup, monitorReviewConvoySignals } from '../deacon.js';
import { listRunningAgentsSync, getAgentStateSync, saveAgentStateSync } from '../../../lib/agents.js';
import { dropStash, isOlderThanDays, listStashes } from '../../../lib/stashes.js';
import { resolveProjectFromIssueSync, getProjectSync } from '../../projects.js';
import { findWorkspacePath } from '../../lifecycle/archive-planning.js';
import { getReviewStatusSync, setReviewStatusSync } from '../../review-status.js';
import { createTracker } from '../../tracker/factory.js';
import { loadCloisterConfigSync } from '../config.js';
import { listSessionNames, killSession, sessionExistsSync, sessionExists } from '../../../lib/tmux.js';

const mockListRunningAgents = vi.mocked(listRunningAgentsSync);
const mockGetAgentState = vi.mocked(getAgentStateSync);
const mockSaveAgentState = vi.mocked(saveAgentStateSync);
const mockListSessionNamesAsync = vi.mocked(listSessionNames);
const mockKillSessionAsync = vi.mocked(killSession);
const mockSessionExists = vi.mocked(sessionExistsSync);
const mockSessionExistsAsync = vi.mocked(sessionExists);
const mockDropStash = vi.mocked(dropStash);
const mockIsOlderThanDays = vi.mocked(isOlderThanDays);
const mockListStashes = vi.mocked(listStashes);
const mockResolveProjectFromIssue = vi.mocked(resolveProjectFromIssueSync);
const mockGetProject = vi.mocked(getProjectSync);
const mockFindWorkspacePath = vi.mocked(findWorkspacePath);
const mockGetReviewStatus = vi.mocked(getReviewStatusSync);
const mockSetReviewStatus = vi.mocked(setReviewStatusSync);
const mockCreateTracker = vi.mocked(createTracker);
const mockLoadCloisterConfig = vi.mocked(loadCloisterConfigSync);

function installExecMock(resultsByCommand: Record<string, string | Error>) {
  execMock.mockImplementation((cmd: string, _opts: unknown, cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
    const callback = (typeof _opts === 'function' ? _opts : cb)!;
    const match = Object.entries(resultsByCommand).find(([needle]) => cmd.includes(needle));
    if (!match) {
      callback(new Error(`unexpected command: ${cmd}`));
      return;
    }
    const result = match[1];
    if (result instanceof Error) {
      callback(result);
      return;
    }
    callback(null, { stdout: result, stderr: '' });
  });
}

describe('cleanupSpawnAndOrphanedStashes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installExecMock({ 'git rev-list spawn-head..HEAD --count': '1\n' });
    mockIsOlderThanDays.mockReturnValue(false);
    mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'panopticon', projectPath: '/repo' } as any);
    mockGetProject.mockReturnValue(null);
    mockGetReviewStatus.mockReturnValue(null as any);
    mockLoadCloisterConfig.mockReturnValue({ monitoring: {} } as any);
    mockFindWorkspacePath.mockReturnValue('/repo/workspaces/feature-pan-879');
    mockListSessionNamesAsync.mockResolvedValue([]);
    mockSessionExists.mockReturnValue(false);
  });

  it('drops a pre-spawn stash after the agent branch has commits ahead of main', async () => {
    const state = {
      id: 'agent-pan-879',
      issueId: 'PAN-879',
      workspace: '/repo/workspaces/feature-pan-879',
      preSpawnStashRef: 'abc123def456abc123def456abc123def456abcd',
      preSpawnStashMessage: 'pre-spawn:PAN-879:2026-04-27T14:15:16Z',
      preSpawnBaselineHead: 'spawn-head',
    } as any;

    mockListRunningAgents.mockReturnValue([{ id: 'agent-pan-879', issueId: 'PAN-879' }] as any);
    mockGetAgentState.mockReturnValue(state);

    const actions = await cleanupSpawnAndOrphanedStashes(new Date('2026-04-27T15:00:00Z'));

    (await Effect.runPromise(expect(mockDropStash))).toHaveBeenCalledWith('/repo/workspaces/feature-pan-879', 'abc123def456abc123def456abc123def456abcd');
    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining('git rev-list spawn-head..HEAD --count'),
      expect.anything(),
      expect.any(Function),
    );
    expect(state.preSpawnStashRef).toBeUndefined();
    expect(state.preSpawnStashMessage).toBeUndefined();
    expect(state.preSpawnBaselineHead).toBeUndefined();
    expect(mockSaveAgentState).toHaveBeenCalledWith(state);
    expect(actions).toContain('Dropped pre-spawn stash for PAN-879');
  });

  it('drops old non-salvageable stashes but preserves salvageable ones', async () => {
    mockListRunningAgents.mockReturnValue([] as any);
    mockGetAgentState.mockReturnValue(null);
    (await Effect.runPromise(mockListStashes.mockResolvedValue([
      { ref: 'def456abc123def456abc123def456abc123def4', stackRef: 'stash@{1}', kind: 'pre-merge', issueId: 'PAN-879', createdAt: new Date('2026-03-01T00:00:00Z'), message: 'pre-merge:PAN-879:2026-03-01T00:00:00Z' } as any,
      { ref: 'bogusbogusbogusbogusbogusbogusbogusbogus', kind: 'pre-spawn', issueId: 'PAN-879', createdAt: new Date('2026-03-01T00:00:00Z'), message: 'pre-spawn:PAN-879:2026-03-01T00:00:00Z' } as any,
      { ref: 'fedcba654321fedcba654321fedcba654321fedc', stackRef: 'stash@{2}', kind: 'salvageable', issueId: 'PAN-879', createdAt: new Date('2026-03-01T00:00:00Z'), message: 'salvageable:PAN-879:2026-03-01T00:00:00Z:notes', shortDescription: 'notes' } as any,
    ])));
    mockIsOlderThanDays.mockImplementation((entry) => entry.kind === 'pre-merge' || entry.kind === 'pre-spawn');

    const actions = await cleanupSpawnAndOrphanedStashes(new Date('2026-04-27T15:00:00Z'));

    (await Effect.runPromise(expect(mockDropStash))).toHaveBeenCalledWith('/repo/workspaces/feature-pan-879', 'def456abc123def456abc123def456abc123def4', 'stash@{1}');
    (await Effect.runPromise(expect(mockDropStash))).toHaveBeenCalledWith('/repo/workspaces/feature-pan-879', 'bogusbogusbogusbogusbogusbogusbogusbogus', undefined);
    (await Effect.runPromise(expect(mockDropStash))).not.toHaveBeenCalledWith('/repo/workspaces/feature-pan-879', 'fedcba654321fedcba654321fedcba654321fedc');
    expect(actions).toContain('Dropped stale pre-merge stash for PAN-879: def456abc123def456abc123def456abc123def4');
  });

  it('preserves pre-merge stashes for non-github issues that are merely closed', async () => {
    mockListRunningAgents.mockReturnValue([] as any);
    mockGetAgentState.mockReturnValue(null);
    (await Effect.runPromise(mockListStashes.mockResolvedValue([
      { ref: '9999999999999999999999999999999999999999', stackRef: 'stash@{3}', kind: 'pre-merge', issueId: 'PAN-879', createdAt: new Date('2026-04-27T00:00:00Z'), message: 'pre-merge:PAN-879:2026-04-27T00:00:00Z' } as any,
    ])));
    mockGetProject.mockReturnValue({ tracker: 'linear' } as any);
    mockCreateTracker.mockReturnValue({ getIssue: vi.fn(async () => ({ state: 'closed' })) } as any);

    const actions = await cleanupSpawnAndOrphanedStashes(new Date('2026-04-27T15:00:00Z'));

    (await Effect.runPromise(expect(mockDropStash))).not.toHaveBeenCalledWith('/repo/workspaces/feature-pan-879', '9999999999999999999999999999999999999999', 'stash@{3}');
    expect(mockSetReviewStatus).not.toHaveBeenCalledWith('PAN-879', { mergeStatus: 'merged', readyForMerge: false, mergeNotes: undefined });
    expect(actions).not.toContain('Dropped merged issue pre-merge stash for PAN-879: 9999999999999999999999999999999999999999');
  });

  it('preserves pre-merge stashes for github issues that are merely closed', async () => {
    mockListRunningAgents.mockReturnValue([] as any);
    mockGetAgentState.mockReturnValue(null);
    (await Effect.runPromise(mockListStashes.mockResolvedValue([
      { ref: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', stackRef: 'stash@{4}', kind: 'pre-merge', issueId: 'PAN-879', createdAt: new Date('2026-04-27T00:00:00Z'), message: 'pre-merge:PAN-879:2026-04-27T00:00:00Z' } as any,
    ])));
    mockGetProject.mockReturnValue({ tracker: 'github', github_repo: 'owner/repo' } as any);

    const actions = await cleanupSpawnAndOrphanedStashes(new Date('2026-04-27T15:00:00Z'));

    expect(mockCreateTracker).not.toHaveBeenCalled();
    (await Effect.runPromise(expect(mockDropStash))).not.toHaveBeenCalledWith('/repo/workspaces/feature-pan-879', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'stash@{4}');
    expect(mockSetReviewStatus).not.toHaveBeenCalledWith('PAN-879', { mergeStatus: 'merged', readyForMerge: false, mergeNotes: undefined });
    expect(actions).not.toContain('Dropped merged issue pre-merge stash for PAN-879: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('keeps pre-spawn stash metadata when branch advancement check fails for an ambiguous error', async () => {
    const state = {
      id: 'agent-pan-879',
      issueId: 'PAN-879',
      workspace: '/repo/workspaces/feature-pan-879',
      preSpawnStashRef: 'abc123def456abc123def456abc123def456abcd',
      preSpawnStashMessage: 'pre-spawn:PAN-879:2026-04-27T14:15:16Z',
      preSpawnBaselineHead: 'spawn-head',
    } as any;

    installExecMock({});
    mockListRunningAgents.mockReturnValue([{ id: 'agent-pan-879', issueId: 'PAN-879' }] as any);
    mockGetAgentState.mockReturnValue(state);

    const actions = await cleanupSpawnAndOrphanedStashes(new Date('2026-04-27T15:00:00Z'));

    (await Effect.runPromise(expect(mockDropStash))).not.toHaveBeenCalled();
    expect(mockSaveAgentState).not.toHaveBeenCalled();
    expect(state.preSpawnStashRef).toBe('abc123def456abc123def456abc123def456abcd');
    expect(state.preSpawnBaselineHead).toBe('spawn-head');
    expect(actions).toEqual([]);
  });

  it('drops pre-spawn stash when the saved baseline ref no longer exists', async () => {
    const state = {
      id: 'agent-pan-879',
      issueId: 'PAN-879',
      workspace: '/repo/workspaces/feature-pan-879',
      preSpawnStashRef: 'abc123def456abc123def456abc123def456abcd',
      preSpawnStashMessage: 'pre-spawn:PAN-879:2026-04-27T14:15:16Z',
      preSpawnBaselineHead: 'spawn-head',
    } as any;

    installExecMock({
      'git rev-list spawn-head..HEAD --count': new Error('fatal: bad revision'),
    });
    mockListRunningAgents.mockReturnValue([{ id: 'agent-pan-879', issueId: 'PAN-879' }] as any);
    mockGetAgentState.mockReturnValue(state);

    const actions = await cleanupSpawnAndOrphanedStashes(new Date('2026-04-27T15:00:00Z'));

    (await Effect.runPromise(expect(mockDropStash))).toHaveBeenCalledWith('/repo/workspaces/feature-pan-879', 'abc123def456abc123def456abc123def456abcd');
    expect(mockSaveAgentState).toHaveBeenCalledWith(state);
    expect(state.preSpawnStashRef).toBeUndefined();
    expect(state.preSpawnStashMessage).toBeUndefined();
    expect(state.preSpawnBaselineHead).toBeUndefined();
    expect(actions).toContain('Dropped pre-spawn stash for PAN-879');
  });

  it('reads stash janitor cadence from cloister monitoring config', () => {
    mockLoadCloisterConfig.mockReturnValue({
      monitoring: { stash_janitor_every_cycles: 7 },
    } as any);

    expect(loadConfig().stashJanitorEveryCycles).toBe(7);
  });

  it('allows disabling stash janitor via zero cadence', () => {
    mockLoadCloisterConfig.mockReturnValue({
      monitoring: { stash_janitor_every_cycles: 0 },
    } as any);

    expect(loadConfig().stashJanitorEveryCycles).toBe(0);
  });

  it('logs non-canonical stashes on startup without deleting them', async () => {
    (await Effect.runPromise(mockListStashes.mockResolvedValue([
      { ref: 'stash@{5}', kind: 'unknown', issueId: undefined, message: 'legacy stash name' } as any,
    ])));

    const actions = await logNonCanonicalStashesOnStartup();

    (await Effect.runPromise(expect(mockDropStash))).not.toHaveBeenCalled();
    expect(actions[0]).toContain('Non-canonical stash in PAN-879');
    expect(actions[0]).toContain('audit recommended');
  });
});

describe('cleanupOrphanedReviewSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSessionNamesAsync.mockResolvedValue([]);
    mockSessionExists.mockReturnValue(false);
  });

  it('kills orphaned canonical reviewer sessions', async () => {
    (await Effect.runPromise(mockListSessionNamesAsync.mockResolvedValue([
      'specialist-panopticon-PAN-879-review-correctness',
      'specialist-panopticon-PAN-879-review-synthesis',
    ])));

    const actions = await cleanupOrphanedReviewSessions();

    (await Effect.runPromise(expect(mockKillSessionAsync))).toHaveBeenCalledTimes(2);
    (await Effect.runPromise(expect(mockKillSessionAsync))).toHaveBeenCalledWith('specialist-panopticon-PAN-879-review-correctness');
    (await Effect.runPromise(expect(mockKillSessionAsync))).toHaveBeenCalledWith('specialist-panopticon-PAN-879-review-synthesis');
    expect(actions).toEqual([
      'Killed orphaned specialist-panopticon-PAN-879-review-correctness (synthesis agent-pan-879-review and work agent-pan-879 not running)',
      'Killed orphaned specialist-panopticon-PAN-879-review-synthesis (synthesis agent-pan-879-review and work agent-pan-879 not running)',
    ]);
  });

  it('kills orphaned PAN-1059 convoy reviewer sessions', async () => {
    (await Effect.runPromise(mockListSessionNamesAsync.mockResolvedValue([
      'agent-pan-879-review-security',
      'agent-pan-879-review-correctness',
      'agent-pan-879-review-performance',
      'agent-pan-879-review-requirements',
    ])));

    const actions = await cleanupOrphanedReviewSessions();

    (await Effect.runPromise(expect(mockKillSessionAsync))).toHaveBeenCalledTimes(4);
    expect(actions).toHaveLength(4);
    expect(actions[0]).toContain('agent-pan-879-review-security');
  });

  it('keeps canonical reviewer sessions when the work agent still exists', async () => {
    (await Effect.runPromise(mockListSessionNamesAsync.mockResolvedValue([
      'specialist-panopticon-PAN-879-review-correctness',
    ])));
    mockSessionExists.mockImplementation((name: string) => name === 'agent-pan-879');

    const actions = await cleanupOrphanedReviewSessions();

    (await Effect.runPromise(expect(mockKillSessionAsync))).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });
});

describe('monitorReviewConvoySignals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionExistsAsync.mockImplementation(async (name: string) => name === 'agent-pan-879-review');
  });

  it('signals synthesis when a reviewer disappears before writing output', async () => {
    const fs = await import('fs');
    const agents = await import('../../../lib/agents.js');
    vi.mocked(fs.readdirSync).mockReturnValue(['agent-pan-879-review-security'] as any);
    vi.mocked(fs.existsSync).mockImplementation((path: any) => String(path) === '/tmp/test-agents');
    vi.mocked(agents.getAgentStateSync).mockReturnValue({
      id: 'agent-pan-879-review-security',
      issueId: 'PAN-879',
      workspace: '/workspace',
      role: 'review',
      model: 'model',
      status: 'running',
      startedAt: '2026-05-13T00:00:00.000Z',
      reviewSubRole: 'security',
      reviewRunId: 'agent-pan-879-review-abcdef12',
      reviewOutputPath: '/tmp/test-agents/agent-pan-879-review-security/review-security.md',
      reviewSynthesisAgentId: 'agent-pan-879-review',
    } as any);

    const actions = await monitorReviewConvoySignals();

    expect(agents.messageAgent).toHaveBeenCalledWith(
      'agent-pan-879-review',
      'REVIEWER_FAILED security reviewer launcher process died before signaling synthesis',
    );
    expect(agents.saveAgentStateSync).toHaveBeenCalledWith(expect.objectContaining({
      reviewMonitorSignaled: 'failed',
    }));
    expect(actions).toEqual([
      'Signaled REVIEWER_FAILED security reviewer launcher process died before signaling synthesis to agent-pan-879-review',
    ]);
  });

  it('does not treat stale reviewer output from a previous run as ready', async () => {
    const fs = await import('fs');
    const agents = await import('../../../lib/agents.js');
    const outputPath = '/tmp/test-agents/agent-pan-879-review-security/review-security.md';
    vi.mocked(fs.readdirSync).mockReturnValue(['agent-pan-879-review-security'] as any);
    vi.mocked(fs.existsSync).mockImplementation((path: any) => String(path) === '/tmp/test-agents' || String(path) === outputPath);
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: Date.parse('2026-05-12T00:00:00.000Z') } as any);
    vi.mocked(agents.getAgentStateSync).mockReturnValue({
      id: 'agent-pan-879-review-security',
      issueId: 'PAN-879',
      workspace: '/workspace',
      role: 'review',
      model: 'model',
      status: 'running',
      startedAt: '2026-05-13T00:00:00.000Z',
      reviewSubRole: 'security',
      reviewRunId: 'agent-pan-879-review-abcdef12',
      reviewOutputPath: outputPath,
      reviewSynthesisAgentId: 'agent-pan-879-review',
    } as any);

    await monitorReviewConvoySignals();

    expect(agents.messageAgent).toHaveBeenCalledWith(
      'agent-pan-879-review',
      'REVIEWER_FAILED security reviewer launcher process died before signaling synthesis',
    );
    expect(agents.saveAgentStateSync).toHaveBeenCalledWith(expect.objectContaining({
      reviewMonitorSignaled: 'failed',
    }));
    expect(agents.saveAgentStateSync).not.toHaveBeenCalledWith(expect.objectContaining({
      reviewMonitorSignaled: 'ready',
    }));
  });

  it('signals ready only for reviewer output written after the current run started', async () => {
    const fs = await import('fs');
    const agents = await import('../../../lib/agents.js');
    const outputPath = '/tmp/test-agents/agent-pan-879-review-security/review-security.md';
    vi.mocked(fs.readdirSync).mockReturnValue(['agent-pan-879-review-security'] as any);
    vi.mocked(fs.existsSync).mockImplementation((path: any) => String(path) === '/tmp/test-agents' || String(path) === outputPath);
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: Date.parse('2026-05-13T00:00:01.000Z') } as any);
    vi.mocked(agents.getAgentStateSync).mockReturnValue({
      id: 'agent-pan-879-review-security',
      issueId: 'PAN-879',
      workspace: '/workspace',
      role: 'review',
      model: 'model',
      status: 'stopped',
      startedAt: '2026-05-13T00:00:00.000Z',
      reviewSubRole: 'security',
      reviewRunId: 'agent-pan-879-review-abcdef12',
      reviewOutputPath: outputPath,
      reviewSynthesisAgentId: 'agent-pan-879-review',
    } as any);

    const actions = await monitorReviewConvoySignals();

    expect(agents.messageAgent).toHaveBeenCalledWith(
      'agent-pan-879-review',
      `REVIEWER_READY security ${outputPath}`,
    );
    expect(agents.saveAgentStateSync).toHaveBeenCalledWith(expect.objectContaining({
      reviewMonitorSignaled: 'ready',
    }));
    expect(actions).toEqual([
      `Signaled REVIEWER_READY security ${outputPath} to agent-pan-879-review`,
    ]);
  });
});
