/**
 * Terminal backend selection (PAN-3917 D10, PAN-3956 D1).
 *
 * Two separate questions, answered by two separate functions:
 *
 * - **Selection (policy)** — `selectTerminalBackend`: WHICH backend this host is
 *   supposed to use. `OVERDECK_TERMINAL_BACKEND` wins, then an explicit
 *   `terminal.backend` in config.yaml, otherwise Herdr. It never touches the
 *   filesystem, so a missing binary or socket can never turn into a silent tmux
 *   selection. `hostTerminalBackendName` memoizes it per process.
 * - **Availability (probe)** — `probeHerdrAvailability`: WHETHER the Herdr
 *   backend can serve right now — the `herdr` binary resolves and THIS home's
 *   session socket exists. It is never memoized, so a session server started
 *   after dashboard boot is usable without a restart. An unavailable Herdr is a
 *   launch error (`TerminalBackendUnavailableError`), a boot-log error and a
 *   `pan doctor` FAIL — never a tmux fallback.
 *
 * Session isolation (fix10): the Herdr session name is derived from the
 * resolved `OVERDECK_HOME` exactly as the managed tmux socket name is —
 * `overdeck` only for the default `~/.overdeck`, `overdeck-<hash>` for any
 * other home. Without it a process serving a /tmp home (a test, an isolated
 * stack) selected the live `overdeck` session and spawned real agents into it.
 *
 * No subprocess: PATH is scanned with `fs.access`, so the probe is safe to call
 * from the server on every spawn.
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

/** Where the selected backend came from. */
export type TerminalBackendSource = 'env' | 'config' | 'default';

export interface TerminalBackendSelection {
  readonly backend: TerminalBackendName;
  readonly source: TerminalBackendSource;
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
  /** Home directory used to derive the session socket path and `~/.local/bin`. */
  readonly homeDir?: string;
  /** `XDG_CONFIG_HOME` override; defaults to the environment. */
  readonly configHome?: string;
  /** Overdeck home whose instance the session name is derived from. */
  readonly overdeckHome?: string;
  /**
   * `OVERDECK_TERMINAL_BACKEND` override; defaults to the environment. Pass an
   * empty string to assert the no-override path.
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

/**
 * The `herdr` binary: the first executable on PATH, then `~/.local/bin` (the
 * vendor installer's target, which a bare service PATH often omits).
 */
async function findHerdrBinary(deps: SelectTerminalBackendDeps): Promise<string | null> {
  const pathEnv = deps.pathEnv ?? process.env.PATH ?? '';
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  const dirs = [...pathEnv.split(delimiter), join(deps.homeDir ?? homedir(), '.local', 'bin')];
  const seen = new Set<string>();
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = join(dir, HERDR_BINARY);
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

/**
 * Which backend THIS host runs on, memoized per process (PAN-3917 W12).
 *
 * The memo is the POLICY (env → config → default herdr), not availability: the
 * supervisor decision, the launch path and the liveness oracle all need the
 * same answer, and a Herdr outage must not flip it to tmux. It lives here, not
 * in `launch.ts`, because `launch.ts` imports both adapters and the tmux
 * adapter imports the liveness oracle: a static edge from liveness to launch
 * would close a load cycle. `config-yaml` is imported lazily for the same
 * reason config is a parameter everywhere else in this module.
 */
let hostBackendName: Promise<TerminalBackendName> | null = null;

export function hostTerminalBackendName(): Promise<TerminalBackendName> {
  hostBackendName ??= (async () => {
    let configured: TerminalBackendConfig = {};
    try {
      const { loadConfigSync } = await import('../config-yaml.js');
      // `loadConfigSync()` returns `{ config, migration }` — the terminal
      // setting lives on `.config` (PAN-3956: the wrapper was cast directly,
      // so `terminal.backend` in config.yaml was silently ignored here).
      configured = loadConfigSync().config as TerminalBackendConfig;
    } catch {
      // An unreadable config is a selection input, not a failure: the env and
      // the default then decide.
    }
    const { backend } = await selectTerminalBackend(configured);
    return backend;
  })().catch((): TerminalBackendName => 'herdr');
  return hostBackendName;
}

/** Tests only: drop the memoized host selection. */
export function resetHostTerminalBackendName(): void {
  hostBackendName = null;
}

/**
 * Policy only: env → config → default herdr. No filesystem access, never
 * throws. Whether Herdr can actually serve is `probeHerdrAvailability`.
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
        source: 'env',
        diagnostic: `OVERDECK_TERMINAL_BACKEND is set to '${override}'.`,
      };
    }
    console.warn(
      `[terminal] Ignoring OVERDECK_TERMINAL_BACKEND='${override}': expected one of ${BACKEND_NAMES.join(', ')}.`,
    );
  }

  const configured = config.terminal?.backend;
  if (configured) {
    return {
      backend: configured,
      source: 'config',
      diagnostic: `terminal.backend is set to '${configured}' in config.yaml.`,
    };
  }

  return { backend: 'herdr', source: 'default', diagnostic: 'Herdr is the default terminal backend.' };
}

export interface HerdrAvailability {
  readonly binary: string | null;
  readonly session: string;
  readonly socket: string;
  readonly socketExists: boolean;
  readonly available: boolean;
  /** Present when !available; one sentence for logs, doctor and spawn errors. */
  readonly reason?: string;
}

/**
 * Host probe: the binary on PATH or in `~/.local/bin`, plus THIS home's session
 * socket. Never memoized, never spawns a subprocess.
 */
export async function probeHerdrAvailability(deps: SelectTerminalBackendDeps = {}): Promise<HerdrAvailability> {
  const binary = await findHerdrBinary(deps);
  const session = herdrSessionName(deps);
  const socket = herdrSocketPath(deps);
  const socketExists = await (deps.exists ?? defaultExists)(socket);
  if (!binary) {
    return {
      binary,
      session,
      socket,
      socketExists,
      available: false,
      reason: `The '${HERDR_BINARY}' binary is not on PATH or in ~/.local/bin.`,
    };
  }
  if (!socketExists) {
    return {
      binary,
      session,
      socket,
      socketExists,
      available: false,
      reason: `The '${HERDR_BINARY}' binary is at ${binary} but its '${session}' session socket ${socket} does not exist.`,
    };
  }
  return { binary, session, socket, socketExists, available: true };
}

/**
 * The one boot-log line naming the terminal backend (PAN-3956 FR-9). `probe` is
 * null when the selection is not herdr.
 */
export function describeTerminalBackendBoot(
  selection: TerminalBackendSelection,
  probe: HerdrAvailability | null,
): { level: 'log' | 'error'; line: string } {
  if (selection.backend !== 'herdr') {
    return {
      level: 'log',
      line: `[terminal] backend=${selection.backend} source=${selection.source} — ${selection.diagnostic}`,
    };
  }
  if (probe && probe.available) {
    return {
      level: 'log',
      line: `[terminal] backend=herdr source=${selection.source} session=${probe.session} `
        + `socket=${probe.socket} binary=${probe.binary}`,
    };
  }
  const session = probe?.session ?? DEFAULT_HERDR_SESSION_NAME;
  const reason = probe?.reason ?? 'availability was not probed.';
  return {
    level: 'error',
    line: `[terminal] backend=herdr source=${selection.source} UNAVAILABLE: ${reason} `
      + `Agent launches will fail until \`pan install\` installs Herdr and starts the '${session}' `
      + `session server, or terminal.backend is set to 'tmux' in ~/.overdeck/config.yaml.`,
  };
}
