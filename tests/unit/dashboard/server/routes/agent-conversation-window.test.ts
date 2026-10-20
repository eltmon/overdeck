/**
 * PAN-4558: GET /api/agents/:id/conversation keeps its full body without
 * params, bounds it with `?window=initial`, pages it with `?before=`, and
 * serves omitted tool bodies from `/conversation/tool-body/:toolUseId`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decodeTimelineCursor, type ChatMessage, type WorkLogEntry } from '@overdeck/contracts';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/dashboard/server/routes/agents/shared.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../src/dashboard/server/routes/agents/shared.js')>()),
  getAgentWorkspace: vi.fn(async () => '/workspace/feature-pan-4558'),
}));
vi.mock('../../../../../src/dashboard/server/services/conversation-service.js', () => ({
  parseEntireConversation: vi.fn(),
}));
vi.mock('../../../../../src/lib/agents/transcript-resolver.js', () => ({
  listAgentTranscriptCandidates: vi.fn(),
}));
vi.mock('../../../../../src/dashboard/server/services/agent-subagents.js', () => ({
  isSafeSubagentId: vi.fn((id: string) => /^[A-Za-z0-9_-]+$/.test(id)),
  listAgentSubagents: vi.fn(async () => []),
  resolveAgentSubagentTranscript: vi.fn(async () => null),
}));
vi.mock('../../../../../src/lib/agents.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../src/lib/agents.js')>()),
  getAgentState: vi.fn(() => null),
}));

const { buildAgentConversationWindowResult, buildAgentToolBodyResult } = await import('../../../../../src/dashboard/server/routes/agents/conversation.js');
const { parseEntireConversation } = await import('../../../../../src/dashboard/server/services/conversation-service.js');
const { listAgentTranscriptCandidates } = await import('../../../../../src/lib/agents/transcript-resolver.js');
const { resolveAgentSubagentTranscript } = await import('../../../../../src/dashboard/server/services/agent-subagents.js');

const TEST_DIR = mkdtempSync(join(tmpdir(), 'pan-4558-agent-window-'));
const transcript = join(TEST_DIR, 'session.jsonl');
const subagentTranscript = join(TEST_DIR, 'agent-sub.jsonl');
writeFileSync(transcript, '{}\n');
writeFileSync(subagentTranscript, '{}\n');

function at(i: number): string {
  return new Date(Date.UTC(2026, 9, 19) + i * 1000).toISOString();
}

function parseResult(n: number, prefix = '') {
  const messages: ChatMessage[] = [];
  const workLog: WorkLogEntry[] = [];
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) messages.push({ id: `${prefix}m${i}`, role: 'user', text: `message ${i}`, createdAt: at(i), sequence: i });
    else workLog.push({ id: `${prefix}t${i}`, createdAt: at(i), label: 'Bash', tone: 'tool', result: 'r'.repeat(i === 201 ? 9_000 : 10), sequence: i });
  }
  return { messages, workLog, streaming: false, totalCost: 2, byteOffset: 10, pendingToolUse: new Map(), unresolvedResults: new Map(), lastSequence: n, mtimeMs: 0 };
}

interface Body {
  messages: ChatMessage[];
  workLog: WorkLogEntry[];
  window?: { cursor: string | null; hasOlder: boolean; transcript?: string };
  totalCost?: number;
}

function ids(body: Body): string[] {
  return [...body.messages.map((m) => m.id), ...body.workLog.map((w) => w.id)];
}

beforeEach(() => {
  vi.mocked(listAgentTranscriptCandidates).mockResolvedValue([{ kind: 'claude', path: transcript }] as never);
  vi.mocked(parseEntireConversation).mockImplementation(async (path: string) =>
    parseResult(path === transcript ? 300 : 120, path === transcript ? '' : 'sub-') as never);
  vi.mocked(resolveAgentSubagentTranscript).mockResolvedValue({ kind: 'claude', path: subagentTranscript } as never);
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('buildAgentConversationWindowResult (PAN-4558)', () => {
  it('returns the full body without params', async () => {
    const result = await buildAgentConversationWindowResult('agent-pan-4558', new URLSearchParams());
    const body = result.body as Body;
    expect(result.status).toBe(200);
    expect(body.messages.length + body.workLog.length).toBe(300);
    expect(body.window).toBeUndefined();
    expect(body.workLog.find((w) => w.id === 't201')!.result).toHaveLength(9_000);
  });

  it('bounds the body with window=initial', async () => {
    const result = await buildAgentConversationWindowResult('agent-pan-4558', new URLSearchParams('window=initial'));
    const body = result.body as Body;
    expect(body.messages.length + body.workLog.length).toBe(75);
    expect(body.window?.hasOlder).toBe(true);
    expect(body.window?.transcript).toMatch(/^\d+:\d+$/);
    expect(body.totalCost).toBe(2);
  });

  it('pages to the first entry with no duplicates', async () => {
    const first = (await buildAgentConversationWindowResult('agent-pan-4558', new URLSearchParams('window=initial'))).body as Body;
    const all = ids(first);
    let window = first.window!;
    while (window.hasOlder) {
      const query = new URLSearchParams({ before: window.cursor!, limit: '50' });
      const page = (await buildAgentConversationWindowResult('agent-pan-4558', query)).body as Body;
      expect(decodeTimelineCursor(page.window!.cursor!)).not.toBeNull();
      all.push(...ids(page));
      window = page.window!;
    }
    expect(all).toHaveLength(300);
    expect(new Set(all).size).toBe(300);
  });

  it('projects tool bodies on a page', async () => {
    const first = (await buildAgentConversationWindowResult('agent-pan-4558', new URLSearchParams('window=initial'))).body as Body;
    const page = (await buildAgentConversationWindowResult('agent-pan-4558', new URLSearchParams({ before: first.window!.cursor!, limit: '200' }))).body as Body;
    const t201 = page.workLog.find((w) => w.id === 't201')!;
    expect(t201.result).toBeUndefined();
    expect(t201.resultBytes).toBe(9_000);
    expect(t201.bodyOmitted).toBe(true);
  });

  it('combines window=initial with subagentId', async () => {
    const body = (await buildAgentConversationWindowResult('agent-pan-4558', new URLSearchParams('window=initial&subagentId=sub'))).body as Body;
    expect(body.messages.length + body.workLog.length).toBe(75);
    expect(ids(body).every((id) => id.startsWith('sub-'))).toBe(true);
  });

  it('rejects a malformed cursor with 400', async () => {
    const result = await buildAgentConversationWindowResult('agent-pan-4558', new URLSearchParams('before=nope'));
    expect(result).toEqual({ status: 400, body: { error: 'Invalid cursor' } });
  });
});

describe('buildAgentToolBodyResult (PAN-4558)', () => {
  it('returns the full entry for a known id', async () => {
    const result = await buildAgentToolBodyResult('agent-pan-4558', 't201');
    expect(result.status).toBe(200);
    expect((result.body as { entry: WorkLogEntry }).entry.result).toHaveLength(9_000);
  });

  it('returns 404 for an unknown id', async () => {
    expect(await buildAgentToolBodyResult('agent-pan-4558', 'toolu_missing')).toEqual({ status: 404, body: { error: 'Tool entry not found' } });
  });

  it('reads the subagent transcript with subagentId', async () => {
    const result = await buildAgentToolBodyResult('agent-pan-4558', 'sub-t1', { subagentId: 'sub' });
    expect((result.body as { entry: WorkLogEntry }).entry.id).toBe('sub-t1');
  });
});
