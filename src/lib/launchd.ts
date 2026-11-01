/**
 * The macOS launch agent that runs the supervisor on a connected Mac (PAN-4656).
 *
 * `pan connect` writes `~/Library/LaunchAgents/ai.overdeck.supervisor.plist`
 * and loads it into the user's `gui/<uid>` domain, falling back to `user/<uid>`
 * when there is no GUI session (an SSH-only login). The agent starts when the
 * user logs in; macOS has no equivalent of systemd lingering for agents.
 *
 * Async only. Every launchctl call goes through `execFile` argv.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

export const SUPERVISOR_AGENT_LABEL = 'ai.overdeck.supervisor';

const LAUNCHCTL_TIMEOUT_MS = 10_000;
const THROTTLE_INTERVAL_SEC = 5;
/** bootout can return before launchd releases the label: poll up to 20 × 250 ms. */
const BOOTOUT_SETTLE_POLLS = 20;
const BOOTOUT_SETTLE_POLL_MS = 250;

export interface RenderSupervisorPlistOptions {
  nodePath: string;
  supervisorBundle: string;
  workingDirectory: string;
  overdeckHome: string;
  supervisorPort: number;
  /** The operator's PATH, so the supervisor's `pan restart` finds node and the harness CLIs. */
  path: string;
  logPath: string;
}

export interface LaunchdDeps {
  execFile: (file: string, args: readonly string[], options: { timeout: number }) => Promise<{ stdout: string; stderr: string }>;
  /** File contents, or null when it cannot be read. */
  readFile: (path: string) => Promise<string | null>;
  writeFile: (path: string, data: string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
  homedir: () => string;
  uid: () => number;
  sleep: (ms: number) => Promise<void>;
}

const execFileAsync = promisify(execFile);

const defaultDeps: LaunchdDeps = {
  execFile: async (file, args, options) => {
    const { stdout, stderr } = await execFileAsync(file, [...args], { encoding: 'utf-8', timeout: options.timeout });
    return { stdout, stderr };
  },
  readFile: async (path) => {
    try {
      return await readFile(path, 'utf-8');
    } catch {
      return null;
    }
  },
  writeFile: (path, data) => writeFile(path, data, 'utf-8'),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  homedir,
  uid: () => process.getuid?.() ?? 0,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function resolveDeps(deps: Partial<LaunchdDeps> = {}): LaunchdDeps {
  return { ...defaultDeps, ...deps };
}

export function supervisorAgentPath(home = homedir()): string {
  return join(home, 'Library', 'LaunchAgents', `${SUPERVISOR_AGENT_LABEL}.plist`);
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function plistString(value: string): string {
  return `<string>${xmlEscape(value)}</string>`;
}

export function renderSupervisorPlist(o: RenderSupervisorPlistOptions): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  ${plistString(SUPERVISOR_AGENT_LABEL)}`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    ${plistString(o.nodePath)}`,
    `    ${plistString(o.supervisorBundle)}`,
    '  </array>',
    '  <key>WorkingDirectory</key>',
    `  ${plistString(o.workingDirectory)}`,
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>OVERDECK_HOME</key>',
    `    ${plistString(o.overdeckHome)}`,
    '    <key>OVERDECK_SUPERVISOR_PORT</key>',
    `    ${plistString(String(o.supervisorPort))}`,
    '    <key>PATH</key>',
    `    ${plistString(o.path)}`,
    '  </dict>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>ThrottleInterval</key>',
    `  <integer>${THROTTLE_INTERVAL_SEC}</integer>`,
    '  <key>StandardOutPath</key>',
    `  ${plistString(o.logPath)}`,
    '  <key>StandardErrorPath</key>',
    `  ${plistString(o.logPath)}`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

function candidateDomains(d: LaunchdDeps): [string, string] {
  const uid = d.uid();
  return [`gui/${uid}`, `user/${uid}`];
}

/** Loaded = `launchctl print <domain>/ai.overdeck.supervisor` exits 0, for gui/<uid> or user/<uid>. */
export async function isSupervisorAgentLoaded(deps?: Partial<LaunchdDeps>): Promise<{ loaded: boolean; domain: string | null }> {
  const d = resolveDeps(deps);
  for (const domain of candidateDomains(d)) {
    try {
      await d.execFile('launchctl', ['print', `${domain}/${SUPERVISOR_AGENT_LABEL}`], { timeout: LAUNCHCTL_TIMEOUT_MS });
      return { loaded: true, domain };
    } catch {
      // not loaded in this domain
    }
  }
  return { loaded: false, domain: null };
}

/** `launchctl bootstrap gui/<uid> <plist>`; on a non-zero exit, the same into `user/<uid>`. */
async function bootstrapAgent(path: string, d: LaunchdDeps): Promise<string> {
  const [gui, user] = candidateDomains(d);
  try {
    await d.execFile('launchctl', ['bootstrap', gui, path], { timeout: LAUNCHCTL_TIMEOUT_MS });
    return gui;
  } catch {
    await d.execFile('launchctl', ['bootstrap', user, path], { timeout: LAUNCHCTL_TIMEOUT_MS });
    return user;
  }
}

/**
 * Writes the plist when it differs, then loads it: loaded and unchanged ⇒
 * nothing; loaded and changed ⇒ bootout, wait (at most 5 s) until launchd has
 * released the job, then bootstrap; not loaded ⇒ bootstrap. Throws when
 * neither domain accepts the bootstrap.
 */
export async function installSupervisorAgent(
  o: RenderSupervisorPlistOptions,
  deps?: Partial<LaunchdDeps>,
): Promise<{ path: string; written: boolean; domain: string }> {
  const d = resolveDeps(deps);
  const path = supervisorAgentPath(d.homedir());
  const text = renderSupervisorPlist(o);

  const written = (await d.readFile(path)) !== text;
  if (written) {
    await d.mkdir(dirname(path));
    await d.writeFile(path, text);
  }
  // launchd creates the log file but not its directory.
  await d.mkdir(dirname(o.logPath));

  const current = await isSupervisorAgentLoaded(d);
  if (current.loaded && current.domain) {
    if (!written) return { path, written, domain: current.domain };
    try {
      await d.execFile('launchctl', ['bootout', `${current.domain}/${SUPERVISOR_AGENT_LABEL}`], { timeout: LAUNCHCTL_TIMEOUT_MS });
    } catch {
      // Already gone; the bootstrap below reports a real failure.
    }
    // A bootstrap while launchd still holds the label fails with "5: Input/output error".
    for (let poll = 0; poll < BOOTOUT_SETTLE_POLLS && (await isSupervisorAgentLoaded(d)).loaded; poll += 1) {
      await d.sleep(BOOTOUT_SETTLE_POLL_MS);
    }
  }
  return { path, written, domain: await bootstrapAgent(path, d) };
}
