/**
 * PAN-4223 WI-14 (FR-25, D3): every fork mode stamps parent_conversation_id on
 * the successor row at creation, through the one createConversation call in
 * handleConversationSummaryFork. Nothing else in the fork path changes (NFR-7).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpServerResponse } from 'effect/unstable/http';

vi.mock('../../conversations/summary-fork.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../conversations/summary-fork.js')>()),
  reserveSummaryForkSession: vi.fn(async () => ({ sessionId: `fork-${Math.random().toString(36).slice(2)}` })),
  // The pipeline runs in the background; park every mode at its first
  // external step so the test observes only what the route did.
  generateSummaryForFork: vi.fn(() => new Promise(() => {})),
  authorHandoffExternal: vi.fn(() => new Promise(() => {})),
  copySessionFromCompactBoundary: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../conversation-runtime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation-runtime.js')>()),
  resolveAllowedHarness: vi.fn(async () => 'claude-code'),
  spawnConversationSession: vi.fn(async () => {}),
  isInsideGitWorkTree: vi.fn(async () => true),
}));

const { handleConversationSummaryFork } = await import('../conversation-forks.js');
const { sessionFilePath } = await import('../../runtimes/storage/claude-code.js');
const {
  authorHandoffExternal,
  copySessionFromCompactBoundary,
  generateSummaryForFork,
} = await import('../../conversations/summary-fork.js');
const { createConversation, getConversationByName, listConversations, listLaneConversations } = await import('../conversations.js');

let testHome: string;
let originalHome: string | undefined;
let parentCwd: string;

type ForkedConversation = {
  id: number; name: string; tmuxSession: string; claudeSessionId: string | null;
  parentConversationId: number | null; parentConversationName: string | null;
  gauntletRun: string | null; laneKey: string | null; laneRole: string | null; forkRequest: string | null;
};

async function readBody(response: HttpServerResponse.HttpServerResponse): Promise<Record<string, unknown>> {
  return JSON.parse(await HttpServerResponse.toWeb(response).text()) as Record<string, unknown>;
}

const parkedStep = {
  summary: () => generateSummaryForFork,
  handoff: () => authorHandoffExternal,
  plain: () => copySessionFromCompactBoundary,
} as const;

async function fork(source: string, body: Record<string, unknown> & { forkMode?: keyof typeof parkedStep }) {
  const mode = body.forkMode ?? 'summary';
  const step = vi.mocked(parkedStep[mode]());
  const before = step.mock.calls.length;
  const response = await handleConversationSummaryFork(source, body);
  // Wait for the background pipeline to park so teardown never races it.
  if (response.status === 200) await vi.waitFor(() => expect(step.mock.calls.length).toBe(before + 1));
  return { status: response.status, body: await readBody(response) };
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
  testHome = join(tmpdir(), `pan-4223-fork-parent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  parentCwd = join(testHome, 'parent-project');
  mkdirSync(parentCwd, { recursive: true });
  seed('parent-conv');
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('fork successors carry the parent link (PAN-4223 WI-14)', () => {
  it.each(['handoff', 'plain', 'summary'] as const)('forkMode %s stamps the source as parent and no lane facts', async (forkMode) => {
    const source = getConversationByName('parent-conv');
    const { status, body } = await fork('parent-conv', { forkMode, handoffAuthor: 'external', focus: 'carry on' });
    expect(status).toBe(200);
    expect(body['success']).toBe(true);
    const conversation = body['conversation'] as ForkedConversation;
    expect(conversation).toMatchObject({
      parentConversationName: 'parent-conv',
      parentConversationId: source?.id,
      gauntletRun: null,
      laneKey: null,
      laneRole: null,
    });
    // NFR-7: fork_request still names the source; the stored row agrees with the response.
    const stored = getConversationByName(conversation.name);
    expect(stored?.parentConversationName).toBe('parent-conv');
    expect(JSON.parse(stored?.forkRequest ?? '{}')).toMatchObject({ parentConversationName: 'parent-conv', forkMode });
  });

  it('creates no row when validation rejects the request', async () => {
    const before = listConversations().length;
    const { status, body } = await fork('parent-conv', { model: '  ' });
    expect(status).toBe(400);
    expect(body['error']).toBe('model must not be blank');
    expect(listConversations().length).toBe(before);
  });

  it('nests a successor of a builder lane under the lane without making it a lane (D21)', async () => {
    seed('orch-root');
    const lane = seed('builder-lane', { parentName: 'orch-root', lane: { run: 'hotel', key: '663', role: 'builder' } });

    const { body } = await fork('builder-lane', { forkMode: 'handoff', handoffAuthor: 'external', focus: 'finish 663' });
    const successor = body['conversation'] as ForkedConversation;
    expect(successor).toMatchObject({ parentConversationId: lane.id, parentConversationName: 'builder-lane', gauntletRun: null, laneKey: null, laneRole: null });
    expect(listLaneConversations({ run: 'hotel' }).map((row) => row.name)).toEqual(['builder-lane']);
  });

  it('links a successor of a successor to its own source, one edge each', async () => {
    const root = getConversationByName('parent-conv');
    const first = (await fork('parent-conv', { forkMode: 'summary' })).body['conversation'] as ForkedConversation;
    // The first successor needs a session file to be forked from in turn.
    writeSessionFile(parentCwd, first.claudeSessionId ?? '');

    const second = (await fork(first.name, { forkMode: 'summary' })).body['conversation'] as ForkedConversation;
    expect(first).toMatchObject({ parentConversationId: root?.id, parentConversationName: 'parent-conv' });
    expect(second).toMatchObject({ parentConversationId: first.id, parentConversationName: first.name });
  });
});
