import { Effect } from 'effect';
/**
 * Tests for conversations route helpers.
 *
 * The route itself is an Effect layer and not straightforwardly unit-testable
 * without the full Effect runtime. We test the extracted helper logic and the
 * database-integration behavior through the conversations-db module.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildForkRequest,
  clearPendingConversationControlAcksForTests,
  conversationNeedsRunningRepair,
  conversationSessionAliveFromState,
  getPendingConversationControlAckCount,
  getInFlightForkPipelineCount,
  deliverConversationViaControlChannel,
  handleConversationCompact,
  handleConversationControlAck,
  handleConversationSwitchModel,
  handleConversationThinkingLevel,
  parseSummaryForkFocus,
  pickDeliverAs,
  readExistingHandoffDoc,
  recoverStuckForks,
  registerConversationControlAck,
  registerInFlightForkPipeline,
  resolveConversationControlAck,
  shouldReportUnresolvedLiveSession,
  waitForInFlightForkPipelines,
} from '../conversations.js';
import { deliverAgentMessage } from '../../../../lib/agents.js';

vi.mock('../../../../lib/agents.js', async () => {
  const actual = await vi.importActual('../../../../lib/agents.js');
  return { ...(actual as object), deliverAgentMessage: vi.fn().mockResolvedValue(undefined) };
});

// ─── Sanitize / name generation logic ────────────────────────────────────────
// These are internal helpers extracted here for direct testing.

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
}

function generateConversationName(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${date}-1234`;
}

describe('sanitizeName', () => {
  it('allows alphanumeric, dash, underscore', () => {
    expect(sanitizeName('my-session_1')).toBe('my-session_1');
  });

  it('replaces spaces with dashes', () => {
    expect(sanitizeName('hello world')).toBe('hello-world');
  });

  it('replaces special characters', () => {
    expect(sanitizeName('a/b:c@d')).toBe('a-b-c-d');
  });

  it('truncates to 64 characters', () => {
    const long = 'a'.repeat(100);
    expect(sanitizeName(long)).toHaveLength(64);
  });

  it('preserves already-safe names unchanged', () => {
    expect(sanitizeName('crash-recovery')).toBe('crash-recovery');
  });
});

describe('generateConversationName', () => {
  it('is YYYYMMDD-NNNN format (no conv- prefix)', () => {
    expect(generateConversationName()).toMatch(/^\d{8}-/);
  });

  it('contains today\'s date in YYYYMMDD format', () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    expect(generateConversationName()).toContain(today);
  });
});

describe('conversationSessionAliveFromState', () => {
  it('does not resurrect an ended conversation when its tmux wrapper still exists', () => {
    expect(conversationSessionAliveFromState({ status: 'ended', forkStatus: null }, true)).toBe(false);
  });

  it('keeps active non-fork conversations live when tmux is live', () => {
    expect(conversationSessionAliveFromState({ status: 'active', forkStatus: null }, true)).toBe(true);
  });

  it('keeps provisioning forks out of the live-session path', () => {
    expect(conversationSessionAliveFromState({ status: 'active', forkStatus: 'spawning' }, true)).toBe(false);
  });
});

describe('conversationNeedsRunningRepair', () => {
  it('repairs stale-ended non-fork conversations only when tmux and harness are alive', () => {
    expect(conversationNeedsRunningRepair(
      { status: 'ended', forkStatus: null },
      true,
      true,
    )).toBe(true);
  });

  it('does not repair keep-alive corpses or active rows', () => {
    expect(conversationNeedsRunningRepair(
      { status: 'ended', forkStatus: null },
      true,
      false,
    )).toBe(false);
    expect(conversationNeedsRunningRepair(
      { status: 'active', forkStatus: null },
      true,
      true,
    )).toBe(false);
  });

  it('does not repair in-flight fork rows', () => {
    expect(conversationNeedsRunningRepair(
      { status: 'ended', forkStatus: 'spawning' },
      true,
      true,
    )).toBe(false);
  });
});

describe('shouldReportUnresolvedLiveSession', () => {
  it('reports the banner for an active claude-code conversation (launcher pins --session-id)', () => {
    expect(shouldReportUnresolvedLiveSession({ status: 'active', harness: 'claude-code' })).toBe(true);
  });

  it('treats a null harness as claude-code (default) and reports the banner', () => {
    expect(shouldReportUnresolvedLiveSession({ status: 'active', harness: null })).toBe(true);
  });

  it('does NOT report the banner for a freshly-spawned codex conversation (rollout written on first turn)', () => {
    expect(shouldReportUnresolvedLiveSession({ status: 'active', harness: 'codex' })).toBe(false);
  });

  it('does NOT report the banner for a freshly-spawned pi conversation (session JSONL written on first turn)', () => {
    expect(shouldReportUnresolvedLiveSession({ status: 'active', harness: 'pi' })).toBe(false);
  });

  it('does NOT report the banner for an ended conversation regardless of harness', () => {
    expect(shouldReportUnresolvedLiveSession({ status: 'ended', harness: 'claude-code' })).toBe(false);
  });

  it('does NOT report the banner when there is no conversation record', () => {
    expect(shouldReportUnresolvedLiveSession(null)).toBe(false);
    expect(shouldReportUnresolvedLiveSession(undefined)).toBe(false);
  });
});

// ─── Conversation DB integration ──────────────────────────────────────────────

let TEST_HOME: string;

async function resetDb() {
  const { closeOverdeckDatabaseSync } = await import('../../../../lib/overdeck/infra.js');
  const { resetDiscoveredSessionsSchemaBootstrap } = await import('../../../../lib/overdeck/discovered-sessions.js');
  closeOverdeckDatabaseSync();
  resetDiscoveredSessionsSchemaBootstrap();
}

function decodeJsonResponse(response: { status: number; body: unknown }) {
  const payload = response.body as { body: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

function decodeTextResponse(response: { body: unknown }) {
  const payload = response.body as { body: Uint8Array } | null;
  return payload?.body ? new TextDecoder().decode(payload.body) : '';
}

async function readPendingControlCommand(agentId: string): Promise<Record<string, unknown>> {
  const controlDir = join(process.env.OVERDECK_HOME!, 'agents', agentId, 'control');
  await vi.waitFor(() => {
    expect(readdirSync(controlDir).filter((name) => name.endsWith('.json'))).toHaveLength(1);
  });
  const file = join(controlDir, readdirSync(controlDir).find((name) => name.endsWith('.json'))!);
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

describe('buildForkRequest', () => {
  it('captures the complete runForkPipeline argument set for persistence', () => {
    expect(buildForkRequest({
      parentConversationName: 'source-conv',
      sessionId: 'session-123',
      forkMode: 'handoff',
      summaryModel: 'summary-model',
      localSummaryOnly: false,
      includeThinkingInSummary: true,
      summaryHarness: 'claude-code',
      handoffFocus: 'continue the API wiring',
      handoffAuthor: 'external',
      handoffAuthorModel: 'handoff-model',
      handoffAuthorHarness: 'pi',
    })).toEqual({
      parentConversationName: 'source-conv',
      sessionId: 'session-123',
      forkMode: 'handoff',
      summaryModel: 'summary-model',
      localSummaryOnly: false,
      includeThinkingInSummary: true,
      summaryHarness: 'claude-code',
      handoffFocus: 'continue the API wiring',
      handoffAuthor: 'external',
      handoffAuthorModel: 'handoff-model',
      handoffAuthorHarness: 'pi',
    });
  });

  it('omits undefined optional fork fields from the persisted JSON shape', () => {
    expect(JSON.stringify(buildForkRequest({
      parentConversationName: 'source-conv',
      sessionId: 'session-123',
      forkMode: 'summary',
      localSummaryOnly: true,
      includeThinkingInSummary: false,
      handoffAuthor: 'external',
    }))).toBe(JSON.stringify({
      parentConversationName: 'source-conv',
      sessionId: 'session-123',
      forkMode: 'summary',
      localSummaryOnly: true,
      includeThinkingInSummary: false,
      handoffAuthor: 'external',
    }));
  });
});

describe('in-flight fork pipeline shutdown grace', () => {
  afterEach(async () => {
    vi.useRealTimers();
    await waitForInFlightForkPipelines(0);
  });

  it('is a no-op when no fork pipelines are in flight', async () => {
    await expect(waitForInFlightForkPipelines(10_000)).resolves.toEqual({ completed: true, count: 0 });
  });

  it('deregisters fork pipelines when they settle', async () => {
    const pipeline = registerInFlightForkPipeline(Promise.resolve());
    expect(getInFlightForkPipelineCount()).toBe(1);

    await pipeline;

    expect(getInFlightForkPipelineCount()).toBe(0);
  });

  it('bounds shutdown waiting when a fork pipeline does not settle', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const pipeline = registerInFlightForkPipeline(new Promise<void>((resolve) => {
      finish = resolve;
    }));

    const wait = waitForInFlightForkPipelines(10_000);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(wait).resolves.toEqual({ completed: false, count: 1 });
    expect(getInFlightForkPipelineCount()).toBe(1);

    finish();
    await pipeline;
    expect(getInFlightForkPipelineCount()).toBe(0);
  });
});

describe('conversation control ack registry', () => {
  afterEach(() => {
    clearPendingConversationControlAcksForTests();
    vi.useRealTimers();
  });

  it('resolves a pending command when a successful ack arrives', async () => {
    const pending = registerConversationControlAck('cmd-1');

    expect(getPendingConversationControlAckCount()).toBe(1);
    expect(handleConversationControlAck({ id: 'cmd-1', ok: true })).toEqual({
      status: 200,
      body: { ok: true, outcome: 'resolved' },
    });

    await expect(pending).resolves.toBeUndefined();
    expect(getPendingConversationControlAckCount()).toBe(0);
  });

  it('rejects and cleans up when no ack arrives before the timeout', async () => {
    vi.useFakeTimers();
    const pending = registerConversationControlAck('cmd-timeout', 2_000);
    const rejection = expect(pending).rejects.toThrow('Timed out waiting for conversation control ack cmd-timeout');

    await vi.advanceTimersByTimeAsync(2_000);

    await rejection;
    expect(getPendingConversationControlAckCount()).toBe(0);
  });

  it('ignores unknown ack ids without affecting pending commands', async () => {
    const pending = registerConversationControlAck('cmd-real');

    expect(handleConversationControlAck({ id: 'cmd-missing', ok: true })).toEqual({
      status: 200,
      body: { ok: true, outcome: 'unknown' },
    });
    expect(getPendingConversationControlAckCount()).toBe(1);
    expect(resolveConversationControlAck({ id: 'cmd-real', ok: true })).toBe('resolved');

    await expect(pending).resolves.toBeUndefined();
  });

  it('rejects malformed endpoint payloads without mutating pending commands', () => {
    registerConversationControlAck('cmd-real');

    expect(handleConversationControlAck({ ok: true })).toEqual({
      status: 400,
      body: { error: 'id is required' },
    });
    expect(getPendingConversationControlAckCount()).toBe(1);
  });

  it('rejects a pending command when the ack reports failure', async () => {
    const pending = registerConversationControlAck('cmd-fail');

    expect(resolveConversationControlAck({ id: 'cmd-fail', ok: false, error: 'unsupported' })).toBe('rejected');

    await expect(pending).rejects.toThrow('unsupported');
    expect(getPendingConversationControlAckCount()).toBe(0);
  });
});

describe('conversation control channel delivery', () => {
  afterEach(() => {
    clearPendingConversationControlAcksForTests();
  });

  it('writes a prompt command and resolves when the ack arrives', async () => {
    const delivery = deliverConversationViaControlChannel(
      { tmuxSession: 'conv-pi' },
      'hello pi',
      { source: 'operator', deliverAs: 'prompt' },
    );
    const controlDir = join(process.env.OVERDECK_HOME!, 'agents', 'conv-pi', 'control');
    await vi.waitFor(() => {
      expect(readdirSync(controlDir).filter((name) => name.endsWith('.json'))).toHaveLength(1);
    });
    const file = join(controlDir, readdirSync(controlDir).find((name) => name.endsWith('.json'))!);
    const command = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

    expect(command).toMatchObject({
      type: 'prompt',
      message: 'hello pi',
      source: 'operator',
    });

    handleConversationControlAck({ id: command.id, ok: true });
    await expect(delivery).resolves.toBeUndefined();
  });

  it('defaults busy pi conversations to steer and honors follow_up override', () => {
    const heartbeatDir = join(process.env.OVERDECK_HOME!, 'heartbeats');
    mkdirSync(heartbeatDir, { recursive: true });
    writeFileSync(join(heartbeatDir, 'conv-busy.json'), JSON.stringify({
      timestamp: new Date().toISOString(),
      last_action: 'tool_end',
    }));

    expect(pickDeliverAs({ tmuxSession: 'conv-idle' }, undefined)).toBe('prompt');
    expect(pickDeliverAs({ tmuxSession: 'conv-busy' }, undefined)).toBe('steer');
    expect(pickDeliverAs({ tmuxSession: 'conv-busy' }, 'follow_up')).toBe('follow_up');
  });
});

describe('readExistingHandoffDoc', () => {
  it('reuses a persisted handoff document when it still exists', async () => {
    const docPath = join(TEST_HOME, 'handoff.md');
    writeFileSync(docPath, '## Handoff\n\nContinue here.\n');

    await expect(readExistingHandoffDoc({ handoffDocPath: docPath })).resolves.toBe('## Handoff\n\nContinue here.\n');
  });

  it('returns null when no reusable handoff document exists', async () => {
    await expect(readExistingHandoffDoc({ handoffDocPath: null })).resolves.toBeNull();
    await expect(readExistingHandoffDoc({ handoffDocPath: join(TEST_HOME, 'missing.md') })).resolves.toBeNull();
  });
});

describe('parseSummaryForkFocus', () => {
  it('trims handoff focus text', async () => {
    expect(parseSummaryForkFocus('  continue the API wiring  ')).toEqual({
      ok: true,
      focus: 'continue the API wiring',
    });
  });

  it('normalizes blank and absent focus to undefined', async () => {
    expect(parseSummaryForkFocus(undefined)).toEqual({ ok: true, focus: undefined });
    expect(parseSummaryForkFocus('   ')).toEqual({ ok: true, focus: undefined });
  });

  it('rejects non-string focus values', async () => {
    expect(parseSummaryForkFocus(42)).toEqual({ ok: false, error: 'focus must be a string' });
  });

  it('rejects focus values longer than 500 characters', async () => {
    expect(parseSummaryForkFocus('a'.repeat(501))).toEqual({
      ok: false,
      error: 'focus must be 500 characters or fewer',
    });
  });

  it('rejects control characters in focus', async () => {
    expect(parseSummaryForkFocus('continue\nthen ship')).toEqual({
      ok: false,
      error: 'focus must not contain control characters',
    });
  });
});

beforeEach(async () => {
  // Close any stale DB connection from a previous test before changing OVERDECK_HOME
  await resetDb();
  TEST_HOME = join(tmpdir(), `pan-416-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.OVERDECK_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.OVERDECK_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('conversations route — DB integration', () => {
  describe('conversation live control endpoints', () => {
    afterEach(() => {
      clearPendingConversationControlAcksForTests();
    });

    it('writes a thinking-level command and persists the effort', async () => {
      const { createConversation, getConversationByName } = await import('../../../../lib/overdeck/conversations.js');

      createConversation({
        name: 'pi-thinking',
        tmuxSession: 'conv-pi-thinking',
        cwd: process.cwd(),
        harness: 'pi',
        status: 'active',
      });

      const responsePromise = handleConversationThinkingLevel('pi-thinking', { level: 'high' });
      const command = await readPendingControlCommand('conv-pi-thinking');

      expect(command).toMatchObject({
        type: 'set_thinking_level',
        level: 'high',
      });

      handleConversationControlAck({ id: command.id, ok: true });
      const response = await responsePromise;
      const body = decodeJsonResponse(response);

      expect(response.status).toBe(200);
      expect(body).toEqual({ ok: true, effort: 'high' });
      expect(getConversationByName('pi-thinking')?.effort).toBe('high');
    });

    it('rejects invalid thinking levels without writing a command', async () => {
      const { createConversation } = await import('../../../../lib/overdeck/conversations.js');

      createConversation({
        name: 'pi-bad-thinking',
        tmuxSession: 'conv-pi-bad-thinking',
        cwd: process.cwd(),
        harness: 'pi',
        status: 'active',
      });

      const response = await handleConversationThinkingLevel('pi-bad-thinking', { level: 'turbo' });
      const body = decodeJsonResponse(response);

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid thinking level');
      expect(existsSync(join(process.env.OVERDECK_HOME!, 'agents', 'conv-pi-bad-thinking', 'control'))).toBe(false);
    });

    it('writes a compact command for pi conversations', async () => {
      const { createConversation } = await import('../../../../lib/overdeck/conversations.js');

      createConversation({
        name: 'pi-compact',
        tmuxSession: 'conv-pi-compact',
        cwd: process.cwd(),
        harness: 'ohmypi',
        status: 'active',
      });

      const responsePromise = handleConversationCompact('pi-compact');
      const command = await readPendingControlCommand('conv-pi-compact');

      expect(command).toMatchObject({ type: 'compact' });

      handleConversationControlAck({ id: command.id, ok: true });
      const response = await responsePromise;
      const body = decodeJsonResponse(response);

      expect(response.status).toBe(200);
      expect(body).toEqual({ ok: true });
    });

    it('updates a running pi conversation model through the control channel', async () => {
      const { createConversation, getConversationByName } = await import('../../../../lib/overdeck/conversations.js');

      createConversation({
        name: 'pi-switch-model',
        tmuxSession: 'conv-pi-switch-model',
        cwd: process.cwd(),
        harness: 'pi',
        model: 'old-model',
        claudeSessionId: 'pi-session-jsonl',
        status: 'active',
      });

      const responsePromise = handleConversationSwitchModel('pi-switch-model', { model: 'new-model' });
      const command = await readPendingControlCommand('conv-pi-switch-model');

      expect(command).toMatchObject({
        type: 'set_model',
        model: 'new-model',
      });

      handleConversationControlAck({ id: command.id, ok: true });
      const response = await responsePromise;
      const body = decodeJsonResponse(response);

      expect(response.status).toBe(200);
      expect(body.model).toBe('new-model');
      expect(getConversationByName('pi-switch-model')?.model).toBe('new-model');
    });

    it('keeps started claude-code conversations locked to their model', async () => {
      const { createConversation } = await import('../../../../lib/overdeck/conversations.js');

      createConversation({
        name: 'claude-switch-model',
        tmuxSession: 'conv-claude-switch-model',
        cwd: process.cwd(),
        harness: 'claude-code',
        model: 'old-model',
        claudeSessionId: 'claude-session-jsonl',
        status: 'active',
      });

      const response = await handleConversationSwitchModel('claude-switch-model', { model: 'new-model' });
      const body = decodeJsonResponse(response);

      expect(response.status).toBe(409);
      expect(body.error).toBe('Conversation model is locked once a conversation has started');
      expect(existsSync(join(process.env.OVERDECK_HOME!, 'agents', 'conv-claude-switch-model', 'control'))).toBe(false);
    });
  });

  it('keeps claude-code composer delivery on deliverAgentMessage', async () => {
    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { handleConversationMessage } = await import('../conversations.js');
    vi.mocked(deliverAgentMessage).mockClear();

    createConversation({
      name: 'claude-conv',
      tmuxSession: 'conv-claude',
      cwd: '/tmp',
      harness: 'claude-code',
      status: 'active',
    });

    const response = await handleConversationMessage('claude-conv', { message: 'hello claude' });
    const body = decodeJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(deliverAgentMessage).toHaveBeenCalledWith(
      'conv-claude',
      'hello claude',
      'conversation-message',
      'auto',
    );
  });

  it('returns a persisted handoff document as markdown', async () => {
    const { createConversation, getConversationByName, recordConversationHandoff } = await import('../../../../lib/overdeck/conversations.js');
    const { handleConversationHandoffDoc } = await import('../conversations.js');

    const docPath = join(TEST_HOME, 'handoffs', 'source-2026-05-23T04-35-00.000Z.md');
    mkdirSync(join(TEST_HOME, 'handoffs'), { recursive: true });
    writeFileSync(docPath, '## Current objective\n\nContinue the work.\n\n## Suggested skills\n\n- /pan-workflow\n');
    createConversation({ name: 'source-conv', tmuxSession: 'conv-source', cwd: '/cwd' });
    const target = createConversation({ name: 'target-conv', tmuxSession: 'conv-target', cwd: '/cwd' });
    recordConversationHandoff('source-conv', 'target-conv', docPath);

    const response = await handleConversationHandoffDoc('target-conv');

    expect(response.status).toBe(200);
    expect(decodeTextResponse(response)).toContain('## Suggested skills');
    expect(getConversationByName('source-conv')?.handoffTargetConvId).toBe(target.id);
  });

  it('returns 404 when a conversation has no handoff document path', async () => {
    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { handleConversationHandoffDoc } = await import('../conversations.js');

    createConversation({ name: 'plain-conv', tmuxSession: 'conv-plain', cwd: '/cwd' });

    const response = await handleConversationHandoffDoc('plain-conv');

    expect(response.status).toBe(404);
    expect(decodeJsonResponse(response)).toEqual({ error: 'Handoff document not found' });
  });

  it('returns 410 when the recorded handoff document is missing on disk', async () => {
    const { createConversation, recordConversationHandoff } = await import('../../../../lib/overdeck/conversations.js');
    const { handleConversationHandoffDoc } = await import('../conversations.js');

    const docPath = join(TEST_HOME, 'handoffs', 'missing.md');
    createConversation({ name: 'source-conv', tmuxSession: 'conv-source', cwd: '/cwd' });
    createConversation({ name: 'target-conv', tmuxSession: 'conv-target', cwd: '/cwd' });
    recordConversationHandoff('source-conv', 'target-conv', docPath);

    const response = await handleConversationHandoffDoc('target-conv');

    expect(response.status).toBe(410);
    expect(decodeJsonResponse(response)).toEqual({ error: 'Handoff document is no longer available' });
  });

  it('stores uploaded images under the owning conversation attachment directory', async () => {
    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { handleConversationImageUpload } = await import('../conversations.js');
    const { getConversationAttachmentDir } = await import('../../services/conversation-attachments.js');

    createConversation({ name: 'upload-test', tmuxSession: 'conv-upload-test', cwd: '/cwd' });

    const bytes = Buffer.from([137, 80, 78, 71]);
    const response = await handleConversationImageUpload('upload-test', 'evidence.txt', bytes, 'image/png');

    const body = decodeJsonResponse(response);
    expect(response.status).toBe(200);
    expect(body.path).toEqual(expect.stringMatching(new RegExp(`${getConversationAttachmentDir('upload-test').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.+\\.png$`)));
    expect(readFileSync(body.path as string)).toEqual(Buffer.from([137, 80, 78, 71]));
  });

  it('rejects unsupported mimeType before writing files', async () => {
    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { handleConversationImageUpload } = await import('../conversations.js');

    createConversation({ name: 'upload-test', tmuxSession: 'conv-upload-test', cwd: '/cwd' });

    const response = await handleConversationImageUpload('upload-test', 'evidence.png', Buffer.from([0]), 'image/tiff');

    expect(response.status).toBe(400);
    expect(decodeJsonResponse(response)).toEqual({ error: 'Unsupported mimeType: image/tiff' });
  });

  it('rejects magic-byte mismatch for valid mimeType', async () => {
    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { handleConversationImageUpload } = await import('../conversations.js');

    createConversation({ name: 'upload-test', tmuxSession: 'conv-upload-test', cwd: '/cwd' });

    // Valid PNG mimeType but content bytes are JPEG magic numbers, not PNG
    const response = await handleConversationImageUpload(
      'upload-test',
      'fake.png',
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      'image/png',
    );

    expect(response.status).toBe(400);
    expect(decodeJsonResponse(response)).toEqual({
      error: 'File content does not match declared MIME type',
    });
  });

  it('rejects oversized upload payloads before writing files', async () => {
    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { handleConversationImageUpload } = await import('../conversations.js');

    createConversation({ name: 'upload-test', tmuxSession: 'conv-upload-test', cwd: '/cwd' });

    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
    const response = await handleConversationImageUpload('upload-test', 'oversized.png', oversized, 'image/png');

    expect(response.status).toBe(400);
    expect(decodeJsonResponse(response)).toEqual({ error: 'Payload exceeds maximum size of 5242880 bytes' });
  });

  it('rejects empty upload payloads', async () => {
    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { handleConversationImageUpload } = await import('../conversations.js');

    createConversation({ name: 'upload-test', tmuxSession: 'conv-upload-test', cwd: '/cwd' });

    const response = await handleConversationImageUpload('upload-test', 'empty.png', Buffer.alloc(0), 'image/png');

    expect(response.status).toBe(400);
    expect(decodeJsonResponse(response)).toEqual({ error: 'Payload is empty' });
  });

  it('rejects attachment reuse across conversations while preserving referenced uploads', async () => {
    const { deliverAgentMessage } = await import('../../../../lib/agents.js');
    const deliverMock = vi.mocked(deliverAgentMessage);
    deliverMock.mockClear();

    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { handleConversationImageUpload, handleConversationMessage } = await import('../conversations.js');

    createConversation({ name: 'owner-conv', tmuxSession: 'conv-owner-conv', cwd: '/cwd' });
    createConversation({ name: 'other-conv', tmuxSession: 'conv-other-conv', cwd: '/cwd' });

    const bytes = Buffer.from([137, 80, 78, 71]);
    const uploadResponse = await handleConversationImageUpload('owner-conv', 'owned.png', bytes, 'image/png');
    const uploadedPath = decodeJsonResponse(uploadResponse).path as string;

    const { extractConversationAttachmentPaths, hasConversationAttachment } = await import('../../services/conversation-attachments.js');
    expect(extractConversationAttachmentPaths(`hello\n@${uploadedPath}`)).toEqual([uploadedPath]);
    expect(await hasConversationAttachment('owner-conv', uploadedPath)).toBe(true);
    expect(await hasConversationAttachment('other-conv', uploadedPath)).toBe(false);

    // Prose @paths (unmanaged) are allowed to pass through
    const manualPath = '/home/eltmon/Projects/overdeck/README.md';
    const proseResponse = await handleConversationMessage('owner-conv', { message: `hello\n@${manualPath}` });
    expect(proseResponse.status).toBe(200);
    expect(deliverMock).toHaveBeenLastCalledWith('conv-owner-conv', `hello\n@${manualPath}`, 'conversation-message', expect.any(String));

    const sendResponse = await handleConversationMessage('owner-conv', { message: `hello\n@${uploadedPath}` });
    expect(sendResponse.status).toBe(200);
    expect(deliverMock).toHaveBeenLastCalledWith('conv-owner-conv', `hello\n@${uploadedPath}`, 'conversation-message', expect.any(String));
    expect(existsSync(uploadedPath)).toBe(true);

    const rejectedResponse = await handleConversationMessage('other-conv', { message: `hello\n@${uploadedPath}` });
    expect(rejectedResponse.status).toBe(400);
    expect(decodeJsonResponse(rejectedResponse)).toEqual({ error: 'One or more attached images are unavailable for this conversation' });
    expect(existsSync(uploadedPath)).toBe(true);
  });

  it('delete-image removes only conversation-owned uploads', async () => {
    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { handleConversationImageUpload } = await import('../conversations.js');
    const { removeConversationAttachment } = await import('../../services/conversation-attachments.js');

    createConversation({ name: 'owner-conv', tmuxSession: 'conv-owner-conv', cwd: '/cwd' });
    createConversation({ name: 'other-conv', tmuxSession: 'conv-other-conv', cwd: '/cwd' });

    const bytes = Buffer.from([137, 80, 78, 71]);
    const uploadResponse = await handleConversationImageUpload('owner-conv', 'owned.png', bytes, 'image/png');
    const uploadedPath = decodeJsonResponse(uploadResponse).path as string;

    expect(await removeConversationAttachment('other-conv', uploadedPath)).toBe(false);
    expect(existsSync(uploadedPath)).toBe(true);

    expect(await removeConversationAttachment('owner-conv', uploadedPath)).toBe(true);
    expect(existsSync(uploadedPath)).toBe(false);
  });

  it('ended and archived cleanup preserve unsent uploads newer than session history', async () => {
    const { createConversation, markConversationEnded, archiveConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { handleConversationImageUpload } = await import('../conversations.js');
    const { cleanupUnreferencedConversationAttachments } = await import('../../services/conversation-attachments.js');

    createConversation({ name: 'unsent-conv', tmuxSession: 'conv-unsent-conv', cwd: '/cwd' });

    const sessionFile = join(TEST_HOME, 'unsent-session.jsonl');
    writeFileSync(sessionFile, `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'existing history' }] } })}\n`);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const bytes = Buffer.from([137, 80, 78, 71]);
    const uploadResponse = await handleConversationImageUpload('unsent-conv', 'draft.png', bytes, 'image/png');
    const uploadedPath = decodeJsonResponse(uploadResponse).path as string;

    markConversationEnded('unsent-conv');
    await cleanupUnreferencedConversationAttachments({ name: 'unsent-conv', sessionFile });
    expect(existsSync(uploadedPath)).toBe(true);

    archiveConversation('unsent-conv');
    await cleanupUnreferencedConversationAttachments({ name: 'unsent-conv', sessionFile });
    expect(existsSync(uploadedPath)).toBe(true);
  });

  it('archive prunes unreferenced uploads while preserving prose-first referenced ones', async () => {
    const { createConversation, markConversationEnded, archiveConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { handleConversationImageUpload } = await import('../conversations.js');
    const { cleanupUnreferencedConversationAttachments } = await import('../../services/conversation-attachments.js');

    createConversation({ name: 'archived-conv', tmuxSession: 'conv-archived-conv', cwd: '/cwd' });

    const sessionFile = join(TEST_HOME, 'archived-session.jsonl');

    const bytes = Buffer.from([137, 80, 78, 71]);
    const keptUpload = await handleConversationImageUpload('archived-conv', 'kept.png', bytes, 'image/png');
    const prunedUpload = await handleConversationImageUpload('archived-conv', 'pruned.png', bytes, 'image/png');

    const keptPath = decodeJsonResponse(keptUpload).path as string;
    const prunedPath = decodeJsonResponse(prunedUpload).path as string;
    writeFileSync(sessionFile, `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: `keep this\n@${keptPath}` }] } })}\n`);
    // Explicitly set the session file mtime to be strictly newer than both
    // attachments so the >= comparison reliably prunes the unreferenced one.
    const keptStat = statSync(keptPath);
    const prunedStat = statSync(prunedPath);
    const newestAttachmentMtime = Math.max(keptStat.mtimeMs, prunedStat.mtimeMs);
    utimesSync(sessionFile, newestAttachmentMtime / 1000 + 1, newestAttachmentMtime / 1000 + 1);

    markConversationEnded('archived-conv');
    archiveConversation('archived-conv');
    await cleanupUnreferencedConversationAttachments({ name: 'archived-conv', sessionFile });

    expect(existsSync(keptPath)).toBe(true);
    expect(existsSync(prunedPath)).toBe(false);
  });

  it('creating and listing a conversation returns the right data', async () => {
    const { createConversation, listConversations } = await import('../../../../lib/overdeck/conversations.js');
    createConversation({ name: 'integration-test', tmuxSession: 'conv-integration-test', cwd: '/cwd' });
    const list = listConversations();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('integration-test');
    expect(list[0].tmuxSession).toBe('conv-integration-test');
    expect(list[0].status).toBe('active');
  });

  it('returns archived conversations ordered by archivedAt descending', async () => {
    const { createConversation, archiveConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { getOverdeckDatabaseSync } = await import('../../../../lib/overdeck/infra.js');
    const { handleArchivedConversationsList } = await import('../conversations.js');
    const db = getOverdeckDatabaseSync();

    createConversation({ name: 'older-archived', tmuxSession: 'conv-older', cwd: '/cwd/older', title: 'Older archived' });
    createConversation({ name: 'active-conv', tmuxSession: 'conv-active', cwd: '/cwd/active', title: 'Active' });
    createConversation({ name: 'newer-archived', tmuxSession: 'conv-newer', cwd: '/cwd/newer', title: 'Newer archived' });
    archiveConversation('older-archived');
    archiveConversation('newer-archived');
    db.prepare(`UPDATE conversations SET archived_at = ? WHERE name = ?`).run('2026-05-22T00:00:00.000Z', 'older-archived');
    db.prepare(`UPDATE conversations SET archived_at = ? WHERE name = ?`).run('2026-05-23T00:00:00.000Z', 'newer-archived');

    const response = await handleArchivedConversationsList();
    const rows = decodeJsonResponse(response) as unknown as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(rows.map((row) => row.conversationName)).toEqual(['newer-archived', 'older-archived']);
    expect(rows.map((row) => row.conversationName)).not.toContain('active-conv');
    expect(rows[0]).toMatchObject({
      source: 'managed-archived',
      overdeckManaged: true,
      archivedAt: '2026-05-23T00:00:00.000Z',
    });

    const limitedResponse = await handleArchivedConversationsList({ limit: 1 });
    const limitedRows = decodeJsonResponse(limitedResponse) as unknown as Array<Record<string, unknown>>;
    expect(limitedRows.map((row) => row.conversationName)).toEqual(['newer-archived']);
  });

  it('filters archived conversations with active facets before mapping rows', async () => {
    const { createConversation, archiveConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { upsertDiscoveredSession } = await import('../../../../lib/overdeck/discovered-sessions.js');
    const { getOverdeckDatabaseSync } = await import('../../../../lib/overdeck/infra.js');
    const { handleArchivedConversationsList } = await import('../conversations.js');
    const db = getOverdeckDatabaseSync();

    createConversation({
      name: 'matching-archived',
      tmuxSession: 'conv-matching',
      cwd: '/cwd/matching',
      issueId: 'PAN-1391',
      claudeSessionId: 'matching-session',
      model: 'fallback-model',
    });
    createConversation({
      name: 'other-archived',
      tmuxSession: 'conv-other',
      cwd: '/cwd/other',
      issueId: 'PAN-1391',
      claudeSessionId: 'other-session',
      model: 'indexed-model',
    });
    upsertDiscoveredSession({
      jsonlPath: '/jsonl/matching-session.jsonl',
      sessionId: 'matching-session',
      workspacePath: '/indexed/matching',
      messageCount: 8,
      lastTs: '2026-05-21T00:00:00.000Z',
      primaryModel: 'indexed-model',
      estimatedCost: 4.56,
      toolsUsed: ['Read'],
      filesTouched: ['src/matching.ts'],
      tags: ['dashboard'],
    });
    db.prepare(`UPDATE discovered_sessions SET enrichment_level = ? WHERE session_id = ?`).run(2, 'matching-session');
    archiveConversation('matching-archived');
    archiveConversation('other-archived');

    const response = await handleArchivedConversationsList({
      workspacePath: '/cwd/matching',
      primaryModel: 'indexed-model',
      tags: ['dashboard'],
      tools: ['Read'],
      files: ['src/matching.ts'],
      minCost: 4,
      enrichmentLevel: 2,
      limit: 50,
    });
    const rows = decodeJsonResponse(response) as unknown as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(rows.map((row) => row.conversationName)).toEqual(['matching-archived']);
  });

  it('normalizes relative since values when parsing archived conversation filters', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T12:00:00.000Z'));

    try {
      const { parseArchivedConversationListOptions } = await import('../conversations.js');

      const options = parseArchivedConversationListOptions(new URLSearchParams('since=7d&limit=50'));

      expect(options.since).toBe('2026-05-16T12:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns archived conversations without discovered_sessions enrichment', async () => {
    const { createConversation, archiveConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { getOverdeckDatabaseSync } = await import('../../../../lib/overdeck/infra.js');
    const { handleArchivedConversationsList } = await import('../conversations.js');
    const db = getOverdeckDatabaseSync();

    createConversation({
      name: 'sparse-archived',
      tmuxSession: 'conv-sparse',
      cwd: '/cwd/sparse',
      issueId: 'PAN-1391',
      claudeSessionId: 'sparse-session',
      title: 'Sparse title',
      model: 'claude-opus-4-7',
    });
    archiveConversation('sparse-archived');
    db.prepare(`UPDATE conversations SET archived_at = ?, total_cost = ? WHERE name = ?`).run('2026-05-23T01:00:00.000Z', 1.23, 'sparse-archived');

    const response = await handleArchivedConversationsList();
    const rows = decodeJsonResponse(response) as unknown as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      conversationName: 'sparse-archived',
      workspacePath: '/cwd/sparse',
      primaryModel: 'claude-opus-4-7',
      messageCount: 0,
      estimatedCost: 1.23,
      toolsUsed: [],
      filesTouched: [],
      tags: [],
      summary: 'Sparse title',
      enrichmentLevel: 0,
      enrichmentFailed: false,
      panIssueId: 'PAN-1391',
      lastTs: '2026-05-23T01:00:00.000Z',
    });
    expect(rows[0].jsonlPath).toEqual(expect.stringContaining('sparse-session.jsonl'));
  });

  it('merges discovered_sessions enrichment for archived conversations', async () => {
    const { createConversation, archiveConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { upsertDiscoveredSession } = await import('../../../../lib/overdeck/discovered-sessions.js');
    const { getOverdeckDatabaseSync } = await import('../../../../lib/overdeck/infra.js');
    const { handleArchivedConversationsList } = await import('../conversations.js');
    const db = getOverdeckDatabaseSync();

    createConversation({
      name: 'enriched-archived',
      tmuxSession: 'conv-enriched',
      cwd: '/cwd/enriched',
      issueId: 'PAN-1391',
      claudeSessionId: 'enriched-session',
      title: 'Conversation title',
      model: 'fallback-model',
    });
    upsertDiscoveredSession({
      jsonlPath: '/jsonl/enriched-session.jsonl',
      sessionId: 'enriched-session',
      workspacePath: '/indexed/workspace',
      messageCount: 8,
      firstTs: '2026-05-20T00:00:00.000Z',
      lastTs: '2026-05-21T00:00:00.000Z',
      primaryModel: 'indexed-model',
      tokenInput: 111,
      tokenOutput: 222,
      estimatedCost: 4.56,
      toolsUsed: ['Read', 'Edit'],
      filesTouched: ['src/file.ts'],
      tags: ['dashboard'],
    });
    db.prepare(`UPDATE discovered_sessions SET summary = ?, enrichment_level = ?, enrichment_failed = ? WHERE session_id = ?`)
      .run('Indexed summary', 2, 1, 'enriched-session');
    archiveConversation('enriched-archived');
    db.prepare(`UPDATE conversations SET archived_at = ? WHERE name = ?`).run('2026-05-23T02:00:00.000Z', 'enriched-archived');

    const response = await handleArchivedConversationsList();
    const rows = decodeJsonResponse(response) as unknown as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      conversationName: 'enriched-archived',
      jsonlPath: '/jsonl/enriched-session.jsonl',
      workspacePath: '/cwd/enriched',
      primaryModel: 'indexed-model',
      messageCount: 8,
      firstTs: '2026-05-20T00:00:00.000Z',
      lastTs: '2026-05-21T00:00:00.000Z',
      estimatedCost: 4.56,
      tokenInput: 111,
      tokenOutput: 222,
      toolsUsed: ['Read', 'Edit'],
      filesTouched: ['src/file.ts'],
      tags: ['dashboard'],
      summary: 'Indexed summary',
      enrichmentLevel: 2,
      enrichmentFailed: true,
    });
  });

  it('excludes non-archived conversations from the archived list', async () => {
    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { handleArchivedConversationsList } = await import('../conversations.js');

    createConversation({ name: 'not-archived', tmuxSession: 'conv-not-archived', cwd: '/cwd' });

    const response = await handleArchivedConversationsList();
    const rows = decodeJsonResponse(response) as unknown as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(rows).toEqual([]);
  });

  it('deleting (marking ended) a conversation persists correctly', async () => {
    const { createConversation, markConversationEnded, getConversationByName } = await import('../../../../lib/overdeck/conversations.js');
    createConversation({ name: 'to-delete', tmuxSession: 'conv-to-delete', cwd: '/cwd' });
    markConversationEnded('to-delete');
    const conv = getConversationByName('to-delete');
    expect(conv!.status).toBe('ended');
  });

  it('getConversationById returns the correct row by id', async () => {
    const { createConversation, getConversationById } = await import('../../../../lib/overdeck/conversations.js');
    const created = createConversation({ name: 'by-id-test', tmuxSession: 'conv-by-id-test', cwd: '/cwd' });
    const conv = getConversationById(created.id);
    expect(conv).not.toBeNull();
    expect(conv!.name).toBe('by-id-test');
  });

  it('getConversationById returns null for unknown id', async () => {
    const { getConversationById } = await import('../../../../lib/overdeck/conversations.js');
    expect(getConversationById(99999)).toBeNull();
  });

  it('resume on alive session updates last_attached_at', async () => {
    const { createConversation, updateLastAttached, markConversationActive, getConversationByName } = await import('../../../../lib/overdeck/conversations.js');
    createConversation({ name: 'resume-me', tmuxSession: 'conv-resume-me', cwd: '/cwd' });
    updateLastAttached('resume-me');
    markConversationActive('resume-me');
    const conv = getConversationByName('resume-me');
    expect(conv!.lastAttachedAt).toBeTruthy();
    expect(conv!.status).toBe('active');
  });

  it('marks legacy in-flight forks without persisted requests as failed on recovery', async () => {
    const { createConversation, getConversationByName } = await import('../../../../lib/overdeck/conversations.js');
    createConversation({ name: 'legacy-fork', tmuxSession: 'conv-legacy-fork', cwd: '/cwd', forkStatus: 'summarizing' });

    await expect(recoverStuckForks()).resolves.toBe(0);

    const conv = getConversationByName('legacy-fork');
    expect(conv?.forkStatus).toBe('failed');
    expect(conv?.forkError).toContain('recovery metadata');
  });

  it('honors the fork recovery retry limit without re-attempting', async () => {
    const { createConversation, getConversationByName, incrementForkRetryCount, setForkRequest } = await import('../../../../lib/overdeck/conversations.js');
    createConversation({ name: 'retry-capped-fork', tmuxSession: 'conv-retry-capped-fork', cwd: '/cwd', forkStatus: 'spawning' });
    setForkRequest('retry-capped-fork', JSON.stringify(buildForkRequest({
      parentConversationName: 'source-conv',
      sessionId: 'session-123',
      forkMode: 'summary',
      localSummaryOnly: true,
      includeThinkingInSummary: false,
      handoffAuthor: 'external',
    })));
    incrementForkRetryCount('retry-capped-fork');
    incrementForkRetryCount('retry-capped-fork');

    await expect(recoverStuckForks()).resolves.toBe(0);

    const conv = getConversationByName('retry-capped-fork');
    expect(conv?.forkStatus).toBe('failed');
    expect(conv?.forkError).toContain('retry limit');
    expect(conv?.forkRetryCount).toBe(2);
  });

  it('increments the fork retry count before a recovery attempt failure', async () => {
    const { createConversation, getConversationByName, setForkRequest } = await import('../../../../lib/overdeck/conversations.js');
    createConversation({ name: 'missing-parent-fork', tmuxSession: 'conv-missing-parent-fork', cwd: '/cwd', forkStatus: 'handoff' });
    setForkRequest('missing-parent-fork', JSON.stringify(buildForkRequest({
      parentConversationName: 'missing-source-conv',
      sessionId: 'session-123',
      forkMode: 'handoff',
      localSummaryOnly: false,
      includeThinkingInSummary: false,
      handoffAuthor: 'external',
    })));

    await expect(recoverStuckForks()).resolves.toBe(0);

    const conv = getConversationByName('missing-parent-fork');
    expect(conv?.forkStatus).toBe('failed');
    expect(conv?.forkError).toContain('missing-source-conv');
    expect(conv?.forkRetryCount).toBe(1);
  });

  it('creates a summary fork conversation without ending the source conversation', async () => {
    const { createConversation, getConversationByName } = await import('../../../../lib/overdeck/conversations.js');
    const { createSummaryFork } = await import('../../../../lib/conversations/summary-fork.js');

    const cwd = '/home/test/project';
    const sessionId = 'session-123';
    const encodedCwd = cwd.replace(/[^a-zA-Z0-9]/g, '-');
    const claudeProjectDir = join(process.env.HOME || '', '.claude', 'projects', encodedCwd);
    mkdirSync(claudeProjectDir, { recursive: true });
    const sessionFile = join(claudeProjectDir, `${sessionId}.jsonl`);
    writeFileSync(sessionFile, [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'Fix the broken dashboard route' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'Edit', input: { file_path: '/home/eltmon/Projects/overdeck/src/file.ts' } }],
        },
      }),
    ].join('\n') + '\n');

    const conv = createConversation({
      name: 'source-conv',
      tmuxSession: 'conv-source-conv',
      cwd,
      claudeSessionId: sessionId,
      title: 'Original conversation',
      effort: 'medium',
    });

    const result = await Effect.runPromise(createSummaryFork(conv, { localSummaryOnly: true }));

    expect(result.conversation.name).not.toBe('source-conv');
    expect(result.conversation.title).toBe('Summary Fork: Original conversation');
    expect(result.conversation.model).toBeNull();
    expect(result.conversation.effort).toBe('medium');
    expect(result.summary).toContain('Conversation Summary Fork');
    expect(result.summaryModel).toBeNull();

    const sourceConv = getConversationByName('source-conv');
    expect(sourceConv?.status).toBe('active');
  });

  it('creates a plain fork conversation from the forkMode discriminator', async () => {
    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    const { createSummaryFork } = await import('../../../../lib/conversations/summary-fork.js');

    const cwd = '/home/test/plain-project';
    const sessionId = 'plain-session-123';
    const encodedCwd = cwd.replace(/[^a-zA-Z0-9]/g, '-');
    const claudeProjectDir = join(process.env.HOME || '', '.claude', 'projects', encodedCwd);
    mkdirSync(claudeProjectDir, { recursive: true });
    const sessionFile = join(claudeProjectDir, `${sessionId}.jsonl`);
    writeFileSync(sessionFile, [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Before compaction' },
      }),
      JSON.stringify({ type: 'system', subtype: 'compact_boundary' }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'private chain' }],
        },
      }),
    ].join('\n') + '\n');

    const conv = createConversation({
      name: 'plain-source-conv',
      tmuxSession: 'conv-plain-source-conv',
      cwd,
      claudeSessionId: sessionId,
      title: 'Plain source',
    });

    const result = await Effect.runPromise(createSummaryFork(conv, { forkMode: 'plain' }));

    expect(result.conversation.title).toBe('Fork: Plain source');
    expect(result.summary).toBe('');
    expect(result.summaryModel).toBeNull();
    const forkedJsonl = readFileSync(result.sessionFile, 'utf-8');
    expect(forkedJsonl).toContain('[Thinking]\\nprivate chain');
    expect(forkedJsonl).not.toContain('"type":"thinking"');
    expect(forkedJsonl).not.toContain('Before compaction');
  });
});

// ─── validateOrigin unit tests ────────────────────────────────────────────────

function getTrustedOrigins(): string[] {
  return ['http://localhost:3011', 'http://localhost:3000', 'http://127.0.0.1:3011', 'http://127.0.0.1:3000'];
}

function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function validateOrigin(
  headers: Record<string, string | undefined>,
  method = 'GET',
): { ok: true } | { ok: false; error: string } {
  const origin = headers['origin'];
  const referer = headers['referer'];
  const trusted = getTrustedOrigins();

  if (!origin && !referer) {
    const normalizedMethod = method.toUpperCase();
    if (normalizedMethod === 'GET' || normalizedMethod === 'HEAD') {
      return { ok: true };
    }
    return { ok: false, error: 'Missing origin' };
  }

  if (origin) {
    const normalized = normalizeOrigin(origin);
    if (normalized && trusted.includes(normalized)) {
      return { ok: true };
    }
    return { ok: false, error: 'Invalid origin' };
  }

  if (!referer) {
    return { ok: false, error: 'Invalid referer' };
  }
  const normalized = normalizeOrigin(referer);
  if (normalized && trusted.includes(normalized)) {
    return { ok: true };
  }
  return { ok: false, error: 'Invalid referer' };
}

describe('validateOrigin', () => {
  it('accepts matching Origin header', () => {
    expect(validateOrigin({ origin: 'http://localhost:3000' })).toEqual({ ok: true });
  });

  it('accepts matching Referer header', () => {
    expect(validateOrigin({ referer: 'http://localhost:3000/' })).toEqual({ ok: true });
  });

  it('rejects untrusted Origin', () => {
    expect(validateOrigin({ origin: 'https://evil.com' })).toEqual({ ok: false, error: 'Invalid origin' });
  });

  it('rejects untrusted Referer', () => {
    expect(validateOrigin({ referer: 'https://evil.com/' })).toEqual({ ok: false, error: 'Invalid referer' });
  });

  it('rejects prefix-match origin attack', () => {
    expect(validateOrigin({ origin: 'https://evil.com/?origin=http://localhost:3000' })).toEqual({ ok: false, error: 'Invalid origin' });
  });

  it('allows same-origin safe reads without Origin or Referer', () => {
    expect(validateOrigin({})).toEqual({ ok: true });
    expect(validateOrigin({}, 'HEAD')).toEqual({ ok: true });
  });

  it('rejects unsafe requests with neither Origin nor Referer', () => {
    expect(validateOrigin({}, 'POST')).toEqual({ ok: false, error: 'Missing origin' });
  });
});

describe('transformMessageForHarness (PAN-1535)', () => {
  it('passes claude-code messages through unchanged', async () => {
    const { transformMessageForHarness } = await import('../conversations.js');
    const message = '@/home/u/.overdeck/conversation-attachments/c1/abc.png\nhello';
    expect(transformMessageForHarness(message, 'claude-code', ['/home/u/.overdeck/conversation-attachments/c1/abc.png'])).toBe(message);
  });

  it('passes through unchanged when there are no managed paths', async () => {
    const { transformMessageForHarness } = await import('../conversations.js');
    expect(transformMessageForHarness('hello', 'pi', [])).toBe('hello');
  });

  it('rewrites pi messages to an explicit Read-tool instruction', async () => {
    const { transformMessageForHarness } = await import('../conversations.js');
    const path = '/home/u/.overdeck/conversation-attachments/c1/abc.png';
    const out = transformMessageForHarness(`@${path}\nwhat is this?`, 'pi', [path]);
    expect(out).toContain('Read tool');
    expect(out).toContain(`- ${path}`);
    expect(out).toContain('what is this?');
    expect(out).not.toContain(`@${path}`);
  });

  it('handles empty user text by switching to a describe-what-you-see prompt', async () => {
    const { transformMessageForHarness } = await import('../conversations.js');
    const path = '/home/u/.overdeck/conversation-attachments/c1/abc.png';
    const out = transformMessageForHarness(`@${path}`, 'pi', [path]);
    expect(out).toContain('describe what you see');
    expect(out).toContain(`- ${path}`);
    expect(out).not.toContain('Message:');
  });

  it('handles multiple managed attachments', async () => {
    const { transformMessageForHarness } = await import('../conversations.js');
    const p1 = '/home/u/.overdeck/conversation-attachments/c1/a.png';
    const p2 = '/home/u/.overdeck/conversation-attachments/c1/b.png';
    const out = transformMessageForHarness(`@${p1}\n@${p2}\ncompare`, 'pi', [p1, p2]);
    expect(out).toContain(`- ${p1}`);
    expect(out).toContain(`- ${p2}`);
    expect(out).toContain('compare');
    expect(out).not.toContain(`@${p1}`);
    expect(out).not.toContain(`@${p2}`);
  });

  it('leaves unmanaged @mentions in user prose alone', async () => {
    const { transformMessageForHarness } = await import('../conversations.js');
    const managed = '/home/u/.overdeck/conversation-attachments/c1/a.png';
    const unmanaged = '/etc/passwd';
    const out = transformMessageForHarness(`@${managed}\nalso look at @${unmanaged} please`, 'pi', [managed]);
    expect(out).toContain(`- ${managed}`);
    expect(out).toContain(`@${unmanaged}`); // unmanaged path preserved verbatim
  });

  it('escapes regex metacharacters in attachment paths', async () => {
    const { transformMessageForHarness } = await import('../conversations.js');
    // Paths can legitimately contain `.` and other regex metacharacters
    const path = '/home/u/.overdeck/conversation-attachments/c1/file.with.dots.png';
    const out = transformMessageForHarness(`@${path}\nhi`, 'pi', [path]);
    expect(out).toContain(`- ${path}`);
    expect(out).not.toContain(`@${path}`);
  });
});
