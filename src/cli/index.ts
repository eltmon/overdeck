#!/usr/bin/env node
import { Effect } from 'effect';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Load ~/.overdeck.env before any other imports
// This makes API keys and other env vars available to all commands
const OVERDECK_ENV_FILE = join(homedir(), '.overdeck.env');
if (existsSync(OVERDECK_ENV_FILE)) {
  try {
    const envContent = readFileSync(OVERDECK_ENV_FILE, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        // Only set if not already defined in process.env
        if (process.env[key] === undefined) {
          process.env[key] = value.trim();
        }
      }
    }
  } catch (error) {
    // Non-fatal: warn but continue
    console.warn('Warning: Failed to load ~/.overdeck.env:', (error as Error).message);
  }
}

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { syncCommand } from './commands/sync.js';
import {
  contextListCommand,
  contextEditCommand,
  contextSyncCommand,
  contextDiffCommand,
  contextValidateCommand,
  contextMigrateCommand,
  contextLayersHelp,
} from './commands/context-layers.js';
import { restoreCommand } from './commands/restore.js';
import { backupListCommand, backupCleanCommand } from './commands/backup.js';
import { skillsCommand } from './commands/skills.js';
import { statusCommand } from './commands/status.js';
import { issueCommand as startCommand } from './commands/start.js';
import type { RoleEffort } from '../lib/config-yaml.js';
import type { RuntimeName } from '../lib/runtimes/types.js';
import { tellCommand } from './commands/tell.js';
import { killCommand } from './commands/kill.js';
import { pauseCommand } from './commands/pause.js';
import { unpauseCommand } from './commands/unpause.js';
import { untroubledCommand } from './commands/untroubled.js';
import { forkCommand } from './commands/fork.js';
import { handoffCommand } from './commands/handoff.js';
import { unarchiveConversationCommand } from './commands/unarchive-conversation.js';
import { resumeCommand } from './commands/resume.js';
import { recoverCommand } from './commands/recover.js';
import { syncMainCommand } from './commands/sync-main.js';
import { doneCommand } from './commands/done.js';
import { approveCommand } from './commands/approve.js';
import { reopenCommand } from './commands/reopen.js';
import { wipeCommand } from './commands/wipe.js';
import { closeOutCommand } from './commands/close.js';
import { showCommand } from './commands/show.js';
import { listCommand as issuesCommand } from './commands/issues.js';
import { triageCommand } from './commands/triage.js';
import { pendingCommand } from './commands/pending.js';
import { requestReviewCommand } from './commands/request-review.js';
import { resetReviewCommand } from './commands/reset-review.js';
import { abortReviewCommand } from './commands/abort-review.js';
// PAN-1048 R5: `pan review run` removed. Review now runs as the role primitive
// via spawnRun(issueId, 'review', …) → roles/review.md, with convoy reviewers
// spawned by the review role through `pan review spawn-reviewer`.
// The blocking-orchestrator CLI was the only caller of runParallelReview /
// parseReviewSynthesis (now also retired).
import { reviewRestartCommand } from './commands/review-restart.js';
import { reviewSpawnReviewerCommand } from './commands/review-spawn-reviewer.js';
import { destroyCommand as destroyWorkspaceCommand, registerWorkspaceCommands } from './commands/workspace.js';
import { registerTestCommands } from './commands/test.js';
import { registerTtsCommands } from './commands/tts.js';
import { registerInstallCommand } from './commands/install.js';
import { registerAdminCommands } from './commands/admin/index.js';
import { registerConversationsCommands } from './commands/conversations/index.js';
import { registerOhmypiAuthCommands } from './commands/ohmypi-auth.js';
import { projectAddCommand, projectListCommand, projectRemoveCommand, projectInitCommand, projectShowCommand } from './commands/project.js';
import { doctorCommand } from './commands/doctor.js';
import { systemHealthCommand } from './commands/system-health.js';
import { updateCommand } from './commands/update.js';
import { restartCommand } from './commands/restart.js';
import { reloadCommand } from './commands/reload.js';
import { registerInspectCommand } from './commands/inspect.js';
import { createCostCommand } from './commands/cost.js';
import { createMemoryCommand } from './commands/memory.js';
import { createBriefingCommand } from './commands/briefing.js';
import { createComplianceCommand } from './commands/compliance.js';
import { createRegistryCommand } from './commands/registry.js';
import { createDocsCommand } from './commands/docs.js';
import { planCommand } from './commands/plan.js';
import { strikeCommand } from './commands/strike.js';
import { planFinalizeCommand } from './commands/plan-finalize.js';
import { planDoneCommand } from './commands/plan-done.js';
import { registerCavemanCommands } from './commands/caveman.js';
import { registerReleaseCommands } from './commands/release.js';
import { isNoResumeCliOptionEnabled } from '../lib/cloister/no-resume-mode.js';
import { applyBootGateEnv, formatBootGateState, resolveBootGates } from '../lib/boot-gates.js';
import { resourcesCommand } from './commands/resources.js';
import { devCommand } from './commands/dev.js';
import { registerScopeCommands } from './commands/scope.js';
import { openCommand } from './commands/open.js';
import { registerFlywheelCommands } from './commands/flywheel.js';
import { registerMergeCommands } from './commands/merge.js';
import { registerArtifactCommands } from './commands/artifacts.js';

// Pre-parse --yolo from argv so it works regardless of position relative to the
// subcommand. Commander's enablePositionalOptions() routes post-subcommand options
// to the subcommand, which would either swallow --yolo or error on unknown flag.
// Doing this here lets `pan --yolo=false up`, `pan up --yolo=false`, and even
// `pan up agent-foo --yolo=false` all work identically.
(() => {
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    let value: string | undefined;
    if (arg === '--yolo') {
      // Bare flag means true. Only consume an explicit boolean-ish value;
      // otherwise `pan --yolo up` would swallow `up` as the flag value.
      const next = argv[i + 1];
      const hasExplicitValue = next !== undefined && /^(true|false|1|0|yes|no)$/i.test(next);
      value = hasExplicitValue ? next : 'true';
      argv.splice(i, hasExplicitValue ? 2 : 1);
      i--;
    } else if (arg.startsWith('--yolo=')) {
      value = arg.slice('--yolo='.length);
      argv.splice(i, 1);
      i--;
    } else if (arg === '--no-yolo') {
      value = 'false';
      argv.splice(i, 1);
      i--;
    } else {
      continue;
    }
    process.env.PAN_YOLO = value.trim().toLowerCase();
  }
})();

const program = new Command();
program.enablePositionalOptions();

const ensureDashboardBundle = async (
  bundledServer: string,
  bundledFrontendIndex: string,
  sourceDashboard: string,
) => {
  if (existsSync(bundledServer) && existsSync(bundledFrontendIndex)) {
    return true;
  }

  if (!existsSync(sourceDashboard)) {
    return false;
  }

  console.log(chalk.yellow('⚠ Dashboard bundle is incomplete; rebuilding dashboard assets...'));

  try {
    const { execSync } = await import('child_process');
    execSync('npm run build:dashboard', {
      cwd: join(import.meta.dirname, '..', '..'),
      stdio: ['pipe', 'inherit', 'pipe'],
    });
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer };
    if (e.stderr) process.stderr.write(e.stderr);
    return false;
  }

  return existsSync(bundledServer) && existsSync(bundledFrontendIndex);
};

program
  .name('overdeck')
  .description('Multi-agent orchestration for AI coding assistants')
  .version(JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf-8')).version)
  .option(
    '--yolo [value]',
    'Override permission mode for spawned Claude Code agents. ' +
    'Default is auto (Claude Code\'s classifier blocks destructive ops). ' +
    '--yolo or --yolo=true switches to --dangerously-skip-permissions; ' +
    '--yolo=false (--no-yolo) forces auto mode. ' +
    'Equivalent to setting PAN_YOLO=true|false. Works in any argv position. ' +
    'Falls back to config.claude.permissionMode.'
  );
// Note: --yolo is intercepted by the pre-parse block above before commander runs,
// so the option declaration is for `--help` rendering only — it never receives a value.

program
  .command('init')
  .description('Initialize Overdeck (~/.overdeck/)')
  .action(initCommand);

program
  .command('sync')
  .description('Sync skills/agents to ~/.claude/ and render the context layers')
  .option('--dry-run', 'Show what would be synced')
  .option('--force', 'Overwrite files modified since Overdeck installed them')
  .option('--diff', 'Show diff for modified files')
  .option('--backup-only', 'Only create backup')
  .option('--if-changed', 'Skip the sync when inputs are unchanged (used by startup)')
  .action(syncCommand);

// pan context — layered context distribution (PAN-1201)
const context = program
  .command('context')
  .description('Manage the layered context model (global / project / workspace)');

context
  .command('list')
  .description("Show all three layers' files")
  .option('--layer <layer>', 'Limit to one layer: global, project, or workspace')
  .option('--json', 'Output as JSON')
  .action(contextListCommand);

context
  .command('edit')
  .description('Open a context layer in $EDITOR')
  .option('--layer <layer>', 'Layer to edit: global (default), project, or workspace')
  .action(contextEditCommand);

context
  .command('sync')
  .description('Render the context layers into harness CLAUDE.md files')
  .action(contextSyncCommand);

context
  .command('diff')
  .description('Show what each harness would receive after templating')
  .option('--harness <harness>', 'Limit to one harness: claude or pi')
  .action(contextDiffCommand);

context
  .command('validate')
  .description('Lint layer templates for unclosed or unknown harness blocks')
  .action(contextValidateCommand);

context
  .command('migrate')
  .description('One-shot migration from the deprecated sync.devroot model')
  .option('--yes', 'Register every discovered project without prompting')
  .action(contextMigrateCommand);

context.action(contextLayersHelp);

program
  .command('restore [timestamp]')
  .description('Restore from backup')
  .action(restoreCommand);

// Backup management
const backup = program.command('backup').description('Manage backups');

backup
  .command('list')
  .description('List all backups')
  .option('--json', 'Output as JSON')
  .action(backupListCommand);

backup
  .command('clean')
  .description('Remove old backups')
  .option('--keep <count>', 'Number of backups to keep', '10')
  .action(backupCleanCommand);

program
  .command('skills')
  .description('List and manage skills')
  .option('--json', 'Output as JSON')
  .action(skillsCommand);

// pan issues — list and triage work
program
  .command('issues')
  .description('List and triage work across configured trackers')
  .option('--all', 'Include closed issues')
  .option('--mine', 'Show only my assigned issues')
  .option('--json', 'Output as JSON')
  .option('--tracker <type>', 'Query specific tracker (linear/github/gitlab)')
  .option('--all-trackers', 'Query all configured trackers')
  .option('--shadow-only', 'Show only shadowed issues')
  .option('--triage', 'Show triage queue')
  .action((options) => {
    if (options.triage) {
      triageCommand(undefined, options);
    } else {
      issuesCommand(options);
    }
  });

// pan show <id> — unified observation
program
  .command('show <id>')
  .description('Unified lens: shadow state, CV, context, health for one issue')
  .option('--shadow', 'Shadow state details only')
  .option('--cv', 'Agent work history only')
  .option('--context', 'Context engineering state only')
  .option('--health', 'Health + heartbeat only')
  .option('--json', 'Output as JSON')
  .action(showCommand);

// pan open <id> — open workspace in editor
program
  .command('open <id>')
  .description('Open an issue workspace in your preferred editor')
  .option('-e, --editor <editor>', 'Editor to use (cursor, windsurf, vscode, zed, etc.)')
  .action(openCommand);

// pan review — pending, request, reset
const review = program
  .command('review')
  .description('Review-loop management: pending items, request re-review, reset cycles');

review
  .command('pending')
  .description('List completed work awaiting review')
  .option('--ready', 'List issues ready for merge (review+test green, not merged) regardless of origin')
  .option('--blocked', 'List issues blocked in review/test/merge from the SQLite review-status store')
  .action(pendingCommand);

review
  .command('request <id>')
  .description('Request re-review after fixing feedback')
  .option('-m, --message <text>', 'Message describing the fixes applied')
  .action(requestReviewCommand);

review
  .command('reset <id>')
  .description('Reset review/test/merge cycles (human override)')
  .option('--session', 'Also clear saved Claude session')
  .action(resetReviewCommand);

review
  .command('abort <id>')
  .description('Kill all running reviewer sessions and leave the worker idle')
  .action(abortReviewCommand);

review
  .command('restart <id>')
  .description('Kill running reviewers and dispatch fresh review pipeline')
  .option('--model <model>', 'Override model for all reviewers (e.g. gpt-5.4, claude-sonnet-4-6)')
  .option('--role <role>', 'Restart only a specific reviewer role (correctness/security/performance/requirements)')
  .action(reviewRestartCommand);

review
  .command('spawn-reviewer <id>', { hidden: true })
  .description('Internal: spawn one review convoy sub-role')
  .requiredOption('--sub-role <role>', 'Reviewer sub-role (security/correctness/performance/requirements)')
  .requiredOption('--run-id <id>', 'Review run ID')
  .option('--workspace <path>', 'Workspace path')
  .option('--output <path>', 'Reviewer output path')
  .option('--context <path>', 'Context manifest path')
  .option('--model <model>', 'Override reviewer model')
  .action(reviewSpawnReviewerCommand);

// PAN-1048 R5: `pan review run` removed (see import note above).

// pan backlog — sequence writer surface
const backlog = program
  .command('backlog')
  .description('Backlog sequencer management');

backlog
  .command('write-sequence <file>')
  .description('Validate a SequenceDoc JSON file and write it to .pan/backlog/sequence.md (triggers auto-commit)')
  .option('--project-root <path>', 'Project root (default: cwd)')
  .action(async (file: string, opts: { projectRoot?: string }) => {
    const { readFileSync } = await import('node:fs');
    const { parseSequenceJson } = await import('../lib/backlog/types.js');
    const { writeSequenceMd } = await import('../lib/backlog/sequence-io.js');
    const projectRoot = opts.projectRoot ?? process.cwd();
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf-8'));
    } catch (e: any) {
      console.error(chalk.red(`Error: could not read ${file}: ${e.message}`));
      process.exit(1);
    }
    const result = parseSequenceJson(raw);
    if (!result.ok) {
      console.error(chalk.red(`Validation error: ${result.error}`));
      process.exit(1);
    }
    writeSequenceMd(projectRoot, result.doc);
    console.log(chalk.green(`✓ Wrote .pan/backlog/sequence.md (${result.doc.nodes.length} nodes, pass=${result.doc.pass})`));
  });

// pan plan finalize <id>
const planCmd = program
  .command('plan')
  .description('Planning lifecycle commands')
  .argument('[id]', 'Issue ID to plan')
  .option('--auto', 'Run non-interactive planning; inferred choices are recorded in plan.autoDecisions[]')
  .option('--auto-start', 'After planning completes, automatically start the work agent — used by autonomous orchestrators')
  .option('--probe', 'Add an adversarial pre-finalize probe pass to the planning prompt')
  .option('--model <model>', 'Model to use for the planning role')
  .option('--harness <harness>', 'Coding-agent harness: claude-code | pi | codex (defaults to role/provider settings)')
  .option('--effort <level>', 'Planning effort: low | medium | high')
  .option('--remote', 'Use remote planning workspace (Fly.io)')
  .option('--local', 'Use local planning workspace')
  .action(planCommand);

planCmd
  .command('finalize')
  .description('Materialize plan into beads, mark the workspace spec as proposed, and promote to main')
  .option('-w, --workspace <path>', 'Workspace path (defaults to cwd, walks up to find .pan/)')
  .option('--json', 'Emit JSON result')
  .option('--no-promote', 'Skip auto-promotion to main; leave spec at status=proposed for manual Done')
  .option('--no-quality-lint', 'Emergency bypass for vBRIEF quality lint during finalize')
  .action(planFinalizeCommand);

planCmd
  .command('done <id>')
  .description('Complete planning — promote vBRIEF to proposed, sync beads, transition issue to Planned')
  .action(planDoneCommand);

// Lifecycle verbs: pan start, pan tell, pan kill, pan fork, pan resume, pan recover, pan sync-main, pan done, pan reopen, pan wipe, pan close
program
  .command('tell <id> <message>')
  .description('Send message to running agent')
  .action(tellCommand);

program
  .command('kill <id>')
  .description('Stop running agent (workspace preserved)')
  .option('--force', 'Force kill without confirmation')
  .action(killCommand);

program
  .command('pause <id>')
  .description('Persistently pause an agent and stop it if running')
  .option('--reason <reason>', 'Reason to store with the pause gate')
  .action(pauseCommand);

program
  .command('unpause <id>')
  .description('Clear an agent pause gate without spawning it')
  .action(unpauseCommand);

program
  .command('untroubled <id>')
  .description('Clear an agent troubled gate without spawning it')
  .action(untroubledCommand);

program
  .command('fork [conv]')
  .description('Summary Fork a conversation — creates new session from a summary of previous work; omit <conv> to fork the conversation you are in')
  .option('--model <model>', 'Model for the summary-forked session')
  .option('--cwd <path>', 'Working directory for the summary-forked session')
  .option('--plain', 'Skip summary generation and copy raw conversation history')
  .action(forkCommand);

program
  .command('handoff [conv] [focus...]')
  .description('Conversation handoff that spawns a new conversation; omit <conv> (or pass "self") to hand off the conversation you are in; trailing text becomes the focus — MAX 500 characters. Very large source conversations are auto-degraded (truncated smart summary → heuristic → focus-only) and still hand off without aborting.')
  .option('--model <model>', 'Model for the handoff-forked (new) conversation')
  .option('--harness <harness>', 'Harness for the handoff-forked (new) conversation: claude-code, pi, or codex')
  .option('--cwd <path>', 'Working directory for the new conversation')
  .option('--author <author>', 'Who authors the handoff doc: external (default) or source', 'external')
  .option('--author-model <model>', 'Model for the external authoring session (only when --author=external)')
  .option('--author-harness <harness>', 'Harness for the external authoring session: claude-code, pi, or codex (only when --author=external)')
  .action(handoffCommand);

program
  .command('unarchive-conversation <query>')
  .description('Restore an archived conversation by exact name or matching title')
  .action(unarchiveConversationCommand);

program
  .command('resume <id>')
  .description('Resume from saved Claude session')
  .option('--host', 'Bypass workspace docker stack-health gate and resume on the host')
  .option('--yes', 'Confirm --host in non-interactive contexts')
  .option('--compact', 'Summarize the saved session out-of-band and respawn a fresh session seeded with the summary (recovers a context-wedged agent without the harness /compact deadlock)')
  .action(resumeCommand);

program
  .command('recover [id]')
  .description('Recover crashed or stopped agent')
  .option('--all', 'Auto-recover all crashed agents')
  .option('--json', 'Output as JSON')
  .option('--model <model>', 'Override model on recovery (e.g. switch off Kimi when quota is exhausted)')
  .action(recoverCommand);

program
  .command('sync-main <id>')
  .description('Merge latest main into workspace feature branch')
  .action(syncMainCommand);

program
  .command('done <id>')
  .description('Mark work complete, move to review')
  .option('-c, --comment <message>', 'Comment for the tracker')
  .option('--force', 'Skip pre-flight completion checks')
  .option('--test-waived <reason>', 'Skip the test-requirement gate; reason must include rationale and SHA of an existing test that covers the requirement')
  .option('--strike', 'Strike-agent shape: skip review-pipeline dispatch (used by `pan strike` agents that merged directly to main)')
  .option('--json', 'Output as JSON')
  .action(doneCommand);

program
  .command('approve <id>')
  .description('[REMOVED] Use dashboard MERGE button instead')
  .action(approveCommand);

program
  .command('reopen <id>')
  .description('Re-enter the pipeline for a closed/completed/cancelled issue (resets specialist state). For issues already in progress, use `pan review restart`.')
  .option('--reason <reason>', 'Reason for reopening')
  .option('--force', 'Skip the in-progress guard and confirmation prompt')
  .action(reopenCommand);

program
  .command('wipe <id>')
  .description('Destructive: removes workspace files, kills processes, deletes branches, clears review state, and resets tracker status')
  .option('--force', 'Skip confirmation')
  .option('-y, --yes', 'Skip confirmation')
  .action(wipeCommand);

program
  .command('destroy <id>')
  .description('Alias for workspace destroy: remove the issue workspace worktree and branch')
  .option('--force', 'Force removal even with uncommitted changes')
  .option('--project <path>', 'Explicit project path (overrides registry)')
  .action(destroyWorkspaceCommand);

program
  .command('close <id>')
  .description('Verify, clean up, and close issue on tracker')
  .option('--force', 'Skip confirmation prompt')
  .option('--json', 'Output as JSON')
  .action((id, options) => closeOutCommand(id, options));

program
  .command('start <id>')
  .description('Create workspace and spawn agent for an issue')
  .option('--model <model>', 'Model to use (sonnet/opus/haiku/kimi-k2.5/etc) - defaults to Cloister config')
  .option('--harness <harness>', 'Coding-agent harness: claude-code | pi | codex (defaults to role/provider settings)')
  .option('--effort <level>', 'Claude Code effort: low | medium | high | xhigh | max (defaults to roles.work.effort)')
  .option('--tier <tier>', 'Remote workspace resiliency tier: ephemeral | durable (defaults to remote.resiliency_tier)')
  .option('--dry-run', 'Show what would be created')
  .option('--shadow', 'Enable shadow mode')
  .option('--no-shadow', 'Disable shadow mode')
  .option('--remote', 'Use remote workspace (Fly.io)')
  .option('--local', 'Use local workspace (explicit override)')
  .option('--auto', 'Skip planning agent by synthesizing a minimal vBRIEF and beads from the issue title/body')
  .option('--force', 'Clear a paused agent gate and start anyway')
  .option('--fresh', 'Drop the saved Claude session (non-destructive) and start a new one — e.g. to switch a stopped agent\'s model')
  .option('--host', 'Bypass workspace docker stack-health gate and spawn on the host')
  .option('--yes', 'Confirm --host in non-interactive contexts')
  .action(startCommand);

program
  .command('strike <ids...>')
  .description('Spawn strike agent(s) — drop in, implement, merge directly to main, verify on main. Bypasses plan/review/test/ship.')
  .option('--model <model>', 'Model override (defaults to roles.strike.model from config)')
  .option('--harness <harness>', 'Coding-agent harness: claude-code | pi | codex (defaults to role/provider settings)')
  .option('--effort <level>', 'Strike effort: low | medium | high | xhigh | max (default medium)')
  .option('--dry-run', 'Print what would happen without spawning')
  .action((ids: string[], options: { model?: string; harness?: RuntimeName; effort?: RoleEffort; dryRun?: boolean }) =>
    strikeCommand(ids, options),
  );

// Register workspace commands (pan workspace create, pan workspace list, etc.)
registerWorkspaceCommands(program);

// Register test commands (pan test run, pan test list)
registerTestCommands(program);

registerTtsCommands(program);

// Register release commands (pan release check/stable/canary/notes)
registerReleaseCommands(program);

program.addCommand(createMemoryCommand());
program.addCommand(createBriefingCommand());
program.addCommand(createComplianceCommand());
program.addCommand(createRegistryCommand());
program.addCommand(createDocsCommand());

// Register admin commands (pan admin cloister, pan admin specialists, etc.)
registerAdminCommands(program);

// Register conversations commands (pan conversations scan, search, list, show, cost, enrich)
registerConversationsCommands(program);

// Register ohmypi-auth commands (pan ohmypi-auth status|login; pan pi-auth is a deprecated alias)
registerOhmypiAuthCommands(program);

// Register install command
registerInstallCommand(program);

// Register inspect command (pan inspect <issueId> --bead <beadId>)
registerInspectCommand(program);

// Register caveman commands (pan caveman-compress)
registerCavemanCommands(program);
registerScopeCommands(program);
registerFlywheelCommands(program);
registerMergeCommands(program);
registerArtifactCommands(program);

// Shorthand: pan status = pan status
program
  .command('status')
  .description('Show running agents')
  .option('--json', 'Output as JSON')
  .option('--tldr', 'Show TLDR index health across all workspaces')
  .option('--context', 'Show context window usage % for each agent')
  .action(statusCommand);

// Dashboard commands
program
  .command('dev')
  .description('Start dashboard in development mode with Vite HMR')
  .option('--skip-traefik', 'Skip Traefik startup')
  .option('--no-deacon', 'Skip Cloister/Deacon auto-start (escape hatch when deacon\'s startup scan is starving the event loop)')
  .option('--no-resume', 'Disable agent auto-resume (now the default; flag kept for explicitness)')
  .action(devCommand);

/**
 * Wait for the dashboard to be healthy, then — when Traefik is enabled — wait for
 * the Traefik-routed URL to return 200. Returns the URL that should be announced
 * and opened. Falls back to the direct localhost API port when Traefik is not
 * ready within the bounded timeout.
 */
async function resolveDashboardReadyUrl(config: {
  traefikEnabled: boolean;
  traefikDomain: string;
  dashboardPort: number;
  dashboardApiPort: number;
  healthTimeoutMs?: number;
  traefikTimeoutMs?: number;
}): Promise<{ readyUrl: string; apiUrl: string; traefikReady: boolean }> {
  const { waitForDashboardHealth, waitForTraefikHealth } = await import('../lib/platform-lifecycle.js');
  await Effect.runPromise(
    waitForDashboardHealth(config.dashboardApiPort, { timeoutMs: config.healthTimeoutMs ?? 15_000 }),
  );
  if (config.traefikEnabled) {
    const traefikReady = await Effect.runPromise(
      waitForTraefikHealth(config.traefikDomain, { timeoutMs: config.traefikTimeoutMs ?? 10_000 }),
    );
    if (traefikReady) {
      return {
        readyUrl: `https://${config.traefikDomain}`,
        apiUrl: `https://${config.traefikDomain}/api`,
        traefikReady: true,
      };
    }
    const readyUrl = `http://localhost:${config.dashboardApiPort}`;
    return { readyUrl, apiUrl: readyUrl, traefikReady: false };
  }
  return {
    readyUrl: `http://localhost:${config.dashboardPort}`,
    apiUrl: `http://localhost:${config.dashboardApiPort}`,
    traefikReady: false,
  };
}

program
  .command('up')
  .description('Start dashboard (and Traefik if enabled)')
  .option('--detach', 'Run in background')
  .option('--skip-traefik', 'Skip Traefik startup')
  .option('--deacon', 'Force Cloister/Deacon auto-start even if the shell inherited OVERDECK_DISABLE_DEACON')
  .option('--no-deacon', 'Skip Cloister/Deacon auto-start (escape hatch when deacon\'s startup scan is starving the event loop)')
  .option('--resume', 'Enable agent auto-resume on boot — auto-resume is OFF by default (PAN-1963)')
  .option('--no-resume', 'Disable agent auto-resume (now the default; flag kept for explicitness)')
  .option('--no-open', 'Do not open the dashboard app/browser after startup')
  .option('--seed-from-legacy', 'Seed a fresh local database from the legacy database (copy conversations + reconstruct in-flight agents/issues). Default is an empty local database.')
  .action(async (options) => {
    const noResume = isNoResumeCliOptionEnabled(options);
    const bootGates = resolveBootGates(options);
    const { spawn, execSync, exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const { readFileSync, existsSync } = await import('fs');
    const { parse } = await import('@iarna/toml');

    // Find dashboard - check bundled first, then source
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const bundledServer = join(__dirname, '..', 'dashboard', 'server.js');
    const bundledFrontendIndex = join(__dirname, '..', 'dashboard', 'public', 'index.html');
    const srcDashboard = join(__dirname, '..', '..', 'src', 'dashboard');

    // Check if Traefik is enabled
    const configFile = join(process.env.HOME || '', '.overdeck', 'config.toml');
    let traefikEnabled = false;
    let traefikDomain = 'pan.localhost';
    let dashboardPort = 3010;
    let dashboardApiPort = 3011;

    if (existsSync(configFile)) {
      try {
        const configContent = readFileSync(configFile, 'utf-8');
        const config = parse(configContent) as any;
        traefikEnabled = config.traefik?.enabled === true;
        traefikDomain = config.traefik?.domain || 'pan.localhost';
        dashboardPort = config.dashboard?.port || 3010;
        dashboardApiPort = config.dashboard?.api_port || 3011;
      } catch (error) {
        console.log(chalk.yellow('Warning: Could not read config.toml'));
      }
    }

    console.log(chalk.bold('Starting Overdeck...\n'));

    // Refuse to start a detached production dashboard on top of a running
    // interactive `pan dev` session — they would fight over the same ports.
    {
      const { readDevSupervisorMarker, devSupervisorRefusalLines } = await import('../lib/dev-supervisor.js');
      const dev = readDevSupervisorMarker();
      if (dev) {
        for (const line of devSupervisorRefusalLines('start a detached dashboard', dev)) {
          console.error(chalk.yellow(line));
        }
        process.exitCode = 2;
        return;
      }
    }

    if (noResume) {
      console.log(chalk.yellow('  [no-resume mode active] Agent auto-resume is disabled for this dashboard boot'));
    }
    console.log(chalk.dim(`  Boot gates: ${formatBootGateState(bootGates)}`));

    // Startup context sync (skills, agents, hooks, MCP config, rendered
    // ~/.claude/CLAUDE.md + per-project CLAUDE.md) is DEFERRED to run in the
    // background AFTER the dashboard is listening — see startPostLaunchSidecars
    // below. Running it here cost ~22s on every `overdeck up`, blocking the
    // server from even spawning, and the dashboard does not depend on synced
    // content to boot. Deferring it shaves that ~22s off time-to-available.

    // Ensure tmux is installed — required for all agent/conversation sessions
    {
      const { isToolInstalled, installTool } = await import('../lib/prereqs/registry.js');
      if (!(await isToolInstalled('tmux'))) {
        console.log(chalk.yellow('  tmux is required but not found. Installing...'));
        const result = await installTool('tmux');
        if (result.success) {
          console.log(chalk.green(`  ✓ ${result.message}`));
        } else {
          console.error(chalk.red(`  ✗ Failed to install tmux: ${result.message}`));
          console.error(chalk.dim('  Install manually: brew install tmux (macOS) or sudo apt-get install tmux (Linux)'));
          process.exit(1);
        }
      }
    }

    // Flush stale provider env vars from the tmux server's global environment.
    // The server inherits the parent's env at startup and persists it — stale
    // ANTHROPIC_BASE_URL etc. would leak into new sessions. Use set-environment
    // -gu to unset them without killing existing sessions.
    {
      const { execSync } = await import('child_process');
      const providerVars = [
        'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN',
        'OPENAI_API_KEY', 'GEMINI_API_KEY', 'API_TIMEOUT_MS',
        'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
      ];
      for (const varName of providerVars) {
        try {
          execSync(`tmux -L overdeck set-environment -gu ${varName}`, { stdio: 'ignore' });
        } catch {
          // No server running or var not set — fine
        }
      }
    }

    // Regenerate Traefik dynamic config and ensure DNS
    if (traefikEnabled && !options.skipTraefik) {
      try {
        const { generateOverdeckTraefikConfigSync, ensureProjectCertsSync, generateTlsConfigSync, cleanupStaleTlsSectionsSync } = await import('../lib/traefik.js');

        // Clean stale tls: sections from older config files
        cleanupStaleTlsSectionsSync();

        if (generateOverdeckTraefikConfigSync()) {
          console.log(chalk.dim('  Regenerated Traefik config from template'));
        }

        // Generate missing certs for registered projects
        const generatedDomains = ensureProjectCertsSync();
        for (const domain of generatedDomains) {
          console.log(chalk.dim(`  Generated wildcard cert for *.${domain}`));
        }

        // Generate tls.yml from all discovered certs
        if (generateTlsConfigSync()) {
          console.log(chalk.dim('  Generated TLS config (tls.yml)'));
        }
      } catch {
        console.log(chalk.yellow('Warning: Could not regenerate Traefik config'));
      }

      try {
        const { ensureBaseDomain, detectDnsSyncMethod, syncDnsToWindows } = await import('../lib/dns.js');
        const dnsMethod = (existsSync(configFile) ? (parse(readFileSync(configFile, 'utf-8')) as any).traefik?.dns_sync_method : null) || detectDnsSyncMethod();
        ensureBaseDomain(dnsMethod, traefikDomain);
        if (dnsMethod === 'wsl2hosts') {
          syncDnsToWindows().catch(() => {});
        }
      } catch {
        console.log(chalk.yellow(`Warning: Could not ensure DNS for ${traefikDomain}`));
      }
    } else if (!traefikEnabled) {
      // Detect orphaned Traefik container
      try {
        const containerCheck = execSync(
          'docker ps --filter "name=overdeck-traefik" --format "{{.Names}}" 2>/dev/null',
          { encoding: 'utf-8' }
        ).trim();
        if (containerCheck.includes('overdeck-traefik')) {
          console.log(chalk.yellow('⚠ Traefik container is running but traefik.enabled is not set in config'));
          console.log(chalk.yellow('  Run `pan install` to configure Traefik, or `pan down` to stop it\n'));
        }
      } catch {
        // Docker not available, ignore
      }
    }

    // Start Traefik if enabled
    if (traefikEnabled && !options.skipTraefik) {
      const traefikDir = join(process.env.HOME || '', '.overdeck', 'traefik');
      if (existsSync(traefikDir)) {
        try {
          // Ensure network is marked as external (migration for older installs)
          const composeFile = join(traefikDir, 'docker-compose.yml');
          if (existsSync(composeFile)) {
            const content = readFileSync(composeFile, 'utf-8');
            if (!content.includes('external: true') && content.includes('overdeck:')) {
              const patched = content.replace(
                /networks:\s*\n\s*overdeck:\s*\n\s*name: overdeck\s*\n\s*driver: bridge/,
                'networks:\n  overdeck:\n    name: overdeck\n    external: true  # Network created by \'pan install\''
              );
              const { writeFileSync } = await import('fs');
              writeFileSync(composeFile, patched);
              console.log(chalk.dim('  (migrated network config)'));
            }
          }

          console.log(chalk.dim('Starting Traefik...'));
          const { stdout } = await execAsync(
            'docker ps --filter "name=overdeck-traefik" --format "{{.Names}}" 2>/dev/null',
          );
          if (stdout.trim().includes('overdeck-traefik')) {
            console.log(chalk.dim('Traefik already running'));
          } else {
            execSync('docker compose up -d', {
              cwd: traefikDir,
              stdio: 'pipe',
            });
          }
          console.log(chalk.green('✓ Traefik started'));
          console.log(chalk.dim(`  Dashboard: https://traefik.${traefikDomain}:8080\n`));
        } catch (error) {
          console.log(chalk.yellow('⚠ Failed to start Traefik (continuing anyway)'));
          console.log(chalk.dim('  Run with --skip-traefik to suppress this message\n'));
        }
      }
    }

    // Determine which mode to use
    const hasBundledDashboard = await ensureDashboardBundle(
      bundledServer,
      bundledFrontendIndex,
      srcDashboard,
    );
    const isProduction = hasBundledDashboard;
    const isDevelopment = existsSync(srcDashboard);

    if (!isProduction && !isDevelopment) {
      console.error(chalk.red('Error: Dashboard not found'));
      console.error(chalk.dim('This may be a corrupted installation. Try reinstalling @overdeck/core.'));
      process.exit(1);
    }

    // Check npm is available (only needed for development mode)
    if (isDevelopment && !isProduction) {
      try {
        execSync('npm --version', { stdio: 'pipe' });
      } catch {
        console.error(chalk.red('Error: npm not found in PATH'));
        console.error(chalk.dim('Make sure Node.js and npm are installed and in your PATH'));
        process.exit(1);
      }
    }

    // Check for installed Electron app — launch it instead of bare server
    const electronAppPath = (() => {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      const candidates: string[] = [];

      if (process.platform === 'linux') {
        // Installed AppImage or symlink in standard locations
        candidates.push(
          join(home, '.local', 'bin', 'overdeck'),
          join(home, '.local', 'share', 'applications', 'overdeck'),
          '/usr/local/bin/overdeck',
          '/opt/overdeck/overdeck',
        );
        // Glob-style: $HOME/Applications/Overdeck*.AppImage
        try {
          const appsDir = join(home, 'Applications');
          const { readdirSync } = require('fs') as typeof import('fs');
          if (existsSync(appsDir)) {
            const appImages = readdirSync(appsDir).filter(
              (f: string) => f.startsWith('Overdeck') && f.endsWith('.AppImage'),
            );
            for (const f of appImages) candidates.push(join(appsDir, f));
          }
        } catch {
          // ignore
        }
      } else if (process.platform === 'darwin') {
        candidates.push(
          '/Applications/Overdeck.app/Contents/MacOS/Overdeck',
          join(home, 'Applications', 'Overdeck.app', 'Contents', 'MacOS', 'Overdeck'),
        );
      } else if (process.platform === 'win32') {
        const localApp = process.env.LOCALAPPDATA || '';
        candidates.push(join(localApp, 'Programs', 'overdeck', 'Overdeck.exe'));
      }

      return candidates.find((p) => existsSync(p)) ?? null;
    })();

    // Shared post-launch sidecars (CLIProxy, smee, TLDR) — must run for
    // every launch mode so the Electron fast-path does not skip them.
    async function startPostLaunchSidecars(): Promise<void> {
      // Start CLIProxyAPI sidecar for ChatGPT subscription → GPT agent routing.
      // Idempotent + non-fatal: if the user isn't logged into Codex yet, the
      // sidecar still comes up and will pick up credentials once they log in.
      try {
        const { startCliproxySync, CLIPROXY_PORT } = await import('../lib/cliproxy.js');
        console.log(chalk.dim('Starting CLIProxyAPI sidecar (GPT subscription router)...'));
        startCliproxySync();
        console.log(chalk.green(`✓ CLIProxyAPI listening on http://127.0.0.1:${CLIPROXY_PORT}`));
      } catch (error: any) {
        console.log(chalk.yellow('⚠ Failed to start CLIProxyAPI sidecar:'), error?.message || String(error));
        console.log(chalk.dim('  GPT subscription agents will not work until this is resolved.'));
      }

      // Start smee-client webhook relay (optional — non-fatal)
      try {
        const { startSmeeProcessSync } = await import('../lib/smee.js');
        console.log(chalk.dim('\nStarting smee-client webhook relay...'));
        startSmeeProcessSync();
      } catch (error: any) {
        console.log(chalk.yellow('⚠ Failed to start smee-client:'), error?.message || String(error));
        console.log(chalk.dim('  Webhook relay unavailable — GitHub events will use polling fallback'));
      }

      // Start TLDR daemon on project root (if Python3 and venv available)
      try {
        const { getTldrDaemonServiceSync } = await import('../lib/tldr-daemon.js');
        const projectRoot = process.cwd();
        const venvPath = join(projectRoot, '.venv');
        if (existsSync(venvPath)) {
          console.log(chalk.dim('\nStarting TLDR daemon for project root...'));
          const tldrService = getTldrDaemonServiceSync(projectRoot, venvPath);
          await tldrService.start(true);  // background mode
          console.log(chalk.green('✓ TLDR daemon started'));
        } else {
          console.log(chalk.dim('\nSkipping TLDR daemon (no .venv found)'));
          console.log(chalk.dim('  Run setup to create venv with llm-tldr'));
        }
      } catch (error: any) {
        console.log(chalk.yellow('⚠ Failed to start TLDR daemon:'), error?.message || String(error));
        console.log(chalk.dim('  TLDR will be unavailable but dashboard will work normally'));
      }

      try {
        const { loadConfigSync } = await import('../lib/config-yaml.js');
        const { startTtsDaemon } = await import('../lib/tts-daemon.js');
        const ttsConfig = loadConfigSync().config.tts;
        if (ttsConfig.daemonAutoStart) {
          console.log(chalk.dim('\nStarting Qwen TTS daemon...'));
          const result = await Effect.runPromise(startTtsDaemon({ config: ttsConfig, detach: true, timeoutMs: 30_000 }));
          if (result.ok) {
            console.log(chalk.green(`✓ Qwen TTS daemon listening on http://${ttsConfig.daemonHost}:${ttsConfig.daemonPort}`));
          } else {
            console.log(chalk.yellow('⚠ Failed to start Qwen TTS daemon:'), result.error ?? result.status?.error ?? 'unknown error');
          }
        }
      } catch (error: any) {
        console.log(chalk.yellow('⚠ Failed to evaluate Qwen TTS daemon auto-start:'), error?.message || String(error));
      }

      // Start the supervisor sidecar — exposes POST /restart-dashboard on a
      // separate port so the dashboard's Force Restart button still works
      // when the dashboard process itself has crashed.
      try {
        const { startSupervisorProcessSync, getSupervisorPortSync } = await import('../lib/supervisor.js');
        startSupervisorProcessSync();
        console.log(chalk.green(`✓ Supervisor listening on http://127.0.0.1:${getSupervisorPortSync()}`));
      } catch (error: any) {
        console.log(chalk.yellow('⚠ Failed to start supervisor:'), error?.message || String(error));
        console.log(chalk.dim('  Force Restart will only work via the Electron bridge or while dashboard is responding.'));
      }

      // Deferred context sync — moved off the critical path of `overdeck up`.
      // Spawned detached AFTER the dashboard is up so it neither blocks the
      // ~22s before the server spawns nor contends with the server's own boot.
      // A separate process so it completes regardless of how `pan up` exits
      // (foreground supervision, --detach, or the Electron fast-path). Its
      // output is discarded; the next Claude Code session picks up the result.
      try {
        const selfCli = fileURLToPath(import.meta.url);
        const syncChild = spawn(process.execPath, [selfCli, 'sync', '--if-changed'], {
          detached: true,
          stdio: 'ignore',
        });
        syncChild.on('error', () => { /* non-fatal: sync is best-effort */ });
        syncChild.unref();
        console.log(chalk.dim('Context sync (skills, rules, hooks, MCP, CLAUDE.md) running in background'));
      } catch (error: any) {
        console.log(chalk.yellow('⚠ Could not start deferred context sync (non-fatal):'), error?.message || String(error));
      }
    }

    async function openDashboardInBrowser(url: string): Promise<void> {
      if (options.open === false) return;

      try {
        const [{ openBrowser }, { layer: nodeServicesLayer }] = await Promise.all([
          import('../lib/browser.js'),
          import('@effect/platform-node/NodeServices'),
        ]);
        await Effect.runPromise(
          openBrowser(url).pipe(Effect.provide(nodeServicesLayer)),
        );
        console.log(chalk.green('✓ Dashboard opened in browser'));
      } catch {
        console.log(chalk.dim(`  Open your browser to: ${url}`));
      }
    }

    if (electronAppPath && options.open !== false) {
      console.log(chalk.dim(`\nLaunching Overdeck desktop app...`));
      console.log(chalk.dim(`  ${electronAppPath}`));
      const { spawn } = await import('child_process');
      const electronEnv = applyBootGateEnv({ ...process.env }, options);
      const child = spawn(electronAppPath, [], {
        detached: true,
        stdio: 'ignore',
        env: electronEnv,
      });

      const launchSucceeded = await new Promise<boolean>((resolve) => {
        let settled = false;
        const settle = (value: boolean) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };

        child.once('error', (err) => {
          console.warn(chalk.yellow(`⚠ Could not launch desktop app: ${err.message}`));
          console.warn(chalk.dim('  Falling back to bare server mode'));
          settle(false);
        });

        setTimeout(() => settle(true), 100);
      });

      if (launchSucceeded) {
        child.unref();
        console.log(chalk.green('✓ Desktop app launched'));
        await startPostLaunchSidecars();
        return;
      }
    }

    const { stopDashboard, readPlatformConfigSync } = await import('../lib/platform-lifecycle.js');
    const platformConfig = readPlatformConfigSync();
    await Effect.runPromise(stopDashboard({
      ...platformConfig,
      dashboardPort,
      dashboardApiPort,
      traefikEnabled,
      traefikDomain,
    }));

    // Start dashboard
    if (isProduction) {
      console.log(chalk.dim('Starting dashboard (bundled mode)...'));
    } else {
      console.log(chalk.dim('Starting dashboard (development mode)...'));
    }

    // Dashboard server MUST run under Node 22, not Bun.
    // Reason: node-pty (used by /ws/terminal for live tmux streaming) is a native
    // Node addon. Under Bun's native addon compat layer, the PTY spawns but exits
    // immediately (code 0), breaking the terminal panel for all workspaces.
    // Additionally, the TypeScript source has circular ESM dependencies that Node.js
    // strict ESM rejects but Bun tolerates — so we must run the built dist/server.js,
    // not the raw source via tsx.
    const node22 = (() => {
      // Prefer the nvm-managed Node 22 binary if available
      const nvmNode = '/home/eltmon/.config/nvm/versions/node/v22.22.0/bin/node';
      if (existsSync(nvmNode)) return nvmNode;
      return 'node'; // fall back to PATH
    })();

    const dashboardOriginEnv = traefikEnabled
      ? {
          DASHBOARD_URL: `https://${traefikDomain}`,
          OVERDECK_TRAEFIK_ENABLED: '1',
          OVERDECK_TRAEFIK_DOMAIN: traefikDomain,
          OVERDECK_TRUSTED_ORIGINS: [process.env.OVERDECK_TRUSTED_ORIGINS, `https://${traefikDomain}`].filter(Boolean).join(','),
        }
      : {};
    const dashboardBootEnv = applyBootGateEnv({ ...process.env }, options);
    if (options.seedFromLegacy) {
      dashboardBootEnv.OVERDECK_SEED_FROM_LEGACY = '1';
      console.log(chalk.yellow('  [--seed-from-legacy] local database will be seeded from the legacy database (conversations + in-flight state)'));
    }

    if (options.detach) {
      // Run in background
      const { openDashboardLogStdio } = await import('../lib/platform-lifecycle.js');
      const child = spawn(node22, [bundledServer], {
            detached: true,
            stdio: openDashboardLogStdio(),
            env: {
              ...dashboardBootEnv,
              ...dashboardOriginEnv,
              DASHBOARD_PORT: String(dashboardPort),
              API_PORT: String(dashboardApiPort),
              PORT: String(dashboardApiPort),
              OVERDECK_MODE: isProduction ? 'production' : 'development',
            },
          });

      // Handle spawn errors before unref
      let hasError = false;
      child.on('error', (err) => {
        hasError = true;
        console.error(chalk.red('Failed to start dashboard in background:'), err.message);
        process.exit(1);
      });

      // Small delay to catch immediate spawn errors
      setTimeout(() => {
        if (!hasError) {
          child.unref();
        }
      }, 100);

      // Health-gate: poll /api/health before reporting success so a half-started
      // dashboard can't masquerade as healthy. On timeout we log a warning but
      // do NOT tear down CLIProxy/TLDR below — keeping the system in the best
      // recoverable state (dashboard-side failure, sidecars still usable).
      let readyUrl: string;
      let apiUrl: string;
      let shouldOpenDashboard = true;
      try {
        const resolved = await resolveDashboardReadyUrl({
          traefikEnabled,
          traefikDomain,
          dashboardPort,
          dashboardApiPort,
        });
        readyUrl = resolved.readyUrl;
        apiUrl = resolved.apiUrl;
        console.log(chalk.green('✓ Dashboard started in background and passed /api/health'));
        if (traefikEnabled && !resolved.traefikReady) {
          console.log(
            chalk.yellow(
              `⚠ Traefik routing warming up — use ${readyUrl} meanwhile`,
            ),
          );
        }
      } catch (err: any) {
        readyUrl = traefikEnabled
          ? `https://${traefikDomain}`
          : `http://localhost:${dashboardPort}`;
        apiUrl = traefikEnabled
          ? `https://${traefikDomain}/api`
          : `http://localhost:${dashboardApiPort}`;
        shouldOpenDashboard = false;
        console.log(chalk.yellow(`⚠ Dashboard health check did not pass: ${err?.message || err}`));
        console.log(chalk.dim('  CLIProxy and Traefik have been left running — recover with `pan restart --dashboard` once the issue is fixed.'));
      }
      console.log(`  Frontend: ${chalk.cyan(readyUrl)}`);
      console.log(`  API:      ${chalk.cyan(apiUrl)}`);
      if (shouldOpenDashboard) {
        await openDashboardInBrowser(readyUrl);
      }
    } else {
      // Run in foreground
      const child = spawn(node22, [bundledServer], {
            stdio: 'inherit',
            env: {
              ...dashboardBootEnv,
              ...dashboardOriginEnv,
              DASHBOARD_PORT: String(dashboardPort),
              API_PORT: String(dashboardApiPort),
              PORT: String(dashboardApiPort),
              OVERDECK_MODE: isProduction ? 'production' : 'development',
            },
          });

      child.on('error', (err) => {
        console.error(chalk.red('Failed to start dashboard:'), err.message);
        process.exit(1);
      });

      let readyUrl: string;
      let apiUrl: string;
      let shouldOpenDashboard = true;
      try {
        const resolved = await resolveDashboardReadyUrl({
          traefikEnabled,
          traefikDomain,
          dashboardPort,
          dashboardApiPort,
        });
        readyUrl = resolved.readyUrl;
        apiUrl = resolved.apiUrl;
        if (traefikEnabled && !resolved.traefikReady) {
          console.log(
            chalk.yellow(
              `⚠ Traefik routing warming up — use ${readyUrl} meanwhile`,
            ),
          );
        }
      } catch (err: any) {
        readyUrl = traefikEnabled
          ? `https://${traefikDomain}`
          : `http://localhost:${dashboardPort}`;
        apiUrl = traefikEnabled
          ? `https://${traefikDomain}/api`
          : `http://localhost:${dashboardApiPort}`;
        shouldOpenDashboard = false;
        console.log(chalk.yellow(`⚠ Dashboard health check did not pass: ${err?.message || err}`));
      }
      console.log(`  Frontend: ${chalk.cyan(readyUrl)}`);
      console.log(`  API:      ${chalk.cyan(apiUrl)}`);
      console.log(chalk.dim('\nPress Ctrl+C to stop\n'));
      if (shouldOpenDashboard) {
        await openDashboardInBrowser(readyUrl);
      }
    }

    await startPostLaunchSidecars();
  });

program
  .command('down')
  .description('Stop dashboard (and Traefik if enabled)')
  .option('--skip-traefik', 'Skip Traefik shutdown')
  .action(async (options) => {
    const { execSync } = await import('child_process');
    const { join } = await import('path');
    const { readFileSync, existsSync } = await import('fs');
    const { parse } = await import('@iarna/toml');

    console.log(chalk.bold('Stopping Overdeck...\n'));

    // Stop smee-client webhook relay
    try {
      const { stopSmeeProcessSync } = await import('../lib/smee.js');
      console.log(chalk.dim('Stopping smee-client webhook relay...'));
      stopSmeeProcessSync();
      console.log(chalk.green('✓ smee-client stopped'));
    } catch {
      console.log(chalk.dim('  smee-client not running'));
    }

    // Stop the supervisor sidecar
    try {
      const { stopSupervisorProcessSync, isSupervisorRunningSync } = await import('../lib/supervisor.js');
      if (isSupervisorRunningSync()) {
        console.log(chalk.dim('Stopping supervisor sidecar...'));
        stopSupervisorProcessSync();
        console.log(chalk.green('✓ Supervisor stopped'));
      }
    } catch {
      // non-fatal
    }

    // Read config for ports and Traefik settings
    const configFile = join(process.env.HOME || '', '.overdeck', 'config.toml');
    let traefikEnabled = false;
    let dashboardPort = 3010;
    let dashboardApiPort = 3011;

    if (existsSync(configFile)) {
      try {
        const configContent = readFileSync(configFile, 'utf-8');
        const config = parse(configContent) as any;
        traefikEnabled = config.traefik?.enabled === true;
        dashboardPort = config.dashboard?.port || 3010;
        dashboardApiPort = config.dashboard?.api_port || 3011;
      } catch (error) {
        // Ignore config read errors
      }
    }

    // Stop dashboard — SIGTERM first, escalate to SIGKILL only if it refuses to exit.
    // Uses the shared lifecycle helper so `pan down` and `pan restart --dashboard`
    // have identical teardown semantics.
    console.log(chalk.dim('Stopping dashboard...'));
    try {
      const { stopDashboard, readPlatformConfigSync } = await import('../lib/platform-lifecycle.js');
      const platformConfig = readPlatformConfigSync();
      // Respect whatever ports this block already parsed out of config.toml.
      await Effect.runPromise(stopDashboard({ ...platformConfig, dashboardPort, dashboardApiPort }));
      console.log(chalk.green('✓ Dashboard stopped'));
    } catch {
      console.log(chalk.dim('  No dashboard processes found'));
    }

    // Kill review coordinator and reviewer sessions so they don't survive
    // dashboard restart and block new review dispatch (PAN-931).
    console.log(chalk.dim('Stopping review sessions...'));
    try {
      const { killAllReviewSessions } = await import('../lib/cloister/review-agent.js');
      const { killed, failed } = await Effect.runPromise(killAllReviewSessions());
      if (killed.length > 0) {
        console.log(chalk.green(`✓ Stopped ${killed.length} review session(s)`));
      }
      if (failed.length > 0) {
        console.log(chalk.yellow(`⚠ Failed to stop ${failed.length} review session(s)`));
      }
      if (killed.length === 0 && failed.length === 0) {
        console.log(chalk.dim('  No review sessions running'));
      }
    } catch {
      console.log(chalk.dim('  Review session cleanup skipped'));
    }

    // Stop Traefik if enabled
    if (traefikEnabled && !options.skipTraefik) {
      const traefikDir = join(process.env.HOME || '', '.overdeck', 'traefik');
      if (existsSync(traefikDir)) {
        console.log(chalk.dim('Stopping Traefik...'));
        try {
          execSync('docker compose down', {
            cwd: traefikDir,
            stdio: 'pipe',
          });
          console.log(chalk.green('✓ Traefik stopped'));
        } catch (error) {
          console.log(chalk.yellow('⚠ Failed to stop Traefik'));
        }
      }
    }

    // Stop CLIProxyAPI sidecar
    try {
      const { stopCliproxySync, isCliproxyRunningSync } = await import('../lib/cliproxy.js');
      if (isCliproxyRunningSync()) {
        console.log(chalk.dim('Stopping CLIProxyAPI sidecar...'));
        stopCliproxySync();
        console.log(chalk.green('✓ CLIProxyAPI stopped'));
      }
    } catch {
      // Non-fatal — cliproxy may not be installed/running
    }

    // Stop TLDR daemon on project root
    try {
      const { getTldrDaemonServiceSync } = await import('../lib/tldr-daemon.js');
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const projectRoot = process.cwd();
      const venvPath = join(projectRoot, '.venv');

      if (existsSync(venvPath)) {
        console.log(chalk.dim('\nStopping TLDR daemon...'));
        const tldrService = getTldrDaemonServiceSync(projectRoot, venvPath);
        await tldrService.stop();
        console.log(chalk.green('✓ TLDR daemon stopped'));
      }
    } catch (error: any) {
      // Non-fatal - TLDR daemon may not be running
      console.log(chalk.dim('  (TLDR daemon not running)'));
    }

    console.log('');
  });

program
  .command('reload')
  .description('Build Overdeck, then restart the dashboard only after the build succeeds')
  .option('--skip-build', 'Skip npm run build and restart the existing bundle')
  .option('--health-timeout <ms>', 'Dashboard /api/health wait budget in ms (default 30000)')
  .option('--no-deacon', 'Skip Cloister/Deacon auto-start after reload')
  .action(reloadCommand);

// Scoped restart: `pan restart` defaults to the dashboard only and never
// touches CLIProxy / Traefik / TLDR. Use `--full` for the nuclear option.
// See src/cli/commands/restart.ts for the scope contract.
program
  .command('restart')
  .description('Restart a platform component (default: dashboard only — leaves CLIProxy, Traefik, TLDR running)')
  .option('--dashboard', 'Restart only the dashboard (default)')
  .option('--cliproxy', 'Restart only the CLIProxy sidecar')
  .option('--traefik', 'Restart only Traefik')
  .option('--full', 'Restart the entire stack (equivalent to pan down && pan up)')
  .option('--force', 'For --cliproxy: redownload binary at the pinned version before restarting (use after bumping CLIPROXY_RELEASE_VERSION)')
  .option('--health-timeout <ms>', 'Dashboard /api/health wait budget in ms (default 15000)')
  .option('--deacon', 'Force Cloister/Deacon auto-start even if the shell inherited OVERDECK_DISABLE_DEACON')
  .option('--no-deacon', 'Skip Cloister/Deacon auto-start on restart (escape hatch when deacon\'s startup scan is starving the event loop)')
  .option('--resume', 'Enable agent auto-resume on boot — auto-resume is OFF by default (PAN-1963)')
  .option('--no-resume', 'Disable agent auto-resume on restart (now the default; flag kept for explicitness)')
  .action(restartCommand);

function registerProjectCommands(command: Command): void {
  command
    .command('add <path>')
    .description('Register a project with Overdeck')
    .option('--name <name>', 'Project name')
    .option('--type <type>', 'Project type (standalone/monorepo)', 'standalone')
    .option('--linear-team <team>', 'Linear team prefix (e.g., MIN, PAN)')
    .option('--rally-project <oid>', 'Rally project OID (e.g., /project/822404704163)')
    .action(projectAddCommand);

  command
    .command('list')
    .description('List all registered projects')
    .option('--json', 'Output as JSON')
    .action(projectListCommand);

  command
    .command('show <key>')
    .description('Show details for a specific project')
    .action(projectShowCommand);

  command
    .command('remove <nameOrPath>')
    .description('Remove a project from the registry')
    .action(projectRemoveCommand);

  command
    .command('init')
    .description('Initialize projects.yaml with example configuration')
    .action(projectInitCommand);
}

// Project management commands
const project = program.command('project').description('Project registry for multi-project workspace support');
registerProjectCommands(project);

const projects = program.command('projects').description('Project registry for multi-project workspace support');
registerProjectCommands(projects);

// Health command
program
  .command('health')
  .description('Show runtime health of Overdeck services')
  .action(systemHealthCommand);

// Doctor command
program
  .command('doctor')
  .description('Check system health and dependencies')
  .option('--strict', 'Exit non-zero if any optional dependency is missing (e.g. Pi binary)')
  .action((options) => doctorCommand(options));

// Resources command
program
  .command('resources')
  .description('Show RAM usage by agents, conversations, and system processes')
  .option('--json', 'Output as JSON')
  .action(resourcesCommand);

// Update command
program
  .command('update')
  .description('Update Overdeck to latest version')
  .option('--check', 'Only check for updates, don\'t install')
  .option('--force', 'Force update even if on latest')
  .action(updateCommand);

// Cost tracking commands (pan cost today, pan cost sync, etc.)
program.addCommand(createCostCommand());

// ─── npx overdeck — server + browser launcher ───────────────────────────────
// Low-friction entry point: no Electron required.
// Starts the dashboard server and opens the browser to the dashboard URL.
// Usage: npx overdeck  (or: npx overdeck serve)

program
  .command('serve')
  .description('Start the dashboard server and open it in the default browser (npx launcher)')
  .option('--port <port>', 'Port to listen on', '3011')
  .action(async (options: { port: string }) => {
    const { spawn } = await import('child_process');
    const { randomBytes } = await import('crypto');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const { existsSync } = await import('fs');

    // Check Node.js version — dashboard requires Node 22+ (node-pty, Effect.js)
    const nodeVersion = process.versions.node;
    const major = parseInt(nodeVersion.split('.')[0]!, 10);
    if (major < 22) {
      console.error(chalk.red(`Error: Overdeck dashboard requires Node.js 22 or later.`));
      console.error(chalk.dim(`You are running Node.js ${nodeVersion}.`));
      console.error('');
      console.error('Install Node 22:');
      console.error(chalk.dim('  nvm install 22 && nvm use 22'));
      console.error(chalk.dim('  # or: brew install node@22'));
      console.error(chalk.dim('  # or: https://nodejs.org/en/download'));
      process.exit(1);
    }

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const bundledServer = join(__dirname, '..', 'dashboard', 'server.js');
    const bundledFrontendIndex = join(__dirname, '..', 'dashboard', 'public', 'index.html');
    const port = parseInt(options.port, 10) || 3011;
    const url = `http://localhost:${port}`;
    const internalToken = process.env.OVERDECK_INTERNAL_TOKEN || randomBytes(32).toString('hex');
    const browserUrl = `${url}#overdeck_token=${encodeURIComponent(internalToken)}`;

    if (!existsSync(bundledServer) || !existsSync(bundledFrontendIndex)) {
      console.error(chalk.red('Error: Dashboard bundle not found.'));
      console.error(chalk.dim('This package may not be fully built. Try: npm run build'));
      process.exit(1);
    }

    console.log(chalk.bold('Overdeck Dashboard'));
    console.log(chalk.dim(`Starting server on port ${port} (Node ${nodeVersion})...`));

    const server = spawn(process.execPath, [bundledServer], {
      stdio: 'inherit',
      env: { ...process.env, PORT: String(port), OVERDECK_INTERNAL_TOKEN: internalToken },
    });

    server.on('error', (err) => {
      console.error(chalk.red('Failed to start dashboard:'), err.message);
      process.exit(1);
    });

    // Open browser after server has had a moment to start
    setTimeout(async () => {
      console.log(`  ${chalk.cyan(url)}`);
      const [{ openBrowser }, { Effect }, { layer: nodeServicesLayer }] = await Promise.all([
        import('../lib/browser.js'),
        import('effect'),
        import('@effect/platform-node/NodeServices'),
      ]);
      await Effect.runPromise(
        openBrowser(browserUrl).pipe(Effect.provide(nodeServicesLayer)),
      ).catch(() => {
        // If openBrowser fails, show URL for manual opening
        console.log(chalk.dim(`  Open your browser to: ${browserUrl}`));
      });
    }, 1_500);
  });

// Default action: show help (Commander default) unless no args → serve
if (process.argv.length === 2) {
  // npx overdeck with no args → act as serve
  process.argv.push('serve');
}

// Parse and execute
await program.parseAsync();
