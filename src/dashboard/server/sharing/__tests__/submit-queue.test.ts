import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareIdentity } from '@overdeck/contracts';

import {
  QUEUE_MAX_ITEMS,
  QUEUE_MAX_PER_AUTHOR,
  QUEUE_TICK_MS,
  SubmitQueue,
  TURN_START_TIMEOUT_MS,
  type DoorAnswer,
  type QueuedPrompt,
} from '../submit-queue.js';

const alice: ShareIdentity = { githubId: 7, login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/7' };
const bob: ShareIdentity = { githubId: 8, login: 'bob', avatarUrl: 'https://avatars.githubusercontent.com/u/8' };

interface Harness {
  queue: SubmitQueue;
  log: string[];
  delivered: string[];
  outcomes: Array<[string, string]>;
  statuses: Array<{ agentWorking: boolean; queued: number }>;
  undos: string[];
  activity: { working: boolean; lastMessageId: string | null; script: boolean[]; throws: boolean };
  answers: Array<DoorAnswer | Error | Promise<DoorAnswer>>;
}

function setup(): Harness {
  const harness: Omit<Harness, 'queue'> = {
    log: [],
    delivered: [],
    outcomes: [],
    statuses: [],
    undos: [],
    activity: { working: false, lastMessageId: 'm0', script: [], throws: false },
    answers: [],
  };
  const queue = new SubmitQueue(
    {
      deliver: async (text) => {
        harness.delivered.push(text);
        harness.log.push(`deliver:${text}`);
        const answer = harness.answers.shift() ?? { status: 200, body: {} };
        if (answer instanceof Error) throw answer;
        return answer;
      },
      activity: async () => {
        if (harness.activity.throws) throw new Error('unreadable');
        const working = harness.activity.script.length > 0 ? harness.activity.script.shift() === true : harness.activity.working;
        harness.log.push(`working:${working}`);
        return { working, lastMessageId: harness.activity.lastMessageId };
      },
      now: () => Date.now(),
    },
    {
      onDelivering: (item: QueuedPrompt) => () => harness.undos.push(item.text),
      onOutcome: (item, outcome) => harness.outcomes.push([item.text, outcome]),
      onStatus: (status) => harness.statuses.push(status),
    },
  );
  return { ...harness, queue };
}

function contributor(text: string, author: ShareIdentity = alice) {
  return { clientId: `c-${text}`, source: 'contributor' as const, author, text };
}

function controller(text: string) {
  return { clientId: null, source: 'controller' as const, author: null, text };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SubmitQueue', () => {
  it('delivers concurrent submits in FIFO order, one per agent turn', async () => {
    const h = setup();
    h.activity.working = true;
    expect(h.queue.enqueue(contributor('A'))).toMatchObject({ ok: true, position: 1 });
    expect(h.queue.enqueue(contributor('B', bob))).toMatchObject({ ok: true, position: 2 });
    expect(h.queue.enqueue(controller('C'))).toMatchObject({ ok: true, position: 3 });
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS * 5);
    expect(h.delivered).toEqual([]);

    h.activity.working = false;
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS);
    expect(h.delivered).toEqual(['A']);
    // Each later turn: the agent reads working for two ticks, then idle.
    for (const next of ['B', 'C']) {
      h.activity.script.push(true, true);
      await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS * 2);
      expect(h.delivered.at(-1)).not.toBe(next);
      await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS * 2);
      expect(h.delivered.at(-1)).toBe(next);
    }
    expect(h.delivered).toEqual(['A', 'B', 'C']);
    expect(h.outcomes).toEqual([['A', 'sent'], ['B', 'sent'], ['C', 'sent']]);

    // Between two deliveries the agent always read working, then idle.
    const deliveries = h.log.flatMap((entry, index) => (entry.startsWith('deliver:') ? [index] : []));
    for (let i = 1; i < deliveries.length; i++) {
      const between = h.log.slice((deliveries[i - 1] ?? 0) + 1, deliveries[i]);
      const firstWorking = between.indexOf('working:true');
      expect(firstWorking).toBeGreaterThanOrEqual(0);
      expect(between.slice(firstWorking).includes('working:false')).toBe(true);
    }
  });

  it('waits TURN_START_TIMEOUT_MS plus an idle tick when the turn never shows', async () => {
    const h = setup();
    h.queue.enqueue(contributor('A'));
    h.queue.enqueue(contributor('B'));
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS);
    expect(h.delivered).toEqual(['A']);
    await vi.advanceTimersByTimeAsync(TURN_START_TIMEOUT_MS);
    expect(h.delivered).toEqual(['A']);
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS);
    expect(h.delivered).toEqual(['A', 'B']);
  });

  it('ends the start wait on a changed last message id without working ever reading true', async () => {
    const h = setup();
    h.queue.enqueue(contributor('A'));
    h.queue.enqueue(contributor('B'));
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS);
    expect(h.delivered).toEqual(['A']);
    h.activity.lastMessageId = 'm1';
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS * 2);
    expect(h.delivered).toEqual(['A', 'B']);
    expect(h.log).not.toContain('working:true');
  });

  it('keeps the head on 409, calls the undo once and redelivers on the next idle tick', async () => {
    const h = setup();
    h.answers.push({ status: 409, body: { error: 'permission-pending' } });
    h.queue.enqueue(contributor('A'));
    h.queue.enqueue(contributor('B'));
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS);
    expect(h.delivered).toEqual(['A']);
    expect(h.undos).toEqual(['A']);
    expect(h.outcomes).toEqual([]);
    expect(h.queue.view().items.map((item) => item.text)).toEqual(['A', 'B']);
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS);
    expect(h.delivered).toEqual(['A', 'A']);
    expect(h.undos).toEqual(['A']);
    expect(h.outcomes).toEqual([['A', 'sent']]);
  });

  it('reports a 400 as delivery_refused and moves on to the next item', async () => {
    const h = setup();
    h.answers.push({ status: 400, body: {} });
    h.queue.enqueue(contributor('A'));
    h.queue.enqueue(contributor('B'));
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS);
    expect(h.outcomes).toEqual([['A', 'delivery_refused']]);
    expect(h.undos).toEqual(['A']);
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS);
    expect(h.delivered).toEqual(['A', 'B']);
  });

  it('reports a 500 and a throw as delivery_unknown and never redelivers them', async () => {
    const h = setup();
    h.answers.push({ status: 500, body: {} }, new Error('boom'));
    h.queue.enqueue(contributor('A'));
    h.queue.enqueue(contributor('B'));
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS * 5);
    expect(h.delivered).toEqual(['A', 'B']);
    expect(h.outcomes).toEqual([['A', 'delivery_unknown'], ['B', 'delivery_unknown']]);
    expect(h.undos).toEqual(['A', 'B']);
  });

  it('refuses the 21st item and a 4th queued item from one contributor', () => {
    const h = setup();
    for (let i = 0; i < QUEUE_MAX_PER_AUTHOR; i++) expect(h.queue.enqueue(contributor(`a${i}`)).ok).toBe(true);
    expect(h.queue.enqueue(contributor('a-extra'))).toEqual({ ok: false, reason: 'queue_full' });
    expect(h.queue.enqueue(controller('host')).ok).toBe(true);
    while (h.queue.view().items.length < QUEUE_MAX_ITEMS) expect(h.queue.enqueue(controller('more')).ok).toBe(true);
    expect(h.queue.enqueue(controller('one too many'))).toEqual({ ok: false, reason: 'queue_full' });
  });

  it('refuses a command prefix as invalid_prompt and never queues it', () => {
    const h = setup();
    expect(h.queue.enqueue(controller('/pan status'))).toEqual({ ok: false, reason: 'invalid_prompt' });
    expect(h.queue.view().items).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dropAuthor removes only that author\'s queued contributor items, never the delivering one', async () => {
    const h = setup();
    let resolve: (answer: DoorAnswer) => void = () => undefined;
    h.answers.push(new Promise<DoorAnswer>((r) => { resolve = r; }));
    h.queue.enqueue(contributor('A'));
    h.queue.enqueue(contributor('B'));
    h.queue.enqueue(contributor('C', bob));
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS);
    expect(h.queue.view().delivering).toBe(true);
    expect(h.queue.dropAuthor(7).map((item) => item.text)).toEqual(['B']);
    expect(h.queue.view().items.map((item) => item.text)).toEqual(['A', 'C']);
    resolve({ status: 200, body: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.outcomes).toEqual([['A', 'sent']]);
    expect(h.queue.view().delivering).toBe(false);
  });

  it('emits onStatus only when agentWorking or queued changed', async () => {
    const h = setup();
    h.activity.working = true;
    h.queue.enqueue(controller('A'));
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS * 3);
    expect(h.statuses).toEqual([{ agentWorking: false, queued: 1 }, { agentWorking: true, queued: 1 }]);
  });

  it('reads an activity that throws synchronously as idle and reports a sync deliver throw as unknown', async () => {
    const outcomes: string[] = [];
    const queue = new SubmitQueue(
      {
        deliver: () => { throw new Error('sync deliver'); },
        activity: () => { throw new Error('sync activity'); },
        now: () => Date.now(),
      },
      { onDelivering: () => () => undefined, onOutcome: (_item, outcome) => outcomes.push(outcome), onStatus: () => undefined },
    );
    queue.enqueue(controller('A'));
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS);
    expect(outcomes).toEqual(['delivery_unknown']);
    queue.close();
  });

  it('reads a throwing activity as idle', async () => {
    const h = setup();
    h.activity.throws = true;
    h.queue.enqueue(controller('A'));
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS);
    expect(h.delivered).toEqual(['A']);
  });

  it('stops the ticker when empty, idle and not watching', async () => {
    const h = setup();
    h.queue.setWatching(true);
    expect(vi.getTimerCount()).toBe(1);
    h.queue.enqueue(controller('A'));
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS);
    h.activity.lastMessageId = 'm1';
    h.queue.setWatching(false);
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('close() stops every callback', async () => {
    const h = setup();
    h.queue.enqueue(controller('A'));
    const statuses = h.statuses.length;
    h.queue.close();
    await vi.advanceTimersByTimeAsync(QUEUE_TICK_MS * 5);
    expect(h.delivered).toEqual([]);
    expect(h.outcomes).toEqual([]);
    expect(h.statuses).toHaveLength(statuses);
    expect(vi.getTimerCount()).toBe(0);
  });
});
