import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LAST_ASSISTANT_TAIL_BYTES, readLastAssistantMessageFromCandidate } from '../last-assistant-message.js';
import type { TranscriptCandidate } from '../../session-history.js';

let testDir: string;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

function makeTestDir(): string {
  testDir = mkdtempSync(join(tmpdir(), 'overdeck-last-assistant-message-'));
  return testDir;
}

function userLine(text: string, uuid: string): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: text },
    timestamp: '2026-01-01T00:00:00.000Z',
    uuid,
  });
}

function assistantLine(text: string, uuid: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    timestamp: '2026-01-01T00:00:01.000Z',
    uuid,
  });
}

describe('readLastAssistantMessageFromCandidate — claude (PAN-4371)', () => {
  it('returns the last assistant message from a small JSONL', async () => {
    const dir = makeTestDir();
    const file = join(dir, 'session.jsonl');
    writeFileSync(
      file,
      [userLine('fix the bug', 'u-1'), assistantLine('Working on it.', 'a-1'), assistantLine('Done.', 'a-2')].join('\n') + '\n',
      'utf-8',
    );
    const candidate: TranscriptCandidate = { kind: 'claude', path: file };
    const result = await readLastAssistantMessageFromCandidate(candidate);
    expect(result).toEqual({ ok: true, messageId: 'a-2', text: 'Done.', transcriptKind: 'claude' });
  });

  it('returns the final message even when the file exceeds LAST_ASSISTANT_TAIL_BYTES', async () => {
    const dir = makeTestDir();
    const file = join(dir, 'session.jsonl');
    const padLine = userLine('x'.repeat(2000), 'pad');
    const lines: string[] = [];
    // Pad well past the tail window so the true tail offset lands mid-file.
    while (Buffer.byteLength(lines.join('\n'), 'utf8') < LAST_ASSISTANT_TAIL_BYTES * 2) {
      lines.push(padLine);
      lines.push(assistantLine('intermediate', `mid-${lines.length}`));
    }
    lines.push(assistantLine('The final answer.', 'a-final'));
    writeFileSync(file, lines.join('\n') + '\n', 'utf-8');
    const candidate: TranscriptCandidate = { kind: 'claude', path: file };
    const result = await readLastAssistantMessageFromCandidate(candidate);
    expect(result).toEqual({ ok: true, messageId: 'a-final', text: 'The final answer.', transcriptKind: 'claude' });
  });

  it('returns no-assistant-message when the transcript has only user lines', async () => {
    const dir = makeTestDir();
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, [userLine('hello', 'u-1'), userLine('anyone there?', 'u-2')].join('\n') + '\n', 'utf-8');
    const candidate: TranscriptCandidate = { kind: 'claude', path: file };
    const result = await readLastAssistantMessageFromCandidate(candidate);
    expect(result).toEqual({ ok: false, reason: 'no-assistant-message' });
  });
});

describe('readLastAssistantMessageFromCandidate — codex (PAN-4371)', () => {
  const ROLLOUT_LINES = [
    { type: 'session_meta', timestamp: '2026-06-09T00:10:50.132Z', payload: { id: 'thread-1', model_provider: 'openai' } },
    { type: 'event_msg', timestamp: '2026-06-09T00:10:50.152Z', payload: { type: 'user_message', message: 'fix the bug' } },
    { type: 'event_msg', timestamp: '2026-06-09T00:10:57.705Z', payload: { type: 'agent_message', message: 'Checking the branch first.' } },
    { type: 'event_msg', timestamp: '2026-06-09T00:11:05.000Z', payload: { type: 'agent_message', message: 'Done — the bug is fixed.' } },
  ];

  it('returns the last assistant message from a codex rollout', async () => {
    const dir = makeTestDir();
    const file = join(dir, 'rollout-2026-06-08T20-10-44-thread-1.jsonl');
    writeFileSync(file, ROLLOUT_LINES.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
    const candidate: TranscriptCandidate = { kind: 'codex', path: file };
    const result = await readLastAssistantMessageFromCandidate(candidate);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('Done — the bug is fixed.');
      expect(result.transcriptKind).toBe('codex');
    }
  });
});

describe('readLastAssistantMessageFromCandidate — other harnesses (PAN-4371)', () => {
  it('returns unsupported-harness for a pi candidate', async () => {
    const candidate: TranscriptCandidate = { kind: 'pi', path: '/does/not/matter.jsonl' };
    const result = await readLastAssistantMessageFromCandidate(candidate);
    expect(result).toEqual({ ok: false, reason: 'unsupported-harness' });
  });
});
