import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConversationEvent } from '@overdeck/contracts';
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
});
