/**
 * `pan pi-auth` — manage Pi's ChatGPT/Codex (openai-codex) OAuth login.
 *
 * Pi conversations on a GPT-5.x model authenticate with the user's ChatGPT
 * subscription. When that credential dies, Pi fails with the opaque
 * "No API key for provider: openai-codex". These commands report the status
 * and re-authenticate from the command line (headless device-code flow), so
 * the user never has to drop into the Pi TUI's /login. (PAN-1520)
 */

import { Command } from 'commander';
import {
  getPiCodexAuthStatus,
  loginPiCodexDeviceCode,
  isPiCodexOAuthAvailable,
} from '../../lib/pi-codex-auth.js';

function fmtRemaining(expiresAt: number): string {
  const mins = Math.round((expiresAt - Date.now()) / 60_000);
  if (mins <= 0) return `expired ${Math.abs(mins)} min ago`;
  if (mins < 120) return `valid for ${mins} min`;
  return `valid for ${Math.round(mins / 60)} h`;
}

async function statusAction(): Promise<void> {
  const status = await getPiCodexAuthStatus({ refreshIfExpired: true });
  switch (status.status) {
    case 'ok':
      console.log(`✓ Pi ChatGPT/Codex (openai-codex): authenticated — ${fmtRemaining(status.expiresAt)}`);
      break;
    case 'missing':
      console.log('✗ Pi ChatGPT/Codex (openai-codex): not logged in');
      console.log('  Fix: pan pi-auth login');
      process.exitCode = 1;
      break;
    case 'expired':
      console.log('✗ Pi ChatGPT/Codex (openai-codex): login expired and could not be refreshed');
      console.log('  Fix: pan pi-auth login');
      process.exitCode = 1;
      break;
    case 'unavailable':
      console.log("? Pi ChatGPT/Codex: couldn't load Pi's OAuth module (is `pi` installed and on PATH?)");
      break;
  }
}

async function loginAction(): Promise<void> {
  if (!(await isPiCodexOAuthAvailable())) {
    console.error("Could not load Pi's OAuth module. Is `pi` (@earendil-works/pi-coding-agent) installed and on PATH?");
    process.exitCode = 1;
    return;
  }
  console.log('Starting Pi ChatGPT/Codex device-code login…\n');
  try {
    const cred = await loginPiCodexDeviceCode((info) => {
      console.log('To authorize, open this URL in a browser:');
      console.log(`    ${info.verificationUri}`);
      console.log(`and enter the code:  ${info.userCode}\n`);
      console.log(`Waiting for authorization (expires in ${Math.round(info.expiresInSeconds / 60)} min)…`);
    });
    console.log(`\n✓ Re-authenticated — token ${fmtRemaining(cred.expires)}.`);
    console.log('Pi openai-codex conversations (GPT-5.x) will work again.');
  } catch (error) {
    console.error(`\n✗ Login failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

export function registerPiAuthCommands(program: Command): void {
  const piAuth = program
    .command('pi-auth')
    .description("Manage Pi's ChatGPT/Codex (openai-codex) OAuth login used by GPT-5.x Pi conversations");

  piAuth
    .command('status')
    .description("Show whether Pi's openai-codex login is valid (auto-refreshes if possible)")
    .action(statusAction);

  piAuth
    .command('login')
    .description("Re-authenticate Pi's openai-codex login via headless device code")
    .action(loginAction);
}
