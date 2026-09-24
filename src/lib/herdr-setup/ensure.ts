/**
 * `ensureHerdr` — the one Herdr host-setup pass `pan install`, `pan sync` and
 * `pan up` run (PAN-3956 W8, D4–D7, D10).
 *
 * Order: skip check → binary (install if absent) → channel → binary update
 * (D5; after the channel so a preview binary updates to stable) → config
 * (`resume_agents_on_restore = false`) → session server → status verify →
 * pilot integrations.
 *
 * - `install`: installs, updates when the manifest is newer, sets up all.
 * - `sync`: same, but updates the binary only when no session server runs for
 *   this home; otherwise it warns with the manual steps.
 * - `up`: never installs or updates the binary and installs no integrations —
 *   it makes sure the config is safe and the session server is running.
 *
 * The herdr binary is shared by every Overdeck home, so only the default home
 * updates it: a throwaway `OVERDECK_HOME` sees its own session stopped and
 * would otherwise replace the binary under the live default server.
 *
 * `OVERDECK_HERDR_SYNC_LIGHT=1` (set by the dashboard's own `pan sync`
 * callers, which kill `pan` after a short timeout) skips the binary update
 * and the integration installs: those run minutes-long subprocesses that
 * would outlive a killed parent.
 *
 * Nothing here stops or restarts a running session server: that closes every
 * agent pane, so it is always the operator's call.
 */

import { homedir } from 'node:os';

import {
  DEFAULT_HERDR_SESSION_NAME,
  probeHerdrAvailability,
  selectTerminalBackend,
  type HerdrAvailability,
  type TerminalBackendConfig,
  type TerminalBackendSelection,
} from '../terminal-backends/select.js';
import {
  compareSemver,
  ensureStableChannel,
  fetchLatestStableVersion,
  installHerdrBinary,
  readHerdrVersion,
  updateHerdrBinary,
} from './binary.js';
import {
  ensureHerdrConfig,
  herdrConfigDisablesResume,
  herdrConfigPath,
  type EnsureHerdrConfigResult,
} from './config.js';
import {
  ensureHerdrIntegrations,
  type EnsureHerdrIntegrationsResult,
} from './integrations.js';
import {
  ensureHerdrServer,
  herdrPersistentUnitWanted,
  herdrUnitName,
  type EnsureHerdrServerResult,
} from './service.js';
import { defaultHerdrExec, readHerdrStatus, type HerdrExec, type HerdrStatus } from './status.js';

export type EnsureHerdrMode = 'install' | 'sync' | 'up';

export interface EnsureHerdrDeps {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly home?: string;
  readonly exec?: HerdrExec;
  readonly selection?: () => Promise<TerminalBackendSelection>;
  readonly probe?: () => Promise<HerdrAvailability>;
  readonly fetchLatest?: () => Promise<string | null>;
  readonly installBinary?: () => Promise<{ binary: string }>;
  readonly updateBinary?: (binary: string) => Promise<void>;
  readonly readVersion?: (binary: string) => Promise<string | null>;
  readonly readStatus?: (binary: string, session: string) => Promise<HerdrStatus | null>;
  readonly ensureChannel?: (binary: string, status: HerdrStatus | null) => Promise<'stable' | 'changed' | 'unmanaged'>;
  readonly ensureConfig?: (input: { binary: string; session: string; serverRunning: boolean }) =>
    Promise<EnsureHerdrConfigResult>;
  /** True when the on-disk config already says `resume_agents_on_restore = false`. */
  readonly configDisablesResume?: (path: string) => Promise<boolean>;
  readonly ensureServer?: (input: {
    binary: string;
    session: string;
    socket: string;
    persistentUnit: boolean;
    configPathEnv?: string;
  }) => Promise<EnsureHerdrServerResult>;
  readonly ensureIntegrations?: (input: { binary: string }) => Promise<EnsureHerdrIntegrationsResult>;
}

export interface EnsureHerdrOptions {
  readonly mode: EnsureHerdrMode;
  /** `pan install --skip-herdr`. */
  readonly skip?: boolean;
  readonly deps?: EnsureHerdrDeps;
}

export interface EnsureHerdrSkipped {
  /** Why the whole step was skipped (D10). */
  readonly skipped: string;
}

export interface EnsureHerdrRunReport {
  readonly session: string;
  readonly binary: {
    readonly path: string | null;
    readonly version: string | null;
    readonly action: 'present' | 'installed' | 'updated' | 'update-available' | 'missing';
    readonly latest?: string | null;
  };
  readonly channel: 'stable' | 'changed' | 'unmanaged' | 'unchecked';
  readonly config: { readonly changed: boolean; readonly path: string; readonly error?: string };
  readonly server: {
    readonly running: boolean;
    readonly managedBy?: 'systemd' | 'detached' | 'already-running';
    readonly unit?: string;
    readonly reason?: string;
    readonly endpointCompatible?: boolean;
    readonly restartNeeded?: boolean;
    /** `herdr status` did not answer: running or not is unknown. */
    readonly stateUnknown?: boolean;
    /** The next step for the operator when the server is not running. */
    readonly hint?: string;
  };
  readonly integrations: {
    readonly installed: string[];
    readonly already: string[];
    readonly skipped: Array<{ target: string; reason: string }>;
  };
  readonly warnings: string[];
}

export type EnsureHerdrReport = EnsureHerdrSkipped | EnsureHerdrRunReport;

export function isHerdrSetupSkipped(report: EnsureHerdrReport): report is EnsureHerdrSkipped {
  return 'skipped' in report;
}

async function defaultSelection(): Promise<TerminalBackendSelection> {
  let config: TerminalBackendConfig = {};
  try {
    const { loadConfigSync } = await import('../config-yaml.js');
    config = loadConfigSync().config as TerminalBackendConfig;
  } catch {
    // Unreadable config: env and the default decide.
  }
  return selectTerminalBackend(config);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** D10: explicit tmux, CI, a Vitest worker, or `--skip-herdr`. */
async function skipReason(options: EnsureHerdrOptions): Promise<string | null> {
  const env = options.deps?.env ?? process.env;
  if (options.skip) return 'Herdr setup skipped (--skip-herdr)';
  const selection = await (options.deps?.selection ?? defaultSelection)();
  if (selection.backend !== 'herdr') {
    return `Herdr setup skipped: the terminal backend is ${selection.backend} (${selection.diagnostic})`;
  }
  if (env.CI) return 'Herdr setup skipped: running under CI';
  if (env.VITEST) return 'Herdr setup skipped: running under Vitest';
  return null;
}

export async function ensureHerdr(options: EnsureHerdrOptions): Promise<EnsureHerdrReport> {
  const skipped = await skipReason(options);
  if (skipped) return { skipped };

  const deps = options.deps ?? {};
  const mode = options.mode;
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();
  const exec = deps.exec ?? defaultHerdrExec;
  const readVersion = deps.readVersion ?? ((binary: string) => readHerdrVersion(binary, exec));
  const readStatus = deps.readStatus ?? ((binary: string, session: string) => readHerdrStatus(binary, session, exec));
  const configPath = herdrConfigPath({ homeDir: home, env });
  const warnings: string[] = [];

  const probe = await (deps.probe ?? (() => probeHerdrAvailability({ homeDir: home })))();
  const session = probe.session;
  const unit = herdrUnitName(session);

  // ── binary ────────────────────────────────────────────────────────────────
  let binaryPath = probe.binary;
  let action: EnsureHerdrRunReport['binary']['action'] = 'present';
  let latest: string | null | undefined;
  if (!binaryPath) {
    if (mode === 'up') {
      return {
        session,
        binary: { path: null, version: null, action: 'missing' },
        channel: 'unchecked',
        config: { changed: false, path: configPath },
        server: { running: false, reason: "the 'herdr' binary is not installed — run `pan install`" },
        integrations: { installed: [], already: [], skipped: [] },
        warnings,
      };
    }
    try {
      binaryPath = (await (deps.installBinary ?? (() => installHerdrBinary(exec, home)))()).binary;
      action = 'installed';
    } catch (error) {
      return {
        session,
        binary: { path: null, version: null, action: 'missing' },
        channel: 'unchecked',
        config: { changed: false, path: configPath },
        server: { running: false, reason: `Herdr install failed: ${errorMessage(error)}` },
        integrations: { installed: [], already: [], skipped: [] },
        warnings,
      };
    }
  }
  const binary = binaryPath;
  let version = await readVersion(binary);
  let status = await readStatus(binary, session);

  // ── channel (before the update, so a preview binary updates to stable) ────
  let channel: EnsureHerdrRunReport['channel'] = 'unchecked';
  if (mode !== 'up') {
    try {
      channel = await (deps.ensureChannel ?? ((b: string, s: HerdrStatus | null) => ensureStableChannel(b, s, exec, home)))(
        binary,
        status,
      );
    } catch (error) {
      warnings.push(`Could not set the Herdr update channel to stable: ${errorMessage(error)}`);
    }
  }

  // ── binary update ─────────────────────────────────────────────────────────
  const light = mode === 'sync' && env.OVERDECK_HERDR_SYNC_LIGHT === '1';
  if (action === 'present' && mode !== 'up' && !light) {
    latest = await (deps.fetchLatest ?? (() => fetchLatestStableVersion()))();
    if (latest === null) {
      warnings.push('Could not read https://herdr.dev/latest.json; skipped the Herdr update check.');
    } else if (version && compareSemver(latest, version) > 0) {
      const serverRunning = status?.server.running;
      if (session !== DEFAULT_HERDR_SESSION_NAME) {
        // The binary is shared: only the default home may replace it.
        action = 'update-available';
        warnings.push(
          `herdr ${latest} is available; this Overdeck home (session '${session}') leaves the shared herdr binary `
          + 'alone — update it from the default home (`pan sync` with OVERDECK_HOME unset)',
        );
      } else if (mode === 'install' || serverRunning === false) {
        try {
          await (deps.updateBinary ?? ((b: string) => updateHerdrBinary(b, exec)))(binary);
          action = 'updated';
          version = (await readVersion(binary)) ?? latest;
          status = await readStatus(binary, session);
        } catch (error) {
          warnings.push(`herdr update failed: ${errorMessage(error)}`);
        }
      } else {
        action = 'update-available';
        warnings.push(
          `herdr ${latest} is available; run \`herdr update\` and then \`systemctl --user restart ${unit}\` `
          + 'at a quiet moment — restarting closes every agent pane',
        );
      }
    }
  }

  // ── config (before the server starts, so it never starts with resume on) ──
  const serverRunningBefore = status?.server.running === true;
  // Unreadable status: a live socket file means a reload is worth trying.
  const reloadTarget = status === null ? probe.socketExists : serverRunningBefore;
  let config: EnsureHerdrRunReport['config'];
  try {
    const result = await (deps.ensureConfig ?? ((input) => ensureHerdrConfig({ ...input, exec, path: configPath })))({
      binary,
      session,
      serverRunning: reloadTarget,
    });
    config = { changed: result.changed, path: result.path };
    if (result.reloadWarning) warnings.push(result.reloadWarning);
  } catch (error) {
    config = { changed: false, path: configPath, error: errorMessage(error) };
    warnings.push(`Herdr config not updated: ${errorMessage(error)}`);
  }

  // ── session server ────────────────────────────────────────────────────────
  // A config that could not be made safe blocks STARTING a server: a server
  // started with resume on relaunches every saved agent pane into its native
  // resume, bypassing Overdeck's paused and stopped gates — worse than no
  // server, whose failure is loud and fixed by the one line the error names.
  // A server that is already running is left as it is (nothing here restarts
  // one), and a config that already says `false` on disk never blocks.
  // `herdr status` can time out under load, so an unreadable status is
  // re-probed; still unreadable is reported as unknown, never as "down".
  let server: EnsureHerdrRunReport['server'];
  const herdrAccepts = async () => (await exec(binary, ['config', 'check']).catch(() => null))?.exitCode === 0;
  let unsafeToStart = config.error !== undefined
    && !serverRunningBefore
    && !(await (deps.configDisablesResume ?? ((path) => herdrConfigDisablesResume(path, undefined, herdrAccepts)))(
      config.path,
    ));
  let stateUnknown = false;
  if (unsafeToStart) {
    const again = await readStatus(binary, session);
    if (again?.server.running) unsafeToStart = false; // running after all: the already-running path
    else stateUnknown = again === null;
  }
  const configHint = `Fix ${config.path} as the warning above says (it must set [session] resume_agents_on_restore = `
    + 'false), then re-run `pan up`; or set terminal.backend to tmux.';
  if (unsafeToStart && stateUnknown) {
    server = {
      running: false,
      stateUnknown: true,
      reason: `\`herdr --session ${session} status\` did not answer, so whether the server runs is unknown; none was `
        + `started because ${config.path} does not set [session] resume_agents_on_restore = false (${config.error})`,
      hint: `Check with \`pan doctor\`. ${configHint}`,
    };
  } else if (unsafeToStart) {
    server = {
      running: false,
      reason: `not started — ${config.path} does not set [session] resume_agents_on_restore = false, and a server `
        + `started now would relaunch paused and stopped agents (${config.error})`,
      hint: `Agent launches will fail until then. ${configHint}`,
    };
  } else {
    try {
      const { warning, ...result } = await (deps.ensureServer ?? ((input) => ensureHerdrServer({ ...input, exec })))({
        binary,
        session,
        socket: probe.socket,
        persistentUnit: herdrPersistentUnitWanted(session, env),
        ...(env.HERDR_CONFIG_PATH?.trim() ? { configPathEnv: configPath } : {}),
      });
      server = result;
      if (warning) warnings.push(warning);
    } catch (error) {
      server = { running: false, reason: errorMessage(error) };
    }
  }

  // ── verify ────────────────────────────────────────────────────────────────
  if (server.running) {
    const verified = await readStatus(binary, session);
    if (verified) {
      server = {
        ...server,
        endpointCompatible: verified.server.endpointCompatible,
        restartNeeded: verified.server.restartNeeded || verified.server.serverBinaryStale,
      };
      if (!verified.server.endpointCompatible) {
        warnings.push(
          `The '${session}' Herdr server (${verified.server.version ?? 'unknown version'}) is not endpoint-compatible `
          + `with the herdr client (${verified.client.version}); restart it at a quiet moment `
          + `(\`systemctl --user restart ${unit}\`) — restarting closes every agent pane.`,
        );
      } else if (verified.server.restartNeeded || verified.server.serverBinaryStale) {
        warnings.push(
          `The '${session}' Herdr server runs an older binary than ${verified.client.version}; restart it at a quiet `
          + `moment (\`systemctl --user restart ${unit}\`) — restarting closes every agent pane.`,
        );
      }
    }
  }

  // ── integrations ──────────────────────────────────────────────────────────
  let integrations: EnsureHerdrRunReport['integrations'] = { installed: [], already: [], skipped: [] };
  if (light) {
    warnings.push('Skipped the Herdr binary update and integration installs (OVERDECK_HERDR_SYNC_LIGHT); '
      + 'run `pan sync` from a terminal for those.');
  } else if (mode !== 'up') {
    try {
      integrations = await (deps.ensureIntegrations ?? ((input) => ensureHerdrIntegrations({ ...input, exec })))({ binary });
    } catch (error) {
      warnings.push(`Herdr integrations not checked: ${errorMessage(error)}`);
    }
  }

  return {
    session,
    binary: { path: binary, version, action, ...(latest !== undefined ? { latest } : {}) },
    channel,
    config,
    server,
    integrations,
    warnings,
  };
}
