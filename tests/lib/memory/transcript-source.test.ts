import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listRunningAgents: vi.fn((): unknown[] => []),
  listLiveAgentIds: vi.fn(async (): Promise<ReadonlySet<string> | null> => new Set<string>()),
}));

vi.mock('../../../src/lib/agents.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/lib/agents.js')>(),
  listRunningAgents: () => Effect.sync(() => mocks.listRunningAgents()),
}));

// Fake terminal backend: the live inventory the default agent lister reads (#4109).
vi.mock('../../../src/lib/terminal-backends/inventory.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/lib/terminal-backends/inventory.js')>(),
  listLiveAgentIds: mocks.listLiveAgentIds,
}));
import {
  ClaudeCodeTranscriptSource,
  PiTranscriptSource,
  TranscriptSourceRegistry,
  getActiveTranscriptEntries,
  type TranscriptSource,
} from '../../../src/lib/memory/transcript-source.js';
import type { AgentState } from '../../../src/lib/agents.js';

function agent(overrides: Partial<AgentState & { hasLivePane: boolean }> = {}): AgentState & { hasLivePane: boolean } {
  return {
    id: 'agent-pan-1052',
    issueId: 'PAN-1052',
    workspace: '/repo/overdeck/workspaces/feature-pan-1052',
    harness: 'claude-code',
    role: 'work',
    model: 'claude-sonnet-4-6',
    status: 'running',
    startedAt: '2026-05-16T20:00:00.000Z',
    sessionId: 'session-from-state',
    branch: 'feature/pan-1052',
    hasLivePane: true,
    ...overrides,
  };
}

function jsonl(entry: unknown): string {
  return `${JSON.stringify(entry)}\n`;
}

describe('ClaudeCodeTranscriptSource', () => {
  it('resolves active Claude Code transcripts from agent session metadata', async () => {
    const source = new ClaudeCodeTranscriptSource({
      listAgents: async () => [agent()],
      resolveSessionId: (candidate) => candidate.sessionId ?? null,
      resolveTranscriptPath: (workspace, sessionId) => `${workspace}/.claude/${sessionId}.jsonl`,
      statTranscript: async () => ({ size: 123, mtimeMs: 456 }),
    });

    expect(await source.getActiveTranscripts()).toEqual([{
      agentId: 'agent-pan-1052',
      sessionId: 'session-from-state',
      transcriptPath: '/repo/overdeck/workspaces/feature-pan-1052/.claude/session-from-state.jsonl',
      identity: {
        projectId: 'overdeck',
        workspaceId: 'feature-pan-1052',
        issueId: 'PAN-1052',
        runId: 'agent-pan-1052',
        sessionId: 'session-from-state',
        agentRole: 'work',
        agentHarness: 'claude-code',
      },
      harness: 'claude-code',
      size: 123,
      mtimeMs: 456,
    }]);
  });

  it('uses the shared authoritative session resolver', async () => {
    const source = new ClaudeCodeTranscriptSource({
      listAgents: async () => [agent({ sessionId: undefined })],
      resolveSessionId: () => 'indexed-session',
      resolveTranscriptPath: (workspace, sessionId) => `${workspace}/${sessionId}.jsonl`,
      statTranscript: async () => ({ size: 10, mtimeMs: 20 }),
    });

    expect((await source.getActiveTranscripts())[0]?.sessionId).toBe('indexed-session');
  });

  it('ignores inactive, missing, non-Claude, and subagent sessions', async () => {
    const source = new ClaudeCodeTranscriptSource({
      listAgents: async () => [
        agent({ id: 'agent-inactive', hasLivePane: false }),
        agent({ id: 'agent-stopped', status: 'stopped' }),
        agent({ id: 'agent-pi', harness: 'ohmypi' }),
        agent({ id: 'agent-review', role: 'review' }),
        agent({ id: 'agent-missing', sessionId: undefined }),
        agent({ id: 'agent-subagent', sessionId: 'subagent-session' }),
      ],
      resolveSessionId: (candidate) => candidate.sessionId ?? null,
      resolveTranscriptPath: (workspace, sessionId) => `${workspace}/${sessionId}.jsonl`,
      statTranscript: async () => ({ size: 10, mtimeMs: 20 }),
      isSubagentSession: (sessionId) => sessionId === 'subagent-session',
    });

    expect(await source.getActiveTranscripts()).toEqual([]);
  });

  it('excludes Claude Code Explore subagent transcripts from the production poller source', async () => {
    const source = new ClaudeCodeTranscriptSource({
      listAgents: async () => [agent({ id: 'agent-explore', sessionId: 'explore-agent' })],
      resolveSessionId: (candidate) => candidate.sessionId ?? null,
      resolveTranscriptPath: (workspace, sessionId) => `${workspace}/.claude/session-main/subagents/${sessionId}.jsonl`,
      statTranscript: async () => {
        throw new Error('subagent transcript should be filtered before stat');
      },
    });

    expect(await source.getActiveTranscripts()).toEqual([]);
  });

  it('parses JSONL deltas into compressed turn events', () => {
    const source = new ClaudeCodeTranscriptSource();
    const line = jsonl({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'ship it' }] } });

    expect(source.parseDelta(`${line}{"partial"`, 100)).toEqual([{
      compressedText: 'U: ship it',
      eventsConsumed: 1,
      lastFullLineOffset: 100 + Buffer.byteLength(line, 'utf8'),
    }]);
  });
});

describe('default agent lister liveness (#4109)', () => {
  const herdrAgent = { ...agent({ id: 'agent-herdr' }), hasLivePane: undefined, tmuxActive: false };
  const source = () => new ClaudeCodeTranscriptSource({
    resolveSessionId: (candidate) => candidate.sessionId ?? null,
    resolveTranscriptPath: (workspace, sessionId) => `${workspace}/${sessionId}.jsonl`,
    statTranscript: async () => ({ size: 1, mtimeMs: 2 }),
    isSubagentSession: () => false,
  });

  it('includes a live Herdr agent (tmuxActive false) the backend inventory lists', async () => {
    mocks.listRunningAgents.mockReturnValue([herdrAgent]);
    mocks.listLiveAgentIds.mockResolvedValue(new Set(['agent-herdr']));

    expect((await source().getActiveTranscripts()).map((entry) => entry.agentId)).toEqual(['agent-herdr']);
  });

  it('excludes an agent absent from the backend inventory', async () => {
    mocks.listRunningAgents.mockReturnValue([{ ...herdrAgent, tmuxActive: true }]);
    mocks.listLiveAgentIds.mockResolvedValue(new Set());

    expect(await source().getActiveTranscripts()).toEqual([]);
  });

  it('falls back to running rows when the backend inventory is unreadable', async () => {
    mocks.listRunningAgents.mockReturnValue([herdrAgent]);
    mocks.listLiveAgentIds.mockResolvedValue(null);

    expect((await source().getActiveTranscripts()).map((entry) => entry.agentId)).toEqual(['agent-herdr']);
  });
});

describe('PiTranscriptSource', () => {
  it('resolves active Pi work-agent transcripts from Pi session metadata', async () => {
    const source = new PiTranscriptSource({
      listAgents: async () => [
        agent({ id: 'agent-pi', harness: 'ohmypi', sessionId: 'pi-session' }),
        agent({ id: 'agent-claude', harness: 'claude-code', sessionId: 'claude-session' }),
      ],
      readSessionId: async (candidate) => candidate.sessionId ?? null,
      resolveTranscriptPath: async (_agent, sessionId) => `/tmp/${sessionId}.jsonl`,
      statTranscript: async () => ({ size: 123, mtimeMs: 456 }),
    });

    expect(await source.getActiveTranscripts()).toEqual([{
      agentId: 'agent-pi',
      sessionId: 'pi-session',
      transcriptPath: '/tmp/pi-session.jsonl',
      identity: {
        projectId: 'overdeck',
        workspaceId: 'feature-pan-1052',
        issueId: 'PAN-1052',
        runId: 'agent-pi',
        sessionId: 'pi-session',
        agentRole: 'work',
        agentHarness: 'ohmypi',
      },
      harness: 'ohmypi',
      size: 123,
      mtimeMs: 456,
    }]);
  });

  it('parses Pi-format deltas with the shared Pi transcript extractor', () => {
    const source = new PiTranscriptSource();
    const complete = [
      jsonl({ type: 'session', id: 'pi-session' }),
      jsonl({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'fix memory ingestion' }] } }),
      jsonl({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'updated transcript-source' }, { type: 'toolCall', name: 'edit' }] } }),
    ].join('');

    expect(source.parseDelta(`${complete}{"partial"`, 100)).toEqual([{
      compressedText: 'U: fix memory ingestion\nA: updated transcript-source\n[tool_use: edit]',
      eventsConsumed: 2,
      lastFullLineOffset: 100 + Buffer.byteLength(complete, 'utf8'),
    }]);
  });
});

describe('TranscriptSourceRegistry', () => {
  it('lets poller-facing code collect active transcripts without harness branches', async () => {
    const customSource: TranscriptSource = {
      harness: 'custom',
      getActiveTranscripts: async () => [{
        agentId: 'agent-custom',
        sessionId: 'session-custom',
        transcriptPath: '/tmp/custom.jsonl',
        identity: {
          projectId: 'project',
          workspaceId: 'workspace',
          issueId: 'PAN-1052',
          runId: 'agent-custom',
          sessionId: 'session-custom',
          agentRole: 'work',
          agentHarness: 'custom',
        },
        harness: 'custom',
        size: 1,
        mtimeMs: 2,
      }],
      parseDelta: () => [],
    };
    const registry = new TranscriptSourceRegistry();
    registry.register(customSource);

    expect(await getActiveTranscriptEntries(registry)).toEqual(await customSource.getActiveTranscripts());
  });
});
