import type { DomainEvent } from '@overdeck/contracts';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  initEventStore,
  type StoredEvent,
} from '../dashboard/server/event-store.js';
import { getAgentDir } from './agents/agent-state.js';
import { AmbiguousKeyedDeliveryError } from './agents/delivery.js';
import { messageAgentWithOutcome } from './agents/messaging.js';
import { isKeyedSubmitBlockedMenuError, KeyedMarkerVerificationError, KeyedSubmitTargetDeadError } from './tmux-dedup.js';
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
  /** Projection-only enrichment attached by the GET route from the issues
   * resolver; never persisted in lifecycle events. */
  issueUrl?: string | null;
  /** Projection-only enrichment attached by the GET route from the
   * conversations read door: the canonical /conv/<rowid> dashboard URL for
   * conv-* agents; never persisted in lifecycle events. */
  conversationUrl?: string | null;
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
        // 'delivering' rows from earlier iterations are not completions and
        // are ignored: interrupted deliveries are resumed through the keyed
        // outbox (see deliverWakeWithOutbox), not the event log.
        if (agent !== undefined && payload.outcome !== 'delivering') {
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

// ── Keyed wake outbox ────────────────────────────────────────────────────────
//
// The durable delivery receipt for one (lifecycleId, agentId) wake. Unlike a
// claim flag in the event log, the entry is lifecycle-keyed, carries the
// intended message and the delivery state/outcome, and is updated by the
// delivery wrapper itself on every path — so every acknowledged send has a
// receipt, recovery resumes only unacknowledged entries, and no cross-
// lifecycle content or timestamp matching is involved. Writes are temp-file +
// rename (atomic on POSIX) and all I/O is async (NFR-1).

export interface LinearMcpWakeOutboxEntry {
  lifecycleId: string;
  agentId: string;
  message: string;
  state: 'pending' | 'acknowledged';
  outcome?: LinearMcpAuthNotificationOutcome;
  createdAt: string;
  acknowledgedAt?: string;
}

function wakeOutboxPath(agentId: string, lifecycleId: string): string {
  return join(getAgentDir(agentId), 'linear-mcp-wake', `${lifecycleId}.json`);
}

async function readWakeOutbox(agentId: string, lifecycleId: string): Promise<LinearMcpWakeOutboxEntry | null> {
  try {
    const raw = await readFile(wakeOutboxPath(agentId, lifecycleId), 'utf-8');
    return JSON.parse(raw) as LinearMcpWakeOutboxEntry;
  } catch {
    return null;
  }
}

async function writeWakeOutbox(entry: LinearMcpWakeOutboxEntry): Promise<void> {
  const path = wakeOutboxPath(entry.agentId, entry.lifecycleId);
  await mkdir(join(getAgentDir(entry.agentId), 'linear-mcp-wake'), { recursive: true });
  const tmpPath = `${path}.${process.pid}.tmp`;
  await writeFile(tmpPath, JSON.stringify(entry, null, 2), 'utf-8');
  await rename(tmpPath, path);
}

interface WakeDelivery {
  /** True when this call actually invoked the delivery door. */
  sent: boolean;
  outcome: LinearMcpAuthNotificationOutcome;
}

/**
 * Deliver one lifecycle's wake through the keyed outbox. An acknowledged
 * entry suppresses the replay and replays only its recorded outcome — a
 * crash after the ack write never produces a second send, and the recorded
 * outcome stays faithful ('queued' is never upgraded to 'delivered'). A
 * pending or missing entry is (re)driven: a crash before the ack write
 * replays the send, which is correct because that send was never
 * acknowledged.
 */
async function deliverWakeWithOutbox(agentId: string, lifecycleId: string): Promise<WakeDelivery> {
  const existing = await readWakeOutbox(agentId, lifecycleId);
  if (existing?.state === 'acknowledged' && existing.outcome !== undefined) {
    return { sent: false, outcome: existing.outcome };
  }
  if (existing === null) {
    await writeWakeOutbox({
      lifecycleId,
      agentId,
      message: LINEAR_MCP_AUTH_WAKE_COPY,
      state: 'pending',
      createdAt: new Date().toISOString(),
    });
  }

  let outcome: LinearMcpAuthNotificationOutcome;
  try {
    // The key is threaded to the delivery door, where the crash-independent
    // component (supervisor key set / tmux session option) deduplicates the
    // side effect itself. A dashboard crash after a completed delivery can
    // still replay THIS call (the outbox ack may not have landed), but the
    // replayed delivery deduplicates at the door — the agent never sees the
    // same keyed wake twice.
    outcome = await messageAgentWithOutcome(
      agentId,
      LINEAR_MCP_AUTH_WAKE_COPY,
      'linear-mcp-auth-wake',
      { dedupKey: `linear-mcp-auth-wake:${lifecycleId}` },
    );
  } catch (error) {
    // AMBIGUOUS keyed delivery (cycle 8): the supervisor may have completed
    // the injection but its answer never arrived. Do NOT record a terminal
    // 'failed' — leave the entry pending so the next wake pass (or boot
    // recovery) retries the SAME key at the SAME tier, where the supervisor's
    // in-flight reservation/delivered set deduplicates it. At-most-once is
    // preserved by the door; a terminal record would either lose a wake that
    // never landed or misreport one that did.
    //
    // DEAD TARGET (cycle 9): the tmux submit found the pane dead and sent NO
    // Enter, deliberately preserving the pending claim and leaving the key
    // non-terminal. Same handling: the entry stays pending so a later pass
    // re-drives the wake — by then messageAgent's zombie/stopped detection
    // resumes the agent and the keyed door of the new session delivers.
    //
    // BLOCKING MENU (PAN-3212): the harness swallowed the paste and Enter was
    // deliberately withheld. Keep the outbox pending so the next pass re-drives
    // the same key; the tmux recovery path proves payload presence and re-pastes
    // when the old pending claim contains no visible text.
    //
    // UNVERIFIED MARKERS (cycle 13): a safety-critical marker read failed
    // mid-repair/rollback, so the marker state is unproven and the poison
    // breadcrumb stays authoritative. Same handling: pending, retried later.
    if (
      error instanceof AmbiguousKeyedDeliveryError
      || error instanceof KeyedSubmitTargetDeadError
      || isKeyedSubmitBlockedMenuError(error)
      || error instanceof KeyedMarkerVerificationError
    ) {
      throw error;
    }
    outcome = 'failed';
  }
  await writeWakeOutbox({
    lifecycleId,
    agentId,
    message: LINEAR_MCP_AUTH_WAKE_COPY,
    state: 'acknowledged',
    outcome,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    acknowledgedAt: new Date().toISOString(),
  });
  return { sent: true, outcome };
}

/**
 * Record the completion of a delivery attempt in the lifecycle event log —
 * this, not the outbox receipt, is what removes the agent from the wake set.
 * If the append fails, the agent stays in the wake set but the acknowledged
 * outbox entry suppresses any replay: the next pass only retries this
 * completion record.
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
        try {
          const delivery = await deliverWakeWithOutbox(blockedAgent.agentId, wakeSet.lifecycleId);
          await recordWakeCompletion(blockedAgent, wakeSet.lifecycleId, delivery.outcome);
        } catch (deliveryError) {
          // The outbox itself is unreadable/unwritable — without a durable
          // receipt an interrupted attempt cannot be reconciled, so skip this
          // agent rather than risk an unreconciled replay.
          console.error(`[linear-mcp-auth] wake outbox failure for ${blockedAgent.agentId}; skipping this pass:`, deliveryError);
        }
      }
    }
    if (!stabilized) {
      // Every healthy trigger that arrived during this run received the same
      // coalesced promise, so no external retry is guaranteed. Schedule one
      // ourselves with bounded exponential backoff — a persistent outbox or
      // EventStore failure must not turn into a hot retry/log loop.
      console.error(`[linear-mcp-auth] wake pass did not stabilize after ${MAX_WAKE_PASSES} passes — scheduling a follow-up run in ${wakeFollowUpDelayMs}ms`);
      const timer = setTimeout(() => { void processLinearMcpAuthWake(); }, wakeFollowUpDelayMs);
      timer.unref();
      wakeFollowUpDelayMs = Math.min(wakeFollowUpDelayMs * 2, WAKE_FOLLOW_UP_MAX_DELAY_MS);
    }
  });
}
