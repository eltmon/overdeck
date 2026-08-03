import { describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../../../lib/agents/agent-state.js';
import type { AgentRuntimeEventEvidence } from '../../../lib/overdeck/event-reads.js';
import type { AgentPlaneRecord } from '../../../lib/pan-dir/agents.js';
import {
  backfillAgentRuntimePlane,
  type AgentPlaneBackfillDeps,
} from '../admin/agent-state-backfill.js';

function state(id: string, issueId: string): AgentState {
  return {
    id,
    issueId,
    workspace: `/work/overdeck/workspaces/feature-${issueId.toLowerCase()}`,
    harness: 'claude-code',
    role: 'work',
    model: 'claude-opus-5',
    status: 'stopped',
    startedAt: '2026-08-01T10:00:00.000Z',
  };
}

function planeRecord(agent: AgentState): AgentPlaneRecord {
  return {
    version: 1,
    agentId: agent.id,
    issueId: agent.issueId,
    projectKey: 'panopticon-cli',
    role: 'work',
    origin: { machineId: 'origin', overdeckHome: '/home/origin/.overdeck' },
    launch: {
      harness: 'claude-code',
      model: agent.model ?? null,
      workspace: agent.workspace,
      branch: null,
    },
    sessions: [{ id: 'existing-session', startedAt: agent.startedAt, reason: 'spawn' }],
    lifecycle: [{ at: agent.startedAt, event: 'spawned' }],
    archiveRef: null,
    recovered: false,
  };
}

function deps(overrides: Partial<AgentPlaneBackfillDeps> = {}): AgentPlaneBackfillDeps {
  return {
    listLocalAgentIds: () => [],
    hasLocalState: () => false,
    hasRetainedMarker: vi.fn(async () => false),
    readAgentState: () => null,
    listDbAgents: () => [],
    listEventEvidence: () => [],
    readCurrentSessionId: () => null,
    readSessionHistory: () => [],
    readRuntimeSessionId: () => null,
    transcriptExists: () => false,
    resolveProject: (issueId) => ({
      projectKey: 'panopticon-cli',
      projectName: 'Overdeck',
      projectPath: '/work/overdeck',
      issueId,
    }),
    readPlaneRecord: () => null,
    writePlaneRecord: vi.fn(async () => true),
    flushPlaneWrites: vi.fn(async () => ({ committed: true, pushed: true })),
    log: vi.fn(),
    ...overrides,
  };
}

describe('agent runtime plane backfill', () => {
  it('combines live, reaped, and DB-only agent evidence', async () => {
    const live = state('agent-pan-3513', 'PAN-3513');
    const reaped = state('agent-pan-3514', 'PAN-3514');
    const dbOnly = state('agent-pan-3515', 'PAN-3515');
    const states = new Map([[live.id, live]]);
    const events: AgentRuntimeEventEvidence[] = [{
      agentId: reaped.id,
      issueId: reaped.issueId,
      role: reaped.role,
      workspace: reaped.workspace,
      model: reaped.model ?? null,
      branch: null,
      startedAt: reaped.startedAt,
      sessions: [{ id: 'reaped-event-session', startedAt: '2026-08-01T11:00:00.000Z' }],
    }];
    const writePlaneRecord = vi.fn(async () => true);
    const flushPlaneWrites = vi.fn(async () => ({ committed: true, pushed: true }));
    const result = await backfillAgentRuntimePlane({}, deps({
      listLocalAgentIds: () => [live.id, reaped.id],
      hasLocalState: (agentId) => agentId === live.id,
      hasRetainedMarker: vi.fn(async (agentId) => agentId === reaped.id),
      readAgentState: (agentId) => states.get(agentId) ?? null,
      listDbAgents: () => [
        { ...reaped, workspace: reaped.workspace, sessionId: null } as never,
        { ...dbOnly, workspace: dbOnly.workspace, sessionId: 'db-only-session' } as never,
      ],
      listEventEvidence: () => events,
      readCurrentSessionId: (agentId) => agentId === live.id ? 'live-session' : null,
      transcriptExists: (_workspace, sessionId) => [
        'live-session',
        'reaped-event-session',
        'db-only-session',
      ].includes(sessionId),
      writePlaneRecord,
      flushPlaneWrites,
    }));

    expect(result.map(({ agentId, status, sessions }) => ({ agentId, status, sessions }))).toEqual([
      { agentId: live.id, status: 'reconstructed', sessions: ['live-session'] },
      { agentId: reaped.id, status: 'recovered-partial', sessions: ['reaped-event-session'] },
      { agentId: dbOnly.id, status: 'recovered-partial', sessions: ['db-only-session'] },
    ]);
    expect(writePlaneRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: reaped.id, issueId: reaped.issueId }),
      [{ id: 'reaped-event-session', startedAt: '2026-08-01T11:00:00.000Z', reason: 'recovered' }],
      true,
      { deferCommit: true },
    );
    expect(writePlaneRecord).toHaveBeenCalledTimes(3);
    expect(flushPlaneWrites).toHaveBeenCalledTimes(1);
  });

  it('flushes an unchanged record so a prior dirty write or unpushed commit is repaired', async () => {
    const stopped = state('agent-pan-3513', 'PAN-3513');
    const flushPlaneWrites = vi.fn(async () => ({ committed: false, pushed: true }));
    const result = await backfillAgentRuntimePlane({}, deps({
      listLocalAgentIds: () => [stopped.id],
      hasLocalState: () => true,
      readAgentState: () => stopped,
      readPlaneRecord: () => planeRecord(stopped),
      writePlaneRecord: vi.fn(async () => false),
      flushPlaneWrites,
    }));

    expect(result).toEqual([{
      agentId: stopped.id,
      issueId: stopped.issueId,
      status: 'reconstructed',
      sessions: ['existing-session'],
      reason: 'existing durable record already contained equal or stronger history',
    }]);
    expect(flushPlaneWrites).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when the durable state push is not confirmed', async () => {
    const stopped = state('agent-pan-3513', 'PAN-3513');
    await expect(backfillAgentRuntimePlane({}, deps({
      listLocalAgentIds: () => [stopped.id],
      hasLocalState: () => true,
      readAgentState: () => stopped,
      readPlaneRecord: () => planeRecord(stopped),
      writePlaneRecord: vi.fn(async () => false),
      flushPlaneWrites: vi.fn(async () => ({
        committed: false,
        pushed: false,
        reason: 'index lock contention',
      })),
    }))).rejects.toThrow('index lock contention');
  });

  it('skips an active agent whose stronger durable record already exists', async () => {
    const live = { ...state('agent-pan-3513', 'PAN-3513'), status: 'running' as const };
    const writePlaneRecord = vi.fn(async () => true);
    const flushPlaneWrites = vi.fn(async () => ({ committed: false, pushed: true }));
    const result = await backfillAgentRuntimePlane({}, deps({
      listLocalAgentIds: () => [live.id],
      hasLocalState: () => true,
      readAgentState: () => live,
      readPlaneRecord: () => planeRecord(live),
      writePlaneRecord,
      flushPlaneWrites,
    }));

    expect(result).toEqual([{
      agentId: live.id,
      issueId: live.issueId,
      status: 'skipped-live',
      sessions: ['existing-session'],
    }]);
    expect(writePlaneRecord).not.toHaveBeenCalled();
    expect(flushPlaneWrites).toHaveBeenCalledTimes(1);
  });
});
