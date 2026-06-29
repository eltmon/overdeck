/**
 * Dashboard server entry point — dual-runtime (Bun dev, Node prod) (PAN-428 B5)
 *
 * Usage (dev):   bun run src/dashboard/server/main.ts
 * Usage (prod):  node dist/dashboard/server.js
 */

import { Effect } from 'effect';
import { initDashboardLogFile } from './server-log-file.js';
import { ServerConfigLayer } from './config.js';
import { runServer } from './server.js';
import { startSharedIssueService, getSharedIssueService } from './services/issue-service-singleton.js';
import { startAgentEnrichmentService, stopAgentEnrichmentService } from './services/agent-enrichment-service.js';
import { startMergeBlockerReconcileService } from './services/merge-blocker-reconcile-service.js';
import { startAgentOutputService, stopAgentOutputService } from './services/agent-output-service.js';
import { startConversationLifecycleService, stopConversationLifecycleService } from './services/conversation-lifecycle.js';
import { startRestartAnnouncer, stopRestartAnnouncer } from './services/restart-announcer.js';
import { startSubstrateBugPoller, stopSubstrateBugPoller } from './services/substrate-bug-poller.js';
import { startUatTrainReconciler, stopUatTrainReconciler } from './services/uat-train.js';
import { startTtsSummarizer, stopTtsSummarizer } from './services/tts-summarizer.js';
import { startTtsPlayback, stopTtsPlayback } from './services/tts-playback.js';
import { refreshTtsRuntimeConfig } from './services/tts-runtime-config.js';
import { initTrackerConfigCache } from './services/tracker-config.js';
import { processPendingLifecycle } from './pending-lifecycle.js';
import { processPendingFeedbackDeliveries } from './pending-feedback.js';
import { setPipelineHandlerSync } from '../../lib/pipeline-notifier.js';
import { ensureInternalTokenSync } from '../../lib/internal-token.js';
import { clearStuckMergeStatuses, fixStuckReadyForMerge, fixStuckCommentedReviews, getReviewStatusSync, loadReviewStatuses, clearReviewStatus } from '../../lib/review-status.js';
import { reconcileStaleGitHubBlockers } from '../../lib/webhook-handlers.js';
import { enrichReviewStatus } from '../../lib/review-status-enrichment.js';
import { recoverStuckForks, waitForInFlightForkPipelines } from './routes/conversations.js';
import { getEventStore, initEventStore } from './event-store.js';
import { emitActivityEntrySync, emitActivityTtsSync } from '../../lib/activity-logger.js';
import { getCloisterService } from '../../lib/cloister/service.js';
import { shouldAutoStart } from '../../lib/cloister/config.js';
import { resetPatrolHeartbeatForStartup, setAgentStoppedNotifier, setAgentStatusChangedNotifier, setMergeReadyNotifier } from '../../lib/cloister/deacon.js';
import { getAgentState, type AgentState } from '../../lib/agents.js';
import { saveAgentStateAndEmitEvent } from './services/agent-projection.js';
import { resumeQueuedMerges } from './services/merge-queue-service.js';
import { mkdir } from 'node:fs/promises';
import { getOverdeckHome } from '../../lib/paths.js';
import { ensureManagedTmuxContextOnce } from '../../lib/tmux.js';
import { startCliproxyWatchdog } from './routes/cliproxy.js';
import { cleanupOrphanedConversationAttachments } from './services/conversation-attachments.js';
import { closeMemoryFtsDatabases } from '../../lib/memory/fts-db.js';
import { startTranscriptPoller, stopTranscriptPoller, syncTranscriptPollerRegistry } from '../../lib/memory/poller.js';
import { reconcileAgentMemory, reconcileStaleTranscriptCheckpoints } from '../../lib/memory/reconciliation.js';
import { clearQueryExpansionCache } from '../../lib/memory/query-expansion.js';
import { cleanupClosedIssueAgentDirectories } from '../../lib/agent-directory-cleanup.js';
import { startAutoMergeExecutor, stopAutoMergeExecutor } from './services/auto-merge-executor.js';
import { warnIfAutonomousMergeBackendUnavailable } from './services/merge-backend-health.js';
import { startConversationSearchWatcher, stopConversationSearchWatcher } from './services/conversation-search-watcher.js';
import { closeConversationSearchService } from './services/conversation-search-service.js';
import { startCostReconcileService, stopCostReconcileService } from './services/cost-reconcile-service.js';
import { formatBootGateState, resolveBootGates } from '../../lib/boot-gates.js';
import { startBootReconciliation } from '../../lib/cloister/boot-reconciliation.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Layer } from 'effect';
import { createOverdeckDatabase } from '../../../scripts/create-overdeck-db.js';
import { getOverdeckDatabasePath } from '../../lib/overdeck/paths.js';
import { ProjectsLive } from '../../lib/overdeck/config.js';
import { RecordsLive, TmuxLive } from '../../lib/overdeck/infra.js';
import { getAgentSessionsSync } from '../../lib/tmux.js';

declare const Bun: unknown;

// Persist this process's console output to <OVERDECK_HOME>/logs/dashboard.log
// in every launch mode (PAN-1552) — must run before any startup logging so the
// record (including conversation-message 500 causes) survives `serve`/npx and
// the desktop app, not just detached `pan up`.
initDashboardLogFile();
// Boot-timing anchor: performance.now() here is ms since process start, so this
// first line's value is the cost of loading/evaluating the bundled module graph
// (everything before the first statement runs). Combined with the per-line
// timestamps in dashboard.log and the "Listening" line, it makes the whole
// spawn→listen window attributable. See server.ts for the matching listen mark.
console.log(`[boot-timing] module graph loaded at +${Math.round(performance.now())}ms (since process start)`);
console.log(`[overdeck] Boot gates: ${formatBootGateState(resolveBootGates())}`);

// Ensure OVERDECK_HOME exists before any service that needs it (e.g. CacheService opening cache.db)
await mkdir(getOverdeckHome(), { recursive: true });

// Ensure the internal token exists before any in-process CLI sender resolves it (PAN-891).
// Generates and persists a random token at <OVERDECK_HOME>/internal-token (mode 0600)
// on first start; reused on subsequent starts. Used by /api/internal/pipeline/notify.
ensureInternalTokenSync();

void warnIfAutonomousMergeBackendUnavailable();

// Prepare the managed tmux context exactly once, before any code path can spawn
// tmux. After this call `buildTmuxArgs`, `buildTmuxCommandString`, and
// `tmuxExecAsync` are effectively free — no per-call file writes, no per-call
// `start-server`/`source-file` round-trips. Critical for terminal attach latency
// and agent message delivery (PAN-785).
await ensureManagedTmuxContextOnce();
// Cache .overdeck.env content at startup to avoid blocking FS reads during request handling (PAN-70)
await initTrackerConfigCache().catch(err => {
  console.log('[tracker-config] Warning: failed to cache .overdeck.env:', err.message);
});

// Start the shared IssueDataService — fire and forget.
// It loads SQLite-cached data instantly and pushes an initial snapshot,
// then fetches fresh data from APIs in the background.
//
// PAN-1817: peer dashboards inside workspace containers (OVERDECK_DISABLE_DEACON=1)
// load the SQLite cache and serve READ-ONLY without polling the trackers. The host
// `pan up` dashboard is the single tracker poller. Without this gate, every workspace
// container ran its own Linear/GitHub poller against the shared API key — ~17 of them
// at once exhausted Linear's 2500/hr quota. This mirrors the single-deacon invariant:
// a peer dashboard is a read/UI peer, never a second orchestrator.
const isPeerDashboard = process.env.OVERDECK_DISABLE_DEACON === '1';
if (isPeerDashboard) {
  void startSharedIssueService({ skipPolling: true });
  console.log('[overdeck] IssueDataService started in CACHE-ONLY mode — peer dashboard (OVERDECK_DISABLE_DEACON=1) does not poll trackers (PAN-1817)');
} else {
  void startSharedIssueService().then(() => {
    console.log('[overdeck] IssueDataService background fetch complete');
    // Once the issue cache is warm, prune review-status rows for issues that
    // are CLOSED on the tracker. Without this, manually-closed issues
    // (`gh issue close` instead of `pan close`) leave stale review-state
    // behind, and the deacon keeps auto-resuming agents and re-dispatching
    // test specialists for them every patrol — observed on PAN-951 / PAN-512 /
    // PAN-714. Runs once per boot as a sweep; the canonical close-out flow
    // already calls clearReviewStatus on its own path.
    void pruneClosedIssueReviewStatuses().catch((err) => {
      console.warn('[overdeck] pruneClosedIssueReviewStatuses failed:', err?.message ?? err);
    });
    void Effect.runPromise(cleanupClosedIssueAgentDirectories({
      issues: getSharedIssueService().getIssues({ cycle: 'all', includeCompleted: true }),
      force: true,
    })).then((result) => {
      if (result.removed.length > 0) {
        console.log(`[overdeck] Removed ${result.removed.length} old closed-issue agent dir${result.removed.length === 1 ? '' : 's'}: ${result.removed.join(', ')}`);
      }
      if (result.protected.length > 0) {
        console.warn(`[overdeck] Protected ${result.protected.length} old closed-issue agent dir${result.protected.length === 1 ? '' : 's'} because it has a live tmux session or JSONL file: ${result.protected.join(', ')}`);
      }
    }).catch((err) => {
      console.warn('[overdeck] cleanupClosedIssueAgentDirectories failed:', err?.message ?? err);
    });
  });
  console.log('[overdeck] IssueDataService started (non-blocking)');
}

// Start background enrichment poller — emits agent.enrichment_changed events
// for agentPhase, hasPendingQuestion, pendingQuestionCount, resolution, resolutionCount
startAgentEnrichmentService();
console.log('[overdeck] AgentEnrichmentService started');

// Start background agent output poller — emits agent.output_received domain events
// so DrawerActiveAgent and other consumers receive live stream excerpts.
startAgentOutputService();
console.log('[overdeck] AgentOutputService started');

// Start merge-blocker reconcile poller (PAN-1620) — proactively refreshes GitHub
// mergeability for readyForMerge PRs so a stale/conflicting one drops out of the
// Awaiting-Merge queue (and its live MERGE button) before any click.
startMergeBlockerReconcileService();
console.log('[overdeck] MergeBlockerReconcileService started');

// Wire up pipeline notifier → domain events.
// Library code (review-status.ts) calls notifyPipeline() on every status change.
// This handler converts those into domain events so the frontend Zustand store updates.
setPipelineHandlerSync((event) => {
  switch (event.type) {
    case 'status_changed': {
      // Enrich async — fire-and-forget so the notifier stays sync.
      // Session-name discovery needs tmux, which is async; appending the event
      // is delayed by <1 tick which is fine because reviewSessionNames are only
      // needed for the TerminalTabs UI, not for DB state transitions.
      void (async () => {
        try {
          const enriched = await Effect.runPromise(enrichReviewStatus(event.issueId, event.status));
          const es = getEventStore();
          es.append({
            type: 'review.status_changed',
            timestamp: new Date().toISOString(),
            payload: { issueId: event.issueId, status: enriched },
          } as any);
        } catch (err) {
          console.error('[pipeline] Failed to append status_changed event:', err);
        }
      })();
      return;
    }

    case 'review.approved':
    case 'test.passed': {
      try {
        const es = getEventStore();
        es.append({
          type: event.type,
          timestamp: new Date().toISOString(),
          payload: { issueId: event.issueId },
        } as any);
      } catch (err) {
        console.error(`[pipeline] Failed to append ${event.type} event:`, err);
      }
      return;
    }

    // PAN-915 — task_queued surfaces "review-agent dispatched" before the
    // first SQLite mutation lands. Maps to pipeline.review-started so the
    // kanban card flips to "review in progress" immediately.
    case 'task_queued': {
      try {
        const es = getEventStore();
        if (event.specialist === 'review-agent') {
          es.append({
            type: 'pipeline.review-started',
            timestamp: new Date().toISOString(),
            payload: { issueId: event.issueId },
          } as any);
        } else if (event.specialist === 'test-agent') {
          es.append({
            type: 'pipeline.test-started',
            timestamp: new Date().toISOString(),
            payload: { issueId: event.issueId },
          } as any);
        }
      } catch (err) {
        console.error('[pipeline] Failed to append task_queued event:', err);
      }
      return;
    }

    // PAN-915 — reviewer-level lifecycle events. Drives event-driven
    // reviewSubStatuses in the read model so the dashboard reflects per-role
    // status the instant a reviewer is dispatched or finishes.
    case 'reviewer_started': {
      try {
        const es = getEventStore();
        es.append({
          type: 'review.reviewer_started',
          timestamp: new Date().toISOString(),
          payload: {
            issueId: event.issueId,
            role: event.role,
            sessionName: event.sessionName,
          },
        } as any);
      } catch (err) {
        console.error('[pipeline] Failed to append reviewer_started event:', err);
      }
      return;
    }

    case 'reviewer_completed': {
      try {
        const es = getEventStore();
        es.append({
          type: 'review.reviewer_completed',
          timestamp: new Date().toISOString(),
          payload: { issueId: event.issueId, role: event.role },
        } as any);
      } catch (err) {
        console.error('[pipeline] Failed to append reviewer_completed event:', err);
      }
      return;
    }

    case 'reviewer_timed_out': {
      try {
        const es = getEventStore();
        es.append({
          type: 'review.specialist.timed_out',
          timestamp: new Date().toISOString(),
          payload: {
            issueId: event.issueId,
            role: event.role,
            sessionName: event.sessionName,
            attempt: event.attempt,
            maxRetries: event.maxRetries,
            willRetry: event.willRetry,
          },
        } as any);
      } catch (err) {
        console.error('[pipeline] Failed to append reviewer_timed_out event:', err);
      }
      return;
    }

    case 'coordinator_started': {
      try {
        const es = getEventStore();
        es.append({
          type: 'review.coordinator_started',
          timestamp: new Date().toISOString(),
          payload: { issueId: event.issueId, sessionName: event.sessionName },
        } as any);
      } catch (err) {
        console.error('[pipeline] Failed to append coordinator_started event:', err);
      }
      return;
    }

    case 'coordinator_died': {
      try {
        const es = getEventStore();
        es.append({
          type: 'review.coordinator.died',
          timestamp: new Date().toISOString(),
          payload: { issueId: event.issueId, sessionName: event.sessionName, reason: event.reason },
        } as any);
      } catch (err) {
        console.error('[pipeline] Failed to append coordinator_died event:', err);
      }
      return;
    }
  }
});
console.log('[overdeck] Pipeline notifier → domain events wired');

function toAgentStatusPayload(status: AgentState['status'] | undefined) {
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

// Wire up deacon → domain events for orphaned agent recovery.
// When deacon resets agent state directly, publish the saved state to live clients.
setAgentStoppedNotifier((agentId) => {
  void (async () => {
    try {
      const es = getEventStore();
      const state = await Effect.runPromise(getAgentState(agentId));
      if (state) {
        // heartbeat_dead only updates runtime snapshot; emit it directly.
        es.append({
          type: 'agent.heartbeat_dead',
          timestamp: new Date().toISOString(),
          payload: { agentId, issueId: state.issueId, sessionId: state.sessionId },
        } as any);
        // PAN-1908: write-through projection — agents-row upsert + lifecycle
        // event append in one SQLite transaction.
        saveAgentStateAndEmitEvent(state, {
          type: 'agent.status_changed',
          timestamp: new Date().toISOString(),
          payload: buildAgentStatusChangedPayload(state),
        });
        return;
      }
      es.append({
        type: 'agent.heartbeat_dead',
        timestamp: new Date().toISOString(),
        payload: { agentId },
      } as any);
    } catch (err) {
      console.error('[pipeline] Failed to append agent stopped/status event:', err);
    }
  })();
});
setAgentStatusChangedNotifier((state, previousStatus, hasLiveTmuxSession) => {
  try {
    // PAN-1908: write-through projection — agents-row upsert + lifecycle event
    // append in one SQLite transaction.
    saveAgentStateAndEmitEvent(state, {
      type: 'agent.status_changed',
      timestamp: new Date().toISOString(),
      payload: buildAgentStatusChangedPayload(state, previousStatus, hasLiveTmuxSession),
    });
  } catch (err) {
    console.error('[pipeline] Failed to append agent.status_changed event:', err);
  }
});
console.log('[overdeck] Agent stopped/status notifiers → domain events wired');

// Wire deacon merge-ready reminder → domain events so the frontend re-reads the
// Awaiting Merge list when deacon fires its 1h staleness reminder.
setMergeReadyNotifier((issueId) => {
  const status = getReviewStatusSync(issueId);
  if (!status) return;
  void (async () => {
    try {
      const enriched = await Effect.runPromise(enrichReviewStatus(issueId, status));
      const es = getEventStore();
      es.append({
        type: 'review.status_changed',
        timestamp: new Date().toISOString(),
        payload: { issueId, status: enriched },
      } as any);
    } catch (err) {
      console.error('[pipeline] Failed to append merge-ready event:', err);
    }
  })();
});
console.log('[overdeck] Merge-ready notifier → domain events wired');

// Start background conversation lifecycle polling (10s interval)
startConversationLifecycleService();
console.log('[overdeck] ConversationLifecycleService started');

startSubstrateBugPoller();

// PAN-1737 UAT batch trains: keep one assembled, testable batch ready at all
// times (gated per-tick on flywheel.merge_train_enabled; no-op without an
// active flywheel run).
startUatTrainReconciler();
console.log('[overdeck] UAT batch-train reconciler started');

// Start cleanup for orphaned conversation attachments (1 min interval)
const attachmentCleanupTimer = setInterval(() => {
  void cleanupOrphanedConversationAttachments();
}, 60_000);
void cleanupOrphanedConversationAttachments();
console.log('[overdeck] Attachment cleanup started');

// Start TTS summarizer (off by default — only starts if tts.summarizer.enabled=true)
await refreshTtsRuntimeConfig();
void startTtsSummarizer().catch(err => console.warn('[tts-summarizer] start failed:', err));
void startTtsPlayback().catch(err => console.warn('[tts-playback] start failed:', err));

void syncTranscriptPollerRegistry().catch(err => console.warn('[memory-poller] initial registry sync failed:', err?.message ?? err));
void reconcileStaleTranscriptCheckpoints({ log: (message) => console.log(message) })
  .catch(err => console.warn('[memory-reconciliation] startup sweep failed:', err?.message ?? err));
startTranscriptPoller();
console.log('[overdeck] Memory transcript poller started');

startCostReconcileService();
console.log('[overdeck] Cost reconciler started');

const conversationSearchWatcher = startConversationSearchWatcher();
console.log(conversationSearchWatcher
  ? '[overdeck] Conversation search watcher started'
  : '[overdeck] Conversation search watcher skipped (conversationSearch.enabled=false)');

void (async () => {
  const store = await initEventStore();
  store.subscribe((event) => {
    if (event.type === 'agent.stopped' || event.type === 'agent.heartbeat_dead') {
      const agentId = typeof (event.payload as { agentId?: unknown }).agentId === 'string'
        ? (event.payload as { agentId: string }).agentId
        : null;
      if (agentId) {
        void reconcileAgentMemory(agentId).catch(err => console.warn('[memory-reconciliation] agent sweep failed:', err?.message ?? err));
      }
      const sessionId = typeof (event.payload as { sessionId?: unknown }).sessionId === 'string'
        ? (event.payload as { sessionId: string }).sessionId
        : null;
      if (sessionId) clearQueryExpansionCache(sessionId);
    }
    if (event.type === 'agent.started' || event.type === 'agent.stopped' || event.type === 'agent.heartbeat_dead') {
      void syncTranscriptPollerRegistry().catch(err => console.warn('[memory-poller] lifecycle registry sync failed:', err?.message ?? err));
    }
  });
})().catch(err => console.warn('[memory-poller] lifecycle subscription failed:', err?.message ?? err));

// Start CLIProxy watchdog — auto-restarts the sidecar if it crashes
startCliproxyWatchdog();
console.log('[overdeck] CLIProxy watchdog started (30s interval)');

// Clean up pollers on graceful shutdown
const emitShutdownActivity = () => {
  try {
    emitActivityEntrySync({
      source: 'dashboard',
      level: 'info',
      message: 'Dashboard stopping',
    });
    emitActivityTtsSync({
      utterance: 'Dashboard stopping',
      priority: 2,
      source: 'dashboard',
      eventType: 'dashboard.stopping',
    });
  } catch { /* non-fatal */ }
};
let shuttingDown = false;
const handleShutdownSignal = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[overdeck] received ${signal} (pid=${process.pid} ppid=${process.ppid}) — shutting down`);
  emitShutdownActivity();
  const forkGrace = await waitForInFlightForkPipelines(10_000);
  if (forkGrace.count > 0) {
    if (forkGrace.completed) {
      console.log(`[overdeck] Waited for ${forkGrace.count} in-flight fork pipeline(s) before shutdown`);
    } else {
      console.warn(`[overdeck] ${forkGrace.count} in-flight fork pipeline(s) still running after shutdown grace window`);
    }
  }
  clearInterval(attachmentCleanupTimer);
  stopAgentEnrichmentService();
  stopAgentOutputService();
  stopConversationLifecycleService();
  stopSubstrateBugPoller();
  stopUatTrainReconciler();
  stopTtsSummarizer();
  stopTtsPlayback();
  stopAutoMergeExecutor();
  stopTranscriptPoller();
  stopCostReconcileService();
  stopRestartAnnouncer();
  await stopConversationSearchWatcher().catch((err) => console.warn('[conversation-search] watcher shutdown failed:', err));
  closeConversationSearchService();
  closeMemoryFtsDatabases();
  process.exit(0);
};
process.once('SIGTERM', () => void handleShutdownSignal('SIGTERM'));
process.once('SIGINT', () => void handleShutdownSignal('SIGINT'));
process.once('SIGHUP', () => void handleShutdownSignal('SIGHUP'));

// Announce dashboard restarts (supervisor watchdog / pan reload / pan restart)
// in the Awareness activity feed. Polls restart-status.json because the writer
// processes can't reach this server's event store — see restart-announcer.ts.
startRestartAnnouncer();
console.log('[overdeck] Restart announcer started');

// Clear any mergeStatus stuck at 'merging'/'verifying' from before the restart (PAN-490).
clearStuckMergeStatuses();
emitActivityEntrySync({ source: 'dashboard', level: 'info', message: 'Cleared stuck merge statuses on startup' });
// Resume recoverable in-progress forks after boot services settle (PAN-1744).
setTimeout(() => {
  void recoverStuckForks()
    .then((n) => {
      if (n > 0) {
        console.log(`[overdeck] Recovered ${n} stuck fork(s)`);
        emitActivityEntrySync({ source: 'dashboard', level: 'info', message: `Recovered ${n} stuck fork(s) on startup` });
      }
    })
    .catch((err) => {
      console.warn('[overdeck] Failed to recover stuck forks:', err);
      emitActivityEntrySync({ source: 'dashboard', level: 'warn', message: 'Failed to recover stuck forks on startup' });
    });
}, 1000);
// Restore readyForMerge for issues where review+test passed but readyForMerge is stuck false.
fixStuckReadyForMerge();
// PAN-869: restore reviewStatus='passed' for issues with COMMENTED reviews that were incorrectly marked 'failed'
fixStuckCommentedReviews();
// PAN-1771: re-derive GitHub-native blockers from live PR state. Webhooks missed
// while the server was down otherwise leave stale blockers pinning readyForMerge=false.
void reconcileStaleGitHubBlockers()
  .then((n) => {
    if (n > 0) {
      console.log(`[overdeck] Reconciled GitHub-native blockers for ${n} issue(s) on startup`);
      emitActivityEntrySync({ source: 'dashboard', level: 'info', message: `Reconciled GitHub-native blockers for ${n} issue(s) on startup` });
    }
  })
  .catch((err: any) => console.warn(`[overdeck] Startup blocker reconciliation failed: ${err.message}`));

// Reset stuck merge queue entries (PAN-632): any 'processing' entries were
// in-flight when the server died — reset to 'queued' so they resume.
try {
  const { resetProcessingToQueued } = await import('../../lib/overdeck/merge-sync.js');
  const resetCount = resetProcessingToQueued();
  if (resetCount > 0) {
    console.log(`[overdeck] Reset ${resetCount} stuck merge queue entries to queued`);
    emitActivityEntrySync({ source: 'dashboard', level: 'warn', message: `Reset ${resetCount} stuck merge queue entries to queued on startup` });
  }
  await resumeQueuedMerges();
} catch (err: any) {
  console.warn(`[overdeck] Failed to reset merge queue: ${err.message}`);
}

// Pending post-merge lifecycle hook (PAN-444) — see pending-lifecycle.ts for details
await processPendingLifecycle();
await processPendingFeedbackDeliveries();

// Cloister/Deacon auto-start. Deacon is the Layer 3 safety net that catches
// work agents that forgot to call `pan done`, nudges dead-end agents,
// and detects stuck thinking loops. Without it, stalled agents are invisible.
//
// Emergency escape hatch: OVERDECK_DISABLE_DEACON=1 skips auto-start even
// when config.startup.auto_start is true. Use this when deacon's first-cycle
// scan over many workspaces is starving the event loop and preventing the
// HTTP server from accepting connections (the "Bad Gateway after pan up"
// failure mode). The dashboard comes up clean; start cloister manually from
// the UI once the workspace backlog is cleaned up.
if (process.env.OVERDECK_DISABLE_AUTO_MERGE === '1') {
  console.log('[overdeck] Auto-merge executor SKIPPED (OVERDECK_DISABLE_AUTO_MERGE=1)');
} else {
  startAutoMergeExecutor();
  console.log('[overdeck] Auto-merge executor started');
}

if (process.env.OVERDECK_DISABLE_DEACON === '1') {
  console.log('[overdeck] Cloister auto-start SKIPPED (OVERDECK_DISABLE_DEACON=1)');
  emitActivityEntrySync({ source: 'dashboard', level: 'warn', message: 'Cloister auto-start skipped via OVERDECK_DISABLE_DEACON — deacon is not running' });
} else if (shouldAutoStart()) {
  startBootReconciliation();
  resetPatrolHeartbeatForStartup();
  getCloisterService().start().catch((err) => {
    console.error('[overdeck] Cloister auto-start failed:', err);
    emitActivityEntrySync({ source: 'dashboard', level: 'error', message: `Cloister auto-start failed: ${err instanceof Error ? err.message : String(err)}` });
  });
  console.log('[overdeck] Cloister auto-starting (startup.auto_start=true)');
  emitActivityEntrySync({ source: 'dashboard', level: 'info', message: 'Cloister auto-starting on dashboard boot' });
}

/**
 * Drop review-status rows for issues that are CLOSED on the tracker. Runs once
 * after the IssueDataService warm-fetch so closed issues don't keep waking the
 * deacon's orphan-recovery and feedback-redelivery loops.
 */
async function pruneClosedIssueReviewStatuses(): Promise<void> {
  const issues = getSharedIssueService().getIssues();
  const closed = new Set<string>();
  for (const issue of issues) {
    const id = (issue?.identifier ?? '').toString().toUpperCase();
    if (!id) continue;
    const state = (issue?.state ?? '').toString().toUpperCase();
    const status = (issue?.status ?? '').toString().toLowerCase();
    if (state === 'CLOSED' || status === 'done' || status === 'closed' || status === 'cancelled') {
      closed.add(id);
    }
  }
  if (closed.size === 0) return;

  const statuses = loadReviewStatuses();
  let removed = 0;
  for (const issueId of Object.keys(statuses)) {
    if (closed.has(issueId.toUpperCase())) {
      try {
        clearReviewStatus(issueId.toUpperCase());
        removed++;
      } catch {
        // Non-fatal — next boot will retry.
      }
    }
  }
  if (removed > 0) {
    console.log(`[overdeck] Pruned ${removed} stale review-status entr${removed === 1 ? 'y' : 'ies'} for closed issues`);
  }
}

// ── Overdeck boot: create overdeck.db if needed ──────────────────────────────
// A normal boot creates an EMPTY overdeck.db (fresh-install semantics). There is
// NO legacy seed / db↔db migration — overdeck state is JSON/git-backed (PAN-1983).
await (async () => {
  try {
    const overdeckDbPath = getOverdeckDatabasePath();
    if (!existsSync(overdeckDbPath)) {
      createOverdeckDatabase({ dbPath: overdeckDbPath });
      console.log(`[overdeck] Created overdeck.db at ${overdeckDbPath}`);
    }
  } catch (err) {
    // Non-fatal: dashboard continues with whatever data is in overdeck.db.
    console.warn('[overdeck] Overdeck db init failed (non-fatal):', err);
  }
})();

const main = runServer.pipe(Effect.provide(ServerConfigLayer)) as Effect.Effect<never, unknown>;

if (typeof Bun !== 'undefined') {
  const { runMain } = await import('@effect/platform-bun/BunRuntime');
  runMain(main as never);
} else {
  const { runMain } = await import('@effect/platform-node/NodeRuntime');
  runMain(main as never);
}
