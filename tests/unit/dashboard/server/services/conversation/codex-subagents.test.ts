import { appendFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationEvent } from '@overdeck/contracts';
import { listCodexSubagents, resolveCodexSubagentTranscript } from '../../../../../../src/dashboard/server/services/conversation/codex-subagents.js';
import { startSubagentListPolling, type SubagentListPoller } from '../../../../../../src/dashboard/server/services/conversation/subagents.js';
import { parseCodexConversationMessages } from '../../../../../../src/dashboard/server/services/codex-conversation-parser.js';

let dir: string;
let parent: string;
let poller: SubagentListPoller | undefined;
const event = (type: string) => JSON.stringify({ type: 'event_msg', payload: { type } }) + '\n';
async function thread(id: string, parentId?: string, day = '08'): Promise<string> {
  const folder = join(dir, 'sessions', '2026', '09', day);
  await mkdir(folder, { recursive: true });
  const file = join(folder, `rollout-2026-09-${day}T00-00-00-${id}.jsonl`);
  await writeFile(file, JSON.stringify({ type: 'session_meta', payload: {
    id, source: parentId ? { subagent: { thread_spawn: {
      parent_thread_id: parentId, depth: 9, agent_path: `/root/${id}`, agent_nickname: 'Euler',
    } } } : 'cli',
  } }) + '\n' + event('task_started'));
  return file;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'codex-subagents-'));
  parent = await thread('parent');
});
afterEach(async () => {
  poller?.stop();
  poller = undefined;
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

describe('Codex child threads', () => {
  it('lists only descendants, computes relative depth, and resolves across date directories', async () => {
    const child = await thread('child', 'parent', '09');
    const grandchild = await thread('grandchild', 'child', '07');
    await thread('unrelated', 'another-parent');
    expect(await listCodexSubagents(parent)).toEqual([
      expect.objectContaining({ agentId: 'child', spawnDepth: 1, status: 'running' }),
      expect.objectContaining({ agentId: 'grandchild', spawnDepth: 2 }),
    ]);
    expect(await resolveCodexSubagentTranscript(parent, 'child')).toBe(child);
    expect(await resolveCodexSubagentTranscript(parent, 'grandchild')).toBe(grandchild);
    for (const id of ['unrelated', 'parent', '../child', '/etc/passwd', '']) {
      expect(await resolveCodexSubagentTranscript(parent, id)).toBeNull();
    }
  });

  it('joins spawn rows by returned thread ID or collaboration task path', async () => {
    await thread('child', 'parent');
    for (const output of [{ agent_id: 'child' }, { task_name: '/root/child' }]) {
      await writeFile(parent, JSON.stringify({ type: 'session_meta', payload: { id: 'parent' } }) + '\n'
        + JSON.stringify({ type: 'response_item', payload: {
          type: 'function_call', name: 'spawn_agent', call_id: 'spawn-1', arguments: JSON.stringify({ task_name: 'Read parser' }),
        } }) + '\n'
        + JSON.stringify({ type: 'response_item', payload: {
          type: 'function_call_output', call_id: 'spawn-1', output: JSON.stringify(output),
        } }) + '\n');
      const parsed = await parseCodexConversationMessages(parent);
      expect(parsed.workLog[0].toolInput).toEqual({ task_name: 'Read parser' });
      expect(await listCodexSubagents(parent, parsed.workLog)).toEqual([
        expect.objectContaining({ agentId: 'child', toolUseId: 'spawn-1', description: 'Read parser' }),
      ]);
    }
  });

  it('does not follow symlinks or list ordinary conversation forks', async () => {
    const outside = join(dir, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'rollout-evil.jsonl'), JSON.stringify({ type: 'session_meta', payload: {
      id: 'evil', source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } },
    } }) + '\n');
    await symlink(outside, join(dir, 'sessions', 'linked'));
    await symlink(join(outside, 'rollout-evil.jsonl'), join(dir, 'sessions', 'rollout-linked.jsonl'));
    const fork = await thread('fork');
    await writeFile(fork, JSON.stringify({ type: 'session_meta', payload: { id: 'fork', forked_from_id: 'parent' } }) + '\n');
    expect(await listCodexSubagents(parent)).toEqual([]);
  });

  it('discovers late files and refreshes child completion and follow-up without parent writes', async () => {
    vi.useFakeTimers();
    const events: ConversationEvent[] = [];
    poller = await startSubagentListPolling(parent, () => new Set(), e => events.push(e), () => listCodexSubagents(parent));
    const child = await thread('child', 'parent');
    await vi.advanceTimersByTimeAsync(2000);
    await poller.refresh();
    expect(events.at(-1)).toMatchObject({ kind: 'subagents', subagents: [{ status: 'running' }] });
    await appendFile(child, event('task_complete'));
    await poller.refresh();
    expect(events.at(-1)).toMatchObject({ kind: 'subagents', subagents: [{ status: 'done' }] });
    await appendFile(child, event('task_started'));
    await poller.refresh();
    expect(events.at(-1)).toMatchObject({ kind: 'subagents', subagents: [{ status: 'running' }] });
    const count = events.length;
    await poller.refresh();
    expect(events).toHaveLength(count);
    poller.stop();
    await appendFile(child, event('turn_aborted'));
    await vi.advanceTimersByTimeAsync(4000);
    await poller.refresh();
    expect(events).toHaveLength(count);
  });
});
