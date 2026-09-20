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
  getAgentWorkspace: vi.fn(() => Effect.succeed('/workspace/feature-pan-473')),
  getAgentJsonlPath: vi.fn(),
  getPendingQuestions: vi.fn(),
  getAgentPendingQuestions: vi.fn(),
}));

vi.mock('../../services/conversation-service.js', () => ({
  parseEntireConversation: vi.fn(),
}));

vi.mock('../../services/pi-conversation-parser.js', () => ({
  parsePiConversationMessages: vi.fn(),
  isPiSessionFile: vi.fn(() => false),
}));

vi.mock('../../services/ohmypi-conversation-parser.js', () => ({
  parseOhmypiConversationMessages: vi.fn(),
}));

vi.mock('../../services/codex-conversation-parser.js', () => ({
  parseCodexConversationMessages: vi.fn(),
}));

vi.mock('../../services/acp-conversation-parser.js', () => ({
  parseAcpConversationMessages: vi.fn(),
}));

vi.mock('../../../../lib/agents/transcript-resolver.js', () => ({
  listAgentTranscriptCandidates: vi.fn(() => Promise.resolve([])),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, access: vi.fn(() => Promise.resolve()) };
});


// ─── Import after mocks ───────────────────────────────────────────────────────

import { buildAgentConversationResult, buildConversationResponse } from '../agents.js';
import { getAgentWorkspace } from '../../../../lib/agent-enrichment.js';
import { parseEntireConversation } from '../../services/conversation-service.js';
import { parsePiConversationMessages } from '../../services/pi-conversation-parser.js';
import { parseOhmypiConversationMessages } from '../../services/ohmypi-conversation-parser.js';
import { parseCodexConversationMessages } from '../../services/codex-conversation-parser.js';
import { parseAcpConversationMessages } from '../../services/acp-conversation-parser.js';
import {
  listAgentTranscriptCandidates,
} from '../../../../lib/agents/transcript-resolver.js';
import { access } from 'node:fs/promises';

const mockGetAgentWorkspace = vi.mocked(getAgentWorkspace);
const mockParseEntireConversation = vi.mocked(parseEntireConversation);
const mockParsePiConversationMessages = vi.mocked(parsePiConversationMessages);
const mockParseOhmypiConversationMessages = vi.mocked(parseOhmypiConversationMessages);
const mockParseCodexConversationMessages = vi.mocked(parseCodexConversationMessages);
const mockParseAcpConversationMessages = vi.mocked(parseAcpConversationMessages);
const mockListAgentTranscriptCandidates = vi.mocked(listAgentTranscriptCandidates);
const mockAccess = vi.mocked(access);

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
    mockGetAgentWorkspace.mockReturnValue(Effect.succeed('/workspace/feature-pan-473'));
    mockListAgentTranscriptCandidates.mockResolvedValue([]);
    mockAccess.mockResolvedValue(undefined);
  });

  // ── claude-code (default harness) ─────────────────────────────────────────

  it('returns empty result when the shared resolver returns null', async () => {

    const result = await buildConversationResponse('agent-PAN-473');

    expect(result).toEqual(EMPTY);
    expect(mockParseEntireConversation).not.toHaveBeenCalled();
  });

  it('parses messages and forces streaming: false when file exists', async () => {
    const jsonlPath = '/some/path/session.jsonl';
    mockListAgentTranscriptCandidates.mockResolvedValue([{ kind: 'claude', path: jsonlPath }]);
    mockAccess.mockResolvedValue(undefined);
    mockParseEntireConversation.mockResolvedValue({
      messages: [{ role: 'user', content: 'hello' } as never],
      ...PARSE_RESULT_BASE,
    });

    const result = await buildConversationResponse('agent-PAN-473');

    expect(mockParseEntireConversation).toHaveBeenCalledWith(jsonlPath);
    expect(result.messages).toHaveLength(1);
    expect(result.streaming).toBe(false);
    expect(result.totalCost).toBe(0.42);
    expect(result.byteOffset).toBe(1024);
  });

  it('returns empty result and logs error when parseEntireConversation throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockListAgentTranscriptCandidates.mockResolvedValue([{ kind: 'claude', path: '/some/path/session.jsonl' }]);
    mockAccess.mockResolvedValue(undefined);
    mockParseEntireConversation.mockRejectedValue(new Error('corrupt JSONL'));

    const result = await buildConversationResponse('agent-PAN-473');

    expect(result).toEqual(EMPTY);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[conversation] failed for',
      'agent-PAN-473',
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('uses the path chosen by the shared session resolver', async () => {
    const indexedPath = '/claude/projects/workspace/indexed.jsonl';
    mockListAgentTranscriptCandidates.mockResolvedValue([{ kind: 'claude', path: indexedPath }]);
    mockParseEntireConversation.mockResolvedValue({
      messages: [{ role: 'assistant', content: 'indexed session' } as never],
      ...PARSE_RESULT_BASE,
    });

    const result = await buildConversationResponse('agent-PAN-473');

    expect(mockParseEntireConversation).toHaveBeenCalledWith(indexedPath);
    expect(result.messages).toHaveLength(1);
    expect(result.streaming).toBe(false);
  });

  it('resolves an older indexed transcript for a stopped agent when the newest is missing', async () => {
    const newer = '/claude/projects/workspace/newer.jsonl';
    const older = '/claude/projects/workspace/older.jsonl';
    mockListAgentTranscriptCandidates.mockResolvedValue([
      { kind: 'claude', path: newer },
      { kind: 'claude', path: older },
    ]);
    mockAccess.mockImplementation((path) => path === older
      ? Promise.resolve()
      : Promise.reject(new Error('ENOENT')));
    mockParseEntireConversation.mockResolvedValue({
      messages: [{ role: 'assistant', content: 'preserved history' } as never],
      ...PARSE_RESULT_BASE,
    });

    const result = await buildAgentConversationResult('agent-PAN-473-stopped');

    expect(result.status).toBe(200);
    expect(mockParseEntireConversation).toHaveBeenCalledWith(older);
  });

  it('returns every indexed candidate in the explicit 404 body', async () => {
    const paths = ['/claude/projects/workspace/newer.jsonl', '/claude/projects/workspace/older.jsonl'];
    mockListAgentTranscriptCandidates.mockResolvedValue(paths.map((path) => ({ kind: 'claude' as const, path })));
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await buildAgentConversationResult('agent-PAN-473');
    expect(result).toMatchObject({ status: 404, body: { error: 'No transcript found for agent-PAN-473.' } });
    expect(result.status === 404 ? result.body.checked : []).toEqual(paths);
  });

  // ── ohmypi harness (PAN-2012) ─────────────────────────────────────────────────

  it('routes ohmypi agents through parseOhmypiConversationMessages', async () => {
    const piPath = '/home/testuser/.overdeck/agents/agent-PAN-473/2026-06-23T10:00:00_abc.jsonl';
    mockListAgentTranscriptCandidates.mockResolvedValue([{ kind: 'ohmypi', path: piPath }]);
    mockAccess.mockResolvedValue(undefined);
    mockParseOhmypiConversationMessages.mockResolvedValue({
      messages: [{ role: 'assistant', content: 'Starting — how can I help you?' } as never],
      ...PARSE_RESULT_BASE,
    });

    const result = await buildConversationResponse('agent-PAN-473');

    expect(mockParseOhmypiConversationMessages).toHaveBeenCalledWith(piPath);
    expect(mockParseEntireConversation).not.toHaveBeenCalled();
    expect(result.messages).toHaveLength(1);
    expect(result.streaming).toBe(false);
  });

  it('returns empty for ohmypi agent when session file not found', async () => {
    const result = await buildConversationResponse('agent-PAN-473');

    expect(result).toEqual(EMPTY);
    expect(mockParseOhmypiConversationMessages).not.toHaveBeenCalled();
  });

  it('routes recorded pi agents through parsePiConversationMessages', async () => {
    const piPath = '/home/testuser/.overdeck/agents/agent-PAN-473/2026-06-23T10:00:00_abc.jsonl';
    mockListAgentTranscriptCandidates.mockResolvedValue([{ kind: 'pi', path: piPath }]);
    mockAccess.mockResolvedValue(undefined);
    mockParsePiConversationMessages.mockResolvedValue({
      messages: [{ role: 'assistant', content: 'Starting — how can I help you?' } as never],
      ...PARSE_RESULT_BASE,
    });

    const result = await buildConversationResponse('agent-PAN-473');

    expect(mockParsePiConversationMessages).toHaveBeenCalledWith(piPath);
    expect(mockParseOhmypiConversationMessages).not.toHaveBeenCalled();
    expect(mockParseEntireConversation).not.toHaveBeenCalled();
    expect(result.messages).toHaveLength(1);
    expect(result.streaming).toBe(false);
  });

  // ── codex harness ─────────────────────────────────────────────────────────

  it('routes codex agents through parseCodexConversationMessages', async () => {
    const codexPath = '/home/testuser/.overdeck/agents/agent-PAN-473/codex-home/sessions/rollout.jsonl';
    mockListAgentTranscriptCandidates.mockResolvedValue([{ kind: 'codex', path: codexPath }]);
    mockAccess.mockResolvedValue(undefined);
    mockParseCodexConversationMessages.mockResolvedValue({
      messages: [{ role: 'assistant', content: 'codex response' } as never],
      ...PARSE_RESULT_BASE,
    });

    const result = await buildConversationResponse('agent-PAN-473');

    expect(mockParseCodexConversationMessages).toHaveBeenCalledWith(codexPath);
    expect(mockParseEntireConversation).not.toHaveBeenCalled();
    expect(result.messages).toHaveLength(1);
    expect(result.streaming).toBe(false);
  });

  it('returns empty for codex agent when rollout not found', async () => {
    const result = await buildConversationResponse('agent-PAN-473');

    expect(result).toEqual(EMPTY);
    expect(mockParseCodexConversationMessages).not.toHaveBeenCalled();
  });

  // ── ACP harness ───────────────────────────────────────────────────────────

  it('routes ACP agents through the native parser and finalizes assistant messages', async () => {
    const acpPath = '/home/testuser/.overdeck/agents/agent-PAN-473/acp-session.jsonl';
    mockListAgentTranscriptCandidates.mockResolvedValue([{ kind: 'acp', path: acpPath }]);
    mockAccess.mockResolvedValue(undefined);
    mockParseAcpConversationMessages.mockResolvedValue({
      messages: [{
        id: 'acp-assistant-1',
        role: 'assistant',
        text: 'ACP response',
        createdAt: '2026-07-18T00:00:00.000Z',
        streaming: true,
      }],
      ...PARSE_RESULT_BASE,
    } as never);

    const result = await buildConversationResponse('agent-PAN-473');

    expect(mockParseAcpConversationMessages).toHaveBeenCalledWith(acpPath);
    expect(mockParseEntireConversation).not.toHaveBeenCalled();
    expect(result.messages).toEqual([expect.objectContaining({
      role: 'assistant',
      text: 'ACP response',
      completedAt: '2026-07-18T00:00:00.000Z',
      streaming: false,
    })]);
    expect(result.streaming).toBe(false);
  });

  it('returns empty for ACP agent when transcript not found', async () => {
    const result = await buildConversationResponse('agent-PAN-473');

    expect(result).toEqual(EMPTY);
    expect(mockParseAcpConversationMessages).not.toHaveBeenCalled();
  });
});
