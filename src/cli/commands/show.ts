import { Effect } from 'effect';
/**
 * pan show <id> — unified observation command
 *
 * Default: compact summary (derived issue state, health, recent CV entries) —
 * guaranteed to fit in ≤ 25 lines so it stays skimmable.
 *
 * Flags scope the output to specific views (full detail):
 *   --cv        Agent work history (CV)
 *   --context   Context engineering state
 *   --health    Health + heartbeat only
 */

import chalk from 'chalk';
import { cvCommand } from './cv.js';
import { contextCommand } from './context.js';
import { healthCommand } from './health.js';
import { pingAgent } from '../../lib/health.js';
import { readAgentCVSync } from '../../lib/cv.js';
import { getAgentRuntimeStateSync, getAgentStateSync } from '../../lib/agents.js';
import { resolveBareNumericIdSync } from '../../lib/issue-id.js';
import { gatherIssueState } from '../../lib/overdeck/derived-issue-state.js';

interface ShowOptions {
  cv?: boolean;
  context?: boolean;
  health?: boolean;
  json?: boolean;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const diffMs = Date.now() - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export async function showCommand(id: string, options: ShowOptions = {}): Promise<void> {
  const { cv, context, health, json } = options;

  // Normalize input: accept bare numbers (1148), prefixed issue IDs (PAN-1148),
  // and prefixed agent IDs (agent-pan-1148). Bare numbers are resolved by probing
  // ~/.overdeck/agents/ for a unique state dir, since the CLI doesn't otherwise
  // know which project a bare number belongs to.
  const resolved = resolveBareNumericIdSync(id);
  if (!resolved) {
    console.error(chalk.red(`Could not resolve issue ID "${id}"`));
    console.error(chalk.dim(
      'Pass a fully-qualified ID like "PAN-1148", or ensure the agent state dir exists at ~/.overdeck/agents/agent-<prefix>-<num>/',
    ));
    return;
  }
  const normalizedId = resolved.toLowerCase();
  const issueId = resolved;
  const agentId = `agent-${normalizedId}`;

  // Scoped views delegate to the full sub-commands
  if (cv) return cvCommand(issueId, { json });
  if (context) return contextCommand('state', agentId, undefined, { json });
  if (health) return healthCommand('ping', issueId, { json });

  const issueState = await gatherIssueState(issueId);
  const runtimeState = getAgentRuntimeStateSync(agentId);
  const agentState = getAgentStateSync(agentId);
  const healthData = agentState || runtimeState
    ? await Effect.runPromise(
      pingAgent(agentId).pipe(Effect.catch(() => Effect.succeed(null))),
    )
    : null;
  const cvData = readAgentCVSync(agentId);

  if (json) {
    console.log(JSON.stringify({
      issueId,
      agentId,
      state: issueState.state,
      attention: issueState.attention,
      health: healthData,
      cv: cvData,
    }, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.bold.cyan(issueId));

  // Derived state — nothing here is stored; it is read from the tracker, the
  // pull request, git, and agent liveness every time (FR-6).
  console.log(`  ${chalk.dim('state')}    ${chalk.cyan(issueState.state)}`);
  if (issueState.attention) {
    console.log(`  ${chalk.dim('needs')}    ${chalk.yellow(issueState.attention)}`);
  }

  // Health line
  if (healthData) {
    const statusText = healthData.status;
    const statusColor = statusText === 'healthy'
      ? chalk.green
      : statusText === 'warning'
        ? chalk.yellow
        : statusText === 'stopped'
          ? chalk.gray
          : chalk.red;
    const activityAt = healthData.lastActivity ?? runtimeState?.lastActivity;
    const activityText = activityAt ? relativeTime(activityAt) : 'unknown';
    const extras: string[] = [`last activity ${activityText}`];
    if (runtimeState?.state === 'waiting-on-human') {
      extras.push('waiting on human');
    }
    console.log(`  ${chalk.dim('health')}   ${statusColor(statusText)}  ${chalk.dim('·')} ${extras.join(` ${chalk.dim('·')} `)}`);
  } else {
    console.log(`  ${chalk.dim('health')}   ${chalk.dim('(no agent state)')}`);
  }

  // CV line (stats summary)
  const stats = cvData?.stats;
  if (stats && stats.totalIssues > 0) {
    const successPct = (stats.successRate * 100).toFixed(0);
    const avg = stats.avgDuration > 0 ? `${stats.avgDuration}m avg` : '—';
    const completedCount = stats.successCount + stats.failureCount + stats.abandonedCount;
    const inProgressCount = Math.max(0, stats.totalIssues - completedCount);
    const countsLabel = inProgressCount > 0
      ? `${stats.totalIssues} total (${completedCount} done, ${inProgressCount} active)`
      : `${stats.totalIssues} total`;
    console.log(`  ${chalk.dim('cv    ')}   ${countsLabel}  ${chalk.dim('·')} ${successPct}% success  ${chalk.dim('·')} ${avg}`);
  } else {
    console.log(`  ${chalk.dim('cv    ')}   ${chalk.dim('(no work history)')}`);
  }

  // Recent CV entries (up to 3)
  const recent = cvData?.recentWork?.slice(-3).reverse() ?? [];
  if (recent.length > 0) {
    console.log('');
    console.log(chalk.dim('  recent:'));
    for (const entry of recent) {
      const outcome = entry.outcome ?? 'unknown';
      const outcomeColor = outcome === 'success'
        ? chalk.green
        : outcome === 'failed' || outcome === 'abandoned'
          ? chalk.red
          : chalk.dim;
      const label = (entry.issueId ?? '(unknown)').slice(0, 60);
      const when = outcome === 'in_progress'
        ? `${relativeTime(entry.startedAt)} started`
        : relativeTime(entry.completedAt);
      console.log(`    ${outcomeColor(outcome.padEnd(11))} ${chalk.dim(when.padEnd(18))} ${label}`);
    }
  }

  console.log('');
  console.log(chalk.dim('  use --cv, --health, or --context for full detail'));
  console.log('');
}
