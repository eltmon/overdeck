/**
 * "Connect Linear" — open the current Linear MCP authorization URL, or ask a
 * blocked agent to mint a fresh one (PAN-4464).
 *
 * The link is usable only while the lifecycle is `active`, has an `authUrl`,
 * and its owner (`authUrlAgentId`) is not confirmed dead: Claude Code runs the
 * OAuth callback listener inside the owner's process, so a dead owner's link
 * cannot complete. Otherwise this sends a refresh request through the
 * `messageAgent()` delivery door to the owner first, then to the other
 * blocked agents newest-declared first, and stops at the first delivery. The
 * agent's `mcp__linear__authenticate` call makes the hook emit a fresh
 * `required` event, which the banner picks up by polling.
 *
 * The refresh throttle is an in-memory rate limit, not state: a second
 * `authenticate` call in the same process can replace the callback listener
 * and break the tab the operator already has open.
 */
import { isAlive as defaultIsAlive, isConfirmedDead, type LivenessVerdict } from './agents/liveness.js';
import { messageAgent as defaultMessageAgent, type MessageDeliveryOutcome } from './agents/messaging.js';
import {
  resolveLinearMcpAuthIntervention,
  type LinearMcpAuthIntervention,
} from './linear-mcp-auth.js';

export const LINEAR_MCP_AUTH_REFRESH_COPY = 'The Linear authorization link you generated has expired and the operator wants to connect now. Call mcp__linear__authenticate exactly once to generate a fresh authorization URL, state the URL in one sentence, then stop and wait — Overdeck shows the link to the operator and wakes you when authentication is restored. Do not do anything else.';
export const LINEAR_MCP_AUTH_REFRESH_THROTTLE_MS = 60_000;
export const LINEAR_MCP_AUTH_REFRESH_UNREACHABLE_ERROR = 'Could not reach any blocked agent to generate a fresh Linear link. Open one of the blocked conversations and ask it to call mcp__linear__authenticate.';

export type LinearMcpAuthConnectResult =
  | { kind: 'open'; authUrl: string; authUrlAgentId: string | null }
  | { kind: 'refreshing'; requestedFrom: string; previousAuthUrl: string | null }
  | { kind: 'nothing-pending' }
  | { kind: 'unreachable'; error: string };

/** Test seams. Production callers pass nothing. */
export interface ConnectDeps {
  resolve?: (nowIso?: string) => Promise<LinearMcpAuthIntervention>;
  isAlive?: (agentId: string) => Promise<LivenessVerdict>;
  messageAgent?: (agentId: string, message: string, caller?: string) => Promise<MessageDeliveryOutcome>;
  now?: () => number;
}

let lastRefresh: { declaredAt: string; agentId: string; at: number } | null = null;

export function _resetLinearMcpAuthConnectForTests(): void {
  lastRefresh = null;
}

async function ownerIsUsable(
  owner: string | null,
  isAlive: (agentId: string) => Promise<LivenessVerdict>,
): Promise<boolean> {
  if (owner === null) return true;
  try {
    return !isConfirmedDead(await isAlive(owner));
  } catch {
    // A broken probe must never force a needless refresh.
    return true;
  }
}

function refreshCandidates(intervention: LinearMcpAuthIntervention): string[] {
  const others = [...intervention.blockedAgents]
    .sort((a, b) => b.declaredAt.localeCompare(a.declaredAt))
    .map(agent => agent.agentId);
  const ordered = intervention.authUrlAgentId === null ? others : [intervention.authUrlAgentId, ...others];
  return [...new Set(ordered)];
}

export async function connectLinearMcpAuth(deps: ConnectDeps = {}): Promise<LinearMcpAuthConnectResult> {
  const resolve = deps.resolve ?? resolveLinearMcpAuthIntervention;
  const isAlive = deps.isAlive ?? ((agentId: string) => defaultIsAlive(agentId));
  const messageAgent = deps.messageAgent ?? defaultMessageAgent;
  const now = deps.now ?? Date.now;

  const intervention = await resolve(new Date(now()).toISOString());
  if (intervention.status === 'none') return { kind: 'nothing-pending' };

  if (intervention.status === 'active' && intervention.authUrl !== null
    && await ownerIsUsable(intervention.authUrlAgentId, isAlive)) {
    return { kind: 'open', authUrl: intervention.authUrl, authUrlAgentId: intervention.authUrlAgentId };
  }

  const declaredAt = intervention.declaredAt ?? '';
  if (lastRefresh !== null && lastRefresh.declaredAt === declaredAt
    && now() - lastRefresh.at < LINEAR_MCP_AUTH_REFRESH_THROTTLE_MS) {
    return { kind: 'refreshing', requestedFrom: lastRefresh.agentId, previousAuthUrl: intervention.authUrl };
  }

  for (const candidate of refreshCandidates(intervention)) {
    let outcome: MessageDeliveryOutcome;
    try {
      outcome = await messageAgent(candidate, LINEAR_MCP_AUTH_REFRESH_COPY, 'linear-mcp-auth-refresh');
    } catch {
      continue;
    }
    if (!outcome.delivered) continue;
    lastRefresh = { declaredAt, agentId: candidate, at: now() };
    return { kind: 'refreshing', requestedFrom: candidate, previousAuthUrl: intervention.authUrl };
  }

  return { kind: 'unreachable', error: LINEAR_MCP_AUTH_REFRESH_UNREACHABLE_ERROR };
}
