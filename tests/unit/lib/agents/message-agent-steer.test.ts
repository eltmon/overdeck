/**
 * PAN-4292 — `messageAgent(..., { steer: true })`. A steer interrupts a
 * running Claude Code turn: it skips the idle wait, still moves input to main
 * (PAN-4268), and asks the delivery door for `submit: 'steer'`. Targets that
 * cannot be steered are refused outright — nothing delivered, nothing mailed.
 *
 * The mock scaffold mirrors message-agent.test.ts.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { existsSync, rmSync } from 'node:fs';

const mocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
  getAgentRuntimeStateSync: vi.fn(),
  deliverAgentMessage: vi.fn(),
  sessionExists: vi.fn(),
  listPaneValues: vi.fn(),
  waitForAgentIdle: vi.fn(),
  getCodexAppServerStatus: vi.fn(),
  findAgentRuntimePidInSubtree: vi.fn(),
  appendOperatorInterventionEvent: vi.fn(),
  logAgentLifecycle: vi.fn(),
  resumeAgent: vi.fn(),
  getLatestSessionId: vi.fn(),
  hasAgentRuntimeInSubtree: vi.fn(),
  getConversationByName: vi.fn(),
  captureTranscriptUserRecordSnapshot: vi.fn(),
  probeTranscriptSince: vi.fn(),
  captureSidechainOffsets: vi.fn(),
  probeSidechainsSince: vi.fn(),
  ensureMainInputTarget: vi.fn(),
  loadRemoteAgentState: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/input-target.js', () => ({
  ensureMainInputTarget: mocks.ensureMainInputTarget,
}));

vi.mock('../../../../src/lib/agents/agent-state.js', () => ({
  getAgentDir: (agentId: string) => `/tmp/${agentId}`,
  getAgentResumeGateBlockReason: (state: { paused?: boolean; troubled?: boolean; consecutiveFailures?: number }) => {
    if (state.paused) return { reason: 'agent is paused' };
    if (state.troubled) return { reason: `agent is troubled (${state.consecutiveFailures ?? 0} failures)` };
    return undefined;
  },
  decideResumeGate: (block: { reason?: string } | undefined) => block
    ? { decision: 'block', reason: block.reason }
    : { decision: 'proceed', clearStoppedByUser: false },
  getAgentState: mocks.getAgentState,
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

vi.mock('../../../../src/lib/agents/delivery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/agents/delivery.js')>();
  return {
    ...actual,
    deliverAgentMessage: mocks.deliverAgentMessage,
    // Run the REAL confirming primitive, but with the mocked transport injected
    // so the test drives polling through the stubbed probe and fake timers.
    deliverMessageWithTranscriptConfirmation: (args: Record<string, unknown>) =>
      actual.deliverMessageWithTranscriptConfirmation({
        ...args,
        deliver: mocks.deliverAgentMessage,
      } as Parameters<typeof actual.deliverMessageWithTranscriptConfirmation>[0]),
    resilientDeliveryMethod: (method: unknown) => method,
  };
});

vi.mock('../../../../src/lib/transcript-landing.js', () => ({
  captureTranscriptUserRecordSnapshot: mocks.captureTranscriptUserRecordSnapshot,
  probeTranscriptSince: mocks.probeTranscriptSince,
  captureSidechainOffsets: mocks.captureSidechainOffsets,
  probeSidechainsSince: mocks.probeSidechainsSince,
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
  hasAgentRuntimeInSubtree: mocks.hasAgentRuntimeInSubtree,
  getCodexAppServerStatus: mocks.getCodexAppServerStatus,
  waitForPromptReady: vi.fn(),
}));

// PAN-3849: the liveness oracle's process probe lives in runtime-pid-probe.js.
// Kept alongside the PAN-3879 conversations mock — messageAgent now needs BOTH:
// the oracle decides zombie-ness, the conversation lookup decides routing.
vi.mock('../../../../src/lib/agents/runtime-pid-probe.js', () => ({
  findAgentRuntimePidInSubtree: mocks.findAgentRuntimePidInSubtree,
  findAgentRuntimePidInSubtreeSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/overdeck/conversations.js', () => ({
  getConversationByName: mocks.getConversationByName,
}));

vi.mock('../../../../src/lib/agents/activity.js', () => ({
  getLatestSessionId: mocks.getLatestSessionId,
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
  emitActivityEntry: vi.fn(),
}));

vi.mock('../../../../src/lib/persistent-logger.js', () => ({
  logAgentLifecycle: mocks.logAgentLifecycle,
}));

vi.mock('../../../../src/lib/providers.js', () => ({
  clearCredentialFileAuth: vi.fn(),
  getProviderForModel: vi.fn(),
  setupCredentialFileAuth: vi.fn(),
}));

vi.mock('../../../../src/lib/launcher-generator.js', () => ({
  generateLauncherScript: vi.fn(),
}));

vi.mock('../../../../src/lib/child-env.js', () => ({
  BLANKED_PROVIDER_ENV: {},
}));

vi.mock('../../../../src/lib/session-rotation.js', () => ({
  ALLOW_SESSION_ROTATION_ON_RESUME: false,
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  assertWorkspaceStackHealthyForSpawn: vi.fn(),
  resumeAgent: mocks.resumeAgent,
}));

vi.mock('../../../../src/lib/agents/provider-env.js', () => ({
  getProviderEnvForModel: vi.fn(),
  getProviderExportsForModel: vi.fn(),
}));


vi.mock('../../../../src/lib/remote/remote-agents.js', () => ({
  loadRemoteAgentState: mocks.loadRemoteAgentState,
  sendToRemoteAgent: vi.fn(),
}));

import { messageAgent } from '../../../../src/lib/agents/messaging.js';

const CLAUDE_AGENT = {
  id: 'agent-pan-4292',
  issueId: 'PAN-4292',
  status: 'running',
  workspace: '/repo',
  harness: 'claude-code',
  sessionId: 'session-4292',
};

describe('messageAgent steer (PAN-4292)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentRuntimeStateSync.mockReturnValue({ state: 'active', lastActivity: new Date().toISOString() });
    mocks.sessionExists.mockReturnValue(Effect.succeed(true));
    mocks.listPaneValues.mockResolvedValue(['4242\t0']);
    mocks.findAgentRuntimePidInSubtree.mockResolvedValue(4242);
    mocks.waitForAgentIdle.mockResolvedValue(false);
    mocks.deliverAgentMessage.mockResolvedValue({ ok: true, path: 'tmux', steered: true });
    mocks.getLatestSessionId.mockImplementation((agentId, options) =>
      options?.getAgentState?.(agentId)?.sessionId);
    mocks.captureTranscriptUserRecordSnapshot.mockResolvedValue({
      sessionFile: '/tmp/session.jsonl',
      userRecordCount: 0,
      fileSize: 0,
      readOffset: 0,
    });
    mocks.probeTranscriptSince.mockResolvedValue({ matchedUserRecord: true, realAssistantTurnCount: 0 });
    mocks.captureSidechainOffsets.mockResolvedValue(new Map());
    mocks.probeSidechainsSince.mockResolvedValue(null);
    mocks.getCodexAppServerStatus.mockRejectedValue(new Error('no app-server'));
    mocks.hasAgentRuntimeInSubtree.mockResolvedValue(true);
    mocks.getConversationByName.mockReturnValue(null);
    mocks.ensureMainInputTarget.mockResolvedValue({ ok: true, check: 'no-selector' });
    mocks.loadRemoteAgentState.mockReturnValue(null);
  });

  afterEach(() => {
    rmSync('/tmp/agent-pan-4292', { recursive: true, force: true });
  });

  it('steers a busy Claude Code agent without waiting for idle', async () => {
    mocks.getAgentState.mockReturnValue(CLAUDE_AGENT);

    await expect(messageAgent('agent-pan-4292', 'change course', 'pan-tell', { steer: true })).resolves.toEqual({
      delivered: true,
      queuedToMail: true,
      confirmed: true,
      inputTarget: 'main',
    });
    expect(mocks.waitForAgentIdle).not.toHaveBeenCalled();
    expect(mocks.ensureMainInputTarget).toHaveBeenCalledWith('agent-pan-4292');
    expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
      'agent-pan-4292',
      'change course',
      'messageAgent:pan-tell',
      undefined,
      { submit: 'steer' },
    );
  });

  it('reports a steer that an old supervisor delivered as a normal submit', async () => {
    mocks.getAgentState.mockReturnValue(CLAUDE_AGENT);
    mocks.deliverAgentMessage.mockResolvedValue({
      ok: true,
      path: 'supervisor',
      steered: false,
      failure: 'supervisor predates steer; delivered as a normal submit',
    });

    const outcome = await messageAgent('agent-pan-4292', 'change course', 'pan-tell', { steer: true });

    expect(outcome.delivered).toBe(true);
    expect(outcome.reason).toBe('supervisor predates steer; delivered as a normal submit');
  });

  it('keeps the idle wait and the plain delivery call without steer', async () => {
    mocks.getAgentState.mockReturnValue(CLAUDE_AGENT);

    await messageAgent('agent-pan-4292', 'queue this', 'pan-tell');

    expect(mocks.waitForAgentIdle).toHaveBeenCalledWith('agent-pan-4292', 5000);
    expect(mocks.deliverAgentMessage).toHaveBeenCalledWith('agent-pan-4292', 'queue this', 'messageAgent:pan-tell', undefined);
  });

  it.each([
    ['codex', 'Codex'],
    ['kimi-code', 'Kimi Code'],
    ['ohmypi', 'Pi'],
  ])('refuses a steer to a %s agent with nothing delivered or mailed', async (harness, displayName) => {
    mocks.getAgentState.mockReturnValue({ ...CLAUDE_AGENT, harness });

    const outcome = await messageAgent('agent-pan-4292', 'change course', 'pan-tell', { steer: true });

    expect(outcome).toMatchObject({ delivered: false, queuedToMail: false });
    expect(outcome.reason).toContain(`runs ${displayName}`);
    expect(outcome.reason).toContain('Drop --steer');
    expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
    expect(existsSync('/tmp/agent-pan-4292/mail')).toBe(false);
  });

  it.each([
    ['paused', { paused: true }, undefined],
    ['stopped', { status: 'stopped' }, undefined],
    ['suspended', {}, 'suspended'],
  ])('refuses a steer to a %s agent with nothing delivered or mailed', async (label, patch, runtime) => {
    mocks.getAgentState.mockReturnValue({ ...CLAUDE_AGENT, ...patch });
    if (runtime) mocks.getAgentRuntimeStateSync.mockReturnValue({ state: runtime });

    const outcome = await messageAgent('agent-pan-4292', 'change course', 'pan-tell', { steer: true });

    expect(outcome).toMatchObject({ delivered: false, queuedToMail: false });
    expect(outcome.reason).toContain(`is ${label}`);
    expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
    expect(mocks.resumeAgent).not.toHaveBeenCalled();
    expect(existsSync('/tmp/agent-pan-4292/mail')).toBe(false);
  });

  it('refuses a steer to a remote agent', async () => {
    mocks.getAgentState.mockReturnValue(CLAUDE_AGENT);
    mocks.loadRemoteAgentState.mockReturnValue({ vmName: 'fly-vm-1' });

    const outcome = await messageAgent('agent-pan-4292', 'change course', 'pan-tell', { steer: true });

    expect(outcome).toMatchObject({ delivered: false, queuedToMail: false });
    expect(outcome.reason).toContain('remote agents');
    expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
  });
});
