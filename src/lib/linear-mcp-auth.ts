import type { DomainEvent } from '@overdeck/contracts';
import {
  initEventStore,
  type StoredEvent,
} from '../dashboard/server/event-store.js';

export const LINEAR_MCP_AUTH_URL_TTL_MS = 30 * 60 * 1000;

export type LinearMcpAuthStatus = 'none' | 'active' | 'expired';
export type LinearMcpAuthNotificationOutcome = 'delivered' | 'queued' | 'failed';

export interface LinearMcpAuthBlockedAgent {
  agentId: string;
  issueId: string | null;
  declaredAt: string;
  expiresAt: string;
  notifiedAt: string | null;
}

export interface LinearMcpAuthIntervention {
  status: LinearMcpAuthStatus;
  authUrl: string | null;
  authUrlAgentId: string | null;
  authUrlExpiresAt: string | null;
  declaredAt: string | null;
  blockedAgents: LinearMcpAuthBlockedAgent[];
}

interface LinearMcpAuthLifecycle {
  declaredAt: string;
  authUrl: string | null;
  authUrlAgentId: string | null;
  authUrlExpiresAt: string | null;
  agents: Map<string, LinearMcpAuthBlockedAgent>;
}

interface LinearMcpAuthFold {
  open: LinearMcpAuthLifecycle | null;
  lastCompleted: LinearMcpAuthLifecycle | null;
}

export interface RequiredPayload {
  agentId: string;
  issueId: string | null;
  authUrl: string | null;
  expiresAt: string | null;
}

export interface HealthyPayload {
  agentId: string;
  issueId: string | null;
  source: 'hook' | 'operator';
}

export interface NotifiedPayload {
  agentId: string;
  issueId: string | null;
  outcome: LinearMcpAuthNotificationOutcome;
}

export interface CallbackRelayedPayload {
  agentId: string;
  issueId: string | null;
}

export type LinearMcpAuthEventInput =
  | { type: 'linear_mcp_auth.required'; timestamp?: string; payload: RequiredPayload }
  | { type: 'linear_mcp_auth.healthy'; timestamp?: string; payload: HealthyPayload }
  | { type: 'linear_mcp_auth.notified'; timestamp?: string; payload: NotifiedPayload }
  | { type: 'linear_mcp_auth.callback_relayed'; timestamp?: string; payload: CallbackRelayedPayload };

const LINEAR_MCP_AUTH_EVENT_TYPES = [
  'linear_mcp_auth.required',
  'linear_mcp_auth.healthy',
  'linear_mcp_auth.notified',
  'linear_mcp_auth.callback_relayed',
] as const;

function defaultExpiresAt(declaredAt: string): string {
  return new Date(Date.parse(declaredAt) + LINEAR_MCP_AUTH_URL_TTL_MS).toISOString();
}

function foldLinearMcpAuthEvents(events: StoredEvent[]): LinearMcpAuthFold {
  let open: LinearMcpAuthLifecycle | null = null;
  let lastCompleted: LinearMcpAuthLifecycle | null = null;

  for (const event of events) {
    switch (event.type) {
      case 'linear_mcp_auth.required': {
        const payload = event.payload as RequiredPayload;
        open ??= {
          declaredAt: event.timestamp,
          authUrl: null,
          authUrlAgentId: null,
          authUrlExpiresAt: null,
          agents: new Map(),
        };
        const expiresAt = payload.expiresAt ?? defaultExpiresAt(event.timestamp);
        open.agents.set(payload.agentId, {
          agentId: payload.agentId,
          issueId: payload.issueId,
          declaredAt: event.timestamp,
          expiresAt,
          notifiedAt: null,
        });
        if (payload.authUrl !== null) {
          open.authUrl = payload.authUrl;
          open.authUrlAgentId = payload.agentId;
          open.authUrlExpiresAt = expiresAt;
        }
        break;
      }
      case 'linear_mcp_auth.healthy':
        if (open !== null) {
          lastCompleted = open;
          open = null;
        }
        break;
      case 'linear_mcp_auth.notified': {
        const payload = event.payload as NotifiedPayload;
        const lifecycle = open ?? lastCompleted;
        const agent = lifecycle?.agents.get(payload.agentId);
        if (agent !== undefined) {
          lifecycle?.agents.set(payload.agentId, {
            ...agent,
            notifiedAt: event.timestamp,
          });
        }
        break;
      }
      case 'linear_mcp_auth.callback_relayed':
        break;
    }
  }

  return { open, lastCompleted };
}

async function readLinearMcpAuthFold(): Promise<LinearMcpAuthFold> {
  const store = await initEventStore();
  const events = LINEAR_MCP_AUTH_EVENT_TYPES
    .flatMap(type => store.queryByType(type))
    .sort((a, b) => a.sequence - b.sequence);
  return foldLinearMcpAuthEvents(events);
}

function projectLifecycle(
  lifecycle: LinearMcpAuthLifecycle | null,
  nowIso: string,
): LinearMcpAuthIntervention {
  if (lifecycle === null) {
    return {
      status: 'none',
      authUrl: null,
      authUrlAgentId: null,
      authUrlExpiresAt: null,
      declaredAt: null,
      blockedAgents: [],
    };
  }

  const status = lifecycle.authUrlExpiresAt !== null
    && lifecycle.authUrlExpiresAt < nowIso
    ? 'expired'
    : 'active';

  return {
    status,
    authUrl: lifecycle.authUrl,
    authUrlAgentId: lifecycle.authUrlAgentId,
    authUrlExpiresAt: lifecycle.authUrlExpiresAt,
    declaredAt: lifecycle.declaredAt,
    blockedAgents: [...lifecycle.agents.values()],
  };
}

export function linearMcpAuthEvent(input: LinearMcpAuthEventInput): Omit<DomainEvent, 'sequence'> {
  return {
    type: input.type,
    timestamp: input.timestamp ?? new Date().toISOString(),
    payload: input.payload,
  } as Omit<DomainEvent, 'sequence'>;
}

export async function appendLinearMcpAuthEvent(input: LinearMcpAuthEventInput): Promise<number> {
  const store = await initEventStore();
  return store.appendAsync(linearMcpAuthEvent(input));
}

export function appendLinearMcpAuthRequiredEvent(
  payload: RequiredPayload,
  timestamp?: string,
): Promise<number> {
  return appendLinearMcpAuthEvent({ type: 'linear_mcp_auth.required', payload, timestamp });
}

export function appendLinearMcpAuthHealthyEvent(
  payload: HealthyPayload,
  timestamp?: string,
): Promise<number> {
  return appendLinearMcpAuthEvent({ type: 'linear_mcp_auth.healthy', payload, timestamp });
}

export function appendLinearMcpAuthNotifiedEvent(
  payload: NotifiedPayload,
  timestamp?: string,
): Promise<number> {
  return appendLinearMcpAuthEvent({ type: 'linear_mcp_auth.notified', payload, timestamp });
}

export function appendLinearMcpAuthCallbackRelayedEvent(
  payload: CallbackRelayedPayload,
  timestamp?: string,
): Promise<number> {
  return appendLinearMcpAuthEvent({ type: 'linear_mcp_auth.callback_relayed', payload, timestamp });
}

export async function resolveLinearMcpAuthIntervention(
  nowIso = new Date().toISOString(),
): Promise<LinearMcpAuthIntervention> {
  const { open } = await readLinearMcpAuthFold();
  return projectLifecycle(open, nowIso);
}

export async function computeLinearMcpAuthWakeSet(): Promise<LinearMcpAuthBlockedAgent[]> {
  const { lastCompleted } = await readLinearMcpAuthFold();
  if (lastCompleted === null) return [];
  return [...lastCompleted.agents.values()].filter(agent => agent.notifiedAt === null);
}
