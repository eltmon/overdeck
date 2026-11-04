/**
 * PAN-4903: a conversation whose launch failed on a linked machine shows the
 * failure on the viewer. The owner's spawn error rides the shared row and the
 * merged linked row carries it, so the panel renders the spawn-failed state
 * instead of an empty composer.
 */
import { describe, expect, it } from 'vitest';
import type { SharedConversationRow } from '@overdeck/contracts';

import type { MachineLink } from '../../anywhere/link-store.js';
import { mergeConversationRows } from '../linked-conversations-merge.js';
import type { LinkedConversationRecord } from '../linked-conversations.js';

const LINK: MachineLink = {
  id: 'link-mac', environmentId: 'env-mac', label: 'mac', machineKey: 'ab'.repeat(32), token: `odk_${'1'.repeat(64)}`,
  access: 'operator', reverseTokenId: null, routes: [], createdAt: '2026-11-03T00:00:00.000Z', revokedAt: null,
};

function record(id: number, name: string, extra: Partial<SharedConversationRow> = {}): LinkedConversationRecord {
  return {
    id, environmentId: 'env-mac', name, nativeSessionId: null, cachedAt: '2026-11-03T00:00:00.000Z', listHash: 'h',
    row: {
      name, title: null, nativeSessionId: null, harness: 'codex', model: 'gpt-5.6-sol', status: 'active',
      sessionAlive: true, isWorking: false, lastActivityAt: null, projectKey: null, gitOrigin: null, cwd: null,
      issueId: null, tmuxSession: `conv-${name}`, releasedTo: null, createdAt: '2026-11-03T00:00:00.000Z',
      pullable: true, vaultId: null, ...extra,
    },
  };
}

describe('linked rows carry the owner spawn error (PAN-4903)', () => {
  it('maps a shared spawnError and defaults it to null for owners that omit it', () => {
    const rows = mergeConversationRows({
      local: [],
      vaultCopies: [],
      linked: [
        record(1, '20261103-9234', { spawnError: 'MessageDeliveryFailed: Codex app-server delivery failed for conv-20261103-9234 (conversation-message): socket-missing' }),
        record(2, '20261103-0001'),
      ],
      links: [LINK],
      selfEnvironmentId: 'env-desk',
      presence: () => ({ state: 'online', lastSeenAt: null }),
    });
    expect(rows.map((row) => row['spawnError'])).toEqual([
      'MessageDeliveryFailed: Codex app-server delivery failed for conv-20261103-9234 (conversation-message): socket-missing',
      null,
    ]);
  });
});
