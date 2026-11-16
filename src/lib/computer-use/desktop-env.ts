/**
 * Resolves the desktop session env for the vendored helper (PAN-5452, PRD 3b).
 * Agent shells usually lack DISPLAY/XAUTHORITY/etc.; the systemd user manager
 * (the desktop login session) has them.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DESKTOP_ENV_KEYS = [
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'XDG_SESSION_TYPE',
  'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS',
] as const;

const SYSTEMCTL_TIMEOUT_MS = 5_000;

const NO_DESKTOP_SESSION_MESSAGE =
  'No desktop session on this host: no DISPLAY or WAYLAND_DISPLAY in this shell or in systemctl --user show-environment. Computer use only works on a machine with a logged-in desktop.';

export type ResolveDesktopEnvResult =
  | { ok: true; env: NodeJS.ProcessEnv }
  | { ok: false; code: 'no_desktop_session'; message: string };

export type ExecFileFn = (file: string, args: string[], options: { timeout: number }) => Promise<{ stdout: string }>;

export interface ResolveDesktopEnvDeps {
  env?: NodeJS.ProcessEnv;
  execFile?: ExecFileFn;
  uid?: () => number;
  existsSync?: (path: string) => boolean;
}

function parseKeyValueLines(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const index = line.indexOf('=');
    if (index === -1) continue;
    result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}

async function readSystemctlEnvironment(exec: ExecFileFn): Promise<Record<string, string>> {
  try {
    const { stdout } = await exec('systemctl', ['--user', 'show-environment'], { timeout: SYSTEMCTL_TIMEOUT_MS });
    return parseKeyValueLines(stdout);
  } catch {
    return {};
  }
}

export async function resolveDesktopEnv(deps: ResolveDesktopEnvDeps = {}): Promise<ResolveDesktopEnvResult> {
  const env: NodeJS.ProcessEnv = { ...(deps.env ?? process.env) };
  const exec = deps.execFile ?? ((file, args, options) => execFileAsync(file, args, options));
  const uid = deps.uid ?? (() => process.getuid?.() ?? 0);
  const exists = deps.existsSync ?? existsSync;

  const missingKeys = DESKTOP_ENV_KEYS.filter((key) => !env[key]);
  if (missingKeys.length > 0) {
    const fromSystemctl = await readSystemctlEnvironment(exec);
    for (const key of missingKeys) {
      if (fromSystemctl[key]) env[key] = fromSystemctl[key];
    }
  }

  if (!env.XDG_RUNTIME_DIR) {
    const candidate = `/run/user/${uid()}`;
    if (exists(candidate)) env.XDG_RUNTIME_DIR = candidate;
  }
  if (!env.DBUS_SESSION_BUS_ADDRESS && env.XDG_RUNTIME_DIR) {
    const busPath = join(env.XDG_RUNTIME_DIR, 'bus');
    if (exists(busPath)) env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${busPath}`;
  }

  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return { ok: false, code: 'no_desktop_session', message: NO_DESKTOP_SESSION_MESSAGE };
  }
  return { ok: true, env };
}
