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
import { embedAction } from './embed.js';

function collectRepeatable(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function registerConversationsCommands(program: Command): void {
  const conversations = program
    .command('conversations')
    .alias('conv')
    .description('Discover, index, and search Claude Code session history');

  // ── scan ────────────────────────────────────────────────────────────────────
  conversations
    .command('scan [dirs...]')
    .description('Scan ~/.claude/projects/ and index discovered sessions')
    .option('--watched', 'Scan configured watch directories (from config.yaml)')
    .option('--system', 'Scan system-wide ~/.claude/projects/ (default when no dirs given)')
    .option('--dry-run', 'Preview without writing to database')
    .option('--max-parallel <n>', 'Override parallelism (default: auto)')
    .action(
      (dirs: string[], opts: { watched?: boolean; system?: boolean; dryRun?: boolean; maxParallel?: string }) => {
        let mode: 'system' | 'watched' | 'targeted' = 'system';
        if (dirs && dirs.length > 0) mode = 'targeted';
        else if (opts.watched) mode = 'watched';
        return scanAction({ mode, dirs: dirs.length > 0 ? dirs : undefined, dryRun: opts.dryRun, maxParallel: opts.maxParallel });
      },
    );

  // ── search ──────────────────────────────────────────────────────────────────
  conversations
    .command('search [query]')
    .description('Full-text search across session summaries and tags')
    .option('--workspace <path>', 'Filter by workspace path')
    .option('--model <name>', 'Filter by primary model')
    .option('--since <time>', 'Filter sessions after time (ISO or "7d", "today")')
    .option('--after <time>', 'Alias for --since (sessions after this time)')
    .option('--before <time>', 'Filter sessions before time')
    .option('--min-cost <n>', 'Filter by minimum estimated cost')
    .option('--max-cost <n>', 'Filter by maximum estimated cost')
    .option('--min-messages <n>', 'Filter sessions with at least N messages')
    .option('--managed', 'Show only Panopticon-managed sessions')
    .option('--unmanaged', 'Show only unmanaged (personal) sessions')
    .option('--enriched', 'Show only enriched sessions')
    .option('--not-enriched', 'Show only unenriched sessions')
    .option('--tag <value>', 'Filter by tag (repeatable: --tag foo --tag bar)', collectRepeatable, [])
    .option('--tool <name>', 'Filter by tool used (repeatable)', collectRepeatable, [])
    .option('--file <path>', 'Filter by file referenced (repeatable)', collectRepeatable, [])
    .option('--issue <id>', 'Filter by associated issue ID')
    .option('--similar <id>', 'Find sessions similar to this session ID (semantic)')
    .option('--semantic <query>', 'Find sessions semantically similar to query text')
    .option('--format <fmt>', 'Output format: table | json | brief | ids', 'table')
    .option('--limit <n>', 'Maximum results', '20')
    .option('--offset <n>', 'Pagination offset', '0')
    .action((query: string | undefined, opts: Record<string, string | boolean | string[] | undefined>) =>
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

  // ── embed ───────────────────────────────────────────────────────────────────
  conversations
    .command('embed [ids...]')
    .description('Generate embeddings for enriched sessions (required for --semantic search)')
    .option('--regenerate', 'Regenerate embeddings even for sessions that already have them')
    .option('--status', 'Show embedding coverage stats and exit')
    .option('--provider <name>', 'Embedding provider: openai | voyage | ollama')
    .option('--model <name>', 'Embedding model override')
    .option('--max-parallel <n>', 'Override parallelism')
    .action((positionalIds: string[], opts: Record<string, string | boolean | undefined>) =>
      embedAction(positionalIds, opts),
    );

  // ── enrich ──────────────────────────────────────────────────────────────────
  conversations
    .command('enrich [ids...]')
    .description('Enrich sessions with AI-generated summaries and tags')
    .option('--tier <n>', 'Enrichment tier: 1 (quick) | 2 (detailed) | 3 (deep)', '1')
    .option('--deep', 'Shorthand for --tier 3')
    .option('--full', 'Enrich even already-enriched sessions')
    .option('--upgrade', 'Re-enrich sessions at a lower tier than requested')
    .option('--with <model>', 'Override the model used for enrichment')
    .option('--prompt <text>', 'Append custom prompt text to the enrichment request')
    .option('--limit <n>', 'Cap the number of sessions to enrich')
    .option('--workspace <path>', 'Restrict to sessions from this workspace path')
    .option('--since <time>', 'Only enrich sessions after this time (ISO or relative)')
    .option('--ids <ids>', 'Comma-separated session IDs to enrich (legacy; prefer positional args)')
    .option('--max-parallel <n>', 'Override parallelism')
    .option('--yes', 'Skip cost confirmation prompt')
    .action((positionalIds: string[], opts: Record<string, string | boolean | undefined>) =>
      enrichAction(positionalIds, opts),
    );
}
