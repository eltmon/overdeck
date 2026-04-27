import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/agents.js', () => ({
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
  SpecialistType: {},
  getTmuxSessionName: vi.fn((t: string) => `specialist-${t}`),
  isRunning: vi.fn(async () => false),
  getAllProjectSpecialistStatuses: vi.fn(async () => []),
}));
vi.mock('../config.js', () => ({
  loadCloisterConfig: vi.fn(() => ({
    monitoring: {},
  })),
}));
vi.mock('../../../lib/tmux.js', () => ({
  buildTmuxCommandString: vi.fn(() => 'tmux'),
  capturePaneAsync: vi.fn(async () => ''),
  createSessionAsync: vi.fn(async () => {}),
  killSession: vi.fn(),
  killSessionAsync: vi.fn(async () => {}),
  listPaneValues: vi.fn(() => []),
  listPaneValuesAsync: vi.fn(async () => []),
  listSessionNamesAsync: vi.fn(async () => []),
  sessionExists: vi.fn(() => false),
  sessionExistsAsync: vi.fn(async () => false),
  sendKeysAsync: vi.fn(async () => {}),
}));
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

import { cleanupOrphanedReviewSessions, cleanupSpawnAndOrphanedStashes, loadConfig, logNonCanonicalStashesOnStartup } from '../deacon.js';
import { listRunningAgents, getAgentState, saveAgentState } from '../../../lib/agents.js';
import { dropStash, isOlderThanDays, listStashes } from '../../../lib/stashes.js';
import { resolveProjectFromIssue, getProject } from '../../projects.js';
import { findWorkspacePath } from '../../lifecycle/archive-planning.js';
import { getReviewStatus, setReviewStatus } from '../../review-status.js';
import { createTracker } from '../../tracker/factory.js';
import { loadCloisterConfig } from '../config.js';
import { listSessionNamesAsync, killSessionAsync, sessionExists } from '../../../lib/tmux.js';

const mockListRunningAgents = vi.mocked(listRunningAgents);
const mockGetAgentState = vi.mocked(getAgentState);
const mockSaveAgentState = vi.mocked(saveAgentState);
const mockListSessionNamesAsync = vi.mocked(listSessionNamesAsync);
const mockKillSessionAsync = vi.mocked(killSessionAsync);
const mockSessionExists = vi.mocked(sessionExists);
const mockDropStash = vi.mocked(dropStash);
const mockIsOlderThanDays = vi.mocked(isOlderThanDays);
const mockListStashes = vi.mocked(listStashes);
const mockResolveProjectFromIssue = vi.mocked(resolveProjectFromIssue);
const mockGetProject = vi.mocked(getProject);
const mockFindWorkspacePath = vi.mocked(findWorkspacePath);
const mockGetReviewStatus = vi.mocked(getReviewStatus);
const mockSetReviewStatus = vi.mocked(setReviewStatus);
const mockCreateTracker = vi.mocked(createTracker);
const mockLoadCloisterConfig = vi.mocked(loadCloisterConfig);

function installExecMock(stdoutByCommand: Record<string, string>) {
  execMock.mockImplementation((cmd: string, _opts: unknown, cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
    const callback = (typeof _opts === 'function' ? _opts : cb)!;
    const match = Object.entries(stdoutByCommand).find(([needle]) => cmd.includes(needle));
    if (!match) {
      callback(new Error(`unexpected command: ${cmd}`));
      return;
    }
    callback(null, { stdout: match[1], stderr: '' });
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

    expect(mockDropStash).toHaveBeenCalledWith('/repo/workspaces/feature-pan-879', 'abc123def456abc123def456abc123def456abcd');
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
    mockListStashes.mockResolvedValue([
      { ref: 'def456abc123def456abc123def456abc123def4', stackRef: 'stash@{1}', kind: 'pre-merge', issueId: 'PAN-879', createdAt: new Date('2026-03-01T00:00:00Z'), message: 'pre-merge:PAN-879:2026-03-01T00:00:00Z' } as any,
      { ref: 'bogusbogusbogusbogusbogusbogusbogusbogus', kind: 'pre-spawn', issueId: 'PAN-879', createdAt: new Date('2026-03-01T00:00:00Z'), message: 'pre-spawn:PAN-879:2026-03-01T00:00:00Z' } as any,
      { ref: 'fedcba654321fedcba654321fedcba654321fedc', stackRef: 'stash@{2}', kind: 'salvageable', issueId: 'PAN-879', createdAt: new Date('2026-03-01T00:00:00Z'), message: 'salvageable:PAN-879:2026-03-01T00:00:00Z:notes', shortDescription: 'notes' } as any,
    ]);
    mockIsOlderThanDays.mockImplementation((entry) => entry.kind === 'pre-merge' || entry.kind === 'pre-spawn');

    const actions = await cleanupSpawnAndOrphanedStashes(new Date('2026-04-27T15:00:00Z'));

    expect(mockDropStash).toHaveBeenCalledWith('/repo/workspaces/feature-pan-879', 'def456abc123def456abc123def456abc123def4');
    expect(mockDropStash).not.toHaveBeenCalledWith('/repo/workspaces/feature-pan-879', 'bogusbogusbogusbogusbogusbogusbogusbogus');
    expect(mockDropStash).not.toHaveBeenCalledWith('/repo/workspaces/feature-pan-879', 'fedcba654321fedcba654321fedcba654321fedc');
    expect(actions).toContain('Dropped stale pre-merge stash for PAN-879: def456abc123def456abc123def456abc123def4');
  });

  it('drops pre-merge stashes immediately when tracker state shows the issue is already merged', async () => {
    mockListRunningAgents.mockReturnValue([] as any);
    mockGetAgentState.mockReturnValue(null);
    mockListStashes.mockResolvedValue([
      { ref: '9999999999999999999999999999999999999999', stackRef: 'stash@{3}', kind: 'pre-merge', issueId: 'PAN-879', createdAt: new Date('2026-04-27T00:00:00Z'), message: 'pre-merge:PAN-879:2026-04-27T00:00:00Z' } as any,
    ]);
    mockGetProject.mockReturnValue({ tracker: 'linear' } as any);
    mockCreateTracker.mockReturnValue({ getIssue: vi.fn(async () => ({ state: 'closed' })) } as any);

    const actions = await cleanupSpawnAndOrphanedStashes(new Date('2026-04-27T15:00:00Z'));

    expect(mockDropStash).toHaveBeenCalledWith('/repo/workspaces/feature-pan-879', '9999999999999999999999999999999999999999');
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-879', { mergeStatus: 'merged', readyForMerge: false, mergeNotes: undefined });
    expect(actions).toContain('Dropped merged issue pre-merge stash for PAN-879: 9999999999999999999999999999999999999999');
  });

  it('keeps pre-spawn stash metadata when branch advancement check fails', async () => {
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

    expect(mockDropStash).not.toHaveBeenCalled();
    expect(mockSaveAgentState).not.toHaveBeenCalled();
    expect(state.preSpawnStashRef).toBe('abc123def456abc123def456abc123def456abcd');
    expect(state.preSpawnBaselineHead).toBe('spawn-head');
    expect(actions).toEqual([]);
  });

  it('preserves pre-spawn stash when baseline head is missing', async () => {
    const state = {
      id: 'agent-pan-879',
      issueId: 'PAN-879',
      workspace: '/repo/workspaces/feature-pan-879',
      preSpawnStashRef: 'abc123def456abc123def456abc123def456abcd',
      preSpawnStashMessage: 'pre-spawn:PAN-879:2026-04-27T14:15:16Z',
    } as any;

    mockListRunningAgents.mockReturnValue([{ id: 'agent-pan-879', issueId: 'PAN-879' }] as any);
    mockGetAgentState.mockReturnValue(state);

    const actions = await cleanupSpawnAndOrphanedStashes(new Date('2026-04-27T15:00:00Z'));

    expect(mockDropStash).not.toHaveBeenCalled();
    expect(mockSaveAgentState).not.toHaveBeenCalled();
    expect(execMock).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
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
    mockListStashes.mockResolvedValue([
      { ref: 'stash@{5}', kind: 'unknown', issueId: undefined, message: 'legacy stash name' } as any,
    ]);

    const actions = await logNonCanonicalStashesOnStartup();

    expect(mockDropStash).not.toHaveBeenCalled();
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
    mockListSessionNamesAsync.mockResolvedValue([
      'specialist-panopticon-PAN-879-review-correctness',
      'specialist-panopticon-PAN-879-review-synthesis',
      'specialist-panopticon-PAN-879-review-coordinator',
    ]);

    const actions = await cleanupOrphanedReviewSessions();

    expect(mockKillSessionAsync).toHaveBeenCalledTimes(2);
    expect(mockKillSessionAsync).toHaveBeenCalledWith('specialist-panopticon-PAN-879-review-correctness');
    expect(mockKillSessionAsync).toHaveBeenCalledWith('specialist-panopticon-PAN-879-review-synthesis');
    expect(mockKillSessionAsync).not.toHaveBeenCalledWith('specialist-panopticon-PAN-879-review-coordinator');
    expect(actions).toEqual([
      'Killed orphaned specialist-panopticon-PAN-879-review-correctness (work agent agent-pan-879 not running)',
      'Killed orphaned specialist-panopticon-PAN-879-review-synthesis (work agent agent-pan-879 not running)',
    ]);
  });

  it('keeps canonical reviewer sessions when the work agent still exists', async () => {
    mockListSessionNamesAsync.mockResolvedValue([
      'specialist-panopticon-PAN-879-review-correctness',
    ]);
    mockSessionExists.mockImplementation((name: string) => name === 'agent-pan-879');

    const actions = await cleanupOrphanedReviewSessions();

    expect(mockKillSessionAsync).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });
});
