/**
 * PAN-653: Deacon must not poke or respawn workspaces marked stuck.
 *
 * When review_status.stuck=true for a workspace, patrolWorkAgentResolutions
 * and checkStuckWorkAgents must skip all poke/respawn actions for that issueId.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all external dependencies before importing the module under test
vi.mock('../../../lib/agents.js', () => ({
  listRunningAgents: vi.fn(),
  getAgentRuntimeState: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  getAgentDir: vi.fn(),
  getAgentState: vi.fn(),
  saveAgentState: vi.fn(),
  saveSessionId: vi.fn(),
}));

vi.mock('../../../lib/review-status.js', () => ({
  setReviewStatus: vi.fn(),
  loadReviewStatuses: vi.fn(() => ({})),
  getReviewStatus: vi.fn(),
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

vi.mock('../specialists.js', () => ({
  getTmuxSessionName: vi.fn((t: string) => `specialist-${t}`),
  isRunning: vi.fn(async () => false),
  checkSpecialistQueue: vi.fn(() => ({ hasWork: false, items: [] })),
  completeSpecialistTask: vi.fn(),
  getAllProjectSpecialistStatuses: vi.fn(() => []),
}));

vi.mock('../config.js', () => ({
  loadCloisterConfig: vi.fn(() => ({})),
}));

vi.mock('../../paths.js', () => ({
  PANOPTICON_HOME: '/tmp/test-panopticon',
  AGENTS_DIR: '/tmp/test-agents',
  PROJECT_PRDS_ACTIVE_SUBDIR: 'active',
  PROJECT_PRDS_PLANNED_SUBDIR: 'planned',
  PROJECT_PRDS_COMPLETED_SUBDIR: 'completed',
}));

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

import { existsSync, readFileSync } from 'fs';
import { isSynthesisForActiveReviewRun, patrolWorkAgentResolutions } from '../deacon.js';
import { listRunningAgents, getAgentRuntimeState } from '../../../lib/agents.js';
import { getReviewStatus } from '../../../lib/review-status.js';
import { sendKeysAsync } from '../../../lib/tmux.js';

const mockListRunningAgents = vi.mocked(listRunningAgents);
const mockGetAgentRuntimeState = vi.mocked(getAgentRuntimeState);
const mockGetReviewStatus = vi.mocked(getReviewStatus);
const mockSendKeysAsync = vi.mocked(sendKeysAsync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe('review synthesis recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('{}');
  });

  it('rejects synthesis files from before the active review spawn', () => {
    const activeSpawn = Date.parse('2026-05-17T01:04:23.422Z');

    expect(isSynthesisForActiveReviewRun('/tmp/old-review', {
      reviewSpawnedAt: '2026-05-17T01:04:23.422Z',
      lastVerifiedCommit: 'ca82f38f407ffa1847911ab490c72e7a064df22a',
    }, activeSpawn - 60_000)).toBe(false);

    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('rejects synthesis files whose context belongs to an older review run', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      generatedAt: '2026-05-17T00:24:19.250Z',
      headSha: '35b1e85155383b75f653506c0eebdaa153603b27',
    }));

    expect(isSynthesisForActiveReviewRun('/tmp/old-review', {
      reviewSpawnedAt: '2026-05-17T01:04:23.422Z',
      lastVerifiedCommit: 'ca82f38f407ffa1847911ab490c72e7a064df22a',
    }, Date.parse('2026-05-17T01:10:00.000Z'))).toBe(false);
  });

  it('accepts synthesis files from the active verified review head', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      generatedAt: '2026-05-17T01:04:23.634Z',
      headSha: 'ca82f38f407ffa1847911ab490c72e7a064df22a',
    }));

    expect(isSynthesisForActiveReviewRun('/tmp/current-review', {
      reviewSpawnedAt: '2026-05-17T01:04:23.422Z',
      lastVerifiedCommit: 'ca82f38f407ffa1847911ab490c72e7a064df22a',
    }, Date.parse('2026-05-17T01:10:00.000Z'))).toBe(true);
  });
});

describe('patrolWorkAgentResolutions — stuck workspace skip (PAN-653)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('{}');
  });

  it('produces zero poke/respawn actions for a stuck workspace', async () => {
    // Agent is in "stuck" resolution state with 3+ counts (would normally get poked)
    mockListRunningAgents.mockReturnValue([
      {
        id: 'agent-pan-653',
        issueId: 'PAN-653',
        tmuxActive: true,
        pid: 1234,
        workspace: '/tmp/workspace',
        startedAt: new Date().toISOString(),
      },
    ] as ReturnType<typeof listRunningAgents>);

    mockGetAgentRuntimeState.mockReturnValue({
      resolution: 'stuck',
      resolutionCount: 5,
      resolutionUpdatedAt: new Date().toISOString(),
      state: 'active',
      lastActivity: new Date().toISOString(),
    } as ReturnType<typeof getAgentRuntimeState>);

    // Workspace is marked stuck — Deacon must skip it
    mockGetReviewStatus.mockReturnValue({
      issueId: 'PAN-653',
      reviewStatus: 'passed',
      testStatus: 'passed',
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
      stuck: true,
      stuckReason: 'main_diverged',
    });

    const actions = await patrolWorkAgentResolutions();

    // No poke or respawn actions should have been taken
    expect(actions).toHaveLength(0);
    expect(mockSendKeysAsync).not.toHaveBeenCalled();
  });

  it('still pokes non-stuck workspace in stuck resolution state', async () => {
    mockListRunningAgents.mockReturnValue([
      {
        id: 'agent-pan-000',
        issueId: 'PAN-000',
        tmuxActive: true,
        pid: 1234,
        workspace: '/tmp/workspace',
        startedAt: new Date().toISOString(),
      },
    ] as ReturnType<typeof listRunningAgents>);

    mockGetAgentRuntimeState.mockReturnValue({
      resolution: 'stuck',
      resolutionCount: 5,
      resolutionUpdatedAt: new Date().toISOString(),
      state: 'active',
      lastActivity: new Date().toISOString(),
    } as ReturnType<typeof getAgentRuntimeState>);

    // Workspace is NOT stuck — Deacon should poke normally
    mockGetReviewStatus.mockReturnValue({
      issueId: 'PAN-000',
      reviewStatus: 'passed',
      testStatus: 'passed',
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
      stuck: false,
    });

    await patrolWorkAgentResolutions();

    // sendKeysAsync should have been called for the poke
    expect(mockSendKeysAsync).toHaveBeenCalledOnce();
  });

  it('skips done auto-complete for a stuck workspace', async () => {
    mockListRunningAgents.mockReturnValue([
      {
        id: 'agent-pan-653',
        issueId: 'PAN-653',
        tmuxActive: true,
        pid: 1234,
        workspace: '/tmp/workspace',
        startedAt: new Date().toISOString(),
      },
    ] as ReturnType<typeof listRunningAgents>);

    mockGetAgentRuntimeState.mockReturnValue({
      resolution: 'done',
      resolutionCount: 3, // would normally trigger auto-complete
      resolutionUpdatedAt: new Date().toISOString(),
      state: 'active',
      lastActivity: new Date().toISOString(),
    } as ReturnType<typeof getAgentRuntimeState>);

    mockGetReviewStatus.mockReturnValue({
      issueId: 'PAN-653',
      reviewStatus: 'passed',
      testStatus: 'passed',
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
      stuck: true,
      stuckReason: 'main_diverged',
    });

    const actions = await patrolWorkAgentResolutions();

    // No auto-complete action should have fired
    expect(actions).toHaveLength(0);
  });
});
