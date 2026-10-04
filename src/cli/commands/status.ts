import chalk from 'chalk';
import { Effect } from 'effect';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { listRunningAgentsSync, getAgentDir, type AgentState } from '../../lib/agents.js';
import { isAlive, type LivenessVerdict } from '../../lib/agents/liveness.js';
import { getDashboardApiUrl } from '../../lib/config.js';
import { isNoResumeValueEnabled } from '../../lib/boot-no-resume.js';
import {
  collectDockerContainerLifecycleSnapshot,
  getWorkspaceStackHealth,
  inferIssueIdFromStackContainerName,
} from '../../lib/workspace/stack-health.js';
import { detectConcurrentRestartWriters, readRestartEvents, readRestartStatus, type RestartStatus } from '../../lib/restart-status.js';
import { readRestartGate, type RestartGateSnapshot } from '../../lib/restart-gate-client.js';

interface StatusOptions {
  json?: boolean;
  context?: boolean;
}

function issueKey(issueId: string): string {
  return issueId.toUpperCase();
}

function formatRestartAge(ts: string): string {
  const ageMs = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'unknown age';
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s ago`;
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`;
  return `${Math.floor(ageMs / 86_400_000)}d ago`;
}

function formatRestartDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatRestartStatusLines(status: RestartStatus | null, events: RestartStatus[]): string[] {
  if (!status) return [];
  const marker = status.success ? chalk.green('✓ ok') : chalk.red(status.gaveUp ? '⚠ FAILED — watchdog gave up' : '⚠ FAILED');
  let base = `Last dashboard restart: ${marker} (${status.trigger}, ${formatRestartAge(status.ts)}, ${formatRestartDuration(status.durationMs)}`;
  if (status.pid !== undefined) {
    base += `, pid ${status.pid}`;
  }
  if (status.initiator) {
    base += `, ${status.initiator}`;
  }
  base += ')';
  const lines: string[] = [base];
  if (status.error) {
    lines.push(`  ${chalk.dim(status.error)}`);
  }
  const statusTs = new Date(status.ts).getTime();
  const windowEvents = events.filter((event) => {
    const eventTs = new Date(event.ts).getTime();
    return Number.isFinite(eventTs) && Math.abs(eventTs - statusTs) <= 60_000;
  });
  const concurrent = detectConcurrentRestartWriters(windowEvents);
  if (concurrent.length > 0) {
    const descriptions = concurrent
      .map((event) => `pid ${event.pid ?? 'unknown'}${event.initiator ? ` (${event.initiator})` : ''}`)
      .join(', ');
    lines.push(chalk.yellow(`⚠ Concurrent restart writers detected: ${descriptions}`));
  }
  return lines;
}

/**
 * One line when voluntary restarts are blocked waiting for the operator, so a
 * `pan reload` or post-merge deploy that looks stuck is explained where the
 * operator already looks. Null when nothing is waiting.
 */
export function formatRestartGateLine(gate: RestartGateSnapshot | null): string | null {
  const waiting = gate?.pending.length ?? 0;
  if (waiting === 0) return null;
  return chalk.yellow(
    `${waiting} restart request(s) waiting for operator approval — approve in the dashboard banner or \`pan restart approve\``,
  );
}

function renderRestartStatus(status: RestartStatus | null, events: RestartStatus[]): void {
  for (const line of formatRestartStatusLines(status, events)) {
    console.log(line);
  }
  console.log('');
}

async function isBootNoResumeModeActive(): Promise<boolean> {
  if (isNoResumeValueEnabled(process.env.OVERDECK_NO_RESUME)) return true;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 250);
  try {
    const response = await fetch(`${getDashboardApiUrl()}/api/no-resume-mode`, { signal: controller.signal });
    if (!response.ok) return false;
    const payload = await response.json() as { active?: unknown };
    return payload.active === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * One agent as `pan status` reports it. `alive` is the backend-neutral answer
 * from `liveness.ts` (Herdr or tmux, whichever hosts the agent); `livenessReason`
 * says why it is not alive (`runtime-indeterminate` = the probe failed, not a
 * death).
 */
export type StatusAgent = AgentState & {
  /**
   * @deprecated tmux session presence on the `overdeck` socket only: always
   * false for a Herdr agent. Kept for JSON consumers; read `alive`.
   */
  tmuxActive: boolean;
  alive: boolean;
  livenessReason?: Extract<LivenessVerdict, { alive: false }>['reason'];
};

/** Concurrent liveness probes; each is a Herdr socket call or a few tmux execs. */
const LIVENESS_PROBE_CONCURRENCY = 32;

async function withLiveness(agents: readonly (AgentState & { tmuxActive: boolean })[]): Promise<StatusAgent[]> {
  const verdicts: LivenessVerdict[] = new Array(agents.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < agents.length) {
      const index = next++;
      verdicts[index] = await isAlive(agents[index]!.id).catch(
        (): LivenessVerdict => ({ alive: false, reason: 'runtime-indeterminate' }),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(LIVENESS_PROBE_CONCURRENCY, agents.length) }, worker));
  return agents.map((agent, index) => {
    const verdict = verdicts[index]!;
    return verdict.alive
      ? { ...agent, alive: true }
      : { ...agent, alive: false, livenessReason: verdict.reason };
  });
}

function formatGatingReason(agent: StatusAgent, noResumeModeActive: boolean): string {
  if (agent.alive) return '';
  if (agent.paused === true) return agent.pausedReason ? `Paused (${agent.pausedReason})` : 'Paused';
  if (agent.troubled === true) {
    const failureCount = agent.consecutiveFailures ?? 0;
    return `Troubled (${failureCount} failure${failureCount === 1 ? '' : 's'})`;
  }
  if (noResumeModeActive) return 'Boot --no-resume';
  if (agent.stoppedByUser === true) return 'Manual';
  return '';
}

export function readContextPercent(agentId: string): number | null {
  const ctxFile = join(getAgentDir(agentId), 'context-pct');
  try {
    if (existsSync(ctxFile)) {
      const val = parseInt(readFileSync(ctxFile, 'utf8').trim(), 10);
      return isNaN(val) ? null : val;
    }
  } catch {
    // Non-fatal — context data is optional
  }
  return null;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  const [restartStatus, restartEvents] = await Promise.all([readRestartStatus(), readRestartEvents()]);

  // Filter out invalid agent states (missing required fields)
  const agents = await withLiveness(listRunningAgentsSync().filter(agent =>
    agent.id && agent.issueId && agent.workspace
  ));
  const noResumeModeActive = await isBootNoResumeModeActive();
  const dockerContainers = await Effect.runPromise(collectDockerContainerLifecycleSnapshot());
  const issueIds = new Map<string, string>();
  for (const agent of agents) {
    issueIds.set(issueKey(agent.issueId!), agent.issueId!);
  }
  for (const container of dockerContainers) {
    const issueId = inferIssueIdFromStackContainerName(container.name);
    if (issueId) issueIds.set(issueKey(issueId), issueId);
  }

  const stackHealthByIssue = new Map(await Promise.all(
    Array.from(issueIds, async ([key, issueId]) => [
      key,
      await Effect.runPromise(getWorkspaceStackHealth(issueId, { containers: dockerContainers })),
    ] as const)
  ));
  const agentIssueKeys = new Set(agents.map(agent => issueKey(agent.issueId!)));
  const brokenStacksWithoutAgent = Array.from(issueIds)
    .filter(([key]) => !agentIssueKeys.has(key))
    .map(([key, issueId]) => ({ issueId, stackHealth: stackHealthByIssue.get(key) }))
    .filter((entry): entry is { issueId: string; stackHealth: NonNullable<typeof entry.stackHealth> } => Boolean(entry.stackHealth && !entry.stackHealth.healthy));

  if (options.json) {
    const agentsWithShadow = await Promise.all(agents.map(async agent => {
      return {
        ...agent,
        stackHealth: agent.issueId ? stackHealthByIssue.get(issueKey(agent.issueId)) : undefined,
        gatingReason: formatGatingReason(agent, noResumeModeActive) || undefined,
        ...(options.context ? { contextPercent: readContextPercent(agent.id) } : {}),
      };
    }));
    console.log(JSON.stringify(agentsWithShadow, null, 2));
    return;
  }

  renderRestartStatus(restartStatus, restartEvents);

  const restartGateLine = formatRestartGateLine(await readRestartGate({}, 250));
  if (restartGateLine) {
    console.log(restartGateLine);
    console.log('');
  }

  if (agents.length === 0 && brokenStacksWithoutAgent.length === 0) {
    console.log(chalk.dim('No running agents.'));
    console.log(chalk.dim('Use "pan start <id>" to spawn one.'));
    return;
  }

  if (agents.length > 0) {
    console.log(chalk.bold('\nRunning Agents\n'));
  }

  for (const agent of agents) {
    const indeterminate = agent.livenessReason === 'runtime-indeterminate';
    const statusColor = agent.alive ? chalk.green : indeterminate ? chalk.yellow : chalk.red;
    const status = agent.alive ? 'running' : indeterminate ? 'unknown' : 'stopped';

    const startedAt = new Date(agent.startedAt);
    const duration = Math.floor((Date.now() - startedAt.getTime()) / 1000 / 60);

    const gatingReason = formatGatingReason(agent, noResumeModeActive);

    console.log(`${chalk.cyan(agent.id)}`);
    console.log(`  Issue:    ${agent.issueId}`);
    console.log(`  Status:   ${statusColor(status)}`);
    if (gatingReason) {
      console.log(`  Gate:     ${chalk.yellow(gatingReason)}`);
    }

    if (options.context) {
      const ctxPct = readContextPercent(agent.id);
      const ctxStr = ctxPct !== null ? `${ctxPct}%` : '--';
      console.log(`  Context:  ${ctxStr}`);
    }

    console.log(`  Harness:  ${agent.harness ?? 'claude-code'}`);
    console.log(`  Model:    ${agent.model}`);
    if (agent.effort) {
      console.log(`  Effort:   ${agent.effort}${agent.effortSource ? ` (${agent.effortSource})` : ''}`);
    }
    console.log(`  Role:     ${agent.role}`);
    console.log(`  Duration: ${duration} min`);
    console.log(`  Workspace: ${chalk.dim(agent.workspace)}`);

    const stackHealth = agent.issueId ? stackHealthByIssue.get(issueKey(agent.issueId)) : undefined;
    if (stackHealth && !stackHealth.healthy) {
      console.log(`  Stack:    ${chalk.red('STACK BROKEN')} ${stackHealth.reasons.join('; ')}`);
    }

    console.log('');
  }

  if (brokenStacksWithoutAgent.length > 0) {
    console.log(chalk.bold('Broken Workspace Stacks\n'));
    for (const { issueId, stackHealth } of brokenStacksWithoutAgent) {
      console.log(`${chalk.cyan(issueId)}`);
      console.log(`  Stack:    ${chalk.red('STACK BROKEN')} ${stackHealth.reasons.join('; ')}`);
      console.log('');
    }
  }

}
