/**
 * PAN-4499 WI-4 (FR-5, FR-12, D6, D7, D10): `hold` launches the session and
 * stores the kickoff without delivering it, in both a fresh fork and a
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
  generateSummaryForFork: vi.fn(async () => ({ summary: '## Summary\n\nContinue from here.' })),
  authorHandoffExternal: vi.fn(async () => ({ docText: '## Handoff\n\nContinue the work.', docPath: null })),
}));
vi.mock('../conversation-runtime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation-runtime.js')>()),
  resolveAllowedHarness: vi.fn(async () => 'claude-code'),
  isInsideGitWorkTree: vi.fn(async () => true),
}));

const { handleConversationSummaryFork, runForkPipeline, recoverStuckForks, buildForkRequest, __setForkPipelineRuntimeOverridesForTest, __resetForkPipelineRuntimeOverridesForTest, waitForInFlightForkPipelines } = await import('../conversation-forks.js');
const forksModule = await import('../conversation-forks.js');
const { sessionFilePath } = await import('../../runtimes/storage/claude-code.js');
const { createConversation, getConversationByName, setForkRequest } = await import('../conversations.js');
const { readHeldKickoff } = await import('../conversation-kickoff-store.js');

let testHome: string;
let originalHome: string | undefined;
let parentCwd: string;

async function readBody(response: HttpServerResponse.HttpServerResponse): Promise<Record<string, unknown>> {
  return JSON.parse(await HttpServerResponse.toWeb(response).text()) as Record<string, unknown>;
}

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
  testHome = join(tmpdir(), `pan-4499-fork-hold-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe('fork pipeline hold (PAN-4499 WI-4)', () => {
  it('hold launches the session and sends nothing', async () => {
    const injectSpy = vi.spyOn(forksModule, 'injectForkSummary');
    seed('fork-conv-1');
    await runForkPipeline('fork-conv-1', getConversationByName('parent-conv')!, 'fork-conv-1-session', undefined, 'handoff', false, false, undefined, 'focus', 'external', undefined, undefined, undefined, true);

    expect(injectSpy).not.toHaveBeenCalled();
    expect(readHeldKickoff('fork-conv-1')).toBe('## Handoff\n\nContinue the work.');
    const conv = getConversationByName('fork-conv-1');
    expect(conv?.forkStatus).toBeNull();
    expect(conv?.status).toBe('active');
  });

  it('hold persists in the fork request', async () => {
    const before = await handleConversationSummaryFork('parent-conv', { forkMode: 'handoff', hold: true, focus: 'carry on' });
    const body = await readBody(before);
    expect(before.status).toBe(200);
    const name = (body['conversation'] as { name: string }).name;
    await vi.waitFor(() => expect(getConversationByName(name)?.forkStatus).toBeNull());
    const stored = getConversationByName(name);
    expect(JSON.parse(stored?.forkRequest ?? '{}')).toMatchObject({ hold: true });
  });

  it('recovery of a held fork never delivers', async () => {
    const injectSpy = vi.spyOn(forksModule, 'injectForkSummary');
    const parent = getConversationByName('parent-conv')!;
    const fork = seed('fork-conv-2', { forkStatus: 'handoff' });
    setForkRequest(fork.name, JSON.stringify(buildForkRequest({
      parentConversationName: parent.name,
      sessionId: 'fork-conv-2-session',
      forkMode: 'handoff',
      localSummaryOnly: false,
      handoffAuthor: 'external',
      hold: true,
    })));

    await expect(recoverStuckForks()).resolves.toBe(1);

    expect(injectSpy).not.toHaveBeenCalled();
    expect(readHeldKickoff('fork-conv-2')).toBe('## Handoff\n\nContinue the work.');
  });

  it('plain fork with hold returns 400', async () => {
    const response = await handleConversationSummaryFork('parent-conv', { forkMode: 'plain', hold: true });
    expect(response.status).toBe(400);
    expect((await readBody(response))['error']).toBe('hold is not supported for plain forks');
  });

  it('without hold the kickoff is delivered as before (NFR-1)', async () => {
    const injectSpy = vi.spyOn(forksModule, 'injectForkSummary').mockResolvedValue('submitted');
    seed('fork-conv-3');
    await runForkPipeline('fork-conv-3', getConversationByName('parent-conv')!, 'fork-conv-3-session', undefined, 'handoff', false, false, undefined, 'focus', 'external');

    expect(injectSpy).toHaveBeenCalledTimes(1);
    expect(readHeldKickoff('fork-conv-3')).toBeNull();
  });
});
