/**
 * pan conversations search — FTS5 + filter + semantic search (PAN-457)
 */

import chalk from 'chalk';
import { searchSessions } from '../../../lib/conversations/search.js';
import type { RawFilter } from '../../../lib/conversations/search.js';
import { formatTable, formatBrief, formatIds } from './format.js';

export async function searchAction(
  query: string | undefined,
  opts: Record<string, string | boolean | undefined>,
): Promise<void> {
  const limit = parseInt((opts['limit'] as string) ?? '20', 10);
  const offset = parseInt((opts['offset'] as string) ?? '0', 10);
  const format = (opts['format'] as string) ?? 'table';

  const filter: RawFilter = {};
  if (opts['workspace']) filter.workspacePath = opts['workspace'] as string;
  if (opts['model']) filter.primaryModel = opts['model'] as string;
  if (opts['since']) filter.since = opts['since'] as string;
  if (opts['before']) filter.before = opts['before'] as string;
  if (opts['minCost']) filter.minCost = parseFloat(opts['minCost'] as string);
  if (opts['maxCost']) filter.maxCost = parseFloat(opts['maxCost'] as string);
  if (opts['managed']) filter.managed = true;
  if (opts['tags']) filter.tags = (opts['tags'] as string).split(',').map((t) => t.trim());

  const similarTo = opts['similar'] ? parseInt(opts['similar'] as string, 10) : undefined;

  const result = searchSessions({
    q: query?.trim() || undefined,
    similarTo,
    filter,
    limit,
    offset,
  });

  if (result.sessions.length === 0) {
    console.log(chalk.dim('No sessions found.'));
    return;
  }

  switch (format) {
    case 'json':
      console.log(JSON.stringify(result.sessions, null, 2));
      break;
    case 'brief':
      formatBrief(result.sessions);
      break;
    case 'ids':
      formatIds(result.sessions);
      break;
    default: {
      formatTable(result.sessions);
      const showing = `${offset + 1}–${offset + result.sessions.length} of ${result.total}`;
      const moreHint = result.total > offset + result.sessions.length
        ? chalk.dim(` (--offset ${offset + result.sessions.length} for next page)`)
        : '';
      console.log(chalk.dim(`  Mode: ${result.mode} · showing ${showing} · ${result.durationMs}ms`) + moreHint);
      break;
    }
  }
}
