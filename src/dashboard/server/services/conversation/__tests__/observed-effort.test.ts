/**
 * PAN-4255: observed effort reaches ContextUsage.lastEffort through both the
 * incremental parser and computeContextUsage.
 */
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetContextUsageCacheForTests, computeContextUsage, contextUsageFromParseResult } from '../context-usage.js';
import { parseConversationMessages } from '../parser.js';

const MODEL = 'claude-opus-4-7';
let testDir: string;

function assistantLine(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      id: `msg-${Math.random().toString(36).slice(2)}`,
      role: 'assistant',
      model: MODEL,
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
    timestamp: '2026-10-03T10:00:00.000Z',
    uuid: `a-${Math.random().toString(36).slice(2)}`,
    ...extra,
  });
}

function userLine(content: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content },
    timestamp: '2026-10-03T10:01:00.000Z',
    uuid: `u-${Math.random().toString(36).slice(2)}`,
    ...extra,
  });
}

const LOW_CONFIRMATION =
  '<local-command-stdout>Set effort level to low (saved as your default for new sessions): Quick, straightforward implementation</local-command-stdout>';

function writeFixture(lines: string[]): string {
  const file = join(testDir, 'session.jsonl');
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'overdeck-observed-effort-'));
  __resetContextUsageCacheForTests();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('observed effort', () => {
  it('takes the /effort confirmation that follows a high assistant turn', async () => {
    const file = writeFixture([
      userLine('hello'),
      assistantLine({ effort: 'high', perTurnEffort: 'high' }),
      userLine('<command-name>/effort</command-name>\n            <command-args>low</command-args>'),
      userLine(LOW_CONFIRMATION),
    ]);

    const parsed = await parseConversationMessages(file, 0);
    expect(parsed.observedEffort).toBe('low');
    expect(contextUsageFromParseResult(parsed, MODEL)?.lastEffort).toBe('low');
    expect((await computeContextUsage(file, MODEL))?.lastEffort).toBe('low');
  });

  it('is null when the transcript has no effort fields', async () => {
    const file = writeFixture([userLine('hello'), assistantLine()]);

    const parsed = await parseConversationMessages(file, 0);
    expect(parsed.observedEffort).toBeNull();
    expect(contextUsageFromParseResult(parsed, MODEL)?.lastEffort).toBeNull();
    expect((await computeContextUsage(file, MODEL))?.lastEffort).toBeNull();
  });

  it('ignores sidechain records', async () => {
    const file = writeFixture([
      assistantLine({ effort: 'high' }),
      assistantLine({ effort: 'low', isSidechain: true }),
    ]);

    expect((await parseConversationMessages(file, 0)).observedEffort).toBe('high');
  });

  it('carries across incremental reads and survives a compact boundary', async () => {
    const file = writeFixture([assistantLine({ effort: 'medium' })]);
    const first = await parseConversationMessages(file, 0);
    expect(first.observedEffort).toBe('medium');

    appendFileSync(file, `${JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid: 'cb-1', timestamp: '2026-10-03T11:00:00.000Z' })}\n`);
    const second = await parseConversationMessages(file, first.byteOffset, {
      pendingToolUse: first.pendingToolUse,
      unresolvedResults: first.unresolvedResults,
      lastSequence: first.lastSequence,
      latestAssistantUsage: first.latestAssistantUsage,
      observedEffort: first.observedEffort,
      contextBoundaryOffset: first.contextBoundaryOffset,
    });

    expect(second.latestAssistantUsage).toBeNull();
    expect(second.observedEffort).toBe('medium');
  });
});
