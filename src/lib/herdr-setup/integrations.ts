/**
 * Herdr agent integrations (PAN-3956 W8, D2, D11).
 *
 * An integration is a Herdr-installed hook/extension inside a harness's own
 * config dir that reports lifecycle and/or session identity to Herdr. Overdeck
 * installs only the PILOT set — `pi`, `omp`, `kimi`, `opencode` — whose direct
 * lifecycle reports replace screen scraping, and only when that harness's
 * binary resolves. `claude`, `codex` and `hermes` are session-identity only:
 * Overdeck neither installs nor uninstalls them (doctor still reports them).
 *
 * `herdr integration status` wording (0.9.1): `<target>: not installed (<path>)`
 * is observed live. The other states are the status literals the 0.9.1 binary
 * carries (`strings`): `current (` for an up-to-date install, `outdated (`
 * (with a ` < v` version comparison) for a stale one and `needs repair (` for
 * a broken one. The separator after the target is any whitespace. The
 * classifier is tolerant: anything it cannot read is `unknown`, which is never
 * reinstalled (doctor warns instead).
 */

import { compareSemver, extractSemver } from './binary.js';
import { defaultHerdrExec, type HerdrExec } from './status.js';

export type HerdrIntegrationTarget = 'pi' | 'omp' | 'claude' | 'codex' | 'kimi' | 'opencode' | 'hermes';

export const HERDR_INTEGRATION_TARGETS: readonly HerdrIntegrationTarget[] = [
  'pi', 'omp', 'claude', 'codex', 'kimi', 'opencode', 'hermes',
];

export const HERDR_PILOT_INTEGRATIONS: readonly HerdrIntegrationTarget[] = ['pi', 'omp', 'kimi', 'opencode'];

/** The harness binary whose presence makes an integration worth installing. */
export const HERDR_INTEGRATION_BINARY: Record<HerdrIntegrationTarget, string> = {
  pi: 'pi',
  omp: 'omp',
  claude: 'claude',
  codex: 'codex',
  kimi: 'kimi',
  opencode: 'opencode',
  hermes: 'hermes',
};

/**
 * `herdr integration install` writes into a harness's config and may fetch;
 * killing it at the 10 s default could leave a half-written install.
 * Override with `OVERDECK_HERDR_INTEGRATION_TIMEOUT_MS`.
 */
export const HERDR_INTEGRATION_INSTALL_TIMEOUT_MS = 120_000;

function integrationInstallTimeoutMs(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = Number(env.OVERDECK_HERDR_INTEGRATION_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : HERDR_INTEGRATION_INSTALL_TIMEOUT_MS;
}

/** The Kimi integration needs Kimi Code ≥ 0.14.0 (D11). */
export const KIMI_INTEGRATION_MIN_VERSION = '0.14.0';

export type IntegrationState = 'installed' | 'outdated' | 'needs-repair' | 'not-installed' | 'unknown';

export interface IntegrationStatusRow {
  readonly target: string;
  readonly state: IntegrationState;
  readonly detail: string;
  readonly path?: string;
}

const STATUS_LINE = /^(\S+?)(?: \(experimental\))?:\s+(.+?)(?: \((.+)\))?$/;

export function classifyIntegrationDetail(detail: string): IntegrationState {
  const text = detail.trim().toLowerCase();
  if (text.startsWith('not installed')) return 'not-installed';
  if (text.startsWith('needs repair')) return 'needs-repair';
  if (text.startsWith('outdated')) return 'outdated';
  if (text.startsWith('current')) return 'installed';
  // Not a 0.9.1 literal; kept so a plainer future wording still reads right.
  if (text.startsWith('installed')) {
    return text.includes('outdated') || text.includes('update available') ? 'outdated' : 'installed';
  }
  return 'unknown';
}

/** Parse `herdr integration status` text: one row per `<target>: <detail> (<path>)` line. */
export function parseIntegrationStatus(text: string): IntegrationStatusRow[] {
  const rows: IntegrationStatusRow[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const match = STATUS_LINE.exec(line);
    if (!match) continue;
    const [, target = '', detail = '', path] = match;
    rows.push({
      target,
      state: classifyIntegrationDetail(detail),
      detail,
      ...(path ? { path } : {}),
    });
  }
  return rows;
}

/** `herdr integration status`, parsed. Empty when the binary cannot answer. */
export async function readIntegrationStatus(
  binary: string,
  exec: HerdrExec = defaultHerdrExec,
): Promise<IntegrationStatusRow[]> {
  try {
    const { stdout, exitCode } = await exec(binary, ['integration', 'status']);
    return exitCode === 0 ? parseIntegrationStatus(stdout) : [];
  } catch {
    return [];
  }
}

/** Resolve a harness binary without spawning a login shell (D2). */
export async function defaultResolveHarnessBinary(name: string): Promise<string | null> {
  const { resolveExecutable } = await import('../harness-binary.js');
  return resolveExecutable(name, { allowLoginShell: false }).catch(() => null);
}

/** `kimi --version` through the same prerequisite probe `pan doctor` uses. */
export async function defaultReadKimiVersion(): Promise<string | null> {
  const { checkSystemPrerequisite } = await import('../system-prerequisites.js');
  const kimi = await checkSystemPrerequisite('kimi').catch(() => null);
  return kimi?.found ? extractSemver(kimi.version) : null;
}

/** Why the kimi integration cannot be installed (D11), or null when it can. */
export function kimiVersionBlocker(kimiVersion: string | null): string | null {
  if (kimiVersion === null) return `kimi version could not be read (need ≥ ${KIMI_INTEGRATION_MIN_VERSION})`;
  return compareSemver(kimiVersion, KIMI_INTEGRATION_MIN_VERSION) < 0
    ? `kimi ${kimiVersion} < ${KIMI_INTEGRATION_MIN_VERSION}`
    : null;
}

export interface EnsureHerdrIntegrationsDeps {
  readonly binary: string;
  readonly exec?: HerdrExec;
  readonly resolveBinary?: (name: string) => Promise<string | null>;
  /** Kimi Code version; `undefined` means "read it", `null` means "unknown". */
  readonly kimiVersion?: string | null;
  /** Pre-read status rows (the orchestrator may already have them). */
  readonly statusRows?: readonly IntegrationStatusRow[];
  /** Per-install timeout; defaults to `OVERDECK_HERDR_INTEGRATION_TIMEOUT_MS` or 120 s. */
  readonly installTimeoutMs?: number;
}

export interface EnsureHerdrIntegrationsResult {
  readonly installed: HerdrIntegrationTarget[];
  readonly already: HerdrIntegrationTarget[];
  readonly skipped: Array<{ target: HerdrIntegrationTarget; reason: string }>;
}

/**
 * Install every pilot integration whose harness binary resolves and whose
 * status is `not-installed`, `outdated` or `needs-repair` (a reinstall is the
 * repair). Idempotent: with everything installed it makes no
 * `integration install` call. Never touches `claude`, `codex` or `hermes`.
 */
export async function ensureHerdrIntegrations(
  deps: EnsureHerdrIntegrationsDeps,
): Promise<EnsureHerdrIntegrationsResult> {
  const exec = deps.exec ?? defaultHerdrExec;
  const resolveBinary = deps.resolveBinary ?? defaultResolveHarnessBinary;
  const rows = deps.statusRows ?? (await readIntegrationStatus(deps.binary, exec));
  const byTarget = new Map(rows.map((row) => [row.target, row]));
  const result: EnsureHerdrIntegrationsResult = { installed: [], already: [], skipped: [] };

  for (const target of HERDR_PILOT_INTEGRATIONS) {
    const row = byTarget.get(target);
    if (row?.state === 'installed') {
      result.already.push(target);
      continue;
    }
    if (!(await resolveBinary(HERDR_INTEGRATION_BINARY[target]))) {
      result.skipped.push({ target, reason: `${HERDR_INTEGRATION_BINARY[target]} binary not found` });
      continue;
    }
    if (target === 'kimi') {
      const version = deps.kimiVersion === undefined ? await defaultReadKimiVersion() : deps.kimiVersion;
      const blocker = kimiVersionBlocker(version);
      if (blocker) {
        result.skipped.push({ target, reason: blocker });
        continue;
      }
    }
    if (!row) {
      result.skipped.push({ target, reason: 'herdr integration status does not list this target' });
      continue;
    }
    if (row.state === 'unknown') {
      // [checkpoint] fallback: an unreadable status line is never reinstalled.
      result.skipped.push({ target, reason: `status not recognized: ${row.detail}` });
      continue;
    }
    const install = await exec(deps.binary, ['integration', 'install', target], {
      timeoutMs: deps.installTimeoutMs ?? integrationInstallTimeoutMs(),
    }).catch((error: unknown) => ({
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: -1,
    }));
    if (install.exitCode === 0) {
      result.installed.push(target);
    } else {
      const detail = (install.stderr || install.stdout).trim().split('\n').pop() ?? '';
      result.skipped.push({ target, reason: `install failed (exit ${install.exitCode})${detail ? `: ${detail}` : ''}` });
    }
  }
  return result;
}
