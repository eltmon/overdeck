/**
 * patrol-registry.ts — the declarative list of every surviving Deacon patrol
 * and the cadence it runs at (PAN-3894).
 *
 * Two groups:
 *  - `TICK_PATROLS`: the steps that stay on the 60 s `runPatrol()` tick because
 *    they are stuck detection or pipeline progress, or because they are
 *    time-critical (the ephemeral-VM host heartbeat, the two-tick post-review
 *    debounce, the one-minute mass-death window).
 *  - `HOUSEKEEPING_CHORES`: cleanup, retention, resource hygiene, projection and
 *    retry-policy work that rode the tick only because the tick was there. The
 *    housekeeping scheduler runs each one at `fast` (5 min), `hourly`, or
 *    `daily` with durable due-times.
 *
 * D7: this module must never import the deacon module (`deacon.ts`) — not
 * statically and not dynamically. `scripts/lint-circular-deps.sh` runs madge, which counts
 * `await import(...)` as a graph edge, and `deacon.ts` statically imports the
 * scheduler, which imports this registry. The four chores whose functions live
 * in `deacon.ts` are therefore injected through `ChoreContext.deacon`, supplied
 * by `startDeacon()`. Every other chore dynamically imports its own module.
 */

export type PatrolCadence = 'fast' | 'hourly' | 'daily';

export const CADENCE_MS: Record<PatrolCadence, number> = {
  fast: 5 * 60_000,
  hourly: 60 * 60_000,
  daily: 24 * 60 * 60_000,
};

/**
 * The 14 steps that stay on the 60 s tick, in `runPatrol` order. Five of them
 * (`runStallSweeperPatrol`, `checkApiErrorAgents`, `recreatedStateWarnings`,
 * `recordMainDivergenceHealth`, `checkMassDeath`) are alarms wired directly,
 * never through `runBudgetedPatrol`. `runInvariantChecker` runs every 10 ticks.
 */
export const TICK_PATROLS = [
  'runStallSweeperPatrol',
  'monitorReviewConvoySignals',
  'checkPostReviewCommits',
  'patrolStrikeLandings',
  'swarmJanitorPass',
  'nudgeIdleWorkAgentsWithOpenBeads',
  'checkThinkingSignatureCorruption',
  'checkDeadEndAgents',
  'refreshHostHeartbeatForEphemeralVms',
  'checkApiErrorAgents',
  'runInvariantChecker',
  'recreatedStateWarnings',
  'recordMainDivergenceHealth',
  'checkMassDeath',
] as const;

/** Functions that live in `deacon.ts`; injected by startDeacon so the registry never imports it (D7). */
export interface DeaconChoreFns {
  checkAndSuspendIdleAgents: () => Promise<string[]>;
  checkMergedWorkSessions: () => Promise<string[]>;
  checkWorkspaceContainerHealth: () => Promise<string[]>;
  cleanupStaleAgentState: () => Promise<string[]>;
}

export interface ChoreContext {
  readonly deacon: DeaconChoreFns;
}

export interface HousekeepingChore {
  readonly name: string;
  readonly cadence: PatrolCadence;
  /** Reactive event that also drives this concern, when one exists. */
  readonly trigger?: string;
  /** Returns the action strings the deacon logs. */
  readonly run: (ctx: ChoreContext) => Promise<string[]>;
}

export const HOUSEKEEPING_CHORES: readonly HousekeepingChore[] = [
  // ---- fast (every 5 minutes) ----
  {
    name: 'patrolStaleTaskClaims',
    cadence: 'fast',
    run: async () => (await import('./stale-task-claims.js')).patrolStaleTaskClaims(),
  },
  {
    name: 'processPendingLifecycleForPatrol',
    cadence: 'fast',
    run: async () => {
      const { join } = await import('node:path');
      const { getOverdeckHome } = await import('../paths.js');
      const { processPendingLifecycleForPatrol } = await import('./deacon-pending-lifecycle.js');
      const action = await processPendingLifecycleForPatrol(join(getOverdeckHome(), 'pending-post-merge.json'));
      return action ? [action] : [];
    },
  },
  {
    name: 'runScheduledDeployPatrol',
    cadence: 'fast',
    run: async () => {
      await (await import('./deploy-patrol.js')).runScheduledDeployPatrol();
      return [];
    },
  },
  {
    name: 'reconcilePendingPromotions',
    cadence: 'fast',
    run: async () => (await import('./pending-promotion-reconciler.js')).reconcilePendingPromotions(),
  },
  {
    name: 'checkAndSuspendIdleAgents',
    cadence: 'fast',
    run: (ctx) => ctx.deacon.checkAndSuspendIdleAgents(),
  },
  {
    name: 'checkMergedWorkSessions',
    cadence: 'fast',
    run: (ctx) => ctx.deacon.checkMergedWorkSessions(),
  },
  {
    name: 'checkMergedAdvancingSessions',
    cadence: 'fast',
    run: async () => (await import('./advancing-selfheal.js')).checkMergedAdvancingSessions(),
  },
  {
    name: 'refreshClaudeCredentialsForActiveRemoteAgents',
    cadence: 'fast',
    run: async () =>
      (await import('../remote/remote-completion.js')).refreshClaudeCredentialsForActiveRemoteAgents(),
  },
  {
    name: 'reapCompletedRemoteAgents',
    cadence: 'fast',
    // Budget counts only real actions (hand-offs and errors), not per-VM no-op scans.
    run: async () => {
      const { reapCompletedRemoteAgents } = await import('../remote/remote-completion.js');
      return (await reapCompletedRemoteAgents())
        .filter((r) => r.status === 'handed-off' || r.status === 'error')
        .map((r) => `Remote reap ${r.issueId}: ${r.status} (${r.details.join('; ')})`);
    },
  },
  {
    name: 'checkInspectAgentTimeouts',
    cadence: 'fast',
    run: async () => (await import('./deacon-inspect.js')).checkInspectAgentTimeouts(),
  },
  {
    name: 'checkWorkspaceContainerHealth',
    cadence: 'fast',
    run: (ctx) => ctx.deacon.checkWorkspaceContainerHealth(),
  },
  {
    name: 'checkFailedMergeRetry',
    cadence: 'fast',
    run: async () => (await import('./deacon-merge.js')).checkFailedMergeRetry(),
  },
  {
    name: 'autoCloseOut',
    cadence: 'fast',
    run: async () => (await import('./deacon-merge.js')).autoCloseOut(),
  },
  {
    name: 'reconcileAutoMergeRows',
    cadence: 'fast',
    run: async () => (await import('./deacon-auto-merge-reconcile.js')).reconcileAutoMergeRows(),
  },
  {
    name: 'reconcileTraefikNetworks',
    cadence: 'fast',
    run: async () => (await import('../workspace/traefik-connect.js')).reconcileTraefikNetworks(),
  },
  {
    name: 'reconcileIdleWorkspaceStacks',
    cadence: 'fast',
    trigger: 'agent.stopped / agent.started',
    run: async () => (await import('./idle-stack-reaper.js')).reconcileIdleWorkspaceStacks(),
  },
  {
    name: 'patrolDockerBridgePool',
    cadence: 'fast',
    run: async () => (await import('./bridge-pool-patrol.js')).patrolDockerBridgePool(),
  },
  {
    name: 'reapOrphanedDashboardServers',
    cadence: 'fast',
    run: async () => (await import('./orphan-dashboard-server-reaper.js')).reapOrphanedDashboardServers(),
  },
  {
    name: 'reapLeftoverPlaywrightBrowsers',
    cadence: 'fast',
    run: async () => (await import('./playwright-mcp-reaper.js')).reapLeftoverPlaywrightBrowsers(),
  },
  {
    name: 'perProjectSpecialistPatrol',
    cadence: 'fast',
    run: async () => (await import('./specialist-patrol.js')).perProjectSpecialistPatrol(),
  },

  // ---- hourly ----
  {
    name: 'reconcileOrphanProposedSpecs',
    cadence: 'hourly',
    trigger: 'issue.statusChanged (todo/planned)',
    run: async () => (await import('./orphan-proposed-reconciler.js')).reconcileOrphanProposedSpecs(),
  },
  {
    name: 'reconcileClosedIssueAgents',
    cadence: 'hourly',
    trigger: 'issue.statusChanged (closed)',
    run: async () => (await import('./closed-issue-reaper.js')).reconcileClosedIssueAgents(),
  },
  {
    name: 'reapMergedStrikeWorkspaces',
    cadence: 'hourly',
    run: async () => (await import('./strike-workspace-reaper.js')).reapMergedStrikeWorkspaces(),
  },
  {
    name: 'reconcilePipelineLabelsPatrol',
    cadence: 'hourly',
    run: async () => (await import('./label-reconciler.js')).reconcilePipelineLabelsPatrol(),
  },
  {
    name: 'reconcileProjectStatePlanes',
    cadence: 'hourly',
    run: async () => {
      const { listProjectsSync } = await import('../projects.js');
      const { reconcileProjectStatePlanes } = await import('./state-plane-patrol.js');
      return (await reconcileProjectStatePlanes(listProjectsSync())).map((r) => r.message);
    },
  },
  {
    name: 'reconcileTerminalIssueResidue',
    cadence: 'hourly',
    run: async () => {
      const { listProjectsSync } = await import('../projects.js');
      const { reconcileTerminalIssueResidue } = await import('./parked-residue.js');
      return (await reconcileTerminalIssueResidue(listProjectsSync())).map((r) => r.message);
    },
  },
  {
    name: 'cleanupStaleAgentState',
    cadence: 'hourly',
    run: (ctx) => ctx.deacon.cleanupStaleAgentState(),
  },

  // ---- daily ----
  // Retention must see the canonical registry row to prove terminal state before
  // agent GC removes that evidence, so it is ordered ahead of the GC chore.
  {
    name: 'sweepTranscriptRetention',
    cadence: 'daily',
    run: async () => {
      const { loadCloisterConfigSync } = await import('./config.js');
      const transcriptDays = loadCloisterConfigSync().retention?.transcript_days;
      if (typeof transcriptDays !== 'number' || !Number.isFinite(transcriptDays) || transcriptDays <= 0) return [];
      return (await import('./transcript-retention.js')).sweepTranscriptRetention({ transcriptDays });
    },
  },
  {
    name: 'pruneTerminalStoppedAgents',
    cadence: 'daily',
    run: async () => {
      const { pruneTerminalStoppedAgents } = await import('./agent-gc.js');
      return (await pruneTerminalStoppedAgents()).removed.map((id) => `[agents-gc] pruned ${id}`);
    },
  },
];
