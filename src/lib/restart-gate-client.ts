/**
 * Restart-gate client (PAN-3729).
 *
 * A *voluntary* dashboard restart — one asked for by `pan reload`, bare
 * `pan restart`, or the post-merge deploy script — must never interrupt the
 * operator mid-work. Every voluntary requester registers itself with the
 * dashboard's restart gate and then blocks until the operator approves, either
 * by clicking "Restart now" in the dashboard banner or by running
 * `pan restart --now`. There is no approval timeout.
 *
 * One approval satisfies every request that was pending at that moment: exactly
 * one requester is granted the claim and performs the restart, and every other
 * requester in that epoch skips its own restart step.
 *
 * *Involuntary* restarts — crash recovery, watchdog respawn, supervisor
 * restart-on-death — are never gated and never call this module.
 *
 * Compat rule: if a gate endpoint answers 404, or the dashboard health endpoint
 * fails continuously for 60s, the requester proceeds ungated with its normal
 * restart. That is what lets this feature deploy through a server build that
 * predates the gate, and a dashboard that is not answering has no live operator
 * work to interrupt.
 *
 * The wire contract (paths, JSON shapes, 5s poll interval) is pinned by the
 * PAN-3729 spec and shared with the dashboard-side gate service. Do not change
 * shapes here without changing them there.
 */

import { getDashboardApiUrlSync } from './config.js';

/** Poll/TTL-refresh cadence. The server expires a request not refreshed for 20s. */
export const RESTART_GATE_POLL_INTERVAL_MS = 5_000;
/** Continuous health-endpoint failure after which the requester proceeds ungated. */
export const RESTART_GATE_UNHEALTHY_FALLBACK_MS = 60_000;
/** How often the blocked requester reprints a short "still waiting" heartbeat. */
const WAIT_HEARTBEAT_MS = 60_000;
/** Per-call HTTP budget while polling — short, because the loop retries. */
const GATE_CALL_TIMEOUT_MS = 5_000;
/** Per-call HTTP budget on the `--now` bypass, which must never wait on the gate. */
const GATE_BYPASS_TIMEOUT_MS = 3_000;

/**
 * Set on any `pan restart` child spawned by a requester that has already
 * cleared the gate for that restart — the post-merge deploy script does exactly
 * that. Without it the child registers a second request and waits for a second
 * approval, so one deploy would cost the operator two clicks.
 */
export const RESTART_GATE_CLAIMED_ENV = 'OVERDECK_RESTART_GATE_CLAIMED';

export type RestartGateKind = 'deploy' | 'reload' | 'restart';
export type RestartGateRequestStatus = 'pending' | 'approved' | 'claimed' | 'satisfied';

export interface RestartGateRequest {
  readonly requesterId: string;
  readonly kind: RestartGateKind;
  readonly reason: string;
  readonly builtSha?: string;
}

export interface RestartGatePollResponse {
  readonly status: RestartGateRequestStatus;
  readonly mayClaim: boolean;
  readonly pendingCount: number;
}

export interface RestartGateApproveResponse {
  readonly approved: boolean;
  readonly pendingCount: number;
}

export interface RestartGatePendingEntry {
  readonly requesterId: string;
  readonly kind: string;
  readonly reason: string;
  readonly builtSha?: string;
  readonly requestedAt: string;
}

export interface RestartGateSnapshot {
  readonly status: 'idle' | 'pending' | 'approved' | 'claimed';
  readonly pending: readonly RestartGatePendingEntry[];
}

export interface RestartGateHttpOptions {
  /** Dashboard API base URL. Defaults to the resolved internal loopback URL. */
  readonly dashboardUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface RestartGateWaitOptions extends RestartGateHttpOptions {
  /** Where operator-facing wait messages go. Defaults to stdout. */
  readonly log?: (message: string) => void;
  readonly pollIntervalMs?: number;
  readonly unhealthyFallbackMs?: number;
}

export type RestartGateOutcome =
  /** Perform the restart: this requester holds the claim, or the gate is absent. */
  | { readonly proceed: true; readonly reason: 'claimed' | 'ungated'; readonly detail: string }
  /** Skip the restart: another requester's approved restart already covered this one. */
  | { readonly proceed: false; readonly reason: 'satisfied'; readonly detail: string };

/**
 * One gate HTTP call. `absent` means the endpoint 404s (a server build without
 * the gate); `unavailable` means the server did not answer usefully and the
 * caller decides whether to retry or fall back.
 */
type GateCallResult<T> =
  | { readonly kind: 'ok'; readonly payload: T }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unavailable'; readonly detail: string };

function gateBaseUrl(options: RestartGateHttpOptions): string {
  return options.dashboardUrl ?? getDashboardApiUrlSync();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function gatePost<T>(
  path: string,
  body: unknown,
  options: RestartGateHttpOptions,
  timeoutMs: number,
): Promise<GateCallResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(`${gateBaseUrl(options)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (response.status === 404) return { kind: 'absent' };
    if (!response.ok) return { kind: 'unavailable', detail: `${path} answered HTTP ${response.status}` };
    return { kind: 'ok', payload: await response.json() as T };
  } catch (error) {
    return { kind: 'unavailable', detail: `${path} failed: ${(error as Error)?.message || String(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function gateGet<T>(
  path: string,
  options: RestartGateHttpOptions,
  timeoutMs: number,
): Promise<GateCallResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(`${gateBaseUrl(options)}${path}`, {
      signal: controller.signal,
    });
    if (response.status === 404) return { kind: 'absent' };
    if (!response.ok) return { kind: 'unavailable', detail: `${path} answered HTTP ${response.status}` };
    return { kind: 'ok', payload: await response.json() as T };
  } catch (error) {
    return { kind: 'unavailable', detail: `${path} failed: ${(error as Error)?.message || String(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

/** True when the dashboard answers its health endpoint right now. */
async function dashboardIsHealthy(options: RestartGateHttpOptions): Promise<boolean> {
  const result = await gateGet<unknown>('/api/health', options, GATE_CALL_TIMEOUT_MS);
  return result.kind === 'ok';
}

/** Stable id for one requester invocation, e.g. `deploy:PAN-3724:41288`. */
export function restartGateRequesterId(
  kind: RestartGateKind,
  scope?: string,
  pid: number = process.pid,
): string {
  return scope ? `${kind}:${scope}:${pid}` : `${kind}:${pid}`;
}

/**
 * The operator-facing wait message. It has to stand alone: an operator may read
 * it in a log file days later, or in a terminal they did not start, so it names
 * what the gate is and both ways to release it.
 */
export function restartGateWaitLines(request: RestartGateRequest, pendingCount: number): string[] {
  const others = Math.max(0, pendingCount - 1);
  const company = others === 1
    ? ' One other restart request is waiting too, and a single approval releases both.'
    : others > 1
      ? ` ${others} other restart requests are waiting too, and a single approval releases all of them.`
      : '';
  return [
    'Waiting for operator approval before restarting the dashboard.',
    `A dashboard restart asked for by a deploy or a CLI command now waits for you, so it cannot interrupt live work. This request is "${request.reason}".${company}`,
    'To let it run, either click "Restart now" in the banner at the top of any dashboard view, or run `pan restart --now` in a terminal. Nothing else is needed, and there is no timeout — this command waits until you do one of them.',
  ];
}

/**
 * Register this requester with the gate and block until the operator approves.
 *
 * Resolves `{ proceed: true }` when the caller must perform the restart (it won
 * the claim, or the gate is unavailable and the compat rule applies) and
 * `{ proceed: false }` when another approved requester's restart already
 * satisfied this one and the caller must skip its restart step.
 */
export async function waitForRestartApproval(
  request: RestartGateRequest,
  options: RestartGateWaitOptions = {},
): Promise<RestartGateOutcome> {
  const log = options.log ?? ((message: string) => console.log(message));
  const pollIntervalMs = options.pollIntervalMs ?? RESTART_GATE_POLL_INTERVAL_MS;
  const unhealthyFallbackMs = options.unhealthyFallbackMs ?? RESTART_GATE_UNHEALTHY_FALLBACK_MS;

  const ungated = (detail: string): RestartGateOutcome => {
    log(`Restarting without waiting for approval — ${detail}.`);
    return { proceed: true, reason: 'ungated', detail };
  };

  let unhealthySince: number | null = null;
  let announced = false;
  let lastHeartbeatAt = Date.now();
  const waitStartedAt = Date.now();

  while (true) {
    const poll = await gatePost<RestartGatePollResponse>(
      '/api/restart-gate/requests',
      request,
      options,
      GATE_CALL_TIMEOUT_MS,
    );

    if (poll.kind === 'absent') {
      return ungated('this dashboard build has no restart gate, so there is nothing to approve');
    }

    if (poll.kind === 'unavailable') {
      if (await dashboardIsHealthy(options)) {
        unhealthySince = null;
      } else {
        unhealthySince ??= Date.now();
        const downForMs = Date.now() - unhealthySince;
        if (downForMs >= unhealthyFallbackMs) {
          return ungated(
            `the dashboard has not answered its health endpoint for ${Math.round(downForMs / 1000)}s, so there is no live session to interrupt`,
          );
        }
      }
      await sleep(pollIntervalMs);
      continue;
    }

    unhealthySince = null;

    if (poll.payload.status === 'satisfied') {
      return {
        proceed: false,
        reason: 'satisfied',
        detail: 'another approved requester already restarted the dashboard',
      };
    }

    if (poll.payload.status === 'approved' && poll.payload.mayClaim) {
      const claim = await gatePost<{ granted?: boolean }>(
        '/api/restart-gate/claim',
        { requesterId: request.requesterId },
        options,
        GATE_CALL_TIMEOUT_MS,
      );
      if (claim.kind === 'absent') {
        return ungated('this dashboard build has no restart gate, so there is nothing to approve');
      }
      if (claim.kind === 'ok' && claim.payload.granted === true) {
        log('Operator approved the restart — proceeding.');
        return { proceed: true, reason: 'claimed', detail: 'operator approved and this requester holds the claim' };
      }
      // Another requester holds the claim for this approval. Keep polling: its
      // restart satisfies this request, and a lapsed claim frees the next poll.
    }

    if (!announced) {
      announced = true;
      for (const line of restartGateWaitLines(request, poll.payload.pendingCount)) log(line);
    } else if (Date.now() - lastHeartbeatAt >= WAIT_HEARTBEAT_MS) {
      lastHeartbeatAt = Date.now();
      const waitedMin = Math.round((Date.now() - waitStartedAt) / 60_000);
      log(`Still waiting for operator approval of the dashboard restart (${waitedMin}m so far).`);
    }

    await sleep(pollIntervalMs);
  }
}

/**
 * Register one request without waiting. Used by the `pan restart --now` bypass,
 * which must place itself in the epoch it is about to approve. Returns null when
 * the gate is absent or unreachable — the bypass then just restarts.
 */
export async function registerRestartGateRequest(
  request: RestartGateRequest,
  options: RestartGateHttpOptions = {},
): Promise<RestartGatePollResponse | null> {
  const result = await gatePost<RestartGatePollResponse>(
    '/api/restart-gate/requests',
    request,
    options,
    GATE_BYPASS_TIMEOUT_MS,
  );
  return result.kind === 'ok' ? result.payload : null;
}

/**
 * Approve every currently pending request. This is the operator surface behind
 * the dashboard banner button and `pan restart approve` / `pan restart --now`.
 * Returns null when the gate is absent or unreachable.
 */
export async function approveRestartGate(
  options: RestartGateHttpOptions = {},
): Promise<RestartGateApproveResponse | null> {
  const result = await gatePost<RestartGateApproveResponse>(
    '/api/restart-gate/approve',
    {},
    options,
    GATE_BYPASS_TIMEOUT_MS,
  );
  return result.kind === 'ok' ? result.payload : null;
}

/**
 * Take the claim for the current epoch without polling. Returns true only when
 * this requester is the one that must perform the restart; null means the gate
 * is absent or unreachable.
 */
export async function claimRestartGate(
  requesterId: string,
  options: RestartGateHttpOptions = {},
): Promise<boolean | null> {
  const result = await gatePost<{ granted?: boolean }>(
    '/api/restart-gate/claim',
    { requesterId },
    options,
    GATE_BYPASS_TIMEOUT_MS,
  );
  return result.kind === 'ok' ? result.payload.granted === true : null;
}

/** Read the gate for display. Returns null when the gate is absent or unreachable. */
export async function readRestartGate(
  options: RestartGateHttpOptions = {},
  timeoutMs = GATE_BYPASS_TIMEOUT_MS,
): Promise<RestartGateSnapshot | null> {
  const result = await gateGet<RestartGateSnapshot>('/api/restart-gate', options, timeoutMs);
  return result.kind === 'ok' ? result.payload : null;
}
