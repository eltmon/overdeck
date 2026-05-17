import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeTranscriptSource,
  PiTranscriptSource,
  TranscriptSourceRegistry,
  getActiveTranscriptEntries,
  type TranscriptSource,
} from '../../../src/lib/memory/transcript-source.js';
import type { AgentState } from '../../../src/lib/agents.js';

function agent(overrides: Partial<AgentState & { tmuxActive: boolean }> = {}): AgentState & { tmuxActive: boolean } {
  return {
    id: 'agent-pan-1052',
    issueId: 'PAN-1052',
    workspace: '/repo/panopticon-cli/workspaces/feature-pan-1052',
    harness: 'claude-code',
    role: 'work',
    model: 'claude-sonnet-4-6',
    status: 'running',
    startedAt: '2026-05-16T20:00:00.000Z',
    sessionId: 'session-from-state',
    branch: 'feature/pan-1052',
    tmuxActive: true,
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
      getRuntimeState: async () => ({ claudeSessionId: 'runtime-session' }),
      resolveTranscriptPath: (workspace, sessionId) => `${workspace}/.claude/${sessionId}.jsonl`,
      statTranscript: async () => ({ size: 123, mtimeMs: 456 }),
    });

    expect(await source.getActiveTranscripts()).toEqual([{
      agentId: 'agent-pan-1052',
      sessionId: 'session-from-state',
      transcriptPath: '/repo/panopticon-cli/workspaces/feature-pan-1052/.claude/session-from-state.jsonl',
      identity: {
        projectId: 'panopticon-cli',
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

  it('falls back to runtime claudeSessionId when state has no sessionId', async () => {
    const source = new ClaudeCodeTranscriptSource({
      listAgents: async () => [agent({ sessionId: undefined })],
      getRuntimeState: async () => ({ claudeSessionId: 'runtime-session' }),
      resolveTranscriptPath: (workspace, sessionId) => `${workspace}/${sessionId}.jsonl`,
      statTranscript: async () => ({ size: 10, mtimeMs: 20 }),
    });

    expect((await source.getActiveTranscripts())[0]?.sessionId).toBe('runtime-session');
  });

  it('ignores inactive, missing, non-Claude, and subagent sessions', async () => {
    const source = new ClaudeCodeTranscriptSource({
      listAgents: async () => [
        agent({ id: 'agent-inactive', tmuxActive: false }),
        agent({ id: 'agent-stopped', status: 'stopped' }),
        agent({ id: 'agent-pi', harness: 'pi' }),
        agent({ id: 'agent-review', role: 'review' }),
        agent({ id: 'agent-missing', sessionId: undefined }),
        agent({ id: 'agent-subagent', sessionId: 'subagent-session' }),
      ],
      getRuntimeState: async () => null,
      resolveTranscriptPath: (workspace, sessionId) => `${workspace}/${sessionId}.jsonl`,
      statTranscript: async () => ({ size: 10, mtimeMs: 20 }),
      isSubagentSession: (sessionId) => sessionId === 'subagent-session',
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

describe('PiTranscriptSource', () => {
  it('is a no-op until the pi transcript surface is defined', async () => {
    const source = new PiTranscriptSource();

    expect(await source.getActiveTranscripts()).toEqual([]);
    expect(source.parseDelta(jsonl({ type: 'user' }))).toEqual([]);
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
