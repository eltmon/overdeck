/**
 * `pan doctor` check for the Codex per-model client-version floor (PAN-4363).
 *
 * Under ChatGPT sign-in, OpenAI's backend rejects some GPT-6 models below a
 * Codex CLI version (CODEX_MODEL_MINIMUM_VERSIONS). Warns when the installed
 * version is below a model's floor or unreadable; api-key auth has no floor.
 */
import { configuredHarnessBinaryPath, resolveHarnessBinary } from '../../lib/harness-binary.js';
import {
  CODEX_CLI_INSTALL_COMMAND,
  CODEX_MODEL_MINIMUM_VERSIONS,
  compareVersions,
  readCodexCliVersion,
} from '../../lib/codex/app-server-manager.js';
import type { AuthMode } from '../../lib/subscription-types.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export interface CodexModelsDoctorDeps {
  resolveBinary?: () => Promise<string | null>;
  readVersion?: (binary: string) => Promise<string | undefined>;
  authMode?: (model: string) => Promise<AuthMode | undefined>;
}

function defaultResolveBinary(): Promise<string | null> {
  const executablePath = configuredHarnessBinaryPath('codex');
  return resolveHarnessBinary('codex', executablePath ? { executablePath } : undefined);
}

async function defaultAuthMode(model: string): Promise<AuthMode | undefined> {
  const { getProviderAuthMode } = await import('../../lib/agents.js');
  return getProviderAuthMode(model);
}

export async function checkCodexModelFloors(deps: CodexModelsDoctorDeps = {}): Promise<CheckResult[]> {
  const resolveBinary = deps.resolveBinary ?? defaultResolveBinary;
  const readVersion = deps.readVersion ?? readCodexCliVersion;
  const authModeFor = deps.authMode ?? defaultAuthMode;

  const binary = await resolveBinary();
  if (!binary) return [];

  const results: CheckResult[] = [];
  for (const [model, floor] of Object.entries(CODEX_MODEL_MINIMUM_VERSIONS)) {
    const authMode = await authModeFor(model);
    if (authMode !== 'subscription') {
      results.push({ name: 'Codex model floor', status: 'ok', message: `${model}: API-key auth, no client-version floor` });
      continue;
    }

    const installed = await readVersion(binary);
    if (installed === undefined) {
      results.push({
        name: 'Codex model floor',
        status: 'warn',
        message: `${model}: Codex CLI version unknown; needs ${floor} or newer under ChatGPT sign-in`,
        fix: 'Check `codex --version`',
      });
      continue;
    }

    if (compareVersions(installed, floor) < 0) {
      results.push({
        name: 'Codex model floor',
        status: 'warn',
        message: `${model} needs Codex CLI ${floor} or newer under ChatGPT sign-in (installed ${installed}); Overdeck refuses these launches`,
        fix: `Upgrade: ${CODEX_CLI_INSTALL_COMMAND}`,
      });
      continue;
    }

    results.push({ name: 'Codex model floor', status: 'ok', message: `${model}: Codex CLI ${installed} meets ${floor}` });
  }
  return results;
}
