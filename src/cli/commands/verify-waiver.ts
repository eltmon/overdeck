/**
 * `pan verify waive-test-removal <id> --reason "…"` (PAN-3906).
 *
 * Records the one judgment the test-skip gate cannot make mechanically: these
 * tests are genuinely gone and nothing replaces them. The waiver is pinned to
 * the workspace's current head anchor, so it expires the moment the branch
 * moves, and it covers `removed-test` only — an added `.skip`/`.only` still
 * fails the gate. Operator-conversation-only, like the other honesty overrides
 * in `pan close`: a pipeline agent that could waive its own coverage loss is
 * not a gate.
 */
import chalk from 'chalk';
import { existsSync } from 'node:fs';
import type { Command } from 'commander';

import { snapshotWorkspaceHeadsPromise, formatAnchorShort } from '../../lib/git-utils.js';
import { getIssueWorkspacePath, resolveProjectForIssue } from '../../lib/pan-dir/record.js';
import { updateIssueRecord } from '../../lib/pan-dir/record-update.js';

export interface WaiveTestRemovalOptions {
  reason?: string;
}

export async function waiveTestRemovalCommand(id: string, options: WaiveTestRemovalOptions): Promise<void> {
  const issueId = id.toUpperCase();

  const agentId = process.env.OVERDECK_AGENT_ID;
  if (agentId && !agentId.startsWith('conv-')) {
    console.error(chalk.red(
      'Waiving a test removal is operator-conversation-only (conv-*). A pipeline agent may not waive the coverage loss it just produced.',
    ));
    process.exitCode = 1;
    return;
  }

  const reason = options.reason?.trim();
  if (!reason) {
    console.error(chalk.red('--reason is required: the waiver is a durable record of why the tests are gone.'));
    process.exitCode = 1;
    return;
  }

  const project = resolveProjectForIssue(issueId);
  if (!project) {
    console.error(chalk.red(`No project resolves for ${issueId}.`));
    process.exitCode = 1;
    return;
  }

  const workspacePath = getIssueWorkspacePath(issueId);
  if (!workspacePath || !existsSync(workspacePath)) {
    console.error(chalk.red(`No workspace found for ${issueId} at ${workspacePath ?? '<unresolved>'}.`));
    console.error(chalk.dim('The waiver pins to the branch head under verification, so the workspace must exist.'));
    process.exitCode = 1;
    return;
  }

  const sha = await snapshotWorkspaceHeadsPromise(issueId, workspacePath);
  if (!sha) {
    console.error(chalk.red(`Could not read the head of ${workspacePath} — refusing to record an unpinned waiver.`));
    process.exitCode = 1;
    return;
  }

  const waiver = { sha: sha as string, reason, at: new Date().toISOString(), by: agentId ?? 'operator' };
  await updateIssueRecord(project, issueId, (record) => {
    record.pipeline.testSkipWaiver = waiver;
    record.pipeline.updatedAt = waiver.at;
  });

  console.log(chalk.green(`Waived test removal for ${issueId} at ${formatAnchorShort(waiver.sha)}.`));
  console.log(chalk.dim(`Reason: ${reason}`));
  console.log(chalk.dim('The waiver expires as soon as the branch head moves. It never waives an added .skip/.only.'));
}

export function registerVerifyCommands(program: Command): void {
  const verify = program.command('verify').description('Verification-gate overrides');
  verify
    .command('waive-test-removal <id>')
    .description('Record an operator waiver letting a net test-call removal past the test-skip gate at the current head')
    .requiredOption('--reason <reason>', 'Why the removed tests are not coming back')
    .action((id: string, options: WaiveTestRemovalOptions) => waiveTestRemovalCommand(id, options));
}
