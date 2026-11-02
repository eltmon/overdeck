/** PAN-4657 WI-3: the list enrichment carries nextScheduledRunAt/scheduleCount. */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// OVERDECK_HOME is captured when the path helpers load, so set it before the
// first dynamic import of the infra and conversation modules.
const TEST_HOME = join(tmpdir(), `pan-4657-list-schedules-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;

vi.mock('../../../dashboard/server/event-store.js', () => ({ getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })) }));
vi.mock('../../../dashboard/server/services/dashboard-poll-snapshots.js', () => ({ getConversationLedgerCostsSnapshot: vi.fn(async () => []) }));
vi.mock('../conversation-liveness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation-liveness.js')>()),
  listLiveConversationSessions: vi.fn(async () => new Set<string>()),
  conversationHarnessAlive: vi.fn(async () => false),
}));

const { closeOverdeckDatabase } = await import('../infra.js');
const { createConversation } = await import('../conversations.js');
const { createConversationSchedule, updateConversationSchedule, listScheduleSummariesForConversations } = await import('../conversation-schedules.js');
const { upsertVaultBrowseRow } = await import('../conversation-vault-rows.js');
const { getEnrichedConversationList, getConversationListWithVaultCopies, invalidateConversationListEnrichmentCache } = await import('../conversation-list.js');

mkdirSync(TEST_HOME, { recursive: true });

const NOW = Date.parse('2026-11-01T12:00:00.000Z');
// Both fire later the same day as NOW, so their nextRunAt values compare directly.
const EARLIER = { prompt: 'Afternoon summary', cron: '0 13 * * *', timeZone: 'UTC', enabled: true };
const LATER = { prompt: 'Evening summary', cron: '0 20 * * *', timeZone: 'UTC', enabled: true };

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('conversation list schedule enrichment (PAN-4657 WI-3)', () => {
  it('a conversation with two enabled schedules reports scheduleCount 2 and the earlier nextRunAt', async () => {
    createConversation({ name: 'conv-two-schedules', tmuxSession: 'conv-two-schedules', cwd: TEST_HOME, workspaceId: null });
    const earlier = createConversationSchedule('conv-two-schedules', EARLIER, NOW);
    const later = createConversationSchedule('conv-two-schedules', LATER, NOW);
    if (earlier.status !== 'created' || later.status !== 'created') throw new Error('unreachable');
    invalidateConversationListEnrichmentCache();

    const rows = (await getEnrichedConversationList(500, 0)) as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.name === 'conv-two-schedules');
    expect(row).toMatchObject({ scheduleCount: 2, nextScheduledRunAt: earlier.schedule.nextRunAt });
  });

  it('a conversation whose only schedule is paused reports nextScheduledRunAt null and scheduleCount 0', async () => {
    createConversation({ name: 'conv-paused-schedule', tmuxSession: 'conv-paused-schedule', cwd: TEST_HOME, workspaceId: null });
    const created = createConversationSchedule('conv-paused-schedule', EARLIER, NOW);
    if (created.status !== 'created') throw new Error('unreachable');
    updateConversationSchedule('conv-paused-schedule', created.schedule.id, { enabled: false }, NOW);
    invalidateConversationListEnrichmentCache();

    const rows = (await getEnrichedConversationList(500, 0)) as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.name === 'conv-paused-schedule');
    expect(row).toMatchObject({ nextScheduledRunAt: null, scheduleCount: 0 });
  });

  it('a conversation with no schedule reports nulls, and an empty name list returns an empty map', async () => {
    createConversation({ name: 'conv-no-schedule', tmuxSession: 'conv-no-schedule', cwd: TEST_HOME, workspaceId: null });
    invalidateConversationListEnrichmentCache();

    const rows = (await getEnrichedConversationList(500, 0)) as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.name === 'conv-no-schedule');
    expect(row).toMatchObject({ nextScheduledRunAt: null, scheduleCount: 0 });
    expect(listScheduleSummariesForConversations([])).toEqual(new Map());
  });

  it('vault browse copies report nextScheduledRunAt null and scheduleCount 0', async () => {
    upsertVaultBrowseRow({
      vaultId: '00000000-0000-4000-8000-000000000001',
      title: 'saved elsewhere',
      harness: 'claude-code',
      ownerLabel: 'laptop',
      cwd: '/home/other/proj',
      model: 'claude-opus-5-5',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z',
    });
    invalidateConversationListEnrichmentCache();
    const rows = (await getConversationListWithVaultCopies(500, 0)) as Array<Record<string, unknown>>;
    const copy = rows.find((r) => r['origin'] === 'vault');
    expect(copy).toMatchObject({ nextScheduledRunAt: null, scheduleCount: 0 });
  });
});
