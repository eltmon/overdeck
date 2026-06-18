/**
 * pan conversations list — list discovered sessions with structured filters (PAN-457)
 */

import chalk from 'chalk';
import { findDiscoveredSessions } from '../../../lib/database/discovered-sessions-db.js';
import { parseRelativeTime } from '../../../lib/conversations/search.js';
import { formatTable, formatBrief, formatIds } from './format.js';

export async function listAction(opts: Record<string, string | boolean | undefined>): Promise<void> {
  const limit = parseInt((opts['limit'] as string) ?? '50', 10);
  const offset = parseInt((opts['offset'] as string) ?? '0', 10);
  const format = (opts['format'] as string) ?? 'table';

  const filter: Parameters<typeof findDiscoveredSessions>[0] = { limit, offset };
  if (opts['workspace']) filter.workspacePath = opts['workspace'] as string;
  if (opts['model']) filter.primaryModel = opts['model'] as string;
  if (opts['since']) filter.since = parseRelativeTime(opts['since'] as string);
  if (opts['managed']) filter.managed = true;
  if (opts['enriched']) filter.enriched = true;

  const sessions = findDiscoveredSessions(filter);

  if (sessions.length === 0) {
    console.log(chalk.dim('No sessions found.'));
    return;
  }

  switch (format) {
    case 'json':
      console.log(JSON.stringify(sessions, null, 2));
      break;
    case 'brief':
      formatBrief(sessions);
      break;
    case 'ids':
      formatIds(sessions);
      break;
    default:
      formatTable(sessions);
      if (sessions.length === limit) {
        console.log(chalk.dim(`  Showing ${limit} results (use --offset to paginate)`));
      }
  }
}
