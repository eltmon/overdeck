/**
 * OpenCode companion adapter (PAN-3974).
 *
 * Resolves `opencode attach http://127.0.0.1:<port> --session <id> --dir <cwd>`
 * for an OpenCode conversation from what its ACP host recorded (PAN-3937):
 * `~/.overdeck/agents/<ownerSession>/opencode-port` and `acp-session-id`. The
 * cwd comes from the conversation record and the binary from the same resolver
 * the launcher uses. Nothing here reads caller input.
 *
 * Before handing out a target it asks the owner's server for the exact session
 * (`GET /session/<id>`), so an attach never points at a dead port, a port some
 * other process reused, or a session the server does not know. Attach only —
 * never `--fork`/`--continue` — so no second session or server is started.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveHarnessBinary } from '../../harness-binary.js';
import { getOverdeckHome } from '../../paths.js';
import type { CompanionOwner, CompanionTargetResolution, CompanionTerminalAdapter } from './lifecycle.js';

export const OPENCODE_SESSION_ID_PATTERN = /^ses_[A-Za-z0-9]{1,120}$/;
export const OPENCODE_SESSION_PROBE_TIMEOUT_MS = 2_000;

export const OPENCODE_RESTART_REQUIRED_MESSAGE =
  'This OpenCode conversation started before Overdeck recorded its server port, so the native CLI cannot attach to it. ' +
  'Stop and resume the conversation to attach the native CLI. Its runtime log stays available under Runtime log.';

export interface OpenCodeCompanionAdapterDeps {
  readonly overdeckHome?: () => string;
  readonly readText?: (path: string) => Promise<string | undefined>;
  readonly resolveBinary?: () => Promise<string | null>;
  readonly fetch?: (
    url: string,
    init: { signal: AbortSignal; redirect: 'manual' },
  ) => Promise<{ status: number; type?: string }>;
  readonly probeTimeoutMs?: number;
}

async function readTextIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function parsePort(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65_535 ? port : null;
}

export function createOpenCodeCompanionAdapter(deps: OpenCodeCompanionAdapterDeps = {}): CompanionTerminalAdapter {
  const overdeckHome = deps.overdeckHome ?? getOverdeckHome;
  const readText = deps.readText ?? readTextIfPresent;
  const resolveBinary = deps.resolveBinary ?? (() => resolveHarnessBinary('opencode'));
  const fetchImpl = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const probeTimeoutMs = deps.probeTimeoutMs ?? OPENCODE_SESSION_PROBE_TIMEOUT_MS;

  return {
    kind: 'opencode-attach',
    async resolveTarget(owner: CompanionOwner): Promise<CompanionTargetResolution> {
      const agentDir = join(overdeckHome(), 'agents', owner.ownerSession);
      const [rawPort, rawSessionId] = await Promise.all([
        readText(join(agentDir, 'opencode-port')),
        readText(join(agentDir, 'acp-session-id')),
      ]);
      const sessionId = rawSessionId?.trim();
      if (!sessionId) {
        return {
          ok: false,
          reason: 'owner-starting',
          message: 'OpenCode is still starting this conversation. Try Terminal again in a moment.',
        };
      }
      if (rawPort === undefined) {
        return { ok: false, reason: 'restart-required', message: OPENCODE_RESTART_REQUIRED_MESSAGE };
      }
      const port = parsePort(rawPort);
      if (port === null || !OPENCODE_SESSION_ID_PATTERN.test(sessionId)) {
        return {
          ok: false,
          reason: 'restart-required',
          message: 'The recorded OpenCode server port or session id is malformed. Stop and resume the conversation to record them again.',
        };
      }

      const baseUrl = `http://127.0.0.1:${port}`;
      let status: number;
      let redirected: boolean;
      try {
        // Never follow a redirect: a different process on the recorded port
        // must not be able to send the probe off loopback and pass it.
        const response = await fetchImpl(`${baseUrl}/session/${encodeURIComponent(sessionId)}`, {
          signal: AbortSignal.timeout(probeTimeoutMs),
          redirect: 'manual',
        });
        status = response.status;
        redirected = response.type === 'opaqueredirect' || (status >= 300 && status < 400);
      } catch {
        return {
          ok: false,
          reason: 'owner-starting',
          message: 'The conversation\'s OpenCode server is not answering yet. Try Terminal again in a moment, or check Runtime log.',
        };
      }
      if (redirected) {
        return {
          ok: false,
          reason: 'owner-starting',
          message: 'The recorded OpenCode server port answered with a redirect, so it is not this conversation\'s server. Check Runtime log, then stop and resume the conversation.',
        };
      }
      if (status === 404) {
        return {
          ok: false,
          reason: 'session-missing',
          message: 'The conversation\'s OpenCode server does not know its recorded session. Check Runtime log, then stop and resume the conversation.',
        };
      }
      if (status < 200 || status >= 300) {
        return {
          ok: false,
          reason: 'owner-starting',
          message: `The conversation's OpenCode server answered HTTP ${status}. Try Terminal again in a moment, or check Runtime log.`,
        };
      }

      const binary = await resolveBinary();
      if (!binary) {
        return {
          ok: false,
          reason: 'binary-missing',
          message: 'The opencode executable was not found. Install OpenCode or add it to PATH, then open Terminal again.',
        };
      }
      return {
        ok: true,
        argv: [binary, 'attach', baseUrl, '--session', sessionId, '--dir', owner.cwd],
        cwd: owner.cwd,
        fingerprint: `${port}:${sessionId}`,
      };
    },
  };
}
