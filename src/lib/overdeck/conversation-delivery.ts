import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';

import { Effect } from 'effect';

import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { validateOriginHeaders, getHeaderFromMap, type HeaderMap } from '../../dashboard/server/routes/origin-validation.js';
import { detectAwaitingInputForAgent, parseCodexApprovalPrompt } from '../agent-input-detection.js';
import {
  getConversationById,
  getConversationByName,
  setConversationEffort,
  updateConversationDeliveryMethod,
  type LegacyConversation as Conversation,
} from './conversations.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import type { RuntimeName } from '../runtimes/types.js';
import { loadConfigSync } from '../config-yaml.js';
import {
  writeConversationControlCommand,
  type ControlCommand,
  type ThinkingLevel,
} from '../runtimes/conversation-control.js';
import { sendRawKeystroke, sendKeysAsync } from '../tmux.js';
import { deliverAgentMessage } from '../agents.js';
import { tmuxSessionExists } from './conversation-runtime.js';
import type { PendingAskUserQuestionSnapshot, PendingInputKind } from '../agent-enrichment.js';
import { getOverdeckHome } from '../paths.js';
import { BRIDGE_TOKEN_HEADER } from '../bridge-token.js';

export const CONTROL_ACK_TIMEOUT_MS = 10_000;

export interface ConversationControlAck {
  id: string
  ok: boolean
  error?: string
}

interface PendingConversationControlAck {
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pendingConversationControlAcks = new Map<string, PendingConversationControlAck>();

const PLAN_ACTION_KEYSTROKES: Record<string, string> = {
  'approve-auto': '1',
  'approve-manual': '2',
  'reject-ultraplan': '3',
};

interface CodexAppServerPendingRequest {
  id: string | number;
  method: string;
  params?: unknown;
}

interface CodexAppServerStatus {
  pendingRequests?: CodexAppServerPendingRequest[];
}

/**
 * PAN-1520 (FR-4) — deliver a native plan-menu action to any tmux session
 * (conversation or agent). The plan menu is answered with raw keystrokes
 * (1/2/3/4), not a text message; `reject-feedback` follows the '4' keystroke
 * with the operator's feedback through the normal message pipeline.
 * Returns null on success, or an error string for an invalid action.
 */
export async function deliverPlanActionToSession(
  sessionName: string,
  action: string,
  feedback: string,
  deliveryMethod: 'auto' | 'channels' | 'tmux' = 'auto',
): Promise<string | null> {
  if (action === 'reject-feedback') {
    await Effect.runPromise(sendRawKeystroke(sessionName, '4', 'plan-action-reject'));
    if (feedback) {
      await new Promise(r => setTimeout(r, 300));
      await deliverAgentMessage(sessionName, feedback, 'plan-action-feedback', deliveryMethod);
    }
    return null;
  }
  const keystroke = PLAN_ACTION_KEYSTROKES[action];
  if (!keystroke) return `Invalid action: ${action}`;
  await Effect.runPromise(sendRawKeystroke(sessionName, keystroke, `plan-action-${action}`));
  return null;
}

export function registerConversationControlAck(
  commandId: string,
  timeoutMs: number = CONTROL_ACK_TIMEOUT_MS,
): Promise<void> {
  const existing = pendingConversationControlAcks.get(commandId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.reject(new Error(`Replaced pending conversation control ack ${commandId}`));
    pendingConversationControlAcks.delete(commandId);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingConversationControlAcks.delete(commandId);
      reject(new Error(`Timed out waiting for conversation control ack ${commandId}`));
    }, timeoutMs);
    pendingConversationControlAcks.set(commandId, {
      resolve: () => {
        clearTimeout(timer);
        pendingConversationControlAcks.delete(commandId);
        resolve();
      },
      reject: (error: Error) => {
        clearTimeout(timer);
        pendingConversationControlAcks.delete(commandId);
        reject(error);
      },
      timer,
    });
  });
}

export function resolveConversationControlAck(ack: ConversationControlAck): 'resolved' | 'rejected' | 'unknown' {
  const pending = pendingConversationControlAcks.get(ack.id);
  if (!pending) return 'unknown';
  if (ack.ok) {
    pending.resolve();
    return 'resolved';
  }
  pending.reject(new Error(ack.error || `Conversation control command ${ack.id} failed`));
  return 'rejected';
}

export function getPendingConversationControlAckCount(): number {
  return pendingConversationControlAcks.size;
}

export function clearPendingConversationControlAcksForTests(): void {
  for (const pending of pendingConversationControlAcks.values()) {
    clearTimeout(pending.timer);
  }
  pendingConversationControlAcks.clear();
}

export function handleConversationControlAck(
  body: Record<string, unknown>,
): { status: number; body: { ok: true; outcome: 'resolved' | 'rejected' | 'unknown' } | { error: string } } {
  const id = typeof body['id'] === 'string' ? body['id'].trim() : '';
  if (!id) return { status: 400, body: { error: 'id is required' } };
  const ok = body['ok'] === true;
  const error = typeof body['error'] === 'string' ? body['error'] : undefined;
  const outcome = resolveConversationControlAck({ id, ok, ...(error !== undefined ? { error } : {}) });
  return { status: 200, body: { ok: true, outcome } };
}

export function validateConversationControlAckOrigin(
  headers: HeaderMap,
  method = 'POST',
): { ok: true } | { ok: false; error: string } {
  const origin = getHeaderFromMap(headers, 'origin');
  const referer = getHeaderFromMap(headers, 'referer');
  if (!origin && !referer) return { ok: true };
  return validateOriginHeaders(headers, method);
}

export async function handleConversationCodexApproval(
  rawId: string,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof jsonResponse>> {
  try {
    const optionNumber = Number((body as { optionNumber?: unknown }).optionNumber);
    const requestedToolUseId = typeof body.toolUseId === 'string' ? body.toolUseId : undefined;
    if (!Number.isInteger(optionNumber) || optionNumber < 1 || optionNumber > 9) {
      return jsonResponse({ error: 'optionNumber must be an integer 1-9' }, { status: 400 });
    }
    const numericId = Number(rawId);
    const conv = !Number.isNaN(numericId) && /^\d+$/.test(rawId)
      ? getConversationById(numericId)
      : getConversationByName(rawId);
    if (!conv) {
      return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    }
    if (getHarnessBehavior(conv.harness).transcriptKind !== 'codex-rollout-jsonl') {
      return jsonResponse({ error: 'Not a Codex conversation' }, { status: 400 });
    }
    if (!(await tmuxSessionExists(conv.tmuxSession))) {
      return jsonResponse({ error: 'Conversation session is not running' }, { status: 409 });
    }
    if (codexUsesAppServerTransport()) {
      const pending = await readFirstAppServerApproval(conv.tmuxSession);
      if (!pending) {
        return jsonResponse({ error: 'No Codex approval prompt is currently pending' }, { status: 409 });
      }
      const expectedToolUseId = `${CODEX_APPROVAL_TOOL_PREFIX}${conv.tmuxSession}:${pending.id}`;
      if (!requestedToolUseId) {
        return jsonResponse({ error: 'Codex approval request id is required' }, { status: 400 });
      }
      if (requestedToolUseId !== expectedToolUseId) {
        return jsonResponse({ error: 'Codex approval request changed; refresh pending input before responding' }, { status: 409 });
      }
      const decision = codexAppServerDecisionForOption(optionNumber);
      if (!decision) {
        return jsonResponse({ error: 'optionNumber out of range (1-2)' }, { status: 400 });
      }
      await postCodexAppServerOp(conv.tmuxSession, { op: 'approval', requestId: pending.id, decision });
      return jsonResponse({ ok: true, optionNumber, decision });
    }
    // Re-detect uncached so we only send keystrokes when the menu is still
    // up, and so we can bound optionNumber to the options actually shown.
    const detection = await Effect.runPromise(
      detectAwaitingInputForAgent(conv.tmuxSession, { isPlanning: false, cache: false }),
    );
    const parsed = detection ? parseCodexApprovalPrompt(detection.prompt) : null;
    if (!parsed) {
      return jsonResponse({ error: 'No Codex approval prompt is currently pending' }, { status: 409 });
    }
    if (optionNumber > parsed.options.length) {
      return jsonResponse({ error: `optionNumber out of range (1-${parsed.options.length})` }, { status: 400 });
    }
    await deliverCodexApprovalChoice(conv.tmuxSession, optionNumber);
    return jsonResponse({ ok: true, optionNumber });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] codex approval failed:', msg);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function handleConversationPlanAction(
  name: string,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof jsonResponse>> {
  try {
    const conv = getConversationByName(name);
    if (!conv) {
      return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    }
    const action = typeof body['action'] === 'string' ? body['action'] : '';
    const feedback = typeof body['feedback'] === 'string' ? body['feedback'].trim() : '';
    const error = await deliverPlanActionToSession(
      conv.tmuxSession,
      action,
      feedback,
      resolveConversationDeliveryMethod(conv),
    );
    if (error) {
      return jsonResponse({ error }, { status: 400 });
    }
    return jsonResponse({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] plan action failed:', msg);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 });
  }
}

type ConversationControlDeliverAs = Extract<ControlCommand['type'], 'prompt' | 'steer' | 'follow_up'>;
type ConversationControlCommandInput = ControlCommand extends infer C
  ? C extends { id: string }
    ? Omit<C, 'id'>
    : never
  : never;

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const satisfies readonly ThinkingLevel[];
const PI_CONVERSATION_ABORT_KEY = 'Escape';

export function isPiControlChannelHarness(harness: RuntimeName | 'pi'): boolean {
  return harness === 'ohmypi' || harness === 'pi';
}

export function parseThinkingLevel(value: unknown): ThinkingLevel | null {
  return typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value)
    ? value as ThinkingLevel
    : null;
}

export function pickDeliverAs(bodyDeliverAs: unknown): ConversationControlDeliverAs {
  if (bodyDeliverAs === 'follow_up') return 'follow_up';
  return 'steer';
}

export function resolveConversationDeliveryMethod(conv: Pick<Conversation, 'harness' | 'deliveryMethod'>): 'auto' | 'channels' | 'tmux' {
  const harness = conv.harness ?? 'claude-code';
  if (isPiControlChannelHarness(harness)) return 'auto';
  if (harness === 'codex' && loadConfigSync().config.codex?.transport !== 'tui') return 'auto';
  return conv.deliveryMethod ?? (getHarnessBehavior(harness).deliveryKind === 'rpc-fifo' ? 'tmux' : 'auto');
}

export async function sendConversationControlCommand(
  conv: Pick<Conversation, 'tmuxSession'>,
  commandInput: ConversationControlCommandInput,
): Promise<void> {
  const id = randomUUID();
  const ackPromise = registerConversationControlAck(id);
  const command: ControlCommand = { id, ...commandInput };

  try {
    await writeConversationControlCommand(conv.tmuxSession, command);
  } catch (err) {
    resolveConversationControlAck({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  await ackPromise;
}

export async function deliverConversationViaControlChannel(
  conv: Pick<Conversation, 'tmuxSession'>,
  message: string,
  options: {
    source: 'operator' | 'orchestrator'
    deliverAs: ConversationControlDeliverAs
  },
): Promise<void> {
  await sendConversationControlCommand(conv, {
    type: options.deliverAs,
    message,
    source: options.source,
  });
}

export async function handleConversationThinkingLevel(
  name: string,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof jsonResponse>> {
  const conv = getConversationByName(name);
  if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });

  const harness: RuntimeName = conv.harness ?? 'claude-code';
  if (!isPiControlChannelHarness(harness)) {
    return jsonResponse({ error: 'Thinking level control is only supported for Pi conversations' }, { status: 400 });
  }
  if (conv.status === 'ended') {
    return jsonResponse({ error: 'Session has ended — start a new run to interact' }, { status: 422 });
  }

  const level = parseThinkingLevel(body['level']);
  if (!level) return jsonResponse({ error: 'Invalid thinking level' }, { status: 400 });

  await sendConversationControlCommand(conv, { type: 'set_thinking_level', level });
  setConversationEffort(name, level);
  const updated = getConversationByName(name) ?? conv;
  return jsonResponse({ ok: true, effort: updated.effort ?? level });
}

export async function handleConversationCompact(name: string): Promise<ReturnType<typeof jsonResponse>> {
  const conv = getConversationByName(name);
  if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });

  const harness: RuntimeName = conv.harness ?? 'claude-code';
  if (!isPiControlChannelHarness(harness)) {
    return jsonResponse({ error: 'Compact control endpoint is only supported for Pi conversations' }, { status: 400 });
  }
  if (conv.status === 'ended') {
    return jsonResponse({ error: 'Session has ended — start a new run to interact' }, { status: 422 });
  }

  await sendConversationControlCommand(conv, { type: 'compact' });
  return jsonResponse({ ok: true });
}

export async function handleConversationAbort(name: string): Promise<ReturnType<typeof jsonResponse>> {
  const conv = getConversationByName(name);
  if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });

  const harness: RuntimeName = conv.harness ?? 'claude-code';
  if (!isPiControlChannelHarness(harness)) {
    return jsonResponse({ error: 'Abort control endpoint is only supported for Pi conversations' }, { status: 400 });
  }
  if (conv.status === 'ended') {
    return jsonResponse({ error: 'Session has ended — start a new run to interact' }, { status: 422 });
  }

  await sendKeysAsync(conv.tmuxSession, PI_CONVERSATION_ABORT_KEY, 'conversation-abort');
  return jsonResponse({ ok: true, key: PI_CONVERSATION_ABORT_KEY });
}

export async function handleConversationDeliveryMethod(
  name: string,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof jsonResponse>> {
  const conv = getConversationByName(name);
  if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
  const deliveryMethod = body['deliveryMethod'] ?? body['method'];
  if (deliveryMethod !== 'auto' && deliveryMethod !== 'channels' && deliveryMethod !== 'tmux' && deliveryMethod !== null) {
    return jsonResponse({ error: "deliveryMethod must be 'auto', 'channels', 'tmux', or null" }, { status: 400 });
  }
  updateConversationDeliveryMethod(name, deliveryMethod as 'auto' | 'channels' | 'tmux' | null);
  return jsonResponse({ ok: true, deliveryMethod });
}

export const CODEX_APPROVAL_TOOL_PREFIX = 'codex-approval:';

export async function codexConversationPendingInput(
  conv: Conversation,
  sessionAlive: boolean,
  askedAt: string,
): Promise<{ kinds: PendingInputKind[]; approval?: PendingAskUserQuestionSnapshot }> {
  if (!sessionAlive || getHarnessBehavior(conv.harness).transcriptKind !== 'codex-rollout-jsonl') return { kinds: [] };
  try {
    if (codexUsesAppServerTransport()) {
      const pending = await readFirstAppServerApproval(conv.tmuxSession);
      if (!pending) return { kinds: [] };
      return {
        kinds: ['permissionRequest'],
        approval: {
          toolUseId: `${CODEX_APPROVAL_TOOL_PREFIX}${conv.tmuxSession}:${pending.id}`,
          askedAt,
          questions: [{
            question: formatAppServerApprovalQuestion(pending),
            header: 'Codex approval',
            multiSelect: false,
            options: [
              { label: '1. accept' },
              { label: '2. reject' },
            ],
          }],
        },
      };
    }
    const detection = await Effect.runPromise(detectAwaitingInputForAgent(conv.tmuxSession, { isPlanning: false }));
    if (!detection) return { kinds: [] };
    if (detection.reason === 'session_resume') return { kinds: ['sessionResume'] };

    const parsed = parseCodexApprovalPrompt(detection.prompt);
    if (parsed) {
      return {
        kinds: ['permissionRequest'],
        approval: {
          toolUseId: `${CODEX_APPROVAL_TOOL_PREFIX}${conv.tmuxSession}`,
          askedAt,
          questions: [{
            question: parsed.detail ? `${parsed.header}\n\n${parsed.detail}` : parsed.header,
            header: 'Codex approval',
            multiSelect: false,
            options: parsed.options.map((o) => ({ label: `${o.number}. ${o.label}` })),
          }],
        },
      };
    }
    return { kinds: ['permissionRequest'] };
  } catch {
    return { kinds: [] };
  }
}

export async function deliverCodexApprovalChoice(tmuxSession: string, optionNumber: number): Promise<void> {
  for (let i = 1; i < optionNumber; i += 1) {
    await Effect.runPromise(sendRawKeystroke(tmuxSession, 'Down', 'codex-approval'));
    await new Promise((r) => setTimeout(r, 60));
  }
  await Effect.runPromise(sendRawKeystroke(tmuxSession, 'Enter', 'codex-approval'));
}

function codexUsesAppServerTransport(): boolean {
  return loadConfigSync().config.codex?.transport !== 'tui';
}

function codexAppServerDecisionForOption(optionNumber: number): 'accept' | 'reject' | null {
  if (optionNumber === 1) return 'accept';
  if (optionNumber === 2) return 'reject';
  return null;
}

async function readFirstAppServerApproval(tmuxSession: string): Promise<CodexAppServerPendingRequest | null> {
  const status = await postCodexAppServerOp<CodexAppServerStatus>(tmuxSession, { op: 'status' });
  return status.pendingRequests?.find(request => /requestApproval/i.test(request.method)) ?? null;
}

function formatAppServerApprovalQuestion(request: CodexAppServerPendingRequest): string {
  const params = asRecord(request.params);
  const command = typeof params.command === 'string' ? params.command : undefined;
  const path = typeof params.path === 'string' ? params.path : undefined;
  if (command) return `Codex requests approval to run:\n\n${command}`;
  if (path) return `Codex requests approval for:\n\n${path}`;
  return `Codex requests approval for ${request.method}`;
}

async function postCodexAppServerOp<T = Record<string, unknown>>(tmuxSession: string, body: Record<string, unknown>): Promise<T> {
  const socketPath = join(getOverdeckHome(), 'sockets', `appserver-${tmuxSession}.sock`);
  const tokenPath = join(getOverdeckHome(), 'agents', tmuxSession, 'appserver-token');
  if (!existsSync(socketPath)) throw new Error(`app-server socket missing for ${tmuxSession}`);
  if (!existsSync(tokenPath)) throw new Error(`app-server token missing for ${tmuxSession}`);
  const token = readFileSync(tokenPath, 'utf-8').trim();
  if (!token) throw new Error(`app-server token missing for ${tmuxSession}`);
  const payload = JSON.stringify(body);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy(new Error(`app-server op timed out after 2000ms`));
      reject(new Error(`app-server op timed out after 2000ms`));
    }, 2_000);
    const finishErr = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    const finishOk = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
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
          [BRIDGE_TOKEN_HEADER]: token,
        },
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf-8');
        res.on('data', chunk => { responseBody += chunk; });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            finishErr(new Error(`app-server op returned HTTP ${status}`));
            return;
          }
          try {
            finishOk(JSON.parse(responseBody) as T);
          } catch (error) {
            finishErr(new Error(`app-server op returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
          }
        });
      },
    );
    req.on('error', finishErr);
    req.write(payload);
    req.end();
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
