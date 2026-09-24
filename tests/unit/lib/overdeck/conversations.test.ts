/**
 * Tests for workspace-e5ekl — Conversations domain + Transcripts read service.
 *
 * AC1: ConversationsResolver and ConversationWriter resolve as distinct Context.Services.
 * AC2: TranscriptsResolver exposes only reads; no write path persists changes to a
 *      conversation JSONL file.
 * AC3: Conversation/favorites/file-pointer metadata reads and writes route through
 *      the two doors.
 */
import { afterEach, beforeEach, describe, it, expect } from 'vitest';

import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';
import {
  ConversationsResolver,
  ConversationWriter,
  archiveConversation,
  createConversation,
  getConversationByName,
  getSupervisedConversationByTmuxSession,
  markConversationEnded,
  setClearedToConvId,
  markConversationRunning,
  updateForkStatus,
  updateSpawnError,
} from '../../../../src/lib/overdeck/conversations.js';

// ── Fake DB ───────────────────────────────────────────────────────────────────

// ── AC1: distinct Context.Services ────────────────────────────────────────────

describe('AC1 — ConversationsResolver and ConversationWriter are distinct Context.Services', () => {
  it('ConversationsResolver service tag differs from ConversationWriter', () => {
    // Using Context.Service identifiers — they are distinct strings
    expect(ConversationsResolver.key).not.toBe(ConversationWriter.key);
  });


});

describe('markConversationRunning failure-state repair', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => {
    odb = setupOverdeckTestDb();
    createConversation({ name: 'repair-me', tmuxSession: 'conv-repair-me', cwd: '/tmp' });
  }, 15_000);

  afterEach(() => {
    teardownOverdeckTestDb(odb);
  });

  it('clears failed fork state and spawn_error when resurrecting', () => {
    updateForkStatus('repair-me', 'failed', 'fork failed');
    updateSpawnError('repair-me', 'spawn failed');
    markConversationEnded('repair-me');

    markConversationRunning('repair-me');

    expect(getConversationByName('repair-me')).toMatchObject({
      status: 'active',
      forkStatus: null,
      forkError: null,
      spawnError: null,
    });
  });

  it('preserves in-flight fork state while clearing spawn_error', () => {
    updateForkStatus('repair-me', 'injecting', 'still working');
    updateSpawnError('repair-me', 'stale failure');
    markConversationEnded('repair-me');

    markConversationRunning('repair-me');

    expect(getConversationByName('repair-me')).toMatchObject({
      status: 'active',
      forkStatus: 'injecting',
      forkError: 'still working',
      spawnError: null,
    });
  });

  it('does not write an already-active row', () => {
    markConversationRunning('repair-me');

    const row = odb.raw().prepare('SELECT changes() AS count').get() as { count: number };
    expect(row.count).toBe(0);
  });
});

describe('getSupervisedConversationByTmuxSession — post-/clear siblings (PAN-3962)', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => {
    odb = setupOverdeckTestDb();
  }, 15_000);

  afterEach(() => {
    teardownOverdeckTestDb(odb);
  });

  function seedClearedPair() {
    createConversation({ name: 'parent', tmuxSession: 'conv-parent', cwd: '/tmp' });
    const sibling = createConversation({ name: 'parent-post-clear-1234abcd', tmuxSession: 'conv-parent', cwd: '/tmp' });
    setClearedToConvId('parent', sibling.id);
    markConversationEnded('parent');
    return sibling;
  }

  it('resolves the shared session to the post-/clear sibling, not the parent', () => {
    const sibling = seedClearedPair();

    expect(getSupervisedConversationByTmuxSession('conv-parent')?.name).toBe(sibling.name);
  });

  it('still prefers the sibling once the sibling itself has ended', () => {
    const sibling = seedClearedPair();
    markConversationEnded(sibling.name);

    expect(getSupervisedConversationByTmuxSession('conv-parent')?.name).toBe(sibling.name);
  });

  it('resolves a lone conversation by its session and ignores archived rows', () => {
    createConversation({ name: 'solo', tmuxSession: 'conv-solo', cwd: '/tmp' });
    expect(getSupervisedConversationByTmuxSession('conv-solo')?.name).toBe('solo');

    archiveConversation('solo');
    expect(getSupervisedConversationByTmuxSession('conv-solo')).toBeNull();
  });
});

// ── AC2: TranscriptsResolver is strictly read-only ────────────────────────────


// ── AC3: reads/writes route through the two doors ────────────────────────────

