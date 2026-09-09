import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const { instances } = vi.hoisted(() => ({ instances: [] as Array<{
  postMessage: ReturnType<typeof vi.fn>; emit: (event: string, value: unknown) => boolean;
}> }));
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    postMessage = vi.fn();
    constructor() { super(); instances.push(this); }
  },
}));
import { runDashboardDbJob, workerLane } from '../dashboard-db-task.js';

// Exercise the actual worker dispatch path, including under Vitest: these
// expensive polls must never use the test-only synchronous inline resolver.
describe('polling reads dispatch to database worker', () => {
  it.each(['getCostsByIssueSnapshot', 'getConversationSearchStats', 'getConversationLedgerCosts'] as const)(
    'coalesces %s and receives its result from the read worker', async operation => {
      expect(workerLane(operation)).toBe('read');
      const payload = operation === 'getConversationSearchStats' ? { dbPath: '/fixture/search.db', model: 'small' } : undefined;
      const first = runDashboardDbJob(operation, payload);
      const second = runDashboardDbJob(operation, payload);
      expect(second).toBe(first);
      const worker = instances[0];
      expect(instances).toHaveLength(1);
      const message = worker.postMessage.mock.lastCall![0];
      expect(message).toMatchObject({ operation, payload });
      const result = { fromWorker: operation };
      worker.emit('message', { id: message.id, ok: true, result });
      await expect(first).resolves.toEqual(result);
    },
  );

  it('rejects failed worker reads and allows the next refresh', async () => {
    const first = runDashboardDbJob('getCostsByIssueSnapshot');
    const worker = instances[0];
    const message = worker.postMessage.mock.lastCall![0];
    worker.emit('message', { id: message.id, ok: false, error: { message: 'busy database' } });
    await expect(first).rejects.toThrow('busy database');
    const second = runDashboardDbJob('getCostsByIssueSnapshot');
    expect(second).not.toBe(first);
    worker.emit('message', { id: worker.postMessage.mock.lastCall![0].id, ok: true, result: [] });
    await expect(second).resolves.toEqual([]);
  });
});
