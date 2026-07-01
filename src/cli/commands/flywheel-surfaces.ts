import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
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

/**
 * Sandbox-safe Flywheel data surfaces. These read state DIRECTLY (sequence.md + SQLite) and
 * emit no HTTP, so they work inside a network-isolated harness sandbox (e.g. codex's bwrap)
 * where the orchestrator cannot `curl http://127.0.0.1:3011/api/...`. They share the pickup
 * model (PAN-2006) and the merge-blocker model (PAN-1620) with the dashboard routes, so the
 * CLI and the dashboard can never disagree.
 */

const execAsync = promisify(exec);

/** Labels for all open issues, keyed by bare number — fetched via gh so it works inside a
 *  sandboxed harness (the in-memory issue service is server-only, unreachable from a CLI). */
async function fetchOpenIssueLabels(): Promise<Map<string, string[]>> {
  const byNumber = new Map<string, string[]>();
  try {
    const { stdout } = await execAsync('gh issue list --state open --json number,labels --limit 1000', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    for (const i of JSON.parse(stdout) as Array<{ number: number; labels: Array<{ name: string }> }>) {
      byNumber.set(String(i.number), i.labels.map((l) => l.name));
    }
  } catch { /* gh unavailable — labels stay empty (degraded, never throws) */ }
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
  const lk = buildClassifyLookups(projectRoot, { labels: (id) => labelsByNumber.get(id.replace(/^[A-Za-z]+-/, '')) ?? [] });
  const autoPickupBacklog = isFlywheelAutoPickupBacklog();
  const inFlight = nodes
    .map((x) => ({ issue: x.issue, rank: x.rank, state: classifyIssue(x, lk) }))
    .filter((x) => x.state.inPipeline)
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.issue);
  const needsPlanning = selectNeedsPlanning(nodes, lk, { cap: n * 2 }).map((x) => x.issue);
  const waves = computeWaves(nodes, lk, n, autoPickupBacklog).map((w) => w.map((x) => x.issue));
  const cohort = computeCohort(nodes, lk, n, autoPickupBacklog);
  const stats = computeStats(nodes, lk, autoPickupBacklog);
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

  const backlog = program.commands.find((c) => c.name() === 'backlog');
  backlog
    ?.command('forecast')
    .description('Pickup forecast (waves / needs-planning / cohort / stats) from sequence.md + SQLite — no HTTP (sandbox-safe)')
    .option('-n, --n <n>', 'Wave size (default 5)')
    .action((o: { n?: string }) => backlogForecastCommand(o));
}
