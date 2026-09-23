/**
 * PAN-3920 W2 — `GET /api/agents/:id/conversation?subagentId=` and
 * `GET /api/agents/:id/subagents`, tested through their async helpers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/agent-enrichment.js', () => ({
  getClaudeProjectDir: vi.fn(),
  getAgentWorkspace: vi.fn(async () => '/workspace/feature-pan-1'),
  getAgentJsonlPath: vi.fn(),
  getPendingQuestions: vi.fn(),
  getAgentPendingQuestions: vi.fn(),
}));

vi.mock('../../services/conversation-service.js', () => ({
  parseEntireConversation: vi.fn(async () => ({
    messages: [{ id: 'm1', role: 'assistant' }], workLog: [], streaming: true, totalCost: 0.25, byteOffset: 10,
  })),
}));

vi.mock('../../services/codex-conversation-parser.js', () => ({
  parseCodexConversationMessages: vi.fn(),
}));

const resolveAgentSubagentTranscript = vi.fn();
const listAgentSubagents = vi.fn();
vi.mock('../../services/agent-subagents.js', () => ({
  isSafeSubagentId: (id: string) => /^[A-Za-z0-9_-]+$/.test(id),
  resolveAgentSubagentTranscript: (...args: unknown[]) => resolveAgentSubagentTranscript(...args),
  listAgentSubagents: (...args: unknown[]) => listAgentSubagents(...args),
}));

import { buildAgentConversationResult, buildAgentSubagentsResult } from '../agents/conversation.js';

beforeEach(() => {
  resolveAgentSubagentTranscript.mockReset();
  listAgentSubagents.mockReset();
});

describe('buildAgentConversationResult with a subagentId', () => {
  it('answers 400 for an unsafe subagent id', async () => {
    const result = await buildAgentConversationResult('agent-x', { subagentId: 'bad/id' });
    expect(result.status).toBe(400);
    expect(resolveAgentSubagentTranscript).not.toHaveBeenCalled();
  });

  it('answers 404 when the agent has no such subagent', async () => {
    resolveAgentSubagentTranscript.mockResolvedValue(null);
    expect((await buildAgentConversationResult('agent-x', { subagentId: 'a1' })).status).toBe(404);
  });

  it('parses the subagent transcript and marks it not streaming', async () => {
    resolveAgentSubagentTranscript.mockResolvedValue({ kind: 'claude', path: '/t/agent-a1.jsonl' });
    const result = await buildAgentConversationResult('agent-x', { subagentId: 'a1' });
    expect(result.status).toBe(200);
    expect(resolveAgentSubagentTranscript).toHaveBeenCalledWith('agent-x', '/workspace/feature-pan-1', 'a1');
    if (result.status === 200) {
      expect(result.body.streaming).toBe(false);
      expect(result.body.totalCost).toBe(0.25);
    }
  });
});

describe('buildAgentSubagentsResult', () => {
  it('lists subagents without their server-side transcript paths', async () => {
    listAgentSubagents.mockResolvedValue([{
      agentId: 'a1', agentType: 'Explore', description: 'd', toolUseId: 't', spawnDepth: 1,
      status: 'done', transcriptPath: '/secret/path.jsonl', mtimeMs: 1,
    }]);
    const body = await buildAgentSubagentsResult('agent-x');
    expect(body.subagents).toEqual([{
      agentId: 'a1', agentType: 'Explore', description: 'd', toolUseId: 't', spawnDepth: 1, status: 'done', mtimeMs: 1,
    }]);
  });
});
