/**
 * Unit tests for the PATCH /api/conversations/:name route behavior.
 *
 * These tests exercise the extracted route logic used by the real PATCH handler,
 * so broken request-body parsing cannot silently regress while a simulated copy
 * of the handler still passes.
 *
 * Business rules under test:
 *   - Unknown conversation name → 404 (handler skips update)
 *   - Empty or whitespace-only title → update is skipped
 *   - Valid title → stored with title_source='manual'
 *   - title_source='manual' blocks AI auto-overwrite (canReplaceTitle=false)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { patchConversationTitle } from '../../src/dashboard/server/routes/conversations.js';

let TEST_HOME: string;

async function resetDb() {
  const { closeOverdeckDatabaseSync } = await import('../../src/lib/overdeck/infra.js');
  closeOverdeckDatabaseSync();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-596-patch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.OVERDECK_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.OVERDECK_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PATCH /api/conversations/:name', () => {
  it('returns 404 when the conversation does not exist', async () => {
    const result = await patchConversationTitle('no-such-conv', { title: 'New Title' });
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: 'Conversation not found' });
  });

  it('returns success and stores the title with title_source=manual', async () => {
    const { createConversation, getConversationByName } = await import(
      '../../src/lib/overdeck/conversations.js'
    );
    createConversation({ name: 'my-conv', tmuxSession: 'my-sess', cwd: '/home/user' });

    const result = await patchConversationTitle('my-conv', { title: 'My New Title' });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true });

    const updated = getConversationByName('my-conv')!;
    expect(updated.title).toBe('My New Title');
    expect(updated.titleSource).toBe('manual');
  });

  it('trims whitespace from the title before storing', async () => {
    const { createConversation, getConversationByName } = await import(
      '../../src/lib/overdeck/conversations.js'
    );
    createConversation({ name: 'trim-conv', tmuxSession: 'trim-sess', cwd: '/home/user' });

    await patchConversationTitle('trim-conv', { title: '  Trimmed Title  ' });

    const updated = getConversationByName('trim-conv')!;
    expect(updated.title).toBe('Trimmed Title');
  });

  it('skips the update when title is an empty string', async () => {
    const { createConversation, getConversationByName } = await import(
      '../../src/lib/overdeck/conversations.js'
    );
    createConversation({
      name: 'empty-conv',
      tmuxSession: 'empty-sess',
      cwd: '/home/user',
      title: 'Original',
      titleSource: 'auto',
    });

    await patchConversationTitle('empty-conv', { title: '' });

    const unchanged = getConversationByName('empty-conv')!;
    expect(unchanged.title).toBe('Original'); // not modified
    expect(unchanged.titleSource).toBe('auto');
  });

  it('skips the update when title is whitespace only', async () => {
    const { createConversation, getConversationByName } = await import(
      '../../src/lib/overdeck/conversations.js'
    );
    createConversation({
      name: 'ws-conv',
      tmuxSession: 'ws-sess',
      cwd: '/home/user',
      title: 'Original',
      titleSource: 'auto',
    });

    await patchConversationTitle('ws-conv', { title: '   ' });

    const unchanged = getConversationByName('ws-conv')!;
    expect(unchanged.title).toBe('Original');
    expect(unchanged.titleSource).toBe('auto');
  });

  it('skips the update when title field is missing from body', async () => {
    const { createConversation, getConversationByName } = await import(
      '../../src/lib/overdeck/conversations.js'
    );
    createConversation({
      name: 'no-title-conv',
      tmuxSession: 'no-title-sess',
      cwd: '/home/user',
      title: 'Original',
      titleSource: 'auto',
    });

    await patchConversationTitle('no-title-conv', {});

    const unchanged = getConversationByName('no-title-conv')!;
    expect(unchanged.title).toBe('Original');
  });

  it('manual title_source prevents AI from overwriting (canReplaceTitle=false)', async () => {
    const { createConversation, getConversationByName, canReplaceTitle } = await import(
      '../../src/lib/overdeck/conversations.js'
    );
    createConversation({
      name: 'ai-conv',
      tmuxSession: 'ai-sess',
      cwd: '/home/user',
      title: 'Auto Title',
      titleSource: 'auto',
    });

    // Before manual rename — AI can replace auto titles
    expect(canReplaceTitle(getConversationByName('ai-conv')!)).toBe(true);

    // After the PATCH route updates with 'manual' source
    await patchConversationTitle('ai-conv', { title: 'User Chosen Title' });

    // AI must no longer overwrite it
    expect(canReplaceTitle(getConversationByName('ai-conv')!)).toBe(false);
  });
});
