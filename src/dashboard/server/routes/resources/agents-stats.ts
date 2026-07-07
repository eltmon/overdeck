import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import { listAgentStates, type AgentState } from '../../../../lib/agents.js';
import type { CostEvent } from '../../../../lib/costs/events.js';
import { queryCostEventsSync } from '../../../../lib/overdeck/cost-sync.js';
import { listPaneValues, listSessions } from '../../../../lib/tmux.js';

const execFileAsync = promisify(execFile);
const BURN_WINDOW_MS = 30 * 60 * 1000;

export interface AgentProcessRecord {
  pid: number;
  ppid: number;
  cpuPercent: number;
  rssBytes: number;
}

export interface AgentSessionRoot {
  agentId: string;
  rootPid: number;
}

export interface AgentCostEvent extends CostEvent {
  subscriptionCovered?: boolean;
  hypotheticalCost?: number;
}

export interface AgentStatsOptions {
  agents: MinimalAgentState[];
  sessionRoots: AgentSessionRoot[];
  processes: AgentProcessRecord[];
  costEventsByAgent?: Map<string, AgentCostEvent[]>;
  nowMs?: number;
}

export interface AgentStatsSnapshotDeps {
  listAgents?: () => MinimalAgentState[];
  listSessionNames?: () => Effect.Effect<readonly string[], unknown, never>;
  listPanePids?: (sessionName: string) => Effect.Effect<readonly number[], unknown, never>;
  readProcessTable?: () => Promise<AgentProcessRecord[]>;
  queryCostEvents?: (options: { agentId: string; startTs?: string }) => AgentCostEvent[];
  nowMs?: number;
}

export type MinimalAgentState = Pick<
  AgentState,
  'id' | 'issueId' | 'status' | 'role' | 'model' | 'startedAt' | 'lastActivity'
>;

export interface AgentResourceRow {
  id: string;
  issueId: string;
  role: string;
  model: string;
  status: string;
  statusChip: {
    state: 'working' | 'idle';
    idleMinutes: number;
    fanOut: boolean;
  };
  rootPid: number | null;
  processCount: number;
  cpuPercent: number;
  memoryBytes: number;
  burnUsdPerHour: number;
  hypotheticalUsdPerHour?: number;
  totalUsd: number;
}

export interface AgentFleetVitals {
  burnUsdPerHour: number;
  hypotheticalUsdPerHour: number;
  totalUsd: number;
}

export interface AgentStatsSnapshot {
  agents: AgentResourceRow[];
  hostVitals: {
    agents: AgentFleetVitals;
  };
}

export function buildAgentStatsSnapshot(options: AgentStatsOptions): AgentStatsSnapshot {
  const nowMs = options.nowMs ?? Date.now();
  const processTotalsByRoot = buildProcessTotalsByRoot(options.sessionRoots, options.processes);
  const rows = options.agents
    .filter((agent) => agent.status !== 'stopped')
    .map((agent): AgentResourceRow => {
      const root = options.sessionRoots.find((sessionRoot) => sessionRoot.agentId === agent.id);
      const processTotals = root ? processTotalsByRoot.get(root.rootPid) : undefined;
      const costStats = computeAgentCostStats(
        options.costEventsByAgent?.get(agent.id) ?? [],
        nowMs,
      );
      const idleMinutes = getIdleMinutes(agent.lastActivity ?? agent.startedAt, nowMs);

      return {
        id: agent.id,
        issueId: agent.issueId,
        role: agent.role,
        model: agent.model,
        status: agent.status,
        statusChip: {
          state: idleMinutes > 5 ? 'idle' : 'working',
          idleMinutes,
          fanOut: (processTotals?.processCount ?? 0) >= 8,
        },
        rootPid: root?.rootPid ?? null,
        processCount: processTotals?.processCount ?? 0,
        cpuPercent: processTotals?.cpuPercent ?? 0,
        memoryBytes: processTotals?.memoryBytes ?? 0,
        burnUsdPerHour: costStats.burnUsdPerHour,
        ...(costStats.hypotheticalUsdPerHour > 0
          ? { hypotheticalUsdPerHour: costStats.hypotheticalUsdPerHour }
          : {}),
        totalUsd: costStats.totalUsd,
      };
    });

  return {
    agents: rows,
    hostVitals: {
      agents: {
        burnUsdPerHour: roundCurrency(rows.reduce((sum, row) => sum + row.burnUsdPerHour, 0)),
        hypotheticalUsdPerHour: roundCurrency(
          rows.reduce((sum, row) => sum + (row.hypotheticalUsdPerHour ?? 0), 0),
        ),
        totalUsd: roundCurrency(rows.reduce((sum, row) => sum + row.totalUsd, 0)),
      },
    },
  };
}

export function getAgentStatsSnapshotEffect(
  deps: AgentStatsSnapshotDeps = {},
): Effect.Effect<AgentStatsSnapshot, never, never> {
  return Effect.gen(function* () {
    const nowMs = deps.nowMs ?? Date.now();
    const agents = (deps.listAgents ?? listAgentStates)()
      .filter((agent) => agent.status !== 'stopped');
    const sessionNames = yield* (deps.listSessionNames ?? defaultListSessionNames)().pipe(
      Effect.catch(() => Effect.succeed([] as readonly string[])),
    );
    const liveSessionNames = new Set(sessionNames);
    const sessionRoots: AgentSessionRoot[] = [];

    for (const agent of agents) {
      if (!liveSessionNames.has(agent.id)) continue;
      const panePids = yield* (deps.listPanePids ?? defaultListPanePids)(agent.id).pipe(
        Effect.catch(() => Effect.succeed([] as readonly number[])),
      );
      const rootPid = panePids[0];
      if (rootPid) sessionRoots.push({ agentId: agent.id, rootPid });
    }

    const processes = sessionRoots.length > 0
      ? yield* Effect.promise(() => (deps.readProcessTable ?? readBatchedProcessTable)()).pipe(
          Effect.catch(() => Effect.succeed([])),
        )
      : [];
    const costEventsByAgent = new Map<string, AgentCostEvent[]>();
    const costQuery = deps.queryCostEvents ?? queryCostEventsSync;

    for (const agent of agents) {
      const recentStartTs = new Date(nowMs - BURN_WINDOW_MS).toISOString();
      costEventsByAgent.set(agent.id, [
        ...costQuery({ agentId: agent.id }),
        ...costQuery({ agentId: agent.id, startTs: recentStartTs }),
      ]);
    }

    return buildAgentStatsSnapshot({
      agents,
      sessionRoots,
      processes,
      costEventsByAgent,
      nowMs,
    });
  });
}

export function parseProcessTable(psTable: string): AgentProcessRecord[] {
  return psTable
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+([0-9.]+)\s+(\d+)$/);
      if (!match) return [];
      return [{
        pid: Number(match[1]),
        ppid: Number(match[2]),
        cpuPercent: Number(match[3]),
        rssBytes: Number(match[4]) * 1024,
      }];
    });
}

async function readBatchedProcessTable(): Promise<AgentProcessRecord[]> {
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,ppid=,pcpu=,rss='], {
    encoding: 'utf8',
  });
  return parseProcessTable(stdout);
}

function defaultListSessionNames(): Effect.Effect<readonly string[], unknown, never> {
  return listSessions().pipe(
    Effect.map((sessions) => sessions.map((session) => session.name)),
  );
}

function defaultListPanePids(sessionName: string): Effect.Effect<readonly number[], unknown, never> {
  return listPaneValues(sessionName, '#{pane_pid}').pipe(
    Effect.map((values) => values
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0)),
  );
}

function buildProcessTotalsByRoot(
  roots: AgentSessionRoot[],
  processes: AgentProcessRecord[],
): Map<number, { processCount: number; cpuPercent: number; memoryBytes: number }> {
  const processByPid = new Map(processes.map((process) => [process.pid, process]));
  const childrenByPpid = new Map<number, AgentProcessRecord[]>();
  const totals = new Map<number, { processCount: number; cpuPercent: number; memoryBytes: number }>();

  for (const process of processes) {
    const siblings = childrenByPpid.get(process.ppid);
    if (siblings) siblings.push(process);
    else childrenByPpid.set(process.ppid, [process]);
  }

  for (const root of roots) {
    const queue = [root.rootPid];
    const seen = new Set<number>();
    let cpuPercent = 0;
    let memoryBytes = 0;

    while (queue.length > 0) {
      const pid = queue.pop()!;
      if (seen.has(pid)) continue;
      seen.add(pid);

      const process = processByPid.get(pid);
      if (process) {
        cpuPercent += process.cpuPercent;
        memoryBytes += process.rssBytes;
      }

      for (const child of childrenByPpid.get(pid) ?? []) {
        queue.push(child.pid);
      }
    }

    totals.set(root.rootPid, {
      processCount: seen.size,
      cpuPercent: roundOneDecimal(cpuPercent),
      memoryBytes,
    });
  }

  return totals;
}

function computeAgentCostStats(
  events: AgentCostEvent[],
  nowMs: number,
): { burnUsdPerHour: number; hypotheticalUsdPerHour: number; totalUsd: number } {
  const burnStartMs = nowMs - BURN_WINDOW_MS;
  let recentBillable = 0;
  let recentHypothetical = 0;
  let totalUsd = 0;

  for (const event of events) {
    const eventCost = event.hypotheticalCost ?? event.cost;
    if (isSubscriptionCovered(event)) {
      recentHypothetical += Date.parse(event.ts) >= burnStartMs ? eventCost : 0;
    } else {
      totalUsd += event.cost;
      recentBillable += Date.parse(event.ts) >= burnStartMs ? event.cost : 0;
    }
  }

  return {
    burnUsdPerHour: roundCurrency(recentBillable * 2),
    hypotheticalUsdPerHour: roundCurrency(recentHypothetical * 2),
    totalUsd: roundCurrency(totalUsd),
  };
}

function isSubscriptionCovered(event: AgentCostEvent): boolean {
  return event.subscriptionCovered === true || event.source === 'subscription-covered';
}

function getIdleMinutes(lastActivity: string | undefined, nowMs: number): number {
  if (!lastActivity) return 0;
  const lastActivityMs = Date.parse(lastActivity);
  if (!Number.isFinite(lastActivityMs)) return 0;
  return Math.max(0, Math.floor((nowMs - lastActivityMs) / 60_000));
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
