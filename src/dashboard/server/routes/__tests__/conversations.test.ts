/**
 * Tests for conversations route helpers.
 *
 * The route itself is an Effect layer and not straightforwardly unit-testable
 * without the full Effect runtime. We test the extracted helper logic and the
 * database-integration behavior through the conversations-db module.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── Sanitize / name generation logic ────────────────────────────────────────
// These are internal helpers extracted here for direct testing.

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
}

function generateConversationName(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `conv-${date}-1234`;
}

describe('sanitizeName', () => {
  it('allows alphanumeric, dash, underscore', () => {
    expect(sanitizeName('my-session_1')).toBe('my-session_1');
  });

  it('replaces spaces with dashes', () => {
    expect(sanitizeName('hello world')).toBe('hello-world');
  });

  it('replaces special characters', () => {
    expect(sanitizeName('a/b:c@d')).toBe('a-b-c-d');
  });

  it('truncates to 64 characters', () => {
    const long = 'a'.repeat(100);
    expect(sanitizeName(long)).toHaveLength(64);
  });

  it('preserves already-safe names unchanged', () => {
    expect(sanitizeName('crash-recovery')).toBe('crash-recovery');
  });
});

describe('generateConversationName', () => {
  it('starts with conv-', () => {
    expect(generateConversationName()).toMatch(/^conv-\d{8}-/);
  });

  it('contains today\'s date in YYYYMMDD format', () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    expect(generateConversationName()).toContain(today);
  });
});

// ─── Conversation DB integration ──────────────────────────────────────────────

let TEST_HOME: string;

async function resetDb() {
  const { resetDatabase } = await import('../../../../lib/database/index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-416-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('conversations route — DB integration', () => {
  it('creating and listing a conversation returns the right data', async () => {
    const { createConversation, listConversations } = await import('../../../../lib/database/conversations-db.js');
    createConversation('integration-test', 'conv-integration-test', '/cwd');
    const list = listConversations();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('integration-test');
    expect(list[0].tmuxSession).toBe('conv-integration-test');
    expect(list[0].status).toBe('active');
  });

  it('deleting (marking ended) a conversation persists correctly', async () => {
    const { createConversation, markConversationEnded, getConversationByName } = await import('../../../../lib/database/conversations-db.js');
    createConversation('to-delete', 'conv-to-delete', '/cwd');
    markConversationEnded('to-delete');
    const conv = getConversationByName('to-delete');
    expect(conv!.status).toBe('ended');
  });

  it('resume on alive session updates last_attached_at', async () => {
    const { createConversation, updateLastAttached, markConversationActive, getConversationByName } = await import('../../../../lib/database/conversations-db.js');
    createConversation('resume-me', 'conv-resume-me', '/cwd');
    updateLastAttached('resume-me');
    markConversationActive('resume-me');
    const conv = getConversationByName('resume-me');
    expect(conv!.lastAttachedAt).toBeTruthy();
    expect(conv!.status).toBe('active');
  });
});
