import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface PostedJob {
  id: string;
  operation: string;
  payload: unknown;
}

class FakeWorker extends EventEmitter {
  readonly posted: PostedJob[] = [];
  readonly postMessage = vi.fn((message: PostedJob) => {
    this.posted.push(message);
  });
  readonly terminate = vi.fn(async () => 0);

  answer(id: string, result: unknown): void {
    this.emit('message', { id, ok: true, result });
  }
}

const spawned = vi.hoisted(() => ({ workers: [] as unknown[] }));

vi.mock('../../../src/lib/module-worker.js', () => ({
  spawnModuleWorker: vi.fn(() => {
    const worker = new FakeWorker();
    spawned.workers.push(worker);
    return worker;
  }),
}));

import { __testInternals, runDashboardDbJob } from '../../../src/dashboard/server/services/dashboard-db-task.js';

const vectorPayload = (tag: string) => ({ dbPath: '/tmp/embeddings.db', model: 'text-embedding-3-small', embedding: new Float32Array([1]), limit: 5, tag });

function onlyWorker(): FakeWorker {
  expect(spawned.workers).toHaveLength(1);
  return spawned.workers[0] as FakeWorker;
}

describe('dashboard DB jobs: abort and serial conversation lanes (PAN-5447)', () => {
  beforeEach(() => {
    spawned.workers.length = 0;
    __testInternals.forceWorkerPath(true);
  });

  afterEach(async () => {
    __testInternals.forceWorkerPath(false);
    await __testInternals.terminateWorkers();
  });

  it('posts only one conversation-vector job at a time and posts the next when the worker answers', async () => {
    const first = runDashboardDbJob('searchConversationVector', vectorPayload('first'));
    const second = runDashboardDbJob('searchConversationVector', vectorPayload('second'));
    const worker = onlyWorker();

    expect(worker.posted.map((job) => (job.payload as { tag: string }).tag)).toEqual(['first']);

    worker.answer(worker.posted[0]!.id, 'first-result');
    await expect(first).resolves.toBe('first-result');
    expect(worker.posted.map((job) => (job.payload as { tag: string }).tag)).toEqual(['first', 'second']);

    worker.answer(worker.posted[1]!.id, 'second-result');
    await expect(second).resolves.toBe('second-result');
  });

  it('an aborted waiter is never posted and its promise rejects with the abort reason', async () => {
    const first = runDashboardDbJob('searchConversationVector', vectorPayload('first'));
    const controller = new AbortController();
    const waiter = runDashboardDbJob('searchConversationVector', vectorPayload('waiter'), undefined, { signal: controller.signal });
    const third = runDashboardDbJob('searchConversationVector', vectorPayload('third'));
    const worker = onlyWorker();

    const reason = new Error('superseded');
    controller.abort(reason);
    await expect(waiter).rejects.toBe(reason);

    worker.answer(worker.posted[0]!.id, 'first-result');
    await expect(first).resolves.toBe('first-result');
    expect(worker.posted.map((job) => (job.payload as { tag: string }).tag)).toEqual(['first', 'third']);

    worker.answer(worker.posted[1]!.id, 'third-result');
    await expect(third).resolves.toBe('third-result');
  });

  it('an aborted in-flight job rejects at once, keeps the lane busy until the worker answers, then posts the next waiter', async () => {
    const controller = new AbortController();
    const inFlight = runDashboardDbJob('searchConversationBm25', { matchQuery: 'a' }, undefined, { signal: controller.signal });
    const next = runDashboardDbJob('filterLiveConversationSessions', { sessionIds: ['s'] });
    const worker = onlyWorker();
    expect(worker.posted).toHaveLength(1);

    const reason = new Error('client left');
    controller.abort(reason);
    await expect(inFlight).rejects.toBe(reason);
    // Still busy: the worker has not answered the aborted job yet.
    expect(worker.posted).toHaveLength(1);

    worker.answer(worker.posted[0]!.id, 'discarded');
    expect(worker.posted.map((job) => job.operation)).toEqual(['searchConversationBm25', 'filterLiveConversationSessions']);

    worker.answer(worker.posted[1]!.id, ['s']);
    await expect(next).resolves.toEqual(['s']);
  });

  it('abort never terminates the worker', async () => {
    const inFlightController = new AbortController();
    const waiterController = new AbortController();
    const inFlight = runDashboardDbJob('searchConversationVector', vectorPayload('a'), undefined, { signal: inFlightController.signal });
    const waiter = runDashboardDbJob('searchConversationVector', vectorPayload('b'), undefined, { signal: waiterController.signal });
    const worker = onlyWorker();

    waiterController.abort(new Error('waiter gone'));
    inFlightController.abort(new Error('in-flight gone'));
    await expect(waiter).rejects.toThrow('waiter gone');
    await expect(inFlight).rejects.toThrow('in-flight gone');

    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it('an already-aborted signal rejects without posting', async () => {
    const controller = new AbortController();
    const reason = new Error('already gone');
    controller.abort(reason);

    await expect(runDashboardDbJob('searchConversationVector', vectorPayload('a'), undefined, { signal: controller.signal })).rejects.toBe(reason);
    expect(spawned.workers).toHaveLength(0);
  });
});
