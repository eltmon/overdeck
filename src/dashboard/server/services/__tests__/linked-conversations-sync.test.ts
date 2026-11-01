/**
 * PAN-4650 WI-3: the viewer fetches a linked machine's shared conversation list
 * on connect and on a changed heartbeat hash only, writes only the owner's own
 * answer into the cache, and prunes environments with no active link.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedConversationRow, SharedConversationsResponse } from '@overdeck/contracts';

import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../../../tests/helpers/overdeck-test-db.js';
import type { MachineLink } from '../../../../lib/anywhere/link-store.js';
import { cachedListHash, listLinkedConversations, replaceLinkedConversations } from '../../../../lib/overdeck/linked-conversations.js';
import type { HeartbeatPayload } from '../link-heartbeat.js';
import { createLinkedConversationsSync, SHARED_CONVERSATIONS_PATH } from '../linked-conversations-sync.js';

function link(environmentId = 'env-desk', label = 'desk'): MachineLink {
  return {
    id: `link-${label}`, environmentId, label, machineKey: 'ab'.repeat(32), token: `odk_${'9'.repeat(64)}`, access: 'operator',
    reverseTokenId: null, routes: [], createdAt: '2026-11-01T00:00:00.000Z', revokedAt: null,
  };
}

function row(name: string): SharedConversationRow {
  return {
    name, title: name, nativeSessionId: `s-${name}`, harness: 'claude-code', model: null, status: 'active', sessionAlive: true,
    isWorking: false, lastActivityAt: null, projectKey: null, gitOrigin: null, cwd: '/w', issueId: null, tmuxSession: `conv-${name}`,
    releasedTo: null, createdAt: '2026-11-01T10:00:00.000Z', pullable: true, vaultId: null,
  };
}

function answer(rows: SharedConversationRow[], hash: string, overrides: Partial<SharedConversationsResponse> = {}): SharedConversationsResponse {
  return { environmentId: 'env-desk', sharing: true, hash, rows, ...overrides };
}

function beat(conversationsHash?: string): HeartbeatPayload {
  return { seq: 1, lastStall: null, endpointsHash: '', serverVersion: '0.73.0', ...(conversationsHash === undefined ? {} : { conversationsHash }) };
}

function namesFor(environmentId: string): string[] {
  return listLinkedConversations().filter((record) => record.environmentId === environmentId).map((record) => record.name);
}

let odb: OverdeckTestDb;
let replies: SharedConversationsResponse[];
const fetch = vi.fn(async (_environmentId: string, _path: string, _init: { actor: 'operator' }) => ({ status: 200, json: replies.shift() as unknown }));
const log = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  odb = setupOverdeckTestDb();
  replies = [];
  fetch.mockClear();
  log.mockClear();
}, 15_000);

afterEach(() => {
  vi.useRealTimers();
  teardownOverdeckTestDb(odb);
});

describe('linked conversations sync (PAN-4650 WI-3)', () => {
  it('fetches once on connect and writes the rows', async () => {
    replies = [answer([row('conv-a'), row('conv-b')], 'h1')];
    await createLinkedConversationsSync({ fetch, log }).onConnect(link());

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('env-desk', SHARED_CONVERSATIONS_PATH, { actor: 'operator' });
    expect(namesFor('env-desk')).toEqual(['conv-a', 'conv-b']);
    expect(cachedListHash('env-desk')).toBe('h1');
  });

  it('fetches nothing for an unchanged hash and once for a changed one', async () => {
    const sync = createLinkedConversationsSync({ fetch, log });
    replies = [answer([row('conv-a')], 'h1')];
    await sync.onConnect(link());

    await sync.onHeartbeat(link(), beat('h1'));
    expect(fetch).toHaveBeenCalledTimes(1);

    replies = [answer([row('conv-a'), row('conv-c')], 'h2')];
    await sync.onHeartbeat(link(), beat('h2'));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(namesFor('env-desk')).toEqual(['conv-a', 'conv-c']);
  });

  it('never fetches on a heartbeat without a hash (an older owner)', async () => {
    await createLinkedConversationsSync({ fetch, log }).onHeartbeat(link(), beat());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores an answer naming another environment id', async () => {
    replies = [answer([row('conv-a')], 'h1', { environmentId: 'env-other' })];
    await createLinkedConversationsSync({ fetch, log }).onConnect(link());
    expect(listLinkedConversations()).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('env-other'));
  });

  it('empties the rows when sharing is off, and the sharing-off hash then fetches nothing', async () => {
    const sync = createLinkedConversationsSync({ fetch, log });
    replies = [answer([row('conv-a')], 'h1')];
    await sync.onConnect(link());
    replies = [answer([], 'sharing-off', { sharing: false })];
    await sync.onHeartbeat(link(), beat('sharing-off'));
    expect(namesFor('env-desk')).toEqual([]);

    await sync.onHeartbeat(link(), beat('sharing-off'));
    await sync.onHeartbeat(link(), beat('sharing-off'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('prunes environments with no active link, leaving active ones', async () => {
    replaceLinkedConversations('env-desk', [row('conv-a')], 'h1');
    replaceLinkedConversations('env-gone', [row('conv-x')], 'h2');
    replaceLinkedConversations('env-off', [], 'sharing-off');

    createLinkedConversationsSync({ fetch, log }).prune(['env-desk']);

    expect(namesFor('env-desk')).toEqual(['conv-a']);
    expect(namesFor('env-gone')).toEqual([]);
    expect(cachedListHash('env-gone')).toBeNull();
    expect(cachedListHash('env-off')).toBeNull();
  });

  it('runs one fetch at a time; triggers during a fetch add exactly one more', async () => {
    const pending: Array<(value: { status: number; json: unknown }) => void> = [];
    const slowFetch = vi.fn(() => new Promise<{ status: number; json: unknown }>((resolve) => { pending.push(resolve); }));
    const sync = createLinkedConversationsSync({ fetch: slowFetch, log });

    const first = sync.onConnect(link());
    void sync.onConnect(link());
    void sync.onHeartbeat(link(), beat('h9'));
    await vi.advanceTimersByTimeAsync(0);
    expect(slowFetch).toHaveBeenCalledTimes(1);

    pending[0]!({ status: 200, json: answer([row('conv-a')], 'h1') });
    await vi.advanceTimersByTimeAsync(0);
    expect(slowFetch).toHaveBeenCalledTimes(2);
    pending[1]!({ status: 200, json: answer([row('conv-a'), row('conv-b')], 'h9') });
    await first;

    expect(slowFetch).toHaveBeenCalledTimes(2);
    expect(namesFor('env-desk')).toEqual(['conv-a', 'conv-b']);
  });

  it('skips the queued fetch when the first answer already carries the heartbeat hash', async () => {
    const pending: Array<(value: { status: number; json: unknown }) => void> = [];
    const slowFetch = vi.fn(() => new Promise<{ status: number; json: unknown }>((resolve) => { pending.push(resolve); }));
    const sync = createLinkedConversationsSync({ fetch: slowFetch, log });

    const first = sync.onConnect(link());
    void sync.onHeartbeat(link(), beat('h1'));
    await vi.advanceTimersByTimeAsync(0);
    pending[0]!({ status: 200, json: answer([row('conv-a')], 'h1') });
    await first;

    expect(slowFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the cache when the owner is unreachable or answers an error', async () => {
    replaceLinkedConversations('env-desk', [row('conv-a')], 'h1');
    const failing = vi.fn()
      .mockRejectedValueOnce(new Error('machine-offline'))
      .mockResolvedValueOnce({ status: 403, json: { error: 'no' } })
      .mockResolvedValueOnce({ status: 200, json: { rows: 'not-a-list' } });
    const sync = createLinkedConversationsSync({ fetch: failing, log });
    await sync.onConnect(link());
    await sync.onConnect(link());
    await sync.onConnect(link());
    expect(namesFor('env-desk')).toEqual(['conv-a']);
    expect(log).toHaveBeenCalledTimes(3);
  });
});
