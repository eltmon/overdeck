import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Command } from 'commander';
import { parseSequenceMd } from '../../lib/backlog/sequence-io.js';
import { buildClassifyLookups } from '../../lib/backlog/lookups.js';
import {
  classifyIssue,
  computeWaves,
  computeCohort,
  computeStats,
  selectNeedsPlanning,
} from '../../lib/backlog/pickup.js';
import { isFlywheelAutoPickupBacklog } from '../../lib/overdeck/control-settings.js';
import { getMergeBlockersPayload } from '../../lib/cloister/merge-blockers.js';
import { activeOrderBookIssues } from '../../lib/cloister/flywheel.js';
import { listSubstrateBugWeights, type WeightedSubstrateBug } from '../../lib/overdeck/substrate-bug-weights-service.js';

/**
 * Sandbox-safe Flywheel data surfaces. These read state DIRECTLY (sequence.md + SQLite) and
 * emit no HTTP, so they work inside a network-isolated harness sandbox (e.g. codex's bwrap)
 * where the orchestrator cannot `curl http://127.0.0.1:3011/api/...`. They share the pickup
 * model (PAN-2006) and the merge-blocker model (PAN-1620) with the dashboard routes, so the
 * CLI and the dashboard can never disagree.
 */

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function parseGitHubRemoteUrl(remoteUrl: string): { owner: string; repo: string } | null {
  const trimmed = remoteUrl.trim();
  const match = trimmed.match(/github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]! };
}

async function resolveGitHubOwnerRepo(): Promise<{ owner: string; repo: string }> {
  const { stdout } = await execAsync('git remote get-url origin', { encoding: 'utf8' });
  const repo = parseGitHubRemoteUrl(stdout);
  if (!repo) throw new Error('origin is not a GitHub repository');
  return repo;
}

/** Labels for all open issues, keyed by bare number. This must fail rather than make a
 *  label-dependent forecast indistinguishable from an empty backlog. */
export async function fetchOpenIssueLabels(): Promise<Map<string, string[]>> {
  const repo = await resolveGitHubOwnerRepo();
  const { stdout } = await execFileAsync(
    'gh',
    ['api', '--paginate', '--slurp', `repos/${repo.owner}/${repo.repo}/issues?state=open&per_page=100`],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  const pages = JSON.parse(stdout || '[]') as Array<Array<{
    number: number;
    pull_request?: unknown;
    labels?: Array<{ name?: string | null } | string>;
  }>>;
  const byNumber = new Map<string, string[]>();
  for (const issue of pages.flat()) {
    if (issue.pull_request) continue;
    byNumber.set(String(issue.number), (issue.labels ?? [])
      .map((label) => typeof label === 'string' ? label : label.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0));
  }
  return byNumber;
}

/** `pan backlog forecast` — the pickup forecast (pickable waves, needs-planning, cohort, stats). */
export async function backlogForecastCommand(opts: { n?: string } = {}): Promise<void> {
  const projectRoot = process.cwd();
  const n = Math.max(1, Math.min(20, Number.parseInt(opts.n ?? '5', 10) || 5));
  const seqPath = join(projectRoot, '.pan', 'backlog', 'sequence.md');
  if (!existsSync(seqPath)) {
    console.log(JSON.stringify({ n, stats: null, inFlight: [], needsPlanning: [], waves: [], cohort: [] }, null, 2));
    return;
  }
  const parsed = parseSequenceMd(readFileSync(seqPath, 'utf-8'));
  if (!parsed.ok) {
    console.error(`parse error: ${parsed.error}`);
    process.exitCode = 1;
    return;
  }
  const nodes = parsed.doc.nodes;
  const labelsByNumber = await fetchOpenIssueLabels();
  const lk = buildClassifyLookups(projectRoot, {
    labels: (id) => labelsByNumber.get(id.replace(/^[A-Za-z]+-/, '')) ?? [],
  });
  const autoPickupBacklog = isFlywheelAutoPickupBacklog();
  const inFlight = nodes
    .map((x) => ({ issue: x.issue, rank: x.rank, state: classifyIssue(x, lk) }))
    .filter((x) => x.state.inPipeline)
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.issue);
  const needsPlanning = selectNeedsPlanning(nodes, lk, { cap: n * 2 }).map((x) => x.issue);
  const orderBookIssues = await activeOrderBookIssues(projectRoot);
  const waves = computeWaves(nodes, lk, n, autoPickupBacklog, orderBookIssues).map((w) => w.map((x) => x.issue));
  const cohort = computeCohort(nodes, lk, n, autoPickupBacklog, orderBookIssues);
  const stats = computeStats(nodes, lk, autoPickupBacklog, orderBookIssues);
  console.log(JSON.stringify({ n, autoPickupBacklog, stats, inFlight, needsPlanning, waves, cohort }, null, 2));
}

/** `pan flywheel merge-blockers` — PRs that passed review but cannot merge (GitHub-native reasons). */
export function flywheelMergeBlockersCommand(opts: { json?: boolean } = {}): void {
  const blockers = getMergeBlockersPayload();
  if (opts.json) {
    console.log(JSON.stringify(blockers, null, 2));
    return;
  }
  if (blockers.length === 0) {
    console.log('No merge-blocked PRs.');
    return;
  }
  for (const b of blockers) {
    const reasonTypes = b.reasons.map((r) => r.type).join(', ');
    console.log(`${b.issueId}  [${reasonTypes}]${b.prUrl ? `  ${b.prUrl}` : ''}`);
    for (const r of b.reasons) console.log(`    - ${r.type}: ${r.summary}`);
  }
}

/** `pan flywheel weights` — substrate bugs ranked by affected v1.0 criterion weight. */
export async function flywheelWeightsCommand(opts: { issue?: string; window?: string; json?: boolean } = {}): Promise<void> {
  const rows = await listSubstrateBugWeights(opts.window ?? '30d');
  const targetIssue = opts.issue?.toUpperCase();
  const filtered = targetIssue ? rows.filter((r) => r.issueId === targetIssue) : rows;

  if (opts.json) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  if (filtered.length === 0) {
    console.log('No weighted substrate bugs in window.');
    return;
  }

  const issueWidth = Math.max(...filtered.map((r) => r.issueId.length));
  const severityWidth = Math.max(...filtered.map((r) => r.severity.length));
  const weightWidth = Math.max(...filtered.map((r) => String(r.weight).length));

  for (const r of filtered) {
    console.log(
      `${r.issueId.padEnd(issueWidth)}  ${r.severity.padEnd(severityWidth)}  ${String(r.weight).padStart(weightWidth)}  ${r.weightReason}`,
    );
  }
}

/**
 * Attaches the sandbox-safe surface subcommands onto the already-registered `flywheel` and
 * `backlog` commands. Kept here (not in flywheel.ts) so flywheel.ts stays under the file-size
 * ceiling. Call AFTER registerFlywheelCommands(program) and the backlog command are set up.
 */
export function registerFlywheelSurfaceCommands(program: Command): void {
  const flywheel = program.commands.find((c) => c.name() === 'flywheel');
  flywheel
    ?.command('merge-blockers')
    .description('PRs that passed review but cannot merge (GitHub-native reasons) — reads SQLite directly, no HTTP (sandbox-safe)')
    .option('--json', 'Output JSON')
    .action((o: { json?: boolean }) => flywheelMergeBlockersCommand(o));

  flywheel
    ?.command('weights')
    .description('Weighted substrate bugs by affected v1.0 criterion — reads SQLite directly, no HTTP (sandbox-safe)')
    .option('--issue <id>', 'Filter to a single issue')
    .option('--window <dur>', 'Stats window like 30d, 7d (default 30d)')
    .option('--json', 'Output JSON')
    .action((o: { issue?: string; window?: string; json?: boolean }) => flywheelWeightsCommand(o));

  const backlog = program.commands.find((c) => c.name() === 'backlog');
  backlog
    ?.command('forecast')
    .description('Pickup forecast (waves / needs-planning / cohort / stats) from sequence.md + SQLite — no HTTP (sandbox-safe)')
    .option('-n, --n <n>', 'Wave size (default 5)')
    .action((o: { n?: string }) => backlogForecastCommand(o));
}
