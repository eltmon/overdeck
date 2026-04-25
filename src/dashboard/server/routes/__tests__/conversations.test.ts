/**
 * Tests for conversations route helpers.
 *
 * The route itself is an Effect layer and not straightforwardly unit-testable
 * without the full Effect runtime. We test the extracted helper logic and the
 * database-integration behavior through the conversations-db module.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
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
  it('stores uploaded images under the owning conversation attachment directory', async () => {
    const { createConversation } = await import('../../../../lib/database/conversations-db.js');
    const { handleConversationImageUpload } = await import('../conversations.js');
    const { getConversationAttachmentDir } = await import('../../services/conversation-attachments.js');

    createConversation({ name: 'upload-test', tmuxSession: 'conv-upload-test', cwd: '/cwd' });

    const bytes = Buffer.from([137, 80, 78, 71]);
    const response = await handleConversationImageUpload('upload-test', 'evidence.txt', bytes, 'image/png');

    const body = decodeJsonResponse(response);
    expect(response.status).toBe(200);
    expect(body.path).toEqual(expect.stringMatching(new RegExp(`${getConversationAttachmentDir('upload-test').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.+\\.png$`)));
    expect(readFileSync(body.path as string)).toEqual(Buffer.from([137, 80, 78, 71]));
  });

  it('rejects unsupported mimeType before writing files', async () => {
    const { createConversation } = await import('../../../../lib/database/conversations-db.js');
    const { handleConversationImageUpload } = await import('../conversations.js');

    createConversation({ name: 'upload-test', tmuxSession: 'conv-upload-test', cwd: '/cwd' });

    const response = await handleConversationImageUpload('upload-test', 'evidence.png', Buffer.from([0]), 'image/tiff');

    expect(response.status).toBe(400);
    expect(decodeJsonResponse(response)).toEqual({ error: 'Unsupported mimeType: image/tiff' });
  });

  it('rejects magic-byte mismatch for valid mimeType', async () => {
    const { createConversation } = await import('../../../../lib/database/conversations-db.js');
    const { handleConversationImageUpload } = await import('../conversations.js');

    createConversation({ name: 'upload-test', tmuxSession: 'conv-upload-test', cwd: '/cwd' });

    // Valid PNG mimeType but content bytes are JPEG magic numbers, not PNG
    const response = await handleConversationImageUpload(
      'upload-test',
      'fake.png',
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      'image/png',
    );

    expect(response.status).toBe(400);
    expect(decodeJsonResponse(response)).toEqual({
      error: 'File content does not match declared MIME type',
    });
  });

  it('rejects oversized upload payloads before writing files', async () => {
    const { createConversation } = await import('../../../../lib/database/conversations-db.js');
    const { handleConversationImageUpload } = await import('../conversations.js');

    createConversation({ name: 'upload-test', tmuxSession: 'conv-upload-test', cwd: '/cwd' });

    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
    const response = await handleConversationImageUpload('upload-test', 'oversized.png', oversized, 'image/png');

    expect(response.status).toBe(400);
    expect(decodeJsonResponse(response)).toEqual({ error: 'Payload exceeds maximum size of 5242880 bytes' });
  });

  it('rejects empty upload payloads', async () => {
    const { createConversation } = await import('../../../../lib/database/conversations-db.js');
    const { handleConversationImageUpload } = await import('../conversations.js');

    createConversation({ name: 'upload-test', tmuxSession: 'conv-upload-test', cwd: '/cwd' });

    const response = await handleConversationImageUpload('upload-test', 'empty.png', Buffer.alloc(0), 'image/png');

    expect(response.status).toBe(400);
    expect(decodeJsonResponse(response)).toEqual({ error: 'Payload is empty' });
  });

  it('rejects attachment reuse across conversations while preserving referenced uploads', async () => {
    const { createConversation } = await import('../../../../lib/database/conversations-db.js');
    const { handleConversationImageUpload, handleConversationMessage } = await import('../conversations.js');

    createConversation({ name: 'owner-conv', tmuxSession: 'conv-owner-conv', cwd: '/cwd' });
    createConversation({ name: 'other-conv', tmuxSession: 'conv-other-conv', cwd: '/cwd' });

    const bytes = Buffer.from([137, 80, 78, 71]);
    const uploadResponse = await handleConversationImageUpload('owner-conv', 'owned.png', bytes, 'image/png');
    const uploadedPath = decodeJsonResponse(uploadResponse).path as string;

    const { extractConversationAttachmentPaths, hasConversationAttachment } = await import('../../services/conversation-attachments.js');
    expect(extractConversationAttachmentPaths(`hello\n@${uploadedPath}`)).toEqual([uploadedPath]);
    expect(await hasConversationAttachment('owner-conv', uploadedPath)).toBe(true);
    expect(await hasConversationAttachment('other-conv', uploadedPath)).toBe(false);

    // Prose @paths (unmanaged) are allowed to pass through
    const manualPath = '/home/eltmon/Projects/panopticon-cli/README.md';
    const proseDelivery = vi.fn().mockResolvedValue(undefined);
    const proseResponse = await handleConversationMessage('owner-conv', { message: `hello\n@${manualPath}` }, proseDelivery);
    expect(proseResponse.status).toBe(200);
    expect(proseDelivery).toHaveBeenCalledWith('conv-owner-conv', `hello\n@${manualPath}`, 'conversation-message');

    const delivery = vi.fn().mockResolvedValue(undefined);
    const sendResponse = await handleConversationMessage('owner-conv', { message: `hello\n@${uploadedPath}` }, delivery);
    expect(sendResponse.status).toBe(200);
    expect(delivery).toHaveBeenCalledWith('conv-owner-conv', `hello\n@${uploadedPath}`, 'conversation-message');
    expect(existsSync(uploadedPath)).toBe(true);

    const rejectedResponse = await handleConversationMessage('other-conv', { message: `hello\n@${uploadedPath}` }, delivery);
    expect(rejectedResponse.status).toBe(400);
    expect(decodeJsonResponse(rejectedResponse)).toEqual({ error: 'One or more attached images are unavailable for this conversation' });
    expect(existsSync(uploadedPath)).toBe(true);
  });

  it('delete-image removes only conversation-owned uploads', async () => {
    const { createConversation } = await import('../../../../lib/database/conversations-db.js');
    const { handleConversationImageUpload } = await import('../conversations.js');
    const { removeConversationAttachment } = await import('../../services/conversation-attachments.js');

    createConversation({ name: 'owner-conv', tmuxSession: 'conv-owner-conv', cwd: '/cwd' });
    createConversation({ name: 'other-conv', tmuxSession: 'conv-other-conv', cwd: '/cwd' });

    const bytes = Buffer.from([137, 80, 78, 71]);
    const uploadResponse = await handleConversationImageUpload('owner-conv', 'owned.png', bytes, 'image/png');
    const uploadedPath = decodeJsonResponse(uploadResponse).path as string;

    expect(await removeConversationAttachment('other-conv', uploadedPath)).toBe(false);
    expect(existsSync(uploadedPath)).toBe(true);

    expect(await removeConversationAttachment('owner-conv', uploadedPath)).toBe(true);
    expect(existsSync(uploadedPath)).toBe(false);
  });

  it('ended and archived cleanup preserve unsent uploads newer than session history', async () => {
    const { createConversation, updateSessionFile, markConversationEnded, archiveConversation } = await import('../../../../lib/database/conversations-db.js');
    const { handleConversationImageUpload } = await import('../conversations.js');
    const { cleanupUnreferencedConversationAttachments } = await import('../../services/conversation-attachments.js');

    createConversation({ name: 'unsent-conv', tmuxSession: 'conv-unsent-conv', cwd: '/cwd' });

    const sessionFile = join(TEST_HOME, 'unsent-session.jsonl');
    writeFileSync(sessionFile, `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'existing history' }] } })}\n`);
    updateSessionFile('unsent-conv', sessionFile);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const bytes = Buffer.from([137, 80, 78, 71]);
    const uploadResponse = await handleConversationImageUpload('unsent-conv', 'draft.png', bytes, 'image/png');
    const uploadedPath = decodeJsonResponse(uploadResponse).path as string;

    markConversationEnded('unsent-conv');
    await cleanupUnreferencedConversationAttachments({ name: 'unsent-conv', sessionFile });
    expect(existsSync(uploadedPath)).toBe(true);

    archiveConversation('unsent-conv');
    await cleanupUnreferencedConversationAttachments({ name: 'unsent-conv', sessionFile });
    expect(existsSync(uploadedPath)).toBe(true);
  });

  it('archive prunes unreferenced uploads while preserving prose-first referenced ones', async () => {
    const { createConversation, updateSessionFile, markConversationEnded, archiveConversation } = await import('../../../../lib/database/conversations-db.js');
    const { handleConversationImageUpload } = await import('../conversations.js');
    const { cleanupUnreferencedConversationAttachments } = await import('../../services/conversation-attachments.js');

    createConversation({ name: 'archived-conv', tmuxSession: 'conv-archived-conv', cwd: '/cwd' });

    const sessionFile = join(TEST_HOME, 'archived-session.jsonl');
    updateSessionFile('archived-conv', sessionFile);

    const bytes = Buffer.from([137, 80, 78, 71]);
    const keptUpload = await handleConversationImageUpload('archived-conv', 'kept.png', bytes, 'image/png');
    const prunedUpload = await handleConversationImageUpload('archived-conv', 'pruned.png', bytes, 'image/png');

    const keptPath = decodeJsonResponse(keptUpload).path as string;
    const prunedPath = decodeJsonResponse(prunedUpload).path as string;
    writeFileSync(sessionFile, `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: `keep this\n@${keptPath}` }] } })}\n`);
    // Explicitly set the session file mtime to be strictly newer than both
    // attachments so the >= comparison reliably prunes the unreferenced one.
    const keptStat = statSync(keptPath);
    const prunedStat = statSync(prunedPath);
    const newestAttachmentMtime = Math.max(keptStat.mtimeMs, prunedStat.mtimeMs);
    utimesSync(sessionFile, newestAttachmentMtime / 1000 + 1, newestAttachmentMtime / 1000 + 1);

    markConversationEnded('archived-conv');
    archiveConversation('archived-conv');
    await cleanupUnreferencedConversationAttachments({ name: 'archived-conv', sessionFile });

    expect(existsSync(keptPath)).toBe(true);
    expect(existsSync(prunedPath)).toBe(false);
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

// ─── validateOrigin unit tests ────────────────────────────────────────────────

function getTrustedOrigins(): string[] {
  return ['http://localhost:3011', 'http://localhost:3000', 'http://127.0.0.1:3011', 'http://127.0.0.1:3000'];
}

function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function validateOrigin(headers: Record<string, string | undefined>): { ok: true } | { ok: false; error: string } {
  const origin = headers['origin'];
  const referer = headers['referer'];
  const trusted = getTrustedOrigins();

  if (origin) {
    const normalized = normalizeOrigin(origin);
    if (normalized && trusted.includes(normalized)) {
      return { ok: true };
    }
    return { ok: false, error: 'Invalid origin' };
  }

  if (referer) {
    const normalized = normalizeOrigin(referer);
    if (normalized && trusted.includes(normalized)) {
      return { ok: true };
    }
    return { ok: false, error: 'Invalid referer' };
  }

  return { ok: false, error: 'Missing origin' };
}

describe('validateOrigin', () => {
  it('accepts matching Origin header', () => {
    expect(validateOrigin({ origin: 'http://localhost:3000' })).toEqual({ ok: true });
  });

  it('accepts matching Referer header', () => {
    expect(validateOrigin({ referer: 'http://localhost:3000/' })).toEqual({ ok: true });
  });

  it('rejects untrusted Origin', () => {
    expect(validateOrigin({ origin: 'https://evil.com' })).toEqual({ ok: false, error: 'Invalid origin' });
  });

  it('rejects untrusted Referer', () => {
    expect(validateOrigin({ referer: 'https://evil.com/' })).toEqual({ ok: false, error: 'Invalid referer' });
  });

  it('rejects prefix-match origin attack', () => {
    expect(validateOrigin({ origin: 'https://evil.com/?origin=http://localhost:3000' })).toEqual({ ok: false, error: 'Invalid origin' });
  });

  it('rejects requests with neither Origin nor Referer', () => {
    expect(validateOrigin({})).toEqual({ ok: false, error: 'Missing origin' });
  });
});
