/**
 * pan conversations show <id> — show detailed session info (PAN-457)
 */

import chalk from 'chalk';
import { getDiscoveredSessionById } from '../../../lib/database/discovered-sessions-db.js';

export async function showAction(id: string, opts: { json?: boolean }): Promise<void> {
  const sessionId = parseInt(id, 10);
  if (isNaN(sessionId)) {
    console.error(chalk.red(`Invalid session ID: ${id}`));
    process.exit(1);
  }

  const session = getDiscoveredSessionById(sessionId);
  if (!session) {
    console.error(chalk.red(`Session ${sessionId} not found`));
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(session, null, 2));
    return;
  }

  const field = (label: string, value: unknown): void => {
    const v = value == null ? chalk.dim('—') : String(value);
    console.log(`  ${chalk.bold(label.padEnd(18))} ${v}`);
  };

  const yn = (v: boolean) => (v ? chalk.green('yes') : chalk.dim('no'));

  console.log();
  console.log(chalk.bold(`Session #${session.id}`));
  console.log(chalk.dim('─'.repeat(60)));
  field('JSONL path', session.jsonlPath);
  field('Workspace', session.workspacePath ?? '—');
  field('Messages', session.messageCount);
  field('First active', session.firstTs);
  field('Last active', session.lastTs);
  field('Primary model', session.primaryModel);
  field('Models used', session.modelsUsed.join(', ') || '—');
  field('Input tokens', session.tokenInput);
  field('Output tokens', session.tokenOutput);
  field('Est. cost', session.estimatedCost > 0 ? `$${session.estimatedCost.toFixed(6)}` : '—');
  field('Tools used', session.toolsUsed.join(', ') || '—');
  field('Panopticon', yn(session.panopticonManaged));
  if (session.panIssueId) field('Issue ID', session.panIssueId);

  console.log();
  console.log(chalk.bold('Enrichment'));
  console.log(chalk.dim('─'.repeat(60)));
  field('Level', session.enrichmentLevel === 0 ? chalk.dim('none') : `L${session.enrichmentLevel}`);
  field('Model', session.enrichmentModel ?? '—');
  field('Failed', yn(session.enrichmentFailed));

  if (session.summary) {
    console.log();
    console.log(chalk.bold('Summary'));
    console.log(chalk.dim('─'.repeat(60)));
    console.log(`  ${session.summary}`);
  }

  if (session.summaryDetailed) {
    console.log();
    console.log(chalk.bold('Detailed Summary'));
    console.log(chalk.dim('─'.repeat(60)));
    console.log(`  ${session.summaryDetailed}`);
  }

  if (session.tags.length > 0) {
    console.log();
    console.log(chalk.bold('Tags'));
    console.log(chalk.dim('─'.repeat(60)));
    console.log(`  ${session.tags.map((t) => chalk.cyan(t)).join('  ')}`);
  }

  console.log();
}
