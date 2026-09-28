/**
 * `pan doctor` check for the Prime Agent harness (PAN-3668 WI-20, FR-4, FR-25).
 *
 * Warns (never fails) when Prime is not installed, errors when the installed version is
 * outside PRIME_AGENT_SUPPORTED_RANGE, and warns once per orphaned Overdeck-owned Prime
 * supervisor (a private daemon whose agent or conversation is gone).
 */
import { resolveHarnessBinary } from '../../lib/harness-binary.js';
import {
  checkPrimeAgentVersion,
  PRIME_AGENT_INSTALL_COMMAND,
  PRIME_AGENT_SUPPORTED_RANGE_LABEL,
  readPrimeAgentVersionOutput,
} from '../../lib/prime-agent/compat.js';
import { listOrphanedPrimeAgentDaemons } from '../../lib/prime-agent/daemon.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export interface PrimeAgentDoctorDeps {
  resolveBinary?: () => Promise<string | null>;
  readVersion?: (binary: string) => Promise<string>;
  listOrphans?: (binary: string) => Promise<Array<{ socketPath: string; pid: number }>>;
}

export async function checkPrimeAgent(deps: PrimeAgentDoctorDeps = {}): Promise<CheckResult[]> {
  const binary = await (deps.resolveBinary ?? (() => resolveHarnessBinary('prime-agent')))();
  if (!binary) {
    return [{
      name: 'Prime Agent',
      status: 'warn',
      message: 'Not installed (optional Prime Agent harness)',
      fix: `Install: ${PRIME_AGENT_INSTALL_COMMAND}`,
    }];
  }

  const results: CheckResult[] = [];
  let versionOutput = '';
  try {
    versionOutput = await (deps.readVersion ?? readPrimeAgentVersionOutput)(binary);
  } catch (error) {
    versionOutput = error instanceof Error ? error.message : String(error);
  }
  const version = checkPrimeAgentVersion(versionOutput);
  results.push(version.ok
    ? { name: 'Prime Agent', status: 'ok', message: `${version.version} (supported ${PRIME_AGENT_SUPPORTED_RANGE_LABEL})` }
    : { name: 'Prime Agent', status: 'error', message: version.message, fix: `Install: ${PRIME_AGENT_INSTALL_COMMAND}` });

  try {
    const orphans = await (deps.listOrphans ?? ((bin: string) => listOrphanedPrimeAgentDaemons({ binary: bin })))(binary);
    for (const orphan of orphans) {
      results.push({
        name: 'Prime Agent daemon',
        status: 'warn',
        message: `Orphaned Overdeck Prime Agent daemon on ${orphan.socketPath} (pid ${orphan.pid}); its agent or conversation is gone`,
        fix: `kill -TERM -- -${orphan.pid}`,
      });
    }
  } catch (error) {
    results.push({
      name: 'Prime Agent daemon',
      status: 'warn',
      message: `Could not list Prime Agent daemons: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  return results;
}
