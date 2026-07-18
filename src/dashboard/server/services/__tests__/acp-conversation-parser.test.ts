import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseAcpConversationMessages } from '../acp-conversation-parser.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'overdeck-acp-parser-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeTranscript(lines: unknown[]): Promise<string> {
  const path = join(tempDir, 'acp-session.jsonl');
  await writeFile(path, `${lines.map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n')}\n`);
  return path;
}

describe('parseAcpConversationMessages', () => {
  it('projects messages, coalesces assistant deltas, and ignores malformed lines', async () => {
    const path = await writeTranscript([
      {
        timestamp: '2026-07-17T10:00:00.000Z',
        role: 'user',
        content: 'Explain ACP',
        source: 'orchestrator',
      },
      '{not-json',
      {
        timestamp: '2026-07-17T10:00:01.000Z',
        role: 'assistant',
        content: 'Agent ',
        source: 'agent',
      },
      {
        timestamp: '2026-07-17T10:00:01.100Z',
        role: 'assistant',
        content: 'Client Protocol',
        source: 'agent',
      },
      {
        timestamp: '2026-07-17T10:00:02.000Z',
        role: 'system',
        content: 'Permission granted',
        source: 'agent',
      },
    ]);

    const result = await parseAcpConversationMessages(path);

    expect(result.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        text: 'Explain ACP',
        streaming: false,
      }),
      expect.objectContaining({
        role: 'assistant',
        text: 'Agent Client Protocol',
        streaming: false,
      }),
      expect.objectContaining({
        role: 'system',
        text: 'Permission granted',
        streaming: false,
      }),
    ]);
    expect(result.totalCost).toBe(0);
    expect(result.totalTokens).toBe(0);
  });

  it('uses a durable completion boundary instead of recent-file streaming inference', async () => {
    const path = await writeTranscript([
      {
        timestamp: '2026-07-18T09:59:59.000Z',
        role: 'system',
        content: 'Explain ACP',
        event: 'prompt_queued',
      },
      {
        timestamp: '2026-07-18T10:00:00.000Z',
        role: 'user',
        content: 'Explain ACP',
      },
      {
        timestamp: '2026-07-18T10:00:01.000Z',
        role: 'assistant',
        content: 'ACP is a protocol.',
      },
      {
        timestamp: '2026-07-18T10:00:02.000Z',
        role: 'system',
        content: '',
        event: 'turn_completed',
        stopReason: 'end_turn',
      },
    ]);

    const first = await parseAcpConversationMessages(path);
    const second = await parseAcpConversationMessages(path);

    for (const result of [first, second]) {
      expect(result.streaming).toBe(false);
      expect(result.lastTurnCompletedAt).toBe('2026-07-18T10:00:02.000Z');
      expect(result.messages).toEqual([
        expect.objectContaining({ role: 'user', text: 'Explain ACP' }),
        expect.objectContaining({
          role: 'assistant',
          text: 'ACP is a protocol.',
          completedAt: '2026-07-18T10:00:02.000Z',
          streaming: false,
        }),
      ]);
    }
  });

  it('applies completion boundaries to each assistant turn', async () => {
    const path = await writeTranscript([
      { timestamp: '2026-07-18T10:00:00.000Z', role: 'user', content: 'First' },
      { timestamp: '2026-07-18T10:00:01.000Z', role: 'assistant', content: 'One' },
      {
        timestamp: '2026-07-18T10:00:02.000Z',
        role: 'system',
        content: '',
        event: 'turn_completed',
        stopReason: 'end_turn',
      },
      { timestamp: '2026-07-18T10:00:03.000Z', role: 'user', content: 'Second' },
      { timestamp: '2026-07-18T10:00:04.000Z', role: 'assistant', content: 'Two' },
      {
        timestamp: '2026-07-18T10:00:05.000Z',
        role: 'system',
        content: '',
        event: 'turn_completed',
        stopReason: 'max_tokens',
      },
    ]);

    const result = await parseAcpConversationMessages(path);

    expect(result.streaming).toBe(false);
    expect(result.messages.filter((message) => message.role === 'assistant')).toEqual([
      expect.objectContaining({ text: 'One', completedAt: '2026-07-18T10:00:02.000Z' }),
      expect.objectContaining({ text: 'Two', completedAt: '2026-07-18T10:00:05.000Z' }),
    ]);
  });

  it('treats a new user turn after a completion boundary as active', async () => {
    const path = await writeTranscript([
      { timestamp: '2026-07-18T10:00:00.000Z', role: 'user', content: 'First' },
      { timestamp: '2026-07-18T10:00:01.000Z', role: 'assistant', content: 'Done' },
      {
        timestamp: '2026-07-18T10:00:02.000Z',
        role: 'system',
        content: '',
        event: 'turn_completed',
        stopReason: 'end_turn',
      },
      { timestamp: '2026-07-18T10:00:03.000Z', role: 'user', content: 'Follow up' },
      { timestamp: '2026-07-18T10:00:04.000Z', role: 'assistant', content: 'Working' },
    ]);

    const result = await parseAcpConversationMessages(path);

    expect(result.streaming).toBe(true);
    expect(result.lastTurnCompletedAt).toBeUndefined();
    expect(result.messages.at(-1)).toEqual(expect.objectContaining({
      role: 'assistant',
      text: 'Working',
      streaming: true,
    }));
  });

  it('keeps the recent-file fallback for legacy transcripts without boundaries', async () => {
    const path = await writeTranscript([
      { timestamp: '2026-07-18T10:00:00.000Z', role: 'user', content: 'Legacy' },
      { timestamp: '2026-07-18T10:00:01.000Z', role: 'assistant', content: 'Streaming' },
    ]);

    const result = await parseAcpConversationMessages(path);

    expect(result.streaming).toBe(true);
    expect(result.lastTurnCompletedAt).toBeUndefined();
    expect(result.messages.at(-1)).toEqual(expect.objectContaining({ streaming: true }));
  });

  it('deduplicates tool updates, retains pending state, and bounds display metadata', async () => {
    const longCommand = 'x'.repeat(700);
    const longDetail = 'y'.repeat(700);
    const path = await writeTranscript([
      {
        timestamp: '2026-07-17T10:00:00.000Z',
        role: 'tool',
        content: 'initial tool call',
        toolCalls: [{
          toolCallId: 'tool-1',
          kind: 'shell',
          title: 'Run command',
          status: 'pending',
          command: longCommand,
          detail: longDetail,
          data: { secret: 'must not render' },
        }],
      },
      {
        timestamp: '2026-07-17T10:00:01.000Z',
        role: 'tool',
        content: 'command running',
        toolCalls: [{
          toolCallId: 'tool-1',
          kind: 'shell',
          title: 'Run command',
          status: 'inProgress',
          command: longCommand,
          detail: longDetail,
          data: { secret: 'still must not render' },
        }],
      },
    ]);

    const result = await parseAcpConversationMessages(path);

    expect(result.workLog).toHaveLength(1);
    expect(result.workLog[0]).toMatchObject({
      id: 'tool-1',
      label: 'Run command',
      toolTitle: 'Run command',
      tone: 'tool',
    });
    expect(result.workLog[0]?.command).toHaveLength(501);
    expect(result.workLog[0]?.detail).toHaveLength(501);
    expect(result.workLog[0]).not.toHaveProperty('toolInput');
    expect(result.pendingToolUse.get('tool-1')).toBe(result.workLog[0]);
  });

  it('marks completed and failed tool updates terminal', async () => {
    const path = await writeTranscript([
      {
        timestamp: '2026-07-17T10:00:00.000Z',
        role: 'tool',
        content: 'done',
        toolCalls: [{
          toolCallId: 'tool-done',
          title: 'Read file',
          status: 'completed',
          detail: 'read complete',
          data: {},
        }],
      },
      {
        timestamp: '2026-07-17T10:00:01.000Z',
        role: 'tool',
        content: 'failed',
        toolCalls: [{
          toolCallId: 'tool-failed',
          title: 'Run command',
          status: 'failed',
          detail: 'permission denied',
          data: {},
        }],
      },
    ]);

    const result = await parseAcpConversationMessages(path);

    expect(result.pendingToolUse.size).toBe(0);
    expect(result.workLog).toEqual([
      expect.objectContaining({ id: 'tool-done', result: 'read complete', tone: 'tool' }),
      expect.objectContaining({ id: 'tool-failed', result: 'permission denied', tone: 'error' }),
    ]);
  });
});
