import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Conversation,
  canRefineTitle,
  canReplaceTitle,
  createConversation,
  getConversationByName,
  updateConversationTitle,
  type LegacyConversation,
} from '../../../../src/lib/overdeck/conversations.js';

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-title-sources-test-'));
  process.env.OVERDECK_HOME = testHome;
});

afterEach(async () => {
  const { closeOverdeckDatabaseSync } = await import('../../../../src/lib/overdeck/infra.js');
  closeOverdeckDatabaseSync();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

function convWithSource(source: LegacyConversation['titleSource']): LegacyConversation {
  return {
    id: 1,
    name: 'test',
    tmuxSession: 'conv-test',
    status: 'active',
    cwd: '/tmp',
    issueId: null,
    createdAt: new Date().toISOString(),
    endedAt: null,
    lastAttachedAt: null,
    claudeSessionId: null,
    title: null,
    titleSource: source,
    titleSeed: null,
    totalCost: 0,
    totalTokens: 0,
    archivedAt: null,
    model: null,
    effort: null,
    forkStatus: null,
    forkError: null,
    harness: null,
    deliveryMethod: null,
  };
}

describe('canReplaceTitle', () => {
  it('returns true only for default and auto sources', () => {
    expect(canReplaceTitle(convWithSource('default'))).toBe(true);
    expect(canReplaceTitle(convWithSource('auto'))).toBe(true);
    expect(canReplaceTitle(convWithSource('ai'))).toBe(false);
    expect(canReplaceTitle(convWithSource('ai-refined'))).toBe(false);
    expect(canReplaceTitle(convWithSource('ai-explicit'))).toBe(false);
    expect(canReplaceTitle(convWithSource('manual'))).toBe(false);
    expect(canReplaceTitle(convWithSource(null))).toBe(false);
  });
});

describe('canRefineTitle', () => {
  it('returns true for default, auto, ai, and ai-refined sources', () => {
    expect(canRefineTitle(convWithSource('default'))).toBe(true);
    expect(canRefineTitle(convWithSource('auto'))).toBe(true);
    expect(canRefineTitle(convWithSource('ai'))).toBe(true);
    expect(canRefineTitle(convWithSource('ai-refined'))).toBe(true);
  });

  it('returns false for manual, ai-explicit, and null sources', () => {
    expect(canRefineTitle(convWithSource('manual'))).toBe(false);
    expect(canRefineTitle(convWithSource('ai-explicit'))).toBe(false);
    expect(canRefineTitle(convWithSource(null))).toBe(false);
  });
});

describe('TitleSource schema', () => {
  it.each(['ai-refined', 'ai-explicit'] as const)('decodes a conversation with title_source=%s', (titleSource) => {
    const decodeConversation = Schema.decodeUnknownSync(Conversation);

    expect(decodeConversation({
      id: 'conversation-id',
      name: 'schema-test',
      cwd: '/tmp',
      issueId: null,
      harness: null,
      model: null,
      effort: null,
      title: 'Generated title',
      titleSource,
      createdAt: new Date(),
      archivedAt: null,
      handoffDocPath: null,
      handoffTargetConvId: null,
      clearedToConvId: null,
      files: [],
    }).titleSource).toBe(titleSource);
  });
});

describe('retitleConversation source', () => {
  it('overrides a manual title and protects the explicit result from auto/refine passes', async () => {
    const { retitleConversation } = await import('../../../../src/lib/overdeck/conversation-reads.js');
    const transcriptSummary = await import('../../../../src/lib/conversations/transcript-summary.js');
    vi.spyOn(transcriptSummary, 'summarizeTranscriptTitle').mockResolvedValue('OAuth login bug fix');

    createConversation({ name: 'retitle-ai', tmuxSession: 'conv-retitle-ai', cwd: '/tmp' });
    updateConversationTitle('retitle-ai', 'My manual title', 'manual');
    const sessionFile = join(testHome, 'retitle-ai.jsonl');
    writeFileSync(sessionFile, JSON.stringify({ type: 'user', message: { content: 'Please help me fix the OAuth login bug' } }) + '\n');

    const result = await retitleConversation('retitle-ai', {
      resolveSessionFile: () => Promise.resolve(sessionFile),
    });

    // An omitted status is serialized by the route as HTTP 200.
    expect(result.status).toBeUndefined();
    expect(result.body).toEqual(expect.objectContaining({ title: 'OAuth login bug fix' }));
    const updated = getConversationByName('retitle-ai');
    expect(updated?.title).toBe('OAuth login bug fix');
    expect(updated?.titleSource).toBe('ai-explicit');
    expect(canReplaceTitle(updated!)).toBe(false);
    expect(canRefineTitle(updated!)).toBe(false);
  });

  it('persists title_source as ai-explicit when AI times out and deterministic fallback is used', async () => {
    const { retitleConversation } = await import('../../../../src/lib/overdeck/conversation-reads.js');
    const transcriptSummary = await import('../../../../src/lib/conversations/transcript-summary.js');
    vi.spyOn(transcriptSummary, 'summarizeTranscriptTitle').mockRejectedValue(
      new Error('claude invocation timed out after 90000ms'),
    );
    vi.spyOn(transcriptSummary, 'fallbackTranscriptTitle').mockReturnValue('Fallback title');

    createConversation({ name: 'retitle-fallback', tmuxSession: 'conv-retitle-fallback', cwd: '/tmp' });
    const sessionFile = join(testHome, 'retitle-fallback.jsonl');
    writeFileSync(sessionFile, JSON.stringify({ type: 'user', message: { content: 'Please help me fix the OAuth login bug' } }) + '\n');

    const result = await retitleConversation('retitle-fallback', {
      resolveSessionFile: () => Promise.resolve(sessionFile),
    });

    expect(result.body).toEqual(expect.objectContaining({ title: 'Fallback title' }));
    const updated = getConversationByName('retitle-fallback');
    expect(updated?.title).toBe('Fallback title');
    expect(updated?.titleSource).toBe('ai-explicit');
  });
});
