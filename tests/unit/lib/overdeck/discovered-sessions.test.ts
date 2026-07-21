import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-discovered-sessions-test-'));
  process.env.OVERDECK_HOME = testHome;
});

afterEach(async () => {
  const { closeOverdeckDatabaseSync } = await import('../../../../src/lib/overdeck/infra.js');
  const { resetDiscoveredSessionsSchemaBootstrap } = await import('../../../../src/lib/overdeck/discovered-sessions.js');
  closeOverdeckDatabaseSync();
  resetDiscoveredSessionsSchemaBootstrap();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('discovered session conversation refs', () => {
  async function conversationUuid(name: string): Promise<string> {
    const { getOverdeckDatabaseSync } = await import('../../../../src/lib/overdeck/infra.js');
    const row = getOverdeckDatabaseSync()
      .prepare(`SELECT id FROM conversations WHERE name = ?`)
      .get(name) as { id: string } | undefined;
    if (!row) throw new Error(`Missing seeded conversation ${name}`);
    return row.id;
  }

  it('returns conversation id, name, and title for a managed session', async () => {
    const { createConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { findDiscoveredSessions, upsertDiscoveredSession } = await import('../../../../src/lib/overdeck/discovered-sessions.js');

    createConversation({
      name: 'managed-session',
      tmuxSession: 'conv-managed-session',
      cwd: '/workspace',
      claudeSessionId: 'sess-managed',
      title: 'Managed Session',
    });
    upsertDiscoveredSession({
      jsonlPath: '/tmp/managed.jsonl',
      harness: 'claude-code',
      sessionId: 'sess-managed',
    });

    const [session] = findDiscoveredSessions({ limit: 1 });

    expect(session?.conversationId).toBe(await conversationUuid('managed-session'));
    expect(session?.conversationName).toBe('managed-session');
    expect(session?.conversationTitle).toBe('Managed Session');
  });

  it('returns conversation id and name for an untitled managed session', async () => {
    const { createConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { findDiscoveredSessions, upsertDiscoveredSession } = await import('../../../../src/lib/overdeck/discovered-sessions.js');

    createConversation({
      name: 'untitled-session',
      tmuxSession: 'conv-untitled-session',
      cwd: '/workspace',
      claudeSessionId: 'sess-untitled',
    });
    upsertDiscoveredSession({
      jsonlPath: '/tmp/untitled.jsonl',
      harness: 'claude-code',
      sessionId: 'sess-untitled',
    });

    const [session] = findDiscoveredSessions({ limit: 1 });

    expect(session?.conversationId).toBe(await conversationUuid('untitled-session'));
    expect(session?.conversationName).toBe('untitled-session');
    expect(session?.conversationTitle).toBeNull();
  });

  it('leaves conversation id and name empty for unmanaged sessions', async () => {
    const { findDiscoveredSessions, upsertDiscoveredSession } = await import('../../../../src/lib/overdeck/discovered-sessions.js');

    upsertDiscoveredSession({
      jsonlPath: '/tmp/unmanaged.jsonl',
      harness: 'claude-code',
      sessionId: 'sess-unmanaged',
    });

    const [session] = findDiscoveredSessions({ limit: 1 });

    expect(session?.conversationId).toBeNull();
    expect(session?.conversationName).toBeNull();
    expect(session?.conversationTitle).toBeNull();
  });
});
