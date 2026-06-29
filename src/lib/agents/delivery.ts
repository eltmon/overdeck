import { existsSync, mkdirSync, writeFileSync } from 'fs';
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
import { sendKeys, sessionExists } from '../tmux.js';
import { getLatestSessionIdSync } from './activity.js';
import { BRIDGE_TOKEN_HEADER, readBridgeTokenSync } from '../bridge-token.js';
import { PTY_TOKEN_HEADER, readPtyToken } from '../pty-token.js';
import {
  captureTranscriptUserRecordSnapshot,
  hasNewTranscriptUserRecord,
  type TranscriptUserRecordSnapshot,
} from '../transcript-landing.js';

export type DeliveryResult = {
  ok: boolean;
  path: 'supervisor' | 'channels' | 'tmux' | 'pi' | 'codex';
  failure?: string;
};

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
    path: 'supervisor' | 'channel' | 'tmux';
    reason?: string;
    caller?: string;
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

/**
 * POST a JSON body to a Unix-domain socket using node:net + a hand-rolled
 * minimal HTTP/1.1 request. Resolves on a 200-class response, rejects on any
 * error including socket-not-found, connection refused, write timeout, or
 * non-2xx status. Kept tiny on purpose: this is a hot path, only one caller,
 * and the whole point of a fallback to tmux is that we do not need a robust
 * HTTP client here.
 */
async function postUnixSocketJson(
  socketPath: string,
  body: unknown,
  timeoutMs: number,
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
          finishErr(new Error(`socket POST: status ${status}: ${responseBody.slice(0, 100)}`));
        });
      },
    );

    timeout = setTimeout(() => {
      req.destroy(new Error('socket POST timeout'));
    }, timeoutMs);
    timeout.unref?.();
    req.on('error', (err: Error) => {
      finishErr(err);
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Single delivery primitive for orchestrator-to-work-agent messages. Auto mode
 * tries the PTY supervisor socket, then legacy Channels MCP, then tmux. Explicit
 * socket methods are strict and throw instead of falling back.
 */
export async function deliverAgentMessage(
  agentId: string,
  message: string,
  caller: string = 'unknown',
  deliveryMethod?: 'auto' | 'supervisor' | 'channels' | 'tmux',
): Promise<DeliveryResult> {
  const normalizedId = normalizeAgentId(agentId);

  let channelsEnabled = false;
  let resolvedMethod = deliveryMethod;
  try {
    const state = await Effect.runPromise(getAgentState(normalizedId));
    channelsEnabled = Boolean(state?.channelsEnabled);
    resolvedMethod ??= state?.deliveryMethod ?? 'auto';
  } catch {
    resolvedMethod ??= 'auto';
  }

  if (resolvedMethod === 'tmux') {
    await Effect.runPromise(sendKeys(normalizedId, message));
    return { ok: true, path: 'tmux' };
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
        // Must exceed the supervisor's worst-case echo-confirmation path
        // (2 attempts × 2.5s + 2 purges × 150ms ≈ 5.3s, pty-supervisor.ts).
        // A shorter client timeout abandons the POST mid-retry and fires the
        // tmux fallback while the supervisor is still writing — re-creating
        // the duplicate-submit race PAN-1769 fixed.
        await postUnixSocketJson(
          supervisorSocketPath,
          { content: message, meta: { caller } },
          8_000,
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
      ...(supervisorFailure ? { 'pty-supervisor': supervisorFailure } : {}),
      ...(channelFailure ? { channels: channelFailure } : {}),
    });
    await Effect.runPromise(sendKeys(normalizedId, message));
    return { ok: true, path: 'tmux', failure: channelFailure ?? supervisorFailure };
  }

  await Effect.runPromise(sendKeys(normalizedId, message));
  return { ok: true, path: 'tmux' };
}

const RESUME_TRANSCRIPT_CONFIRM_TIMEOUT_MS = 3_000;
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
): Promise<DeliveryResult> {
  function promptReadyTimeoutSeconds(): number {
    const raw = process.env.OVERDECK_PROMPT_READY_TIMEOUT_SECONDS;
    if (!raw) return 30;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  }

  // PAN-1803: the codex TUI mangles a large pasted kickoff prompt — a multi-
  // thousand-character paste garbles its input and trips its "Create a plan?"
  // mode hint, so the agent never executes. Write the full brief to a file and
  // deliver a SHORT pointer instead (robust regardless of transport — the same
  // pattern that makes file-backed handoffs reliable). Only codex needs this;
  // claude-code/pi line-based input handle the full prompt fine.
  let deliveredPrompt = prompt;
  try {
    const codexState = await Effect.runPromise(getAgentState(normalizeAgentId(agentId)));
    if (codexState?.harness && getHarnessBehavior(codexState.harness).usesCodexHome && codexState.workspace) {
      const kickoffPath = join(codexState.workspace, '.pan', 'kickoff.md');
      mkdirSync(dirname(kickoffPath), { recursive: true });
      writeFileSync(kickoffPath, prompt, 'utf-8');
      deliveredPrompt =
        'Your complete task brief has been written to `.pan/kickoff.md` in this workspace. '
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
      harness = (await Effect.runPromise(getAgentState(normalizeAgentId(agentId))))?.harness;
    } catch {
      harness = undefined;
    }
    const readyTimeoutSeconds = promptReadyTimeoutSeconds();
    const ready = await waitForPromptReady(agentId, harness, readyTimeoutSeconds);
    if (!ready) {
      const alive = await Effect.runPromise(sessionExists(normalizeAgentId(agentId)));
      lastFailure = alive ? 'ready-signal-timeout' : SESSION_EXITED_BEFORE_KICKOFF;
      const displayName = getHarnessBehavior(harness).displayName;
      console.error(`[${agentId}] ${displayName} did not become ready within ${readyTimeoutSeconds}s (kickoff attempt ${attempt}/2)`);
      if (!alive) break;
      continue;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    try {
      // PAN-2179: don't trust deliverAgentMessage's `ok` alone — the tmux
      // fallback reports ok even when the paste never lands. Confirm the kickoff
      // actually appeared in the transcript before declaring success, so a silent
      // non-delivery is reported as a failure (→ fatal for work agents) instead
      // of a running zombie.
      const latestState = await Effect.runPromise(getAgentState(normalizeAgentId(agentId)));
      const workspace = latestState?.workspace;
      const sessionId = getLatestSessionIdSync(normalizeAgentId(agentId));
      const before = workspace && sessionId
        ? await captureTranscriptUserRecordSnapshot(workspace, sessionId)
        : null;
      const result = await deliverAgentMessage(agentId, deliveredPrompt, caller, deliveryMethod);
      if (result.ok && workspace && sessionId && before) {
        if (await waitForTranscriptUserRecordLanding(workspace, sessionId, before, captureTranscriptUserRecordSnapshot)) {
          return result;
        }
        lastFailure = `transcript-confirmation-timeout:${sessionId}`;
      } else if (result.ok) {
        lastFailure = 'transcript-confirmation-unavailable';
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
