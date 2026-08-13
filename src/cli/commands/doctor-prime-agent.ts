import { resolveHarnessBinary } from '../../lib/harness-binary.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { getClaudeAuthStatus } from '../../lib/claude-auth.js';
import { getOpenAIAuthStatus } from '../../lib/openai-auth.js';
import { loadConfigSync } from '../../lib/config-yaml.js';
import {
  checkSystemPrerequisite,
  type PrerequisiteProbe,
  type PrerequisiteResolver,
} from '../../lib/system-prerequisites.js';

export const SUPPORTED_PRIME_AGENT_VERSION_MIN = '0.1.0';
export const SUPPORTED_PRIME_AGENT_VERSION_MAX_EXCLUSIVE = '1.0.0';

export interface PrimeAgentDoctorResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

function compareSemver(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) - (right[index] ?? 0);
  }
  return 0;
}

export async function checkPrimeAgent(
  probe?: PrerequisiteProbe,
  resolver?: PrerequisiteResolver,
  credentialCheck?: () => Promise<boolean>,
): Promise<PrimeAgentDoctorResult[]> {
  const productionProbe: PrerequisiteProbe = async (path, args) => (await promisify(execFile)(path, args, { encoding: 'utf8' })).stdout;
  const activeProbe = probe ?? productionProbe;
  const prime = await checkSystemPrerequisite('prime-agent', activeProbe, resolver);
  if (!prime.found) return [{ name: prime.name, status: 'warn', message: 'Not installed (prime-agent harness unavailable)', fix: `Install: ${prime.install.linux}` }];

  const version = prime.version?.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
  if (!version) return [{ name: prime.name, status: 'warn', message: 'Detected but `prime-agent --version` did not return a semantic version', fix: `Install a supported release >= ${SUPPORTED_PRIME_AGENT_VERSION_MIN} and < ${SUPPORTED_PRIME_AGENT_VERSION_MAX_EXCLUSIVE}` }];
  if (compareSemver(version, SUPPORTED_PRIME_AGENT_VERSION_MIN) < 0 || compareSemver(version, SUPPORTED_PRIME_AGENT_VERSION_MAX_EXCLUSIVE) >= 0) {
    return [{ name: prime.name, status: 'warn', message: `v${version} is unsupported; requires >= ${SUPPORTED_PRIME_AGENT_VERSION_MIN} and < ${SUPPORTED_PRIME_AGENT_VERSION_MAX_EXCLUSIVE}`, fix: 'Install a compatible Prime Agent release; Overdeck will not fall back to another harness.' }];
  }

  const executable = await (resolver
    ? resolver('prime-agent', { primeAgentHarness: true })
    : resolveHarnessBinary('prime-agent'));
  try {
    const help = executable ? await activeProbe(executable, ['--help']) : '';
    if (!/(?:--mode\b[^\n]*\brpc\b|--mode\s+<[^>]+>)/i.test(help)) {
      return [{ name: prime.name, status: 'warn', message: `v${version} does not advertise the required --mode rpc capability`, fix: 'Install a Prime Agent build with RPC mode support.' }];
    }
  } catch {
    return [{ name: prime.name, status: 'warn', message: `v${version}; RPC capability probe failed`, fix: 'Run `prime-agent --help` and verify --mode rpc is available.' }];
  }
  const results: PrimeAgentDoctorResult[] = [{ name: prime.name, status: 'ok', message: `v${version} (RPC mode available)` }];
  if (!probe || credentialCheck) {
    let hasCredential: boolean;
    if (credentialCheck) {
      hasCredential = await credentialCheck();
    } else {
      const { config } = loadConfigSync();
      const [claude, openai] = await Promise.all([
        Effect.runPromise(getClaudeAuthStatus()),
        Effect.runPromise(getOpenAIAuthStatus()),
      ]);
      hasCredential = claude.loggedIn || claude.hasAnthropicApiKey || openai.loggedIn
        || Object.values(config.apiKeys).some(Boolean);
    }
    results.push(hasCredential
      ? { name: 'Prime Agent provider credentials', status: 'ok', message: 'At least one configured provider credential is available' }
      : { name: 'Prime Agent provider credentials', status: 'warn', message: 'No provider credential is configured', fix: 'Configure credentials for the provider used by the selected Prime Agent model.' });
  }
  return results;
}
