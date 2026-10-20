/**
 * PAN-4565 WI-2 (FR-1, FR-3, FR-7, FR-12, NFR-1): a `fresh` fork never reads
 * the source transcript and never authors or summarizes — the focus (if any)
 * is delivered, held, or dropped verbatim, in both a fresh fork and a
 * dashboard-restart recovery.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../conversations/summary-fork.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../conversations/summary-fork.js')>()),
  authorHandoffExternal: vi.fn(async () => { throw new Error('authorHandoffExternal must not be called for a fresh fork'); }),
  requestHandoffFromAgent: vi.fn(async () => { throw new Error('requestHandoffFromAgent must not be called for a fresh fork'); }),
  generateSummaryForFork: vi.fn(async () => { throw new Error('generateSummaryForFork must not be called for a fresh fork'); }),
  generateFallbackSummary: vi.fn(async () => { throw new Error('generateFallbackSummary must not be called for a fresh fork'); }),
}));
vi.mock('../conversation-runtime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation-runtime.js')>()),
  resolveAllowedHarness: vi.fn(async () => 'claude-code'),
  isInsideGitWorkTree: vi.fn(async () => true),
}));

const { runForkPipeline, recoverStuckForks, buildForkRequest, __setForkPipelineRuntimeOverridesForTest, __resetForkPipelineRuntimeOverridesForTest, waitForInFlightForkPipelines } = await import('../conversation-forks.js');
const forksModule = await import('../conversation-forks.js');
const summaryForkModule = await import('../../conversations/summary-fork.js');
const { sessionFilePath } = await import('../../runtimes/storage/claude-code.js');
const { createConversation, getConversationByName, setForkRequest } = await import('../conversations.js');
const { readHeldKickoff } = await import('../conversation-kickoff-store.js');

let testHome: string;
let originalHome: string | undefined;
let parentCwd: string;

function writeSessionFile(cwd: string, sessionId: string): void {
  const file = sessionFilePath(cwd, sessionId);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '{"type":"prompt"}\n');
}

function seed(name: string, extra: Partial<Parameters<typeof createConversation>[0]> = {}) {
  writeSessionFile(parentCwd, `${name}-session`);
  return createConversation({ name, tmuxSession: `conv-${name}`, cwd: parentCwd, claudeSessionId: `${name}-session`, harness: 'claude-code', ...extra });
}

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4565-fork-fresh-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  parentCwd = join(testHome, 'parent-project');
  mkdirSync(parentCwd, { recursive: true });
  seed('parent-conv');
  __setForkPipelineRuntimeOverridesForTest({
    sessionExists: async () => true,
    isHarnessProcessAlive: async () => true,
  });
});

afterEach(async () => {
  __resetForkPipelineRuntimeOverridesForTest();
  await waitForInFlightForkPipelines(0);
  vi.restoreAllMocks();
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

function expectNoAuthoring(): void {
  expect(summaryForkModule.authorHandoffExternal).not.toHaveBeenCalled();
  expect(summaryForkModule.requestHandoffFromAgent).not.toHaveBeenCalled();
  expect(summaryForkModule.generateSummaryForFork).not.toHaveBeenCalled();
  expect(summaryForkModule.generateFallbackSummary).not.toHaveBeenCalled();
}

describe('fresh pipeline (PAN-4565)', () => {
  it('delivers the focus verbatim and never authors', async () => {
    const injectSpy = vi.spyOn(forksModule, 'injectForkSummary').mockResolvedValue('submitted');
    seed('fork-conv-1');
    await runForkPipeline(
      'fork-conv-1',
      getConversationByName('parent-conv')!,
      'fork-conv-1-session',
      undefined,
      'handoff',
      false,
      false,
      undefined,
      'build a fort',
      'external',
      undefined,
      undefined,
      undefined,
      false,
      true,
    );

    expect(injectSpy).toHaveBeenCalledTimes(1);
    expect(injectSpy.mock.calls[0]?.[1]).toBe('build a fort');
    expectNoAuthoring();
  });

  it('never resolves the source session file', async () => {
    const parentNoSession = createConversation({
      name: 'parent-no-session',
      tmuxSession: 'conv-parent-no-session',
      cwd: parentCwd,
      claudeSessionId: 'missing-session',
      harness: 'claude-code',
    });
    seed('fork-conv-2');
    await expect(runForkPipeline(
      'fork-conv-2',
      parentNoSession,
      'fork-conv-2-session',
      undefined,
      'handoff',
      false,
      false,
      undefined,
      undefined,
      'external',
      undefined,
      undefined,
      undefined,
      false,
      true,
    )).resolves.toBeUndefined();

    const conv = getConversationByName('fork-conv-2');
    expect(conv?.forkStatus).toBeNull();
    expectNoAuthoring();
  });

  it('holds the focus with hold', async () => {
    const injectSpy = vi.spyOn(forksModule, 'injectForkSummary');
    seed('fork-conv-3');
    await runForkPipeline(
      'fork-conv-3',
      getConversationByName('parent-conv')!,
      'fork-conv-3-session',
      undefined,
      'handoff',
      false,
      false,
      undefined,
      'build a fort',
      'external',
      undefined,
      undefined,
      undefined,
      true,
      true,
    );

    expect(injectSpy).not.toHaveBeenCalled();
    expect(readHeldKickoff('fork-conv-3')).toBe('build a fort');
    const conv = getConversationByName('fork-conv-3');
    expect(conv?.forkStatus).toBeNull();
    expect(conv?.status).toBe('active');
    expectNoAuthoring();
  });

  it('no focus launches and delivers nothing', async () => {
    const injectSpy = vi.spyOn(forksModule, 'injectForkSummary');
    seed('fork-conv-4');
    await runForkPipeline(
      'fork-conv-4',
      getConversationByName('parent-conv')!,
      'fork-conv-4-session',
      undefined,
      'handoff',
      false,
      false,
      undefined,
      undefined,
      'external',
      undefined,
      undefined,
      undefined,
      false,
      true,
    );

    expect(injectSpy).not.toHaveBeenCalled();
    expect(readHeldKickoff('fork-conv-4')).toBeNull();
    const conv = getConversationByName('fork-conv-4');
    expect(conv?.status).toBe('active');
    expectNoAuthoring();
  });

  it('recovery replays a fresh start as fresh', async () => {
    vi.spyOn(forksModule, 'injectForkSummary').mockResolvedValue('submitted');
    const parent = getConversationByName('parent-conv')!;
    const fork = seed('fork-conv-5', { forkStatus: 'handoff' });
    setForkRequest(fork.name, JSON.stringify(buildForkRequest({
      parentConversationName: parent.name,
      sessionId: 'fork-conv-5-session',
      forkMode: 'handoff',
      localSummaryOnly: false,
      handoffAuthor: 'external',
      handoffFocus: 'build a fort',
      fresh: true,
    })));

    await expect(recoverStuckForks()).resolves.toBe(1);

    expectNoAuthoring();
  });
});
