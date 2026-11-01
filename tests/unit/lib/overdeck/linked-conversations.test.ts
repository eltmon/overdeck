/** PAN-4650 WI-1: the linked-conversations cache door and the linked-name contract. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  linkedConversationName,
  parseLinkedConversationName,
  type SharedConversationRow,
} from '@overdeck/contracts';

import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';
import {
  cachedListHash,
  deleteLinkedConversationsFor,
  getLinkedConversation,
  listLinkedConversations,
  replaceLinkedConversations,
} from '../../../../src/lib/overdeck/linked-conversations.js';

function row(name: string, overrides: Partial<SharedConversationRow> = {}): SharedConversationRow {
  return {
    name,
    title: `Title ${name}`,
    nativeSessionId: `session-${name}`,
    harness: 'claude-code',
    model: 'claude-opus-5-5',
    status: 'active',
    sessionAlive: true,
    isWorking: false,
    lastActivityAt: '2026-11-01T12:00:00.000Z',
    projectKey: 'overdeck',
    gitOrigin: 'git@github.com:eltmon/overdeck.git',
    cwd: '/home/desk/overdeck',
    issueId: null,
    tmuxSession: `conv-${name}`,
    releasedTo: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    pullable: true,
    vaultId: null,
    ...overrides,
  };
}

function namesFor(environmentId: string): string[] {
  return listLinkedConversations()
    .filter((record) => record.environmentId === environmentId)
    .map((record) => record.name);
}

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
}, 15_000);

afterEach(() => {
  teardownOverdeckTestDb(odb);
});

describe('linked_conversations schema', () => {
  it('exists on a fresh overdeck.db', () => {
    const table = odb
      .raw()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'linked_conversations'")
      .get<{ name: string }>();
    expect(table?.name).toBe('linked_conversations');
  });
});

describe('replaceLinkedConversations', () => {
  it('inserts, updates and prunes one environment in one call', () => {
    replaceLinkedConversations('env-e', [row('a'), row('b')], 'hash-1');
    replaceLinkedConversations('env-e', [row('b', { title: 'B prime' }), row('c')], 'hash-2');

    expect(namesFor('env-e')).toEqual(['b', 'c']);
    expect(getLinkedConversation('env-e', 'b')?.row.title).toBe('B prime');
    expect(getLinkedConversation('env-e', 'a')).toBeNull();
    expect(cachedListHash('env-e')).toBe('hash-2');
  });

  it("leaves another environment's rows untouched", () => {
    replaceLinkedConversations('env-1', [row('a')], 'hash-1');
    replaceLinkedConversations('env-2', [row('x'), row('y')], 'hash-2');

    replaceLinkedConversations('env-1', [], 'hash-1b');

    expect(namesFor('env-1')).toEqual([]);
    expect(namesFor('env-2')).toEqual(['x', 'y']);
    expect(cachedListHash('env-2')).toBe('hash-2');
  });

  it('remembers the hash of an answer with no rows', () => {
    replaceLinkedConversations('env-e', [row('a')], 'hash-1');
    replaceLinkedConversations('env-e', [], 'sharing-off');
    expect(cachedListHash('env-e')).toBe('sharing-off');

    replaceLinkedConversations('env-e', [row('a')], 'hash-2');
    expect(cachedListHash('env-e')).toBe('hash-2');
  });
});

describe('reads', () => {
  it('getLinkedConversation returns the parsed row and cache columns', () => {
    const shared = row('a', { releasedTo: 'env-laptop', isWorking: true });
    replaceLinkedConversations('env-e', [shared], 'hash-1', new Date('2026-11-01T13:00:00.000Z'));

    const record = getLinkedConversation('env-e', 'a');
    expect(record).toMatchObject({
      environmentId: 'env-e',
      name: 'a',
      nativeSessionId: 'session-a',
      cachedAt: '2026-11-01T13:00:00.000Z',
      listHash: 'hash-1',
    });
    expect(record?.id).toBeGreaterThan(0);
    expect(record?.row).toEqual(shared);
  });

  it('cachedListHash is null for an environment with nothing cached', () => {
    expect(cachedListHash('env-unknown')).toBeNull();
  });

  it('deleteLinkedConversationsFor drops only that environment', () => {
    replaceLinkedConversations('env-1', [row('a')], 'hash-1');
    replaceLinkedConversations('env-2', [row('b')], 'hash-2');

    deleteLinkedConversationsFor('env-1');

    expect(namesFor('env-1')).toEqual([]);
    expect(cachedListHash('env-1')).toBeNull();
    expect(namesFor('env-2')).toEqual(['b']);
  });
});

describe('linked conversation names', () => {
  it('builds and parses @<target>/<name>', () => {
    expect(linkedConversationName('env-e', 'conv-x')).toBe('@env-e/conv-x');
    expect(parseLinkedConversationName('@desk/conv-x')).toEqual({ target: 'desk', name: 'conv-x' });
  });

  it('returns null for a local or malformed name', () => {
    expect(parseLinkedConversationName('conv-x')).toBeNull();
    expect(parseLinkedConversationName('@desk')).toBeNull();
    expect(parseLinkedConversationName('@/conv-x')).toBeNull();
    expect(parseLinkedConversationName('@desk/')).toBeNull();
    expect(parseLinkedConversationName('@desk/conv-x/extra')).toBeNull();
  });
});
