import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MAX_READ_BYTES, type ParseState } from '../types.js';
import { parseConversationMessages } from '../parser.js';

const CONTINUATION_SUMMARY_TEXT = [
  'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.',
  '',
  'Summary:',
  '1. Primary Request and Intent: Migrate the billing service to the new invoicing API.',
  '',
  'Overdeck native compaction model: claude-opus-4-7',
  '',
  'Continue from this summary without redoing already-completed work.',
].join('\n');

let testDir: string;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

function makeTestDir(): string {
  testDir = mkdtempSync(join(tmpdir(), 'overdeck-parser-compact-summary-'));
  return testDir;
}

function userLine(text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: text },
    timestamp: '2026-01-01T00:00:00.000Z',
    uuid: `u-${Math.random().toString(36).slice(2)}`,
    ...extra,
  });
}

function assistantLine(text: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    timestamp: '2026-01-01T00:00:01.000Z',
    uuid: `a-${Math.random().toString(36).slice(2)}`,
  });
}

function boundaryLine(): string {
  return JSON.stringify({
    type: 'system',
    subtype: 'compact_boundary',
    timestamp: '2026-01-01T00:00:02.000Z',
    uuid: `b-${Math.random().toString(36).slice(2)}`,
  });
}

describe('parseConversationMessages — latestCompactSummary', () => {
  it('ac1: records the compaction summary text and its sequence, and keeps it out of messages', async () => {
    const dir = makeTestDir();
    const file = join(dir, 'session.jsonl');
    const lines = [
      userLine('Please migrate the billing service.'), // sequence 0
      assistantLine('Working on it.'), // sequence 1
      boundaryLine(), // sequence 2
      userLine(CONTINUATION_SUMMARY_TEXT, { isCompactSummary: true }), // sequence 3
      userLine('Now add tests.'), // sequence 4
      assistantLine('Added tests.'), // sequence 5
    ];
    writeFileSync(file, `${lines.join('\n')}\n`);

    const result = await parseConversationMessages(file, 0);

    expect(result.latestCompactSummary?.text).toBe(CONTINUATION_SUMMARY_TEXT);
    expect(result.latestCompactSummary?.sequence).toBe(3);
    for (const message of result.messages) {
      expect(message.text).not.toContain(CONTINUATION_SUMMARY_TEXT);
    }
  });

  it('ac2: joins content-block text when message.content is an array of text blocks', async () => {
    const dir = makeTestDir();
    const file = join(dir, 'session.jsonl');
    const lines = [
      userLine('Please migrate the billing service.'),
      boundaryLine(),
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'This session is being continued from a previous conversation.' },
            { type: 'text', text: 'Second block of the summary.' },
          ],
        },
        isCompactSummary: true,
        timestamp: '2026-01-01T00:00:02.000Z',
        uuid: 'summary-1',
      }),
      userLine('Now add tests.'),
    ];
    writeFileSync(file, `${lines.join('\n')}\n`);

    const result = await parseConversationMessages(file, 0);

    expect(result.latestCompactSummary?.text).toBe(
      'This session is being continued from a previous conversation.\nSecond block of the summary.',
    );
  });

  it('ac3: incremental parse replaces the summary when a new one appears, and preserves it otherwise', async () => {
    const dir = makeTestDir();
    const file = join(dir, 'session.jsonl');
    const initialLines = [
      userLine('Please migrate the billing service.'),
      boundaryLine(),
      userLine('Summary A: earlier work on billing.', { isCompactSummary: true }),
    ];
    writeFileSync(file, `${initialLines.join('\n')}\n`);

    const first = await parseConversationMessages(file, 0);
    expect(first.latestCompactSummary?.text).toBe('Summary A: earlier work on billing.');

    const priorState: ParseState = {
      pendingToolUse: first.pendingToolUse,
      unresolvedResults: first.unresolvedResults,
      lastSequence: first.lastSequence,
      latestCompactSummary: first.latestCompactSummary,
    };

    // Append lines with no new summary — the prior summary must be preserved.
    appendFileSync(file, `${userLine('Just a follow-up turn.')}\n`);
    const second = await parseConversationMessages(file, first.byteOffset, priorState);
    expect(second.latestCompactSummary?.text).toBe('Summary A: earlier work on billing.');

    const priorState2: ParseState = {
      pendingToolUse: second.pendingToolUse,
      unresolvedResults: second.unresolvedResults,
      lastSequence: second.lastSequence,
      latestCompactSummary: second.latestCompactSummary,
    };

    // Append a second boundary + a new summary — it must replace summary A.
    appendFileSync(
      file,
      `${boundaryLine()}\n${userLine('Summary B: later work on billing.', { isCompactSummary: true })}\n`,
    );
    const third = await parseConversationMessages(file, second.byteOffset, priorState2);
    expect(third.latestCompactSummary?.text).toBe('Summary B: later work on billing.');
  });

  it('ac4: preserves the summary when the transcript exceeds MAX_READ_BYTES and delegates to parseEntireConversation', async () => {
    const dir = makeTestDir();
    const file = join(dir, 'session.jsonl');
    const lines = [
      userLine('Please migrate the billing service.'),
      boundaryLine(),
      userLine(CONTINUATION_SUMMARY_TEXT, { isCompactSummary: true }),
    ];
    writeFileSync(file, `${lines.join('\n')}\n`);

    // Pad the transcript well past MAX_READ_BYTES so parseConversationMessages(file, 0)
    // with no priorState delegates to parseEntireConversation's chunked loop.
    const paddingChunk = 'x'.repeat(100_000);
    const paddingLinesNeeded = Math.ceil((MAX_READ_BYTES * 1.2) / (paddingChunk.length + 40));
    for (let i = 0; i < paddingLinesNeeded; i++) {
      appendFileSync(file, `${userLine(paddingChunk)}\n`);
    }

    const result = await parseConversationMessages(file, 0);

    expect(result.latestCompactSummary?.text).toBe(CONTINUATION_SUMMARY_TEXT);
  });
});
