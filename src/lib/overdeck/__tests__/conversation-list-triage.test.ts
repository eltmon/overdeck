/** PAN-4639 WI-3: the list enrichment carries settledAt/settleReason/snoozedUntil. */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// OVERDECK_HOME is captured when the path helpers load, so set it before the
// first dynamic import of the infra and conversation modules.
const TEST_HOME = join(tmpdir(), `pan-4639-list-triage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
const { settleConversation, snoozeConversation } = await import('../conversation-triage-store.js');
const { getEnrichedConversationList, invalidateConversationListEnrichmentCache } = await import('../conversation-list.js');

mkdirSync(TEST_HOME, { recursive: true });

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('conversation list triage enrichment (PAN-4639 WI-3)', () => {
  it('a settled row comes back with ISO settledAt and its reason', async () => {
    createConversation({ name: 'conv-settled', tmuxSession: 'conv-settled', cwd: TEST_HOME, workspaceId: null });
    settleConversation('conv-settled', 'manual', 5_000);
    invalidateConversationListEnrichmentCache();

    const rows = (await getEnrichedConversationList(500, 0)) as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.name === 'conv-settled');
    expect(row).toMatchObject({ settledAt: new Date(5_000).toISOString(), settleReason: 'manual', snoozedUntil: null });
  });

  it('a snoozed row comes back with ISO snoozedUntil and null settle fields', async () => {
    createConversation({ name: 'conv-snoozed', tmuxSession: 'conv-snoozed', cwd: TEST_HOME, workspaceId: null });
    const until = Date.now() + 3_600_000;
    snoozeConversation('conv-snoozed', until);
    invalidateConversationListEnrichmentCache();

    const rows = (await getEnrichedConversationList(500, 0)) as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.name === 'conv-snoozed');
    expect(row).toMatchObject({ settledAt: null, settleReason: null, snoozedUntil: new Date(until).toISOString() });
  });

  it('an untouched row comes back with all three fields null', async () => {
    createConversation({ name: 'conv-untouched', tmuxSession: 'conv-untouched', cwd: TEST_HOME, workspaceId: null });
    invalidateConversationListEnrichmentCache();

    const rows = (await getEnrichedConversationList(500, 0)) as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.name === 'conv-untouched');
    expect(row).toMatchObject({ settledAt: null, settleReason: null, snoozedUntil: null });
  });
});
