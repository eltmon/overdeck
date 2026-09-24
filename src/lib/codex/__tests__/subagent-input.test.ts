import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerManager } from '../app-server-manager.js';
import { createFakeAppServer, type FakeAppServer } from './fake-app-server.js';

async function setup(status = 'idle') {
  const fake = createFakeAppServer((message, server) => {
    if (message.method === 'initialize') server.send({ id: message.id, result: {} });
    if (message.method === 'thread/start') server.send({ id: message.id, result: { thread: { id: 'root' } } });
    if (message.method === 'thread/read') {
      const id = (message.params as { threadId: string }).threadId;
      server.send({ id: message.id, result: { thread: {
        id, status: { type: status }, turns: status === 'active' ? [{ id: 'child-turn', status: 'inProgress' }] : [],
      } } });
    }
    if (message.method === 'turn/start' || message.method === 'turn/steer') server.send({ id: message.id, result: {} });
  });
  const manager = new CodexAppServerManager({ cwd: '/tmp', readVersion: async () => '0.144.1', spawnProcess: () => fake.child });
  await manager.start();
  await manager.startThread({ model: 'configured-model' });
  return { manager, fake };
}

/** Announce a thread to the manager and wait until it is classified. */
async function announce(manager: CodexAppServerManager, fake: FakeAppServer, id: string, parentThreadId?: string) {
  fake.send({ method: 'thread/started', params: { thread: { id, ...(parentThreadId ? { parentThreadId } : {}) } } });
  await vi.waitFor(() => expect(manager.threadScope(id)).not.toBe('unknown'));
}

const turnRequests = (fake: FakeAppServer) => fake.messages.filter(message => typeof message.method === 'string' && message.method.startsWith('turn/'));

describe('direct Codex child input', () => {
  it.each(['idle', 'active'])('sends to the %s child without changing the owner thread or model', async status => {
    const { manager, fake } = await setup(status);
    try {
      await announce(manager, fake, 'child', 'root');
      await manager.sendSubagentMessage('child', 'Follow up');
      const request = fake.messages.findLast(message => message.method === (status === 'active' ? 'turn/steer' : 'turn/start'));
      expect(request?.params).toEqual({ threadId: 'child', input: [{ type: 'text', text: 'Follow up', text_elements: [] }],
        ...(status === 'active' ? { expectedTurnId: 'child-turn' } : {}),
      });
      expect(manager.getState().threadId).toBe('root');
      expect(fake.messages.some(message => message.method === 'thread/resume')).toBe(false);
    } finally { manager.stop(); }
  });

  it('accepts a nested sub-agent adopted from an in-tree spawn item', async () => {
    const { manager, fake } = await setup('idle');
    try {
      await announce(manager, fake, 'child', 'root');
      fake.send({ method: 'item/completed', params: { threadId: 'child', item: {
        type: 'collabAgentToolCall', tool: 'spawnAgent', receiverThreadIds: ['grandchild'],
      } } });
      await vi.waitFor(() => expect(manager.threadScope('grandchild')).toBe('descendant'));
      expect(await manager.readSubagentInput('grandchild')).toEqual({ direct: true });
    } finally { manager.stop(); }
  });

  it.each(['notLoaded', 'systemError'])('rejects %s children without resuming or creating a turn', async status => {
    const { manager, fake } = await setup(status);
    try {
      await announce(manager, fake, 'child', 'root');
      expect(await manager.readSubagentInput('child')).toEqual({ direct: false });
      await expect(manager.sendSubagentMessage('child', 'Follow up')).rejects.toThrow('unavailable');
      expect(turnRequests(fake)).toEqual([]);
    } finally { manager.stop(); }
  });

  it('rejects the owner, foreign threads, and threads never announced, without reading them', async () => {
    const { manager, fake } = await setup('idle');
    try {
      // A native CLI `/new` on the same app-server, and a sub-agent of it.
      await announce(manager, fake, 'native-new');
      await announce(manager, fake, 'native-child', 'native-new');
      for (const threadId of ['root', 'native-new', 'native-child', 'never-announced']) {
        expect(await manager.readSubagentInput(threadId)).toEqual({ direct: false });
        await expect(manager.sendSubagentMessage(threadId, 'Follow up')).rejects.toThrow('unavailable');
      }
      expect(fake.messages.some(message => message.method === 'thread/read')).toBe(false);
      expect(turnRequests(fake)).toEqual([]);
    } finally { manager.stop(); }
  });

  it('does not let child notifications replace owner runtime state', async () => {
    const { manager, fake } = await setup();
    try {
      fake.send({ method: 'turn/started', params: { threadId: 'root', turn: { id: 'parent-turn' } } });
      await vi.waitFor(() => expect(manager.getState().activeTurnId).toBe('parent-turn'));
      const parentState = manager.getState();
      await announce(manager, fake, 'child', 'root');
      // The owner's own later event proves the child events were processed first.
      const seen: string[] = [];
      manager.on('notification', message => seen.push(String((message as { method?: string }).method)));
      fake.send({ method: 'turn/started', params: { threadId: 'child', turn: { id: 'child-turn' } } });
      fake.send({ method: 'turn/completed', params: { threadId: 'child' } });
      fake.send({ method: 'error', params: { threadId: 'child', willRetry: false } });
      fake.send({ method: 'thread/settings/updated', params: { threadId: 'root' } });
      await vi.waitFor(() => expect(seen).toContain('thread/settings/updated'));
      expect(manager.getState()).toEqual(parentState);
    } finally { manager.stop(); }
  });
});
