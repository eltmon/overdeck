/**
 * Pieces of Fly machine provisioning shared by `provision.ts` and the steps it
 * calls (PAN-4652 WI-7; split out for PAN-4296 so `codex-auth.ts` can use them
 * without importing `provision.ts`, which imports it): the typed error and its
 * HTTP statuses, the detached-command wrapper, and the poll loop.
 * `provision.ts` re-exports all of them, so its importers are unchanged.
 */
import { isFlyAuthError, flyTokenRejectedMessage } from '../../remote/fly-api.js';
import { shellQuote } from '../../remote/remote-tmux.js';

export type FlyMachineErrorCode =
  | 'bad-request'
  | 'credentials-failed'
  | 'remote-disabled'
  | 'no-fly-token'
  | 'fly-token-rejected'
  | 'cap-reached'
  | 'harness-unsupported'
  | 'version-mismatch'
  | 'server-not-ready'
  | 'pairing-failed'
  | 'unreachable'
  | 'project-failed'
  | 'workspace-failed'
  | 'conversation-failed';

/** HTTP status of each Fly machine error. */
export const FLY_MACHINE_ERROR_STATUS: Record<FlyMachineErrorCode, number> = {
  'bad-request': 400,
  'credentials-failed': 424,
  'remote-disabled': 409,
  'no-fly-token': 424,
  'fly-token-rejected': 424,
  'cap-reached': 409,
  'harness-unsupported': 400,
  'version-mismatch': 409,
  'server-not-ready': 502,
  'pairing-failed': 502,
  'unreachable': 502,
  'project-failed': 502,
  'workspace-failed': 502,
  'conversation-failed': 502,
};

export class FlyMachineError extends Error {
  constructor(
    readonly code: FlyMachineErrorCode,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'FlyMachineError';
  }
}

/** How long a detached `npm install -g` on the VM is polled for. */
export const INSTALL_POLL = { intervalMs: 5_000, limitMs: 5 * 60_000 };

/**
 * Probe every `intervalMs` until it returns true or `limitMs` passes. A throwing probe
 * counts as false, except a rejected Fly token, which no later probe can fix (PAN-4748).
 */
export async function pollUntil(
  deps: { now: () => number; sleep: (ms: number) => Promise<void> },
  poll: { intervalMs: number; limitMs: number },
  probe: () => Promise<boolean>,
): Promise<boolean> {
  const deadline = deps.now() + poll.limitMs;
  for (;;) {
    const done = await probe().catch((error: unknown) => {
      if (isFlyAuthError(error)) {
        throw new FlyMachineError('fly-token-rejected', flyTokenRejectedMessage(error), { status: error.statusCode });
      }
      return false;
    });
    if (done) return true;
    if (deps.now() + poll.intervalMs > deadline) return false;
    await deps.sleep(poll.intervalMs);
  }
}

/** Run `script` detached on the VM so it outlives the 60 s exec deadline. */
export function detached(script: string): string {
  return `setsid nohup sh -c ${shellQuote(script)} > /dev/null 2>&1 < /dev/null &`;
}
