import chalk from 'chalk';
import { Effect } from 'effect';
import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { listRunningAgentsSync, getAgentDir, type AgentState } from '../../lib/agents.js';
import { isShadowed, getShadowState } from '../../lib/shadow-state.js';
import { getDashboardApiUrlSync } from '../../lib/config.js';
import { isNoResumeValueEnabled } from '../../lib/cloister/no-resume-mode.js';
import { getTldrMetricsSync, getTldrDaemonServiceSync } from '../../lib/tldr-daemon.js';
import {
  collectDockerContainerLifecycleSnapshot,
  getWorkspaceStackHealth,
  inferIssueIdFromStackContainerName,
} from '../../lib/workspace/stack-health.js';
import { readRestartStatus, type RestartStatus } from '../../lib/restart-status.js';

interface StatusOptions {
  json?: boolean;
  tldr?: boolean;
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

function renderRestartStatus(status: RestartStatus | null): void {
  if (!status) return;
  const marker = status.success ? chalk.green('✓ ok') : chalk.red(status.gaveUp ? '⚠ FAILED — watchdog gave up' : '⚠ FAILED');
  const base = `Last dashboard restart: ${marker} (${status.trigger}, ${formatRestartAge(status.ts)}, ${formatRestartDuration(status.durationMs)})`;
  console.log(base);
  if (status.error) {
    console.log(`  ${chalk.dim(status.error)}`);
  }
  console.log('');
}

async function isBootNoResumeModeActive(): Promise<boolean> {
  if (isNoResumeValueEnabled(process.env.PANOPTICON_NO_RESUME)) return true;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 250);
  try {
    const response = await fetch(`${getDashboardApiUrlSync()}/api/no-resume-mode`, { signal: controller.signal });
    if (!response.ok) return false;
    const payload = await response.json() as { active?: unknown };
    return payload.active === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function formatGatingReason(agent: AgentState & { tmuxActive: boolean }, noResumeModeActive: boolean): string {
  if (agent.tmuxActive) return '';
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
  if (options.tldr) {
    await tldrIndexStatusCommand();
    return;
  }

  const restartStatus = await Effect.runPromise(readRestartStatus());

  // Filter out invalid agent states (missing required fields)
  const agents = listRunningAgentsSync().filter(agent =>
    agent.id && agent.issueId && agent.workspace
  );
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
    // Add shadow mode info and optional context % to JSON output
    const agentsWithShadow = await Promise.all(agents.map(async agent => {
      const shadowed = agent.issueId ? await Effect.runPromise(isShadowed(agent.issueId)) : false;
      const shadowState = shadowed && agent.issueId ? await Effect.runPromise(getShadowState(agent.issueId)) : null;
      return {
        ...agent,
        shadowMode: shadowed,
        shadowStatus: shadowState?.shadowStatus,
        trackerStatus: shadowState?.trackerStatus,
        stackHealth: agent.issueId ? stackHealthByIssue.get(issueKey(agent.issueId)) : undefined,
        gatingReason: formatGatingReason(agent, noResumeModeActive) || undefined,
        ...(options.context ? { contextPercent: readContextPercent(agent.id) } : {}),
      };
    }));
    console.log(JSON.stringify(agentsWithShadow, null, 2));
    return;
  }

  renderRestartStatus(restartStatus);

  if (agents.length === 0 && brokenStacksWithoutAgent.length === 0) {
    console.log(chalk.dim('No running agents.'));
    console.log(chalk.dim('Use "pan start <id>" to spawn one.'));
    return;
  }

  if (agents.length > 0) {
    console.log(chalk.bold('\nRunning Agents\n'));
  }

  for (const agent of agents) {
    const statusColor = agent.tmuxActive ? chalk.green : chalk.red;
    const status = agent.tmuxActive ? 'running' : 'stopped';

    const startedAt = new Date(agent.startedAt);
    const duration = Math.floor((Date.now() - startedAt.getTime()) / 1000 / 60);

    // Check shadow mode (only if issueId exists)
    const shadowed = agent.issueId ? await Effect.runPromise(isShadowed(agent.issueId)) : false;
    const shadowState = shadowed && agent.issueId ? await Effect.runPromise(getShadowState(agent.issueId)) : null;

    const gatingReason = formatGatingReason(agent, noResumeModeActive);

    console.log(`${chalk.cyan(agent.id)}`);
    console.log(`  Issue:    ${agent.issueId}`);
    console.log(`  Status:   ${statusColor(status)}`);
    if (gatingReason) {
      console.log(`  Gate:     ${chalk.yellow(gatingReason)}`);
    }

    if (shadowed && shadowState) {
      const statusStr = `${shadowState.shadowStatus}${shadowState.trackerStatus !== shadowState.shadowStatus ? ` (tracker: ${shadowState.trackerStatus})` : ''}`;
      console.log(`  Shadow:   ${chalk.cyan('👻')} ${statusStr}`);
    }

    if (options.context) {
      const ctxPct = readContextPercent(agent.id);
      const ctxStr = ctxPct !== null ? `${ctxPct}%` : '--';
      console.log(`  Context:  ${ctxStr}`);
    }

    console.log(`  Harness:  ${agent.harness ?? 'claude-code'}`);
    console.log(`  Model:    ${agent.model}`);
    console.log(`  Role:     ${agent.role}`);
    console.log(`  Duration: ${duration} min`);
    console.log(`  Workspace: ${chalk.dim(agent.workspace)}`);

    const stackHealth = agent.issueId ? stackHealthByIssue.get(issueKey(agent.issueId)) : undefined;
    if (stackHealth && !stackHealth.healthy) {
      console.log(`  Stack:    ${chalk.red('STACK BROKEN')} ${stackHealth.reasons.join('; ')}`);
    }

    // Show TLDR session metrics if a .tldr/ dir exists in the workspace
    try {
      const tldr = getTldrMetricsSync(agent.workspace);
      if (tldr.interceptions > 0 || tldr.bypasses > 0) {
        const savedK = Math.round(tldr.estimatedTokensSaved / 1000);
        const bypassStr = tldr.bypasses > 0 ? ` (${tldr.bypasses} bypassed)` : '';
        console.log(`  TLDR:     ${chalk.green(`${tldr.interceptions} summaries`)}${bypassStr}, ~${savedK}K tokens saved`);
      }
    } catch { /* non-fatal — workspace may not have TLDR */ }

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

  // Show legend
  const shadowChecks = await Promise.all(
    agents.map(async agent => agent.issueId ? await Effect.runPromise(isShadowed(agent.issueId)) : false),
  );
  const anyShadowed = shadowChecks.some(Boolean);
  if (anyShadowed) {
    console.log(chalk.dim('👻 = Shadow mode (tracking status locally)'));
    console.log('');
  }
}

interface TldrIndexEntry {
  label: string;
  running: boolean;
  fileCount: number | null;
  edgeCount: number | null;
  ageMs: number | null;
}

function readTldrIndexData(workspacePath: string): { fileCount: number | null; edgeCount: number | null; ageMs: number | null } {
  const tldrPath = join(workspacePath, '.tldr');
  if (!existsSync(tldrPath)) {
    return { fileCount: null, edgeCount: null, ageMs: null };
  }

  let fileCount: number | null = null;
  let edgeCount: number | null = null;
  let ageMs: number | null = null;

  const cgPath = join(tldrPath, 'cache', 'call_graph.json');
  if (existsSync(cgPath)) {
    try {
      const cg = JSON.parse(readFileSync(cgPath, 'utf-8')) as { edges?: Array<{ from_file?: string; to_file?: string }> };
      if (Array.isArray(cg.edges)) {
        edgeCount = cg.edges.length;
        const files = new Set<string>();
        for (const e of cg.edges) {
          if (e.from_file) files.add(e.from_file);
          if (e.to_file) files.add(e.to_file);
        }
        fileCount = files.size;
      }
    } catch { /* ignore parse errors */ }
  }

  const langPath = join(tldrPath, 'languages.json');
  if (existsSync(langPath)) {
    try {
      const langData = JSON.parse(readFileSync(langPath, 'utf-8')) as { timestamp?: number };
      if (langData.timestamp) {
        ageMs = Date.now() - langData.timestamp * 1000;
      }
    } catch { /* ignore parse errors */ }
  }

  if (ageMs === null) {
    try {
      const stats = statSync(tldrPath);
      ageMs = Date.now() - stats.mtimeMs;
    } catch { /* ignore stat errors */ }
  }

  return { fileCount, edgeCount, ageMs };
}

function formatTldrAge(ageMs: number | null): string {
  if (ageMs === null) return 'unknown';
  const ageMin = Math.floor(ageMs / 60000);
  if (ageMin < 60) return `${ageMin}m`;
  const ageHours = Math.floor(ageMin / 60);
  if (ageHours < 24) return `${ageHours}h`;
  return `${Math.floor(ageHours / 24)}d`;
}

function formatTldrRow(label: string, entry: TldrIndexEntry): string {
  const files = entry.fileCount !== null ? entry.fileCount.toLocaleString() : 'N/A';
  const edges = entry.edgeCount !== null ? entry.edgeCount.toLocaleString() : 'N/A';
  const age = formatTldrAge(entry.ageMs);
  const daemonStr = entry.running ? chalk.green('running ✓') : chalk.dim('stopped ○');
  const notIndexed = entry.fileCount === null ? chalk.dim(' (not indexed)') : '';
  return `  ${chalk.bold(label)}${notIndexed}  Files: ${files}  Edges: ${edges}  Age: ${age}  Daemon: ${daemonStr}`;
}

export async function tldrIndexStatusCommand(projectRoot = process.cwd()): Promise<void> {
  const projectName = basename(projectRoot);

  const mainEntries: TldrIndexEntry[] = [];
  const workspaceEntries: TldrIndexEntry[] = [];

  const mainVenvPath = join(projectRoot, '.venv');
  if (existsSync(mainVenvPath)) {
    const service = getTldrDaemonServiceSync(projectRoot, mainVenvPath);
    const status = await service.getStatus();
    const { fileCount, edgeCount, ageMs } = readTldrIndexData(projectRoot);
    mainEntries.push({ label: `Main (${projectName})`, running: status.running, fileCount, edgeCount, ageMs });
  }

  const workspacesDir = join(projectRoot, 'workspaces');
  if (existsSync(workspacesDir)) {
    const dirs = readdirSync(workspacesDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('feature-'));
    for (const ws of dirs) {
      const wsPath = join(workspacesDir, ws.name);
      const wsVenvPath = join(wsPath, '.venv');
      if (existsSync(wsVenvPath)) {
        const service = getTldrDaemonServiceSync(wsPath, wsVenvPath);
        const status = await service.getStatus();
        const { fileCount, edgeCount, ageMs } = readTldrIndexData(wsPath);
        workspaceEntries.push({ label: ws.name, running: status.running, fileCount, edgeCount, ageMs });
      }
    }
  }

  console.log(chalk.bold('\nTLDR Index Health'));
  console.log('─────────────────');

  if (mainEntries.length === 0 && workspaceEntries.length === 0) {
    console.log(chalk.dim('\nNo TLDR indexes found (no .venv directories)'));
    console.log(chalk.dim('Run `pan admin tldr start` after creating a project .venv for TLDR support'));
    return;
  }

  for (const entry of mainEntries) {
    console.log(formatTldrRow(entry.label, entry));
  }

  if (workspaceEntries.length > 0) {
    console.log('');
    console.log(chalk.bold('Workspaces'));
    for (const entry of workspaceEntries) {
      console.log(formatTldrRow(entry.label, entry));
    }
  }

  const allEntries = [...mainEntries, ...workspaceEntries];
  const ONE_HOUR = 60 * 60 * 1000;
  const anyMissing = allEntries.some(e => e.fileCount === null);
  const anyNotRunning = allEntries.some(e => !e.running);
  const anyStale = allEntries.some(e => e.ageMs === null || e.ageMs >= ONE_HOUR);

  console.log('');
  if (anyMissing || anyNotRunning) {
    console.log(`Health: ${chalk.red('✗ TLDR not fully configured')}`);
  } else if (anyStale) {
    console.log(`Health: ${chalk.yellow('⚠ Some indexes stale (>1h)')}`);
  } else {
    console.log(`Health: ${chalk.green('✓ All indexes fresh')}`);
  }
  console.log('');
}
