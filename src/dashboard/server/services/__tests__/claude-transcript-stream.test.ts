/**
 * PAN-4558: the Claude conversation stream opens with a windowed snapshot,
 * sends projected deltas, and on a matching resume sends only the rows the
 * client lacks.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ChatMessage, ConversationEvent, WorkLogEntry } from '@overdeck/contracts';
import { Effect, Stream } from 'effect';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ParseResult } from '../conversation-service.js';

const mocks = vi.hoisted(() => ({
  initialParse: vi.fn(),
  /** Results the fake watcher hands the stream right after it starts. */
  watchResults: [] as unknown[],
}));

vi.mock('../shared-transcript-parser.js', () => ({
  sharedTranscriptParser: () => mocks.initialParse,
  parseStateFromSnapshot: () => ({}),
}));
vi.mock('../conversation/subagents.js', () => ({
  startSubagentListPolling: vi.fn(async () => ({ refresh: vi.fn(async () => undefined), stop: vi.fn() })),
}));
vi.mock('../conversation-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation-service.js')>()),
  contextUsageFromParseResult: () => null,
  watchConversation: (_file: string, callback: (result: unknown) => Promise<void>) => {
    void (async () => {
      for (const result of mocks.watchResults) await callback(result);
    })();
    return { stop: vi.fn() };
  },
}));

const { streamClaudeTranscript } = await import('../claude-transcript-stream.js');
const { transcriptIdOf } = await import('../conversation/window.js');

const TEST_DIR = mkdtempSync(join(tmpdir(), 'pan-4558-claude-stream-'));
const sessionFile = join(TEST_DIR, 'session.jsonl');
writeFileSync(sessionFile, '{}\n');
const { statSync } = await import('node:fs');
const TRANSCRIPT = transcriptIdOf(statSync(sessionFile));

function at(i: number): string {
  return new Date(Date.UTC(2026, 9, 19) + i * 1000).toISOString();
}

function parse(n: number, byteOffset = 1000, extraWork: WorkLogEntry[] = []): ParseResult {
  const messages: ChatMessage[] = [];
  const workLog: WorkLogEntry[] = [];
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) messages.push({ id: `m${i}`, role: 'user', text: `message ${i}`, createdAt: at(i), sequence: i });
    else workLog.push({ id: `t${i}`, createdAt: at(i), label: 'Bash', tone: 'tool', result: 'ok', sequence: i });
  }
  return {
    messages,
    workLog: [...workLog, ...extraWork],
    byteOffset,
    streaming: false,
    totalCost: 0,
    totalTokens: 0,
    contextBoundaryOffset: 0,
    contextActiveBytes: 0,
    pendingToolUse: new Map(),
    unresolvedResults: new Map(),
    lastSequence: n,
    mtimeMs: 0,
  } as ParseResult;
}

type MessagesEvent = Extract<ConversationEvent, { kind: 'messages' }>;

async function firstEvents(n: number, resume?: Parameters<typeof streamClaudeTranscript>[4]): Promise<MessagesEvent[]> {
  const events = await Effect.runPromise(
    streamClaudeTranscript(sessionFile, 'conv', null, undefined, resume).pipe(Stream.take(n), Stream.runCollect),
  );
  return [...events] as MessagesEvent[];
}

function rowCount(event: MessagesEvent): number {
  return event.messages.length + event.workLog.length;
}

beforeEach(() => {
  mocks.watchResults = [];
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('streamClaudeTranscript (PAN-4558)', () => {
  it('opens with a bounded windowed snapshot', async () => {
    mocks.initialParse.mockResolvedValue(parse(400));
    const [first] = await firstEvents(1);
    expect(first!.snapshot).toBe(true);
    expect(rowCount(first!)).toBe(75);
    expect(first!.window).toMatchObject({ hasOlder: true, transcript: TRANSCRIPT });
    expect(first!.reset).toBeUndefined();
  });

  it('sends an appended line as a projected delta', async () => {
    mocks.initialParse.mockResolvedValue(parse(10));
    const appended = parse(0, 2000, [{ id: 't11', createdAt: at(11), label: 'Bash', tone: 'tool', result: 'x'.repeat(9_000), sequence: 11 }]);
    mocks.watchResults = [appended];
    const [, delta] = await firstEvents(2);
    expect(delta!.snapshot).toBe(false);
    expect(delta!.window).toBeUndefined();
    expect(delta!.workLog.map((w) => w.id)).toEqual(['t11']);
    expect(delta!.workLog[0]!.result).toBeUndefined();
    expect(delta!.workLog[0]!.resultBytes).toBe(9_000);
  });

  it('windows a reset snapshot from the watcher', async () => {
    mocks.initialParse.mockResolvedValue(parse(10, 5000));
    mocks.watchResults = [parse(400, 100)];
    const [, reset] = await firstEvents(2);
    expect(reset!.snapshot).toBe(true);
    expect(reset!.reset).toBe(true);
    expect(rowCount(reset!)).toBe(75);
    expect(reset!.window?.hasOlder).toBe(true);
  });

  it('sends only new rows on a resume that matches the transcript', async () => {
    mocks.initialParse.mockResolvedValue(parse(400));
    const [first] = await firstEvents(1, { afterSequence: 396, openIds: [], transcript: TRANSCRIPT });
    expect(first!.snapshot).toBe(false);
    expect(first!.metadataSnapshot).toBe(true);
    expect(first!.window).toBeUndefined();
    expect([...first!.messages.map((m) => m.id), ...first!.workLog.map((w) => w.id)].sort()).toEqual(['m398', 't397', 't399']);
  });

  it('sends a windowed reset snapshot when the resume names another transcript', async () => {
    mocks.initialParse.mockResolvedValue(parse(400));
    const [first] = await firstEvents(1, { afterSequence: 396, openIds: [], transcript: '0:0' });
    expect(first!.snapshot).toBe(true);
    expect(first!.reset).toBe(true);
    expect(rowCount(first!)).toBe(75);
    expect(first!.window?.transcript).toBe(TRANSCRIPT);
  });
});
