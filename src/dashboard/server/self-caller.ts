/**
 * The caller of a self route (PAN-4927 W-SELF1, D-10): an agent token's
 * agent, found from the token only.
 *
 * A self route under `/api/self/` acts for the agent that calls it. The agent
 * comes from the request's credential, never from its body, query or headers
 * (FR-1). Every other credential, including none, is refused with 403
 * `not-an-agent-token` (FR-2); a token whose agent or conversation no longer
 * exists is refused with 404 `agent-gone` (FR-3). Route files turn a refusal
 * into `jsonResponse(result.body, { status: result.status })`; this module
 * builds no HTTP response. A throwing lookup is not caught, so it surfaces as
 * a 500 through `httpHandler`.
 */
import type { HttpServerRequest } from 'effect/unstable/http';

import { getAgentState } from '../../lib/agents/agent-state-read.js';
import { getConversationByName } from '../../lib/overdeck/conversations.js';
import { type DashboardCredential, resolveRequestCredential } from './routes/dashboard-auth.js';

export interface SelfCaller {
  /** The token's `agentId`: a normalized agent id, or a conversation name. */
  agentId: string;
  agentKind: 'agent' | 'conversation';
  /** The token's role (`Role` or 'conversation'); null when the record has none. */
  role: string | null;
  /** The agent's workspace, or the conversation's cwd. Jobs run here. */
  cwd: string;
  issueId: string | null;
  /** The conversation's tmux session (`conv-<name>`); null for agents. */
  tmuxSession: string | null;
}

export const NOT_AN_AGENT_TOKEN = { error: 'self routes need an agent token', code: 'not-an-agent-token' } as const;
export const AGENT_GONE = { error: 'the agent for this token no longer exists', code: 'agent-gone' } as const;

export type SelfCallerResult =
  | { ok: true; caller: SelfCaller }
  | { ok: false; status: 403; body: typeof NOT_AN_AGENT_TOKEN }
  | { ok: false; status: 404; body: typeof AGENT_GONE };

export interface SelfCallerDeps {
  getAgentState: (agentId: string) => { workspace: string; issueId: string } | null;
  getConversationByName: (name: string) => { cwd: string; tmuxSession: string; issueId: string | null } | null;
}

const defaultDeps: SelfCallerDeps = { getAgentState, getConversationByName };

const notAnAgentToken: SelfCallerResult = { ok: false, status: 403, body: NOT_AN_AGENT_TOKEN };
const agentGone: SelfCallerResult = { ok: false, status: 404, body: AGENT_GONE };

/** The self caller a credential names, or the 403/404 refusal for it. */
export function selfCallerFromCredential(credential: DashboardCredential | null, deps: SelfCallerDeps = defaultDeps): SelfCallerResult {
  if (credential === null || credential.kind !== 'token') return notAnAgentToken;
  const { agentId, agentKind } = credential;
  if (typeof agentId !== 'string' || agentId === '') return notAnAgentToken;
  if (agentKind !== 'agent' && agentKind !== 'conversation') return notAnAgentToken;
  const role = credential.role ?? null;

  if (agentKind === 'agent') {
    const state = deps.getAgentState(agentId);
    if (state === null || !state.workspace) return agentGone;
    return { ok: true, caller: { agentId, agentKind, role, cwd: state.workspace, issueId: state.issueId || null, tmuxSession: null } };
  }

  const conversation = deps.getConversationByName(agentId);
  if (conversation === null || !conversation.cwd) return agentGone;
  return {
    ok: true,
    caller: { agentId, agentKind, role, cwd: conversation.cwd, issueId: conversation.issueId, tmuxSession: conversation.tmuxSession },
  };
}

/** `selfCallerFromCredential` for a request's resolved credential. */
export function resolveSelfCaller(request: HttpServerRequest.HttpServerRequest, deps: SelfCallerDeps = defaultDeps): SelfCallerResult {
  return selfCallerFromCredential(resolveRequestCredential(request), deps);
}
