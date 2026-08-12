import { resolveHarnessBinary } from '../../lib/harness-binary.js';
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
): Promise<PrimeAgentDoctorResult[]> {
  const prime = await checkSystemPrerequisite('prime-agent', probe, resolver);
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
    const help = executable && probe ? await probe(executable, ['--help']) : '';
    if (probe && !/(?:--mode\b[^\n]*\brpc\b|--mode\s+<[^>]+>)/i.test(help)) {
      return [{ name: prime.name, status: 'warn', message: `v${version} does not advertise the required --mode rpc capability`, fix: 'Install a Prime Agent build with RPC mode support.' }];
    }
  } catch {
    return [{ name: prime.name, status: 'warn', message: `v${version}; RPC capability probe failed`, fix: 'Run `prime-agent --help` and verify --mode rpc is available.' }];
  }
  return [{ name: prime.name, status: 'ok', message: `v${version} (RPC mode available)` }];
}
