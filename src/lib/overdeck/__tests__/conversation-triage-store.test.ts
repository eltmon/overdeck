/** PAN-4639 WI-1: triage storage obeys the D3 mutual-exclusion rules. */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let testHome: string;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4639-triage-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('conversation triage store', () => {
  it('PRAGMA table_info reports the three triage columns', async () => {
    const { getOverdeckDatabase } = await import('../infra.js');
    const columns = getOverdeckDatabase()
      .prepare('PRAGMA table_info(conversations)')
      .all<{ name: string }>()
      .map((c) => c.name);
    expect(columns).toContain('settled_at');
    expect(columns).toContain('settle_reason');
    expect(columns).toContain('snoozed_until');
  });

  it('a fresh conversation has empty triage', async () => {
    const { createConversation } = await import('../conversations.js');
    const { getConversationTriage, EMPTY_CONVERSATION_TRIAGE } = await import('../conversation-triage-store.js');
    createConversation({ name: 'conv-a', tmuxSession: 'conv-a', cwd: testHome, harness: 'claude-code' });
    expect(getConversationTriage('conv-a')).toEqual(EMPTY_CONVERSATION_TRIAGE);
  });

  it('getConversationTriage returns null for an unknown name', async () => {
    const { getConversationTriage } = await import('../conversation-triage-store.js');
    expect(getConversationTriage('does-not-exist')).toBeNull();
  });

  it('settle sets settledAt and the reason, and clears any snooze', async () => {
    const { createConversation } = await import('../conversations.js');
    const { settleConversation, snoozeConversation, getConversationTriage } = await import('../conversation-triage-store.js');
    createConversation({ name: 'conv-b', tmuxSession: 'conv-b', cwd: testHome, harness: 'claude-code' });
    snoozeConversation('conv-b', Date.now() + 60_000);
    expect(settleConversation('conv-b', 'manual', 1_000)).toBe(true);
    const triage = getConversationTriage('conv-b');
    expect(triage?.settledAt).toBe(new Date(1_000).toISOString());
    expect(triage?.settleReason).toBe('manual');
    expect(triage?.snoozedUntil).toBeNull();
  });

  it('re-settling an already settled row keeps the first settledAt and reason', async () => {
    const { createConversation } = await import('../conversations.js');
    const { settleConversation, getConversationTriage } = await import('../conversation-triage-store.js');
    createConversation({ name: 'conv-c', tmuxSession: 'conv-c', cwd: testHome, harness: 'claude-code' });
    settleConversation('conv-c', 'manual', 1_000);
    settleConversation('conv-c', 'merge', 2_000);
    const triage = getConversationTriage('conv-c');
    expect(triage?.settledAt).toBe(new Date(1_000).toISOString());
    expect(triage?.settleReason).toBe('manual');
  });

  it('settle on an unknown name returns false', async () => {
    const { settleConversation } = await import('../conversation-triage-store.js');
    expect(settleConversation('does-not-exist')).toBe(false);
  });

  it('unsettle clears settledAt and reason', async () => {
    const { createConversation } = await import('../conversations.js');
    const { settleConversation, unsettleConversation, getConversationTriage } = await import('../conversation-triage-store.js');
    createConversation({ name: 'conv-d', tmuxSession: 'conv-d', cwd: testHome, harness: 'claude-code' });
    settleConversation('conv-d');
    expect(unsettleConversation('conv-d')).toBe(true);
    expect(getConversationTriage('conv-d')?.settledAt).toBeNull();
    expect(getConversationTriage('conv-d')?.settleReason).toBeNull();
  });

  it('snooze sets snoozedUntil and clears any settle', async () => {
    const { createConversation } = await import('../conversations.js');
    const { settleConversation, snoozeConversation, getConversationTriage } = await import('../conversation-triage-store.js');
    createConversation({ name: 'conv-e', tmuxSession: 'conv-e', cwd: testHome, harness: 'claude-code' });
    settleConversation('conv-e');
    const until = Date.now() + 3_600_000;
    expect(snoozeConversation('conv-e', until)).toBe(true);
    const triage = getConversationTriage('conv-e');
    expect(triage?.snoozedUntil).toBe(new Date(until).toISOString());
    expect(triage?.settledAt).toBeNull();
    expect(triage?.settleReason).toBeNull();
  });

  it('unsnooze clears snoozedUntil', async () => {
    const { createConversation } = await import('../conversations.js');
    const { snoozeConversation, unsnoozeConversation, getConversationTriage } = await import('../conversation-triage-store.js');
    createConversation({ name: 'conv-f', tmuxSession: 'conv-f', cwd: testHome, harness: 'claude-code' });
    snoozeConversation('conv-f', Date.now() + 1_000);
    expect(unsnoozeConversation('conv-f')).toBe(true);
    expect(getConversationTriage('conv-f')?.snoozedUntil).toBeNull();
  });

  it('listConversationTriage returns one entry per existing name from a single statement', async () => {
    const { createConversation } = await import('../conversations.js');
    const { settleConversation, snoozeConversation, listConversationTriage } = await import('../conversation-triage-store.js');
    createConversation({ name: 'conv-g1', tmuxSession: 'conv-g1', cwd: testHome, harness: 'claude-code' });
    createConversation({ name: 'conv-g2', tmuxSession: 'conv-g2', cwd: testHome, harness: 'claude-code' });
    createConversation({ name: 'conv-g3', tmuxSession: 'conv-g3', cwd: testHome, harness: 'claude-code' });
    settleConversation('conv-g1');
    snoozeConversation('conv-g2', Date.now() + 1_000);

    const map = listConversationTriage(['conv-g1', 'conv-g2', 'conv-g3', 'unknown-name']);
    expect(map.size).toBe(3);
    expect(map.get('conv-g1')?.settledAt).not.toBeNull();
    expect(map.get('conv-g2')?.snoozedUntil).not.toBeNull();
    expect(map.get('conv-g3')).toEqual({ settledAt: null, settleReason: null, snoozedUntil: null });
    expect(map.has('unknown-name')).toBe(false);
  });

  it('listConversationTriage returns an empty map for an empty names array', async () => {
    const { listConversationTriage } = await import('../conversation-triage-store.js');
    expect(listConversationTriage([]).size).toBe(0);
  });

  describe('parseTriageUpdates', () => {
    it('accepts a valid settle update', async () => {
      const { parseTriageUpdates } = await import('../conversation-triage-store.js');
      const result = parseTriageUpdates({ updates: [{ name: 'conv-a', settled: true }] });
      expect(result).toEqual({ ok: true, updates: [{ name: 'conv-a', settled: true }] });
    });

    it('accepts a valid snooze update', async () => {
      const { parseTriageUpdates } = await import('../conversation-triage-store.js');
      const result = parseTriageUpdates({ updates: [{ name: 'conv-a', snoozedUntil: '2026-12-01T09:00:00.000Z' }] });
      expect(result).toEqual({ ok: true, updates: [{ name: 'conv-a', snoozedUntil: '2026-12-01T09:00:00.000Z' }] });
    });

    it('accepts a valid unsnooze update', async () => {
      const { parseTriageUpdates } = await import('../conversation-triage-store.js');
      const result = parseTriageUpdates({ updates: [{ name: 'conv-a', snoozedUntil: null }] });
      expect(result).toEqual({ ok: true, updates: [{ name: 'conv-a', snoozedUntil: null }] });
    });

    it('rejects a missing updates field', async () => {
      const { parseTriageUpdates } = await import('../conversation-triage-store.js');
      expect(parseTriageUpdates({}).ok).toBe(false);
    });

    it('rejects a non-array updates field', async () => {
      const { parseTriageUpdates } = await import('../conversation-triage-store.js');
      expect(parseTriageUpdates({ updates: 'nope' }).ok).toBe(false);
    });

    it('rejects an empty updates array', async () => {
      const { parseTriageUpdates } = await import('../conversation-triage-store.js');
      expect(parseTriageUpdates({ updates: [] }).ok).toBe(false);
    });

    it('rejects more than 200 entries', async () => {
      const { parseTriageUpdates } = await import('../conversation-triage-store.js');
      const updates = Array.from({ length: 201 }, (_, i) => ({ name: `conv-${i}`, settled: true }));
      expect(parseTriageUpdates({ updates }).ok).toBe(false);
    });

    it('rejects a missing name', async () => {
      const { parseTriageUpdates } = await import('../conversation-triage-store.js');
      expect(parseTriageUpdates({ updates: [{ settled: true }] }).ok).toBe(false);
    });

    it('rejects an empty string name', async () => {
      const { parseTriageUpdates } = await import('../conversation-triage-store.js');
      expect(parseTriageUpdates({ updates: [{ name: '  ', settled: true }] }).ok).toBe(false);
    });

    it('rejects settled: true combined with a non-null snoozedUntil', async () => {
      const { parseTriageUpdates } = await import('../conversation-triage-store.js');
      const result = parseTriageUpdates({
        updates: [{ name: 'conv-a', settled: true, snoozedUntil: '2026-12-01T09:00:00.000Z' }],
      });
      expect(result.ok).toBe(false);
    });

    it('rejects an unparseable snoozedUntil', async () => {
      const { parseTriageUpdates } = await import('../conversation-triage-store.js');
      expect(parseTriageUpdates({ updates: [{ name: 'conv-a', snoozedUntil: 'not-a-date' }] }).ok).toBe(false);
    });

    it('rejects an entry with neither settled nor snoozedUntil', async () => {
      const { parseTriageUpdates } = await import('../conversation-triage-store.js');
      expect(parseTriageUpdates({ updates: [{ name: 'conv-a' }] }).ok).toBe(false);
    });

    it('rejects settled present and not a boolean', async () => {
      const { parseTriageUpdates } = await import('../conversation-triage-store.js');
      expect(parseTriageUpdates({ updates: [{ name: 'conv-a', settled: 'yes' }] }).ok).toBe(false);
    });

    it('rejects an invalid settleReason', async () => {
      const { parseTriageUpdates } = await import('../conversation-triage-store.js');
      expect(parseTriageUpdates({ updates: [{ name: 'conv-a', settled: true, settleReason: 'nope' }] }).ok).toBe(false);
    });
  });

  describe('applyTriageUpdate', () => {
    it('applies a settle update and returns the new state', async () => {
      const { createConversation } = await import('../conversations.js');
      const { applyTriageUpdate } = await import('../conversation-triage-store.js');
      createConversation({ name: 'conv-h', tmuxSession: 'conv-h', cwd: testHome, harness: 'claude-code' });
      const triage = applyTriageUpdate({ name: 'conv-h', settled: true }, 5_000);
      expect(triage?.settledAt).toBe(new Date(5_000).toISOString());
      expect(triage?.settleReason).toBe('manual');
    });

    it('applies a snooze update and returns the new state', async () => {
      const { createConversation } = await import('../conversations.js');
      const { applyTriageUpdate } = await import('../conversation-triage-store.js');
      createConversation({ name: 'conv-i', tmuxSession: 'conv-i', cwd: testHome, harness: 'claude-code' });
      const until = '2026-12-01T09:00:00.000Z';
      const triage = applyTriageUpdate({ name: 'conv-i', snoozedUntil: until });
      expect(triage?.snoozedUntil).toBe(new Date(Date.parse(until)).toISOString());
    });

    it('returns null when the conversation does not exist', async () => {
      const { applyTriageUpdate } = await import('../conversation-triage-store.js');
      expect(applyTriageUpdate({ name: 'does-not-exist', settled: true })).toBeNull();
    });
  });

  describe('idle clock (PAN-4655)', () => {
    const DAY = 86_400_000;
    const NOW = 100 * DAY;
    const CUTOFF = NOW - 3 * DAY;

    async function create(name: string) {
      const { createConversation } = await import('../conversations.js');
      createConversation({ name, tmuxSession: name, cwd: testHome, harness: 'claude-code' });
    }

    async function idleResetAt(name: string): Promise<number | null> {
      const { getOverdeckDatabase } = await import('../infra.js');
      return (
        getOverdeckDatabase()
          .prepare('SELECT idle_reset_at FROM conversations WHERE name = ?')
          .get<{ idle_reset_at: number | null }>(name)?.idle_reset_at ?? null
      );
    }

    async function setColumn(name: string, column: string, value: number) {
      const { getOverdeckDatabase } = await import('../infra.js');
      getOverdeckDatabase().prepare(`UPDATE conversations SET ${column} = ? WHERE name = ?`).run(value, name);
    }

    it('PRAGMA table_info reports idle_reset_at', async () => {
      const { getOverdeckDatabase } = await import('../infra.js');
      const columns = getOverdeckDatabase()
        .prepare('PRAGMA table_info(conversations)')
        .all<{ name: string }>()
        .map((c) => c.name);
      expect(columns).toContain('idle_reset_at');
    });

    it('unsettle stores the request time as idle_reset_at', async () => {
      const { unsettleConversation } = await import('../conversation-triage-store.js');
      await create('idle-a');
      expect(unsettleConversation('idle-a', 5_000)).toBe(true);
      expect(await idleResetAt('idle-a')).toBe(5_000);
    });

    it('applyTriageUpdate unsnooze stores the request time as idle_reset_at', async () => {
      const { applyTriageUpdate, snoozeConversation } = await import('../conversation-triage-store.js');
      await create('idle-b');
      snoozeConversation('idle-b', 1_000_000);
      expect(applyTriageUpdate({ name: 'idle-b', snoozedUntil: null }, 7_000)?.snoozedUntil).toBeNull();
      expect(await idleResetAt('idle-b')).toBe(7_000);
    });

    it('applyTriageUpdate unsettle stores the request time as idle_reset_at', async () => {
      const { applyTriageUpdate, settleConversation } = await import('../conversation-triage-store.js');
      await create('idle-c');
      settleConversation('idle-c', 'manual', 1_000);
      applyTriageUpdate({ name: 'idle-c', settled: false }, 9_000);
      expect(await idleResetAt('idle-c')).toBe(9_000);
    });

    it('settleIdleConversation settles a clean row with reason idle', async () => {
      const { settleIdleConversation, getConversationTriage } = await import('../conversation-triage-store.js');
      await create('idle-d');
      expect(settleIdleConversation('idle-d', CUTOFF, NOW)).toBe(true);
      const triage = getConversationTriage('idle-d');
      expect(triage?.settleReason).toBe('idle');
      expect(triage?.settledAt).toBe(new Date(NOW).toISOString());
    });

    it('settleIdleConversation settles a row whose reset and snooze ended at or before the cutoff', async () => {
      const { settleIdleConversation, getConversationTriage } = await import('../conversation-triage-store.js');
      await create('idle-e');
      await setColumn('idle-e', 'idle_reset_at', CUTOFF);
      await setColumn('idle-e', 'snoozed_until', CUTOFF - DAY);
      expect(settleIdleConversation('idle-e', CUTOFF, NOW)).toBe(true);
      const triage = getConversationTriage('idle-e');
      expect(triage?.settleReason).toBe('idle');
      expect(triage?.snoozedUntil).toBeNull();
    });

    it('settleIdleConversation leaves an already settled row unchanged', async () => {
      const { settleConversation, settleIdleConversation, getConversationTriage } = await import(
        '../conversation-triage-store.js'
      );
      await create('idle-f');
      settleConversation('idle-f', 'manual', 1_000);
      expect(settleIdleConversation('idle-f', CUTOFF, NOW)).toBe(false);
      const triage = getConversationTriage('idle-f');
      expect(triage?.settleReason).toBe('manual');
      expect(triage?.settledAt).toBe(new Date(1_000).toISOString());
    });

    it('settleIdleConversation skips a row reset after the cutoff', async () => {
      const { settleIdleConversation, getConversationTriage, EMPTY_CONVERSATION_TRIAGE } = await import(
        '../conversation-triage-store.js'
      );
      await create('idle-g');
      await setColumn('idle-g', 'idle_reset_at', CUTOFF + 1);
      expect(settleIdleConversation('idle-g', CUTOFF, NOW)).toBe(false);
      expect(getConversationTriage('idle-g')).toEqual(EMPTY_CONVERSATION_TRIAGE);
    });

    it('settleIdleConversation skips a row snoozed past the cutoff', async () => {
      const { settleIdleConversation, getConversationTriage } = await import('../conversation-triage-store.js');
      await create('idle-h');
      await setColumn('idle-h', 'snoozed_until', CUTOFF + 1);
      expect(settleIdleConversation('idle-h', CUTOFF, NOW)).toBe(false);
      const triage = getConversationTriage('idle-h');
      expect(triage?.settledAt).toBeNull();
      expect(triage?.snoozedUntil).toBe(new Date(CUTOFF + 1).toISOString());
    });

    it('settleIdleConversation skips an archived row', async () => {
      const { settleIdleConversation, getConversationTriage, EMPTY_CONVERSATION_TRIAGE } = await import(
        '../conversation-triage-store.js'
      );
      await create('idle-i');
      await setColumn('idle-i', 'archived_at', NOW - DAY);
      expect(settleIdleConversation('idle-i', CUTOFF, NOW)).toBe(false);
      expect(getConversationTriage('idle-i')).toEqual(EMPTY_CONVERSATION_TRIAGE);
    });

    it('listIdleClocks returns unarchived rows with their clock columns and omits archived rows', async () => {
      const { listIdleClocks, settleConversation } = await import('../conversation-triage-store.js');
      await create('idle-j');
      await create('idle-k');
      await create('idle-l');
      settleConversation('idle-j', 'manual', 1_000);
      await setColumn('idle-k', 'snoozed_until', 2_000);
      await setColumn('idle-k', 'idle_reset_at', 3_000);
      await setColumn('idle-l', 'archived_at', NOW);
      const clocks = listIdleClocks();
      expect(clocks.get('idle-j')).toEqual({ settledAtMs: 1_000, snoozedUntilMs: null, idleResetAtMs: null });
      expect(clocks.get('idle-k')).toEqual({ settledAtMs: null, snoozedUntilMs: 2_000, idleResetAtMs: 3_000 });
      expect(clocks.has('idle-l')).toBe(false);
    });
  });
});
