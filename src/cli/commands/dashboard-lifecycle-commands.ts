/**
 * Command definitions for the dashboard lifecycle verbs: `pan up`,
 * `pan reload` and `pan restart` (plus `pan restart approve`).
 *
 * None of these verbs takes a positional argument. Commander 12 accepts
 * excess arguments by default, so `pan restart status` used to fall through
 * to a real dashboard restart request (PAN-3912). Each verb here rejects
 * unknown positionals before its action runs.
 */

import type { Command } from 'commander';
import { reloadCommand } from './reload.js';
import { restartApproveCommand, restartCommand } from './restart.js';

/** Defines `pan up` without its action; the caller attaches the action. */
export function defineUpCommand(program: Command): Command {
  return program
    .command('up')
    .description('Start dashboard (and Traefik if enabled)')
    .allowExcessArguments(false)
    .option('--detach', 'Run in background')
    .option('--skip-traefik', 'Skip Traefik startup')
    .option('--deacon', 'Force Cloister/Deacon auto-start even if the shell inherited OVERDECK_DISABLE_DEACON')
    .option('--no-deacon', 'Skip Cloister/Deacon auto-start (escape hatch when deacon\'s startup scan is starving the event loop)')
    .option('--resume', 'Enable agent auto-resume on boot — auto-resume is ON by default (flag kept for explicitness)')
    .option('--no-resume', 'Disable agent auto-resume (opt out of the default-on auto-resume)')
    .option('--no-open', 'Do not open the dashboard app/browser after startup')
    .option('--seed-from-legacy', 'Seed a fresh local database from the legacy database (copy conversations + reconstruct in-flight agents/issues). Default is an empty local database.');
}

/** Registers `pan reload`, `pan restart` and `pan restart approve`. */
export function registerReloadAndRestartCommands(program: Command): void {
  program
    .command('reload')
    .description('Build Overdeck, then restart the dashboard only after the build succeeds')
    .allowExcessArguments(false)
    .option('--skip-build', 'Skip npm run build and restart the existing bundle')
    .option('--force', 'Bypass the agent deploy-window gate (agent-initiated reloads are otherwise refused while deploy-window block reasons are active)')
    .option('--health-timeout <duration>', 'Dashboard /api/health wait budget — ms, or Ns/Nm suffix (default 30s; floor 1000ms)')
    .option('--no-deacon', 'Skip Cloister/Deacon auto-start after reload')
    .action(reloadCommand);

  // Scoped restart: `pan restart` defaults to the dashboard only and never
  // touches CLIProxy / Traefik / TLDR. Use `--full` for the nuclear option.
  // See src/cli/commands/restart.ts for the scope contract.
  const restart = program
    .command('restart')
    .description('Restart a platform component (default: dashboard only — leaves CLIProxy, Traefik, TLDR running)')
    // Set before `approve` is created so the subcommand inherits it. The help
    // shown after the error lists the real subcommands.
    .allowExcessArguments(false)
    .showHelpAfterError()
    .option('--dashboard', 'Restart only the dashboard (default)')
    .option('--cliproxy', 'Restart only the CLIProxy sidecar')
    .option('--traefik', 'Restart only Traefik')
    .option('--full', 'Restart the entire stack (equivalent to pan down && pan up)')
    .option('--force', 'For --cliproxy: redownload binary at the pinned version before restarting (use after bumping CLIPROXY_RELEASE_VERSION). For dashboard scope: bypass the agent deploy-window gate (agent-initiated restarts are otherwise refused while deploy-window block reasons are active)')
    .option('--health-timeout <duration>', 'Dashboard /api/health wait budget — ms, or Ns/Nm suffix (default 15s; floor 1000ms)')
    .option('--deacon', 'Force Cloister/Deacon auto-start even if the shell inherited OVERDECK_DISABLE_DEACON')
    .option('--no-deacon', 'Skip Cloister/Deacon auto-start on restart (escape hatch when deacon\'s startup scan is starving the event loop)')
    .option('--resume', 'Enable agent auto-resume on boot — auto-resume is ON by default (flag kept for explicitness)')
    .option('--no-resume', 'Disable agent auto-resume on restart (opt out of the default-on auto-resume)')
    .option('--now', 'Skip the operator-approval wait: approve everything already waiting, then restart the dashboard immediately')
    .action(restartCommand);

  // Dashboard, reload and post-merge deploy restarts wait for operator approval so
  // they cannot interrupt live work. This releases whatever is waiting — the same
  // thing the dashboard banner's "Restart now" button does.
  restart
    .command('approve')
    .description('Approve every dashboard restart request that is waiting for the operator')
    .action(async () => {
      await restartApproveCommand();
    });
}
