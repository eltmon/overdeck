/**
 * Terminal host port for companion terminals (PAN-3974).
 *
 * The lifecycle only needs five facts from the terminal host: is the owner
 * session there (and which incarnation of it), is a companion there, which
 * owner generation it was created for, create one, kill one. The tmux
 * implementation below is async-only (`tmuxExecAsync` / `createSession`), never
 * types into a pane, and stamps the generation atomically at creation through
 * `new-session -e` so the tmux session itself is the authority — nothing is
 * stored anywhere else.
 */
import { Effect } from 'effect';
import { createSession, exactPaneTarget, exactSession, tmuxExecAsync, validateSessionName } from '../../tmux.js';

export const COMPANION_GENERATION_ENV = 'OVERDECK_COMPANION_GENERATION';

export interface CompanionCreateSpec {
  readonly cwd: string;
  /** Exact argv for the native client; element 0 is an absolute binary path. */
  readonly argv: readonly string[];
  readonly generation: string;
}

export interface CompanionTerminalHost {
  /** An identity for the owner session's current incarnation, or null when it is gone. */
  ownerStamp(ownerSession: string): Promise<string | null>;
  /** `undefined` when no such session exists, `null` when it exists without a generation stamp. */
  readGeneration(companionSession: string): Promise<string | null | undefined>;
  create(companionSession: string, spec: CompanionCreateSpec): Promise<void>;
  /** Kill the session if present. Returns true when a session was killed. */
  kill(companionSession: string): Promise<boolean>;
}

export interface TmuxCompanionHostDeps {
  /** Run a tmux command on the managed socket and return stdout. Rejects on non-zero exit. */
  readonly exec: (args: string[]) => Promise<string>;
  /** Create a detached session running `command` with `env` pinned on it. */
  readonly createSession: (name: string, cwd: string, command: string, env: Record<string, string>) => Promise<void>;
}

/** Single-quote one argv element for the `sh -c` tmux runs the pane command through. */
export function shellQuoteArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** `exec` keeps the native client as the pane process, so the session ends when it exits. */
export function companionPaneCommand(argv: readonly string[]): string {
  if (argv.length === 0) throw new Error('Companion terminal argv is empty');
  return ['exec', ...argv.map(shellQuoteArg)].join(' ');
}

const defaultDeps: TmuxCompanionHostDeps = {
  exec: async (args) => String((await tmuxExecAsync(args, { encoding: 'utf-8' })).stdout),
  createSession: (name, cwd, command, env) =>
    Effect.runPromise(createSession(name, cwd, command, { env })),
};

export function createTmuxCompanionHost(deps: TmuxCompanionHostDeps = defaultDeps): CompanionTerminalHost {
  const exists = async (name: string): Promise<boolean> => {
    try {
      await deps.exec(['has-session', '-t', exactSession(name)]);
      return true;
    } catch {
      return false;
    }
  };
  return {
    async ownerStamp(ownerSession) {
      if (!(await exists(ownerSession))) return null;
      try {
        // A missing session prints an empty line with exit 0, so the has-session
        // above is the real existence check and an empty stamp means "gone".
        const stamp = (await deps.exec(['display-message', '-p', '-t', exactPaneTarget(ownerSession), '#{session_created}'])).trim();
        return stamp || null;
      } catch {
        return null;
      }
    },
    async readGeneration(companionSession) {
      if (!(await exists(companionSession))) return undefined;
      try {
        const line = (await deps.exec(['show-environment', '-t', exactSession(companionSession), COMPANION_GENERATION_ENV])).trim();
        const prefix = `${COMPANION_GENERATION_ENV}=`;
        return line.startsWith(prefix) ? line.slice(prefix.length) || null : null;
      } catch {
        return null;
      }
    },
    async create(companionSession, spec) {
      validateSessionName(companionSession);
      await deps.createSession(companionSession, spec.cwd, companionPaneCommand(spec.argv), {
        [COMPANION_GENERATION_ENV]: spec.generation,
        TERM: 'xterm-256color',
      });
    },
    async kill(companionSession) {
      if (!(await exists(companionSession))) return false;
      try {
        await deps.exec(['kill-session', '-t', exactSession(companionSession)]);
        return true;
      } catch {
        return !(await exists(companionSession));
      }
    },
  };
}
