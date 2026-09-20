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
  findAgentRuntimePidInSubtree: vi.fn(),
  appendOperatorInterventionEvent: vi.fn(),
  logAgentLifecycleSync: vi.fn(),
  resumeAgent: vi.fn(),
  getLatestSessionIdSync: vi.fn(),
  hasAgentRuntimeInSubtree: vi.fn(),
  getConversationByName: vi.fn(),
  captureTranscriptUserRecordSnapshot: vi.fn(),
  probeTranscriptSince: vi.fn(),
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
  getLatestSessionIdSync: mocks.getLatestSessionIdSync,
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

vi.mock('../../../../src/lib/agents.js', () => ({
  assertWorkspaceStackHealthyForSpawn: vi.fn(),
  resumeAgent: mocks.resumeAgent,
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
    // PAN-3849: the liveness oracle reads pane rows as '<pid>\t<dead>'; one
    // live pane plus a runtime pid in its subtree means a live agent.
    mocks.listPaneValues.mockReturnValue(Effect.succeed(['4242\t0']));
    mocks.findAgentRuntimePidInSubtree.mockResolvedValue(4242);
    mocks.waitForAgentIdle.mockResolvedValue(true);
    mocks.deliverAgentMessage.mockResolvedValue({ ok: true });
    mocks.resumeAgent.mockResolvedValue({ success: true, messageDelivered: true });
    mocks.getLatestSessionIdSync.mockImplementation((agentId, options) =>
      options?.getAgentState?.(agentId)?.sessionId);
    mocks.captureTranscriptUserRecordSnapshot.mockResolvedValue({
      sessionFile: '/tmp/session.jsonl',
      userRecordCount: 0,
      fileSize: 0,
      readOffset: 0,
    });
    mocks.probeTranscriptSince.mockResolvedValue({ matchedUserRecord: false, realAssistantTurnCount: 0 });
    mocks.getCodexAppServerStatus.mockRejectedValue(new Error('no app-server'));
    mocks.hasAgentRuntimeInSubtree.mockResolvedValue(true);
    mocks.getConversationByName.mockReturnValue(null);
  });

  afterEach(() => {
    rmSync('/tmp/agent-pan-2262', { recursive: true, force: true });
    rmSync('/tmp/agent-pan-2701', { recursive: true, force: true });
    rmSync('/tmp/conv-20260716-1234', { recursive: true, force: true });
    rmSync('/tmp/conv-20260917-1267', { recursive: true, force: true });
    rmSync('/tmp/conv-20260917-1300', { recursive: true, force: true });
    rmSync('/tmp/conv-20260917-1400', { recursive: true, force: true });
  });

  it('delivers to a troubled agent when its tmux session is live', async () => {
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-2262',
      issueId: 'PAN-2262',
      status: 'running',
      workspace: '/repo',
      harness: 'claude-code',
      sessionId: 'session-2262',
      troubled: true,
      consecutiveFailures: 3,
    });
    mocks.probeTranscriptSince.mockResolvedValue({ matchedUserRecord: true, realAssistantTurnCount: 0 });

    await expect(messageAgent('agent-pan-2262', 'review feedback', 'pan-tell')).resolves.toEqual({
      delivered: true,
      queuedToMail: true,
      confirmed: true,
    });

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

  it('fails loudly for a Claude Code agent with no identifiable transcript (PR #3870 finding 2)', async () => {
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-2262',
      issueId: 'PAN-2262',
      status: 'running',
      workspace: '/repo',
      harness: 'claude-code',
      // no sessionId, and none recorded in activity
    });
    mocks.getLatestSessionIdSync.mockReturnValue(undefined);

    const outcome = await messageAgent('agent-pan-2262', 'review feedback', 'pan-tell');

    expect(outcome.delivered).toBe(false);
    expect(outcome.confirmed).toBe(false);
    expect(outcome.reason).toContain('no Claude transcript identifiable');
    // Nothing was injected — the composer path must not claim an unconfirmed success.
    expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
    expect(mocks.logAgentLifecycleSync).toHaveBeenCalledWith(
      'agent-pan-2262',
      expect.stringContaining('messageAgent NOT confirmed'),
    );
  });

  it('fails loudly for a Claude Code agent with no workspace on record', async () => {
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-2262',
      issueId: 'PAN-2262',
      status: 'running',
      harness: 'claude-code',
      sessionId: 'session-2262',
    });

    const outcome = await messageAgent('agent-pan-2262', 'review feedback', 'pan-tell');

    expect(outcome.delivered).toBe(false);
    expect(outcome.reason).toContain('no Claude transcript identifiable');
    expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
  });

  it('keeps the composer-level contract for a Claude conversation without agent state', async () => {
    mocks.getAgentStateSync.mockReturnValue(undefined);
    mocks.getCodexAppServerStatus.mockRejectedValue(new Error('no app-server'));

    const outcome = await messageAgent('conv-20260716-1234', 'operator message', 'pan-tell');

    expect(outcome).toEqual({ delivered: true, queuedToMail: true, confirmed: false });
    expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
      'conv-20260716-1234',
      'operator message',
      'messageAgent:pan-tell',
      undefined,
    );
  });

  it('delivers keyed Claude feedback without transcript confirmation (the dedup door owns the receipt)', async () => {
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-2262',
      issueId: 'PAN-2262',
      status: 'running',
      workspace: '/repo',
      harness: 'claude-code',
      sessionId: 'session-2262',
      deliveryMethod: 'supervisor',
    });

    await expect(messageAgent(
      'agent-pan-2262',
      'review feedback',
      'internal',
      { dedupKey: 'review-feedback:cycle-3' },
    )).resolves.toEqual({
      delivered: true,
      queuedToMail: false,
      confirmed: false,
    });

    // Keyed deliveries never enter the confirming primitive: the dedup door
    // owns their receipt, so no transcript snapshot or probe runs.
    expect(mocks.captureTranscriptUserRecordSnapshot).not.toHaveBeenCalled();
    expect(mocks.probeTranscriptSince).not.toHaveBeenCalled();
    expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
      'agent-pan-2262',
      'review feedback',
      'messageAgent:internal',
      'supervisor',
      { dedupKey: 'review-feedback:cycle-3' },
    );
  });

  it('reports paused-agent mail as undelivered with the gate reason', async () => {
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-2262',
      issueId: 'PAN-2262',
      status: 'stopped',
      workspace: '/repo',
      paused: true,
    });

    await expect(messageAgent('agent-pan-2262', 'review feedback')).resolves.toEqual({
      delivered: false,
      queuedToMail: true,
      reason: 'agent is paused',
    });
    expect(mocks.resumeAgent).not.toHaveBeenCalled();
  });

  it('reports a failed stopped-agent resume without rotating the session', async () => {
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-2262',
      issueId: 'PAN-2262',
      status: 'stopped',
      workspace: '/repo',
    });
    mocks.resumeAgent.mockResolvedValue({ success: false, error: 'session not found' });

    await expect(messageAgent('agent-pan-2262', 'review feedback')).resolves.toEqual({
      delivered: false,
      queuedToMail: true,
      reason: expect.stringContaining('resume failed (session not found)'),
    });
    expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
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

  describe('conversation harness routing (PAN-3879)', () => {
    // Conversations have no agents/<id>/state.json, so messageAgent must
    // resolve the harness from the conversation row. The idle wait is mocked,
    // so no fake timers are needed for these paths.
    // PAN-3849: the liveness oracle reads pane rows as '<pid>\t<dead>' and asks
    // runtime-pid-probe for a runtime pid in the pane subtree; the old
    // hasAgentRuntimeInSubtree seam is no longer on this path.
    function mockLiveConvPane() {
      mocks.getCodexAppServerStatus.mockRejectedValue(new Error('no app-server'));
      mocks.listPaneValues.mockReturnValue(Effect.succeed(['4242\t0']));
    }

    it('resolves an opencode conversation harness from the conversation row', async () => {
      mocks.getAgentStateSync.mockReturnValue(undefined);
      mocks.getConversationByName.mockReturnValue({ name: 'conv-20260917-1267', harness: 'opencode' });
      mockLiveConvPane();
      mocks.findAgentRuntimePidInSubtree.mockResolvedValue(4242);

      const outcome = await messageAgent('conv-20260917-1267', 'steer this session', 'pan-tell');

      // The oracle's subtree probe runs against the conversation harness
      // (acp-host lives), not the claude-code fallback.
      expect(mocks.findAgentRuntimePidInSubtree).toHaveBeenCalledWith('4242', 'opencode');
      expect(mocks.resumeAgent).not.toHaveBeenCalled();
      expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
        'conv-20260917-1267',
        'steer this session',
        'messageAgent:pan-tell',
        undefined,
      );
      expect(outcome).toEqual({ delivered: true, queuedToMail: true, confirmed: false });
    });

    it('skips the zombie resume for an opencode conversation and hands off to delivery', async () => {
      mocks.getAgentStateSync.mockReturnValue(undefined);
      mocks.getConversationByName.mockReturnValue({ name: 'conv-20260917-1267', harness: 'opencode' });
      mockLiveConvPane();
      mocks.findAgentRuntimePidInSubtree.mockResolvedValue(null);

      const outcome = await messageAgent('conv-20260917-1267', 'steer this session', 'pan-tell');

      expect(mocks.resumeAgent).not.toHaveBeenCalled();
      expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
        'conv-20260917-1267',
        'steer this session',
        'messageAgent:pan-tell',
        undefined,
      );
      expect(outcome.delivered).toBe(true);
    });

    it('skips the zombie resume for a codex conversation (PAN-2546/PAN-2580 class)', async () => {
      mocks.getAgentStateSync.mockReturnValue(undefined);
      mocks.getConversationByName.mockReturnValue({ name: 'conv-20260917-1300', harness: 'codex' });
      mockLiveConvPane();
      mocks.findAgentRuntimePidInSubtree.mockResolvedValue(null);

      const outcome = await messageAgent('conv-20260917-1300', 'steer this session', 'pan-tell');

      expect(mocks.resumeAgent).not.toHaveBeenCalled();
      expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
        'conv-20260917-1300',
        'steer this session',
        'messageAgent:pan-tell',
        undefined,
      );
      expect(outcome.delivered).toBe(true);
    });

    it('still resumes a claude-code agent whose runtime exited', async () => {
      mocks.getAgentStateSync.mockReturnValue({
        id: 'agent-pan-2262',
        issueId: 'PAN-2262',
        status: 'running',
        workspace: '/repo',
        harness: 'claude-code',
        sessionId: 'session-2262',
      });
      mocks.getCodexAppServerStatus.mockRejectedValue(new Error('no app-server'));
      mocks.listPaneValues.mockReturnValue(Effect.succeed(['4242\t0']));
      mocks.findAgentRuntimePidInSubtree.mockResolvedValue(null);
      mocks.resumeAgent.mockResolvedValue({ success: true, messageDelivered: true });

      const outcome = await messageAgent('agent-pan-2262', 'review feedback', 'pan-tell');

      expect(mocks.getConversationByName).not.toHaveBeenCalled();
      expect(mocks.resumeAgent).toHaveBeenCalledWith('agent-pan-2262', 'review feedback');
      expect(outcome).toEqual({ delivered: true, queuedToMail: false });
    });

    it('fails loudly for a dead claude-code conversation without calling resume', async () => {
      mocks.getAgentStateSync.mockReturnValue(undefined);
      mocks.getConversationByName.mockReturnValue({ name: 'conv-20260917-1400', harness: 'claude-code' });
      mockLiveConvPane();
      mocks.findAgentRuntimePidInSubtree.mockResolvedValue(null);

      await expect(messageAgent('conv-20260917-1400', 'operator message', 'pan-tell'))
        .rejects.toThrow('cannot be resumed by pan tell');
      expect(mocks.resumeAgent).not.toHaveBeenCalled();
      expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
    });
  });

  describe('confirmed turn for running Claude Code agents (PAN-3846)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mocks.getAgentStateSync.mockReturnValue({
        id: 'agent-pan-2262',
        issueId: 'PAN-2262',
        status: 'running',
        workspace: '/repo',
        harness: 'claude-code',
        sessionId: 'session-2262',
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns delivered+confirmed when the probe matches on the second poll', async () => {
      mocks.probeTranscriptSince
        .mockResolvedValueOnce({ matchedUserRecord: false, realAssistantTurnCount: 0 })
        .mockResolvedValue({ matchedUserRecord: true, realAssistantTurnCount: 0 });

      const promise = messageAgent('agent-pan-2262', 'review feedback', 'pan-tell');
      await vi.advanceTimersByTimeAsync(150);
      await expect(promise).resolves.toEqual({
        delivered: true,
        queuedToMail: true,
        confirmed: true,
      });
      expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
        'agent-pan-2262',
        'review feedback',
        'messageAgent:pan-tell',
        undefined,
      );
      expect(mocks.probeTranscriptSince).toHaveBeenCalledTimes(2);
      expect(mocks.logAgentLifecycleSync).toHaveBeenCalledWith(
        'agent-pan-2262',
        expect.stringContaining('messageAgent confirmed turn in session-2262'),
      );
    });

    it('returns delivered:false, confirmed:false when no turn appears in either attempt', async () => {
      mocks.probeTranscriptSince.mockResolvedValue({ matchedUserRecord: false, realAssistantTurnCount: 0 });

      const promise = messageAgent('agent-pan-2262', 'review feedback', 'pan-tell');
      await vi.advanceTimersByTimeAsync(70_000);
      const outcome = await promise;

      expect(outcome.delivered).toBe(false);
      expect(outcome.confirmed).toBe(false);
      expect(outcome.queuedToMail).toBe(true);
      expect(outcome.reason).toContain('no turn appeared in transcript session-2262');
      // Two attempts of the confirming primitive, each with its own window.
      expect(mocks.deliverAgentMessage).toHaveBeenCalledTimes(2);
      expect(mocks.logAgentLifecycleSync).toHaveBeenCalledWith(
        'agent-pan-2262',
        expect.stringContaining('messageAgent NOT confirmed'),
      );
    });
  });
});
