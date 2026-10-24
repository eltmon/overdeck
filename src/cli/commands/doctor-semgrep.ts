// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-ollama.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}
import type { NormalizedConfig } from '../../lib/config-yaml/schema.js';
import { managedSemgrepPath, readSemgrepVersion, SEMGREP_VERSION } from '../../lib/semgrep/install.js';

export const SEMGREP_REGISTRY_PROBE_URL = 'https://semgrep.dev/c/p/default';
const REGISTRY_TIMEOUT_MS = 5_000;

export interface CheckSemgrepOptions {
  config: NormalizedConfig;
  platform?: NodeJS.Platform;
  readVersion?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

/**
 * Report on the opt-in Semgrep SAST install, but only when the feature is on —
 * every extra `pan doctor` row costs an operator attention they could spend on a
 * real one, and this one has no reason to exist while security.semgrep.enabled is
 * false.
 */
export async function checkSemgrep(options: CheckSemgrepOptions): Promise<CheckResult[]> {
  if (!options.config.security.semgrep.enabled) return [];

  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    return [{
      name: 'Semgrep',
      status: 'warn',
      message: 'Enabled, but Semgrep support is Linux and macOS only',
    }];
  }

  const checks: CheckResult[] = [];
  const readVersion = options.readVersion ?? (() => readSemgrepVersion(managedSemgrepPath()));
  const version = await readVersion();

  if (version === null) {
    checks.push({
      name: 'Semgrep',
      status: 'error',
      message: 'Enabled, but not installed at ~/.overdeck/bin/semgrep',
      fix: 'pan sync',
    });
  } else if (version !== SEMGREP_VERSION) {
    checks.push({
      name: 'Semgrep',
      status: 'warn',
      message: `Installed ${version}, expected ${SEMGREP_VERSION}`,
      fix: 'pan sync',
    });
  } else {
    checks.push({
      name: 'Semgrep',
      status: 'ok',
      message: `${SEMGREP_VERSION} (pinned)`,
    });
  }

  checks.push(await checkSemgrepRegistry(options.fetchImpl));
  return checks;
}

/** A bare `HEAD` to semgrep.dev — sends no code and no project data. */
async function checkSemgrepRegistry(fetchImpl: typeof fetch = fetch): Promise<CheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
  try {
    const response = await fetchImpl(SEMGREP_REGISTRY_PROBE_URL, { method: 'HEAD', signal: controller.signal });
    if (response.ok || (response.status >= 300 && response.status < 400)) {
      return { name: 'Semgrep registry', status: 'ok', message: 'semgrep.dev reachable' };
    }
    return {
      name: 'Semgrep registry',
      status: 'warn',
      message: 'semgrep.dev unreachable — registry rule packs such as p/default cannot be downloaded',
      fix: 'Check network access to https://semgrep.dev',
    };
  } catch {
    return {
      name: 'Semgrep registry',
      status: 'warn',
      message: 'semgrep.dev unreachable — registry rule packs such as p/default cannot be downloaded',
      fix: 'Check network access to https://semgrep.dev',
    };
  } finally {
    clearTimeout(timer);
  }
}
