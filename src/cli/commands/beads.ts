/**
 * Beads management commands
 *
 * Commands for managing the beads issue tracker integration.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
import { registerBeadsReconcileCommand } from './admin/beads-reconcile.js';
import { standardizeBeadsConfig } from '../../lib/beads/config-standardize.js';
import { formatMutationBatchFailure, runMutationBatch, type BdMutationClient } from '../../lib/beads/writer.js';
import { assertSupportedBdVersion, readInstalledBdVersion } from '../../lib/beads/version.js';
import { createBeadsResolver, type BeadRecord } from '../../lib/beads/resolver.js';
import { sweepOrphanedBeads } from '../../lib/lifecycle/orphaned-beads-sweep.js';
import { readGitHubCloseState } from '../commands/close.js';
import { parseIssueIdSync, type ParsedIssueId } from '../../lib/issue-id.js';
import { resolveProjectFromIssueSync, getProjectSync } from '../../lib/projects.js';

const execAsync = promisify(exec);

/**
 * Detect platform (linux, darwin, win32, wsl)
 */
function detectPlatform(): 'linux' | 'darwin' | 'win32' | 'wsl' {
  const os = platform();
  if (os === 'linux') {
    try {
      const release = readFileSync('/proc/version', 'utf8').toLowerCase();
      if (release.includes('microsoft') || release.includes('wsl')) {
        return 'wsl';
      }
    } catch {}
    return 'linux';
  }
  return os as 'darwin' | 'win32';
}

interface CompactOptions {
  days?: number;
  dryRun?: boolean;
  json?: boolean;
}

interface SweepOptions {
  allClosed?: boolean;
  dryRun?: boolean;
  reason?: string;
}

interface SweepIssueReport {
  issue: string;
  closedCount: number;
  reason: string;
}

interface SweepReport {
  processed: SweepIssueReport[];
  skippedOpen: string[];
  failed: { issue: string; reason: string }[];
}

const SWEEPABLE_STATUSES = new Set(['open', 'in_progress']);

function isSweepable(status: string): boolean {
  return SWEEPABLE_STATUSES.has(status);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function findIssueLabel(bead: BeadRecord): ParsedIssueId | null {
  for (const label of bead.labels) {
    const parsed = parseIssueIdSync(label);
    if (parsed) return parsed;
  }
  return null;
}

function groupBeadsByIssue(beads: BeadRecord[]): Map<string, BeadRecord[]> {
  const groups = new Map<string, BeadRecord[]>();
  for (const bead of beads) {
    const issue = findIssueLabel(bead);
    if (!issue) continue;
    const existing = groups.get(issue.raw);
    if (existing) {
      existing.push(bead);
    } else {
      groups.set(issue.raw, [bead]);
    }
  }
  return groups;
}

function parseGitHubRepo(repo: string | undefined): { owner: string; repo: string } | null {
  if (!repo) return null;
  const parts = repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}

function defaultSweepReason(closeReason: 'completed' | 'not_planned' | null): string {
  if (closeReason === 'not_planned') {
    return 'issue closed (not planned); bead cancelled';
  }
  return 'issue closed (completed); orphaned bead swept';
}

async function resolveGitHubCloseState(issueId: string): Promise<
  | { ok: true; state: 'open' | 'closed'; reason: 'completed' | 'not_planned' | null }
  | { ok: false; reason: string }
> {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) {
    return { ok: false, reason: 'could not resolve project from issue ID' };
  }
  const project = getProjectSync(resolved.projectKey);
  const repo = parseGitHubRepo(project?.github_repo);
  if (!repo) {
    return { ok: false, reason: 'project does not have a github_repo configured' };
  }
  const parsed = parseIssueIdSync(issueId);
  if (!parsed) {
    return { ok: false, reason: 'could not parse issue ID' };
  }
  try {
    const state = await readGitHubCloseState(repo.owner, repo.repo, parsed.number);
    return { ok: true, ...state };
  } catch (error: any) {
    return { ok: false, reason: error.message ?? String(error) };
  }
}

async function sweepIssue(issueId: string, options: SweepOptions): Promise<
  | { kind: 'processed'; report: SweepIssueReport }
  | { kind: 'skipped-open' }
  | { kind: 'failed'; reason: string }
> {
  const trackerState = await resolveGitHubCloseState(issueId);
  if (!trackerState.ok) {
    return { kind: 'failed', reason: trackerState.reason };
  }

  if (trackerState.state === 'open') {
    return { kind: 'skipped-open' };
  }

  const reason = options.reason ?? defaultSweepReason(trackerState.reason);
  const result = await sweepOrphanedBeads({
    beadsCwd: process.cwd(),
    issueId,
    reason,
    dryRun: options.dryRun,
  });

  if (!result.ok) {
    return { kind: 'failed', reason: result.error ?? 'sweep failed' };
  }

  return {
    kind: 'processed',
    report: { issue: issueId, closedCount: result.closedIds.length, reason },
  };
}

async function enumerateClosedOrphanIssues(): Promise<
  | { ok: true; issueIds: string[]; openWithOrphans: string[]; unresolved: string[] }
  | { ok: false; reason: string }
> {
  const resolver = createBeadsResolver(process.cwd());
  const readResult = await resolver.getAllBeads();
  if (!readResult.ok) {
    return { ok: false, reason: readResult.reason };
  }

  const groups = groupBeadsByIssue(readResult.value);
  const issueIds: string[] = [];
  const openWithOrphans: string[] = [];
  const unresolved: string[] = [];

  const candidates = [...groups.entries()].filter(([, beads]) =>
    beads.some((bead) => isSweepable(bead.status)),
  );

  const trackerStates: Array<{
    issueId: string;
    trackerState: Awaited<ReturnType<typeof resolveGitHubCloseState>>;
  }> = [];
  for (const batch of chunk(candidates, 5)) {
    const batchResults = await Promise.all(
      batch.map(async ([issueId]) => ({
        issueId,
        trackerState: await resolveGitHubCloseState(issueId),
      })),
    );
    trackerStates.push(...batchResults);
  }

  for (const { issueId, trackerState } of trackerStates) {
    if (!trackerState.ok) {
      // Surface tracker-resolution failures so they are not silently dropped.
      unresolved.push(issueId);
      continue;
    }

    if (trackerState.state === 'closed') {
      issueIds.push(issueId);
    } else {
      openWithOrphans.push(issueId);
    }
  }

  return { ok: true, issueIds, openWithOrphans, unresolved };
}

async function sweepCommand(issueIds: string[], options: SweepOptions): Promise<void> {
  const report: SweepReport = { processed: [], skippedOpen: [], failed: [] };

  if (issueIds.length === 0 && !options.allClosed) {
    console.error(chalk.red('Error: pass issue IDs or use --all-closed to enumerate closed issues with orphaned beads'));
    process.exitCode = 1;
    return;
  }

  let targetIssueIds = issueIds;
  if (options.allClosed) {
    const spinner = ora('Enumerating issues with orphaned beads...').start();
    const enumeration = await enumerateClosedOrphanIssues();
    if (!enumeration.ok) {
      spinner.fail(`Enumeration failed: ${enumeration.reason}`);
      process.exitCode = 1;
      return;
    }
    spinner.succeed(`Found ${enumeration.issueIds.length} closed issue(s) with orphaned beads`);
    if (enumeration.openWithOrphans.length > 0) {
      report.skippedOpen = enumeration.openWithOrphans;
    }
    if (enumeration.unresolved.length > 0) {
      report.failed.push(...enumeration.unresolved.map((issue) => ({ issue, reason: 'could not resolve tracker state' })));
    }
    targetIssueIds = enumeration.issueIds;
  }

  for (const issueId of targetIssueIds) {
    const outcome = await sweepIssue(issueId, options);
    if (outcome.kind === 'processed') {
      report.processed.push(outcome.report);
    } else if (outcome.kind === 'skipped-open') {
      report.skippedOpen.push(issueId);
    } else {
      report.failed.push({ issue: issueId, reason: outcome.reason });
    }
  }

  // Per-issue report
  for (const item of report.processed) {
    const action = options.dryRun ? 'Would sweep' : 'Swept';
    console.log(`${action} ${chalk.cyan(item.issue)}: ${item.closedCount} bead(s) — ${item.reason}`);
  }
  if (report.skippedOpen.length > 0) {
    console.log(chalk.yellow(`\nOpen with orphaned beads (route back into pipeline): ${report.skippedOpen.join(', ')}`));
  }
  if (report.failed.length > 0) {
    console.log(chalk.red('\nFailures:'));
    for (const item of report.failed) {
      console.log(chalk.red(`  ${item.issue}: ${item.reason}`));
    }
  }

  // Totals
  const totals = {
    processed: report.processed.length,
    skipped: report.skippedOpen.length,
    failed: report.failed.length,
  };
  console.log('');
  console.log(`Total: ${totals.processed} processed, ${totals.skipped} skipped, ${totals.failed} failed`);

  if (report.failed.length > 0) {
    process.exitCode = 1;
  }
}

/**
 * Check if bd CLI is available
 */
async function isBdAvailable(): Promise<boolean> {
  try {
    await execAsync('which bd', { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get count of closed beads older than N days
 */
async function getOldClosedCount(cwd: string, days: number): Promise<number> {
  try {
    const seconds = days * 24 * 60 * 60;
    const { stdout } = await execAsync(
      `bd list --status closed --json 2>/dev/null | jq '[.[] | select(.closed_at != null) | select((now - (.closed_at | fromdateiso8601)) > ${seconds})] | length' 2>/dev/null || echo "0"`,
      { cwd, encoding: 'utf-8' }
    );
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Compact beads - remove closed issues older than N days
 */
async function compactCommand(options: CompactOptions): Promise<void> {
  const days = options.days || 30;
  const cwd = process.cwd();

  // Check if bd is available
  if (!(await isBdAvailable())) {
    console.error(chalk.red('Error: bd (beads) CLI not found in PATH'));
    console.log(chalk.dim('Install beads: https://github.com/gastownhall/beads'));
    process.exit(1);
  }

  // Check if .beads exists
  const beadsDir = join(cwd, '.beads');
  if (!existsSync(beadsDir)) {
    console.error(chalk.red('Error: No .beads directory found in current directory'));
    console.log(chalk.dim('Run pan sync to bootstrap the canonical beads home'));
    process.exit(1);
  }

  const spinner = ora('Checking for old closed beads...').start();

  try {
    // Get count of old closed beads
    const count = await getOldClosedCount(cwd, days);

    if (count === 0) {
      spinner.succeed('No closed beads older than ' + days + ' days found');
      return;
    }

    spinner.text = `Found ${count} closed beads older than ${days} days`;

    if (options.dryRun) {
      spinner.info(`Dry run: Would compact ${count} beads (use without --dry-run to execute)`);

      // Show what would be removed
      console.log('');
      console.log(chalk.bold('Beads that would be compacted:'));
      try {
        const { stdout: beadsList } = await execAsync(
          `bd list --status closed --json 2>/dev/null | jq -r '.[] | select(.closed_at != null) | select((now - (.closed_at | fromdateiso8601)) > ${days * 24 * 60 * 60}) | "  - \\(.id): \\(.title)"' 2>/dev/null`,
          { cwd, encoding: 'utf-8' }
        );
        console.log(beadsList || '  (none)');
      } catch {
        console.log(chalk.dim('  (could not list beads)'));
      }
      return;
    }

    // Run compaction
    spinner.text = 'Running compaction...';
    const compacted = await runMutationBatch(
      { project: { workspacePath: cwd }, reason: `compact beads older than ${days} days` },
      (bd) => bd.mutate(['admin', 'compact', '--days', String(days)]),
    );
    if (!compacted.ok) throw new Error(formatMutationBatchFailure(compacted));

    spinner.succeed(`Compacted ${count} beads older than ${days} days`);

    // Check for uncommitted changes
    try {
      await execAsync(`git diff --quiet .beads/`, { cwd, encoding: 'utf-8' });
      // No changes
      console.log(chalk.dim('No changes to commit (beads already up to date)'));
    } catch {
      // There are changes
      console.log('');
      console.log(chalk.bold('Changes detected in .beads/'));
      console.log(chalk.dim('To commit the compacted beads:'));
      console.log('');
      console.log('  git add .beads/');
      console.log('  git commit -m "chore: compact beads (remove closed issues > ' + days + ' days)"');
      console.log('  git push');
      console.log('');
    }

    if (options.json) {
      console.log(JSON.stringify({ success: true, compacted: count, days }, null, 2));
    }
  } catch (error: any) {
    spinner.fail('Compaction failed');
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

/**
 * Show beads statistics
 */
async function statsCommand(): Promise<void> {
  const cwd = process.cwd();

  if (!(await isBdAvailable())) {
    console.error(chalk.red('Error: bd (beads) CLI not found'));
    process.exit(1);
  }

  const beadsDir = join(cwd, '.beads');
  if (!existsSync(beadsDir)) {
    console.error(chalk.red('Error: No .beads directory found'));
    process.exit(1);
  }

  const spinner = ora('Gathering beads statistics...').start();

  try {
    // Get total count (--limit 0 = no limit)
    const { stdout: totalRaw } = await execAsync(`bd list --limit 0 --json 2>/dev/null | jq 'length'`, {
      cwd,
      encoding: 'utf-8',
    });
    const total = parseInt(totalRaw.trim(), 10) || 0;

    // Get open count
    const { stdout: openRaw } = await execAsync(`bd list --status open --limit 0 --json 2>/dev/null | jq 'length'`, {
      cwd,
      encoding: 'utf-8',
    });
    const open = parseInt(openRaw.trim(), 10) || 0;

    // Get closed count
    const { stdout: closedRaw } = await execAsync(`bd list --status closed --limit 0 --json 2>/dev/null | jq 'length'`, {
      cwd,
      encoding: 'utf-8',
    });
    const closed = parseInt(closedRaw.trim(), 10) || 0;

    // Get old closed count (30+ days)
    const oldClosed = await getOldClosedCount(cwd, 30);

    spinner.stop();

    console.log('');
    console.log(chalk.bold('Beads Statistics'));
    console.log('');
    console.log(`  Total:        ${chalk.cyan(total)}`);
    console.log(`  Open:         ${chalk.green(open)}`);
    console.log(`  Closed:       ${chalk.dim(closed)}`);
    console.log(`  Old (>30d):   ${oldClosed > 0 ? chalk.yellow(oldClosed) : chalk.dim(oldClosed)}`);
    console.log('');

    if (oldClosed > 0) {
      console.log(chalk.dim(`Tip: Run 'pan beads compact' to remove old closed beads`));
      console.log('');
    }
  } catch (error: any) {
    spinner.fail('Failed to get statistics');
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

export function registerBeadsCommands(program: Command): void {
  const beads = program.command('beads').description('Beads issue tracker management');
  registerBeadsReconcileCommand(beads);

  const mutate = async <T>(reason: string, fn: (bd: BdMutationClient) => Promise<T>): Promise<T> => {
    const result = await runMutationBatch({ project: { workspacePath: process.cwd() }, reason }, fn);
    if (!result.ok) throw new Error(formatMutationBatchFailure(result));
    return result.value;
  };

  beads.command('claim <ids...>')
    .description('Atomically claim one or more beads through the canonical writer')
    .action((ids: string[]) => mutate(`claim ${ids.join(', ')}`, async (bd) => {
      for (const id of ids) await bd.mutate(['update', id, '--claim']);
    }));

  beads.command('update <id>')
    .description('Update a bead through the canonical writer')
    .option('--status <status>')
    .option('--title <title>')
    .option('--priority <priority>')
    .option('--notes <notes>')
    .option('--description <description>')
    .option('--assignee <assignee>')
    .option('--add-label <label>')
    .option('--remove-label <label>')
    .action(async (id: string, options: Record<string, string | undefined>) => { await mutate(`update ${id}`, (bd) => {
      const args = ['update', id];
      for (const [key, value] of Object.entries(options)) if (value !== undefined) args.push(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value);
      return bd.mutate(args);
    }); });

  beads.command('close <ids...>')
    .description('Close beads and publish their Dolt commit durably')
    .option('--reason <reason>', 'Completion reason', 'completed')
    .action((ids: string[], options: { reason: string }) => mutate(`close ${ids.join(', ')}`, async (bd) => {
      for (const id of ids) await bd.mutate(['close', id, '--reason', options.reason]);
    }));

  beads.command('create [title]')
    .option('--title <title>')
    .option('--type <type>', 'Record type', 'task')
    .option('--priority <priority>', 'Priority', '2')
    .option('--labels <labels>')
    .option('--parent <parent>')
    .option('--description <description>')
    .option('--deps <dependencies>')
    .action((title: string | undefined, options: { title?: string; type: string; priority: string; labels?: string; parent?: string; description?: string; deps?: string }) => {
      const resolvedTitle = options.title ?? title;
      if (!resolvedTitle) throw new Error('pan beads create requires a title');
      return mutate(`create ${resolvedTitle}`, (bd) => {
      const args = ['create', '--title', resolvedTitle, '--type', options.type, '--priority', options.priority, '--json'];
      if (options.labels) args.push('--labels', options.labels);
      if (options.parent) args.push('--parent', options.parent);
      if (options.description) args.push('--description', options.description);
      if (options.deps) args.push('--deps', options.deps);
      return bd.mutate(args);
      }).then((output) => console.log(output));
    });

  const dep = beads.command('dep').description('Mutate bead dependencies through the canonical writer');
  for (const verb of ['add', 'remove'] as const) {
    dep.command(`${verb} <issue> <dependency>`)
      .option('--type <type>', 'Dependency type', 'blocks')
      .action(async (issue: string, dependency: string, options: { type: string }) => { await mutate(`dependency ${verb}`, (bd) => bd.mutate(['dep', verb, issue, dependency, '--type', options.type])); });
  }

  beads.command('delete <ids...>')
    .description('Delete beads through the canonical writer')
    .requiredOption('--yes', 'Confirm deletion')
    .action((ids: string[]) => mutate(`delete ${ids.join(', ')}`, async (bd) => {
      for (const id of ids) await bd.mutate(['delete', id, '--yes']);
    }));

  beads
    .command('sweep [issueIds...]')
    .description('Sweep orphaned open beads on GitHub-closed issues')
    .option('--all-closed', 'Enumerate all closed issues with orphaned beads')
    .option('--dry-run', 'Show what would be swept without mutating beads')
    .option('--reason <reason>', 'Override the default close reason')
    .action(async (issueIds: string[], options: SweepOptions) => {
      await sweepCommand(issueIds, options);
    });

  beads
    .command('compact')
    .description('Remove closed beads older than N days')
    .option('-d, --days <days>', 'Days threshold (default: 30)', '30')
    .option('--dry-run', 'Show what would be compacted without making changes')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      await compactCommand({
        days: parseInt(options.days, 10),
        dryRun: options.dryRun,
        json: options.json,
      });
    });

  beads
    .command('stats')
    .description('Show beads statistics')
    .action(async () => {
      await statsCommand();
    });

  beads
    .command('upgrade')
    .description('Upgrade beads CLI to latest version')
    .option('--check', 'Check for updates without installing')
    .action(async (options) => {
      await upgradeCommand(options.check);
    });

  beads
    .command('doctor')
    .description('Run bd doctor --fix to check and fix beads database issues')
    .option('--dry-run', 'Check only, do not fix')
    .action(async (options) => {
      await doctorCommand(options.dryRun);
    });
}

/**
 * Upgrade beads CLI to latest version
 */
async function upgradeCommand(checkOnly: boolean = false): Promise<void> {
  console.log(chalk.dim('Checking beads version...'));

  // Get current version
  let currentVersion = 'not installed';
  currentVersion = await readInstalledBdVersion() ?? currentVersion;

  // Get latest version from GitHub
  let latestVersion = 'unknown';
  try {
    const { stdout } = await execAsync(
      'curl -sL https://api.github.com/repos/gastownhall/beads/releases/latest | jq -r .tag_name',
      { encoding: 'utf-8' }
    );
    latestVersion = stdout.trim().replace(/^v/, '');
  } catch {}

  console.log('');
  console.log(chalk.bold('Beads CLI Version'));
  console.log('');
  console.log(`  Current: ${currentVersion === 'not installed' ? chalk.red(currentVersion) : chalk.cyan(currentVersion)}`);
  console.log(`  Latest:  ${chalk.green(latestVersion)}`);
  console.log('');

  if (currentVersion === latestVersion) {
    console.log(chalk.green('✓ Already on latest version'));
    return;
  }

  if (checkOnly) {
    if (currentVersion !== latestVersion && currentVersion !== 'not installed') {
      console.log(chalk.yellow(`Update available: ${currentVersion} → ${latestVersion}`));
      console.log(chalk.dim(`Run 'pan beads upgrade' to install`));
    }
    return;
  }

  // Perform upgrade
  const spinner = ora('Upgrading beads...').start();
  const plat = detectPlatform();

  try {
    if (plat === 'darwin') {
      // macOS - try homebrew upgrade
      try {
        execSync('brew upgrade gastownhall/beads/bd 2>/dev/null || brew install gastownhall/beads/bd', {
          stdio: 'pipe',
          timeout: 120000,
        });
        spinner.succeed('beads upgraded via Homebrew');
      } catch {
        // Fall back to install script
        execSync('curl -sSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash', {
          stdio: 'pipe',
          timeout: 120000,
        });
        spinner.succeed('beads upgraded via install script');
      }
    } else {
      // Linux/WSL - use install script
      execSync('curl -sSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash', {
        stdio: 'pipe',
        timeout: 120000,
      });
      spinner.succeed('beads upgraded via install script');
    }

    // Verify new version
    try {
      const installed = await readInstalledBdVersion();
      if (installed) {
        assertSupportedBdVersion(installed);
        console.log(chalk.green(`\n✓ Now running beads v${installed}`));
        console.log(chalk.dim('Schema adoption is a separate operator cutover: one designated migrator runs migrate and push; every other clone runs bd bootstrap.'));
      }
    } catch {}
  } catch (error: any) {
    spinner.fail('Upgrade failed');
    console.error(chalk.red(error.message));
    console.log('');
    console.log(chalk.dim('Manual upgrade:'));
    console.log(chalk.dim('  curl -sSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash'));
    process.exit(1);
  }
}

/**
 * Run bd doctor to check and fix beads database issues
 */
async function doctorCommand(dryRun: boolean = false): Promise<void> {
  const spinner = ora('Running beads doctor...').start();

  try {
    if (dryRun) {
      const { stdout } = await execAsync('bd doctor', { encoding: 'utf-8' });
      const standardized = await standardizeBeadsConfig(process.cwd(), true);
      spinner.succeed('Beads doctor check complete');
      console.log(stdout);
      if (!standardized.remoteMatches) console.log(chalk.yellow(`sync.remote does not match ${standardized.expectedRemote}; writes are blocked until reconciled.`));
      return;
    }

    const { stdout } = await execAsync('bd doctor --fix', { encoding: 'utf-8' });
    const standardized = await standardizeBeadsConfig(process.cwd());
    if (!standardized.remoteMatches) throw new Error(`sync.remote does not match ${standardized.expectedRemote}; writes are blocked until reconciled.`);
    spinner.succeed('Beads doctor fix complete');
    console.log(stdout);
  } catch (error: any) {
    // bd doctor exits non-zero when there are fixable issues, but still outputs useful info
    spinner.warn('Beads doctor completed with warnings');
    if (error.stdout) {
      console.log(error.stdout);
    }
    if (error.stderr) {
      console.error(chalk.yellow(error.stderr));
    }
  }
}
