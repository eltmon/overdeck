import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  deliverAgentMessage: vi.fn(),
  waitForReadySignal: vi.fn(),
  getAgentRuntimeStateSync: vi.fn(),
  generateSummaryForFork: vi.fn(),
  authorHandoffExternal: vi.fn(),
  getTranscriptAdapter: vi.fn(),
}));

vi.mock('../../../../lib/agents.js', async () => {
  const actual = await vi.importActual('../../../../lib/agents.js');
  return {
    ...(actual as object),
    deliverAgentMessage: mocks.deliverAgentMessage,
    waitForReadySignal: mocks.waitForReadySignal,
    getAgentRuntimeStateSync: mocks.getAgentRuntimeStateSync,
    clearReadySignal: vi.fn(),
  };
});

vi.mock('../../../../lib/conversations/summary-fork.js', async () => {
  const actual = await vi.importActual('../../../../lib/conversations/summary-fork.js');
  return {
    ...(actual as object),
    generateSummaryForFork: mocks.generateSummaryForFork,
    authorHandoffExternal: mocks.authorHandoffExternal,
  };
});

vi.mock('../../../../lib/conversations/transcript-adapter.js', () => ({
  getTranscriptAdapter: mocks.getTranscriptAdapter,
}));

let TEST_HOME: string;
let sourceSessionFile: string;
let sessionAlive: Map<string, boolean>;
let harnessAlive: Map<string, boolean>;
const spawnCalls: string[] = [];
const waitCalls: string[] = [];

async function resetDb() {
  const { closeOverdeckDatabaseSync } = await import('../../../../lib/overdeck/infra.js');
  closeOverdeckDatabaseSync();
}

async function createForkPair(options: { forkStatus?: string; forkMode?: 'summary' | 'handoff' | 'plain' } = {}) {
  const { createConversation, setForkRequest } = await import('../../../../lib/overdeck/conversations.js');
  const { buildForkRequest } = await import('../conversations.js');

  const parent = createConversation({
    name: 'source-conv',
    tmuxSession: 'conv-source-conv',
    cwd: TEST_HOME,
    claudeSessionId: 'source-session',
    title: 'Source conversation',
    harness: 'claude-code',
  });
  const fork = createConversation({
    name: 'fork-conv',
    tmuxSession: 'conv-fork-conv',
    cwd: TEST_HOME,
    claudeSessionId: 'fork-session',
    title: 'Fork conversation',
    harness: 'claude-code',
    forkStatus: options.forkStatus ?? null,
  });
  setForkRequest(fork.name, JSON.stringify(buildForkRequest({
    parentConversationName: parent.name,
    sessionId: 'fork-session',
    forkMode: options.forkMode ?? 'handoff',
    localSummaryOnly: false,
    includeThinkingInSummary: false,
    handoffAuthor: 'external',
  })));
  return { parent, fork };
}

beforeEach(async () => {
  await resetDb();
  TEST_HOME = join(tmpdir(), `pan-1744-fork-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  sourceSessionFile = join(TEST_HOME, 'source.jsonl');
  writeFileSync(sourceSessionFile, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'continue' } })}\n`);
  process.env.PANOPTICON_HOME = TEST_HOME;
  process.env.PANOPTICON_DOCKER_WORKSPACE = '1';

  sessionAlive = new Map();
  harnessAlive = new Map();
  spawnCalls.length = 0;
  waitCalls.length = 0;

  mocks.deliverAgentMessage.mockReset().mockResolvedValue(undefined);
  mocks.waitForReadySignal.mockReset().mockResolvedValue(true);
  mocks.getAgentRuntimeStateSync.mockReset().mockImplementation((sessionName: string) => (
    harnessAlive.get(sessionName) ? { state: 'active' } : null
  ));
  mocks.generateSummaryForFork.mockReset().mockResolvedValue({ summary: '## Summary\n\nContinue from here.' });
  mocks.authorHandoffExternal.mockReset();
  mocks.getTranscriptAdapter.mockReset().mockReturnValue({
    name: 'claude-code',
    supportsPlainForkAsSource: true,
    supportsSourceAuthoredHandoff: true,
    resolveSessionFile: vi.fn(async () => sourceSessionFile),
  });

  const {
    __setForkPipelineRuntimeOverridesForTest,
    waitForInFlightForkPipelines,
  } = await import('../conversations.js');
  await waitForInFlightForkPipelines(0);
  __setForkPipelineRuntimeOverridesForTest({
    sessionExists: async (sessionName: string) => sessionAlive.get(sessionName) ?? false,
    isHarnessProcessAlive: async (sessionName: string) => harnessAlive.get(sessionName) ?? false,
    spawnConversationSession: async (tmuxSession: string) => {
      spawnCalls.push(tmuxSession);
      sessionAlive.set(tmuxSession, true);
      harnessAlive.set(tmuxSession, true);
    },
    waitForTmuxSession: async (tmuxSession: string) => {
      waitCalls.push(tmuxSession);
    },
    getAgentRuntimeStateSync: mocks.getAgentRuntimeStateSync,
  });
});

afterEach(async () => {
  const {
    __resetForkPipelineRuntimeOverridesForTest,
    waitForInFlightForkPipelines,
  } = await import('../conversations.js');
  __resetForkPipelineRuntimeOverridesForTest();
  await waitForInFlightForkPipelines(0);
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  delete process.env.PANOPTICON_DOCKER_WORKSPACE;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('fork pipeline recovery and re-entry', () => {
  it('re-enters a handoff fork without re-authoring or double-spawning when doc and live session already exist', async () => {
    const { getConversationByName } = await import('../../../../lib/overdeck/conversations.js');
    const { runForkPipeline } = await import('../conversations.js');
    const { parent } = await createForkPair({ forkMode: 'handoff' });
    const docPath = join(TEST_HOME, 'handoff.md');
    const docText = '## Suggested skills\n\nContinue with the fork recovery fix and keep the existing handoff document. '.repeat(4);
    mocks.authorHandoffExternal.mockImplementation(async () => {
      writeFileSync(docPath, docText);
      return { docText, docPath };
    });

    await runForkPipeline('fork-conv', parent, 'fork-session', undefined, 'handoff', false, false, undefined, 'focus', 'external');
    await runForkPipeline('fork-conv', parent, 'fork-session', undefined, 'handoff', false, false, undefined, 'focus', 'external');

    expect(mocks.authorHandoffExternal).toHaveBeenCalledTimes(1);
    expect(spawnCalls).toEqual(['conv-fork-conv']);
    expect(mocks.deliverAgentMessage).toHaveBeenCalledTimes(2);
    expect(getConversationByName('fork-conv')?.forkStatus).toBeNull();
  });

  it('recreates a tmux keep-alive corpse instead of treating session existence as a reusable fork runtime', async () => {
    const { runForkPipeline } = await import('../conversations.js');
    const { parent } = await createForkPair({ forkMode: 'summary' });
    sessionAlive.set('conv-fork-conv', true);
    harnessAlive.set('conv-fork-conv', false);

    await runForkPipeline('fork-conv', parent, 'fork-session', undefined, 'summary', false, false);

    expect(spawnCalls).toEqual(['conv-fork-conv']);
    expect(waitCalls).toEqual(['conv-fork-conv']);
    expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
      'conv-fork-conv',
      '## Summary\n\nContinue from here.',
      'summary-fork',
      'auto',
    );
  });

  it('marks a tmux-alive runtime-active fork recovered without killing or re-running the pipeline', async () => {
    const { getConversationByName } = await import('../../../../lib/overdeck/conversations.js');
    const { recoverStuckForks } = await import('../conversations.js');
    await createForkPair({ forkStatus: 'spawning', forkMode: 'handoff' });
    sessionAlive.set('conv-fork-conv', true);
    harnessAlive.set('conv-fork-conv', true);

    await expect(recoverStuckForks()).resolves.toBe(1);

    const recovered = getConversationByName('fork-conv');
    expect(recovered?.forkStatus).toBeNull();
    expect(recovered?.forkRetryCount).toBe(0);
    expect(spawnCalls).toEqual([]);
    expect(mocks.authorHandoffExternal).not.toHaveBeenCalled();
    expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
  });

  it('salvages a retry-capped fork when its successor harness is already active', async () => {
    const { getConversationByName, incrementForkRetryCount } = await import('../../../../lib/overdeck/conversations.js');
    const { recoverStuckForks } = await import('../conversations.js');
    await createForkPair({ forkStatus: 'spawning', forkMode: 'handoff' });
    incrementForkRetryCount('fork-conv');
    incrementForkRetryCount('fork-conv');
    sessionAlive.set('conv-fork-conv', true);
    harnessAlive.set('conv-fork-conv', true);

    await expect(recoverStuckForks()).resolves.toBe(1);

    const recovered = getConversationByName('fork-conv');
    expect(recovered?.forkStatus).toBeNull();
    expect(recovered?.forkRetryCount).toBe(2);
    expect(spawnCalls).toEqual([]);
    expect(mocks.authorHandoffExternal).not.toHaveBeenCalled();
    expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
  });

  it('re-enters a stale runtime-active tmux corpse instead of clearing fork status', async () => {
    const { getConversationByName } = await import('../../../../lib/overdeck/conversations.js');
    const { recoverStuckForks } = await import('../conversations.js');
    await createForkPair({ forkStatus: 'handoff', forkMode: 'handoff' });
    sessionAlive.set('conv-fork-conv', true);
    harnessAlive.set('conv-fork-conv', false);
    mocks.getAgentRuntimeStateSync.mockReturnValue({ state: 'active' });
    const docPath = join(TEST_HOME, 'corpse-recovery-handoff.md');
    const docText = '## Suggested skills\n\nRe-enter the fork because the tmux session is only a keep-alive corpse. '.repeat(4);
    mocks.authorHandoffExternal.mockImplementation(async () => {
      writeFileSync(docPath, docText);
      return { docText, docPath };
    });

    await expect(recoverStuckForks()).resolves.toBe(1);

    const recovered = getConversationByName('fork-conv');
    expect(mocks.authorHandoffExternal).toHaveBeenCalledTimes(1);
    expect(spawnCalls).toEqual(['conv-fork-conv']);
    expect(waitCalls).toEqual(['conv-fork-conv']);
    expect(mocks.deliverAgentMessage).toHaveBeenCalledWith('conv-fork-conv', docText, 'handoff', 'auto');
    expect(recovered?.forkStatus).toBeNull();
    expect(recovered?.forkRetryCount).toBe(1);
  });

  it('recovers an existing handoff document through the in-flight registry without re-authoring', async () => {
    const { getConversationByName, recordConversationHandoff } = await import('../../../../lib/overdeck/conversations.js');
    const {
      getInFlightForkPipelineCount,
      recoverStuckForks,
    } = await import('../conversations.js');
    const { parent, fork } = await createForkPair({ forkStatus: 'handoff', forkMode: 'handoff' });
    const docPath = join(TEST_HOME, 'persisted-handoff.md');
    const docText = '## Suggested skills\n\nReuse this existing handoff document during restart recovery. '.repeat(4);
    writeFileSync(docPath, docText);
    recordConversationHandoff(parent.name, fork.name, docPath);

    let releaseDelivery!: () => void;
    const deliveryStarted = new Promise<void>((resolve) => {
      mocks.deliverAgentMessage.mockImplementationOnce(async () => {
        resolve();
        await new Promise<void>((deliveryResolve) => {
          releaseDelivery = deliveryResolve;
        });
      });
    });

    const recovery = recoverStuckForks();
    await deliveryStarted;

    expect(getInFlightForkPipelineCount()).toBe(1);
    expect(mocks.authorHandoffExternal).not.toHaveBeenCalled();
    expect(mocks.deliverAgentMessage).toHaveBeenCalledWith('conv-fork-conv', docText, 'handoff', 'auto');

    releaseDelivery();
    await expect(recovery).resolves.toBe(1);
    expect(getInFlightForkPipelineCount()).toBe(0);
    expect(getConversationByName('fork-conv')?.forkStatus).toBeNull();
  });

  it('recovers a pre-doc handoff fork by authoring, spawning, and injecting from scratch', async () => {
    const { getConversationByName } = await import('../../../../lib/overdeck/conversations.js');
    const { recoverStuckForks } = await import('../conversations.js');
    await createForkPair({ forkStatus: 'handoff', forkMode: 'handoff' });
    const docPath = join(TEST_HOME, 'new-handoff.md');
    const docText = '## Suggested skills\n\nAuthor a fresh handoff document because recovery started before one existed. '.repeat(4);
    mocks.authorHandoffExternal.mockImplementation(async () => {
      writeFileSync(docPath, docText);
      return { docText, docPath };
    });

    await expect(recoverStuckForks()).resolves.toBe(1);

    const recovered = getConversationByName('fork-conv');
    expect(mocks.authorHandoffExternal).toHaveBeenCalledTimes(1);
    expect(spawnCalls).toEqual(['conv-fork-conv']);
    expect(mocks.deliverAgentMessage).toHaveBeenCalledWith('conv-fork-conv', docText, 'handoff', 'auto');
    expect(recovered?.forkStatus).toBeNull();
    expect(recovered?.forkRetryCount).toBe(1);
  });
});
