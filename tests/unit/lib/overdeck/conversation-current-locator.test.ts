/** PAN-2652 W1: the read door returns the current (newest) locator; the write door re-points it. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOverdeckDatabase, getOverdeckDatabase } from '../../../../src/lib/overdeck/infra.js';
import {
  createConversation,
  getConversationByName,
  setConversationClaudeSessionId,
} from '../../../../src/lib/overdeck/conversations.js';
import { onConversationSessionChanged } from '../../../../src/lib/overdeck/conversation-session-events.js';
import { getConversationLedgerCosts } from '../../../../src/lib/overdeck/conversation-ledger-costs.js';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

const originalHome = process.env.HOME;
const originalOverdeckHome = process.env.OVERDECK_HOME;
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pan-2652-locator-'));
  process.env.HOME = home;
  process.env.OVERDECK_HOME = home;
  closeOverdeckDatabase();
});

afterEach(() => {
  closeOverdeckDatabase();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalOverdeckHome;
  rmSync(home, { recursive: true, force: true });
});

function locatorRowCount(locator: string): number {
  return getOverdeckDatabase()
    .prepare('SELECT COUNT(*) AS n FROM conversation_files WHERE locator = ?')
    .get<{ n: number }>(locator)!.n;
}

function createConv(): void {
  createConversation({ name: 'conv-a', tmuxSession: 'conv-a', cwd: home, harness: 'claude-code', claudeSessionId: A });
}

describe('conversation current locator (PAN-2652 W1)', () => {
  it('ac1: the write door makes the new locator current', () => {
    createConv();
    expect(getConversationByName('conv-a')?.claudeSessionId).toBe(A);
    setConversationClaudeSessionId('conv-a', B);
    expect(getConversationByName('conv-a')?.claudeSessionId).toBe(B);
  });

  it('ac2: writing the same locator twice keeps one row and notifies once', () => {
    createConv();
    const seen: string[] = [];
    const off = onConversationSessionChanged('conv-a', (sessionId) => seen.push(sessionId));
    try {
      setConversationClaudeSessionId('conv-a', B);
      setConversationClaudeSessionId('conv-a', B);
    } finally {
      off();
    }
    expect(locatorRowCount(B)).toBe(1);
    expect(seen).toEqual([B]);
  });

  it('ac3: re-pointing to an older locator makes it current without duplicating rows', () => {
    createConv();
    setConversationClaudeSessionId('conv-a', B);
    setConversationClaudeSessionId('conv-a', A);
    expect(getConversationByName('conv-a')?.claudeSessionId).toBe(A);
    expect(locatorRowCount(A)).toBe(1);
    expect(locatorRowCount(B)).toBe(1);
  });

  it('ac4: the cost ledger sums both sessions exactly once', () => {
    createConv();
    setConversationClaudeSessionId('conv-a', B);
    setConversationClaudeSessionId('conv-a', A);
    setConversationClaudeSessionId('conv-a', B);
    const insert = getOverdeckDatabase().prepare(
      `INSERT INTO cost_events (ts, session_id, input, output, cache_read, cache_write, cost)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(Date.now(), A, 10, 5, 0, 0, 1.25);
    insert.run(Date.now(), B, 20, 10, 0, 0, 2.5);
    const legacyId = String(getConversationByName('conv-a')!.id);
    expect(getConversationLedgerCosts().get(legacyId)).toEqual({ cost: 3.75, tokens: 45 });
  });

  it('a listener for another conversation does not fire', () => {
    createConv();
    const seen: string[] = [];
    const off = onConversationSessionChanged('conv-other', (sessionId) => seen.push(sessionId));
    try {
      setConversationClaudeSessionId('conv-a', B);
    } finally {
      off();
    }
    expect(seen).toEqual([]);
  });
});
