import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({
  getAgentStateSync: vi.fn(),
  getAgentRuntimeStateSync: vi.fn(),
  deliverAgentMessage: vi.fn(),
  sessionExists: vi.fn(),
  listPaneValues: vi.fn(),
  waitForAgentIdle: vi.fn(),
  getCodexAppServerStatus: vi.fn(),
  appendOperatorInterventionEvent: vi.fn(),
  logAgentLifecycleSync: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/agent-state.js', () => ({
  getAgentDir: (agentId: string) => `/tmp/${agentId}`,
  getAgentResumeGateBlockReason: (state: { paused?: boolean; troubled?: boolean; consecutiveFailures?: number }) => {
    if (state.paused) return 'agent is paused';
    if (state.troubled) return `agent is troubled (${state.consecutiveFailures ?? 0} failures)`;
    return undefined;
  },
  getAgentStateSync: mocks.getAgentStateSync,
  markAgentRunning: vi.fn(),
  saveAgentStateSync: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/runtime-state.js', () => ({
  getAgentRuntimeStateSync: mocks.getAgentRuntimeStateSync,
}));

vi.mock('../../../../src/lib/agents/identity.js', () => ({
  clearReadySignal: vi.fn(),
  normalizeAgentId: (agentId: string) => agentId,
  waitForAgentIdle: mocks.waitForAgentIdle,
}));

vi.mock('../../../../src/lib/agents/delivery.js', () => ({
  deliverAgentMessage: mocks.deliverAgentMessage,
  deliverResumeMessageWithTranscriptConfirmation: vi.fn(),
  resilientDeliveryMethod: (method: unknown) => method,
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  createSession: vi.fn(),
  killSession: vi.fn(),
  listPaneValues: mocks.listPaneValues,
  sessionExists: mocks.sessionExists,
}));

vi.mock('../../../../src/lib/agents/runtime-command.js', () => ({
  claudeSystemPromptFiles: vi.fn(),
  getCodexLauncherFields: vi.fn(),
  getOhmypiLauncherFields: vi.fn(),
  getRoleRuntimeBaseCommand: vi.fn(),
  hasAgentRuntimeInSubtree: vi.fn(),
  getCodexAppServerStatus: mocks.getCodexAppServerStatus,
  waitForPromptReady: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/activity.js', () => ({
  getLatestSessionIdSync: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/supervisor-channels.js', () => ({
  buildResumeMessageForAgent: vi.fn(),
  markKickoffRedelivered: vi.fn(),
  prepareSupervisorForRelaunch: vi.fn(),
}));

vi.mock('../../../../src/lib/operator-interventions.js', () => ({
  appendOperatorInterventionEvent: mocks.appendOperatorInterventionEvent,
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
}));

vi.mock('../../../../src/lib/persistent-logger.js', () => ({
  logAgentLifecycleSync: mocks.logAgentLifecycleSync,
}));

vi.mock('../../../../src/lib/providers.js', () => ({
  clearCredentialFileAuthSync: vi.fn(),
  getProviderForModelSync: vi.fn(),
  setupCredentialFileAuthSync: vi.fn(),
}));

vi.mock('../../../../src/lib/launcher-generator.js', () => ({
  generateLauncherScriptSync: vi.fn(),
}));

vi.mock('../../../../src/lib/child-env.js', () => ({
  BLANKED_PROVIDER_ENV: {},
}));

vi.mock('../../../../src/lib/session-rotation.js', () => ({
  ALLOW_SESSION_ROTATION_ON_RESUME: false,
}));

vi.mock('../../../../src/lib/agents/provider-env.js', () => ({
  getProviderEnvForModel: vi.fn(),
  getProviderExportsForModel: vi.fn(),
}));

import { messageAgent } from '../../../../src/lib/agents/messaging.js';

describe('messageAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentRuntimeStateSync.mockReturnValue({ state: 'idle', lastActivity: new Date().toISOString() });
    mocks.sessionExists.mockReturnValue(Effect.succeed(true));
    mocks.listPaneValues.mockReturnValue(Effect.succeed([]));
    mocks.waitForAgentIdle.mockResolvedValue(true);
    mocks.deliverAgentMessage.mockResolvedValue({ ok: true });
    mocks.getCodexAppServerStatus.mockRejectedValue(new Error('no app-server'));
  });

  afterEach(() => {
    rmSync('/tmp/agent-pan-2262', { recursive: true, force: true });
    rmSync('/tmp/agent-pan-2701', { recursive: true, force: true });
    rmSync('/tmp/conv-20260716-1234', { recursive: true, force: true });
  });

  it('delivers to a troubled agent when its tmux session is live', async () => {
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-2262',
      issueId: 'PAN-2262',
      status: 'running',
      workspace: '/repo',
      troubled: true,
      consecutiveFailures: 3,
    });

    await messageAgent('agent-pan-2262', 'review feedback', 'pan-tell');

    expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
      'agent-pan-2262',
      'review feedback',
      'messageAgent:pan-tell',
      undefined,
    );
    expect(mocks.logAgentLifecycleSync).not.toHaveBeenCalledWith(
      'agent-pan-2262',
      expect.stringContaining('queued mail without resume'),
    );
  });

  it('queues a message instead of pasting into a mid-turn codex agent', async () => {
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-2701',
      issueId: 'PAN-2701',
      status: 'running',
      workspace: '/repo',
      harness: 'codex',
    });
    mocks.getCodexAppServerStatus.mockResolvedValue({ state: 'running' });
    mocks.sessionExists.mockReturnValue(Effect.succeed(false));
    await messageAgent('agent-pan-2701', 'review feedback', 'pan-tell');

    expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
    const mailDir = '/tmp/agent-pan-2701/mail';
    expect(existsSync(mailDir)).toBe(true);
    const files = readdirSync(mailDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.pending\.md$/);
    expect(readFileSync(`${mailDir}/${files[0]}`, 'utf-8')).toContain('review feedback');
  });

  it('marks direct codex delivery as backup mail rather than pending mail', async () => {
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-2701',
      issueId: 'PAN-2701',
      status: 'running',
      workspace: '/repo',
      harness: 'codex',
    });
    mocks.getCodexAppServerStatus.mockResolvedValue({ state: 'ready' });
    mocks.sessionExists.mockReturnValue(Effect.succeed(false));
    mkdirSync('/tmp/agent-pan-2701', { recursive: true });
    writeFileSync('/tmp/agent-pan-2701/turn-completed', new Date().toISOString());

    await messageAgent('agent-pan-2701', 'operator message', 'pan-tell');

    expect(mocks.deliverAgentMessage).toHaveBeenCalledOnce();
    expect(existsSync('/tmp/agent-pan-2701/turn-completed')).toBe(false);
    const files = readdirSync('/tmp/agent-pan-2701/mail');
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.md$/);
    expect(files[0]).not.toContain('.pending.md');
  });

  it('queues a second codex message until the current turn completes', async () => {
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-2701',
      issueId: 'PAN-2701',
      status: 'running',
      workspace: '/repo',
      harness: 'codex',
    });
    mocks.getCodexAppServerStatus.mockResolvedValue({ state: 'ready' });
    mocks.sessionExists.mockReturnValue(Effect.succeed(false));
    mkdirSync('/tmp/agent-pan-2701', { recursive: true });
    writeFileSync('/tmp/agent-pan-2701/turn-completed', new Date().toISOString());

    await messageAgent('agent-pan-2701', 'first message', 'pan-tell');
    await messageAgent('agent-pan-2701', 'second message', 'pan-tell');

    expect(mocks.deliverAgentMessage).toHaveBeenCalledOnce();
    const pending = readdirSync('/tmp/agent-pan-2701/mail')
      .filter((file) => file.endsWith('.pending.md'));
    expect(pending).toHaveLength(1);
    expect(readFileSync(`/tmp/agent-pan-2701/mail/${pending[0]}`, 'utf-8')).toContain('second message');
  });

  it('detects a codex conversation through app-server without agent state', async () => {
    mocks.getAgentStateSync.mockReturnValue(undefined);
    mocks.getCodexAppServerStatus.mockResolvedValue({ state: 'ready' });
    mocks.sessionExists.mockReturnValue(Effect.succeed(false));
    mkdirSync('/tmp/conv-20260716-1234', { recursive: true });
    writeFileSync('/tmp/conv-20260716-1234/turn-completed', new Date().toISOString());

    await messageAgent('conv-20260716-1234', 'operator message', 'pan-tell');

    expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
      'conv-20260716-1234',
      'operator message',
      'messageAgent:pan-tell',
      undefined,
    );
    expect(mocks.sessionExists).not.toHaveBeenCalled();
  });
});
