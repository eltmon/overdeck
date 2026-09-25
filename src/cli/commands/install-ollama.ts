import { execFileSync } from 'child_process';
import inquirer from 'inquirer';

import type { Platform } from '../../lib/platform.js';
import { DEFAULT_OLLAMA_AGENT_MODEL, isOllamaInstalled } from '../../lib/ollama.js';

/** The slice of ora's Ora that this step uses, so tests can pass a plain object. */
export interface OllamaInstallSpinner {
  info(message: string): unknown;
  warn(message: string): unknown;
  start(message: string): unknown;
  succeed(message: string): unknown;
}

export interface SetupOllamaOptions {
  skip?: boolean;
  platform: Platform;
  spinner: OllamaInstallSpinner;
  /** False in CI and in a piped `pan install`; a prompt there would hang the install. */
  isTty: boolean;
  detectInstalled?: () => Promise<boolean>;
  confirmPull?: (model: string) => Promise<boolean>;
  pullModel?: (model: string) => void;
}

/**
 * Overdeck never runs an installer for the operator — `curl | sh` from a setup script is
 * exactly the thing an operator should be able to read first. Print the command instead.
 */
export function getOllamaInstallGuidance(platform: Platform): string {
  if (platform === 'darwin') return 'Install Ollama with `brew install ollama` or from https://ollama.com/download/mac.';
  if (platform === 'linux' || platform === 'wsl') return 'Install Ollama with `curl -fsSL https://ollama.com/install.sh | sh`.';
  return 'Install Ollama from https://ollama.com/download/windows.';
}

/**
 * Detect Ollama during `pan install` and, on an interactive terminal, offer the
 * recommended local agent model. The offer defaults to No: gemma4:12b is an 8 GB
 * download that most operators do not want mid-install. Nothing here can fail the
 * install — a missing binary or a failed pull is guidance, not an error.
 */
export async function setupOllamaForInstall(options: SetupOllamaOptions): Promise<void> {
  if (options.skip) {
    options.spinner.info('Skipping Ollama local-model setup (--skip-ollama)');
    return;
  }

  const installed = await (options.detectInstalled ?? isOllamaInstalled)();
  if (!installed) {
    options.spinner.warn(`Ollama is not installed. ${getOllamaInstallGuidance(options.platform)}`);
    return;
  }
  options.spinner.succeed('Ollama is installed');

  if (!options.isTty) {
    options.spinner.info(
      `To run agents on a local model, pull it with \`ollama pull ${DEFAULT_OLLAMA_AGENT_MODEL}\`.`,
    );
    return;
  }

  const confirmPull = options.confirmPull ?? defaultConfirmPull;
  if (!(await confirmPull(DEFAULT_OLLAMA_AGENT_MODEL))) {
    options.spinner.info(`Skipped the pull. Run \`ollama pull ${DEFAULT_OLLAMA_AGENT_MODEL}\` when you want it.`);
    return;
  }

  options.spinner.start(`Pulling ${DEFAULT_OLLAMA_AGENT_MODEL} with Ollama...`);
  try {
    (options.pullModel ?? pullWithOllama)(DEFAULT_OLLAMA_AGENT_MODEL);
    options.spinner.succeed(`Pulled ${DEFAULT_OLLAMA_AGENT_MODEL}`);
  } catch {
    options.spinner.warn(
      `Could not pull ${DEFAULT_OLLAMA_AGENT_MODEL}. Retry with \`ollama pull ${DEFAULT_OLLAMA_AGENT_MODEL}\`.`,
    );
  }
}

async function defaultConfirmPull(model: string): Promise<boolean> {
  const answer = await inquirer.prompt([{
    type: 'confirm',
    name: 'pull',
    message: `Pull the recommended local agent model ${model} now? (about 8 GB)`,
    default: false,
  }]);
  return Boolean(answer.pull);
}

// CLI-only module, so a synchronous exec is allowed here; `inherit` lets the
// operator watch Ollama's own download progress. 30 minutes covers a slow link.
function pullWithOllama(model: string): void {
  execFileSync('ollama', ['pull', model], { stdio: 'inherit', timeout: 1_800_000 });
}
