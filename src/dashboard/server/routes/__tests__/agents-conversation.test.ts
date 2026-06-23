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
  getAgentWorkspace: vi.fn(() => Effect.succeed('/workspace/feature-pan-473')),
  getAgentJsonlPath: vi.fn(),
  getPendingQuestions: vi.fn(),
  getAgentPendingQuestions: vi.fn(),
}));

vi.mock('../../services/conversation-service.js', () => ({
  parseConversationMessages: vi.fn(),
}));

vi.mock('../../services/pi-conversation-parser.js', () => ({
  parsePiConversationMessages: vi.fn(),
  isPiSessionFile: vi.fn(() => false),
}));

vi.mock('../../services/codex-conversation-parser.js', () => ({
  parseCodexConversationMessages: vi.fn(),
}));

vi.mock('../jsonl-resolver.js', () => ({
  resolveAgentHarness: vi.fn(() => Promise.resolve(null)),
  readLauncherPinnedSessionId: vi.fn(() => Promise.resolve(null)),
  resolvePiSessionPath: vi.fn(() => Promise.resolve(null)),
  resolveCodexRolloutPath: vi.fn(() => Promise.resolve(null)),
  resolveClaudeSessionId: vi.fn(() => Promise.resolve(null)),
  resolveJsonlPath: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});


// ─── Import after mocks ───────────────────────────────────────────────────────

import { buildConversationResponse } from '../agents.js';
import { getAgentJsonlPath, getAgentWorkspace } from '../../../../lib/agent-enrichment.js';
import { parseConversationMessages } from '../../services/conversation-service.js';
import { parsePiConversationMessages } from '../../services/pi-conversation-parser.js';
import { parseCodexConversationMessages } from '../../services/codex-conversation-parser.js';
import { resolveAgentHarness, readLauncherPinnedSessionId, resolvePiSessionPath, resolveCodexRolloutPath } from '../jsonl-resolver.js';
import { existsSync } from 'node:fs';

const mockGetAgentJsonlPath = vi.mocked(getAgentJsonlPath);
const mockGetAgentWorkspace = vi.mocked(getAgentWorkspace);
const mockParseConversationMessages = vi.mocked(parseConversationMessages);
const mockParsePiConversationMessages = vi.mocked(parsePiConversationMessages);
const mockParseCodexConversationMessages = vi.mocked(parseCodexConversationMessages);
const mockResolveAgentHarness = vi.mocked(resolveAgentHarness);
const mockReadLauncherPinnedSessionId = vi.mocked(readLauncherPinnedSessionId);
const mockResolvePiSessionPath = vi.mocked(resolvePiSessionPath);
const mockResolveCodexRolloutPath = vi.mocked(resolveCodexRolloutPath);
const mockExistsSync = vi.mocked(existsSync);

const EMPTY = { messages: [], workLog: [], streaming: false, totalCost: 0, byteOffset: 0 };

const PARSE_RESULT_BASE = {
  workLog: [],
  streaming: true,
  totalCost: 0.42,
  byteOffset: 1024,
  pendingToolUse: new Map(),
  unresolvedResults: new Map(),
  lastSequence: 0,
  mtimeMs: 0,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildConversationResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAgentHarness.mockResolvedValue(null);
    mockReadLauncherPinnedSessionId.mockResolvedValue(null);
    mockGetAgentWorkspace.mockReturnValue(Effect.succeed('/workspace/feature-pan-473'));
  });

  // ── claude-code (default harness) ─────────────────────────────────────────

  it('returns empty result when getAgentJsonlPath resolves null', async () => {
    mockGetAgentJsonlPath.mockReturnValue(Effect.succeed(null));

    const result = await buildConversationResponse('agent-PAN-473');

    expect(result).toEqual(EMPTY);
    expect(mockParseConversationMessages).not.toHaveBeenCalled();
  });

  it('returns empty result when the JSONL file does not exist on disk', async () => {
    mockGetAgentJsonlPath.mockReturnValue(Effect.succeed('/some/path/session.jsonl'));
    mockExistsSync.mockReturnValue(false);

    const result = await buildConversationResponse('agent-PAN-473');

    expect(result).toEqual(EMPTY);
    expect(mockParseConversationMessages).not.toHaveBeenCalled();
  });

  it('parses messages and forces streaming: false when file exists', async () => {
    const jsonlPath = '/some/path/session.jsonl';
    mockGetAgentJsonlPath.mockReturnValue(Effect.succeed(jsonlPath));
    mockExistsSync.mockReturnValue(true);
    mockParseConversationMessages.mockResolvedValue({
      messages: [{ role: 'user', content: 'hello' } as never],
      ...PARSE_RESULT_BASE,
    });

    const result = await buildConversationResponse('agent-PAN-473');

    expect(mockParseConversationMessages).toHaveBeenCalledWith(jsonlPath);
    expect(result.messages).toHaveLength(1);
    expect(result.streaming).toBe(false);
    expect(result.totalCost).toBe(0.42);
    expect(result.byteOffset).toBe(1024);
  });

  it('returns empty result and logs error when parseConversationMessages throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetAgentJsonlPath.mockReturnValue(Effect.succeed('/some/path/session.jsonl'));
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

  // ── launcher-pinned session ID (PAN-2011) ─────────────────────────────────

  it('uses launcher-pinned session ID when available, bypassing mtime pick', async () => {
    const pinnedId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    mockReadLauncherPinnedSessionId.mockResolvedValue(pinnedId);
    // existsSync returns true for the pinned path (contains the UUID), false otherwise
    mockExistsSync.mockImplementation((p: unknown) => typeof p === 'string' && p.includes(pinnedId));
    mockParseConversationMessages.mockResolvedValue({
      messages: [{ role: 'assistant', content: 'pinned session' } as never],
      ...PARSE_RESULT_BASE,
    });

    const result = await buildConversationResponse('agent-PAN-473');

    expect(mockParseConversationMessages).toHaveBeenCalledWith(expect.stringContaining(pinnedId));
    expect(mockGetAgentJsonlPath).not.toHaveBeenCalled();
    expect(result.messages).toHaveLength(1);
    expect(result.streaming).toBe(false);
  });

  it('falls back to mtime-based pick when launcher has no pinned ID', async () => {
    const mtimePath = '/some/mtime/session.jsonl';
    mockReadLauncherPinnedSessionId.mockResolvedValue(null);
    mockGetAgentJsonlPath.mockReturnValue(Effect.succeed(mtimePath));
    mockExistsSync.mockReturnValue(true);
    mockParseConversationMessages.mockResolvedValue({
      messages: [],
      ...PARSE_RESULT_BASE,
    });

    await buildConversationResponse('agent-PAN-473');

    expect(mockGetAgentJsonlPath).toHaveBeenCalled();
    expect(mockParseConversationMessages).toHaveBeenCalledWith(mtimePath);
  });

  it('falls back to mtime-based pick when pinned file does not exist on disk', async () => {
    const pinnedId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const mtimePath = '/some/mtime/session.jsonl';
    mockReadLauncherPinnedSessionId.mockResolvedValue(pinnedId);
    // pinned path does not exist; mtime path does
    mockExistsSync.mockImplementation((p: unknown) => p === mtimePath);
    mockGetAgentJsonlPath.mockReturnValue(Effect.succeed(mtimePath));
    mockParseConversationMessages.mockResolvedValue({ messages: [], ...PARSE_RESULT_BASE });

    await buildConversationResponse('agent-PAN-473');

    expect(mockGetAgentJsonlPath).toHaveBeenCalled();
    expect(mockParseConversationMessages).toHaveBeenCalledWith(mtimePath);
  });

  // ── pi harness (PAN-2012) ─────────────────────────────────────────────────

  it('routes pi agents through parsePiConversationMessages', async () => {
    const piPath = '/home/testuser/.overdeck/agents/agent-PAN-473/2026-06-23T10:00:00_abc.jsonl';
    mockResolveAgentHarness.mockResolvedValue('pi');
    mockResolvePiSessionPath.mockResolvedValue(piPath);
    mockExistsSync.mockReturnValue(true);
    mockParsePiConversationMessages.mockResolvedValue({
      messages: [{ role: 'assistant', content: 'Starting — how can I help you?' } as never],
      ...PARSE_RESULT_BASE,
    });

    const result = await buildConversationResponse('agent-PAN-473');

    expect(mockParsePiConversationMessages).toHaveBeenCalledWith(piPath);
    expect(mockParseConversationMessages).not.toHaveBeenCalled();
    expect(result.messages).toHaveLength(1);
    expect(result.streaming).toBe(false);
  });

  it('returns empty for pi agent when session file not found', async () => {
    mockResolveAgentHarness.mockResolvedValue('pi');
    mockResolvePiSessionPath.mockResolvedValue(null);

    const result = await buildConversationResponse('agent-PAN-473');

    expect(result).toEqual(EMPTY);
    expect(mockParsePiConversationMessages).not.toHaveBeenCalled();
  });

  // ── codex harness ─────────────────────────────────────────────────────────

  it('routes codex agents through parseCodexConversationMessages', async () => {
    const codexPath = '/home/testuser/.overdeck/agents/agent-PAN-473/codex-home/sessions/rollout.jsonl';
    mockResolveAgentHarness.mockResolvedValue('codex');
    mockResolveCodexRolloutPath.mockResolvedValue(codexPath);
    mockExistsSync.mockReturnValue(true);
    mockParseCodexConversationMessages.mockResolvedValue({
      messages: [{ role: 'assistant', content: 'codex response' } as never],
      ...PARSE_RESULT_BASE,
    });

    const result = await buildConversationResponse('agent-PAN-473');

    expect(mockParseCodexConversationMessages).toHaveBeenCalledWith(codexPath);
    expect(mockParseConversationMessages).not.toHaveBeenCalled();
    expect(result.messages).toHaveLength(1);
    expect(result.streaming).toBe(false);
  });

  it('returns empty for codex agent when rollout not found', async () => {
    mockResolveAgentHarness.mockResolvedValue('codex');
    mockResolveCodexRolloutPath.mockResolvedValue(null);

    const result = await buildConversationResponse('agent-PAN-473');

    expect(result).toEqual(EMPTY);
    expect(mockParseCodexConversationMessages).not.toHaveBeenCalled();
  });
});
