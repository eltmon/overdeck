import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mockGetAgentState = vi.fn();
const mockGetAgentRuntimeState = vi.fn();
const mockGetLatestSessionId = vi.fn();
const mockSessionExists = vi.fn();
const mockExistsSync = vi.fn<(path: string) => boolean>();

vi.mock('../agents.js', () => ({
  getAgentStateSync: () => mockGetAgentState(),
  getAgentState: () => Effect.succeed(mockGetAgentState()),
  getAgentRuntimeStateSync: () => mockGetAgentRuntimeState(),
  getAgentRuntimeState: () => Effect.succeed(mockGetAgentRuntimeState()),
  getLatestSessionIdSync: () => mockGetLatestSessionId(),
  getLatestSessionId: () => Effect.succeed(mockGetLatestSessionId()),
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
    access: (path: string) => mockExistsSync(path)
      ? Promise.resolve()
      : Promise.reject(new Error('ENOENT')),
  };
});

import {
  assertCanStartFreshSync,
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

    expect(() => assertCanStartFreshSync('agent-pan-3194')).not.toThrow();
    expect(assertCanStartFreshSync('agent-pan-3194').recommendedAction).toBe('start');
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
      const asyncLifecycle = await Effect.runPromise(getWorkAgentLifecycleState('agent-pan-3194'));

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
