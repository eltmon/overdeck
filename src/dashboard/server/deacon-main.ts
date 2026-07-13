import { Effect } from 'effect';
import { randomUUID } from 'node:crypto';
import { setActivityEventStoreProvider } from '../../lib/activity-logger.js';
import { getAgentState, type AgentState } from '../../lib/agents.js';
import { setCloisterEventStoreProvider, getCloisterService } from '../../lib/cloister/service.js';
import {
  resetPatrolHeartbeatForStartup,
  runPatrol,
  setAgentStoppedNotifier,
  setAgentStatusChangedNotifier,
  setMergeReadyNotifier,
} from '../../lib/cloister/deacon.js';
import { createDeaconEventClient } from '../../lib/cloister/deacon-event-client.js';
import { getReviewStatusSync } from '../../lib/review-status.js';
import { enrichReviewStatus } from '../../lib/review-status-enrichment.js';
import { ensureInternalTokenSync } from '../../lib/internal-token.js';
import { flushAllPendingAutoCommits } from '../../lib/pan-dir/auto-commit.js';
import type { DomainEvent } from '@overdeck/contracts';

function internalDashboardUrl(): string {
  const port = Number.parseInt(process.env.API_PORT ?? process.env.PORT ?? '3011', 10);
  return process.env.OVERDECK_INTERNAL_DASHBOARD_URL ?? `http://127.0.0.1:${port}`;
}

function toAgentStatusPayload(status: AgentState['status']): 'starting' | 'running' | 'stopped' | 'error' | 'unknown' {
  return status === 'starting' || status === 'running' || status === 'stopped' || status === 'error'
    ? status
    : 'unknown';
}

function buildAgentStatusChangedPayload(
  state: AgentState,
  previousStatus?: AgentState['status'],
  hasLiveTmuxSession?: boolean,
) {
  const payload = {
    agentId: state.id,
    issueId: state.issueId,
    status: toAgentStatusPayload(state.status),
    previousStatus: previousStatus ? toAgentStatusPayload(previousStatus) : undefined,
    paused: state.paused === true,
    pausedReason: state.pausedReason ?? null,
    pausedAt: state.pausedAt ?? null,
    troubled: state.troubled === true,
    troubledAt: state.troubledAt ?? null,
    consecutiveFailures: state.consecutiveFailures ?? 0,
    firstFailureInRunAt: state.firstFailureInRunAt ?? null,
    lastFailureAt: state.lastFailureAt ?? null,
    lastFailureReason: state.lastFailureReason ?? null,
    lastFailureNextRetryAt: state.lastFailureNextRetryAt ?? null,
  };
  return hasLiveTmuxSession === undefined ? payload : { ...payload, hasLiveTmuxSession };
}

const eventClient = createDeaconEventClient({
  dashboardUrl: internalDashboardUrl(),
  token: ensureInternalTokenSync(),
});

function append(event: Omit<DomainEvent, 'sequence'>): void {
  eventClient.append(event);
}

function domainEvent(type: string, payload: unknown): Omit<DomainEvent, 'sequence'> {
  return {
    type,
    timestamp: new Date().toISOString(),
    payload,
  } as Omit<DomainEvent, 'sequence'>;
}

setActivityEventStoreProvider(() => eventClient);
setCloisterEventStoreProvider(() => eventClient);

setAgentStoppedNotifier((agentId) => {
  void (async () => {
    try {
      const state = await Effect.runPromise(getAgentState(agentId));
      if (state) {
        append(domainEvent('agent.heartbeat_dead', { agentId, issueId: state.issueId, sessionId: state.sessionId }));
        // PAN-2633: heartbeat_dead means the deacon has determined the tmux
        // session is gone, so assert hasLiveTmuxSession: false explicitly.
        append(domainEvent('agent.status_changed', buildAgentStatusChangedPayload(state, undefined, false)));
        return;
      }
      append(domainEvent('agent.heartbeat_dead', { agentId }));
    } catch (err) {
      console.error('[deacon-child] Failed to append agent stopped/status event:', err);
    }
  })();
});

setAgentStatusChangedNotifier((state, previousStatus, hasLiveTmuxSession) => {
  append(domainEvent('agent.status_changed', buildAgentStatusChangedPayload(state, previousStatus, hasLiveTmuxSession)));
});

setMergeReadyNotifier((issueId) => {
  const status = getReviewStatusSync(issueId);
  if (!status) return;
  void (async () => {
    try {
      const enriched = await Effect.runPromise(enrichReviewStatus(issueId, status));
      append(domainEvent('review.status_changed', { issueId, status: enriched }));
    } catch (err) {
      console.error('[deacon-child] Failed to append merge-ready event:', err);
    }
  })();
});

process.on('message', (message) => {
  if (!message || typeof message !== 'object') return;
  if ((message as { type?: unknown }).type === 'patrol') {
    void runPatrol().catch((err) => {
      console.error('[deacon-child] patrol request failed:', err);
    });
    return;
  }
  if ((message as { type?: unknown }).type === 'reload-config') {
    try {
      getCloisterService().reloadConfig();
    } catch (err) {
      console.error('[deacon-child] config reload request failed:', err);
    }
  }
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[deacon-child] received ${signal}; stopping Cloister`);
  try {
    getCloisterService().stop();
  } catch (err) {
    console.error('[deacon-child] Cloister stop failed:', err);
  }
  await Effect.runPromise(flushAllPendingAutoCommits()).catch((err) => {
    console.error('[deacon-child] auto-commit shutdown flush failed:', err);
  });
  await eventClient.flushNow().catch(() => undefined);
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('disconnect', () => void shutdown('SIGTERM'));

resetPatrolHeartbeatForStartup();
getCloisterService().start().catch((err) => {
  console.error('[deacon-child] Cloister start failed:', err);
  append(domainEvent('activity.entry', {
    id: randomUUID(),
    source: 'supervisor',
    level: 'error',
    message: `Deacon child failed to start Cloister: ${err instanceof Error ? err.message : String(err)}`,
  }));
  void eventClient.flushNow().finally(() => process.exit(1));
});
