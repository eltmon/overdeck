/**
 * Delivery no-loss audit (PAN-3846, W7).
 *
 * Deletion gate for the four delivery-recovery patrols (W6): this fixture
 * enumerates every message-delivery call site and every delivery-recovery
 * affordance the pre-Phase-1 surface provided, and proves each has a home in
 * the confirmed-turn surface. It must pass BEFORE the patrol deletions land.
 *
 * 1. Call-site inventory: every `messageAgent(` / `deliverAgentMessage(` /
 *    `resumeAgent(` line under src/lib/cloister, src/cli, src/dashboard/server
 *    (tests excluded), snapshotted below. The test re-scans the tree at run
 *    time (fs, no shell) and fails on any call site not in the snapshot, so
 *    the list stays current — a new delivery path cannot slip in unaudited.
 * 2. Scenario fixtures: the confirmed-turn outcomes every caller relies on.
 * 3. Parked-issue fixture: a confirmed delivery clears the
 *    feedback_delivery_needs_you escalation the retired patrol used to clear.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC_ROOT = resolve(__dirname, '../../../../src');
const SCAN_ROOTS = ['lib/cloister', 'cli', 'dashboard/server'];
const CALL_SITE_RE = /messageAgent\(|deliverAgentMessage\(|resumeAgent\(/;

/** Snapshot produced with:
 * grep -rn "messageAgent(\|deliverAgentMessage(\|resumeAgent(" src/lib/cloister src/cli src/dashboard/server --include=*.ts | grep -v __tests__
 * normalized to `path|trimmed line`. Regenerated after the PAN-3917 cut. */
const KNOWN_CALL_SITES = new Set([
  'cli/commands/recover.ts|const result = await resumeAgent(agentId, undefined, {',
  'cli/commands/resume.ts|const result = await resumeAgent(id, undefined, { allowHost: options.host === true, compact: options.compact === true });',
  'cli/commands/tell.ts|const outcome = await messageAgent(agentId, message, \'pan-tell\', {',
  'cli/commands/unpause.ts|const result = await resumeAgent(agentId);',
  'dashboard/server/pending-feedback.ts|* dies after writing feedback and before messageAgent() completes, startup',
  'dashboard/server/routes/agents/lifecycle-restart.ts|console.log(`[agents/resume] ${id} dispatching resumeAgent() with opts=${JSON.stringify(resumeOpts)}`);',
  'dashboard/server/routes/agents/lifecycle-restart.ts|const result = yield* Effect.promise(() => resumeAgent(id, message, resumeOpts));',
  'dashboard/server/routes/agents/lifecycle-stop.ts|.then(({ resumeAgent }) => resumeAgent(id))',
  'dashboard/server/routes/agents/messaging.ts|await messageAgent(id, message, \'dashboard:user-message\');',
  'dashboard/server/routes/agents/messaging.ts|yield* Effect.promise(() => messageAgent(id, pokeMsg));',
  // PAN-3960: a live planner's user message goes through the backend-aware
  // delivery door (it was a raw tmux sendKeys, which cannot reach a Herdr pane).
  'dashboard/server/routes/misc/planning.ts|const delivery = await deliverAgentMessage(sessionName, message, \'planning user message\');',
  'dashboard/server/routes/agents/permissions.ts|yield* Effect.promise(() => deliverAgentMessage(id, message, \'ask-user-question-answer\'));',
  'dashboard/server/routes/linear-mcp-auth.ts|yield* Effect.promise(() => messageAgent(',
  'dashboard/server/routes/specialists/legacy-routes.ts|await messageAgent(workAgentId, rebaseMsg);',
  'dashboard/server/routes/workspaces.ts|await messageAgent(agentId, message);',
  'dashboard/server/routes/workspaces/merge-strike.ts|assertDelivered(agentId, await messageAgent(agentId, rebaseMsg));',
  'dashboard/server/services/agent-spawner.ts|await messageAgent(agentId, msg);',
  // PAN-3965: the generic CI-failure message reads the delivery outcome; a CI
  // test-gate failure goes through the verification door (verification-escalation).
  'lib/cloister/ci-failure-feedback.ts|const outcome = await messageAgent(agentId, message, \'internal\', {});',
  'lib/cloister/deacon-api-recovery.ts|await deliverAgentMessage(pane.agentId, CONTINUE_MSG, \'deacon-lite:checkApiErrorAgents\');',
  'lib/cloister/deacon-lite.ts|await deliverAgentMessage(',
  'lib/cloister/deacon-swarm-completion.ts|await messageAgent(',
  'lib/cloister/deacon-swarm.ts|sendStallEvent: (agentId, message) => messageAgent(agentId, message, \'deacon:swarm-stall\'),',
  'lib/cloister/feedback-target.ts|const result = await resumeAgent(agentId);',
  'lib/cloister/preemption.ts|const result = await resumeAgent(agent.id);',
  'lib/cloister/preemption.ts|const result = await resumeAgent(agentId);',
  'lib/cloister/review-agent.ts|const resumeResult = await resumeAgent(reviewAgentId, prompt);',
  'lib/cloister/review-convoy.ts|await messageAgent(params.synthesisAgentId, `REVIEWER_FAILED ${subRole} ${result.error ?? result.message}`);',
  'lib/cloister/review-convoy.ts|const resumeResult = await resumeAgent(reviewerAgent, prompt);',
  'lib/cloister/review-verdict-feedback.ts|deliveryOutcome = await messageAgent(',
  'lib/cloister/review-verdict-feedback.ts|deliveryOutcome = await messageAgent(target.agentId, message, \'internal\', {',
  'lib/cloister/service-reactive.ts|await (await import(\'../agents/messaging.js\')).messageAgent(',
  'lib/cloister/specialists-feedback.ts|await messageAgent(agentSession, msg);',
  'lib/cloister/swarm-foreman.ts|await deps.messageAgent(agentId, options.prompt ?? `Continue managing ${issue} as its swarm foreman. Run pan swarm status ${issue} --json before acting.`, \'pan-swarm\');',
  'lib/cloister/uat-failure-feedback.ts|const outcome = await messageAgent(target.agentId, message, \'internal\', { owesRework: true, feedbackRedelivery: true });',
  // PAN-3965: verification feedback delivery moved to verification-escalation, shared with the CI test gate.
  'lib/cloister/verification-escalation.ts|outcome = await messageAgent(target.agentId, message, \'internal\', { owesRework: true, feedbackRedelivery: true });',
  // PAN-3705 follow-up: verification PASS is told to the work agent (no rework owed, no needs-you).
  'lib/cloister/verification-runner.ts|const outcome = await messageAgent(target.agentId, message, \'internal\');',
]);

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walkTs(full);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      yield full;
    }
  }
}

describe('delivery call-site inventory (W7 no-loss audit)', () => {
  it('finds no message-delivery call site missing from the audited list', () => {
    const unknown: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walkTs(join(SRC_ROOT, root))) {
        const rel = relative(SRC_ROOT, file);
        const lines = readFileSync(file, 'utf-8').split('\n');
        for (const line of lines) {
          if (!CALL_SITE_RE.test(line)) continue;
          const key = `${rel}|${line.trim()}`;
          if (!KNOWN_CALL_SITES.has(key)) unknown.push(key);
        }
      }
    }
    expect(unknown).toEqual([]);
  });
});

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
  resumeAgent: vi.fn(),
  getLatestSessionIdSync: vi.fn(),
  captureTranscriptUserRecordSnapshot: vi.fn(),
  probeTranscriptSince: vi.fn(),
  hasAgentRuntimeInSubtree: vi.fn(),
  surfaceIssueFeedbackNeedsYou: vi.fn(),
  resolveIssueFeedbackTarget: vi.fn(),
  writeFeedbackFile: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  findVerdictReport: vi.fn(),
  getReviewStatusSync: vi.fn(() => null),
  // Dispatch slot for messageAgent: scenario fixtures route to the real
  // implementation; the caller-escalation fixtures substitute a failure.
  messageAgentDispatch: vi.fn(),
  realMessageAgent: undefined as undefined | ((...args: unknown[]) => Promise<unknown>),
}));

vi.mock('../../../../src/lib/agents/messaging.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/agents/messaging.js')>();
  mocks.realMessageAgent = actual.messageAgent as (...args: unknown[]) => Promise<unknown>;
  return {
    ...actual,
    messageAgent: (...args: unknown[]) => mocks.messageAgentDispatch(...args),
  };
});

vi.mock('../../../../src/lib/agents/agent-state.js', () => ({
  getAgentDir: (agentId: string) => `/tmp/${agentId}`,
  getAgentResumeGateBlockReason: (state: { paused?: boolean; troubled?: boolean; stoppedByUser?: boolean }) => {
    if (state.paused) return { reason: 'agent is paused' };
    if (state.troubled) return { reason: 'agent is troubled' };
    if (state.stoppedByUser) return { reason: 'agent was stopped by the user' };
    return undefined;
  },
  // Mirrors the real PAN-2668 policy: a completed handoff that owes rework
  // clears the stoppedByUser gate for pipeline feedback.
  decideResumeGate: (
    block: { reason?: string } | undefined,
    _source?: string,
    context?: { hasCompletedHandoff?: boolean; owesRework?: boolean },
  ) => {
    if (!block) return { decision: 'proceed', clearStoppedByUser: false };
    if (context?.hasCompletedHandoff && context?.owesRework) {
      return { decision: 'proceed', clearStoppedByUser: true };
    }
    return { decision: 'block', reason: block.reason, clearStoppedByUser: false };
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

vi.mock('../../../../src/lib/agents/delivery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/agents/delivery.js')>();
  return {
    ...actual,
    deliverAgentMessage: mocks.deliverAgentMessage,
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

// PAN-3849: the liveness oracle's process probe lives here now; the fixture's
// hasAgentRuntimeInSubtree flag drives it (true → pid 4242, false → missing).
vi.mock('../../../../src/lib/agents/runtime-pid-probe.js', () => ({
  findAgentRuntimePidInSubtree: async (...args: unknown[]) => ((await mocks.hasAgentRuntimeInSubtree(...args)) ? 4242 : null),
  findAgentRuntimePidInSubtreeSync: () => null,
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

vi.mock('../../../../src/lib/review-status.js', () => ({
  clearFeedbackDeliveryStuck: vi.fn(),
  getReviewStatusSync: mocks.getReviewStatusSync,

  // PAN-3903: the pipeline read door's bulk read; falls back to the cache map.
  getReviewStatusesSync: () => ({}),
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

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

vi.mock('../../../../src/lib/cloister/feedback-target.js', () => ({
  resolveIssueFeedbackTarget: mocks.resolveIssueFeedbackTarget,
  surfaceIssueFeedbackNeedsYou: mocks.surfaceIssueFeedbackNeedsYou,
}));

vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: mocks.writeFeedbackFile,
}));

vi.mock('../../../../src/lib/cloister/review-verdict-report.js', () => ({
  findVerdictReport: mocks.findVerdictReport,
}));

import { Effect } from 'effect';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { messageAgent } from '../../../../src/lib/agents/messaging.js';

describe('W7 scenario fixtures: confirmed-turn delivery outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messageAgentDispatch.mockImplementation((...args: unknown[]) => mocks.realMessageAgent!(...args));
    mocks.getAgentRuntimeStateSync.mockReturnValue({ state: 'idle', lastActivity: new Date().toISOString() });
    mocks.sessionExists.mockReturnValue(Effect.succeed(true));
    mocks.listPaneValues.mockReturnValue(Effect.succeed(['4242\t0']));
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
  });

  afterEach(() => {
    rmSync('/tmp/agent-pan-3679', { recursive: true, force: true });
    rmSync('/tmp/agent-pan-3846', { recursive: true, force: true });
  });

  describe('(a) idle Claude Code session whose transcript grows', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mocks.getAgentStateSync.mockReturnValue({
        id: 'agent-pan-3846',
        issueId: 'PAN-3846',
        status: 'running',
        workspace: '/repo',
        harness: 'claude-code',
        sessionId: 'session-3846',
      });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('delivers with the turn confirmed', async () => {
      // Transcript grows: the probe sees the message as a new turn. (The
      // second-poll retry granularity is covered by message-agent.test.ts,
      // which exercises the same primitive in its own harness.)
      mocks.probeTranscriptSince.mockResolvedValue({ matchedUserRecord: true, realAssistantTurnCount: 0 });

      const promise = messageAgent('agent-pan-3846', 'review feedback', 'internal');
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(promise).resolves.toEqual({
        delivered: true,
        queuedToMail: true,
        confirmed: true,
      });
    });
  });

  describe('(b) session whose transcript never grows', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mocks.getAgentStateSync.mockReturnValue({
        id: 'agent-pan-3846',
        issueId: 'PAN-3846',
        status: 'running',
        workspace: '/repo',
        harness: 'claude-code',
        sessionId: 'session-3846',
      });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns delivered:false so the caller escalates', async () => {
      const promise = messageAgent('agent-pan-3846', 'review feedback', 'internal');
      await vi.advanceTimersByTimeAsync(70_000);
      const outcome = await promise;
      expect(outcome.delivered).toBe(false);
      expect(outcome.confirmed).toBe(false);
      expect(outcome.reason).toContain('no turn appeared');
    });
  });

  it('(c) dead pane never reports delivered', async () => {
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-3846',
      issueId: 'PAN-3846',
      status: 'running',
      workspace: '/repo',
      harness: 'claude-code',
      sessionId: 'session-3846',
    });
    mocks.listPaneValues.mockReturnValue(Effect.succeed(['4242']));
    mocks.hasAgentRuntimeInSubtree.mockResolvedValue(false);
    mocks.resumeAgent.mockResolvedValue({ success: false, error: 'session not found' });

    const outcome = await messageAgent('agent-pan-3846', 'review feedback', 'internal')
      .then(
        (o) => ({ kind: 'outcome' as const, delivered: o.delivered }),
        (err: unknown) => ({ kind: 'threw' as const, message: err instanceof Error ? err.message : String(err) }),
      );

    if (outcome.kind === 'outcome') {
      expect(outcome.delivered).toBe(false);
    } else {
      expect(outcome.message).toContain('session is dead and resume failed');
    }
  });

  it('(d) stoppedByUser with a completion marker and owesRework clears the gate and resumes (PAN-2668)', async () => {
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-3846',
      issueId: 'PAN-3846',
      status: 'stopped',
      stoppedByUser: true,
      workspace: '/repo',
      harness: 'claude-code',
    });
    mkdirSync('/tmp/agent-pan-3846', { recursive: true });
    writeFileSync('/tmp/agent-pan-3846/completed', new Date().toISOString());

    const outcome = await messageAgent('agent-pan-3846', 'review feedback', 'internal', { owesRework: true });

    expect(mocks.resumeAgent).toHaveBeenCalledWith('agent-pan-3846', 'review feedback');
    expect(outcome.delivered).toBe(true);
    expect(existsSync('/tmp/agent-pan-3846/completed')).toBe(true);
  });

  it('(e) paused agent is not delivered, with the pause reason', async () => {
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-3846',
      issueId: 'PAN-3846',
      status: 'stopped',
      workspace: '/repo',
      paused: true,
    });

    await expect(messageAgent('agent-pan-3846', 'review feedback', 'internal')).resolves.toEqual({
      delivered: false,
      queuedToMail: true,
      reason: 'agent is paused',
    });
    expect(mocks.resumeAgent).not.toHaveBeenCalled();
  });

  describe('parked-issue fixture: a confirmed feedback redelivery is the exit (W7 step 3)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // PAN-3917: the feedback_delivery_needs_you escalation lived on the
      // deleted review_status row, so there is no flag left to clear. What the
      // eight parked issues (PAN-3679, 3677, 3685, 3689, 3690, 3740, 3810,
      // 3814) needed is what survives: the redelivery itself is confirmed.
      mocks.getAgentStateSync.mockReturnValue({
        id: 'agent-pan-3679',
        issueId: 'PAN-3679',
        status: 'running',
        workspace: '/repo',
        harness: 'claude-code',
        sessionId: 'session-3679',
      });
      mocks.probeTranscriptSince.mockResolvedValue({ matchedUserRecord: true, realAssistantTurnCount: 0 });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('confirms the turn for a feedback redelivery', async () => {
      const promise = messageAgent('agent-pan-3679', 'review feedback', 'internal', { owesRework: true, feedbackRedelivery: true });
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(promise).resolves.toEqual({
        delivered: true,
        queuedToMail: true,
        confirmed: true,
      });
    });
  });
});

describe('W7 caller escalation fixtures (scenario b callers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProjectFromIssueSync.mockReturnValue(undefined);
    mocks.resolveIssueFeedbackTarget.mockResolvedValue({ agentId: 'agent-pan-3846' });
    mocks.surfaceIssueFeedbackNeedsYou.mockResolvedValue(undefined);
    mocks.writeFeedbackFile.mockReturnValue(Effect.succeed({ success: true, filePath: '/tmp/feedback.md' }));
  });

  it('uat-failure-feedback surfaces a needs-you when delivery is not confirmed', async () => {
    mocks.messageAgentDispatch.mockResolvedValue({
      delivered: false,
      queuedToMail: true,
      confirmed: false,
      reason: 'message was injected but no turn appeared in transcript session-1 within the confirmation window (2 attempts)',
    });
    const { relayUatFailureFeedbackPromise, resetUatFailureFeedbackStateForTests } =
      await import('../../../../src/lib/cloister/uat-failure-feedback.js');
    resetUatFailureFeedbackStateForTests();

    const result = await relayUatFailureFeedbackPromise({
      issueId: 'PAN-3846',
      uatNotes: 'login flow broken',
      workspacePath: '/tmp/ws',
    });

    expect(result.agentMessageSent).toBe(false);
    expect(result.needsYouSurfaced).toBe(true);
    expect(mocks.surfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith(
      'PAN-3846',
      expect.stringContaining('Feedback delivery to agent-pan-3846 failed'),
      expect.objectContaining({ specialist: 'uat-agent' }),
    );
  });

  it('review-verdict-feedback surfaces a needs-you when delivery is not confirmed', async () => {
    mocks.messageAgentDispatch.mockResolvedValue({
      delivered: false,
      queuedToMail: true,
      confirmed: false,
      reason: 'message was injected but no turn appeared in transcript session-1 within the confirmation window (2 attempts)',
    });
    mocks.findVerdictReport.mockResolvedValue(null);
    const { deliverReviewVerdictFeedback } = await import('../../../../src/lib/cloister/review-verdict-feedback.js');

    const result = await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-3846',
      verdict: 'blocked',
      notes: 'two findings',
      workspacePath: '/tmp/ws',
    }));

    expect(result.agentMessageSent).toBe(false);
    expect(mocks.surfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith(
      'PAN-3846',
      expect.stringContaining('Feedback delivery to agent-pan-3846 failed'),
      expect.objectContaining({ specialist: 'review-agent' }),
    );
  });
});
