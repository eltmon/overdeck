import type { DomainEvent } from '@overdeck/contracts';
import {
  initEventStore,
  type StoredEvent,
} from '../dashboard/server/event-store.js';
import { messageAgentWithOutcome, agentHasMailContentSince } from './agents/messaging.js';
import { createPromiseCoalescer } from './cloister/in-flight-guard.js';

export const LINEAR_MCP_AUTH_URL_TTL_MS = 30 * 60 * 1000;
export const LINEAR_MCP_AUTH_WAKE_COPY = 'Linear MCP authentication has been restored — the operator completed OAuth. Re-check access now with one lightweight read (e.g. mcp__linear__list_issues). If it succeeds, resume your canonical task. If it still returns an authentication error, call mcp__linear__authenticate once and wait; do not retry in a loop.';

const linearMcpAuthWakeCoalescer = createPromiseCoalescer<void>();

export type LinearMcpAuthStatus = 'none' | 'active' | 'expired';
export type LinearMcpAuthNotificationOutcome = 'delivering' | 'delivered' | 'queued' | 'failed';

export interface LinearMcpAuthBlockedAgent {
  agentId: string;
  issueId: string | null;
  declaredAt: string;
  expiresAt: string;
  /** Set by a completion record (delivered/queued/failed). Terminal: the
   * agent never re-enters the wake set for this lifecycle. */
  notifiedAt: string | null;
  /** Set by a pre-delivery 'delivering' claim. NOT terminal: an agent with a
   * claim but no completion stays in the wake set, and recovery reconciles
   * the claim against the durable mail outbox before deciding whether the
   * send must be replayed. */
  claimedAt?: string | null;
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

function foldLinearMcpAuthEvents(
  events: StoredEvent[],
  initial: LinearMcpAuthFold = { open: null, lastCompleted: null },
): LinearMcpAuthFold {
  let open = initial.open;
  let lastCompleted = initial.lastCompleted;

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
          if (payload.outcome === 'delivering') {
            // A claim is not a completion: it marks where an interrupted
            // delivery resumes from, never that the wake happened.
            lifecycle?.agents.set(payload.agentId, {
              ...agent,
              claimedAt: event.timestamp,
            });
          } else {
            lifecycle?.agents.set(payload.agentId, {
              ...agent,
              notifiedAt: event.timestamp,
            });
          }
        }
        break;
      }
      case 'linear_mcp_auth.callback_relayed':
        break;
    }
  }

  return { open, lastCompleted };
}

interface LinearMcpAuthProjectionCache {
  fold: LinearMcpAuthFold;
  coveredSequence: number;
}

let projectionCache: LinearMcpAuthProjectionCache | null = null;

export function _resetLinearMcpAuthProjectionCacheForTests(): void {
  projectionCache = null;
  wakeFollowUpDelayMs = WAKE_FOLLOW_UP_MIN_DELAY_MS;
}

/**
 * Read the lifecycle fold from a maintained projection rather than rebuilding
 * it per poll. The projection advances incrementally: each read fetches only
 * auth-typed events newer than the covered sequence via an indexed SQL query
 * (`queryByTypesSince`), so unrelated retained history is never materialized
 * — a full `readFrom(0)` on the seven-day event table has blown the heap in
 * smoke testing, and the banner calls this path every 5–30 seconds per
 * connected client.
 */
async function readLinearMcpAuthFold(): Promise<LinearMcpAuthFold> {
  const store = await initEventStore();
  // The events table is a disposable cache — rebuilt, compacted, or purged
  // underneath us. If it now ends before the covered sequence, the cached
  // prefix is stale and the projection must restart from scratch.
  if (projectionCache !== null && store.getLatestSequence() < projectionCache.coveredSequence) {
    projectionCache = null;
  }
  const afterSequence = projectionCache?.coveredSequence ?? 0;
  const delta = store.queryByTypesSince([...LINEAR_MCP_AUTH_EVENT_TYPES], afterSequence);
  if (delta.length === 0 && projectionCache !== null) {
    return projectionCache.fold;
  }
  const fold = foldLinearMcpAuthEvents(delta, projectionCache?.fold);
  const lastEvent = delta[delta.length - 1];
  projectionCache = {
    fold,
    coveredSequence: lastEvent !== undefined ? lastEvent.sequence : afterSequence,
  };
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
const WAKE_FOLLOW_UP_MIN_DELAY_MS = 1000;
const WAKE_FOLLOW_UP_MAX_DELAY_MS = 60_000;

let wakeFollowUpDelayMs = WAKE_FOLLOW_UP_MIN_DELAY_MS;

/**
 * Record the completion of a delivery attempt. Kept tiny so both the normal
 * send path and the mail-reconciled recovery path share it.
 */
async function recordWakeCompletion(
  blockedAgent: LinearMcpAuthBlockedAgent,
  lifecycleId: string,
  outcome: LinearMcpAuthNotificationOutcome,
): Promise<void> {
  try {
    await appendLinearMcpAuthNotifiedEvent({
      agentId: blockedAgent.agentId,
      issueId: blockedAgent.issueId,
      outcome,
      lifecycleId,
    });
  } catch (completionError) {
    // The claim already bounds replay; a lost completion record leaves the
    // agent in the wake set with a claim, and the next pass reconciles
    // against the mail outbox instead of re-sending.
    console.error(`[linear-mcp-auth] failed to record wake outcome for ${blockedAgent.agentId}:`, completionError);
  }
}

export function processLinearMcpAuthWake(): Promise<void> {
  return linearMcpAuthWakeCoalescer.run('global', async () => {
    // Drain-until-stable: a healthy event that lands while this pass is
    // delivering wakes would otherwise be swallowed by the coalescer (its
    // trigger gets this in-flight promise back). Re-reading the fold after
    // each pass surfaces the newly completed lifecycle, so it gets its own
    // wake round inside the same coalesced run.
    let stabilized = false;
    for (let pass = 0; pass < MAX_WAKE_PASSES; pass++) {
      const wakeSet = await computeLinearMcpAuthWakeSet();
      if (wakeSet === null || wakeSet.agents.length === 0) {
        stabilized = true;
        wakeFollowUpDelayMs = WAKE_FOLLOW_UP_MIN_DELAY_MS;
        break;
      }
      for (const blockedAgent of wakeSet.agents) {
        if (blockedAgent.claimedAt !== null && blockedAgent.claimedAt !== undefined) {
          // Resume an interrupted claim. Every non-throwing path through
          // messageAgentWithOutcome backs the message up to the agent's
          // durable mail queue, so mail containing the wake copy at or after
          // the claim timestamp proves the acknowledged send reached the
          // outbox — complete the ledger WITHOUT re-sending. Mail absent
          // means the send never durably happened, so fall through and send.
          const alreadyDelivered = agentHasMailContentSince(
            blockedAgent.agentId,
            LINEAR_MCP_AUTH_WAKE_COPY,
            blockedAgent.claimedAt,
          );
          if (alreadyDelivered) {
            await recordWakeCompletion(blockedAgent, wakeSet.lifecycleId, 'delivered');
            continue;
          }
        } else {
          // Durable claim BEFORE delivery: the (lifecycleId, agentId) claim
          // marks the deterministic delivery key an interrupted attempt
          // resumes from. It is NOT terminal — the agent stays in the wake
          // set until a completion lands — so a crash after the claim still
          // produces exactly one eventual delivery, never zero and never two.
          try {
            await appendLinearMcpAuthNotifiedEvent({
              agentId: blockedAgent.agentId,
              issueId: blockedAgent.issueId,
              outcome: 'delivering',
              lifecycleId: wakeSet.lifecycleId,
            });
          } catch (claimError) {
            // Without the durable claim, an interrupted attempt cannot be
            // reconciled — skip this agent rather than risk a duplicate wake.
            console.error(`[linear-mcp-auth] failed to record wake claim for ${blockedAgent.agentId}; skipping delivery this pass:`, claimError);
            continue;
          }
        }

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
        await recordWakeCompletion(blockedAgent, wakeSet.lifecycleId, outcome);
      }
    }
    if (!stabilized) {
      // Every healthy trigger that arrived during this run received the same
      // coalesced promise, so no external retry is guaranteed. Schedule one
      // ourselves with bounded exponential backoff — a persistent EventStore
      // failure must not turn into a hot retry/log loop.
      console.error(`[linear-mcp-auth] wake pass did not stabilize after ${MAX_WAKE_PASSES} passes — scheduling a follow-up run in ${wakeFollowUpDelayMs}ms`);
      const timer = setTimeout(() => { void processLinearMcpAuthWake(); }, wakeFollowUpDelayMs);
      timer.unref();
      wakeFollowUpDelayMs = Math.min(wakeFollowUpDelayMs * 2, WAKE_FOLLOW_UP_MAX_DELAY_MS);
    }
  });
}
