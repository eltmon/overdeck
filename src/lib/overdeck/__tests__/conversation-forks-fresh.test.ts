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
import { HttpServerResponse } from 'effect/unstable/http';

vi.mock('../../conversations/summary-fork.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../conversations/summary-fork.js')>()),
  reserveSummaryForkSession: vi.fn(async () => ({ sessionId: `fork-${Math.random().toString(36).slice(2)}` })),
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

const { handleConversationSummaryFork, runForkPipeline, recoverStuckForks, buildForkRequest, __setForkPipelineRuntimeOverridesForTest, __resetForkPipelineRuntimeOverridesForTest, waitForInFlightForkPipelines } = await import('../conversation-forks.js');
const forksModule = await import('../conversation-forks.js');
const summaryForkModule = await import('../../conversations/summary-fork.js');
const { sessionFilePath } = await import('../../runtimes/storage/claude-code.js');
const { createConversation, getConversationByName, listConversations, setForkRequest } = await import('../conversations.js');
const { readHeldKickoff } = await import('../conversation-kickoff-store.js');

async function readBody(response: HttpServerResponse.HttpServerResponse): Promise<Record<string, unknown>> {
  return JSON.parse(await HttpServerResponse.toWeb(response).text()) as Record<string, unknown>;
}

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

async function forkRoute(source: string, body: Record<string, unknown>) {
  const response = await handleConversationSummaryFork(source, body);
  return { status: response.status, body: await readBody(response) };
}

describe('fresh route (PAN-4565)', () => {
  it('creates a root successor', async () => {
    vi.spyOn(forksModule, 'injectForkSummary').mockResolvedValue('submitted');
    const { status, body } = await forkRoute('parent-conv', { forkMode: 'handoff', fresh: true, focus: 'start a fort' });
    expect(status).toBe(200);
    const conversation = body['conversation'] as { name: string; parentConversationId: number | null; parentConversationName: string | null; forkStatus: string | null };
    expect(conversation.parentConversationId).toBeNull();
    expect(conversation.parentConversationName).toBeNull();
    expect(conversation.forkStatus).toBe('spawning');
    const stored = getConversationByName(conversation.name);
    expect(JSON.parse(stored?.forkRequest ?? '{}')).toMatchObject({ fresh: true, forkMode: 'handoff' });
    await vi.waitFor(() => expect(getConversationByName(conversation.name)?.forkStatus).toBeNull());
    expectNoAuthoring();
  });

  it('inherits model, cwd and effort when omitted', async () => {
    seed('parent-model-conv', { model: 'claude-sonnet-4-5', effort: 'low' });
    const { status, body } = await forkRoute('parent-model-conv', { forkMode: 'handoff', fresh: true });
    expect(status).toBe(200);
    const conversation = body['conversation'] as { model: string | null; cwd: string; effort: string | null };
    expect(conversation.model).toBe('claude-sonnet-4-5');
    expect(conversation.cwd).toBe(parentCwd);
    expect(conversation.effort).toBe('low');
  });

  it('overrides model and cwd when given', async () => {
    seed('parent-model-conv2', { model: 'claude-sonnet-4-5', effort: 'low' });
    const overrideCwd = join(testHome, 'override-cwd');
    mkdirSync(overrideCwd, { recursive: true });
    const { status, body } = await forkRoute('parent-model-conv2', {
      forkMode: 'handoff',
      fresh: true,
      model: 'claude-haiku-4-5',
      cwd: overrideCwd,
    });
    expect(status).toBe(200);
    const conversation = body['conversation'] as { model: string | null; cwd: string };
    expect(conversation.model).toBe('claude-haiku-4-5');
    expect(conversation.cwd).toBe(overrideCwd);
  });

  it('titles from the focus without a Handoff prefix', async () => {
    vi.spyOn(forksModule, 'injectForkSummary').mockResolvedValue('submitted');
    const { body } = await forkRoute('parent-conv', { forkMode: 'handoff', fresh: true, focus: 'start a fort' });
    const conversation = body['conversation'] as { title: string };
    expect(conversation.title).toBe('start a fort');
  });

  it('titles New conversation with no focus', async () => {
    const { body } = await forkRoute('parent-conv', { forkMode: 'handoff', fresh: true });
    const conversation = body['conversation'] as { title: string };
    expect(conversation.title).toBe('New conversation');
  });

  it('a custom title wins over the focus', async () => {
    vi.spyOn(forksModule, 'injectForkSummary').mockResolvedValue('submitted');
    const { body } = await forkRoute('parent-conv', { forkMode: 'handoff', fresh: true, focus: 'start a fort', title: 'My Fort' });
    const conversation = body['conversation'] as { title: string };
    expect(conversation.title).toBe('My Fort');
  });

  it('does not inherit the source issue', async () => {
    seed('parent-with-issue', { issueId: 'PAN-9001' });
    const { status, body } = await forkRoute('parent-with-issue', { forkMode: 'handoff', fresh: true });
    expect(status).toBe(200);
    const conversation = body['conversation'] as { issueId: string | null };
    expect(conversation.issueId).toBeNull();
  });

  it('rejects fresh with forkMode summary or plain', async () => {
    const before = listConversations().length;
    const summaryResult = await forkRoute('parent-conv', { forkMode: 'summary', fresh: true });
    expect(summaryResult.status).toBe(400);
    expect(summaryResult.body['error']).toBe('fresh is only valid with forkMode "handoff"');
    const plainResult = await forkRoute('parent-conv', { forkMode: 'plain', fresh: true });
    expect(plainResult.status).toBe(400);
    expect(plainResult.body['error']).toBe('fresh is only valid with forkMode "handoff"');
    expect(listConversations().length).toBe(before);
  });

  it('rejects fresh with hold and no focus', async () => {
    const before = listConversations().length;
    const { status, body } = await forkRoute('parent-conv', { forkMode: 'handoff', fresh: true, hold: true });
    expect(status).toBe(400);
    expect(body['error']).toBe('fresh with hold needs focus text: there is nothing to hold');
    expect(listConversations().length).toBe(before);
  });

  it('succeeds when the source has no session file', async () => {
    const noSessionParent = createConversation({
      name: 'parent-no-session-route',
      tmuxSession: 'conv-parent-no-session-route',
      cwd: parentCwd,
      claudeSessionId: 'missing-route-session',
      harness: 'claude-code',
    });
    const { status } = await forkRoute(noSessionParent.name, { forkMode: 'handoff', fresh: true });
    expect(status).toBe(200);
  });

  it('leaves the source untouched', async () => {
    const before = getConversationByName('parent-conv');
    await forkRoute('parent-conv', { forkMode: 'handoff', fresh: true });
    const after = getConversationByName('parent-conv');
    expect(after?.handoffTargetConvId ?? null).toBe(before?.handoffTargetConvId ?? null);
    expect(after?.handoffDocPath ?? null).toBe(before?.handoffDocPath ?? null);
    expect(after?.title).toBe(before?.title);
  });

  it('succeeds with conversations.handoff_author_model unset', async () => {
    vi.spyOn(forksModule, 'injectForkSummary').mockResolvedValue('submitted');
    const { status } = await forkRoute('parent-conv', { forkMode: 'handoff', fresh: true, focus: 'start a fort' });
    expect(status).toBe(200);
  });
});
