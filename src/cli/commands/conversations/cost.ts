/**
 * pan conversations cost — summarize API costs across sessions (PAN-457)
 */

import chalk from 'chalk';
import { findDiscoveredSessions } from '../../../lib/database/discovered-sessions-db.js';
import { parseRelativeTime } from '../../../lib/conversations/search.js';

type GroupBy = 'workspace' | 'model' | 'day' | 'month';

interface CostRow {
  key: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export async function costAction(opts: Record<string, string | boolean | undefined>): Promise<void> {
  const groupBy = (opts['by'] as GroupBy) ?? 'workspace';
  const asJson = Boolean(opts['json']);

  const filter: Parameters<typeof findDiscoveredSessions>[0] = {};
  if (opts['since']) filter.since = parseRelativeTime(opts['since'] as string);
  if (opts['workspace']) filter.workspacePath = opts['workspace'] as string;

  const sessions = findDiscoveredSessions(filter);

  if (sessions.length === 0) {
    console.log(chalk.dim('No sessions found.'));
    return;
  }

  // Group sessions
  const groups = new Map<string, CostRow>();

  for (const s of sessions) {
    const key = resolveGroupKey(s, groupBy);
    let row = groups.get(key);
    if (!row) {
      row = { key, sessions: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
      groups.set(key, row);
    }
    row.sessions++;
    row.inputTokens += s.tokenInput;
    row.outputTokens += s.tokenOutput;
    row.estimatedCost += s.estimatedCost;
  }

  const rows = [...groups.values()].sort((a, b) => b.estimatedCost - a.estimatedCost);

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const totalCost = rows.reduce((sum, r) => sum + r.estimatedCost, 0);
  const totalSessions = rows.reduce((sum, r) => sum + r.sessions, 0);

  console.log();
  console.log(chalk.bold(`Cost Summary — by ${groupBy}`));
  console.log(chalk.dim('─'.repeat(80)));

  const keyWidth = Math.min(40, Math.max(...rows.map((r) => r.key.length)));
  const header = `  ${'Group'.padEnd(keyWidth)}  ${'Sessions'.padEnd(8)}  ${'Input'.padEnd(10)}  ${'Output'.padEnd(10)}  Cost`;
  console.log(chalk.bold(header));
  console.log(chalk.dim('─'.repeat(80)));

  for (const row of rows) {
    const key = row.key.length > keyWidth ? '…' + row.key.slice(row.key.length - keyWidth + 1) : row.key;
    const cost = row.estimatedCost > 0 ? chalk.yellow(`$${row.estimatedCost.toFixed(4)}`) : chalk.dim('—');
    console.log(
      `  ${key.padEnd(keyWidth)}  ${String(row.sessions).padEnd(8)}  ${formatTokens(row.inputTokens).padEnd(10)}  ${formatTokens(row.outputTokens).padEnd(10)}  ${cost}`,
    );
  }

  console.log(chalk.dim('─'.repeat(80)));
  console.log(`  ${'TOTAL'.padEnd(keyWidth)}  ${String(totalSessions).padEnd(8)}  ${''.padEnd(22)}  ${chalk.bold.yellow(`$${totalCost.toFixed(4)}`)}`);
  console.log();
}

function resolveGroupKey(
  s: { workspacePath: string | null; primaryModel: string | null; lastTs: string | null },
  groupBy: GroupBy,
): string {
  switch (groupBy) {
    case 'workspace': return s.workspacePath ?? '(unknown)';
    case 'model': return s.primaryModel ?? '(unknown)';
    case 'day': return s.lastTs ? s.lastTs.slice(0, 10) : '(unknown)';
    case 'month': return s.lastTs ? s.lastTs.slice(0, 7) : '(unknown)';
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
