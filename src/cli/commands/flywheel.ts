/**
 * `pan flywheel start | stop | abort | pause | resume | report | status | stats`
 * (PAN-3964 FR-6; PAN-3917 D12).
 *
 * The flywheel is a conversation running the `pan-flywheel` skill, not a
 * service with a run record. Every verb here is a thin wrapper over
 * `src/lib/flywheel/` — the same functions the `/api/flywheel/*` routes call —
 * so the CLI and the Flywheel page cannot disagree. Status is derived on read
 * from the conversation, its transcript's tick markers, the pipeline journals,
 * the policies, and the running order book.
 */

import chalk from 'chalk';
import { Command } from 'commander';
import type { FlywheelDerivedStatus, FlywheelStats } from '@overdeck/contracts';

import { FLYWHEEL_CONVERSATION_SESSION, FLYWHEEL_SKILL_COMMAND } from '../../lib/flywheel/constants.js';
import {
  abortFlywheel,
  pauseFlywheel,
  requestFlywheelReport,
  resumeFlywheel,
  startFlywheel,
  stopFlywheel,
  type FlywheelStartOptions,
} from '../../lib/flywheel/actions.js';
import { deriveFlywheelStatus, readFlywheelRun, resolveFlywheelProjectRoot } from '../../lib/flywheel/derive-status.js';
import { FlywheelAlreadyRunning, isFlywheelActionError } from '../../lib/flywheel/errors.js';
import { readFlywheelReportFile } from '../../lib/flywheel/files.js';
import { computeSubstrateStats } from '../../lib/flywheel/substrate-stats.js';

export { FLYWHEEL_CONVERSATION_SESSION, FLYWHEEL_SKILL_COMMAND };
export type { FlywheelStartOptions };

export interface FlywheelStatusOptions {
  json?: boolean;
}

export interface FlywheelStatsOptions {
  json?: boolean;
  window?: string;
}

export interface FlywheelStopOptions {
  timeout?: string;
}

/** Typed flywheel errors are operator facts, not crashes: print and exit 1. */
async function runVerb(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!isFlywheelActionError(error)) throw error;
    console.error(chalk.yellow(error.message));
    process.exitCode = 1;
  }
}

export async function flywheelStartCommand(options: FlywheelStartOptions = {}): Promise<void> {
  await runVerb(async () => {
    const result = await startFlywheel(options);
    console.log(chalk.green(`✓ Flywheel started in ${result.session} (${result.harness}, ${result.model})`));
    console.log(chalk.dim(`  Running ${result.prompt} in ${result.cwd}`));
  });
}

/**
 * `pan orders start <book>` — the order book is an input to the flywheel, so
 * starting one starts the flywheel conversation and names the book. A flywheel
 * that is already running keeps running; the dashboard's orders route calls
 * this too, so it never prints or sets an exit code.
 */
export async function startFlywheelRun(options: FlywheelStartOptions = {}): Promise<{ runId: string }> {
  try {
    await startFlywheel(options);
  } catch (error) {
    if (!(error instanceof FlywheelAlreadyRunning)) throw error;
  }
  return { runId: FLYWHEEL_CONVERSATION_SESSION };
}

export async function flywheelStopCommand(options: FlywheelStopOptions = {}): Promise<void> {
  await runVerb(async () => {
    const timeoutMs = options.timeout !== undefined ? Number(options.timeout) : undefined;
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
      console.error(chalk.red(`--timeout must be a non-negative number of milliseconds, got ${options.timeout}`));
      process.exitCode = 1;
      return;
    }
    console.log(chalk.dim('Asking the loop to write, commit, and push .pan/flywheel/report.md…'));
    const { reportWritten, stopped } = await stopFlywheel(timeoutMs !== undefined ? { timeoutMs } : {});
    console.log(stopped
      ? chalk.green('✓ The loop confirmed its stop. Flywheel paused (row and transcript kept).')
      : chalk.yellow('The loop did not confirm its stop within the timeout. Flywheel paused anyway (row and transcript kept).'));
    if (!reportWritten) console.log(chalk.dim('  .pan/flywheel/report.md was not updated.'));
  });
}

export async function flywheelAbortCommand(): Promise<void> {
  await runVerb(async () => {
    await abortFlywheel();
    console.log(chalk.green('✓ Flywheel aborted without a report (row and transcript kept).'));
  });
}

export async function flywheelPauseCommand(): Promise<void> {
  await runVerb(async () => {
    await pauseFlywheel();
    console.log(chalk.green('✓ Flywheel paused. Resume with: pan flywheel resume'));
  });
}

export async function flywheelResumeCommand(): Promise<void> {
  await runVerb(async () => {
    await resumeFlywheel();
    console.log(chalk.green(`✓ Flywheel resumed; re-sent ${FLYWHEEL_SKILL_COMMAND}.`));
  });
}

export async function flywheelReportCommand(): Promise<void> {
  await runVerb(async () => {
    const { run } = await readFlywheelRun();
    if (run === 'running') {
      await requestFlywheelReport();
      console.log(chalk.green('✓ Asked the loop to write .pan/flywheel/report.md.'));
      return;
    }
    const { planHome } = await resolveFlywheelProjectRoot();
    const report = await readFlywheelReportFile(planHome);
    if (!report.exists || !report.content) {
      console.log(chalk.dim('No report yet.'));
      return;
    }
    console.log(chalk.dim(`${report.path} · ${report.lastModified ?? ''}`));
    console.log(report.content);
  });
}

function relativeAge(iso: string, nowMs: number): string {
  const ms = nowMs - Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function formatFlywheelStatus(status: FlywheelDerivedStatus, nowMs = Date.now()): string {
  const lines: string[] = [];
  const conv = status.conversation;
  const runLabel = status.run === 'running' && status.lastTick ? `running · tick ${status.lastTick.tick}` : status.run;
  lines.push(`${chalk.bold('Flywheel')}  ${runLabel}${conv ? chalk.dim(`  ${conv.name} (${conv.harness ?? '?'}, ${conv.model ?? '?'})`) : ''}`);
  lines.push(chalk.dim(`  project ${status.projectRoot}`));
  if (status.lastTick) {
    const t = status.lastTick;
    lines.push(`  last tick  ${t.tick} · ${t.phase} · pick ${t.pick ?? 'none'} · ${relativeAge(t.at, nowMs)} (${status.freshness})`);
    if (t.needsYou) lines.push(chalk.yellow(`  needs you  ${t.needsYou}`));
  } else if (status.run === 'running') {
    lines.push(chalk.dim('  waiting for the first tick'));
  }
  const p = status.policies;
  lines.push(`  policies   auto-pickup ${p.auto_pickup_backlog ? 'on' : 'off'} · require UAT ${p.require_uat_before_merge ? 'on' : 'off'} · merge train ${p.merge_train_enabled ? 'on' : 'off'}`);
  if (status.orderBook) {
    const b = status.orderBook;
    lines.push(`  order book ${b.name} (${b.id}) · ${b.landed}/${b.total} landed`);
  }
  if (status.inFlight.length) {
    lines.push(`  in flight  ${status.inFlight.length}`);
    for (const row of status.inFlight) {
      const pr = row.pr ? `PR #${row.pr.number} ${row.pr.reviewState}/${row.pr.checks}` : 'no PR';
      const journal = row.lastJournal ? `${row.lastJournal.type} ${relativeAge(row.lastJournal.at, nowMs)}` : '—';
      lines.push(`    ${row.issueId.padEnd(10)} ${row.state.padEnd(18)} ${(row.attention ?? '').padEnd(10)} ${pr.padEnd(32)} ${journal}`);
    }
  } else {
    lines.push(chalk.dim('  in flight  none'));
  }
  return lines.join('\n');
}

export async function flywheelStatusCommand(options: FlywheelStatusOptions = {}): Promise<void> {
  const status = await deriveFlywheelStatus();
  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log(formatFlywheelStatus(status));
}

export function formatFlywheelStats(stats: FlywheelStats): string {
  const c1 = stats.criteria.c1_bugRate;
  const c2 = stats.criteria.c2_p0Bugs;
  const since = stats.window.since.slice(0, 10);
  const c1Value = c1.dataSufficient && c1.value !== null ? c1.value.toFixed(2) : `collecting since ${since}`;
  const lines = [
    `${chalk.bold('Substrate stats')}  last ${stats.window.days} days (since ${since})`,
    `  c1 discovery rate  ${c1Value}  (${c1.count} bugs / ${c1.denominator} merged PRs) · ${c1.status} · ${c1.trend}`,
    `  c2 P0 bugs         ${c2.value} · ${c2.status} · ${c2.trend}`,
  ];
  for (const bug of stats.bugs) {
    lines.push(`    #${bug.number} ${bug.severity.padEnd(7)} ${bug.closedAt ? 'closed' : 'open  '} ${bug.title}`);
  }
  return lines.join('\n');
}

export async function flywheelStatsCommand(options: FlywheelStatsOptions = {}): Promise<void> {
  const windowDays = options.window !== undefined ? Number(options.window) : undefined;
  if (windowDays !== undefined && (!Number.isFinite(windowDays) || windowDays <= 0)) {
    console.error(chalk.red(`--window must be a positive number of days, got ${options.window}`));
    process.exitCode = 1;
    return;
  }
  const { projectRoot } = await resolveFlywheelProjectRoot();
  const stats = await computeSubstrateStats({ projectPath: projectRoot, ...(windowDays !== undefined ? { windowDays } : {}) });
  console.log(options.json ? JSON.stringify(stats, null, 2) : formatFlywheelStats(stats));
}

export function registerFlywheelCommands(program: Command): void {
  const flywheel = program
    .command('flywheel')
    .description('Start, stop, pause, resume, or inspect the flywheel conversation');

  flywheel
    .command('start')
    .description(`Launch a conversation running ${FLYWHEEL_SKILL_COMMAND}`)
    .option('--model <model>', 'Model for the flywheel conversation')
    .option('--harness <harness>', 'Harness for the flywheel conversation')
    .option('--cwd <path>', 'Working directory (default: cwd)')
    .option('--orders <book-id>', 'Order book the flywheel works from')
    .option('--fresh', 'Replace a paused flywheel conversation instead of refusing')
    .action(flywheelStartCommand);

  flywheel
    .command('stop')
    .description('Ask the loop to write its report, wait for it, then pause')
    .option('--timeout <ms>', 'How long to wait for the report (default 120000)')
    .action(flywheelStopCommand);

  flywheel
    .command('abort')
    .description('Stop the flywheel conversation without a report')
    .action(flywheelAbortCommand);

  flywheel
    .command('pause')
    .description('Stop the flywheel session, keeping its conversation and transcript')
    .action(flywheelPauseCommand);

  flywheel
    .command('resume')
    .description(`Respawn a paused flywheel and re-send ${FLYWHEEL_SKILL_COMMAND}`)
    .action(flywheelResumeCommand);

  flywheel
    .command('report')
    .description('Ask a running loop for its report, or print .pan/flywheel/report.md')
    .action(flywheelReportCommand);

  flywheel
    .command('status')
    .description('Show the derived flywheel status: run, last tick, policies, in-flight issues, order book')
    .option('--json', 'Output as JSON')
    .action(flywheelStatusCommand);

  flywheel
    .command('stats')
    .description('Substrate-bug discovery rate and P0 count, computed from the tracker and forge')
    .option('--json', 'Output as JSON')
    .option('--window <days>', 'Window in days (default 30)')
    .action(flywheelStatsCommand);
}
