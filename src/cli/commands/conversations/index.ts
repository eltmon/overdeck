/**
 * Register pan conversations subcommands (PAN-457)
 */

import { Command } from 'commander';
import { scanAction } from './scan.js';
import { searchAction } from './search.js';
import { listAction } from './list.js';
import { showAction } from './show.js';
import { currentAction } from './current.js';
import { costAction } from './cost.js';
import { enrichAction } from './enrich.js';
import { embedAction } from './embed.js';
import { jsonlAction } from './jsonl.js';
import { moveAction } from './move.js';
import { autoSettleOnMergeAction, autoSettleOverrideAction, linkPrAction, prsAction, unlinkPrAction } from './pull-requests.js';
import { autoSettleIdleDaysAction } from './auto-settle.js';
import {
  scheduleAddAction,
  scheduleListAction,
  scheduleRemoveAction,
  scheduleSetEnabledAction,
  type ScheduleAddOptions,
} from './schedule.js';
import { healAction } from './heal.js';
import { pendingAction } from './pending.js';
import { pullAction, reclaimAction } from './pull.js';

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
    .option('--managed', 'Show only Overdeck-managed sessions')
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
    .option('--managed', 'Show only Overdeck-managed sessions')
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

  // ── jsonl ───────────────────────────────────────────────────────────────────
  conversations
    .command('jsonl <conv-id>')
    .alias('transcript')
    .description('Print the Claude JSONL transcript path for a conversation id (the /conv/<N> number)')
    .option('--json', 'Output status/path as JSON; read the status field')
    .action((id: string, opts: { json?: boolean }) => jsonlAction(id, opts));

  // ── pending (PAN-4641) ──────────────────────────────────────────────────────
  conversations
    .command('pending <conv>')
    .description('List messages queued to send when the conversation\'s usage limit resets')
    .option('--json', 'Print JSON')
    .action((conv: string, opts: { json?: boolean }) => pendingAction(conv, opts));

  // ── pull / reclaim (PAN-4650) ───────────────────────────────────────────────
  conversations
    .command('pull <conv>')
    .description('Make this machine own a conversation that runs on a linked machine (@<machine>/<conv>)')
    .option('--stop-turn', 'Stop a running turn instead of waiting for it')
    .option('--json', 'Print the final job state as JSON')
    .action((conv: string, opts: { stopTurn?: boolean; json?: boolean }) => pullAction(conv, opts));

  conversations
    .command('reclaim <conv>')
    .description('Take back a conversation this machine released when the other machine does not run it')
    .option('--force', 'Reclaim even when the other machine cannot be asked')
    .action((conv: string, opts: { force?: boolean }) => reclaimAction(conv, opts));

  // ── move ────────────────────────────────────────────────────────────────────
  conversations
    .command('move <query> <projectKey>')
    .description('Reassign a conversation to a different project (exact name, then fuzzy title match)')
    .action((query: string, projectKey: string) => moveAction(query, projectKey));

  // ── pull requests (PAN-3822) ────────────────────────────────────────────────
  conversations
    .command('link-pr <query> <ref>')
    .description('Link a pull request (URL, #42, or owner/repo#42) to a conversation')
    .option('--source <source>', 'agent or manual (default: agent inside an agent, else manual)')
    .action((query: string, ref: string, opts: { source?: string }) => linkPrAction(query, ref, opts));
  conversations
    .command('unlink-pr <query> <ref>')
    .description('Unlink a pull request from a conversation (the sweep will not re-add it)')
    .action((query: string, ref: string) => unlinkPrAction(query, ref));
  conversations
    .command('prs <query>')
    .description('List the pull requests linked to a conversation (* = the one shown)')
    .option('--json', 'Output { links, effective } as JSON')
    .action((query: string, opts: { json?: boolean }) => prsAction(query, opts));
  conversations
    .command('auto-settle-on-merge [value]')
    .description('Show or set (on|off) settling conversations once all their linked PRs are merged or closed (default on)')
    .action((value?: string) => autoSettleOnMergeAction(value));
  conversations
    .command('auto-settle <query> [value]')
    .description("Show or set (on|off|inherit) one conversation's auto-settle-on-merge override")
    .action((query: string, value?: string) => autoSettleOverrideAction(query, value));
  conversations
    .command('auto-settle-idle-days [days]')
    .description('Show or set how many days without activity before an operator conversation is settled (0 = off, default 3)')
    .action((days?: string) => autoSettleIdleDaysAction(days));

  // ── schedules (PAN-4640) ────────────────────────────────────────────────────
  const schedule = conversations
    .command('schedule')
    .description('Run a prompt in a conversation on a recurring schedule (Overdeck fires it, even after restarts)');
  schedule
    .command('add <conv>')
    .description('Add a schedule; <conv> is self, a conversation number, a name, or a title match')
    .option('--cron <expr>', '5-field cron expression, evaluated in --tz')
    .option('--hourly', 'Every hour on the hour')
    .option('--daily <HH:MM>', 'Every day at HH:MM')
    .option('--weekdays <HH:MM>', 'Monday to Friday at HH:MM')
    .option('--weekly <spec>', 'Once a week: "<day> HH:MM", e.g. "mon 09:00"')
    .option('--prompt <text>', 'The prompt to send')
    .option('--prompt-file <path>', 'Read the prompt from a file')
    .option('--tz <zone>', 'IANA time zone (default: this machine\'s zone)')
    .option('--paused', 'Create the schedule paused')
    .option('--json', 'Output the created schedule as JSON')
    .action((conv: string, opts: ScheduleAddOptions) => scheduleAddAction(conv, opts));
  schedule.command('list [conv]').description('List schedules (all, or one conversation\'s)').option('--json', 'Output as JSON')
    .action((conv: string | undefined, opts: { json?: boolean }) => scheduleListAction(conv, opts));
  schedule.command('pause <id>').description('Pause a schedule').action((id: string) => scheduleSetEnabledAction(id, false));
  schedule.command('resume <id>').description('Resume a paused schedule; the next run is computed from now').action((id: string) => scheduleSetEnabledAction(id, true));
  schedule.command('rm <id>').description('Delete a schedule').action((id: string) => scheduleRemoveAction(id));

  conversations
    .command('heal <query>')
    .description('Clear stale fork/spawn failure state for a live conversation')
    .action((query: string) => healAction(query));

  // ── current ───────────────────────────────────────────────────────────────────
  conversations
    .command('current')
    .alias('whoami')
    .description('Print the conversation you are currently running inside (deterministic — no scanning/guessing)')
    .option('--json', 'Output as JSON')
    .action((opts: { json?: boolean }) => currentAction(opts));

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
    .option('--full', 'Use full-transcript enrichment with --with; enrich even already-enriched sessions')
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
