import { describe, expect, it, vi } from 'vitest';
import { isSubagentHookPayload } from '../../../src/lib/memory/subagent-filter.js';
import { handleMemorySessionStartBody, handleMemoryTurnBody, memoryTurnHookResponse } from '../../../src/dashboard/server/routes/hooks.js';

describe('memory subagent filter', () => {
  it('detects Claude Code subagent hook payloads by agent_id presence', () => {
    expect(isSubagentHookPayload({ agent_id: 'agent-abc', session_id: 'session-1' })).toBe(true);
    expect(isSubagentHookPayload({ agent_id: '  ' })).toBe(false);
    expect(isSubagentHookPayload({ session_id: 'session-1' })).toBe(false);
    expect(isSubagentHookPayload(null)).toBe(false);
  });

  it('returns 204 for memory turn hooks from subagents', () => {
    const response = memoryTurnHookResponse({ agent_id: 'agent-abc', session_id: 'session-1' });

    expect(response?.status).toBe(204);
  });

  it('lets primary-agent memory turn hooks continue to the pipeline', () => {
    expect(memoryTurnHookResponse({ session_id: 'session-1' })).toBeNull();
  });

  it('accepts primary-agent turn hooks and enqueues the pipeline without awaiting extraction', async () => {
    const enqueuePipeline = vi.fn();
    const result = await handleMemoryTurnBody({
      session_id: 'session-1',
      transcript_path: '/tmp/session-1.jsonl',
      stop_hook_active: true,
      identity: {
        projectId: 'panopticon-cli',
        workspaceId: 'feature-pan-1052',
        issueId: 'PAN-1052',
        runId: 'run-1',
        agentRole: 'work',
        agentHarness: 'claude-code',
      },
    }, {
      getTranscriptCheckpoint: () => ({
        sessionId: 'session-1',
        projectId: 'panopticon-cli',
        workspaceId: 'feature-pan-1052',
        issueId: 'PAN-1052',
        transcriptPath: '/tmp/session-1.jsonl',
        lastOffset: 42,
        lastObservationAt: null,
        lastMidTurnAt: null,
        midTurnCountInCurrentTurn: 0,
        updatedAt: '2026-05-16T23:00:00.000Z',
      }),
      getTranscriptSize: async () => 120,
      enqueuePipeline,
    });

    expect(result.status).toBe('accepted');
    expect(enqueuePipeline).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      transcriptPath: '/tmp/session-1.jsonl',
      fromOffset: 42,
      toOffset: 120,
      trigger: 'stop-hook',
      identity: expect.objectContaining({
        projectId: 'panopticon-cli',
        sessionId: 'session-1',
      }),
    }));
  });

  it('skips primary-agent turn hooks when memory observations are disabled', async () => {
    const enqueuePipeline = vi.fn();
    const getTranscriptSize = vi.fn();

    const result = await handleMemoryTurnBody({
      session_id: 'session-1',
      transcript_path: '/tmp/session-1.jsonl',
      stop_hook_active: true,
    }, {
      areObservationsEnabled: () => false,
      getTranscriptSize,
      enqueuePipeline,
    });

    expect(result).toEqual({ status: 'disabled' });
    expect(getTranscriptSize).not.toHaveBeenCalled();
    expect(enqueuePipeline).not.toHaveBeenCalled();
  });

  it('returns 422 when primary-agent turn identity cannot be resolved', async () => {
    const result = await handleMemoryTurnBody({
      session_id: 'session-1',
      transcript_path: '/tmp/session-1.jsonl',
      stop_hook_active: true,
    }, {
      resolveIdentity: async () => null,
      getTranscriptSize: async () => 120,
      enqueuePipeline: vi.fn(),
    });

    expect(result).toEqual({
      status: 'error',
      statusCode: 422,
      error: 'memory identity could not be resolved',
    });
  });

  it('returns 400 for invalid turn hook payloads before enqueueing', async () => {
    const enqueuePipeline = vi.fn();

    const result = await handleMemoryTurnBody({
      session_id: 'session-1',
    }, { enqueuePipeline });

    expect(result).toEqual({
      status: 'error',
      statusCode: 400,
      error: 'invalid memory turn payload',
    });
    expect(enqueuePipeline).not.toHaveBeenCalled();
  });

  it('registers primary-agent session starts with the transcript poller', async () => {
    const registerTranscript = vi.fn();

    const result = await handleMemorySessionStartBody({
      session_id: 'session-1',
      transcript_path: '/tmp/session-1.jsonl',
      identity: {
        projectId: 'panopticon-cli',
        workspaceId: 'feature-pan-1052',
        issueId: 'PAN-1052',
        runId: 'run-1',
        agentRole: 'work',
        agentHarness: 'claude-code',
      },
    }, {
      statTranscript: async () => ({ size: 10, mtimeMs: 20 }),
      registerTranscript,
    });

    expect(result).toEqual({ status: 'accepted', sessionId: 'session-1' });
    expect(registerTranscript).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'run-1',
      sessionId: 'session-1',
      transcriptPath: '/tmp/session-1.jsonl',
      harness: 'claude-code',
      size: 10,
      mtimeMs: 20,
    }));
  });

  it('skips primary-agent session starts when memory observations are disabled', async () => {
    const statTranscript = vi.fn();
    const registerTranscript = vi.fn();

    const result = await handleMemorySessionStartBody({
      session_id: 'session-1',
      transcript_path: '/tmp/session-1.jsonl',
      identity: {
        projectId: 'panopticon-cli',
        workspaceId: 'feature-pan-1052',
        issueId: 'PAN-1052',
        runId: 'run-1',
        agentRole: 'work',
        agentHarness: 'claude-code',
      },
    }, {
      areObservationsEnabled: () => false,
      statTranscript,
      registerTranscript,
    });

    expect(result).toEqual({ status: 'disabled' });
    expect(statTranscript).not.toHaveBeenCalled();
    expect(registerTranscript).not.toHaveBeenCalled();
  });

  it('returns 204 for memory session starts from subagents', async () => {
    await expect(handleMemorySessionStartBody({
      agent_id: 'agent-abc',
      session_id: 'session-1',
      transcript_path: '/tmp/session-1.jsonl',
    })).resolves.toEqual({ status: 'subagent' });
  });
});
