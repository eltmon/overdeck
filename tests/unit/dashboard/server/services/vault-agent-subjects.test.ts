import { describe, expect, it, vi } from 'vitest';
import type { AgentState } from '../../../../../src/lib/agents/agent-state-read.js';
import {
  AGENT_LIST_TTL_MS,
  AGENT_TRACK_AFTER_STOP_MS,
  createPipelineAgentSubjectLister,
  isInTrackingWindow,
  pipelineAgentRecordTitle,
} from '../../../../../src/dashboard/server/services/vault-agent-subjects.js';
import type { TranscriptCandidate } from '../../../../../src/lib/session-history.js';

function state(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-1',
    issueId: 'PAN-1',
    workspace: '/w/pan-1',
    role: 'work',
    model: 'claude-fable-5-1',
    status: 'running',
    ...overrides,
  } as AgentState;
}

describe('createPipelineAgentSubjectLister', () => {
  it('running work agent with a claude transcript becomes a subject', async () => {
    const lister = createPipelineAgentSubjectLister({
      listStates: () => Promise.resolve([state()]),
      resolveTranscript: () => Promise.resolve({ kind: 'claude', path: '/t/a.jsonl' }),
      now: () => 0,
    });
    const subjects = await lister();
    expect(subjects).toEqual([
      { name: 'agent:agent-pan-1:/t/a.jsonl', harness: 'claude-code', transcriptPath: '/t/a.jsonl', recordTitle: 'PAN-1 work agent (agent-pan-1)', agentId: 'agent-pan-1' },
    ]);
  });

  it('codex candidate maps to harness codex', async () => {
    const lister = createPipelineAgentSubjectLister({
      listStates: () => Promise.resolve([state()]),
      resolveTranscript: () => Promise.resolve({ kind: 'codex', path: '/t/a.jsonl' }),
      now: () => 0,
    });
    const subjects = await lister();
    expect(subjects).toHaveLength(1);
    expect(subjects[0]!.harness).toBe('codex');
  });

  it('a pi/kimi candidate yields no subject', async () => {
    const pi = createPipelineAgentSubjectLister({
      listStates: () => Promise.resolve([state()]),
      resolveTranscript: () => Promise.resolve({ kind: 'pi', path: '/t/a' } as TranscriptCandidate),
      now: () => 0,
    });
    expect(await pi()).toEqual([]);

    const kimi = createPipelineAgentSubjectLister({
      listStates: () => Promise.resolve([state()]),
      resolveTranscript: () => Promise.resolve({ kind: 'kimi', path: '/t/a' } as TranscriptCandidate),
      now: () => 0,
    });
    expect(await kimi()).toEqual([]);
  });

  it('a null candidate yields no subject', async () => {
    const lister = createPipelineAgentSubjectLister({
      listStates: () => Promise.resolve([state()]),
      resolveTranscript: () => Promise.resolve(null),
      now: () => 0,
    });
    expect(await lister()).toEqual([]);
  });

  it('empty issueId title', async () => {
    const lister = createPipelineAgentSubjectLister({
      listStates: () => Promise.resolve([state({ id: 'flywheel-1', issueId: '', role: 'flywheel' })]),
      resolveTranscript: () => Promise.resolve({ kind: 'claude', path: '/t/f.jsonl' }),
      now: () => 0,
    });
    const subjects = await lister();
    expect(subjects[0]!.recordTitle).toBe('flywheel agent (flywheel-1)');
  });

  it('scan is cached for ttlMs', async () => {
    const listStates = vi.fn().mockResolvedValue([state()]);
    let nowMs = 0;
    const lister = createPipelineAgentSubjectLister({
      listStates,
      resolveTranscript: () => Promise.resolve({ kind: 'claude', path: '/t/a.jsonl' }),
      now: () => nowMs,
    });
    await lister();
    nowMs = 59_000;
    await lister();
    expect(listStates).toHaveBeenCalledTimes(1);
    nowMs = 61_000;
    await lister();
    expect(listStates).toHaveBeenCalledTimes(2);
  });

  it('a rejecting resolveTranscript drops only that agent and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lister = createPipelineAgentSubjectLister({
      listStates: () => Promise.resolve([state({ id: 'agent-a' }), state({ id: 'agent-b' })]),
      resolveTranscript: (agentId) => agentId === 'agent-a'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ kind: 'claude', path: '/t/b.jsonl' }),
      now: () => 0,
    });
    const subjects = await lister();
    expect(subjects).toEqual([
      { name: 'agent:agent-b:/t/b.jsonl', harness: 'claude-code', transcriptPath: '/t/b.jsonl', recordTitle: 'PAN-1 work agent (agent-b)', agentId: 'agent-b' },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[vault] agent subjects: boom');
    warn.mockRestore();
  });

  it('a rejecting listStates yields no subjects for a scan failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lister = createPipelineAgentSubjectLister({
      listStates: () => Promise.reject(new Error('readdir failed')),
      now: () => 0,
    });
    expect(await lister()).toEqual([]);
    expect(warn).toHaveBeenCalledWith('[vault] agent subjects: readdir failed');
    warn.mockRestore();
  });
});

describe('pipelineAgentRecordTitle', () => {
  it('includes the issue id when set', () => {
    expect(pipelineAgentRecordTitle({ id: 'a1', issueId: 'PAN-1', role: 'work' })).toBe('PAN-1 work agent (a1)');
  });

  it('drops the issue id when blank', () => {
    expect(pipelineAgentRecordTitle({ id: 'flywheel-1', issueId: '', role: 'flywheel' })).toBe('flywheel agent (flywheel-1)');
  });
});

describe('isInTrackingWindow', () => {
  const nowMs = 1_000_000_000;

  it('a running agent is always in', () => {
    expect(isInTrackingWindow({ status: 'running', stoppedAt: undefined, lastActivity: undefined }, nowMs)).toBe(true);
  });

  it('a starting agent is always in', () => {
    expect(isInTrackingWindow({ status: 'starting', stoppedAt: undefined, lastActivity: undefined }, nowMs)).toBe(true);
  });

  it('stopped 29 minutes ago is in', () => {
    const stoppedAt = new Date(nowMs - (29 * 60_000)).toISOString();
    expect(isInTrackingWindow({ status: 'stopped', stoppedAt, lastActivity: undefined }, nowMs)).toBe(true);
  });

  it('stopped 31 minutes ago is out', () => {
    const stoppedAt = new Date(nowMs - (31 * 60_000)).toISOString();
    expect(isInTrackingWindow({ status: 'stopped', stoppedAt, lastActivity: undefined }, nowMs)).toBe(false);
  });

  it('error status with lastActivity 5 minutes ago is in', () => {
    const lastActivity = new Date(nowMs - (5 * 60_000)).toISOString();
    expect(isInTrackingWindow({ status: 'error', stoppedAt: undefined, lastActivity }, nowMs)).toBe(true);
  });

  it('stopped with neither timestamp is out', () => {
    expect(isInTrackingWindow({ status: 'stopped', stoppedAt: undefined, lastActivity: undefined }, nowMs)).toBe(false);
  });

  it('the boundary constant is 30 minutes', () => {
    expect(AGENT_TRACK_AFTER_STOP_MS).toBe(30 * 60_000);
  });

  it('the default ttl is 60 seconds', () => {
    expect(AGENT_LIST_TTL_MS).toBe(60_000);
  });
});
