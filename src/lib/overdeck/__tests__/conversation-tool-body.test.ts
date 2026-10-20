/**
 * PAN-4558: GET /api/conversations/:name/tool-body/:toolUseId returns the full
 * work entry behind a tool row whose body the wire projection omitted.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { WorkLogEntry } from '@overdeck/contracts';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, describe, expect, it, vi } from 'vitest';

const TEST_HOME = mkdtempSync(join(tmpdir(), 'pan-4558-tool-body-'));
process.env.OVERDECK_HOME = TEST_HOME;

const parseConversationMessagesMock = vi.hoisted(() => vi.fn());

vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));
vi.mock('../../../dashboard/server/services/conversation-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../dashboard/server/services/conversation-service.js')>();
  return { ...actual, parseConversationMessages: parseConversationMessagesMock };
});

const { createConversation } = await import('../conversations.js');
const { closeOverdeckDatabase } = await import('../infra.js');
const { getConversationToolBodyRead } = await import('../conversation-reads.js');
const { subagentTranscriptPath } = await import('../../../dashboard/server/services/conversation/subagents.js');

const FULL_RESULT = 'r'.repeat(10_240);

function parseResult(workLog: WorkLogEntry[], pending: WorkLogEntry[] = []) {
  return {
    messages: [],
    workLog,
    byteOffset: Number.MAX_SAFE_INTEGER,
    streaming: false,
    totalCost: 0,
    totalTokens: 0,
    contextBoundaryOffset: 0,
    contextActiveBytes: 0,
    pendingToolUse: new Map(pending.map((entry) => [entry.id, entry])),
    unresolvedResults: new Map(),
    lastSequence: 0,
    mtimeMs: 0,
  };
}

function tool(id: string, result?: string): WorkLogEntry {
  return { id, createdAt: '2026-10-19T00:00:00.000Z', label: 'Bash', tone: 'tool', toolInput: { command: 'cat big.log' }, ...(result ? { result } : {}) };
}

const name = 'tool-body-conv';
const sessionFile = join(TEST_HOME, `${name}.jsonl`);
writeFileSync(sessionFile, '{}\n');
createConversation({ name, tmuxSession: `conv-${name}`, cwd: TEST_HOME, title: name, model: 'claude-sonnet-5' });
const subagentFile = subagentTranscriptPath(sessionFile, 'abc123')!;
mkdirSync(dirname(subagentFile), { recursive: true });
writeFileSync(subagentFile, '{}\n');

parseConversationMessagesMock.mockImplementation(async (file: string) => file === sessionFile
  ? parseResult([tool('toolu_big', FULL_RESULT)], [tool('toolu_pending')])
  : parseResult([tool('toolu_sub', 'subagent output')]));

const deps = { resolveSessionFile: async () => sessionFile };

afterAll(() => {
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('getConversationToolBodyRead (PAN-4558)', () => {
  it('returns the full unprojected entry for a known id', async () => {
    const res = await getConversationToolBodyRead(name, 'toolu_big', deps);
    expect(res.status ?? 200).toBe(200);
    const { entry } = res.body as { entry: WorkLogEntry };
    expect(entry.result).toBe(FULL_RESULT);
    expect(entry.bodyOmitted).toBeUndefined();
  });

  it('finds a still-pending tool call', async () => {
    const res = await getConversationToolBodyRead(name, 'toolu_pending', deps);
    expect((res.body as { entry: WorkLogEntry }).entry.id).toBe('toolu_pending');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await getConversationToolBodyRead(name, 'toolu_missing', deps);
    expect(res).toEqual({ body: { error: 'Tool entry not found' }, status: 404 });
  });

  it('reads a subagent transcript when agentId is given', async () => {
    const res = await getConversationToolBodyRead(name, 'toolu_sub', deps, 'abc123');
    expect((res.body as { entry: WorkLogEntry }).entry.result).toBe('subagent output');
    expect((await getConversationToolBodyRead(name, 'toolu_big', deps, 'abc123')).status).toBe(404);
  });

  it('returns 404 for an unknown conversation', async () => {
    const res = await getConversationToolBodyRead('no-such-conv', 'toolu_big', { resolveSessionFile: async () => null });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/conversations/:name/tool-body/:toolUseId (PAN-4558)', () => {
  it('serves the entry through the route', async () => {
    const { conversationsRouteLayer } = await import('../../../dashboard/server/routes/conversations.js');
    const request = HttpServerRequest.fromWeb(new Request(`http://localhost/api/conversations/${name}/tool-body/toolu_missing`, {
      method: 'GET',
      headers: { Origin: 'http://localhost:3011' },
    }));
    // The route layer declares platform services it never touches on this path.
    const response = await Effect.runPromise(Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(conversationsRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ) as unknown as Effect.Effect<{ status: number; body: unknown }>);
    expect(response.status).toBe(404);
    const payload = response.body as { body: Uint8Array };
    expect(JSON.parse(new TextDecoder().decode(payload.body))).toEqual({ error: 'Tool entry not found' });
  });
});
