/**
 * Verify request — ask the owner of the current Linear MCP authorization URL
 * to re-check Linear access after a same-machine OAuth approval (PAN-4464).
 *
 * The browser reaching the owner's localhost callback fires no hook, so the
 * lifecycle stays open until the owner makes a Linear call. This sends that
 * nudge through the `messageAgent()` delivery door; the hook's `healthy`
 * event then closes the lifecycle and the wake pass resumes every blocked
 * agent. The copy forbids calling `mcp__linear__authenticate`: a second call
 * would replace the callback listener mid-flow. The throttle is an in-memory
 * rate limit, not state.
 */
import { messageAgent as defaultMessageAgent, type MessageDeliveryOutcome } from './agents/messaging.js';
import {
  resolveLinearMcpAuthIntervention,
  type LinearMcpAuthIntervention,
} from './linear-mcp-auth.js';

export const LINEAR_MCP_AUTH_VERIFY_COPY = 'The operator approved Linear access in their browser. Re-check Linear access now with exactly one lightweight read (e.g. mcp__linear__list_issues with a limit of 1). If it succeeds, resume your canonical task. If it fails or the Linear tools are unavailable, do NOT call mcp__linear__authenticate — stop and wait; the operator will retry from the dashboard.';
export const LINEAR_MCP_AUTH_VERIFY_THROTTLE_MS = 15_000;

export type LinearMcpAuthVerifyResult =
  | { kind: 'already-connected' }
  | { kind: 'requested'; requestedFrom: string }
  | { kind: 'no-owner' }
  | { kind: 'unreachable'; error: string };

/** Test seams. Production callers pass nothing. */
export interface VerifyDeps {
  resolve?: (nowIso?: string) => Promise<LinearMcpAuthIntervention>;
  messageAgent?: (agentId: string, message: string, caller?: string) => Promise<MessageDeliveryOutcome>;
  now?: () => number;
}

let lastVerify: { declaredAt: string; agentId: string; at: number } | null = null;

export function _resetLinearMcpAuthVerifyForTests(): void {
  lastVerify = null;
}

export async function requestLinearMcpAuthVerify(deps: VerifyDeps = {}): Promise<LinearMcpAuthVerifyResult> {
  const resolve = deps.resolve ?? resolveLinearMcpAuthIntervention;
  const messageAgent = deps.messageAgent ?? defaultMessageAgent;
  const now = deps.now ?? Date.now;

  const intervention = await resolve(new Date(now()).toISOString());
  if (intervention.status === 'none') return { kind: 'already-connected' };
  const owner = intervention.authUrlAgentId;
  if (owner === null) return { kind: 'no-owner' };

  const declaredAt = intervention.declaredAt ?? '';
  if (lastVerify !== null && lastVerify.declaredAt === declaredAt
    && now() - lastVerify.at < LINEAR_MCP_AUTH_VERIFY_THROTTLE_MS) {
    return { kind: 'requested', requestedFrom: lastVerify.agentId };
  }

  let outcome: MessageDeliveryOutcome;
  try {
    outcome = await messageAgent(owner, LINEAR_MCP_AUTH_VERIFY_COPY, 'linear-mcp-auth-verify');
  } catch (error) {
    return { kind: 'unreachable', error: `Could not reach ${owner}: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!outcome.delivered) {
    return { kind: 'unreachable', error: `Could not reach ${owner}: ${outcome.reason ?? 'message was not delivered'}` };
  }
  lastVerify = { declaredAt, agentId: owner, at: now() };
  return { kind: 'requested', requestedFrom: owner };
}
