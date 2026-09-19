/**
 * Terminal backend selection (PAN-3917 D10).
 *
 * `OVERDECK_TERMINAL_BACKEND` wins, then an explicit `terminal.backend` in
 * config.yaml. Otherwise Herdr is the default when the `herdr` binary is on
 * PATH and THIS Overdeck home's session socket exists; otherwise tmux, with a
 * diagnostic naming the reason.
 *
 * Session isolation (fix10): the Herdr session name is derived from the
 * resolved `OVERDECK_HOME` exactly as the managed tmux socket name is —
 * `overdeck` only for the default `~/.overdeck`, `overdeck-<hash>` for any
 * other home. Without it a process serving a /tmp home (a test, an isolated
 * stack) selected the live `overdeck` session and spawned real agents into it.
 *
 * No subprocess: PATH is scanned with `fs.access`, so this is safe to call from
 * the server on every spawn.
 */

import { access } from 'fs/promises';
import { constants } from 'fs';
import { homedir } from 'os';
import { delimiter, join } from 'path';
import { getOverdeckHome } from '../paths.js';
import { managedInstanceName } from '../instance-name.js';
import type { TerminalBackendName } from './types.js';

/** The session name for the default `~/.overdeck` home. */
export const DEFAULT_HERDR_SESSION_NAME = 'overdeck';
export const HERDR_BINARY = 'herdr';

const BACKEND_NAMES: readonly TerminalBackendName[] = ['tmux', 'herdr'];

export interface TerminalBackendSelection {
  readonly backend: TerminalBackendName;
  /** One sentence naming why this backend was chosen. */
  readonly diagnostic: string;
}

/** Only the shape `select` needs, so config-yaml stays a type-only dependency. */
export interface TerminalBackendConfig {
  readonly terminal?: { readonly backend?: TerminalBackendName };
}

export interface SelectTerminalBackendDeps {
  /** PATH to scan for the herdr binary. Defaults to `process.env.PATH`. */
  readonly pathEnv?: string;
  /** Home directory used to derive the session socket path. */
  readonly homeDir?: string;
  /** `XDG_CONFIG_HOME` override; defaults to the environment. */
  readonly configHome?: string;
  /** Overdeck home whose instance the session name is derived from. */
  readonly overdeckHome?: string;
  /**
   * `OVERDECK_TERMINAL_BACKEND` override; defaults to the environment. Pass an
   * empty string to assert the host-probe path with no override in play.
   */
  readonly backendEnv?: string;
  /** True when the path is an executable file. */
  readonly isExecutable?: (path: string) => Promise<boolean>;
  /** True when the path exists. */
  readonly exists?: (path: string) => Promise<boolean>;
}

async function defaultIsExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function defaultExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The Herdr session this Overdeck home owns. Resolved at call time, never at
 * module load: `OVERDECK_HOME` is set per process (and per test worker) after
 * this module may already have been imported.
 */
export function herdrSessionName(deps: SelectTerminalBackendDeps = {}): string {
  return managedInstanceName(deps.overdeckHome ?? getOverdeckHome());
}

/** `~/.config/herdr/sessions/<session>/herdr.sock`, honoring XDG_CONFIG_HOME. */
export function herdrSocketPath(deps: SelectTerminalBackendDeps = {}): string {
  const configHome = deps.configHome
    ?? process.env.XDG_CONFIG_HOME
    ?? join(deps.homeDir ?? homedir(), '.config');
  return join(configHome, 'herdr', 'sessions', herdrSessionName(deps), 'herdr.sock');
}

async function findHerdrBinary(deps: SelectTerminalBackendDeps): Promise<string | null> {
  const pathEnv = deps.pathEnv ?? process.env.PATH ?? '';
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, HERDR_BINARY);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

/**
 * Which backend THIS host runs on, memoized per process (PAN-3917 W12).
 *
 * The selection is a property of the host — binary, socket, config, env — not
 * of the call, and the supervisor decision, the launch path and the liveness
 * oracle all need the same answer. It lives here, not in `launch.ts`, because
 * `launch.ts` imports both adapters and the tmux adapter imports the liveness
 * oracle: a static edge from liveness to launch would close a load cycle.
 * `config-yaml` is imported lazily for the same reason config is a parameter
 * everywhere else in this module.
 */
let hostBackendName: Promise<TerminalBackendName> | null = null;

export function hostTerminalBackendName(): Promise<TerminalBackendName> {
  hostBackendName ??= (async () => {
    let configured: TerminalBackendConfig = {};
    try {
      const { loadConfigSync } = await import('../config-yaml.js');
      configured = loadConfigSync() as TerminalBackendConfig;
    } catch {
      // An unreadable config is a selection input, not a failure: the host
      // probe then decides on the binary and socket alone.
    }
    const { backend } = await selectTerminalBackend(configured);
    return backend;
  })().catch((): TerminalBackendName => 'tmux');
  return hostBackendName;
}

/** Tests only: drop the memoized host selection. */
export function resetHostTerminalBackendName(): void {
  hostBackendName = null;
}

/**
 * Pick the terminal backend for this host. Never throws: an unreadable PATH or
 * a missing socket is a tmux selection with a diagnostic.
 */
export async function selectTerminalBackend(
  config: TerminalBackendConfig = {},
  deps: SelectTerminalBackendDeps = {},
): Promise<TerminalBackendSelection> {
  const override = deps.backendEnv ?? process.env.OVERDECK_TERMINAL_BACKEND;
  if (override) {
    if ((BACKEND_NAMES as readonly string[]).includes(override)) {
      return {
        backend: override as TerminalBackendName,
        diagnostic: `OVERDECK_TERMINAL_BACKEND is set to '${override}'.`,
      };
    }
    console.warn(
      `[terminal] Ignoring OVERDECK_TERMINAL_BACKEND='${override}': expected one of ${BACKEND_NAMES.join(', ')}.`,
    );
  }

  const configured = config.terminal?.backend;
  if (configured) {
    return { backend: configured, diagnostic: `terminal.backend is set to '${configured}' in config.yaml.` };
  }

  const binary = await findHerdrBinary(deps);
  if (!binary) {
    return { backend: 'tmux', diagnostic: `The '${HERDR_BINARY}' binary is not on PATH, so tmux is the backend.` };
  }

  const session = herdrSessionName(deps);
  const socket = herdrSocketPath(deps);
  const exists = deps.exists ?? defaultExists;
  if (!(await exists(socket))) {
    return {
      backend: 'tmux',
      diagnostic: `The '${HERDR_BINARY}' binary is at ${binary} but its '${session}' session socket ${socket} does not exist, so tmux is the backend.`,
    };
  }

  return {
    backend: 'herdr',
    diagnostic: `The '${HERDR_BINARY}' binary at ${binary} and its '${session}' session socket ${socket} are both present.`,
  };
}
