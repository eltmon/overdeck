import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { request as httpRequest } from 'node:http';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { Effect } from 'effect';
import type { RuntimeName } from '../runtimes/types.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import type { AgentState } from '../agents.js';
import {
  normalizeAgentId,
  getAgentState,
  saveAgentState,
  getAgentDir,
  waitForPromptReady,
  SESSION_EXITED_BEFORE_KICKOFF,
} from '../agents.js';
import { getAgentRuntimeState } from './runtime-state.js';
import { isPaneDead, sendKeys, sessionExists } from '../tmux.js';
import { completeKeyedSubmit, sendKeysDedup } from '../tmux-dedup.js';
import { BRIDGE_TOKEN_HEADER, readBridgeTokenSync } from '../bridge-token.js';
import { PTY_TOKEN_HEADER, readPtyToken } from '../pty-token.js';
import {
  SUPERVISOR_CLIENT_MARGIN_MS,
  supervisorInjectionBudgetMs,
} from '../channels/injection-budget.js';
import {
  captureTranscriptUserRecordSnapshot,
  hasNewTranscriptUserRecord,
  type TranscriptUserRecordSnapshot,
} from '../transcript-landing.js';

export type DeliveryResult = {
  ok: boolean;
  path: 'app-server' | 'acp' | 'supervisor' | 'channels' | 'tmux' | 'pi' | 'codex';
  failure?: string;
  /** True when the delivery was suppressed by the keyed dedup record — the
   * side effect already happened on an earlier call with the same key. */
  deduplicated?: boolean;
};

export interface DeliverAgentMessageOptions {
  /**
   * Idempotency key (PAN-2997). Keyed deliveries are deduplicated by the
   * crash-independent delivery component, not by dashboard-side state: the
   * PTY supervisor reserves the key synchronously before injecting and
   * completes it only after the content-plus-Enter injection succeeds, and
   * the tmux fallback keeps a two-phase (pending/terminal) per-session marker
   * owned by the tmux server across the whole paste-settle-submit
   * transaction. A dashboard crash anywhere in those flows can therefore
   * neither lose nor duplicate a keyed message.
   *
   * Keyed payloads are ONLY routed through those two tiers. The
   * app-server/ACP/Channels tiers acknowledge receipt without enforcing the
   * key, so they are skipped in auto mode and rejected when requested
   * explicitly — a crash after their visible side effect but before the
   * caller's acknowledgment would otherwise replay the wake.
   */
  dedupKey?: string;
}

/**
 * PAN-1988: resume / feedback / continue delivery must be RESILIENT. When an agent is pinned to
 * the strict 'supervisor' transport — which throws with NO fallback when its echo-confirmation
 * fails (the recurring "input echo confirmation failed" that left review feedback undelivered to
 * the work agent every round) — deliver via 'auto' instead, so a supervisor failure falls back to
 * the proven tmux paste-buffer and the message still lands. Other explicit methods
 * ('tmux'/'channels'/'auto') are preserved. The strict 'supervisor' contract itself (PAN-1769) is
 * intentionally left intact in deliverAgentMessage for callers that opt into it directly.
 */
export function resilientDeliveryMethod(
  method: 'auto' | 'supervisor' | 'channels' | 'tmux' | undefined,
): 'auto' | 'supervisor' | 'channels' | 'tmux' | undefined {
  return method === 'supervisor' ? 'auto' : method;
}

/**
 * Resolve OVERDECK_HOME — same fallback semantics as overdeck-bridge.
 */
function overdeckHomeForSockets(): string {
  return process.env.OVERDECK_HOME ?? join(homedir(), '.overdeck');
}

function overdeckHomeForChannels(): string {
  return overdeckHomeForSockets();
}

/**
 * Append a delivery-event log line to the per-agent bridge log. Best-effort.
 */
async function appendChannelDeliveryLog(
  agentId: string,
  entry: {
    path: 'app-server' | 'acp' | 'supervisor' | 'channel' | 'tmux';
    reason?: string;
    caller?: string;
    appServer?: string;
    acp?: string;
    'pty-supervisor'?: string;
    channels?: string;
  },
): Promise<void> {
  try {
    const home = overdeckHomeForSockets();
    const dir = join(home, 'logs');
    await (await import('fs/promises')).mkdir(dir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      agentId,
      ...entry,
    });
    await (await import('fs/promises')).appendFile(
      join(dir, `bridge-${agentId}.log`),
      `${line}\n`,
      'utf-8',
    );
  } catch {
    // Non-critical
  }
}

function readSocketTokenSync(agentId: string, filename: string): string | null {
  try {
    const tokenPath = join(overdeckHomeForSockets(), 'agents', agentId, filename);
    if (!existsSync(tokenPath)) return null;
    const token = readFileSync(tokenPath, 'utf-8').trim();
    return token || null;
  } catch {
    return null;
  }
}

function readAppServerTokenSync(agentId: string): string | null {
  return readSocketTokenSync(agentId, 'appserver-token');
}

function readAcpTokenSync(agentId: string): string | null {
  return readSocketTokenSync(agentId, 'acp-token');
}

/**
 * A non-2xx RESPONSE from a protocol host. The host answered, so the outcome
 * is definitive: for a keyed supervisor request a 502 means the injection
 * failed and was purged and the key was never recorded — unlike a lost
 * response, this is safe to fall back from.
 */
export class SocketPostStatusError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SocketPostStatusError';
    this.status = status;
  }
}

/**
 * Thrown when a keyed delivery's outcome is UNKNOWN: the keyed supervisor
 * request was sent but no response came back (timeout, reset, dropped
 * connection), so the injection may have completed. Crossing to the tmux
 * tier with the same key would risk a second visible delivery, because the
 * supervisor and tmux keep INDEPENDENT dedup stores. The caller's recovery
 * must retry the same key at the same tier — the supervisor's in-flight
 * reservation and delivered set deduplicate the retry (PAN-2997 cycle 8).
 */
export class AmbiguousKeyedDeliveryError extends Error {
  constructor(agentId: string, caller: string, reason: string) {
    super(
      `MessageDeliveryFailed: ambiguous keyed delivery for ${agentId} (${caller}): ${reason} — ` +
      'the supervisor may have completed the injection; NOT crossing to the tmux tier with the same key',
    );
    this.name = 'AmbiguousKeyedDeliveryError';
  }
}

/**
 * Pure, exported for tests (PAN-1837): classify a keyed supervisor POST
 * failure. Connect-phase errors (refused / socket path gone / permission)
 * fire before any bytes reach the supervisor, so the injection definitively
 * did NOT happen — a stale socket file left by a crashed supervisor refuses
 * every connection forever, and treating that as ambiguous strands keyed
 * deliveries permanently. A received non-2xx means the supervisor answered
 * and recorded no key. Everything else (timeout, reset mid-response) is
 * genuinely ambiguous.
 */
export function keyedSupervisorFailureKind(err: unknown): 'connect-failed' | 'status' | 'ambiguous' {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOENT' || code === 'EACCES') return 'connect-failed';
  if (err instanceof SocketPostStatusError) return 'status';
  return 'ambiguous';
}

/**
 * POST a JSON body to a Unix-domain socket using node:net + a hand-rolled
 * minimal HTTP/1.1 request. Resolves on a 200-class response, rejects on any
 * error including socket-not-found, connection refused, an optional client
 * timeout, or non-2xx status. Kept tiny on purpose because this is a hot path
 * and these local protocol hosts need only a narrow HTTP client.
 */
async function postUnixSocketJson(
  socketPath: string,
  body: unknown,
  timeoutMs: number | undefined,
  token: string,
  tokenHeader: string = BRIDGE_TOKEN_HEADER,
): Promise<{ status: number; body: string }> {
  const payload = JSON.stringify(body);

  return new Promise((resolveCall, reject) => {
    // Settle exactly once. Without this guard a late idle-timeout or
    // post-response socket error could reject after the response already
    // resolved the promise.
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const clearClientTimeout = () => {
      if (timeout) clearTimeout(timeout);
      timeout = undefined;
    };
    const finishOk = (value: { status: number; body: string }) => {
      if (settled) return;
      settled = true;
      clearClientTimeout();
      resolveCall(value);
    };
    const finishErr = (err: Error) => {
      if (settled) return;
      settled = true;
      clearClientTimeout();
      reject(err);
    };

    const req = httpRequest(
      {
        socketPath,
        path: '/',
        method: 'POST',
        agent: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          [tokenHeader]: token,
        },
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            finishOk({ status, body: responseBody });
            return;
          }
          finishErr(new SocketPostStatusError(status, `socket POST: status ${status}: ${responseBody.slice(0, 100)}`));
        });
      },
    );

    if (timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        req.destroy(new Error('socket POST timeout'));
      }, timeoutMs);
      timeout.unref?.();
    }
    req.on('error', (err: Error) => {
      finishErr(err);
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Single delivery primitive for orchestrator-to-work-agent messages. Auto mode
 * tries persistent protocol hosts, the PTY supervisor socket, legacy Channels
 * MCP, then tmux. Explicit socket methods and ACP targets are strict: ACP prompts
 * cannot fall back to terminal injection because only session/prompt reaches the agent.
 */
export async function deliverAgentMessage(
  agentId: string,
  message: string,
  caller: string = 'unknown',
  deliveryMethod?: 'auto' | 'supervisor' | 'channels' | 'tmux',
  opts: DeliverAgentMessageOptions = {},
): Promise<DeliveryResult> {
  const normalizedId = normalizeAgentId(agentId);
  const dedupKey = opts.dedupKey;

  let channelsEnabled = false;
  let resolvedMethod = deliveryMethod;
  let state: AgentState | null = null;
  try {
    state = await Effect.runPromise(getAgentState(normalizedId));
    channelsEnabled = Boolean(state?.channelsEnabled);
    resolvedMethod ??= state?.deliveryMethod ?? 'auto';
  } catch {
    resolvedMethod ??= 'auto';
  }

  const isAcpTarget = state?.harness === 'acp';
  if (isAcpTarget && resolvedMethod !== 'auto') {
    throw new Error(
      `MessageDeliveryFailed: ACP delivery failed for ${normalizedId} (${caller}): ACP requires authenticated host RPC delivery`,
    );
  }

  // Keyed deliveries take a dedicated, narrower cascade: only the tiers whose
  // crash-independent component enforces the key across the complete side
  // effect. Everything below this branch is the unkeyed cascade.
  if (dedupKey !== undefined) {
    return deliverKeyedAgentMessage(normalizedId, message, caller, resolvedMethod ?? 'auto', isAcpTarget, dedupKey);
  }

  if (resolvedMethod === 'tmux') {
    await assertTmuxTargetCanReceive(normalizedId, caller);
    await Effect.runPromise(sendKeys(normalizedId, message));
    return { ok: true, path: 'tmux' };
  }

  let appServerFailure: string | undefined;
  if (resolvedMethod === 'auto' && !isAcpTarget) {
    const appServerSocketPath = join(overdeckHomeForSockets(), 'sockets', `appserver-${normalizedId}.sock`);
    if (existsSync(appServerSocketPath)) {
      const appServerToken = readAppServerTokenSync(normalizedId);
      if (!appServerToken) {
        appServerFailure = 'appserver-token-missing';
      } else {
        try {
          const appServerBody: Record<string, unknown> = { op: 'message', content: message, meta: { caller } };
          if (state?.model) appServerBody.model = state.model;
          await postUnixSocketJson(
            appServerSocketPath,
            appServerBody,
            8_000,
            appServerToken,
          );
          await appendChannelDeliveryLog(normalizedId, { path: 'app-server', caller });
          return { ok: true, path: 'app-server' };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          appServerFailure = `socket-post-failed: ${reason}`;
        }
      }
    }
  }

  let acpFailure: string | undefined;
  if (resolvedMethod === 'auto') {
    const acpSocketPath = join(overdeckHomeForSockets(), 'sockets', `acp-${normalizedId}.sock`);
    const acpSocketExists = existsSync(acpSocketPath);
    if (isAcpTarget || acpSocketExists) {
      const acpToken = readAcpTokenSync(normalizedId);
      if (!acpSocketExists) {
        acpFailure = 'socket-missing';
      } else if (!acpToken) {
        acpFailure = 'acp-token-missing';
      } else {
        try {
          // The ACP host acknowledges queue acceptance rather than model-turn
          // completion, so this bounds a wedged local host without constraining
          // how long the provider may take to finish the queued turn.
          await postUnixSocketJson(
            acpSocketPath,
            { op: 'message', content: message, meta: { caller } },
            8_000,
            acpToken,
          );
          await appendChannelDeliveryLog(normalizedId, { path: 'acp', caller });
          return { ok: true, path: 'acp' };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          acpFailure = `socket-post-failed: ${reason}`;
        }
      }

      // ACP prompts only enter the agent through session/prompt on the host RPC
      // socket. Terminal fallbacks can accept pasted text while bypassing the ACP
      // session entirely, so an ACP transport failure must remain a loud failure.
      await appendChannelDeliveryLog(normalizedId, {
        path: 'acp',
        reason: acpFailure,
        caller,
      });
      throw new Error(
        `MessageDeliveryFailed: ACP delivery failed for ${normalizedId} (${caller}): ${acpFailure}`,
      );
    }
  }

  let supervisorFailure: string | undefined;
  if (resolvedMethod === 'auto' || resolvedMethod === 'supervisor') {
    const supervisorSocketPath = join(overdeckHomeForSockets(), 'sockets', `pty-${normalizedId}.sock`);
    const ptyToken = await readPtyToken(normalizedId);
    if (!existsSync(supervisorSocketPath)) {
      supervisorFailure = 'socket-missing';
    } else if (!ptyToken) {
      supervisorFailure = 'pty-token-missing';
    } else {
      try {
        // The client deadline must remain above the supervisor's payload-aware
        // worst-case injection budget. Abandoning the POST mid-injection would
        // fire the tmux fallback while the supervisor is still writing and
        // re-create the duplicate-writer race PAN-1769 fixed.
        const supervisorResponse = await postUnixSocketJson(
          supervisorSocketPath,
          { content: message, meta: { caller } },
          supervisorInjectionBudgetMs(message.length) + SUPERVISOR_CLIENT_MARGIN_MS,
          ptyToken,
          PTY_TOKEN_HEADER,
        );
        await appendChannelDeliveryLog(normalizedId, { path: 'supervisor', caller });
        return { ok: true, path: 'supervisor' };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        supervisorFailure = `socket-post-failed: ${reason}`;
      }
    }

    if (resolvedMethod === 'supervisor') {
      throw new Error(`MessageDeliveryFailed: PTY supervisor delivery failed for ${normalizedId} (${caller}): ${supervisorFailure}`);
    }
  }

  if (resolvedMethod === 'auto' || resolvedMethod === 'channels') {
    let channelFailure: string | undefined;
    const socketPath = join(overdeckHomeForSockets(), 'sockets', `agent-${normalizedId}.sock`);
    if (!channelsEnabled) {
      channelFailure = 'channels-disabled';
    } else if (!existsSync(socketPath)) {
      channelFailure = 'socket-missing';
    } else {
      const bridgeToken = readBridgeTokenSync(normalizedId);
      if (!bridgeToken) {
        channelFailure = 'bridge-token-missing';
      } else {
        try {
          await postUnixSocketJson(
            socketPath,
            { content: message, meta: { caller } },
            2000,
            bridgeToken,
          );
          await appendChannelDeliveryLog(normalizedId, {
            path: 'channel',
            caller,
            ...(supervisorFailure ? { 'pty-supervisor': supervisorFailure } : {}),
          });
          return { ok: true, path: 'channels' };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          channelFailure = `socket-post-failed: ${reason}`;
        }
      }
    }

    if (resolvedMethod === 'channels') {
      throw new Error(`MessageDeliveryFailed: Channels delivery failed for ${normalizedId} (${caller}): ${channelFailure}`);
    }

    await appendChannelDeliveryLog(normalizedId, {
      path: 'tmux',
      reason: channelFailure,
      caller,
      ...(appServerFailure ? { appServer: appServerFailure } : {}),
      ...(acpFailure ? { acp: acpFailure } : {}),
      ...(supervisorFailure ? { 'pty-supervisor': supervisorFailure } : {}),
      ...(channelFailure ? { channels: channelFailure } : {}),
    });
    await assertTmuxTargetCanReceive(normalizedId, caller);
    await Effect.runPromise(sendKeys(normalizedId, message));
    return { ok: true, path: 'tmux', failure: channelFailure ?? supervisorFailure };
  }

  await assertTmuxTargetCanReceive(normalizedId, caller);
  await Effect.runPromise(sendKeys(normalizedId, message));
  return { ok: true, path: 'tmux' };
}

/**
 * Keyed delivery cascade (PAN-2997). Only two tiers may carry a keyed
 * message, because only their crash-independent components enforce the key
 * across the COMPLETE visible side effect:
 *
 * - the PTY supervisor reserves the key synchronously (closing the concurrent
 *   same-key race) and completes it only after its single-request
 *   content-plus-Enter injection succeeds; and
 * - the tmux fallback keeps two-phase pending/terminal session markers owned
 *   by the tmux server across paste, settle, and submit.
 *
 * App-server, ACP, and Channels acknowledge receipt without enforcing the
 * key, so they are never used for keyed payloads: a dashboard crash after
 * their side effect but before the caller's acknowledgment would replay the
 * wake. Explicitly requesting one of them with a key is a loud error, not a
 * silent downgrade.
 */
async function deliverKeyedAgentMessage(
  normalizedId: string,
  message: string,
  caller: string,
  resolvedMethod: 'auto' | 'supervisor' | 'channels' | 'tmux',
  isAcpTarget: boolean,
  dedupKey: string,
): Promise<DeliveryResult> {
  if (isAcpTarget) {
    throw new Error(
      `MessageDeliveryFailed: keyed delivery failed for ${normalizedId} (${caller}): the ACP tier cannot enforce a dedup key`,
    );
  }
  if (resolvedMethod === 'channels') {
    throw new Error(
      `MessageDeliveryFailed: keyed delivery failed for ${normalizedId} (${caller}): the Channels tier cannot enforce a dedup key`,
    );
  }
  if (resolvedMethod === 'tmux') {
    return deliverKeyedViaTmux(normalizedId, message, caller, dedupKey);
  }

  let supervisorFailure: string | undefined;
  const supervisorSocketPath = join(overdeckHomeForSockets(), 'sockets', `pty-${normalizedId}.sock`);
  const ptyToken = await readPtyToken(normalizedId);
  if (!existsSync(supervisorSocketPath)) {
    supervisorFailure = 'socket-missing';
  } else if (!ptyToken) {
    supervisorFailure = 'pty-token-missing';
  } else {
    try {
      // The client deadline must remain above the supervisor's payload-aware
      // worst-case injection budget. Abandoning the POST mid-injection would
      // fire the tmux fallback while the supervisor is still writing and
      // re-create the duplicate-writer race PAN-1769 fixed.
      const supervisorResponse = await postUnixSocketJson(
        supervisorSocketPath,
        { content: message, meta: { caller }, dedupKey },
        supervisorInjectionBudgetMs(message.length) + SUPERVISOR_CLIENT_MARGIN_MS,
        ptyToken,
        PTY_TOKEN_HEADER,
      );
      await appendChannelDeliveryLog(normalizedId, { path: 'supervisor', caller });
      let deduplicated = false;
      try {
        deduplicated = (JSON.parse(supervisorResponse.body) as { deduplicated?: boolean }).deduplicated === true;
      } catch {
        // Legacy supervisor build without dedup support — treat as delivered.
      }
      return { ok: true, path: 'supervisor', deduplicated };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const kind = keyedSupervisorFailureKind(err);
      if (kind === 'ambiguous') {
        // AMBIGUOUS (cycle 8): the request was sent but no response came back,
        // so the supervisor may have completed the injection. The tmux tier
        // keeps an INDEPENDENT key store, so crossing to it with the same key
        // could submit a second visible wake. Stay with the same delivery
        // owner: the caller's recovery retries the same key at the supervisor,
        // whose in-flight reservation/delivered set deduplicates the retry.
        throw new AmbiguousKeyedDeliveryError(normalizedId, caller, reason);
      }
      supervisorFailure = `${kind === 'connect-failed' ? 'socket-connect-failed' : 'socket-post-failed'}: ${reason}`;
    }
  }

  if (resolvedMethod === 'supervisor') {
    throw new Error(`MessageDeliveryFailed: PTY supervisor delivery failed for ${normalizedId} (${caller}): ${supervisorFailure}`);
  }

  await appendChannelDeliveryLog(normalizedId, { path: 'tmux', reason: supervisorFailure, caller });
  const result = await deliverKeyedViaTmux(normalizedId, message, caller, dedupKey);
  return { ...result, failure: supervisorFailure };
}

/**
 * Keyed tmux delivery: paste under the two-phase marker protocol, then
 * complete the submit. Pending claims carry a strictly-read payload state:
 * unverified requires active-composer proof, while enter-attempted preserves
 * no-repaste rollback recovery. Unset legacy/unknown states fail closed. A
 * terminal marker suppresses the replay entirely.
 */
async function deliverKeyedViaTmux(
  normalizedId: string,
  message: string,
  caller: string,
  dedupKey: string,
): Promise<DeliveryResult> {
  await assertTmuxTargetCanReceive(normalizedId, caller);
  const phase = await sendKeysDedup(normalizedId, message, dedupKey, caller);
  if (phase !== 'deduplicated') {
    await completeKeyedSubmit(normalizedId, dedupKey);
  }
  return { ok: true, path: 'tmux', deduplicated: phase === 'deduplicated' };
}

/**
 * PAN-2228: loud failure semantics for the tmux tier. `tmux send-keys` into a
 * session whose pane process has EXITED (a remain-on-exit corpse) succeeds at the
 * tmux level while the message lands nowhere — the zombie-kickoff failure mode
 * (PAN-2179): callers saw ok:true, treated feedback as delivered, and the issue
 * silently stalled. Verify a live pane BEFORE pasting, and throw the same
 * MessageDeliveryFailed shape the strict socket methods use so every caller's
 * existing failure path fires instead of a false success. (A fully MISSING
 * session needs no check here — tmux send-keys itself errors loudly on it.)
 */
async function assertTmuxTargetCanReceive(normalizedId: string, caller: string): Promise<void> {
  const alive = await Effect.runPromise(sessionExists(normalizedId));
  if (!alive) return; // send-keys will fail loudly on its own for a missing session
  const paneDead = await Effect.runPromise(isPaneDead(normalizedId));
  if (paneDead) {
    throw new Error(`MessageDeliveryFailed: tmux delivery failed for ${normalizedId} (${caller}): pane-dead (session alive but the harness process has exited)`);
  }
}

// 3s was too tight on hosts where SessionStart hooks (memory RAG injection,
// Subspace + Overdeck both) delay the first transcript flush past the window —
// kickoff confirmation then killed healthy agents whose user record landed
// seconds later (observed 2026-07-29, macOS). The wait returns as soon as the
// record appears, so a generous ceiling adds no latency on the happy path.
const RESUME_TRANSCRIPT_CONFIRM_TIMEOUT_MS = 30_000;
const RESUME_TRANSCRIPT_CONFIRM_INTERVAL_MS = 100;

async function waitForTranscriptUserRecordLanding(
  workspace: string,
  sessionId: string,
  before: TranscriptUserRecordSnapshot,
  snapshot: typeof captureTranscriptUserRecordSnapshot,
  timeoutMs = RESUME_TRANSCRIPT_CONFIRM_TIMEOUT_MS,
  intervalMs = RESUME_TRANSCRIPT_CONFIRM_INTERVAL_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const fromByteOffset = before.readOffset ?? before.fileSize;
  do {
    const after = await snapshot(workspace, sessionId, { fromByteOffset });
    if (hasNewTranscriptUserRecord(before, after)) return true;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);

  const after = await snapshot(workspace, sessionId, { fromByteOffset });
  return hasNewTranscriptUserRecord(before, after);
}

export async function deliverResumeMessageWithTranscriptConfirmation(args: {
  agentId: string;
  workspace: string;
  sessionId: string;
  message: string;
  caller: string;
  deliveryMethod?: 'auto' | 'supervisor' | 'channels' | 'tmux';
  timeoutMs?: number;
  intervalMs?: number;
  deliver?: typeof deliverAgentMessage;
  snapshot?: typeof captureTranscriptUserRecordSnapshot;
}): Promise<{ delivered: boolean; attempts: number; lastDelivery?: DeliveryResult }> {
  const snapshot = args.snapshot ?? captureTranscriptUserRecordSnapshot;
  const deliver = args.deliver ?? deliverAgentMessage;
  const before = await snapshot(args.workspace, args.sessionId);
  let lastDelivery: DeliveryResult | undefined;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    lastDelivery = await deliver(args.agentId, args.message, args.caller, args.deliveryMethod);
    if (lastDelivery.ok && await waitForTranscriptUserRecordLanding(
      args.workspace,
      args.sessionId,
      before,
      snapshot,
      args.timeoutMs,
      args.intervalMs,
    )) {
      return { delivered: true, attempts: attempt, lastDelivery };
    }
    if (attempt < 2) {
      console.warn(`[resumeAgent] Auto-continue prompt did not land in ${args.sessionId}; redelivering once.`);
    }
  }

  return { delivered: false, attempts: 2, ...(lastDelivery ? { lastDelivery } : {}) };
}

export async function deliverInitialPromptWithRetry(
  agentId: string,
  prompt: string,
  caller: string,
  deliveryMethod?: 'auto' | 'supervisor' | 'channels' | 'tmux',
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    settleDelayMs?: number;
    deliver?: typeof deliverAgentMessage;
    snapshot?: typeof captureTranscriptUserRecordSnapshot;
    getState?: (agentId: string) => Promise<AgentState | null>;
    waitForReady?: typeof waitForPromptReady;
    sessionExists?: (agentId: string) => Promise<boolean>;
  } = {},
): Promise<DeliveryResult> {
  const normalizedId = normalizeAgentId(agentId);
  const deliver = options.deliver ?? deliverAgentMessage;
  const snapshot = options.snapshot ?? captureTranscriptUserRecordSnapshot;
  const getState = options.getState ?? (async (id: string) => {
    try {
      return await Effect.runPromise(getAgentState(normalizeAgentId(id)));
    } catch {
      return null;
    }
  });
  const waitForReady = options.waitForReady ?? waitForPromptReady;
  const sessionExistsForAgent = options.sessionExists ?? (async (id: string) => (
    Effect.runPromise(sessionExists(normalizeAgentId(id)))
  ));

  function promptReadyTimeoutSeconds(): number {
    const raw = process.env.OVERDECK_PROMPT_READY_TIMEOUT_SECONDS;
    if (!raw) return 30;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  }

  async function resolveTranscriptConfirmationTarget(
    state: AgentState | null,
  ): Promise<{ workspace: string; sessionId: string; before: TranscriptUserRecordSnapshot } | null> {
    if (!state?.workspace || getHarnessBehavior(state.harness).transcriptKind !== 'claude-jsonl') {
      return null;
    }

    let sessionId = state.sessionId;
    if (!sessionId) {
      try {
        sessionId = (await Effect.runPromise(getAgentRuntimeState(normalizedId)))?.claudeSessionId;
      } catch {
        sessionId = undefined;
      }
    }
    if (!sessionId) return null;

    return {
      workspace: state.workspace,
      sessionId,
      before: await snapshot(state.workspace, sessionId),
    };
  }

  // PAN-1803: the codex TUI mangles a large pasted kickoff prompt — a multi-
  // thousand-character paste garbles its input and trips its "Create a plan?"
  // mode hint, so the agent never executes. Write the full brief to a file and
  // deliver a SHORT pointer instead (robust regardless of transport — the same
  // pattern that makes file-backed handoffs reliable). Only codex needs this;
  // claude-code/pi line-based input handle the full prompt fine.
  //
  // PAN-2330: keep the workspace-level .pan/kickoff.md owned by the work/strike
  // agent. Review, test, planning, flywheel, and other role prompts can share
  // the same workspace; writing those prompts to .pan/kickoff.md overwrites the
  // work agent's brief and a later resume can make it read the wrong task.
  let deliveredPrompt = prompt;
  let state = await getState(agentId);
  try {
    if (state?.harness && getHarnessBehavior(state.harness).usesCodexHome) {
      const ownsWorkspaceKickoff = state.workspace && (state.role === 'work' || state.role === 'strike');
      const kickoffPath = ownsWorkspaceKickoff
        ? join(state.workspace, '.pan', 'kickoff.md')
        : join(getAgentDir(normalizedId), 'kickoff.md');
      const displayPath = ownsWorkspaceKickoff ? '`.pan/kickoff.md`' : `\`${kickoffPath}\``;
      mkdirSync(dirname(kickoffPath), { recursive: true });
      writeFileSync(kickoffPath, prompt, 'utf-8');
      deliveredPrompt =
        `Your complete task brief has been written to ${displayPath}. `
        + 'Read that file in full now and execute it exactly — it is your full set of work '
        + 'instructions. Begin immediately and keep working autonomously until done; do not '
        + 'wait for further input.';
    }
  } catch {
    // Non-fatal: fall back to delivering the full prompt inline.
  }

  let lastFailure = 'not-attempted';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let harness: RuntimeName | undefined;
    try {
      state = await getState(agentId);
      harness = state?.harness;
    } catch {
      harness = undefined;
    }
    const readyTimeoutSeconds = promptReadyTimeoutSeconds();
    const ready = await waitForReady(agentId, harness, readyTimeoutSeconds);
    if (!ready) {
      const alive = await sessionExistsForAgent(agentId);
      lastFailure = alive ? 'ready-signal-timeout' : SESSION_EXITED_BEFORE_KICKOFF;
      const displayName = getHarnessBehavior(harness).displayName;
      console.error(`[${agentId}] ${displayName} did not become ready within ${readyTimeoutSeconds}s (kickoff attempt ${attempt}/2)`);
      if (!alive) break;
      continue;
    }

    const settleDelayMs = options.settleDelayMs ?? 500;
    if (settleDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, settleDelayMs));
    }
    try {
      const confirmationTarget = await resolveTranscriptConfirmationTarget(state);
      // Codex app-server agents do not have a PTY supervisor socket. Work-agent
      // state can still project supervisorEnabled=true into the legacy strict
      // `supervisor` method. Resolve the persisted method here before forcing
      // resilient routing; passing undefined would let deliverAgentMessage
      // re-read that strict method and abort the cascade. Initial kickoff and
      // Deacon redelivery use app-server first, then the PTY path used by Codex
      // TUI. Claude Code keeps its strict supervisor contract.
      const kickoffDeliveryMethod = state?.harness === 'codex'
        ? resilientDeliveryMethod(deliveryMethod ?? state.deliveryMethod)
        : deliveryMethod;
      const result = await deliver(agentId, deliveredPrompt, caller, kickoffDeliveryMethod);
      if (result.ok) {
        if (!confirmationTarget) return result;
        const confirmed = await waitForTranscriptUserRecordLanding(
          confirmationTarget.workspace,
          confirmationTarget.sessionId,
          confirmationTarget.before,
          snapshot,
          options.timeoutMs,
          options.intervalMs,
        );
        if (confirmed) return result;
        lastFailure = 'kickoff-not-confirmed';
      } else {
        lastFailure = result.failure ?? `delivery returned ok=false via ${result.path}`;
      }
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : String(err);
    }
    console.error(`[${agentId}] Kickoff delivery attempt ${attempt}/2 failed: ${lastFailure}`);
  }

  return { ok: false, path: 'tmux', failure: lastFailure };
}

export async function deliverAgentPermissionDecision(
  agentId: string,
  requestId: string,
  behavior: 'allow' | 'deny',
): Promise<void> {
  const normalizedId = normalizeAgentId(agentId);

  let state: AgentState | null = null;
  try {
    state = await Effect.runPromise(getAgentState(normalizedId));
  } catch {
    state = null;
  }

  if (!state?.channelsEnabled) {
    throw new Error(`agent ${normalizedId} is not using Claude channels`);
  }

  const socketPath = join(overdeckHomeForChannels(), 'sockets', `agent-${normalizedId}.sock`);
  if (!existsSync(socketPath)) {
    throw new Error(`bridge socket missing for ${normalizedId}`);
  }

  const bridgeToken = readBridgeTokenSync(normalizedId);
  if (!bridgeToken) {
    throw new Error(`bridge token missing for ${normalizedId}`);
  }

  await postUnixSocketJson(
    socketPath,
    {
      type: 'permission_response',
      requestId,
      behavior,
    },
    2000,
    bridgeToken,
  );

  await appendChannelDeliveryLog(normalizedId, {
    path: 'channel',
    caller: `permission-response:${requestId}:${behavior}`,
  });
}

/** Update just the delivery method on an agent's state file. */
export async function setAgentDeliveryMethod(
  agentId: string,
  deliveryMethod: 'auto' | 'supervisor' | 'channels' | 'tmux',
): Promise<void> {
  const state = await Effect.runPromise(getAgentState(agentId));
  if (!state) return;
  state.deliveryMethod = deliveryMethod;
  await Effect.runPromise(saveAgentState(state));
}
