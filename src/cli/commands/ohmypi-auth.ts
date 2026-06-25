/**
 * `pan ohmypi-auth` — manage omp's ChatGPT/Codex (openai-codex) OAuth login.
 * `pan pi-auth` is a hidden deprecated alias that forwards here (PAN-1989).
 *
 * omp conversations on a GPT-5.x model authenticate with the user's ChatGPT
 * subscription. When that credential dies, omp fails with the opaque
 * "No API key for provider: openai-codex". These commands report the status
 * and re-authenticate from the command line (headless device-code flow).
 */

import { Command } from 'commander';
import {
  getOhmypiCodexAuthStatus,
  loginOhmypiCodexDeviceCode,
  isOhmypiCodexOAuthAvailable,
} from '../../lib/ohmypi-codex-auth.js';

function fmtRemaining(expiresAt: number): string {
  const mins = Math.round((expiresAt - Date.now()) / 60_000);
  if (mins <= 0) return `expired ${Math.abs(mins)} min ago`;
  if (mins < 120) return `valid for ${mins} min`;
  return `valid for ${Math.round(mins / 60)} h`;
}

async function statusAction(): Promise<void> {
  const status = await getOhmypiCodexAuthStatus({ refreshIfExpired: true });
  switch (status.status) {
    case 'ok':
      console.log(`✓ omp ChatGPT/Codex (openai-codex): authenticated — ${fmtRemaining(status.expiresAt)}`);
      break;
    case 'missing':
      console.log('✗ omp ChatGPT/Codex (openai-codex): not logged in');
      console.log('  Fix: pan ohmypi-auth login');
      process.exitCode = 1;
      break;
    case 'expired':
      console.log('✗ omp ChatGPT/Codex (openai-codex): login expired and could not be refreshed');
      console.log('  Fix: pan ohmypi-auth login');
      process.exitCode = 1;
      break;
    case 'unavailable':
      console.log("? omp ChatGPT/Codex: couldn't load omp's OAuth module (is `omp` installed and on PATH?)");
      break;
  }
}

async function loginAction(): Promise<void> {
  if (!(await isOhmypiCodexOAuthAvailable())) {
    console.error("Could not load omp's OAuth module. Is `omp` (@oh-my-pi/pi-coding-agent) installed and on PATH?");
    process.exitCode = 1;
    return;
  }
  console.log('Starting omp ChatGPT/Codex device-code login…\n');
  try {
    const cred = await loginOhmypiCodexDeviceCode((info) => {
      console.log('To authorize, open this URL in a browser:');
      console.log(`    ${info.verificationUri}`);
      console.log(`and enter the code:  ${info.userCode}\n`);
      console.log(`Waiting for authorization (expires in ${Math.round(info.expiresInSeconds / 60)} min)…`);
    });
    console.log(`\n✓ Re-authenticated — token ${fmtRemaining(cred.expires)}.`);
    console.log('omp openai-codex conversations (GPT-5.x) will work again.');
  } catch (error) {
    console.error(`\n✗ Login failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function registerSubcommands(cmd: Command): void {
  cmd
    .command('status')
    .description("Show whether omp's openai-codex login is valid (auto-refreshes if possible)")
    .action(statusAction);

  cmd
    .command('login')
    .description("Re-authenticate omp's openai-codex login via headless device code")
    .action(loginAction);
}

export function registerOhmypiAuthCommands(program: Command): void {
  const ohmypiAuth = program
    .command('ohmypi-auth')
    .description("Manage omp's ChatGPT/Codex (openai-codex) OAuth login used by GPT-5.x omp conversations");

  registerSubcommands(ohmypiAuth);

  // Deprecated alias: `pan pi-auth` forwards to ohmypi-auth for one release.
  const piAuthAlias = program
    .command('pi-auth', { hidden: true })
    .description('[deprecated] Use `pan ohmypi-auth` instead');

  registerSubcommands(piAuthAlias);
}
