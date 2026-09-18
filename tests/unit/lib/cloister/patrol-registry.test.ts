/**
 * PAN-3894 (W1): the patrol registry is the single declarative list of the 14
 * tick patrols and the 29 housekeeping chores. These tests hold its shape, its
 * ordering invariants, the D7 no-deacon-edge rule, and the return-shape adapters
 * each chore's `run` closure applies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CADENCE_MS,
  TICK_PATROLS,
  HOUSEKEEPING_CHORES,
  type ChoreContext,
} from '../../../../src/lib/cloister/patrol-registry.js';

const REGISTRY_PATH = resolve(__dirname, '../../../../src/lib/cloister/patrol-registry.ts');

vi.mock('../../../../src/lib/cloister/stale-task-claims.js', () => ({ patrolStaleTaskClaims: vi.fn(async () => ['stale-claim']) }));
vi.mock('../../../../src/lib/cloister/deacon-pending-lifecycle.js', () => ({ processPendingLifecycleForPatrol: vi.fn(async () => 'lifecycle-action') }));
vi.mock('../../../../src/lib/cloister/deploy-patrol.js', () => ({ runScheduledDeployPatrol: vi.fn(async () => undefined) }));
vi.mock('../../../../src/lib/cloister/pending-promotion-reconciler.js', () => ({ reconcilePendingPromotions: vi.fn(async () => ['promotion']) }));
vi.mock('../../../../src/lib/cloister/advancing-selfheal.js', () => ({ checkMergedAdvancingSessions: vi.fn(async () => ['advancing']) }));
vi.mock('../../../../src/lib/remote/remote-completion.js', () => ({
  refreshClaudeCredentialsForActiveRemoteAgents: vi.fn(async () => ['creds']),
  reapCompletedRemoteAgents: vi.fn(async () => [
    { issueId: 'PAN-1', status: 'handed-off', details: ['ok'] },
    { issueId: 'PAN-2', status: 'error', details: ['boom', 'retry'] },
    { issueId: 'PAN-3', status: 'still-running', details: [] },
  ]),
}));
vi.mock('../../../../src/lib/cloister/deacon-inspect.js', () => ({ checkInspectAgentTimeouts: vi.fn(async () => ['inspect-timeout']) }));
vi.mock('../../../../src/lib/cloister/deacon-merge.js', () => ({
  checkFailedMergeRetry: vi.fn(async () => ['merge-retry']),
  autoCloseOut: vi.fn(async () => ['close-out']),
}));
vi.mock('../../../../src/lib/cloister/deacon-auto-merge-reconcile.js', () => ({ reconcileAutoMergeRows: vi.fn(async () => ['auto-merge']) }));
vi.mock('../../../../src/lib/workspace/traefik-connect.js', () => ({ reconcileTraefikNetworks: vi.fn(async () => ['traefik']) }));
vi.mock('../../../../src/lib/cloister/idle-stack-reaper.js', () => ({ reconcileIdleWorkspaceStacks: vi.fn(async () => ['idle-stack']) }));
vi.mock('../../../../src/lib/cloister/bridge-pool-patrol.js', () => ({ patrolDockerBridgePool: vi.fn(async () => ['bridge']) }));
vi.mock('../../../../src/lib/cloister/orphan-dashboard-server-reaper.js', () => ({ reapOrphanedDashboardServers: vi.fn(async () => ['orphan-server']) }));
vi.mock('../../../../src/lib/cloister/playwright-mcp-reaper.js', () => ({ reapLeftoverPlaywrightBrowsers: vi.fn(async () => ['playwright']) }));
vi.mock('../../../../src/lib/cloister/specialist-patrol.js', () => ({ perProjectSpecialistPatrol: vi.fn(async () => ['specialist']) }));
vi.mock('../../../../src/lib/cloister/orphan-proposed-reconciler.js', () => ({ reconcileOrphanProposedSpecs: vi.fn(async () => ['orphan-spec']) }));
vi.mock('../../../../src/lib/cloister/closed-issue-reaper.js', () => ({ reconcileClosedIssueAgents: vi.fn(async () => ['closed-issue']) }));
vi.mock('../../../../src/lib/cloister/strike-workspace-reaper.js', () => ({ reapMergedStrikeWorkspaces: vi.fn(async () => ['strike']) }));
vi.mock('../../../../src/lib/cloister/label-reconciler.js', () => ({ reconcilePipelineLabelsPatrol: vi.fn(async () => ['labels']) }));
vi.mock('../../../../src/lib/cloister/state-plane-patrol.js', () => ({
  reconcileProjectStatePlanes: vi.fn(async () => [{ level: 'info', message: 'state-plane' }]),
}));
vi.mock('../../../../src/lib/cloister/parked-residue.js', () => ({
  reconcileTerminalIssueResidue: vi.fn(async () => [{ level: 'warn', message: 'residue' }]),
}));
vi.mock('../../../../src/lib/cloister/transcript-retention.js', () => ({ sweepTranscriptRetention: vi.fn(async () => ['transcript']) }));
vi.mock('../../../../src/lib/cloister/agent-gc.js', () => ({ pruneTerminalStoppedAgents: vi.fn(async () => ({ removed: ['agent-x', 'agent-y'] })) }));
vi.mock('../../../../src/lib/projects.js', () => ({ listProjectsSync: vi.fn(() => [{ key: 'overdeck', config: {} }]) }));
vi.mock('../../../../src/lib/paths.js', () => ({ getOverdeckHome: vi.fn(() => '/tmp/overdeck-home') }));

const transcriptDaysRef = { value: 7 as number | undefined };
vi.mock('../../../../src/lib/cloister/config.js', () => ({
  loadCloisterConfigSync: vi.fn(() => ({ retention: { transcript_days: transcriptDaysRef.value } })),
}));

function stubContext(): ChoreContext {
  return {
    deacon: {
      checkAndSuspendIdleAgents: vi.fn(async () => ['suspend']),
      checkMergedWorkSessions: vi.fn(async () => ['merged-work']),
      checkWorkspaceContainerHealth: vi.fn(async () => ['container']),
      cleanupStaleAgentState: vi.fn(async () => ['stale-state']),
    },
  };
}

function chore(name: string) {
  const found = HOUSEKEEPING_CHORES.find((c) => c.name === name);
  if (!found) throw new Error(`chore ${name} not registered`);
  return found;
}

describe('patrol registry shape (PAN-3894 W1)', () => {
  it('registers 14 tick patrols and 29 housekeeping chores with no overlap', () => {
    expect(TICK_PATROLS).toHaveLength(14);
    expect(HOUSEKEEPING_CHORES).toHaveLength(29);

    const choreNames = HOUSEKEEPING_CHORES.map((c) => c.name);
    expect(new Set(choreNames).size).toBe(choreNames.length);
    expect(new Set(TICK_PATROLS).size).toBe(TICK_PATROLS.length);
    expect(choreNames.filter((n) => (TICK_PATROLS as readonly string[]).includes(n))).toEqual([]);
  });

  it('gives every chore a cadence that is a CADENCE_MS key, and orders transcript retention ahead of agent GC', () => {
    for (const c of HOUSEKEEPING_CHORES) {
      expect(Object.keys(CADENCE_MS)).toContain(c.cadence);
    }
    const names = HOUSEKEEPING_CHORES.map((c) => c.name);
    expect(names.indexOf('sweepTranscriptRetention')).toBeLessThan(names.indexOf('pruneTerminalStoppedAgents'));

    const byCadence = (cadence: string) => HOUSEKEEPING_CHORES.filter((c) => c.cadence === cadence).length;
    expect(byCadence('fast')).toBe(20);
    expect(byCadence('hourly')).toBe(7);
    expect(byCadence('daily')).toBe(2);
  });

  it('never references deacon.js — neither a static nor a dynamic import (D7)', () => {
    expect(readFileSync(REGISTRY_PATH, 'utf8')).not.toContain('deacon.js');
  });

  it('names the reactive trigger on the three chores that have a primary event path', () => {
    expect(chore('reconcileIdleWorkspaceStacks').trigger).toBe('agent.stopped / agent.started');
    expect(chore('reconcileClosedIssueAgents').trigger).toBe('issue.statusChanged (closed)');
    expect(chore('reconcileOrphanProposedSpecs').trigger).toBe('issue.statusChanged (todo/planned)');
  });
});

describe('chore run closures return string[] (PAN-3894 W1)', () => {
  beforeEach(() => {
    transcriptDaysRef.value = 7;
  });

  it('every chore resolves to an array of strings', async () => {
    const ctx = stubContext();
    for (const c of HOUSEKEEPING_CHORES) {
      const result = await c.run(ctx);
      expect(Array.isArray(result), `${c.name} did not return an array`).toBe(true);
      for (const line of result) expect(typeof line, `${c.name} returned a non-string action`).toBe('string');
    }
  });

  it('routes the four deacon-resident chores through ctx.deacon', async () => {
    const ctx = stubContext();
    await expect(chore('checkAndSuspendIdleAgents').run(ctx)).resolves.toEqual(['suspend']);
    await expect(chore('checkMergedWorkSessions').run(ctx)).resolves.toEqual(['merged-work']);
    await expect(chore('checkWorkspaceContainerHealth').run(ctx)).resolves.toEqual(['container']);
    await expect(chore('cleanupStaleAgentState').run(ctx)).resolves.toEqual(['stale-state']);
    expect(ctx.deacon.checkAndSuspendIdleAgents).toHaveBeenCalledTimes(1);
  });

  it('wraps the single pending-lifecycle action in an array', async () => {
    await expect(chore('processPendingLifecycleForPatrol').run(stubContext())).resolves.toEqual(['lifecycle-action']);
  });

  it('turns the void deploy patrol into no actions', async () => {
    await expect(chore('runScheduledDeployPatrol').run(stubContext())).resolves.toEqual([]);
  });

  it('keeps only handed-off and error rows from the remote reap and formats them', async () => {
    await expect(chore('reapCompletedRemoteAgents').run(stubContext())).resolves.toEqual([
      'Remote reap PAN-1: handed-off (ok)',
      'Remote reap PAN-2: error (boom; retry)',
    ]);
  });

  it('maps state-plane and residue result rows down to their message strings', async () => {
    await expect(chore('reconcileProjectStatePlanes').run(stubContext())).resolves.toEqual(['state-plane']);
    await expect(chore('reconcileTerminalIssueResidue').run(stubContext())).resolves.toEqual(['residue']);
  });

  it('prefixes each pruned agent id from the GC result', async () => {
    await expect(chore('pruneTerminalStoppedAgents').run(stubContext())).resolves.toEqual([
      '[agents-gc] pruned agent-x',
      '[agents-gc] pruned agent-y',
    ]);
  });

  it('skips transcript retention when retention.transcript_days is unset or not positive', async () => {
    transcriptDaysRef.value = undefined;
    await expect(chore('sweepTranscriptRetention').run(stubContext())).resolves.toEqual([]);
    transcriptDaysRef.value = 0;
    await expect(chore('sweepTranscriptRetention').run(stubContext())).resolves.toEqual([]);
    transcriptDaysRef.value = 7;
    await expect(chore('sweepTranscriptRetention').run(stubContext())).resolves.toEqual(['transcript']);
  });
});
