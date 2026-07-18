import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { summarizeConversationActivity } from '../activity-summary.js';

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
  await rm(testDir, { recursive: true, force: true });
});

describe('summarizeConversationActivity — ACP', () => {
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
  });
});
