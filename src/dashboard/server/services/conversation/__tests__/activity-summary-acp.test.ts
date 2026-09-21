import { mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACP_STALLED_TURN_MS, summarizeConversationActivity } from '../activity-summary.js';

let testDir: string;
let transcriptPath: string;

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `overdeck-acp-activity-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(testDir, { recursive: true });
  transcriptPath = join(testDir, 'acp-session.jsonl');
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(testDir, { recursive: true, force: true });
});

describe('summarizeConversationActivity — ACP', () => {
  it('classifies a recently completed ACP turn as idle', async () => {
    await writeFile(transcriptPath, `${JSON.stringify({
      timestamp: '2026-07-18T00:00:00.000Z',
      role: 'user',
      content: 'Inspect the repository',
      source: 'orchestrator',
    })}\n${JSON.stringify({
      timestamp: '2026-07-18T00:00:01.000Z',
      role: 'assistant',
      content: 'Inspection complete',
      source: 'agent',
    })}\n${JSON.stringify({
      timestamp: '2026-07-18T00:00:02.000Z',
      role: 'system',
      content: '',
      source: 'agent',
      event: 'turn_completed',
      stopReason: 'end_turn',
    })}\n`);

    const summary = await summarizeConversationActivity(transcriptPath, {
      harness: 'acp',
    });

    expect(summary.streaming).toBe(false);
    expect(summary.isWorking).toBe(false);
    expect(summary.currentTool).toBeNull();
    expect(summary.messages.at(-1)).toEqual(expect.objectContaining({
      role: 'assistant',
      completedAt: '2026-07-18T00:00:02.000Z',
    }));
  });

  it('uses the ACP parser and exposes an active tool as current work', async () => {
    await writeFile(transcriptPath, `${JSON.stringify({
      timestamp: '2026-07-18T00:00:00.000Z',
      role: 'user',
      content: 'Inspect the repository',
      source: 'orchestrator',
    })}\n${JSON.stringify({
      timestamp: '2026-07-18T00:00:01.000Z',
      role: 'tool',
      content: 'Reading files',
      source: 'agent',
      toolCalls: [{
        toolCallId: 'tool-1',
        title: 'Read',
        status: 'inProgress',
        data: {},
      }],
    })}\n`);

    const summary = await summarizeConversationActivity(transcriptPath, {
      harness: 'acp',
    });

    expect(summary.messages).toEqual([
      expect.objectContaining({ role: 'user', text: 'Inspect the repository' }),
    ]);
    expect(summary.isWorking).toBe(true);
    expect(summary.currentTool).toBe('Read');
    expect(summary.stalledSince).toBeUndefined();
  });

  it('marks an open ACP turn stalled after five minutes without a write', async () => {
    const now = new Date('2026-09-20T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    await writeFile(transcriptPath, `${JSON.stringify({
      timestamp: '2026-09-20T11:55:00.001Z',
      role: 'user',
      content: 'Run a task subagent',
      source: 'orchestrator',
    })}\n`);
    const almostStalled = new Date(now.getTime() - ACP_STALLED_TURN_MS + 1);
    await utimes(transcriptPath, almostStalled, almostStalled);
    const stalledSince = new Date((await stat(transcriptPath)).mtimeMs).toISOString();

    const recent = await summarizeConversationActivity(transcriptPath, { harness: 'opencode' });
    expect(recent.isWorking).toBe(true);
    expect(recent.stalledSince).toBeUndefined();

    vi.setSystemTime(new Date(now.getTime() + 2));
    const stalled = await summarizeConversationActivity(transcriptPath, { harness: 'opencode' });
    expect(stalled.isWorking).toBe(true);
    expect(stalled.stalledSince).toBe(stalledSince);
  });

  it('does not mark an old completed ACP turn as stalled', async () => {
    await writeFile(transcriptPath, `${JSON.stringify({
      timestamp: '2026-07-18T00:00:00.000Z', role: 'user', content: 'Work', source: 'orchestrator',
    })}\n${JSON.stringify({
      timestamp: '2026-07-18T00:00:01.000Z', role: 'system', content: '', source: 'agent', event: 'turn_completed',
    })}\n`);
    const old = new Date(Date.now() - ACP_STALLED_TURN_MS - 1);
    await utimes(transcriptPath, old, old);

    const summary = await summarizeConversationActivity(transcriptPath, { harness: 'acp' });
    expect(summary.isWorking).toBe(false);
    expect(summary.stalledSince).toBeUndefined();
  });
});
