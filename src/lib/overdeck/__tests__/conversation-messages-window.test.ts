/**
 * PAN-4558: GET /api/conversations/:name/messages bounds a cold open to a
 * window, pages older rows by cursor, and keeps the full body behind
 * `window=all`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { decodeTimelineCursor, type ChatMessage, type WorkLogEntry } from '@overdeck/contracts';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterAll, describe, expect, it, vi } from 'vitest';

const TEST_HOME = mkdtempSync(join(tmpdir(), 'pan-4558-messages-window-'));
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
const { getConversationMessagesRead } = await import('../conversation-reads.js');
const { subagentTranscriptPath } = await import('../../../dashboard/server/services/conversation/subagents.js');

function at(i: number): string {
  return new Date(Date.UTC(2026, 9, 19) + i * 1000).toISOString();
}

/** n entries alternating message and tool, each its own timeline row. */
function parseResult(n: number, prefix = '') {
  const messages: ChatMessage[] = [];
  const workLog: WorkLogEntry[] = [];
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) messages.push({ id: `${prefix}m${i}`, role: 'user', text: `message ${i}`, createdAt: at(i), sequence: i });
    else workLog.push({ id: `${prefix}t${i}`, createdAt: at(i), label: 'Bash', tone: 'tool', result: 'r'.repeat(i === 399 ? 8_000 : 10), sequence: i });
  }
  return {
    messages,
    workLog,
    byteOffset: Number.MAX_SAFE_INTEGER,
    streaming: false,
    totalCost: 1.5,
    totalTokens: 1000,
    contextBoundaryOffset: 0,
    contextActiveBytes: 0,
    pendingToolUse: new Map(),
    unresolvedResults: new Map(),
    lastSequence: n,
    mtimeMs: 0,
  };
}

let fixtureCount = 0;
function fixture(n: number): { name: string; sessionFile: string } {
  fixtureCount++;
  const name = `messages-window-${fixtureCount}`;
  const sessionFile = join(TEST_HOME, `${name}.jsonl`);
  writeFileSync(sessionFile, '{}\n');
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: TEST_HOME, title: name, model: 'claude-sonnet-5' });
  parseConversationMessagesMock.mockImplementation(async (file: string) =>
    parseResult(n, file === sessionFile ? '' : 'sub-'));
  return { name, sessionFile };
}

function depsFor(sessionFile: string) {
  return { resolveSessionFile: async () => sessionFile, shouldReportUnresolvedLiveSession: () => false };
}

interface WindowBody {
  messages: ChatMessage[];
  workLog: WorkLogEntry[];
  window?: { cursor: string | null; hasOlder: boolean; transcript?: string };
  totalCost?: number;
}

function ids(body: WindowBody): string[] {
  return [...body.messages.map((m) => m.id), ...body.workLog.map((w) => w.id)];
}

afterAll(() => {
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('getConversationMessagesRead windowing (PAN-4558)', () => {
  it('returns a bounded window with metadata by default', async () => {
    const { name, sessionFile } = fixture(400);
    const res = await getConversationMessagesRead(name, depsFor(sessionFile));
    const body = res.body as WindowBody;
    expect(res.status ?? 200).toBe(200);
    expect(body.messages.length + body.workLog.length).toBe(75);
    expect(body.window?.hasOlder).toBe(true);
    expect(body.window?.transcript).toMatch(/^\d+:\d+$/);
    expect(body.totalCost).toBe(1.5);
    // The 8 KB result of the newest tool entry is elided on the wire.
    const newest = body.workLog.find((w) => w.id === 't399')!;
    expect(newest.result).toBeUndefined();
    expect(newest.resultBytes).toBe(8_000);
  });

  it('returns every entry unprojected and no window for mode all', async () => {
    const { name, sessionFile } = fixture(400);
    const body = (await getConversationMessagesRead(name, depsFor(sessionFile), undefined, { mode: 'all' })).body as WindowBody;
    expect(body.messages.length + body.workLog.length).toBe(400);
    expect(body.window).toBeUndefined();
    expect(body.workLog.find((w) => w.id === 't399')!.result).toHaveLength(8_000);
  });

  it('pages back to the first entry with no duplicates', async () => {
    const { name, sessionFile } = fixture(400);
    const deps = depsFor(sessionFile);
    const first = (await getConversationMessagesRead(name, deps)).body as WindowBody;
    const all = ids(first);
    let window = first.window!;
    while (window.hasOlder) {
      const page = (await getConversationMessagesRead(name, deps, undefined, {
        mode: 'page',
        before: decodeTimelineCursor(window.cursor!)!,
        limit: 75,
      })).body as WindowBody;
      expect(Object.keys(page).sort()).toEqual(['messages', 'window', 'workLog']);
      all.push(...ids(page));
      window = page.window!;
    }
    expect(all).toHaveLength(400);
    expect(new Set(all).size).toBe(400);
    expect(all).toContain('m0');
  });

  it('pages a subagent transcript when agentId is given', async () => {
    const { name, sessionFile } = fixture(200);
    const subagentFile = subagentTranscriptPath(sessionFile, 'abc123')!;
    mkdirSync(dirname(subagentFile), { recursive: true });
    writeFileSync(subagentFile, '{}\n');
    const first = (await getConversationMessagesRead(name, depsFor(sessionFile), 'abc123')).body as WindowBody;
    expect(ids(first).every((id) => id.startsWith('sub-'))).toBe(true);
    const page = (await getConversationMessagesRead(name, depsFor(sessionFile), 'abc123', {
      mode: 'page',
      before: decodeTimelineCursor(first.window!.cursor!)!,
      limit: 10,
    })).body as WindowBody;
    expect(page.messages.length + page.workLog.length).toBe(10);
    expect(ids(page).every((id) => id.startsWith('sub-'))).toBe(true);
  });
});

describe('GET /api/conversations/:name/messages query parsing (PAN-4558)', () => {
  async function get(path: string) {
    const { conversationsRouteLayer } = await import('../../../dashboard/server/routes/conversations.js');
    const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, {
      method: 'GET',
      headers: { Origin: 'http://localhost:3011' },
    }));
    // The route layer declares platform services it never touches on this path.
    const response = Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(conversationsRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
    ) as unknown as Effect.Effect<{ status: number; body: unknown }>;
    return Effect.runPromise(response);
  }

  function json(response: { body: unknown }): Record<string, unknown> {
    const payload = response.body as { body: Uint8Array } | null;
    return JSON.parse(payload?.body ? new TextDecoder().decode(payload.body) : '{}') as Record<string, unknown>;
  }

  it('rejects a malformed cursor with 400', async () => {
    const response = await get(`/api/conversations/whatever/messages?before=${encodeURIComponent('[1,2]')}`);
    expect(response.status).toBe(400);
    expect(json(response)).toEqual({ error: 'Invalid cursor' });
  });
});
