/**
 * Register pan conversations subcommands (PAN-457)
 */

import { Command } from 'commander';
import { scanAction } from './scan.js';
import { searchAction } from './search.js';
import { listAction } from './list.js';
import { showAction } from './show.js';
import { costAction } from './cost.js';
import { enrichAction } from './enrich.js';

export function registerConversationsCommands(program: Command): void {
  const conversations = program
    .command('conversations')
    .alias('conv')
    .description('Discover, index, and search Claude Code session history');

  // ── scan ────────────────────────────────────────────────────────────────────
  conversations
    .command('scan')
    .description('Scan ~/.claude/projects/ and index discovered sessions')
    .option('--mode <mode>', 'Scan mode: system | watched | targeted', 'system')
    .option('--dir <path...>', 'Directories to scan (targeted mode only)')
    .option('--dry-run', 'Preview without writing to database')
    .option('--max-parallel <n>', 'Override parallelism (default: auto)')
    .action((opts: { mode?: string; dryRun?: boolean; dir?: string[]; maxParallel?: string }) =>
      scanAction({ ...opts, dirs: opts.dir }),
    );

  // ── search ──────────────────────────────────────────────────────────────────
  conversations
    .command('search [query]')
    .description('Full-text search across session summaries and tags')
    .option('--workspace <path>', 'Filter by workspace path')
    .option('--model <name>', 'Filter by primary model')
    .option('--since <time>', 'Filter sessions after time (ISO or "7d", "today")')
    .option('--before <time>', 'Filter sessions before time')
    .option('--min-cost <n>', 'Filter by minimum estimated cost')
    .option('--max-cost <n>', 'Filter by maximum estimated cost')
    .option('--managed', 'Show only Panopticon-managed sessions')
    .option('--tags <tags>', 'Filter by tags (comma-separated)')
    .option('--similar <id>', 'Find sessions similar to this session ID (semantic)')
    .option('--format <fmt>', 'Output format: table | json | brief | ids', 'table')
    .option('--limit <n>', 'Maximum results', '20')
    .option('--offset <n>', 'Pagination offset', '0')
    .action((query: string | undefined, opts: Record<string, string | boolean | undefined>) =>
      searchAction(query, opts),
    );

  // ── list ────────────────────────────────────────────────────────────────────
  conversations
    .command('list')
    .description('List discovered sessions with structured filters')
    .option('--workspace <path>', 'Filter by workspace path')
    .option('--model <name>', 'Filter by primary model')
    .option('--since <time>', 'Sessions after time (ISO or relative)')
    .option('--managed', 'Show only Panopticon-managed sessions')
    .option('--enriched', 'Show only enriched sessions')
    .option('--format <fmt>', 'Output: table | json | brief | ids', 'table')
    .option('--limit <n>', 'Maximum results', '50')
    .option('--offset <n>', 'Pagination offset', '0')
    .action((opts: Record<string, string | boolean | undefined>) => listAction(opts));

  // ── show ────────────────────────────────────────────────────────────────────
  conversations
    .command('show <id>')
    .description('Show detailed information for a session by ID')
    .option('--json', 'Output as JSON')
    .action((id: string, opts: { json?: boolean }) => showAction(id, opts));

  // ── cost ────────────────────────────────────────────────────────────────────
  conversations
    .command('cost')
    .description('Summarize estimated API costs across discovered sessions')
    .option('--since <time>', 'Summarize sessions since time (ISO or relative)')
    .option('--workspace <path>', 'Filter by workspace path')
    .option('--by <field>', 'Group by: workspace | model | day | month', 'workspace')
    .option('--json', 'Output as JSON')
    .action((opts: Record<string, string | boolean | undefined>) => costAction(opts));

  // ── enrich ──────────────────────────────────────────────────────────────────
  conversations
    .command('enrich')
    .description('Enrich sessions with AI-generated summaries and tags')
    .option('--tier <n>', 'Enrichment tier: 1 (quick) | 2 (detailed) | 3 (deep)', '1')
    .option('--ids <ids>', 'Comma-separated session IDs to enrich (default: all unenriched)')
    .option('--max-parallel <n>', 'Override parallelism')
    .option('--yes', 'Skip cost confirmation prompt')
    .action((opts: Record<string, string | boolean | undefined>) => enrichAction(opts));
}
