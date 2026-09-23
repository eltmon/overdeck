/**
 * Codex companion adapter (PAN-3835).
 *
 * Resolves `codex resume --remote unix://<socket> <threadId>` for a Codex
 * conversation whose app-server host exposes a native endpoint
 * (`--native-endpoint`, see src/lib/codex/native-endpoint.ts). The native TUI
 * becomes a second client of the conversation's one app-server, on the exact
 * thread the dashboard delivers to; it never starts a second app-server.
 *
 * Health check first: the adapter asks the running host, over its
 * token-authenticated control socket, to `prepare-terminal`. The host answers
 * only when its manager is connected through the native endpoint and owns a
 * thread with a saved turn (it strictly resumes a saved thread it has not
 * loaded yet, and never creates a thread or starts a turn). The endpoint the
 * host reports must be the per-conversation socket Overdeck derives itself
 * and the one the host recorded in `codex-native-endpoint`.
 *
 * Nothing here reads caller input. The fingerprint changes when the host
 * restarts (new generation) or when the attached TUI navigates to another
 * thread (`/new`, `/resume`), so reopening replaces the companion and lands
 * on the conversation's own thread again.
 */
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { postCodexHostOp, type HostOpOutcome } from '../../codex/app-server-client.js';
import { MINIMUM_NATIVE_ENDPOINT_CODEX_VERSION } from '../../codex/app-server-manager.js';
import { CODEX_NATIVE_ENDPOINT_FILE, codexNativeSocketPath } from '../../codex/native-endpoint.js';
import { loadConfigSync } from '../../config-yaml.js';
import { resolveHarnessBinary } from '../../harness-binary.js';
import { getOverdeckHome } from '../../paths.js';
import type { CompanionOwner, CompanionTargetResolution, CompanionTerminalAdapter } from './lifecycle.js';

export const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Long enough for the host to strictly resume a saved thread it has not loaded yet. */
export const CODEX_PREPARE_TERMINAL_TIMEOUT_MS = 25_000;

export const CODEX_RESTART_REQUIRED_MESSAGE =
  'This Codex conversation started before Overdeck exposed a native endpoint for it, so the native CLI cannot attach. ' +
  'Stop and resume the conversation to attach the native CLI. Its current run keeps working, and Runtime log stays available.';

export interface CodexCompanionAdapterDeps {
  readonly overdeckHome?: () => string;
  readonly readText?: (path: string) => Promise<string | undefined>;
  readonly pathExists?: (path: string) => Promise<boolean>;
  readonly resolveBinary?: () => Promise<string | null>;
  readonly postHostOp?: (agentId: string, body: Record<string, unknown>) => Promise<HostOpOutcome>;
  /** The configured Codex transport; `tui` means the owner pane already runs the native TUI. */
  readonly codexTransport?: () => string | undefined;
}

async function readTextIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function unavailable(
  reason: Extract<CompanionTargetResolution, { ok: false }>['reason'],
  message: string,
): CompanionTargetResolution {
  return { ok: false, reason, message };
}

function nativeUnavailable(body: Record<string, unknown>): CompanionTargetResolution {
  const reason = typeof body.reason === 'string' ? body.reason : '';
  const installed = typeof body.cliVersion === 'string' ? body.cliVersion : undefined;
  if (reason === 'cli-unsupported') {
    return unavailable(
      'cli-unsupported',
      `The native Codex CLI needs codex-cli ${MINIMUM_NATIVE_ENDPOINT_CODEX_VERSION} or newer` +
        `${installed ? ` (installed: ${installed})` : ''}. Upgrade Codex, then stop and resume the conversation. ` +
        'The conversation keeps working meanwhile.',
    );
  }
  if (reason === 'socket-path-too-long') {
    return unavailable(
      'unsupported',
      'The conversation\'s runtime directory path is too long for a Unix socket, so the native CLI cannot attach. Runtime log stays available.',
    );
  }
  // not-requested: the host was launched without --native-endpoint (an older
  // launcher). connect-failed: the native socket never accepted, and the host
  // fell back to stdio. Either way the next start of the conversation fixes it.
  return unavailable('restart-required', CODEX_RESTART_REQUIRED_MESSAGE);
}

export function createCodexCompanionAdapter(deps: CodexCompanionAdapterDeps = {}): CompanionTerminalAdapter {
  const overdeckHome = deps.overdeckHome ?? getOverdeckHome;
  const readText = deps.readText ?? readTextIfPresent;
  const pathExists = deps.pathExists ?? ((path: string) => access(path).then(() => true, () => false));
  const resolveBinary = deps.resolveBinary ?? (() => resolveHarnessBinary('codex'));
  const postHostOp = deps.postHostOp
    ?? ((agentId: string, body: Record<string, unknown>) =>
      postCodexHostOp(agentId, body, { overdeckHome: overdeckHome(), timeoutMs: CODEX_PREPARE_TERMINAL_TIMEOUT_MS }));
  const codexTransport = deps.codexTransport ?? (() => loadConfigSync().config.codex?.transport);

  return {
    kind: 'codex-resume-remote',
    async resolveTarget(owner: CompanionOwner): Promise<CompanionTargetResolution> {
      const agentDir = join(overdeckHome(), 'agents', owner.ownerSession);
      const outcome = await postHostOp(owner.ownerSession, { op: 'prepare-terminal' });

      if (!outcome.ok) {
        if (outcome.reason === 'token-missing' && codexTransport() === 'tui') {
          return unavailable(
            'unsupported',
            'This Codex conversation runs the native Codex CLI directly in its own terminal (codex.transport: tui). Open Runtime log to use it.',
          );
        }
        return unavailable(
          'owner-starting',
          'The conversation\'s Codex app-server is not answering yet. Try Terminal again in a moment, or check Runtime log.',
        );
      }

      const { status, body } = outcome.response;
      if (status === 400 && /unsupported app-server op/i.test(String(body.error ?? ''))) {
        // A host from before PAN-3835 does not know prepare-terminal.
        return unavailable('restart-required', CODEX_RESTART_REQUIRED_MESSAGE);
      }
      if (status === 422 && body.code === 'native-unavailable') return nativeUnavailable(body);
      if (status === 409 && body.code === 'no-thread') {
        return unavailable(
          'session-not-started',
          'This conversation has no saved Codex turn yet. Send a first message from the dashboard, then open Terminal again.',
        );
      }
      if (status === 409 && body.code === 'resume-failed') {
        return unavailable(
          'session-missing',
          `Codex could not reopen this conversation's saved thread (${String(body.error ?? 'unknown error')}). ` +
            'Check Runtime log. Nothing was restarted and no new thread was created.',
        );
      }
      if (status < 200 || status >= 300) {
        return unavailable(
          'owner-starting',
          `The conversation's Codex app-server answered HTTP ${status}${body.error ? ` (${String(body.error)})` : ''}. Try Terminal again in a moment.`,
        );
      }

      const threadId = typeof body.threadId === 'string' ? body.threadId : '';
      const generation = typeof body.generation === 'string' ? body.generation : '';
      const navigationEpoch = typeof body.navigationEpoch === 'number' ? body.navigationEpoch : 0;
      const expectedEndpoint = `unix://${codexNativeSocketPath(agentDir)}`;
      const recordedEndpoint = (await readText(join(agentDir, CODEX_NATIVE_ENDPOINT_FILE)))?.trim();
      if (!CODEX_THREAD_ID_PATTERN.test(threadId) || !generation) {
        return unavailable('owner-starting', 'The Codex app-server reported an unexpected thread. Try Terminal again in a moment.');
      }
      if (body.endpoint !== expectedEndpoint || recordedEndpoint !== expectedEndpoint) {
        // Never attach to a socket other than this conversation's own.
        return unavailable('restart-required', CODEX_RESTART_REQUIRED_MESSAGE);
      }

      const binary = await resolveBinary();
      if (!binary) {
        return unavailable(
          'binary-missing',
          'The codex executable was not found. Install the Codex CLI or add it to PATH, then open Terminal again.',
        );
      }

      // The TUI reads the conversation's own config (folder trust, notices)
      // and auth link, exactly like the launch did.
      const codexHome = join(agentDir, 'codex-home-v2');
      const env = (await pathExists(codexHome)) ? { CODEX_HOME: codexHome } : undefined;
      return {
        ok: true,
        // No -m/-s/-a: those would change the thread's settings on attach.
        // The update check would block the pane on a modal before attaching.
        argv: [binary, 'resume', '-c', 'check_for_update_on_startup=false', '--remote', expectedEndpoint, threadId],
        cwd: owner.cwd,
        ...(env ? { env } : {}),
        fingerprint: `${generation}:${threadId}:${navigationEpoch}`,
      };
    },
  };
}
