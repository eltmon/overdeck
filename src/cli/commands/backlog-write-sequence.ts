/**
 * `pan backlog write-sequence <file>` (PAN-5357 WI-2).
 *
 * Validates a SequenceDoc JSON file, writes it to `.pan/backlog/sequence.md`
 * (see `writeSequenceMd`, which skips the rewrite when only `generatedAt`
 * would change), then commits and pushes `.pan/backlog` as always — an
 * unchanged write leaves `commitPlanArtifacts` nothing to stage, so no-op
 * commits stop without skipping the commit/push calls that recover a prior
 * write that failed to commit or push (D3).
 */

import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { exitCli } from '../exit.js';
import { parseSequenceJson } from '../../lib/backlog/types.js';
import { writeSequenceMd } from '../../lib/backlog/sequence-io.js';
import { commitPlanArtifacts, pushPlanArtifacts } from '../../lib/overdeck/plan-artifact-commit.js';
import { surfacePlanArtifactPush } from '../../lib/overdeck/plan-artifact-push-report.js';
import { resolvePlanHome } from '../../lib/pan-dir/paths.js';

export async function backlogWriteSequenceCommand(file: string, opts: { projectRoot?: string }): Promise<void> {
  const projectRoot = opts.projectRoot ?? process.cwd();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error(chalk.red(`Error: could not read ${file}: ${e instanceof Error ? e.message : String(e)}`));
    return exitCli(1);
  }
  const result = parseSequenceJson(raw);
  if (!result.ok) {
    console.error(chalk.red(`Validation error: ${result.error}`));
    return exitCli(1);
  }

  const { written } = writeSequenceMd(projectRoot, result.doc);
  // Whoever writes a .pan/ artifact commits it; the sequence commit is pushed too (PAN-3923).
  // PAN-5357 D3: commit and push even when unchanged. An untouched file gives git
  // nothing to commit, and a write that failed to commit or push earlier still lands.
  const planHome = resolvePlanHome(projectRoot);
  const commit = await commitPlanArtifacts({ cwd: planHome, paths: ['.pan/backlog'], message: 'chore(workspace): backlog sequence' });
  if (written) {
    console.log(chalk.green(`✓ Wrote .pan/backlog/sequence.md (${result.doc.nodes.length} nodes, pass=${result.doc.pass})`));
  } else if (commit.committed) {
    console.log(chalk.green('✓ .pan/backlog/sequence.md unchanged; committed an earlier uncommitted sequence write'));
  } else {
    console.log(chalk.green('✓ .pan/backlog/sequence.md unchanged (only generatedAt differs), not committed'));
  }
  if (!commit.committed && commit.reason !== 'nothing to commit') {
    console.error(chalk.yellow(`  ⚠ Could not commit the sequence: ${commit.reason}`));
  } else {
    const push = await pushPlanArtifacts(planHome);
    const description = await surfacePlanArtifactPush(push, { planHome, command: 'pan backlog write-sequence' });
    if (description) console.error(chalk.yellow(`  ⚠ Sequence push: ${description.message}`));
  }
}
