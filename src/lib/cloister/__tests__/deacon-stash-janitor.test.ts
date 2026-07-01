import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawnReviewSubRole = vi.hoisted(() => vi.fn());
vi.mock('../review-agent.js', () => ({
  spawnReviewSubRoleForIssue: mockSpawnReviewSubRole,
}));

const mockDeliverReviewVerdictFeedback = vi.hoisted(() => vi.fn());
vi.mock('../review-verdict-feedback.js', async () => {
  const { Effect } = await import('effect');
  mockDeliverReviewVerdictFeedback.mockImplementation(() => Effect.succeed({
    prCommentPosted: false,
    agentMessageSent: false,
  }));
  return {
    deliverReviewVerdictFeedback: mockDeliverReviewVerdictFeedback,
  };
});

vi.mock('../../../lib/agents.js', () => ({
  messageAgent: vi.fn(async () => {}),
  listRunningAgents: vi.fn(),
  listRunningAgentsSync: vi.fn(),
  getAgentRuntimeState: vi.fn(),
  getAgentRuntimeStateSync: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  getAgentDir: vi.fn(),
  getAgentState: vi.fn(() => Effect.succeed(null)),
  getAgentStateSync: vi.fn(),
  saveAgentState: vi.fn(),
  saveAgentStateSync: vi.fn(),
  resumeAgent: vi.fn(),
}));

vi.mock('../../../lib/review-status.js', () => ({
  setReviewStatus: vi.fn(),
  setReviewStatusSync: vi.fn(),
  loadReviewStatuses: vi.fn(() => ({})),
  getReviewStatusSync: vi.fn(() => undefined),
  getReviewStatus: vi.fn(),
  getReviewStatusSync: vi.fn(),
}));

vi.mock('../../overdeck/review-status-sync.js', () => ({ markWorkspaceStuck: vi.fn(), clearWorkspaceStuck: vi.fn() }));
vi.mock('../../overdeck/control-settings.js', () => ({ isDeaconGloballyPaused: vi.fn(() => false) }));
vi.mock('../../overdeck/agents.js', () => ({ listAllAgentsSync: vi.fn(() => []) }));
vi.mock('../../shadow-state.js', () => ({ getShadowState: vi.fn(async () => null) }));
vi.mock('../../projects.js', () => ({ resolveProjectFromIssue: vi.fn(), resolveProjectFromIssueSync: vi.fn(), listProjects: vi.fn(() => [{ config: { path: '/repo' } }]), listProjectsSync: vi.fn(() => [{ config: { path: '/repo' } }]), getProject: vi.fn(() => null), getProjectSync: vi.fn(() => null) }));
vi.mock('../../lifecycle/archive-planning.js', () => ({ findWorkspacePath: vi.fn() }));
vi.mock('../../persistent-logger.js', () => ({ logDeaconEvent: vi.fn(), logDeaconEventSync: vi.fn(), logAgentLifecycle: vi.fn() }));
vi.mock('../../activity-logger.js', () => ({ emitActivityEntry: vi.fn(), emitActivityEntrySync: vi.fn(), emitActivityTts: vi.fn(), emitActivityTtsSync: vi.fn() }));
vi.mock('../../config.js', async (importActual) => ({
  ...(await importActual<typeof import('../../config.js')>()),
  loadConfig: vi.fn(() => ({ trackers: { primary: 'linear', linear: { type: 'linear', api_key_env: 'LINEAR_API_KEY' } } })),
}));
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
  loadCloisterConfigSync: vi.fn(() => ({
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
  killSessionSync: vi.fn(),
  killSession: effectMock(undefined),
  listPaneValues: vi.fn(() => []),
  listPaneValues: effectMock([]),
  listSessionNames: effectMock([]),
  sessionExists: vi.fn(() => false),
  sessionExistsSync: vi.fn(() => false),
  sessionExists: effectMock(false),
  sendKeysProgram: effectMock(undefined),
  isPaneDead: effectMock(false),
  };
});
vi.mock('../../paths.js', () => ({
  getOverdeckHome: () => '/tmp/test-overdeck',
  OVERDECK_HOME: '/tmp/test-overdeck',
  AGENTS_DIR: '/tmp/test-agents',
  COSTS_DIR: '/tmp/test-costs',
  packageRoot: '/tmp/test-package-root',
  PROJECT_DOCS_SUBDIR: 'docs',
  PROJECT_PRDS_SUBDIR: 'prds',
  PROJECT_PRDS_ACTIVE_SUBDIR: 'active',
  PROJECT_PRDS_PLANNED_SUBDIR: 'planned',
  PROJECT_PRDS_COMPLETED_SUBDIR: 'completed',
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

import { checkInspectAgentTimeouts, cleanupOrphanedReviewSessions, monitorReviewConvoySignals } from '../deacon.js';
import { spawnReviewSubRoleForIssue } from '../review-agent.js';
import { getAgentStateSync, getAgentRuntimeStateSync, messageAgent, saveAgentStateSync } from '../../../lib/agents.js';
import { getReviewStatusSync, setReviewStatusSync } from '../../review-status.js';
import { listSessionNames, killSession, sessionExistsSync, sessionExists, isPaneDead, capturePane } from '../../../lib/tmux.js';

const mockGetAgentState = vi.mocked(getAgentStateSync);
const mockGetAgentRuntimeState = vi.mocked(getAgentRuntimeStateSync);
const mockMessageAgent = vi.mocked(messageAgent);
const mockSaveAgentState = vi.mocked(saveAgentStateSync);
const mockListSessionNamesAsync = vi.mocked(listSessionNames);
const mockKillSessionAsync = vi.mocked(killSession);
const mockSessionExists = vi.mocked(sessionExistsSync);
const mockSessionExistsAsync = vi.mocked(sessionExists);
const mockIsPaneDead = vi.mocked(isPaneDead);
const mockCapturePane = vi.mocked(capturePane);
const mockGetReviewStatus = vi.mocked(getReviewStatusSync);
const mockSetReviewStatus = vi.mocked(setReviewStatusSync);


describe('cleanupOrphanedReviewSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSessionNamesAsync.mockReturnValue(Effect.succeed([]) as any);
    mockSessionExists.mockReturnValue(false);
  });

  it('kills orphaned canonical reviewer sessions', async () => {
    mockListSessionNamesAsync.mockReturnValue(Effect.succeed([
      'specialist-overdeck-PAN-879-review-correctness',
      'specialist-overdeck-PAN-879-review-synthesis',
    ]) as any);

    const actions = await cleanupOrphanedReviewSessions();

    expect(mockKillSessionAsync).toHaveBeenCalledTimes(2);
    expect(mockKillSessionAsync).toHaveBeenCalledWith('specialist-overdeck-PAN-879-review-correctness');
    expect(mockKillSessionAsync).toHaveBeenCalledWith('specialist-overdeck-PAN-879-review-synthesis');
    expect(actions).toEqual([
      'Killed orphaned specialist-overdeck-PAN-879-review-correctness (synthesis agent-pan-879-review and work agent-pan-879 not running)',
      'Killed orphaned specialist-overdeck-PAN-879-review-synthesis (synthesis agent-pan-879-review and work agent-pan-879 not running)',
    ]);
  });

  it('kills orphaned PAN-1059 convoy reviewer sessions', async () => {
    mockListSessionNamesAsync.mockReturnValue(Effect.succeed([
      'agent-pan-879-review-security',
      'agent-pan-879-review-correctness',
      'agent-pan-879-review-performance',
      'agent-pan-879-review-requirements',
    ]) as any);

    const actions = await cleanupOrphanedReviewSessions();

    expect(mockKillSessionAsync).toHaveBeenCalledTimes(4);
    expect(actions).toHaveLength(4);
    expect(actions[0]).toContain('agent-pan-879-review-security');
  });

  it('keeps canonical reviewer sessions when the work agent still exists', async () => {
    mockListSessionNamesAsync.mockReturnValue(Effect.succeed([
      'specialist-overdeck-PAN-879-review-correctness',
    ]) as any);
    mockSessionExists.mockImplementation((name: string) => name === 'agent-pan-879');

    const actions = await cleanupOrphanedReviewSessions();

    expect(mockKillSessionAsync).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });
});

describe('monitorReviewConvoySignals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionExistsAsync.mockImplementation((name: string) => Effect.succeed(name === 'agent-pan-879-review') as any);
    mockSpawnReviewSubRole.mockReturnValue(Effect.succeed({ success: true, message: 'respawned', sessionId: 'agent-pan-879-review-security' }) as any);
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
      'REVIEWER_FAILED security reviewer session ended before writing a report',
    );
    expect(agents.saveAgentStateSync).toHaveBeenCalledWith(expect.objectContaining({
      reviewMonitorSignaled: 'failed',
    }));
    expect(actions).toEqual([
      'Signaled REVIEWER_FAILED security reviewer session ended before writing a report to agent-pan-879-review',
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
      'REVIEWER_FAILED security reviewer session ended before writing a report',
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

  it('nudges synthesis when all reviewer reports are present but no synthesis was written', async () => {
    const fs = await import('fs');
    const agents = await import('../../../lib/agents.js');
    const runId = 'agent-pan-879-review-abcdef12';
    const reviewDir = `/workspace/.pan/review/${runId}`;
    vi.mocked(fs.readdirSync).mockReturnValue(['agent-pan-879-review'] as any);
    vi.mocked(fs.existsSync).mockImplementation((path: any) => {
      const value = String(path);
      return value === '/tmp/test-agents'
        || value === `${reviewDir}/security.md`
        || value === `${reviewDir}/correctness.md`
        || value === `${reviewDir}/performance.md`
        || value === `${reviewDir}/requirements.md`;
    });
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: Date.parse('2026-05-13T00:00:01.000Z') } as any);
    vi.mocked(agents.getAgentStateSync).mockReturnValue({
      id: 'agent-pan-879-review',
      issueId: 'PAN-879',
      workspace: '/workspace',
      role: 'review',
      model: 'model',
      status: 'running',
      startedAt: '2026-05-13T00:00:00.000Z',
      reviewRunId: runId,
    } as any);
    mockGetReviewStatus.mockReturnValue({ issueId: 'PAN-879', reviewStatus: 'reviewing' } as any);
    mockSessionExistsAsync.mockImplementation((name: string) =>
      Effect.succeed(name === 'agent-pan-879-review') as any,
    );
    mockIsPaneDead.mockReturnValue(Effect.succeed(false) as any);

    const actions = await monitorReviewConvoySignals();

    expect(agents.messageAgent).toHaveBeenCalledWith(
      'agent-pan-879-review',
      expect.stringContaining(`REVIEWER_READY security ${reviewDir}/security.md`),
    );
    expect(agents.messageAgent).toHaveBeenCalledWith(
      'agent-pan-879-review',
      expect.stringContaining(`REVIEWER_READY requirements ${reviewDir}/requirements.md`),
    );
    expect(actions).toEqual([
      'Nudged agent-pan-879-review to synthesize from 4 reviewer reports',
    ]);
  });

  it('synthesizes directly from reviewer reports when the parent is unavailable', async () => {
    const fs = await import('fs');
    const agents = await import('../../../lib/agents.js');
    const runId = 'agent-pan-880-review-abcdef12';
    const reviewDir = `/workspace/.pan/review/${runId}`;
    const reportBodies: Record<string, string> = {
      [`${reviewDir}/security.md`]: [
        '# Security Review',
        '',
        '## Findings',
        'None',
      ].join('\n'),
      [`${reviewDir}/correctness.md`]: [
        '# Correctness Review',
        '',
        '## Findings',
        '',
        '### ! Missing null check — `src/example.ts:42`',
        '**Problem:** changed code can crash.',
      ].join('\n'),
      [`${reviewDir}/performance.md`]: [
        '# Performance Review',
        '',
        '## Findings',
        'None',
      ].join('\n'),
      [`${reviewDir}/requirements.md`]: [
        '# Requirements Review',
        '',
        '## Findings',
        'None',
      ].join('\n'),
    };
    vi.mocked(fs.readdirSync).mockReturnValue(['agent-pan-880-review'] as any);
    vi.mocked(fs.existsSync).mockImplementation((path: any) => {
      const value = String(path);
      return value === '/tmp/test-agents'
        || Object.prototype.hasOwnProperty.call(reportBodies, value);
    });
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => reportBodies[String(path)] ?? '{}');
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: Date.parse('2026-05-13T00:00:01.000Z') } as any);
    vi.mocked(agents.getAgentStateSync).mockReturnValue({
      id: 'agent-pan-880-review',
      issueId: 'PAN-880',
      workspace: '/workspace',
      role: 'review',
      model: 'model',
      status: 'stopped',
      startedAt: '2026-05-13T00:00:00.000Z',
      reviewRunId: runId,
    } as any);
    mockGetReviewStatus.mockReturnValue({ issueId: 'PAN-880', reviewStatus: 'reviewing', prUrl: 'https://github.com/eltmon/overdeck/pull/880' } as any);
    mockSessionExistsAsync.mockReturnValue(Effect.succeed(false) as any);

    const actions = await monitorReviewConvoySignals();

    expect(agents.messageAgent).not.toHaveBeenCalledWith(
      'agent-pan-880-review',
      expect.stringContaining('REVIEWER_READY'),
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      `${reviewDir}/synthesis.md`,
      expect.stringContaining('## Verdict: CHANGES REQUESTED — [correctness] Missing null check — `src/example.ts:42`'),
    );
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-880', {
      reviewStatus: 'blocked',
      reviewNotes: '[correctness] Missing null check — `src/example.ts:42`',
    });
    expect(mockDeliverReviewVerdictFeedback).toHaveBeenCalledWith({
      issueId: 'PAN-880',
      verdict: 'blocked',
      notes: '[correctness] Missing null check — `src/example.ts:42`',
      workspacePath: '/workspace',
      prUrl: 'https://github.com/eltmon/overdeck/pull/880',
    });
    expect(actions).toEqual([
      'Synthesized review for PAN-880 from 4 reviewer reports: blocked',
    ]);
  });

  it('respawns an idle reviewer with no output once before the hard deadline (PAN-1806)', async () => {
    const fs = await import('fs');
    const agents = await import('../../../lib/agents.js');
    const outputPath = '/tmp/test-agents/agent-pan-879-review-security/review-security.md';
    vi.mocked(fs.readdirSync).mockReturnValue(['agent-pan-879-review-security'] as any);
    vi.mocked(fs.existsSync).mockImplementation((path: any) => String(path) === '/tmp/test-agents');
    vi.mocked(agents.getAgentStateSync)
      .mockReturnValueOnce({
        id: 'agent-pan-879-review-security',
        issueId: 'PAN-879',
        workspace: '/workspace',
        role: 'review',
        model: 'model',
        harness: 'claude-code',
        status: 'running',
        startedAt: '2026-05-13T00:00:00.000Z',
        reviewSubRole: 'security',
        reviewRunId: 'agent-pan-879-review-abcdef12',
        reviewOutputPath: outputPath,
        reviewSynthesisAgentId: 'agent-pan-879-review',
        reviewRetryAttempt: 0,
      } as any)
      .mockReturnValueOnce({
        id: 'agent-pan-879-review-security',
        issueId: 'PAN-879',
        workspace: '/workspace',
        role: 'review',
        model: 'model',
        harness: 'claude-code',
        status: 'running',
        startedAt: new Date().toISOString(),
        reviewSubRole: 'security',
        reviewRunId: 'agent-pan-879-review-abcdef12',
        reviewOutputPath: outputPath,
        reviewSynthesisAgentId: 'agent-pan-879-review',
      } as any);
    mockSessionExistsAsync.mockImplementation((name: string) =>
      Effect.succeed(['agent-pan-879-review', 'agent-pan-879-review-security'].includes(name)) as any,
    );
    mockIsPaneDead.mockReturnValue(Effect.succeed(false) as any);
    mockGetAgentRuntimeState.mockReturnValue({
      state: 'idle',
      lastActivity: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    } as any);

    const actions = await monitorReviewConvoySignals();

    expect(mockMessageAgent).not.toHaveBeenCalled();
    expect(mockKillSessionAsync).toHaveBeenCalledWith('agent-pan-879-review-security');
    expect(mockSpawnReviewSubRole).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-879',
      workspace: '/workspace',
      subRole: 'security',
      runId: 'agent-pan-879-review-abcdef12',
      outputPath,
      contextManifestPath: '/tmp/test-agents/agent-pan-879-review-security/context.json',
      synthesisAgentId: 'agent-pan-879-review',
      model: 'model',
      harness: 'claude-code',
      allowHost: false,
    }));
    expect(mockSaveAgentState).toHaveBeenCalledWith(expect.objectContaining({
      reviewRetryAttempt: 1,
    }));
    expect(actions).toEqual([]);
  });

  it('signals REVIEWER_FAILED when an idle reviewer has already been retried (PAN-1806)', async () => {
    const fs = await import('fs');
    const agents = await import('../../../lib/agents.js');
    const outputPath = '/tmp/test-agents/agent-pan-879-review-security/review-security.md';
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
      reviewOutputPath: outputPath,
      reviewSynthesisAgentId: 'agent-pan-879-review',
      reviewRetryAttempt: 1,
    } as any);
    mockSessionExistsAsync.mockImplementation((name: string) =>
      Effect.succeed(['agent-pan-879-review', 'agent-pan-879-review-security'].includes(name)) as any,
    );
    mockIsPaneDead.mockReturnValue(Effect.succeed(false) as any);
    mockGetAgentRuntimeState.mockReturnValue({
      state: 'idle',
      lastActivity: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    } as any);

    const actions = await monitorReviewConvoySignals();

    expect(mockSpawnReviewSubRole).not.toHaveBeenCalled();
    expect(mockMessageAgent).toHaveBeenCalledWith(
      'agent-pan-879-review',
      'REVIEWER_FAILED security reviewer idle with no output after terminal API error (retry exhausted)',
    );
    expect(mockSaveAgentState).toHaveBeenCalledWith(expect.objectContaining({
      reviewMonitorSignaled: 'failed',
    }));
    expect(actions).toEqual([
      'Signaled REVIEWER_FAILED security reviewer idle with no output after terminal API error (retry exhausted) to agent-pan-879-review',
    ]);
  });

  it('fast-fails an overflowed reviewer without waiting for the idle threshold (PAN-1818)', async () => {
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
    mockSessionExistsAsync.mockImplementation((name: string) =>
      Effect.succeed(['agent-pan-879-review', 'agent-pan-879-review-security'].includes(name)) as any,
    );
    mockIsPaneDead.mockReturnValue(Effect.succeed(false) as any);
    mockGetAgentRuntimeState.mockReturnValue({
      state: 'idle',
      lastActivity: new Date().toISOString(),
    } as any);
    mockCapturePane.mockResolvedValue('API Error: 400 Your input exceeds the context window of this model.');

    const actions = await monitorReviewConvoySignals();

    expect(mockCapturePane).toHaveBeenCalledWith('agent-pan-879-review-security', 100);
    expect(mockSpawnReviewSubRole).not.toHaveBeenCalled();
    expect(mockMessageAgent).toHaveBeenCalledWith(
      'agent-pan-879-review',
      'REVIEWER_FAILED security context-window overflow (no retry — deterministic)',
    );
    expect(mockSaveAgentState).toHaveBeenCalledWith(expect.objectContaining({
      reviewMonitorSignaled: 'failed',
    }));
    expect(actions).toEqual([
      'Signaled REVIEWER_FAILED security context-window overflow (no retry — deterministic) to agent-pan-879-review',
    ]);
  });

  it('preserves PAN-1806 idle-respawn when the reviewer tail shows no overflow (PAN-1818)', async () => {
    const fs = await import('fs');
    const agents = await import('../../../lib/agents.js');
    const outputPath = '/tmp/test-agents/agent-pan-879-review-security/review-security.md';
    vi.mocked(fs.readdirSync).mockReturnValue(['agent-pan-879-review-security'] as any);
    vi.mocked(fs.existsSync).mockImplementation((path: any) => String(path) === '/tmp/test-agents');
    vi.mocked(agents.getAgentStateSync)
      .mockReturnValueOnce({
        id: 'agent-pan-879-review-security',
        issueId: 'PAN-879',
        workspace: '/workspace',
        role: 'review',
        model: 'model',
        harness: 'claude-code',
        status: 'running',
        startedAt: '2026-05-13T00:00:00.000Z',
        reviewSubRole: 'security',
        reviewRunId: 'agent-pan-879-review-abcdef12',
        reviewOutputPath: outputPath,
        reviewSynthesisAgentId: 'agent-pan-879-review',
        reviewRetryAttempt: 0,
      } as any)
      .mockReturnValueOnce({
        id: 'agent-pan-879-review-security',
        issueId: 'PAN-879',
        workspace: '/workspace',
        role: 'review',
        model: 'model',
        harness: 'claude-code',
        status: 'running',
        startedAt: new Date().toISOString(),
        reviewSubRole: 'security',
        reviewRunId: 'agent-pan-879-review-abcdef12',
        reviewOutputPath: outputPath,
        reviewSynthesisAgentId: 'agent-pan-879-review',
      } as any);
    mockSessionExistsAsync.mockImplementation((name: string) =>
      Effect.succeed(['agent-pan-879-review', 'agent-pan-879-review-security'].includes(name)) as any,
    );
    mockIsPaneDead.mockReturnValue(Effect.succeed(false) as any);
    mockGetAgentRuntimeState.mockReturnValue({
      state: 'idle',
      lastActivity: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    } as any);
    mockCapturePane.mockResolvedValue('some other terminal error, no context window mention');

    const actions = await monitorReviewConvoySignals();

    expect(mockCapturePane).toHaveBeenCalledWith('agent-pan-879-review-security', 100);
    expect(mockMessageAgent).not.toHaveBeenCalled();
    expect(mockSpawnReviewSubRole).toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('does not treat a fresh active reviewer as idle (PAN-1806)', async () => {
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
    mockSessionExistsAsync.mockImplementation((name: string) =>
      Effect.succeed(['agent-pan-879-review', 'agent-pan-879-review-security'].includes(name)) as any,
    );
    mockIsPaneDead.mockReturnValue(Effect.succeed(false) as any);
    mockGetAgentRuntimeState.mockReturnValue({
      state: 'active',
      lastActivity: new Date().toISOString(),
    } as any);

    const actions = await monitorReviewConvoySignals();

    expect(mockMessageAgent).not.toHaveBeenCalled();
    expect(mockSpawnReviewSubRole).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });
});

describe('checkInspectAgentTimeouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-05T12:12:01.000Z'));
    mockMessageAgent.mockResolvedValue(undefined);
    mockKillSessionAsync.mockReturnValue(Effect.succeed(undefined) as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks a timed-out inspecting bead as error, kills the inspect session, and tells the parent exactly once', async () => {
    vi.mocked((await import('../../review-status.js')).loadReviewStatuses)
      .mockReturnValueOnce({
        'PAN-1616': {
          issueId: 'PAN-1616',
          reviewStatus: 'pending',
          testStatus: 'pending',
          inspectStatus: 'inspecting',
          inspectStartedAt: '2026-06-05T12:00:00.000Z',
          inspectBeadId: 'workspace-sposy',
          updatedAt: '2026-06-05T12:00:00.000Z',
          readyForMerge: false,
        },
      } as any)
      .mockReturnValue({
        'PAN-1616': {
          issueId: 'PAN-1616',
          reviewStatus: 'pending',
          testStatus: 'pending',
          inspectStatus: 'error',
          inspectStartedAt: '2026-06-05T12:00:00.000Z',
          inspectBeadId: 'workspace-sposy',
          updatedAt: '2026-06-05T12:12:01.000Z',
          readyForMerge: false,
        },
      } as any);
    mockSessionExistsAsync.mockReturnValue(Effect.succeed(true) as any);

    const first = await checkInspectAgentTimeouts();
    const second = await checkInspectAgentTimeouts();

    expect(first).toEqual([
      'Inspection watchdog tripped for PAN-1616 bead workspace-sposy: timed out after 12m (limit 12m)',
    ]);
    expect(second).toEqual([]);
    expect(mockSetReviewStatus).toHaveBeenCalledTimes(1);
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-1616', expect.objectContaining({
      inspectStatus: 'error',
      inspectNotes: expect.stringContaining('timed out'),
    }));
    expect(mockKillSessionAsync).toHaveBeenCalledTimes(1);
    expect(mockKillSessionAsync).toHaveBeenCalledWith('inspect-pan-1616-workspace-sposy');
    expect(mockMessageAgent).toHaveBeenCalledTimes(1);
    expect(mockMessageAgent).toHaveBeenCalledWith(
      'agent-pan-1616',
      expect.stringContaining('INSPECTION ERROR for bead workspace-sposy'),
      'deacon:inspect-watchdog',
    );
  });

  it('marks an inspecting bead as error when its inspect session has disappeared', async () => {
    vi.mocked((await import('../../review-status.js')).loadReviewStatuses).mockReturnValue({
      'PAN-1616': {
        issueId: 'PAN-1616',
        reviewStatus: 'pending',
        testStatus: 'pending',
        inspectStatus: 'inspecting',
        inspectStartedAt: '2026-06-05T12:11:30.000Z',
        inspectBeadId: 'workspace-sposy',
        updatedAt: '2026-06-05T12:11:30.000Z',
        readyForMerge: false,
      },
    } as any);
    mockSessionExistsAsync.mockReturnValue(Effect.succeed(false) as any);

    const actions = await checkInspectAgentTimeouts();

    expect(actions[0]).toContain('tmux session inspect-pan-1616-workspace-sposy exited before producing a verdict');
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-1616', expect.objectContaining({ inspectStatus: 'error' }));
    expect(mockKillSessionAsync).not.toHaveBeenCalled();
    expect(mockMessageAgent).toHaveBeenCalledWith(
      'agent-pan-1616',
      expect.stringContaining('INSPECTION ERROR for bead workspace-sposy'),
      'deacon:inspect-watchdog',
    );
  });
});
