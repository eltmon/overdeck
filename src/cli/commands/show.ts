import { Effect } from 'effect';
/**
 * pan show <id> — unified observation command
 *
 * Default: compact summary (derived issue state, the last few pipeline journal
 * entries, health, recent CV entries) — kept short so it stays skimmable.
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
import { readAgentCV, type AgentCV } from '../../lib/cv.js';
import { getAgentRuntimeStateSync, getAgentState } from '../../lib/agents.js';
import { getAgentEffectiveLastActivityMs, isAlive, type LivenessVerdict } from '../../lib/agents/liveness.js';
import { resolveBareNumericId } from '../../lib/issue-id.js';
import { getDerivedIssueState } from '../../lib/overdeck/derived-issue-state.js';
import { getIssueWorkspacePath } from '../../lib/overdeck/issue-projects.js';
import { readPipelineJournal, type PipelineJournalEntry } from '../../lib/cloister/pipeline-journal.js';
import type { DerivedIssueState } from '@overdeck/contracts';
import { hostTerminalBackendName } from '../../lib/terminal-backends/select.js';

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

/**
 * The backend's liveness verdict as a health line. An indeterminate probe is
 * `unknown`, never `dead` — a backend that did not answer has not reported a
 * death (the `isConfirmedDead` rule).
 */
export function describeLiveness(
  verdict: LivenessVerdict,
  agentStatus?: string,
  runtimeStatus?: string,
): { status: 'alive' | 'dead' | 'stopped' | 'unknown'; detail: string } {
  if (agentStatus === 'stopped' || runtimeStatus === 'stopped') {
    return { status: 'stopped', detail: 'agent was stopped' };
  }
  if (verdict.alive) return { status: 'alive', detail: 'running' };
  switch (verdict.reason) {
    case 'no-session': return { status: 'dead', detail: 'no agent by that name' };
    case 'pane-dead': return { status: 'dead', detail: 'the agent exited' };
    case 'runtime-missing': return { status: 'dead', detail: 'the harness process is gone' };
    default: return { status: 'unknown', detail: 'liveness probe did not answer' };
  }
}

/**
 * The CV with this issue's outcome derived from its PR (PAN-3420).
 *
 * `startWork` records an `in_progress` entry at spawn, and nothing records the
 * outcome, so a merged, closed-out issue would read "0% success, 1 active"
 * forever. The PR owns that fact: a merged PR is a success. `closed` outranks
 * `merged` in the derived state, and the forge attaches only an open or merged
 * PR, so a closed issue with a PR merged too. A closed issue without one keeps
 * its entry as it was — cancelled work is not a success. Nothing is written.
 */
export function deriveCvOutcome(
  cv: AgentCV | null,
  issueId: string,
  issueState: Pick<DerivedIssueState, 'state' | 'pr'>,
): AgentCV | null {
  if (!cv) return null;
  const shipped = issueState.state === 'merged' || (issueState.state === 'closed' && issueState.pr !== undefined);
  if (!shipped) return cv;
  const target = issueId.toUpperCase();
  let flipped = 0;
  const recentWork = (cv.recentWork ?? []).map((entry) => {
    if (entry.outcome !== 'in_progress' || entry.issueId?.toUpperCase() !== target) return entry;
    flipped++;
    return { ...entry, outcome: 'success' as const };
  });
  if (flipped === 0) return cv;
  const successCount = cv.stats.successCount + flipped;
  const completed = successCount + cv.stats.failureCount + cv.stats.abandonedCount;
  return {
    ...cv,
    recentWork,
    stats: { ...cv.stats, successCount, successRate: completed > 0 ? successCount / completed : 0 },
  };
}

/** How many journal entries the compact view shows, newest last. */
const JOURNAL_LINES = 6;

function shortSha(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 8) : String(value ?? '');
}

/**
 * One line of "what Overdeck did" per journal entry. The journal is not
 * authority — the `state` line above it is derived from the PR — so this reads
 * as a log, never as a status.
 */
export function summarizePipelineEntry(entry: PipelineJournalEntry): string {
  const data = entry.data ?? {};
  switch (entry.type) {
    case 'verification.started':
    case 'verification.passed':
      return data.head ? `head=${shortSha(data.head)}` : '';
    case 'verification.failed':
      return `${data.failedCheck ?? 'unknown check'}${data.cycleCount ? ` (attempt ${data.cycleCount})` : ''}`;
    case 'review.requested':
      return entry.source ?? '';
    case 'review.dispatched':
    case 'review.redispatched': {
      const count = Array.isArray(data.reviewers) ? data.reviewers.length : data.launched;
      const run = data.runId ? ` (run ${shortSha(data.runId)})` : '';
      const why = data.reason ? ` — ${data.reason}` : '';
      return `${count ?? '?'} reviewers${run}${why}`;
    }
    case 'review.halted': {
      const count = Array.isArray(data.stopped) ? data.stopped.length : '?';
      return `${count} reviewers stopped${data.reason ? ` — ${data.reason}` : ''}`;
    }
    case 'review.verdict':
      return `${data.verdict ?? 'unknown'}${data.subRole ? ` (${data.subRole})` : ''}`;
    case 'review.verdict-refused':
      return `${data.status ?? 'unknown'} refused${typeof data.caller === 'string' ? ` (${data.caller})` : ''}`;
    case 'uat.verdict':
      return `${data.status ?? 'unknown'}${typeof data.anchor === 'string' ? ` head=${shortSha(data.anchor)}` : ''}`;
    case 'feedback.delivered':
      return `${data.kind ?? 'verdict'} feedback to ${data.agentId ?? 'the work agent'}`;
    case 'feedback.skipped':
      return `${data.kind ?? 'verdict'} feedback already delivered; not re-sent`;
    case 'merge.attempted':
      return typeof data.kind === 'string' ? data.kind : '';
    case 'merge.completed':
    case 'merge.failed':
      return typeof data.reason === 'string' ? data.reason : '';
    case 'strike.landed':
      return `worktree ${data.worktreeRemoved ? 'removed' : 'kept'}, branch ${data.branchDeleted ? 'deleted' : 'kept'}`;
    case 'handoff.deferred':
    case 'handoff.retried':
      return `attempt ${data.attempt ?? 0}: ${data.skipReason ?? data.reason ?? 'refused'}`;
    case 'handoff.started':
      return `${data.agentId ?? 'work agent'} on attempt ${data.attempt ?? '?'}`;
    case 'handoff.abandoned':
      return `${data.outcome ?? 'abandoned'}${typeof data.reason === 'string' ? ` — ${data.reason}` : typeof data.error === 'string' ? ` — ${data.error}` : ''}`;
    default:
      return '';
  }
}

function journalClock(at: string): string {
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? '--:--:--' : when.toTimeString().slice(0, 8);
}

export async function showCommand(id: string, options: ShowOptions = {}): Promise<void> {
  const { cv, context, health, json } = options;

  // Normalize input: accept bare numbers (1148), prefixed issue IDs (PAN-1148),
  // and prefixed agent IDs (agent-pan-1148). Bare numbers are resolved by probing
  // ~/.overdeck/agents/ for a unique state dir, since the CLI doesn't otherwise
  // know which project a bare number belongs to.
  const resolved = resolveBareNumericId(id);
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

  const issueState = await getDerivedIssueState(issueId);
  const runtimeState = getAgentRuntimeStateSync(agentId);
  const agentState = getAgentState(agentId);
  const hasAgent = Boolean(agentState || runtimeState);

  // PAN-3917 (W12): `pingAgent` asks tmux directly — `sessionExists` — so on a
  // Herdr host it calls every healthy agent dead (and writes that verdict to
  // health.json). The backend-aware oracle answers instead there; tmux hosts
  // keep the full health classifier, thresholds and all.
  const backend = await hostTerminalBackendName();
  const healthData = hasAgent && backend === 'tmux'
    ? await Effect.runPromise(
      pingAgent(agentId).pipe(Effect.catch(() => Effect.succeed(null))),
    )
    : null;
  const liveness = hasAgent && backend !== 'tmux'
    ? await isAlive(agentId).catch((): LivenessVerdict => ({ alive: false, reason: 'runtime-indeterminate' }))
    : null;
  const cvData = deriveCvOutcome(readAgentCV(agentId), issueId, issueState);

  // What Overdeck DID, from the workspace's append-only journal. No forge call
  // is added: this is a local file read, and the derived `state` above still
  // wins wherever the two disagree.
  const workspacePath = getIssueWorkspacePath(issueId);
  const journal = workspacePath ? readPipelineJournal(workspacePath) : [];

  if (json) {
    console.log(JSON.stringify({
      issueId,
      agentId,
      state: issueState.state,
      attention: issueState.attention ?? null,
      pr: issueState.pr,
      branch: issueState.branch,
      health: healthData,
      liveness: liveness ? { backend, ...liveness } : null,
      cv: cvData,
      journal,
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

  // What Overdeck DID — the last few journal entries, newest last. This is a
  // log of actions, not a status: where it disagrees with `state` above, the
  // PR wins and the journal is simply stale.
  const recentJournal = journal.slice(-JOURNAL_LINES);
  if (recentJournal.length > 0) {
    console.log('');
    console.log(chalk.dim('  pipeline:'));
    for (const entry of recentJournal) {
      const summary = summarizePipelineEntry(entry);
      console.log(`    ${chalk.dim(journalClock(entry.at))}  ${entry.type.padEnd(21)} ${chalk.dim(summary)}`);
    }
    console.log('');
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
  } else if (liveness) {
    const { status, detail } = describeLiveness(liveness, agentState?.status, runtimeState?.state);
    const statusColor = status === 'alive'
      ? chalk.green
      : status === 'stopped'
        ? chalk.gray
        : status === 'unknown'
          ? chalk.yellow
          : chalk.red;
    const activityMs = getAgentEffectiveLastActivityMs(agentId);
    const activityText = activityMs !== null ? relativeTime(new Date(activityMs).toISOString()) : 'unknown';
    const extras = [`${backend}: ${detail}`, `last activity ${activityText}`];
    console.log(`  ${chalk.dim('health')}   ${statusColor(status)}  ${chalk.dim('·')} ${extras.join(` ${chalk.dim('·')} `)}`);
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
      // A derived outcome has no completion time; say when the work started.
      const when = outcome === 'in_progress' || !entry.completedAt
        ? `${relativeTime(entry.startedAt)} started`
        : relativeTime(entry.completedAt);
      console.log(`    ${outcomeColor(outcome.padEnd(11))} ${chalk.dim(when.padEnd(18))} ${label}`);
    }
  }

  console.log('');
  console.log(chalk.dim('  use --cv, --health, or --context for full detail'));
  console.log('');
}
