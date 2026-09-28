/**
 * PAN-4312: getConversationMessagesRead derives contextUsage from the parse
 * result it already has instead of re-parsing the session file a second time
 * via computeContextUsage.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

const TEST_HOME = mkdtempSync(join(tmpdir(), 'pan-4312-messages-read-'));
process.env.OVERDECK_HOME = TEST_HOME;

const computeContextUsageMock = vi.hoisted(() => vi.fn());
const parseConversationMessagesMock = vi.hoisted(() => vi.fn());

vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));
vi.mock('../claude-session-file-search.js', () => ({
  findClaudeSessionFileById: vi.fn(async () => sessionFile),
}));
vi.mock('../../../dashboard/server/services/conversation-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../dashboard/server/services/conversation-service.js')>();
  return {
    ...actual,
    computeContextUsage: computeContextUsageMock,
    parseConversationMessages: parseConversationMessagesMock,
  };
});

const { createConversation } = await import('../conversations.js');
const { closeOverdeckDatabase } = await import('../infra.js');
const { getConversationMessagesRead } = await import('../conversation-reads.js');

const deps = {
  resolveSessionFile: async () => sessionFile,
  shouldReportUnresolvedLiveSession: () => false,
};

const sessionFile = join(TEST_HOME, 'messages-read-fixture.jsonl');
writeFileSync(sessionFile, '');

function fixtureParseResult() {
  return {
    messages: [],
    workLog: [],
    byteOffset: 0,
    streaming: false,
    totalCost: 0,
    totalTokens: 0,
    latestAssistantUsage: {
      lastInputTokens: 1000,
      lastCacheReadTokens: 200,
      lastCacheCreationTokens: 50,
      maxObservedInputTokens: 1000,
      lastModel: 'claude-sonnet-5',
      lastTimestamp: '2026-06-02T00:00:00.000Z',
    },
    contextBoundaryOffset: 0,
    contextActiveBytes: 4096,
    pendingToolUse: new Map(),
    unresolvedResults: new Map(),
    lastSequence: 0,
    mtimeMs: 0,
  };
}

afterAll(() => {
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('getConversationMessagesRead contextUsage', () => {
  it('derives contextUsage from the parse result without calling computeContextUsage', async () => {
    createConversation({ name: 'messages-read-ctx', tmuxSession: 'conv-messages-read-ctx', cwd: TEST_HOME, title: 'messages-read-ctx', model: 'claude-sonnet-5' });
    parseConversationMessagesMock.mockResolvedValueOnce(fixtureParseResult());
    computeContextUsageMock.mockClear();

    const res = await getConversationMessagesRead('messages-read-ctx', deps);
    const body = res.body as { contextUsage: { activeBytes: number; lastInputTokens: number } | null };

    expect(body.contextUsage).toEqual(expect.objectContaining({ activeBytes: 4096, lastInputTokens: 1000 }));
    expect(computeContextUsageMock).not.toHaveBeenCalled();
  });

  it('returns contextUsage null for an unregistered session file', async () => {
    parseConversationMessagesMock.mockResolvedValueOnce(fixtureParseResult());
    computeContextUsageMock.mockClear();

    // No conversation row exists for this name, but it matches the bare Claude
    // session UUID pattern, so resolveUnregisteredClaudeSessionFile (mocked
    // findClaudeSessionFileById) resolves it to sessionFile.
    const res = await getConversationMessagesRead('11111111-2222-4333-8444-555555555555', deps);
    const body = res.body as { contextUsage: unknown };

    expect(body.contextUsage).toBeNull();
  });
});
