import { describe, expect, it } from 'vitest';
import { CodexAppServerManager } from '../app-server-manager.js';
import { createFakeAppServer } from './fake-app-server.js';

async function setup(status = 'idle', parent = 'root') {
  const fake = createFakeAppServer((message, server) => {
    if (message.method === 'initialize') server.send({ id: message.id, result: {} });
    if (message.method === 'thread/start') server.send({ id: message.id, result: { thread: { id: 'root' } } });
    if (message.method === 'thread/read') {
      const id = (message.params as { threadId: string }).threadId;
      server.send({ id: message.id, result: { thread: {
        id, source: { subagent: { thread_spawn: { parent_thread_id: parent } } },
        status: { type: status }, turns: status === 'active' ? [{ id: 'child-turn', status: 'inProgress' }] : [],
      } } });
    }
    if (message.method === 'turn/start' || message.method === 'turn/steer') server.send({ id: message.id, result: {} });
  });
  const manager = new CodexAppServerManager({ cwd: '/tmp', readVersion: async () => '0.144.1', spawnProcess: () => fake.child });
  await manager.start();
  await manager.startThread({ model: 'configured-model' });
  return { manager, fake };
}

describe('direct Codex child input', () => {
  it.each(['idle', 'active'])('sends to the %s child without changing the primary thread or model', async status => {
    const { manager, fake } = await setup(status);
    try {
      await manager.sendSubagentMessage('child', 'Follow up');
      const request = fake.messages.findLast(message => message.method === (status === 'active' ? 'turn/steer' : 'turn/start'));
      expect(request?.params).toEqual({ threadId: 'child', input: [{ type: 'text', text: 'Follow up', text_elements: [] }],
        ...(status === 'active' ? { expectedTurnId: 'child-turn' } : {}),
      });
      expect(manager.getState().threadId).toBe('root');
      expect(fake.messages.some(message => message.method === 'thread/resume')).toBe(false);
    } finally { manager.stop(); }
  });

  it.each(['notLoaded', 'systemError'])('rejects %s children without resuming or creating a turn', async status => {
    const { manager, fake } = await setup(status);
    try {
      expect(await manager.readSubagentInput('child')).toEqual({ direct: false });
      await expect(manager.sendSubagentMessage('child', 'Follow up')).rejects.toThrow('unavailable');
      expect(fake.messages.filter(message => message.method?.startsWith('turn/'))).toEqual([]);
    } finally { manager.stop(); }
  });

  it('rejects the root and unrelated children', async () => {
    const { manager, fake } = await setup('idle', 'unrelated');
    try {
      expect(await manager.readSubagentInput('root')).toEqual({ direct: false });
      await expect(manager.sendSubagentMessage('child', 'Follow up')).rejects.toThrow('unavailable');
      expect(fake.messages.filter(message => message.method?.startsWith('turn/'))).toEqual([]);
    } finally { manager.stop(); }
  });

  it('does not let child notifications replace parent runtime state', async () => {
    const { manager, fake } = await setup();
    try {
      fake.send({ method: 'turn/started', params: { threadId: 'root', turn: { id: 'parent-turn' } } });
      const parentState = manager.getState();
      fake.send({ method: 'thread/started', params: { thread: { id: 'child' } } });
      fake.send({ method: 'turn/started', params: { threadId: 'child', turn: { id: 'child-turn' } } });
      fake.send({ method: 'turn/completed', params: { threadId: 'child' } });
      fake.send({ method: 'error', params: { threadId: 'child', willRetry: false } });
      expect(manager.getState()).toEqual(parentState);
    } finally { manager.stop(); }
  });
});
