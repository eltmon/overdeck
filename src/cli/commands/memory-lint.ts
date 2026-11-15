/**
 * `pan memory lint` (PAN-5360 W11, D15, D19, NFR-4): an advisory report of badly
 * linked, duplicate and contradicting curated facts in one store. It never edits a
 * fact and exits 0 after any report; it exits 1 only for invalid flags or a store
 * that cannot be resolved.
 */
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import chalk from 'chalk';
import type { MemoryIdentity } from '@overdeck/contracts';
import { lintMemoryFacts, type MemoryLintReport } from '../../lib/memory/facts/lint.js';
import type { ContradictionJudge } from '../../lib/memory/facts/lint-contradictions.js';
import type { Embedder } from '../../lib/memory/facts/lint-similarity.js';
import { resolveProjectKeyForCwdAsync } from '../../lib/projects.js';
import { exitCli } from '../exit.js';
import { type FactTarget, type FactTargetFlags, resolveFactTarget } from './memory-facts.js';

export interface MemoryLintOptions extends FactTargetFlags {
  threshold?: string;
  /** Commander sets this false for `--no-llm`. */
  llm?: boolean;
  json?: boolean;
  /** Injectable for tests; `undefined` uses the configured embedder. */
  embedder?: Embedder | null;
  /** Injectable for tests; defaults to the memory extraction provider. */
  judge?: ContradictionJudge;
}

function parseThreshold(text: string | undefined): number | undefined | null {
  if (text === undefined) return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : null;
}

/** D18: a synthetic identity so the judge's cost is attributed to memory lint, not to a session. */
async function lintIdentity(target: FactTarget, options: MemoryLintOptions): Promise<MemoryIdentity> {
  let projectId = target.scope === 'user' ? 'operator' : 'machine';
  if (target.scope === 'project') {
    projectId = options.project ?? (await resolveProjectKeyForCwdAsync(process.cwd())) ?? 'project';
  }
  return {
    projectId,
    workspaceId: 'memory-lint',
    issueId: null,
    runId: 'memory-lint',
    sessionId: `memory-lint-${randomUUID()}`,
    agentRole: 'conversation',
    agentHarness: 'overdeck',
  };
}

function formatReport(report: MemoryLintReport): string[] {
  const lines: string[] = [];
  lines.push(`Memory lint: ${report.dir} (${report.activeCount} active of ${report.factCount} facts; similarity: ${report.similarity.method})`);
  if (report.similarity.fallbackReason) lines.push(`Similarity fell back to lexical: ${report.similarity.fallbackReason}`);

  if (report.problems.length > 0) {
    lines.push('Problems:');
    for (const problem of report.problems) lines.push(`  ${problem.file}: ${problem.reason}`);
  }

  lines.push('Links:');
  if (report.links.length === 0) lines.push('  none');
  for (const finding of report.links) lines.push(`  ${finding.id}: ${finding.message}`);

  lines.push(`Duplicates (similarity >= ${report.similarity.duplicateThreshold.toFixed(2)}):`);
  if (report.duplicates.length === 0) lines.push('  none');
  for (const pair of report.duplicates) lines.push(`  ${pair.a} <-> ${pair.b}  ${pair.score.toFixed(2)}`);

  const contradictions = report.contradictions;
  if (contradictions.status !== 'checked') {
    lines.push(`Contradictions: ${contradictions.status} (${contradictions.reason ?? 'no reason given'})`);
  } else {
    const judge = contradictions.provider ? `${contradictions.provider}/${contradictions.model ?? 'unknown'}, ` : '';
    const failed = contradictions.pairsFailed > 0 ? `, ${contradictions.pairsFailed} failed` : '';
    lines.push(`Contradictions (${judge}${contradictions.pairsChecked} pairs checked${failed}):`);
    if (contradictions.findings.length === 0) lines.push('  none');
    for (const finding of contradictions.findings) lines.push(`  ${finding.a} <-> ${finding.b}: ${finding.reason}`);
  }
  return lines;
}

export async function memoryLintCommand(options: MemoryLintOptions): Promise<void> {
  const threshold = parseThreshold(options.threshold);
  if (threshold === null) {
    console.error(chalk.red(`--threshold must be a number greater than 0 and at most 1 (got "${options.threshold}")`));
    return exitCli(1);
  }

  let target: FactTarget;
  try {
    target = resolveFactTarget(options, 'read');
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    return exitCli(1);
  }

  const report = await lintMemoryFacts({
    dir: target.dir,
    scope: target.scope,
    threshold,
    llm: options.llm !== false,
    embedder: options.embedder,
    judge: options.judge,
    identity: await lintIdentity(target, options),
  });

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else for (const line of formatReport(report)) console.log(line);
}

export function registerMemoryLintCommand(memory: Command): void {
  memory
    .command('lint')
    .description('Report duplicate, contradicting and badly linked memory facts (advisory; never edits)')
    .option('--threshold <n>', 'Duplicate similarity threshold, 0-1 (default depends on the method)')
    .option('--no-llm', 'Skip the LLM contradiction pass')
    .option('--project <key>', 'Project key (defaults to the project owning the cwd)')
    .option('--user', 'Lint the operator store (travels with you; synced when set up)')
    .option('--machine', 'Lint the machine store (this machine only)')
    .option('--here', "Lint the cwd checkout's store instead of the primary checkout")
    .option('--json', 'Output JSON')
    .action(memoryLintCommand);
}
