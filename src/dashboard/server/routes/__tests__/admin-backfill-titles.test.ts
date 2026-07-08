/**
 * Tests for workspace-pzyvf — POST /api/admin/conversations/backfill-titles.
 *
 * AC1: Backfills a transcript-backed stuck row from its first user message with
 *      title_source='auto' and emits conversation.title_changed.
 * AC2: Falls back to 'Untitled — YYYY-MM-DD' with reason 'no transcript' when no
 *      first user message exists, and zero stuck rows remain after a non-dry run.
 * AC3: dryRun returns the report and writes nothing.
 * AC4: Preserves non-stuck and archived rows.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  archiveConversation,
  createConversation,
  getConversationByName,
  updateConversationTitle,
} from '../../../../lib/overdeck/conversations.js';
import { handleBackfillTitlesBody, type BackfillTitlesDependencies } from '../admin.js';

const emittedEvents: unknown[] = [];

vi.mock('../../event-store.js', () => ({
  getEventStore: () => ({
    emitOnly: (event: unknown) => {
      emittedEvents.push(event);
    },
  }),
}));

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-admin-backfill-titles-test-'));
  process.env.OVERDECK_HOME = testHome;
  emittedEvents.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-07T12:00:00Z'));
});

afterEach(async () => {
  vi.useRealTimers();
  const { closeOverdeckDatabaseSync } = await import('../../../../lib/overdeck/infra.js');
  closeOverdeckDatabaseSync();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

function makeDeps(messages: Array<{ role: string; text: string }>): BackfillTitlesDependencies {
  return {
    resolveSessionFile: async () => join(testHome, 'fake-session.jsonl'),
    getCachedMessages: vi.fn().mockResolvedValue({ messages }),
  };
}

describe('handleBackfillTitlesBody', () => {
  it('retitles a transcript-backed stuck row from its first user message', async () => {
    createConversation({
      name: 'backfill-transcript',
      tmuxSession: 'tmux-backfill-transcript',
      cwd: '/tmp',
      title: 'New conversation',
      titleSource: 'default',
    });

    const deps = makeDeps([{ role: 'user', text: 'refactor the auth middleware in src/auth.ts' }]);
    const result = await handleBackfillTitlesBody({ dryRun: false }, deps);

    expect(result.dryRun).toBe(false);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]).toMatchObject({
      name: 'backfill-transcript',
      title: 'refactor the auth middleware in src/auth.ts',
      reason: 'transcript',
    });

    const updated = getConversationByName('backfill-transcript');
    expect(updated?.title).toBe('refactor the auth middleware in src/auth.ts');
    expect(updated?.titleSource).toBe('auto');

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]).toMatchObject({
      type: 'conversation.title_changed',
      payload: {
        conversationName: 'backfill-transcript',
        title: 'refactor the auth middleware in src/auth.ts',
        titleSource: 'auto',
      },
    });
  });

  it('falls back to Untitled — YYYY-MM-DD when no first user message exists', async () => {
    createConversation({
      name: 'backfill-empty',
      tmuxSession: 'tmux-backfill-empty',
      cwd: '/tmp',
      title: 'New conversation',
      titleSource: 'default',
    });

    const deps = makeDeps([{ role: 'assistant', text: 'hi there' }]);
    const result = await handleBackfillTitlesBody({ dryRun: false }, deps);

    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]).toMatchObject({
      name: 'backfill-empty',
      title: 'Untitled — 2026-07-07',
      reason: 'no transcript',
    });

    const updated = getConversationByName('backfill-empty');
    expect(updated?.title).toBe('Untitled — 2026-07-07');
    expect(updated?.titleSource).toBe('auto');

    // After the run, no non-archived stuck rows remain.
    const { listConversations } = await import('../../../../lib/overdeck/conversations.js');
    const remaining = listConversations().filter((c) => c.title === 'New conversation');
    expect(remaining).toHaveLength(0);
  });

  it('dryRun returns the report and writes nothing', async () => {
    createConversation({
      name: 'backfill-dryrun',
      tmuxSession: 'tmux-backfill-dryrun',
      cwd: '/tmp',
      title: 'New conversation',
      titleSource: 'default',
    });

    const deps = makeDeps([{ role: 'user', text: 'fix the login bug' }]);
    const result = await handleBackfillTitlesBody({ dryRun: true }, deps);

    expect(result.dryRun).toBe(true);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].title).toBe('fix the login bug');

    const unchanged = getConversationByName('backfill-dryrun');
    expect(unchanged?.title).toBe('New conversation');
    expect(unchanged?.titleSource).toBe('default');
    expect(emittedEvents).toHaveLength(0);
  });

  it('preserves a manual title that happens to be "New conversation"', async () => {
    createConversation({
      name: 'backfill-manual-new-conversation',
      tmuxSession: 'tmux-backfill-manual-new-conversation',
      cwd: '/tmp',
      title: 'New conversation',
      titleSource: 'manual',
    });

    const deps = makeDeps([{ role: 'user', text: 'anything' }]);
    const result = await handleBackfillTitlesBody({ dryRun: false }, deps);

    expect(result.updated).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);

    const unchanged = getConversationByName('backfill-manual-new-conversation');
    expect(unchanged?.title).toBe('New conversation');
    expect(unchanged?.titleSource).toBe('manual');
  });

  it('does not overwrite a title that became manual between snapshot and update', async () => {
    createConversation({
      name: 'backfill-stale-snapshot',
      tmuxSession: 'tmux-backfill-stale-snapshot',
      cwd: '/tmp',
      title: 'New conversation',
      titleSource: 'default',
    });

    const deps: BackfillTitlesDependencies = {
      resolveSessionFile: async () => join(testHome, 'fake-session.jsonl'),
      getCachedMessages: vi.fn().mockImplementation(async () => {
        // Simulate an intervening manual edit after the listConversations snapshot.
        updateConversationTitle('backfill-stale-snapshot', 'New conversation', 'manual');
        return { messages: [{ role: 'user', text: 'some prompt' }] };
      }),
    };

    const result = await handleBackfillTitlesBody({ dryRun: false }, deps);

    expect(result.updated).toHaveLength(0);
    expect(result.skipped).toEqual([
      { name: 'backfill-stale-snapshot', reason: 'no longer eligible' },
    ]);

    const unchanged = getConversationByName('backfill-stale-snapshot');
    expect(unchanged?.title).toBe('New conversation');
    expect(unchanged?.titleSource).toBe('manual');
  });

  it('preserves non-stuck rows and archived rows', async () => {
    createConversation({
      name: 'backfill-preserved',
      tmuxSession: 'tmux-backfill-preserved',
      cwd: '/tmp',
      title: 'Already titled',
      titleSource: 'manual',
    });
    createConversation({
      name: 'backfill-archived',
      tmuxSession: 'tmux-backfill-archived',
      cwd: '/tmp',
      title: 'New conversation',
      titleSource: 'default',
    });
    archiveConversation('backfill-archived');

    const deps = makeDeps([{ role: 'user', text: 'anything' }]);
    const result = await handleBackfillTitlesBody({ dryRun: false }, deps);

    expect(result.updated).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);

    expect(getConversationByName('backfill-preserved')?.title).toBe('Already titled');
    expect(getConversationByName('backfill-archived')?.title).toBe('New conversation');
  });
});
