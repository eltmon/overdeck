#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Load ~/.panopticon.env before any other imports
// This makes API keys and other env vars available to all commands
const PANOPTICON_ENV_FILE = join(homedir(), '.panopticon.env');
if (existsSync(PANOPTICON_ENV_FILE)) {
  try {
    const envContent = readFileSync(PANOPTICON_ENV_FILE, 'utf-8');
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
    console.warn('Warning: Failed to load ~/.panopticon.env:', (error as Error).message);
  }
}

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { syncCommand } from './commands/sync.js';
import { restoreCommand } from './commands/restore.js';
import { backupListCommand, backupCleanCommand } from './commands/backup.js';
import { skillsCommand } from './commands/skills.js';
import { statusCommand } from './commands/status.js';
import { issueCommand as startCommand } from './commands/start.js';
import { tellCommand } from './commands/tell.js';
import { killCommand } from './commands/kill.js';
import { forkCommand } from './commands/fork.js';
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
import { reviewRunCommand } from './commands/review-run.js';
import { reviewRestartCommand } from './commands/review-restart.js';
import { registerWorkspaceCommands } from './commands/workspace.js';
import { registerTestCommands } from './commands/test.js';
import { registerInstallCommand } from './commands/install.js';
import { registerAdminCommands } from './commands/admin/index.js';
import { projectAddCommand, projectListCommand, projectRemoveCommand, projectInitCommand, projectShowCommand } from './commands/project.js';
import { doctorCommand } from './commands/doctor.js';
import { systemHealthCommand } from './commands/system-health.js';
import { updateCommand } from './commands/update.js';
import { restartCommand } from './commands/restart.js';
import { registerInspectCommand } from './commands/inspect.js';
import { createCostCommand } from './commands/cost.js';
import { planFinalizeCommand } from './commands/plan-finalize.js';
import { registerCavemanCommands } from './commands/caveman.js';
import { registerReleaseCommands } from './commands/release.js';
import { resourcesCommand } from './commands/resources.js';
import { devCommand } from './commands/dev.js';
import { registerScopeCommands } from './commands/scope.js';

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
  .name('pan')
  .description('Multi-agent orchestration for AI coding assistants')
  .version(JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf-8')).version);

program
  .command('init')
  .description('Initialize Panopticon (~/.panopticon/)')
  .action(initCommand);

program
  .command('sync')
  .description('Sync skills/agents/rules to devroot')
  .option('--dry-run', 'Show what would be synced')
  .option('--force', 'Overwrite files modified since Panopticon installed them')
  .option('--diff', 'Show diff for modified files')
  .option('--backup-only', 'Only create backup')
  .action(syncCommand);

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

// pan review — pending, request, reset
const review = program
  .command('review')
  .description('Review-loop management: pending items, request re-review, reset cycles');

review
  .command('pending')
  .description('List completed work awaiting review')
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
  .command('run <id>')
  .description('Run the full review pipeline (blocking): spawn reviewers → synthesize → post to GitHub. Exit codes: 0=approved, 1=changes, 2=failed.')
  .option('--cwd <path>', 'Workspace directory (default: cwd)')
  .option('--pr-url <url>', 'Override PR URL detection')
  .option('--branch <name>', 'Override branch detection')
  .option('--files-changed <list>', 'Comma-separated file list (overrides git diff)')
  .option('--model <model>', 'Override model for all reviewers')
  .action(reviewRunCommand);

// pan plan finalize <id>
const planCmd = program
  .command('plan')
  .description('Finalize an existing plan');

planCmd
  .command('finalize')
  .description('Materialize plan into beads, write completion marker')
  .option('-w, --workspace <path>', 'Workspace path (defaults to cwd, walks up to find .planning/)')
  .option('--json', 'Emit JSON result')
  .action(planFinalizeCommand);

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
  .command('fork <conv>')
  .description('Summary Fork a conversation — creates new session from a summary of previous work')
  .option('--model <model>', 'Model for the summary-forked session')
  .option('--cwd <path>', 'Working directory for the summary-forked session')
  .option('--plain', 'Skip summary generation and copy raw conversation history')
  .action(forkCommand);

program
  .command('unarchive-conversation <query>')
  .description('Restore an archived conversation by exact name or matching title')
  .action(unarchiveConversationCommand);

program
  .command('resume <id>')
  .description('Resume from saved Claude session')
  .action(resumeCommand);

program
  .command('recover [id]')
  .description('Recover crashed or stopped agent')
  .option('--all', 'Auto-recover all crashed agents')
  .option('--json', 'Output as JSON')
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
  .option('--json', 'Output as JSON')
  .action(doneCommand);

program
  .command('approve <id>')
  .description('[REMOVED] Use dashboard MERGE button instead')
  .action(approveCommand);

program
  .command('reopen <id>')
  .description('Re-open issue for rework (resets specialist state)')
  .option('--reason <reason>', 'Reason for reopening')
  .option('--force', 'Skip confirmation prompt')
  .action(reopenCommand);

program
  .command('wipe <id>')
  .description('Destructive: reset all state for an issue. Confirms.')
  .option('--force', 'Skip confirmation')
  .action(wipeCommand);

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
  .option('--dry-run', 'Show what would be created')
  .option('--shadow', 'Enable shadow mode')
  .option('--no-shadow', 'Disable shadow mode')
  .option('--remote', 'Use remote workspace (Fly.io)')
  .option('--local', 'Use local workspace (explicit override)')
  .option('--phase <phase>', 'Work phase for model routing')
  .action(startCommand);

// Register workspace commands (pan workspace create, pan workspace list, etc.)
registerWorkspaceCommands(program);

// Register test commands (pan test run, pan test list)
registerTestCommands(program);

// Register release commands (pan release check/stable/canary/notes)
registerReleaseCommands(program);

// Register admin commands (pan admin cloister, pan admin specialists, etc.)
registerAdminCommands(program);

// Register install command
registerInstallCommand(program);

// Register inspect command (pan inspect <issueId> --bead <beadId>)
registerInspectCommand(program);

// Register caveman commands (pan caveman-compress)
registerCavemanCommands(program);
registerScopeCommands(program);

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
  .action(devCommand);

program
  .command('up')
  .description('Start dashboard (and Traefik if enabled)')
  .option('--detach', 'Run in background')
  .option('--skip-traefik', 'Skip Traefik startup')
  .action(async (options) => {
    const { spawn, execSync } = await import('child_process');
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
    const configFile = join(process.env.HOME || '', '.panopticon', 'config.toml');
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

    console.log(chalk.bold('Starting Panopticon...\n'));

    // Auto-sync skills, hooks, and MCP config on every startup
    {
      const origWrite = process.stdout.write;
      const origErrWrite = process.stderr.write;
      try {
        const { syncCommand } = await import('./commands/sync.js');
        process.stdout.write = () => true;  // suppress all output during sync
        process.stderr.write = () => true;
        await syncCommand({});
        process.stdout.write = origWrite;
        process.stderr.write = origErrWrite;
        console.log(chalk.dim('  Auto-synced skills, hooks, and MCP config'));
      } catch {
        process.stdout.write = origWrite;
        process.stderr.write = origErrWrite;
        console.log(chalk.yellow('⚠ Auto-sync failed (non-fatal, continuing startup)'));
      }
    }

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
          execSync(`tmux -L panopticon set-environment -gu ${varName}`, { stdio: 'ignore' });
        } catch {
          // No server running or var not set — fine
        }
      }
    }

    // Regenerate Traefik dynamic config and ensure DNS
    if (traefikEnabled && !options.skipTraefik) {
      try {
        const { generatePanopticonTraefikConfig, ensureProjectCerts, generateTlsConfig, cleanupStaleTlsSections } = await import('../lib/traefik.js');

        // Clean stale tls: sections from older config files
        cleanupStaleTlsSections();

        if (generatePanopticonTraefikConfig()) {
          console.log(chalk.dim('  Regenerated Traefik config from template'));
        }

        // Generate missing certs for registered projects
        const generatedDomains = ensureProjectCerts();
        for (const domain of generatedDomains) {
          console.log(chalk.dim(`  Generated wildcard cert for *.${domain}`));
        }

        // Generate tls.yml from all discovered certs
        if (generateTlsConfig()) {
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
          'docker ps --filter "name=panopticon-traefik" --format "{{.Names}}" 2>/dev/null',
          { encoding: 'utf-8' }
        ).trim();
        if (containerCheck.includes('panopticon-traefik')) {
          console.log(chalk.yellow('⚠ Traefik container is running but traefik.enabled is not set in config'));
          console.log(chalk.yellow('  Run `pan install` to configure Traefik, or `pan down` to stop it\n'));
        }
      } catch {
        // Docker not available, ignore
      }
    }

    // Start Traefik if enabled
    if (traefikEnabled && !options.skipTraefik) {
      const traefikDir = join(process.env.HOME || '', '.panopticon', 'traefik');
      if (existsSync(traefikDir)) {
        try {
          // Ensure network is marked as external (migration for older installs)
          const composeFile = join(traefikDir, 'docker-compose.yml');
          if (existsSync(composeFile)) {
            const content = readFileSync(composeFile, 'utf-8');
            if (!content.includes('external: true') && content.includes('panopticon:')) {
              const patched = content.replace(
                /networks:\s*\n\s*panopticon:\s*\n\s*name: panopticon\s*\n\s*driver: bridge/,
                'networks:\n  panopticon:\n    name: panopticon\n    external: true  # Network created by \'pan install\''
              );
              const { writeFileSync } = await import('fs');
              writeFileSync(composeFile, patched);
              console.log(chalk.dim('  (migrated network config)'));
            }
          }

          console.log(chalk.dim('Starting Traefik...'));
          execSync('docker compose up -d', {
            cwd: traefikDir,
            stdio: 'pipe',
          });
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
      console.error(chalk.dim('This may be a corrupted installation. Try reinstalling @panctl/cli.'));
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
          join(home, '.local', 'bin', 'panopticon'),
          join(home, '.local', 'share', 'applications', 'panopticon'),
          '/usr/local/bin/panopticon',
          '/opt/panopticon/panopticon',
        );
        // Glob-style: $HOME/Applications/Panopticon*.AppImage
        try {
          const appsDir = join(home, 'Applications');
          const { readdirSync } = require('fs') as typeof import('fs');
          if (existsSync(appsDir)) {
            const appImages = readdirSync(appsDir).filter(
              (f: string) => f.startsWith('Panopticon') && f.endsWith('.AppImage'),
            );
            for (const f of appImages) candidates.push(join(appsDir, f));
          }
        } catch {
          // ignore
        }
      } else if (process.platform === 'darwin') {
        candidates.push(
          '/Applications/Panopticon.app/Contents/MacOS/Panopticon',
          join(home, 'Applications', 'Panopticon.app', 'Contents', 'MacOS', 'Panopticon'),
        );
      } else if (process.platform === 'win32') {
        const localApp = process.env.LOCALAPPDATA || '';
        candidates.push(join(localApp, 'Programs', 'panopticon', 'Panopticon.exe'));
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
        const { startCliproxy, CLIPROXY_PORT } = await import('../lib/cliproxy.js');
        console.log(chalk.dim('Starting CLIProxyAPI sidecar (GPT subscription router)...'));
        startCliproxy();
        console.log(chalk.green(`✓ CLIProxyAPI listening on http://127.0.0.1:${CLIPROXY_PORT}`));
      } catch (error: any) {
        console.log(chalk.yellow('⚠ Failed to start CLIProxyAPI sidecar:'), error?.message || String(error));
        console.log(chalk.dim('  GPT subscription agents will not work until this is resolved.'));
      }

      // Start smee-client webhook relay (optional — non-fatal)
      try {
        const { startSmeeProcess } = await import('../lib/smee.js');
        console.log(chalk.dim('\nStarting smee-client webhook relay...'));
        startSmeeProcess();
      } catch (error: any) {
        console.log(chalk.yellow('⚠ Failed to start smee-client:'), error?.message || String(error));
        console.log(chalk.dim('  Webhook relay unavailable — GitHub events will use polling fallback'));
      }

      // Start TLDR daemon on project root (if Python3 and venv available)
      try {
        const { getTldrDaemonService } = await import('../lib/tldr-daemon.js');
        const projectRoot = process.cwd();
        const venvPath = join(projectRoot, '.venv');
        if (existsSync(venvPath)) {
          console.log(chalk.dim('\nStarting TLDR daemon for project root...'));
          const tldrService = getTldrDaemonService(projectRoot, venvPath);
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

      // Start the supervisor sidecar — exposes POST /restart-dashboard on a
      // separate port so the dashboard's Force Restart button still works
      // when the dashboard process itself has crashed.
      try {
        const { startSupervisorProcess, getSupervisorPort } = await import('../lib/supervisor.js');
        startSupervisorProcess();
        console.log(chalk.green(`✓ Supervisor listening on http://127.0.0.1:${getSupervisorPort()}`));
      } catch (error: any) {
        console.log(chalk.yellow('⚠ Failed to start supervisor:'), error?.message || String(error));
        console.log(chalk.dim('  Force Restart will only work via the Electron bridge or while dashboard is responding.'));
      }
    }

    if (electronAppPath) {
      console.log(chalk.dim(`\nLaunching Panopticon desktop app...`));
      console.log(chalk.dim(`  ${electronAppPath}`));
      const { spawn } = await import('child_process');
      const child = spawn(electronAppPath, [], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
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

    // Kill any existing dashboard processes before starting a new one.
    // This prevents EADDRINUSE when pan up is run while a dashboard is already running.
    // Uses fuser instead of lsof | xargs kill — busybox lsof on Alpine ignores -t/-i
    // and lists ALL processes, which xargs then tries to kill (including PID 1).
    try {
      execSync(`fuser -k -TERM ${dashboardPort}/tcp 2>/dev/null || true`, { stdio: 'pipe' });
      execSync(`fuser -k -TERM ${dashboardApiPort}/tcp 2>/dev/null || true`, { stdio: 'pipe' });
    } catch {
      // No existing processes — that's fine
    }

    const waitForPortToFree = async (port: number, timeoutMs = 5000): Promise<void> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        try {
          execSync(`bash -c 'echo >/dev/tcp/127.0.0.1/${port}'`, { encoding: 'utf8', stdio: 'pipe', timeout: 1000 });
        } catch {
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };

    await Promise.all([
      waitForPortToFree(dashboardPort),
      waitForPortToFree(dashboardApiPort),
    ]);

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

    if (options.detach) {
      // Run in background
      const { openDashboardLogStdio } = await import('../lib/platform-lifecycle.js');
      const child = spawn(node22, [bundledServer], {
            detached: true,
            stdio: openDashboardLogStdio(),
            env: {
              ...process.env,
              DASHBOARD_PORT: String(dashboardPort),
              PANOPTICON_MODE: isProduction ? 'production' : 'development',
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
      try {
        const { waitForDashboardHealth } = await import('../lib/platform-lifecycle.js');
        await waitForDashboardHealth(dashboardApiPort, { timeoutMs: 15_000 });
        console.log(chalk.green('✓ Dashboard started in background and passed /api/health'));
      } catch (err: any) {
        console.log(chalk.yellow(`⚠ Dashboard health check did not pass: ${err?.message || err}`));
        console.log(chalk.dim('  CLIProxy and Traefik have been left running — recover with `pan restart --dashboard` once the issue is fixed.'));
      }
      if (traefikEnabled) {
        console.log(`  Frontend: ${chalk.cyan(`https://${traefikDomain}`)}`);
        console.log(`  API:      ${chalk.cyan(`https://${traefikDomain}/api`)}`);
      } else {
        console.log(`  Frontend: ${chalk.cyan(`http://localhost:${dashboardPort}`)}`);
        console.log(`  API:      ${chalk.cyan(`http://localhost:${dashboardApiPort}`)}`);
      }
    } else {
      // Run in foreground
      if (traefikEnabled) {
        console.log(`  Frontend: ${chalk.cyan(`https://${traefikDomain}`)}`);
        console.log(`  API:      ${chalk.cyan(`https://${traefikDomain}/api`)}`);
      } else {
        console.log(`  Frontend: ${chalk.cyan(`http://localhost:${dashboardPort}`)}`);
        console.log(`  API:      ${chalk.cyan(`http://localhost:${dashboardApiPort}`)}`);
      }
      console.log(chalk.dim('\nPress Ctrl+C to stop\n'));

      const child = spawn(node22, [bundledServer], {
            stdio: 'inherit',
            env: {
              ...process.env,
              DASHBOARD_PORT: String(dashboardPort),
              PANOPTICON_MODE: isProduction ? 'production' : 'development',
            },
          });

      child.on('error', (err) => {
        console.error(chalk.red('Failed to start dashboard:'), err.message);
        process.exit(1);
      });
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

    console.log(chalk.bold('Stopping Panopticon...\n'));

    // Stop smee-client webhook relay
    try {
      const { stopSmeeProcess } = await import('../lib/smee.js');
      console.log(chalk.dim('Stopping smee-client webhook relay...'));
      stopSmeeProcess();
      console.log(chalk.green('✓ smee-client stopped'));
    } catch {
      console.log(chalk.dim('  smee-client not running'));
    }

    // Stop the supervisor sidecar
    try {
      const { stopSupervisorProcess, isSupervisorRunning } = await import('../lib/supervisor.js');
      if (isSupervisorRunning()) {
        console.log(chalk.dim('Stopping supervisor sidecar...'));
        stopSupervisorProcess();
        console.log(chalk.green('✓ Supervisor stopped'));
      }
    } catch {
      // non-fatal
    }

    // Read config for ports and Traefik settings
    const configFile = join(process.env.HOME || '', '.panopticon', 'config.toml');
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
      const { stopDashboard, readPlatformConfig } = await import('../lib/platform-lifecycle.js');
      const platformConfig = readPlatformConfig();
      // Respect whatever ports this block already parsed out of config.toml.
      await stopDashboard({ ...platformConfig, dashboardPort, dashboardApiPort });
      console.log(chalk.green('✓ Dashboard stopped'));
    } catch {
      console.log(chalk.dim('  No dashboard processes found'));
    }

    // Stop Traefik if enabled
    if (traefikEnabled && !options.skipTraefik) {
      const traefikDir = join(process.env.HOME || '', '.panopticon', 'traefik');
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
      const { stopCliproxy, isCliproxyRunning } = await import('../lib/cliproxy.js');
      if (isCliproxyRunning()) {
        console.log(chalk.dim('Stopping CLIProxyAPI sidecar...'));
        stopCliproxy();
        console.log(chalk.green('✓ CLIProxyAPI stopped'));
      }
    } catch {
      // Non-fatal — cliproxy may not be installed/running
    }

    // Stop TLDR daemon on project root
    try {
      const { getTldrDaemonService } = await import('../lib/tldr-daemon.js');
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const projectRoot = process.cwd();
      const venvPath = join(projectRoot, '.venv');

      if (existsSync(venvPath)) {
        console.log(chalk.dim('\nStopping TLDR daemon...'));
        const tldrService = getTldrDaemonService(projectRoot, venvPath);
        await tldrService.stop();
        console.log(chalk.green('✓ TLDR daemon stopped'));
      }
    } catch (error: any) {
      // Non-fatal - TLDR daemon may not be running
      console.log(chalk.dim('  (TLDR daemon not running)'));
    }

    console.log('');
  });

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
  .option('--health-timeout <ms>', 'Dashboard /api/health wait budget in ms (default 15000)')
  .action(restartCommand);

// Project management commands
const project = program.command('project').description('Project registry for multi-project workspace support');

project
  .command('add <path>')
  .description('Register a project with Panopticon')
  .option('--name <name>', 'Project name')
  .option('--type <type>', 'Project type (standalone/monorepo)', 'standalone')
  .option('--linear-team <team>', 'Linear team prefix (e.g., MIN, PAN)')
  .option('--rally-project <oid>', 'Rally project OID (e.g., /project/822404704163)')
  .action(projectAddCommand);

project
  .command('list')
  .description('List all registered projects')
  .option('--json', 'Output as JSON')
  .action(projectListCommand);

project
  .command('show <key>')
  .description('Show details for a specific project')
  .action(projectShowCommand);

project
  .command('remove <nameOrPath>')
  .description('Remove a project from the registry')
  .action(projectRemoveCommand);

project
  .command('init')
  .description('Initialize projects.yaml with example configuration')
  .action(projectInitCommand);

// Health command
program
  .command('health')
  .description('Show runtime health of Panopticon services')
  .action(systemHealthCommand);

// Doctor command
program
  .command('doctor')
  .description('Check system health and dependencies')
  .action(doctorCommand);

// Resources command
program
  .command('resources')
  .description('Show RAM usage by agents, conversations, and system processes')
  .option('--json', 'Output as JSON')
  .action(resourcesCommand);

// Update command
program
  .command('update')
  .description('Update Panopticon to latest version')
  .option('--check', 'Only check for updates, don\'t install')
  .option('--force', 'Force update even if on latest')
  .action(updateCommand);

// Cost tracking commands (pan cost today, pan cost sync, etc.)
program.addCommand(createCostCommand());

// ─── npx panopticon — server + browser launcher ───────────────────────────────
// Low-friction entry point: no Electron required.
// Starts the dashboard server and opens the browser to the dashboard URL.
// Usage: npx panopticon  (or: npx panopticon serve)

program
  .command('serve')
  .description('Start the dashboard server and open it in the default browser (npx launcher)')
  .option('--port <port>', 'Port to listen on', '3011')
  .action(async (options: { port: string }) => {
    const { spawn, execSync } = await import('child_process');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const { existsSync } = await import('fs');

    // Check Node.js version — dashboard requires Node 22+ (node-pty, Effect.js)
    const nodeVersion = process.versions.node;
    const major = parseInt(nodeVersion.split('.')[0]!, 10);
    if (major < 22) {
      console.error(chalk.red(`Error: Panopticon dashboard requires Node.js 22 or later.`));
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

    if (!existsSync(bundledServer) || !existsSync(bundledFrontendIndex)) {
      console.error(chalk.red('Error: Dashboard bundle not found.'));
      console.error(chalk.dim('This package may not be fully built. Try: npm run build'));
      process.exit(1);
    }

    console.log(chalk.bold('Panopticon Dashboard'));
    console.log(chalk.dim(`Starting server on port ${port} (Node ${nodeVersion})...`));

    const server = spawn(process.execPath, [bundledServer], {
      stdio: 'inherit',
      env: { ...process.env, PORT: String(port) },
    });

    server.on('error', (err) => {
      console.error(chalk.red('Failed to start dashboard:'), err.message);
      process.exit(1);
    });

    // Open browser after server has had a moment to start
    setTimeout(async () => {
      console.log(`  ${chalk.cyan(url)}`);
      try {
        const { openBrowser } = await import('../lib/browser.js');
        await openBrowser(url);
      } catch {
        // If openBrowser fails, show URL for manual opening
        console.log(chalk.dim(`  Open your browser to: ${url}`));
      }
    }, 1_500);
  });

// Default action: show help (Commander default) unless no args → serve
if (process.argv.length === 2) {
  // npx panopticon with no args → act as serve
  process.argv.push('serve');
}

// Parse and execute
await program.parseAsync();
