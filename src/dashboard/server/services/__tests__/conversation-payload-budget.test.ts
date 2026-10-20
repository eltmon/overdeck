/**
 * PAN-4558 NFR-1: opening a transcript larger than 5 MB sends at most
 * CONVERSATION_PAYLOAD_BUDGET_BYTES over HTTP and as the first WS event.
 * The negative control proves the assertions fail if the window grows.
 */
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONVERSATION_PAYLOAD_BUDGET_BYTES, type ConversationEvent } from '@overdeck/contracts';
import { Effect, Stream } from 'effect';
import { afterAll, describe, expect, it, vi } from 'vitest';

const TEST_HOME = mkdtempSync(join(tmpdir(), 'pan-4558-payload-budget-'));
process.env.OVERDECK_HOME = TEST_HOME;

vi.mock('../../event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));

const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
const { closeOverdeckDatabase } = await import('../../../../lib/overdeck/infra.js');
const { getConversationMessagesRead } = await import('../../../../lib/overdeck/conversation-reads.js');
const { streamClaudeTranscript } = await import('../claude-transcript-stream.js');
const { parseEntireConversation } = await import('../conversation-service.js');
const { createTranscriptDelta } = await import('../transcript-delta.js');
const { selectInitialWindow } = await import('../conversation/window.js');

const sessionFile = join(TEST_HOME, 'big-session.jsonl');

/** 1,000 user/assistant pairs of 1.6 KB text, interleaved with 500 Bash calls returning 3-20 KB. */
function writeFixture(): void {
  const lines: string[] = [];
  let t = Date.UTC(2026, 9, 1);
  const ts = () => new Date((t += 1000)).toISOString();
  const prose = (seed: number) => `${seed} `.padEnd(1_600, 'lorem ipsum dolor sit amet ');
  for (let i = 0; i < 1_000; i++) {
    lines.push(JSON.stringify({ type: 'user', uuid: `u-${i}`, timestamp: ts(), message: { content: [{ type: 'text', text: prose(i) }] } }));
    const content: unknown[] = [{ type: 'text', text: prose(i + 10_000) }];
    const withTool = i % 2 === 0;
    if (withTool) content.push({ type: 'tool_use', id: `tool-${i}`, name: 'Bash', input: { command: `cat log-${i}.txt` } });
    lines.push(JSON.stringify({
      type: 'assistant', uuid: `a-${i}`, timestamp: ts(),
      message: { id: `msg-${i}`, role: 'assistant', content, stop_reason: withTool ? 'tool_use' : 'end_turn' },
    }));
    if (withTool) {
      const size = 3_000 + ((i * 7_919) % 17_000);
      lines.push(JSON.stringify({
        type: 'user', uuid: `r-${i}`, timestamp: ts(),
        message: { content: [{ type: 'tool_result', tool_use_id: `tool-${i}`, content: 'x'.repeat(size), is_error: false }] },
      }));
    }
  }
  writeFileSync(sessionFile, `${lines.join('\n')}\n`);
}

function encodedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

writeFixture();

afterAll(() => {
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('conversation payload budget (PAN-4558 NFR-1)', () => {
  it('uses a fixture larger than 5 MB', () => {
    expect(statSync(sessionFile).size).toBeGreaterThan(5_000_000);
  });

  it('keeps the initial HTTP body within the budget', async () => {
    createConversation({ name: 'budget-conv', tmuxSession: 'conv-budget-conv', cwd: TEST_HOME, title: 'budget', model: 'claude-sonnet-5' });
    const res = await getConversationMessagesRead('budget-conv', {
      resolveSessionFile: async () => sessionFile,
      shouldReportUnresolvedLiveSession: () => false,
    });
    const body = res.body as { messages: unknown[]; window?: { hasOlder: boolean } };
    expect(body.messages.length).toBeGreaterThan(0);
    expect(body.window?.hasOlder).toBe(true);
    expect(encodedBytes(body)).toBeLessThanOrEqual(CONVERSATION_PAYLOAD_BUDGET_BYTES);
  }, 60_000);

  it('keeps the first Claude WS event within the budget', async () => {
    // A subagent id skips subagent list polling, which this test does not exercise.
    const events = await Effect.runPromise(
      streamClaudeTranscript(sessionFile, 'budget-conv', null, 'no-subagent-poll').pipe(Stream.take(1), Stream.runCollect),
    );
    const [first] = [...events] as Array<Extract<ConversationEvent, { kind: 'messages' }>>;
    expect(first!.window?.hasOlder).toBe(true);
    expect(encodedBytes(first)).toBeLessThanOrEqual(CONVERSATION_PAYLOAD_BUDGET_BYTES);
  }, 60_000);

  it('keeps the first full-parse WS event within the budget, and an unbounded window would not', async () => {
    const parsed = await parseEntireConversation(sessionFile);
    const first = createTranscriptDelta(null)(parsed);
    expect(encodedBytes(first)).toBeLessThanOrEqual(CONVERSATION_PAYLOAD_BUDGET_BYTES);

    const unbounded = selectInitialWindow(parsed, undefined, { maxRows: 1_000_000, maxBytes: Number.POSITIVE_INFINITY });
    expect(encodedBytes(unbounded)).toBeGreaterThan(CONVERSATION_PAYLOAD_BUDGET_BYTES);
  }, 60_000);
});
