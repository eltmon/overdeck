import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ConversationEvent } from '@overdeck/contracts';
import { createConversation } from '../../../../../src/lib/overdeck/conversations.js';
import { getConversationMessagesRead } from '../../../../../src/lib/overdeck/conversation-reads.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startSubagentListPolling,
  subagentsDirFor,
  type SubagentListPoller,
} from '../../../../../src/dashboard/server/services/conversation/subagents.js';

let tempDir: string;
let sessionFile: string;
let poller: SubagentListPoller | null;

async function writeMeta(agentId: string, toolUseId: string): Promise<void> {
  const subagentsDir = subagentsDirFor(sessionFile);
  await mkdir(subagentsDir, { recursive: true });
  await writeFile(join(subagentsDir, `agent-${agentId}.meta.json`), JSON.stringify({
    agentType: 'Explore',
    description: `Subagent ${agentId}`,
    toolUseId,
    spawnDepth: 1,
  }));
}

function createConversationRecord(): string {
  const name = `subagent-rest-${basename(tempDir)}`;
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: tempDir });
  return name;
}

function readMessages(name: string, agentId?: string) {
  return getConversationMessagesRead(name, {
    resolveSessionFile: async () => sessionFile,
    shouldReportUnresolvedLiveSession: () => false,
  }, agentId);
}

describe('conversation subagent list emission', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    tempDir = await mkdtemp(join(tmpdir(), 'overdeck-subagent-messages-'));
    sessionFile = join(tempDir, 'session.jsonl');
    poller = null;
  });

  afterEach(async () => {
    poller?.stop();
    vi.useRealTimers();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('emits the initial full list with statuses derived from pending tool uses', async () => {
    await writeMeta('running', 'toolu_running');
    await writeMeta('done', 'toolu_done');
    const events: ConversationEvent[] = [];

    poller = await startSubagentListPolling(
      sessionFile,
      () => new Set(['toolu_running']),
      (event) => events.push(event),
    );

    expect(events).toEqual([{
      kind: 'subagents',
      subagents: [
        {
          agentId: 'done',
          agentType: 'Explore',
          description: 'Subagent done',
          toolUseId: 'toolu_done',
          spawnDepth: 1,
          status: 'done',
        },
        {
          agentId: 'running',
          agentType: 'Explore',
          description: 'Subagent running',
          toolUseId: 'toolu_running',
          spawnDepth: 1,
          status: 'running',
        },
      ],
    }]);
  });

  it('emits changed lists after 2000 ms and suppresses unchanged polls', async () => {
    const events: ConversationEvent[] = [];
    poller = await startSubagentListPolling(sessionFile, () => new Set(), (event) => events.push(event));
    expect(events).toEqual([{ kind: 'subagents', subagents: [] }]);

    await writeMeta('new', 'toolu_new');
    await vi.advanceTimersByTimeAsync(2_000);
    await poller.refresh();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      kind: 'subagents',
      subagents: [{ agentId: 'new', status: 'done' }],
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await poller.refresh();
    expect(events).toHaveLength(2);
  });

  it('re-stamps statuses on demand and stops polling on release', async () => {
    await writeMeta('status', 'toolu_status');
    let pending = new Set(['toolu_status']);
    const events: ConversationEvent[] = [];
    poller = await startSubagentListPolling(sessionFile, () => pending, (event) => events.push(event));

    pending = new Set();
    await poller.refresh();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      kind: 'subagents',
      subagents: [{ agentId: 'status', status: 'done' }],
    });

    poller.stop();
    await writeMeta('after-stop', 'toolu_after_stop');
    await vi.advanceTimersByTimeAsync(4_000);
    await poller.refresh();
    expect(events).toHaveLength(2);
  });

  it('returns a subagent transcript and includes done subagents in the parent response', async () => {
    const name = createConversationRecord();
    await writeFile(sessionFile, `${JSON.stringify({
      type: 'user',
      uuid: 'parent-user',
      timestamp: '2026-07-18T00:00:00.000Z',
      message: { content: [{ type: 'text', text: 'Parent transcript' }] },
    })}\n`);
    await writeMeta('reader', 'toolu_reader');
    await writeFile(join(subagentsDirFor(sessionFile), 'agent-reader.jsonl'), `${JSON.stringify({
      type: 'user',
      uuid: 'subagent-user',
      timestamp: '2026-07-18T00:01:00.000Z',
      message: { content: [{ type: 'text', text: 'Subagent transcript' }] },
    })}\n`);

    const parent = (await readMessages(name)).body as Record<string, unknown>;
    expect(parent.subagents).toEqual([expect.objectContaining({ agentId: 'reader', status: 'done' })]);

    const subagent = (await readMessages(name, 'reader')).body as {
      messages: Array<{ text: string }>;
      subagents?: unknown;
    };
    expect(subagent.messages.map((message) => message.text)).toEqual(['Subagent transcript']);
    expect(subagent.subagents).toBeUndefined();
  });

  it('rejects traversal-unsafe subagent ids before parsing a transcript', async () => {
    const name = createConversationRecord();
    await writeFile(sessionFile, '');

    const response = await readMessages(name, '../evil');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid subagent id' });
  });
});
