import type { DomainEvent } from '@overdeck/contracts';
import {
  initEventStore,
  type StoredEvent,
} from '../dashboard/server/event-store.js';
import { messageAgentWithOutcome } from './agents/messaging.js';
import { createPromiseCoalescer } from './cloister/in-flight-guard.js';

export const LINEAR_MCP_AUTH_URL_TTL_MS = 30 * 60 * 1000;
export const LINEAR_MCP_AUTH_WAKE_COPY = 'Linear MCP authentication has been restored — the operator completed OAuth. Re-check access now with one lightweight read (e.g. mcp__linear__list_issues). If it succeeds, resume your canonical task. If it still returns an authentication error, call mcp__linear__authenticate once and wait; do not retry in a loop.';

const linearMcpAuthWakeCoalescer = createPromiseCoalescer<void>();

export type LinearMcpAuthStatus = 'none' | 'active' | 'expired';
export type LinearMcpAuthNotificationOutcome = 'delivered' | 'queued' | 'failed';

export interface LinearMcpAuthBlockedAgent {
  agentId: string;
  issueId: string | null;
  declaredAt: string;
  expiresAt: string;
  notifiedAt: string | null;
  /** Projection-only enrichment attached by the GET route from the issues
   * resolver; never persisted in lifecycle events. */
  issueUrl?: string | null;
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
  /** Durable correlation id: the sequence of the required event that opened
   * this lifecycle. `notified` events carry it so a delayed delivery record
   * can only be applied to the lifecycle whose wake attempt produced it. */
  id: string;
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
  /** Correlates this record to the lifecycle whose wake attempt produced it.
   * Absent only in events written before PAN-2997 review cycle 2. */
  lifecycleId?: string;
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
          id: `seq-${event.sequence}`,
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
        // A notification record belongs to exactly one lifecycle: the one
        // whose wake pass produced it. Without this correlation a delayed
        // delivery from lifecycle A could be stamped onto lifecycle B,
        // permanently suppressing B's wake.
        const lifecycle = payload.lifecycleId !== undefined
          ? (open?.id === payload.lifecycleId ? open
            : lastCompleted?.id === payload.lifecycleId ? lastCompleted
            : null)
          : (open ?? lastCompleted);
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

const HEALTHY_BOUNDARY_CANDIDATES = 50;

async function readLinearMcpAuthFold(): Promise<LinearMcpAuthFold> {
  const store = await initEventStore();
  // The fold needs the currently-open lifecycle plus the last completed one
  // (for wake bookkeeping). queryByType's per-type cap (default 100) silently
  // drops blocked agents once one type overflows, so read with a sequence
  // predicate instead, anchored just before the last completed lifecycle.
  //
  // The anchor is a healthy event, but healthy events are only lifecycle
  // boundaries when a lifecycle was open — a duplicate healthy is a no-op.
  // So walk candidate boundaries from the second-most-recent healthy
  // backwards: if the window contains a healthy event yet reconstructs no
  // completed lifecycle, that healthy closed a lifecycle whose opening
  // required events were cut off — expand to the next older candidate.
  const healthyEvents = store.queryByType('linear_mcp_auth.healthy', HEALTHY_BOUNDARY_CANDIDATES);
  const candidates = [
    ...healthyEvents.slice(0, -1).map(candidate => candidate.sequence).reverse(),
    0,
  ];

  let fold: LinearMcpAuthFold = { open: null, lastCompleted: null };
  for (const boundary of candidates) {
    const events = store.readFrom(boundary)
      .filter(candidate =>
        (LINEAR_MCP_AUTH_EVENT_TYPES as readonly string[]).includes(candidate.type))
      .sort((a, b) => a.sequence - b.sequence);
    fold = foldLinearMcpAuthEvents(events);
    const windowHasHealthy = events.some(candidate => candidate.type === 'linear_mcp_auth.healthy');
    if (fold.lastCompleted !== null || !windowHasHealthy || boundary === 0) {
      break;
    }
  }
  return fold;
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

export interface LinearMcpAuthWakeSet {
  lifecycleId: string;
  agents: LinearMcpAuthBlockedAgent[];
}

export async function computeLinearMcpAuthWakeSet(): Promise<LinearMcpAuthWakeSet | null> {
  const { lastCompleted } = await readLinearMcpAuthFold();
  if (lastCompleted === null) return null;
  const agents = [...lastCompleted.agents.values()].filter(agent => agent.notifiedAt === null);
  return { lifecycleId: lastCompleted.id, agents };
}

const MAX_WAKE_PASSES = 10;

export function processLinearMcpAuthWake(): Promise<void> {
  return linearMcpAuthWakeCoalescer.run('global', async () => {
    // Drain-until-stable: a healthy event that lands while this pass is
    // delivering wakes would otherwise be swallowed by the coalescer (its
    // trigger gets this in-flight promise back). Re-reading the fold after
    // each pass surfaces the newly completed lifecycle, so it gets its own
    // wake round inside the same coalesced run.
    for (let pass = 0; pass < MAX_WAKE_PASSES; pass++) {
      const wakeSet = await computeLinearMcpAuthWakeSet();
      if (wakeSet === null || wakeSet.agents.length === 0) return;
      for (const blockedAgent of wakeSet.agents) {
        let outcome: LinearMcpAuthNotificationOutcome;
        try {
          outcome = await messageAgentWithOutcome(
            blockedAgent.agentId,
            LINEAR_MCP_AUTH_WAKE_COPY,
            'linear-mcp-auth-wake',
          );
        } catch {
          outcome = 'failed';
        }
        await appendLinearMcpAuthNotifiedEvent({
          agentId: blockedAgent.agentId,
          issueId: blockedAgent.issueId,
          outcome,
          lifecycleId: wakeSet.lifecycleId,
        });
      }
    }
    console.error(`[linear-mcp-auth] wake pass did not stabilize after ${MAX_WAKE_PASSES} passes — remaining wakes deferred to the next trigger or boot recovery`);
  });
}
