/**
 * PAN-5000: a linked row with no title, or a title that is only a file path,
 * shows "New conversation" instead of leaking the owner's list name or a
 * filesystem path into the UI.
 */
import { describe, expect, it } from 'vitest';
import type { SharedConversationRow } from '@overdeck/contracts';

import type { MachineLink } from '../../anywhere/link-store.js';
import { linkedRowTitle } from '../linked-conversation-title.js';
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

describe('merged linked rows fall back to "New conversation" (PAN-5000)', () => {
  it('replaces a null, blank or path-only owner title with "New conversation", and keeps a real title unchanged', () => {
    const rows = mergeConversationRows({
      local: [],
      vaultCopies: [],
      linked: [
        record(1, 'untitled', { title: null }),
        record(2, 'blank', { title: '   ' }),
        record(3, 'path', { title: '/Users/eltmon/.overdeck/conversation-attachments/c1/a.png fix' }),
        record(4, 'real', { title: 'Fix the login form' }),
      ],
      links: [LINK],
      selfEnvironmentId: 'env-desk',
      presence: () => ({ state: 'online', lastSeenAt: null }),
    });
    expect(rows.map((row) => row['title'])).toEqual([
      'New conversation',
      'New conversation',
      'New conversation',
      'Fix the login form',
    ]);
  });
});

describe('linkedRowTitle (PAN-5000)', () => {
  it('passes through a title that only looks path-like at a glance', () => {
    expect(linkedRowTitle('/pan-flywheel start')).toBe('/pan-flywheel start');
  });

  it('treats a Windows absolute path as untitled', () => {
    expect(linkedRowTitle('C:\\Users\\x\\a.png')).toBe('New conversation');
  });
});
