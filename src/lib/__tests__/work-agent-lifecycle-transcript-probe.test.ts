import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mockGetAgentState = vi.fn();
const mockGetAgentRuntimeState = vi.fn();
const mockGetLatestSessionId = vi.fn();
const mockSessionExists = vi.fn();
const mockExistsSync = vi.fn<(path: string) => boolean>();

vi.mock('../agents.js', () => ({
  getAgentState: () => mockGetAgentState(),
  getAgentRuntimeStateSync: () => mockGetAgentRuntimeState(),
  getAgentRuntimeState: () => Effect.succeed(mockGetAgentRuntimeState()),
  getLatestSessionId: () => mockGetLatestSessionId(),
  normalizeAgentId: (id: string) => id,
}));

vi.mock('../tmux.js', () => ({
  sessionExistsSync: () => mockSessionExists(),
  sessionExists: () => Effect.succeed(mockSessionExists()),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: (path: string) => mockExistsSync(path) };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: (path: string) => mockExistsSync(path) };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    // Routed through mockExistsSync only for the workspace path (PAN-3917
    // W12): mockExistsSync's `true` fallback also answered the host-backend
    // probe's herdr-binary/herdr-socket `access()` checks (hostTerminalBackendName,
    // called from the async isAlive door but never the sync one), making
    // every host look like it has Herdr and desyncing the async lifecycle
    // snapshot from the sync one. Anything else falls through to the real
    // filesystem, where the synthetic test OVERDECK_HOME's herdr socket
    // genuinely does not exist.
    access: (path: string, ...rest: unknown[]) =>
      path === '/tmp/pan-3194-workspace'
        ? (mockExistsSync(path) ? Promise.resolve() : Promise.reject(new Error('ENOENT')))
        : (actual.access as (...args: unknown[]) => Promise<void>)(path, ...rest),
  };
});

import {
  assertCanStartFresh,
  getWorkAgentLifecycleState,
  getWorkAgentLifecycleStateSync,
} from '../work-agent-lifecycle.js';

function stoppedAgentState(harness: string | undefined = 'claude-code') {
  return {
    id: 'agent-pan-3194',
    issueId: 'PAN-3194',
    workspace: '/tmp/pan-3194-workspace',
    status: 'stopped',
    role: 'work',
    model: 'claude-sonnet-4-6',
    harness,
  };
}

function configureLifecycle(options: {
  transcriptExists: boolean;
  harness?: string;
}): void {
  mockGetAgentState.mockReturnValue(stoppedAgentState(options.harness));
  mockGetAgentRuntimeState.mockReturnValue({ state: 'stopped' });
  mockGetLatestSessionId.mockReturnValue('session-pan-3194');
  mockSessionExists.mockReturnValue(false);
  mockExistsSync.mockImplementation((path) => {
    if (path.endsWith('.jsonl')) return options.transcriptExists;
    // PAN-3334: the lifecycle now probes for a completion marker; these tests
    // are not about handoff, so the marker is always absent here.
    if (/(^|\/)completed(\.processed)?$/.test(path)) return false;
    return true;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Claude transcript resumability probe (PAN-3194)', () => {
  it('routes a missing Claude transcript to a fresh start', () => {
    configureLifecycle({ transcriptExists: false });

    const lifecycle = getWorkAgentLifecycleStateSync('agent-pan-3194');

    expect(lifecycle).toMatchObject({
      hasSavedSession: true,
      hasResumableTranscript: false,
      recommendedAction: 'start',
      canStartFresh: true,
      canResumeSession: false,
      canResetSession: false,
      requiresSessionResetBeforeFreshStart: false,
    });
    expect(lifecycle.reason).toContain('jsonl-missing');
  });

  it('preserves resume behavior when the Claude transcript exists', () => {
    configureLifecycle({ transcriptExists: true });

    const lifecycle = getWorkAgentLifecycleStateSync('agent-pan-3194');

    expect(lifecycle).toMatchObject({
      hasSavedSession: true,
      hasResumableTranscript: true,
      recommendedAction: 'resume',
      canStartFresh: false,
      canResumeSession: true,
      canResetSession: true,
      requiresSessionResetBeforeFreshStart: true,
    });
  });

  it('allows pan start to proceed without --fresh when the transcript is missing', () => {
    configureLifecycle({ transcriptExists: false });

    expect(() => assertCanStartFresh('agent-pan-3194')).not.toThrow();
    expect(assertCanStartFresh('agent-pan-3194').recommendedAction).toBe('start');
  });

  it('does not require a Claude JSONL for a non-Claude harness', () => {
    configureLifecycle({ transcriptExists: false, harness: 'codex' });

    const lifecycle = getWorkAgentLifecycleStateSync('agent-pan-3194');

    expect(lifecycle.hasResumableTranscript).toBe(true);
    expect(lifecycle.canResumeSession).toBe(true);
    expect(lifecycle.recommendedAction).toBe('resume');
  });

  it('keeps sync and async snapshots aligned for missing and present transcripts', async () => {
    for (const transcriptExists of [false, true]) {
      configureLifecycle({ transcriptExists });

      const syncLifecycle = getWorkAgentLifecycleStateSync('agent-pan-3194');
      const asyncLifecycle = await getWorkAgentLifecycleState('agent-pan-3194');

      expect(asyncLifecycle).toMatchObject({
        hasSavedSession: syncLifecycle.hasSavedSession,
        hasResumableTranscript: syncLifecycle.hasResumableTranscript,
        recommendedAction: syncLifecycle.recommendedAction,
        canStartFresh: syncLifecycle.canStartFresh,
        canResumeSession: syncLifecycle.canResumeSession,
        canResetSession: syncLifecycle.canResetSession,
        requiresSessionResetBeforeFreshStart: syncLifecycle.requiresSessionResetBeforeFreshStart,
      });
    }
  });
});
