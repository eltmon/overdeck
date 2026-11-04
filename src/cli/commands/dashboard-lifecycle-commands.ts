/**
 * Command definitions for the dashboard lifecycle verbs: `pan up`,
 * `pan reload` and `pan restart` (plus `pan restart approve`, `hold` and
 * `release`).
 *
 * None of these verbs takes a positional argument. Commander 12 accepts
 * excess arguments by default, so `pan restart status` used to fall through
 * to a real dashboard restart request (PAN-3912). Each verb here rejects
 * unknown positionals before its action runs.
 */

import type { Command } from 'commander';
import { lazyAction } from '../lazy-action.js';

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

/** Registers `pan reload`, `pan restart` and its `approve`, `hold` and `release` subcommands. */
export function registerReloadAndRestartCommands(program: Command): void {
  program
    .command('reload')
    .description('Build Overdeck, then restart the dashboard only after the build succeeds')
    .allowExcessArguments(false)
    .option('--skip-build', 'Skip npm run build and restart the existing bundle')
    .option('--force', 'Bypass the agent deploy-window gate (agent-initiated reloads are otherwise refused while deploy-window block reasons are active)')
    .option('--health-timeout <duration>', 'Dashboard /api/health wait budget — ms, or Ns/Nm suffix (default 30s; floor 1000ms)')
    .option('--deacon', 'Start Cloister/Deacon on the reloaded dashboard (always on after a reload)')
    .option('--no-deacon', 'Refused: a Deacon-off dashboard is a peer and cannot hold the host dashboard port')
    .option('--resume', 'Enable agent auto-resume on the reloaded dashboard (default: keep the running dashboard\'s resume gate)')
    .option('--no-resume', 'Disable agent auto-resume on the reloaded dashboard (default: keep the running dashboard\'s resume gate)')
    .action(lazyAction(() => import('./reload.js'), 'reloadCommand'));

  // Scoped restart: `pan restart` defaults to the dashboard only and never
  // touches CLIProxy / Traefik. Use `--full` for the nuclear option.
  // See src/cli/commands/restart.ts for the scope contract.
  const restart = program
    .command('restart')
    .description('Restart a platform component (default: dashboard only — leaves CLIProxy and Traefik running)')
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
    .action(lazyAction(() => import('./restart.js'), 'restartCommand'));

  // Dashboard, reload and post-merge deploy restarts wait for operator approval so
  // they cannot interrupt live work. This releases whatever is waiting — the same
  // thing the dashboard banner's "Restart now" button does.
  restart
    .command('approve')
    .description('Approve every dashboard restart request that is waiting for the operator')
    .action(async () => {
      await (await import('./restart.js')).restartApproveCommand();
    });

  // PAN-5007: an operator-set hold that every `pan reload`, `pan restart` and
  // restart approval refuses on, from any conversation, until released.
  restart
    .command('hold')
    .description('Hold every dashboard restart and reload until `pan restart release` (or --until expires)')
    .option('--reason <text>', 'Why restarts are held; every refused command prints it')
    .option('--until <when>', 'Lift the hold on its own: a duration (90m, 2h, 1d) or an ISO time')
    .option('--status', 'Show the current hold instead of setting one')
    .action(async (options: { reason?: string; until?: string; status?: boolean }) => {
      await (await import('./restart-hold.js')).restartHoldCommand(options);
    });

  restart
    .command('release')
    .description('Release the restart hold so `pan reload` and `pan restart` run again')
    .action(async () => {
      await (await import('./restart-hold.js')).restartReleaseCommand();
    });
}
