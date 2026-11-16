// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-semgrep.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { NormalizedConfig } from '../../lib/config-yaml/schema.js';
import { resolveDesktopEnv as resolveDesktopEnvReal, type ResolveDesktopEnvDeps } from '../../lib/computer-use/desktop-env.js';
import { runHelper as runHelperReal, type HelperResponse } from '../../lib/computer-use/helper.js';

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 5_000;
const NAME = 'Computer use';
const APT_FIX_GI = 'sudo apt install python3-gi gir1.2-atspi-2.0';

export type ExecFileFn = (file: string, args: string[], options: { timeout: number }) => Promise<{ stdout: string; stderr: string }>;

export interface CheckComputerUseDeps {
  execFile?: ExecFileFn;
  resolveDesktopEnv?: (deps?: ResolveDesktopEnvDeps) => ReturnType<typeof resolveDesktopEnvReal>;
  runHelper?: (operation: Record<string, unknown>, env: NodeJS.ProcessEnv) => Promise<HelperResponse>;
}

export interface CheckComputerUseOptions {
  config: NormalizedConfig;
  platform?: NodeJS.Platform;
  deps?: CheckComputerUseDeps;
}

async function probeOk(exec: ExecFileFn, file: string, args: string[]): Promise<boolean> {
  try {
    await exec(file, args, { timeout: PROBE_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

async function probeStdout(exec: ExecFileFn, file: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await exec(file, args, { timeout: PROBE_TIMEOUT_MS });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Reports `pan computer` readiness, but only when `computer_use.enabled` is
 * true — every extra `pan doctor` row costs an operator's attention, and this
 * one has no reason to exist while the feature is off (PAN-5452, PRD WI-6).
 */
export async function checkComputerUse(options: CheckComputerUseOptions): Promise<CheckResult[]> {
  if (!options.config.computerUse.enabled) return [];

  const platform = options.platform ?? process.platform;
  if (platform !== 'linux') {
    return [{ name: NAME, status: 'warn', message: 'Enabled, but computer use supports Linux only' }];
  }

  const exec = options.deps?.execFile ?? ((file, args, opts) => execFileAsync(file, args, opts));
  const resolveDesktopEnv = options.deps?.resolveDesktopEnv ?? ((deps?: ResolveDesktopEnvDeps) => resolveDesktopEnvReal(deps));
  const runHelper = options.deps?.runHelper ?? ((operation: Record<string, unknown>, env: NodeJS.ProcessEnv) => runHelperReal(operation, env));

  const checks: CheckResult[] = [];

  const giOk = await probeOk(exec, '/usr/bin/python3', [
    '-I',
    '-c',
    "import gi; gi.require_version('Atspi','2.0'); from gi.repository import Atspi",
  ]);
  if (!giOk) {
    checks.push({ name: NAME, status: 'error', message: 'AT-SPI Python bindings are not importable', fix: APT_FIX_GI });
  }

  const envResult = await resolveDesktopEnv();
  if (!envResult.ok) {
    checks.push({ name: NAME, status: 'warn', message: 'No desktop session here; pan computer refuses on this host' });
    return checks;
  }

  const sessionType = (envResult.env.XDG_SESSION_TYPE ?? '').toLowerCase();
  const isWayland = sessionType === 'wayland';

  if (!isWayland) {
    const hasXdotool = await probeOk(exec, 'which', ['xdotool']);
    if (!hasXdotool) {
      checks.push({ name: NAME, status: 'error', message: 'xdotool is not on PATH', fix: 'sudo apt install xdotool' });
    }
  }

  const clipboardCommands = isWayland ? ['wl-copy', 'xclip', 'xsel'] : ['xclip', 'xsel'];
  let hasClipboard = false;
  for (const command of clipboardCommands) {
    if (await probeOk(exec, 'which', [command])) {
      hasClipboard = true;
      break;
    }
  }
  if (!hasClipboard) {
    checks.push({ name: NAME, status: 'warn', message: 'paste-text unavailable', fix: 'sudo apt install xclip' });
  }

  if (isWayland) {
    const hasGrim = await probeOk(exec, 'which', ['grim']);
    if (!hasGrim) {
      checks.push({ name: NAME, status: 'warn', message: 'screenshots unavailable on Wayland', fix: 'sudo apt install grim' });
    }
  }

  const hasGsettings = await probeOk(exec, 'which', ['gsettings']);
  if (hasGsettings) {
    const accessibility = await probeStdout(exec, 'gsettings', ['get', 'org.gnome.desktop.interface', 'toolkit-accessibility']);
    if (accessibility !== 'true') {
      checks.push({
        name: NAME,
        status: 'warn',
        message: 'GNOME accessibility is off; AT-SPI will not expose the tree',
        fix: 'gsettings set org.gnome.desktop.interface toolkit-accessibility true',
      });
    }
  }

  try {
    await runHelper({ tool: 'handshake' }, envResult.env);
    const display = envResult.env.DISPLAY ?? envResult.env.WAYLAND_DISPLAY ?? '';
    checks.push({ name: NAME, status: 'ok', message: `Ready (${sessionType}, display ${display})` });
  } catch (error) {
    checks.push({
      name: NAME,
      status: 'error',
      message: `Helper handshake failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return checks;
}
