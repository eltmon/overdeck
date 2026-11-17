// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-semgrep.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}
import type { NormalizedConfig } from '../../lib/config-yaml/schema.js';
import type { ResolveDesktopEnvDeps, ResolveDesktopEnvResult } from '../../lib/computer-use/desktop-env.js';
import type { HelperResponse } from '../../lib/computer-use/helper.js';
import {
  detectPlatform as detectPlatformReal,
  providerFor,
  type ComputerUseProvider,
  type ReadinessStatus,
} from '../../lib/computer-use/platform.js';
import { linuxReadiness, type ExecFileFn, type LinuxReadinessDeps } from '../../lib/computer-use/readiness-linux.js';

export type { ExecFileFn };

const NAME = 'Computer use';

export interface CheckComputerUseDeps {
  execFile?: ExecFileFn;
  resolveDesktopEnv?: (deps?: ResolveDesktopEnvDeps) => Promise<ResolveDesktopEnvResult>;
  runHelper?: (operation: Record<string, unknown>, env: NodeJS.ProcessEnv) => Promise<HelperResponse>;
  detectPlatform?: typeof detectPlatformReal;
  /** The wsl provider; defaults to providerFor('wsl') (PAN-5462). */
  wslProvider?: ComputerUseProvider;
}

const DOCTOR_STATUS: Record<ReadinessStatus, CheckResult['status']> = {
  ok: 'ok',
  action: 'warn',
  missing: 'error',
  unavailable: 'warn',
};

/** WSL2 (PAN-5462 FR-7): one row per readiness check, with fixCommand as the row's fix. */
async function wslRows(provider: ComputerUseProvider): Promise<CheckResult[]> {
  const report = await provider.readiness({ probeHelper: 'if-free' });
  return report.checks.map((check) => {
    const row: CheckResult = { name: NAME, status: DOCTOR_STATUS[check.status], message: `${check.label}: ${check.detail}` };
    if (check.fixCommand) row.fix = check.fixCommand;
    return row;
  });
}

export interface CheckComputerUseOptions {
  config: NormalizedConfig;
  platform?: NodeJS.Platform;
  deps?: CheckComputerUseDeps;
}

/**
 * Reports `pan computer` readiness, but only when `computer_use.enabled` is
 * true — every extra `pan doctor` row costs an operator's attention, and this
 * one has no reason to exist while the feature is off (PAN-5452, PRD WI-6).
 *
 * The probes live in lib/computer-use/readiness-linux.ts (PAN-5461 D-6); this
 * wrapper maps its rows back to doctor's legacy rows, order and apt fix strings
 * (D-14). The handshake runs without the desktop lock, as it always has.
 * Under WSL2 the wsl provider's four checks map to rows directly (PAN-5462 FR-7);
 * its handshake skips while an agent holds the desktop.
 */
export async function checkComputerUse(options: CheckComputerUseOptions): Promise<CheckResult[]> {
  if (!options.config.computerUse.enabled) return [];

  const deps = options.deps ?? {};
  const detectPlatform = deps.detectPlatform ?? detectPlatformReal;
  const platformId = detectPlatform({ platform: options.platform ?? process.platform });
  if (platformId === 'wsl') {
    const provider = deps.wslProvider ?? providerFor('wsl');
    if (provider) return wslRows(provider);
  }
  if (platformId !== 'linux') {
    return [{ name: NAME, status: 'warn', message: 'Enabled, but computer use supports Linux and Windows through WSL2 only' }];
  }

  const readinessDeps: LinuxReadinessDeps = {};
  if (deps.execFile) readinessDeps.execFile = deps.execFile;
  if (deps.resolveDesktopEnv) readinessDeps.resolveDesktopEnv = deps.resolveDesktopEnv;
  if (deps.runHelper) readinessDeps.runHelper = deps.runHelper;
  const report = await linuxReadiness({ helperLock: 'none', setupSteps: false }, readinessDeps);
  const statusOf = (id: string) => report.checks.find((check) => check.id === id)?.status;

  const checks: CheckResult[] = [];
  if (statusOf('atspi') === 'missing') {
    checks.push({
      name: NAME,
      status: 'error',
      message: 'AT-SPI Python bindings are not importable',
      fix: 'sudo apt install python3-gi gir1.2-atspi-2.0',
    });
  }
  if (statusOf('session') === 'unavailable') {
    checks.push({ name: NAME, status: 'warn', message: 'No desktop session here; pan computer refuses on this host' });
    return checks;
  }
  if (statusOf('input') === 'missing') {
    checks.push({ name: NAME, status: 'error', message: 'xdotool is not on PATH', fix: 'sudo apt install xdotool' });
  }
  if (statusOf('clipboard') === 'missing') {
    checks.push({ name: NAME, status: 'warn', message: 'paste-text unavailable', fix: 'sudo apt install xclip' });
  }
  if (statusOf('screenshots') === 'missing') {
    checks.push({ name: NAME, status: 'warn', message: 'screenshots unavailable on Wayland', fix: 'sudo apt install grim' });
  }
  if (statusOf('gnome-a11y') === 'action') {
    checks.push({
      name: NAME,
      status: 'warn',
      message: 'GNOME accessibility is off; AT-SPI will not expose the tree',
      fix: 'gsettings set org.gnome.desktop.interface toolkit-accessibility true',
    });
  }
  if (statusOf('helper') === 'ok') {
    checks.push({ name: NAME, status: 'ok', message: `Ready (${report.sessionType}, display ${report.display})` });
  } else {
    checks.push({ name: NAME, status: 'error', message: `Helper handshake failed: ${report.helperError ?? 'unknown helper error'}` });
  }
  return checks;
}
