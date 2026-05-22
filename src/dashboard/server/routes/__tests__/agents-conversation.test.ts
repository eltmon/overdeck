import { Effect } from 'effect';
/**
 * Tests for the GET /api/agents/:id/conversation route helper.
 *
 * The route itself is an Effect layer and not straightforwardly unit-testable
 * without the full Effect runtime. We test `buildConversationResponse`, the
 * extracted async helper that contains all of the branching logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../../../lib/agent-enrichment.js', () => ({
  getClaudeProjectDir: vi.fn(),
  getActiveSessionPath: vi.fn(),
  getAgentWorkspace: vi.fn(),
  getAgentJsonlPath: vi.fn(),
  getPendingQuestions: vi.fn(),
  getAgentPendingQuestions: vi.fn(),
}));

vi.mock('../../services/conversation-service.js', () => ({
  parseConversationMessages: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});

// ─── Import after mocks ───────────────────────────────────────────────────────

import { buildConversationResponse } from '../agents.js';
import { getAgentJsonlPath } from '../../../../lib/agent-enrichment.js';
import { parseConversationMessages } from '../../services/conversation-service.js';
import { existsSync } from 'node:fs';

const mockGetAgentJsonlPath = vi.mocked(getAgentJsonlPath);
const mockParseConversationMessages = vi.mocked(parseConversationMessages);
const mockExistsSync = vi.mocked(existsSync);

const EMPTY = { messages: [], workLog: [], streaming: false, totalCost: 0, byteOffset: 0 };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildConversationResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result when getAgentJsonlPath resolves null', async () => {
    (await Effect.runPromise(mockGetAgentJsonlPath.mockResolvedValue(null)));

    const result = await buildConversationResponse('agent-PAN-473');

    expect(result).toEqual(EMPTY);
    expect(mockParseConversationMessages).not.toHaveBeenCalled();
  });

  it('returns empty result when the JSONL file does not exist on disk', async () => {
    (await Effect.runPromise(mockGetAgentJsonlPath.mockResolvedValue('/some/path/session.jsonl')));
    mockExistsSync.mockReturnValue(false);

    const result = await buildConversationResponse('agent-PAN-473');

    expect(result).toEqual(EMPTY);
    expect(mockParseConversationMessages).not.toHaveBeenCalled();
  });

  it('parses messages and forces streaming: false when file exists', async () => {
    const jsonlPath = '/some/path/session.jsonl';
    (await Effect.runPromise(mockGetAgentJsonlPath.mockResolvedValue(jsonlPath)));
    mockExistsSync.mockReturnValue(true);
    mockParseConversationMessages.mockResolvedValue({
      messages: [{ role: 'user', content: 'hello' } as never],
      workLog: [],
      streaming: true, // parser sees it as still streaming — we must override this
      totalCost: 0.42,
      byteOffset: 1024,
      pendingToolUse: new Map(),
      unresolvedResults: new Map(),
      lastSequence: 0,
      mtimeMs: 0,
    });

    const result = await buildConversationResponse('agent-PAN-473');

    expect(mockParseConversationMessages).toHaveBeenCalledWith(jsonlPath);
    expect(result.messages).toHaveLength(1);
    expect(result.streaming).toBe(false); // always forced false for stopped agents
    expect(result.totalCost).toBe(0.42);
    expect(result.byteOffset).toBe(1024);
  });

  it('returns empty result and logs error when parseConversationMessages throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (await Effect.runPromise(mockGetAgentJsonlPath.mockResolvedValue('/some/path/session.jsonl')));
    mockExistsSync.mockReturnValue(true);
    mockParseConversationMessages.mockRejectedValue(new Error('corrupt JSONL'));

    const result = await buildConversationResponse('agent-PAN-473');

    expect(result).toEqual(EMPTY);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[conversation] failed for',
      'agent-PAN-473',
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
