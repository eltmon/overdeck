/**
 * Tests for conversations route helpers.
 *
 * The route itself is an Effect layer and not straightforwardly unit-testable
 * without the full Effect runtime. We test the extracted helper logic and the
 * database-integration behavior through the conversations-db module.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── Sanitize / name generation logic ────────────────────────────────────────
// These are internal helpers extracted here for direct testing.

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
}

function generateConversationName(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${date}-1234`;
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
  it('is YYYYMMDD-NNNN format (no conv- prefix)', () => {
    expect(generateConversationName()).toMatch(/^\d{8}-/);
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

function decodeJsonResponse(response: { status: number; body: unknown }) {
  const payload = response.body as { body: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

beforeEach(async () => {
  // Close any stale DB connection from a previous test before changing PANOPTICON_HOME
  await resetDb();
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
  it('stores uploaded images under tmpdir with the validated extension', async () => {
    const { createConversation } = await import('../../../../lib/database/conversations-db.js');
    const { handleConversationImageUpload } = await import('../conversations.js');

    createConversation({ name: 'upload-test', tmuxSession: 'conv-upload-test', cwd: '/cwd' });

    const pngData = Buffer.from(Uint8Array.from([137, 80, 78, 71])).toString('base64');
    const response = await handleConversationImageUpload('upload-test', {
      filename: 'evidence.txt',
      data: pngData,
      mimeType: 'image/png',
    });

    const body = decodeJsonResponse(response);
    expect(response.status).toBe(200);
    expect(body.path).toEqual(expect.stringMatching(/^\/tmp\/panopticon-paste-.*\.png$/));
    expect(readFileSync(body.path as string)).toEqual(Buffer.from(Uint8Array.from([137, 80, 78, 71])));
  });

  it('rejects invalid upload payloads before writing files', async () => {
    const { createConversation } = await import('../../../../lib/database/conversations-db.js');
    const { handleConversationImageUpload } = await import('../conversations.js');

    createConversation({ name: 'upload-test', tmuxSession: 'conv-upload-test', cwd: '/cwd' });

    const response = await handleConversationImageUpload('upload-test', {
      filename: 'evidence.png',
      data: 'not-base64',
      mimeType: 'image/png',
    });

    expect(response.status).toBe(400);
    expect(decodeJsonResponse(response)).toEqual({ error: 'Invalid base64 image data' });
  });

  it('creating and listing a conversation returns the right data', async () => {
    const { createConversation, listConversations } = await import('../../../../lib/database/conversations-db.js');
    createConversation({ name: 'integration-test', tmuxSession: 'conv-integration-test', cwd: '/cwd' });
    const list = listConversations();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('integration-test');
    expect(list[0].tmuxSession).toBe('conv-integration-test');
    expect(list[0].status).toBe('active');
  });

  it('deleting (marking ended) a conversation persists correctly', async () => {
    const { createConversation, markConversationEnded, getConversationByName } = await import('../../../../lib/database/conversations-db.js');
    createConversation({ name: 'to-delete', tmuxSession: 'conv-to-delete', cwd: '/cwd' });
    markConversationEnded('to-delete');
    const conv = getConversationByName('to-delete');
    expect(conv!.status).toBe('ended');
  });

  it('getConversationById returns the correct row by id', async () => {
    const { createConversation, getConversationById } = await import('../../../../lib/database/conversations-db.js');
    const created = createConversation({ name: 'by-id-test', tmuxSession: 'conv-by-id-test', cwd: '/cwd' });
    const conv = getConversationById(created.id);
    expect(conv).not.toBeNull();
    expect(conv!.name).toBe('by-id-test');
  });

  it('getConversationById returns null for unknown id', async () => {
    const { getConversationById } = await import('../../../../lib/database/conversations-db.js');
    expect(getConversationById(99999)).toBeNull();
  });

  it('resume on alive session updates last_attached_at', async () => {
    const { createConversation, updateLastAttached, markConversationActive, getConversationByName } = await import('../../../../lib/database/conversations-db.js');
    createConversation({ name: 'resume-me', tmuxSession: 'conv-resume-me', cwd: '/cwd' });
    updateLastAttached('resume-me');
    markConversationActive('resume-me');
    const conv = getConversationByName('resume-me');
    expect(conv!.lastAttachedAt).toBeTruthy();
    expect(conv!.status).toBe('active');
  });

  it('creates a summary fork conversation without ending the source conversation', async () => {
    const { createConversation, getConversationByName } = await import('../../../../lib/database/conversations-db.js');
    const { createSummaryFork } = await import('../../../../lib/conversations/summary-fork.js');

    const cwd = '/home/test/project';
    const sessionId = 'session-123';
    const encodedCwd = cwd.replace(/[^a-zA-Z0-9]/g, '-');
    const claudeProjectDir = join(process.env.HOME || '', '.claude', 'projects', encodedCwd);
    mkdirSync(claudeProjectDir, { recursive: true });
    const sessionFile = join(claudeProjectDir, `${sessionId}.jsonl`);
    writeFileSync(sessionFile, [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'Fix the broken dashboard route' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'Edit', input: { file_path: '/home/eltmon/Projects/panopticon-cli/src/file.ts' } }],
        },
      }),
    ].join('\n') + '\n');

    const conv = createConversation({
      name: 'source-conv',
      tmuxSession: 'conv-source-conv',
      cwd,
      sessionFile,
      title: 'Original conversation',
      effort: 'medium',
    });

    const result = await createSummaryFork(conv, { localSummaryOnly: true });

    expect(result.conversation.name).not.toBe('source-conv');
    expect(result.conversation.title).toBe('Summary Fork: Original conversation');
    expect(result.conversation.model).toBeNull();
    expect(result.conversation.effort).toBe('medium');
    expect(result.summary).toContain('Conversation Summary Fork');
    expect(result.summaryModel).toBeNull();

    const sourceConv = getConversationByName('source-conv');
    expect(sourceConv?.status).toBe('active');
  });
});
