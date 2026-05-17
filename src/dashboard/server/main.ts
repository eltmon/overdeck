/**
 * Dashboard server entry point — dual-runtime (Bun dev, Node prod) (PAN-428 B5)
 *
 * Usage (dev):   bun run src/dashboard/server/main.ts
 * Usage (prod):  node dist/dashboard/server.js
 */

import { Effect } from 'effect';
import { ServerConfigLayer } from './config.js';
import { runServer } from './server.js';
import { startSharedIssueService, getSharedIssueService } from './services/issue-service-singleton.js';
import { startAgentEnrichmentService, stopAgentEnrichmentService } from './services/agent-enrichment-service.js';
import { startConversationLifecycleService, stopConversationLifecycleService } from './services/conversation-lifecycle.js';
import { startTtsSummarizer, stopTtsSummarizer } from './services/tts-summarizer.js';
import { initTrackerConfigCache } from './services/tracker-config.js';
import { processPendingLifecycle } from './pending-lifecycle.js';
import { processPendingFeedbackDeliveries } from './pending-feedback.js';
import { setPipelineHandler } from '../../lib/pipeline-notifier.js';
import { ensureInternalToken } from '../../lib/internal-token.js';
import { clearStuckMergeStatuses, fixStuckReadyForMerge, fixStuckCommentedReviews, getReviewStatus, loadReviewStatuses, clearReviewStatus } from '../../lib/review-status.js';
import { enrichReviewStatus } from '../../lib/review-status-enrichment.js';
import { clearStuckForks } from '../../lib/database/conversations-db.js';
import { getEventStore } from './event-store.js';
import { emitActivityEntry, emitActivityTts } from '../../lib/activity-logger.js';
import { getCloisterService } from '../../lib/cloister/service.js';
import { shouldAutoStart } from '../../lib/cloister/config.js';
import { setAgentStoppedNotifier, setAgentStatusChangedNotifier, setMergeReadyNotifier } from '../../lib/cloister/deacon.js';
import { getAgentStateAsync, type AgentState } from '../../lib/agents.js';
import { resumeQueuedMerges } from './services/merge-queue-service.js';
import { mkdir } from 'node:fs/promises';
import { getPanopticonHome } from '../../lib/paths.js';
import { ensureManagedTmuxContextOnce } from '../../lib/tmux.js';
import { startCliproxyWatchdog } from './routes/cliproxy.js';
import { resumeSwarmAutoAdvanceLoopOnStartup } from './routes/swarm.js';
import { cleanupOrphanedConversationAttachments } from './services/conversation-attachments.js';

declare const Bun: unknown;

// Ensure PANOPTICON_HOME exists before any service that needs it (e.g. CacheService opening cache.db)
await mkdir(getPanopticonHome(), { recursive: true });

// Ensure the internal token exists before any in-process CLI sender resolves it (PAN-891).
// Generates and persists a random token at <PANOPTICON_HOME>/internal-token (mode 0600)
// on first start; reused on subsequent starts. Used by /api/internal/pipeline/notify.
ensureInternalToken();


// Prepare the managed tmux context exactly once, before any code path can spawn
// tmux. After this call `buildTmuxArgs`, `buildTmuxCommandString`, and
// `tmuxExecAsync` are effectively free — no per-call file writes, no per-call
// `start-server`/`source-file` round-trips. Critical for terminal attach latency
// and agent message delivery (PAN-785).
await ensureManagedTmuxContextOnce();
// Cache .panopticon.env content at startup to avoid blocking FS reads during request handling (PAN-70)
await initTrackerConfigCache().catch(err => {
  console.log('[tracker-config] Warning: failed to cache .panopticon.env:', err.message);
});

// Start the shared IssueDataService — fire and forget.
// It loads SQLite-cached data instantly and pushes an initial snapshot,
// then fetches fresh data from APIs in the background.
void startSharedIssueService().then(() => {
  console.log('[panopticon] IssueDataService background fetch complete');
  // Once the issue cache is warm, prune review-status rows for issues that
  // are CLOSED on the tracker. Without this, manually-closed issues
  // (`gh issue close` instead of `pan close`) leave stale review-state
  // behind, and the deacon keeps auto-resuming agents and re-dispatching
  // test specialists for them every patrol — observed on PAN-951 / PAN-512 /
  // PAN-714. Runs once per boot as a sweep; the canonical close-out flow
  // already calls clearReviewStatus on its own path.
  void pruneClosedIssueReviewStatuses().catch((err) => {
    console.warn('[panopticon] pruneClosedIssueReviewStatuses failed:', err?.message ?? err);
  });
});
console.log('[panopticon] IssueDataService started (non-blocking)');

// Start background enrichment poller — emits agent.enrichment_changed events
// for agentPhase, hasPendingQuestion, pendingQuestionCount, resolution, resolutionCount
startAgentEnrichmentService();
console.log('[panopticon] AgentEnrichmentService started');

// Wire up pipeline notifier → domain events.
// Library code (review-status.ts) calls notifyPipeline() on every status change.
// This handler converts those into domain events so the frontend Zustand store updates.
setPipelineHandler((event) => {
  switch (event.type) {
    case 'status_changed': {
      // Enrich async — fire-and-forget so the notifier stays sync.
      // Session-name discovery needs tmux, which is async; appending the event
      // is delayed by <1 tick which is fine because reviewSessionNames are only
      // needed for the TerminalTabs UI, not for DB state transitions.
      void (async () => {
        try {
          const enriched = await enrichReviewStatus(event.issueId, event.status);
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
console.log('[panopticon] Pipeline notifier → domain events wired');

function toAgentStatusPayload(status: AgentState['status'] | undefined) {
  return status === 'starting' || status === 'running' || status === 'stopped' || status === 'error'
    ? status
    : 'unknown';
}

function buildAgentStatusChangedPayload(state: AgentState, previousStatus?: AgentState['status']) {
  return {
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
}

// Wire up deacon → domain events for orphaned agent recovery.
// When deacon resets agent state directly, publish the saved state to live clients.
setAgentStoppedNotifier((agentId) => {
  void (async () => {
    try {
      const es = getEventStore();
      const state = await getAgentStateAsync(agentId);
      if (state) {
        es.append({
          type: 'agent.status_changed',
          timestamp: new Date().toISOString(),
          payload: buildAgentStatusChangedPayload(state),
        } as any);
        return;
      }
      es.append({
        type: 'agent.stopped',
        timestamp: new Date().toISOString(),
        payload: { agentId },
      } as any);
    } catch (err) {
      console.error('[pipeline] Failed to append agent stopped/status event:', err);
    }
  })();
});
setAgentStatusChangedNotifier((state, previousStatus) => {
  try {
    const es = getEventStore();
    es.append({
      type: 'agent.status_changed',
      timestamp: new Date().toISOString(),
      payload: buildAgentStatusChangedPayload(state, previousStatus),
    } as any);
  } catch (err) {
    console.error('[pipeline] Failed to append agent.status_changed event:', err);
  }
});
console.log('[panopticon] Agent stopped/status notifiers → domain events wired');

// Wire deacon merge-ready reminder → domain events so the frontend re-reads the
// Awaiting Merge list when deacon fires its 1h staleness reminder.
setMergeReadyNotifier((issueId) => {
  const status = getReviewStatus(issueId);
  if (!status) return;
  void (async () => {
    try {
      const enriched = await enrichReviewStatus(issueId, status);
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
console.log('[panopticon] Merge-ready notifier → domain events wired');

// Start background conversation lifecycle polling (10s interval)
startConversationLifecycleService();
console.log('[panopticon] ConversationLifecycleService started');

// Start cleanup for orphaned conversation attachments (1 min interval)
const attachmentCleanupTimer = setInterval(() => {
  void cleanupOrphanedConversationAttachments();
}, 60_000);
void cleanupOrphanedConversationAttachments();
console.log('[panopticon] Attachment cleanup started');

// Start TTS summarizer (off by default — only starts if tts.summarizer.enabled=true)
void startTtsSummarizer().catch(err => console.warn('[tts-summarizer] start failed:', err));

// Start CLIProxy watchdog — auto-restarts the sidecar if it crashes
startCliproxyWatchdog();
console.log('[panopticon] CLIProxy watchdog started (30s interval)');

// Clean up pollers on graceful shutdown
const emitShutdownActivity = () => {
  try {
    emitActivityEntry({
      source: 'dashboard',
      level: 'info',
      message: 'Dashboard stopping',
    });
    emitActivityTts({ utterance: 'Dashboard stopping', priority: 2 });
  } catch { /* non-fatal */ }
};
const handleShutdownSignal = (signal: NodeJS.Signals) => {
  console.log(`[panopticon] received ${signal} (pid=${process.pid} ppid=${process.ppid}) — shutting down`);
  emitShutdownActivity();
  clearInterval(attachmentCleanupTimer);
  stopAgentEnrichmentService();
  stopConversationLifecycleService();
  stopTtsSummarizer();
  process.exit(0);
};
process.once('SIGTERM', () => handleShutdownSignal('SIGTERM'));
process.once('SIGINT', () => handleShutdownSignal('SIGINT'));
process.once('SIGHUP', () => handleShutdownSignal('SIGHUP'));

// Clear any mergeStatus stuck at 'merging'/'verifying' from before the restart (PAN-490).
clearStuckMergeStatuses();
emitActivityEntry({ source: 'dashboard', level: 'info', message: 'Cleared stuck merge statuses on startup' });
// Mark any in-progress forks as failed — they were interrupted by the restart.
{ const n = clearStuckForks(); if (n) {
  console.log(`[panopticon] Marked ${n} stuck fork(s) as failed`);
  emitActivityEntry({ source: 'dashboard', level: 'warn', message: `Marked ${n} stuck fork(s) as failed on startup` });
} }
// Restore readyForMerge for issues where review+test passed but readyForMerge is stuck false.
fixStuckReadyForMerge();
// PAN-869: restore reviewStatus='passed' for issues with COMMENTED reviews that were incorrectly marked 'failed'
fixStuckCommentedReviews();

// Reset stuck merge queue entries (PAN-632): any 'processing' entries were
// in-flight when the server died — reset to 'queued' so they resume.
try {
  const { resetProcessingToQueued } = await import('../../lib/database/merge-queue-db.js');
  const resetCount = resetProcessingToQueued();
  if (resetCount > 0) {
    console.log(`[panopticon] Reset ${resetCount} stuck merge queue entries to queued`);
    emitActivityEntry({ source: 'dashboard', level: 'warn', message: `Reset ${resetCount} stuck merge queue entries to queued on startup` });
  }
  await resumeQueuedMerges();
} catch (err: any) {
  console.warn(`[panopticon] Failed to reset merge queue: ${err.message}`);
}

// Pending post-merge lifecycle hook (PAN-444) — see pending-lifecycle.ts for details
await processPendingLifecycle();
await processPendingFeedbackDeliveries();
await resumeSwarmAutoAdvanceLoopOnStartup();

// Non-canonical stash scan: walks every workspace at startup. Cheap when there
// are few workspaces, expensive when there are many (each scan does a git
// stash list + reflog walk per worktree). Gated behind PANOPTICON_DISABLE_DEACON
// alongside the cloister auto-start so the same escape hatch lets operators
// bring the dashboard up cleanly when there are too many workspaces.
if (process.env.PANOPTICON_DISABLE_DEACON !== '1') {
  void import('../../lib/cloister/deacon.js')
    .then(({ logNonCanonicalStashesOnStartup }) => logNonCanonicalStashesOnStartup())
    .then((findings) => {
      if (findings.length > 0) {
        emitActivityEntry({ source: 'dashboard', level: 'warn', message: `Detected ${findings.length} non-canonical stash(es) on startup; audit recommended` });
      }
    })
    .catch((err: any) => {
      console.warn(`[panopticon] Failed non-canonical stash startup scan: ${err.message}`);
    });
}

// Cloister/Deacon auto-start. Deacon is the Layer 3 safety net that catches
// work agents that forgot to call `pan done`, nudges dead-end agents,
// and detects stuck thinking loops. Without it, stalled agents are invisible.
//
// Emergency escape hatch: PANOPTICON_DISABLE_DEACON=1 skips auto-start even
// when config.startup.auto_start is true. Use this when deacon's first-cycle
// scan over many workspaces is starving the event loop and preventing the
// HTTP server from accepting connections (the "Bad Gateway after pan up"
// failure mode). The dashboard comes up clean; start cloister manually from
// the UI once the workspace backlog is cleaned up.
if (process.env.PANOPTICON_DISABLE_DEACON === '1') {
  console.log('[panopticon] Cloister auto-start SKIPPED (PANOPTICON_DISABLE_DEACON=1)');
  emitActivityEntry({ source: 'dashboard', level: 'warn', message: 'Cloister auto-start skipped via PANOPTICON_DISABLE_DEACON — deacon is not running' });
} else if (shouldAutoStart()) {
  getCloisterService().start().catch((err) => {
    console.error('[panopticon] Cloister auto-start failed:', err);
    emitActivityEntry({ source: 'dashboard', level: 'error', message: `Cloister auto-start failed: ${err instanceof Error ? err.message : String(err)}` });
  });
  console.log('[panopticon] Cloister auto-starting (startup.auto_start=true)');
  emitActivityEntry({ source: 'dashboard', level: 'info', message: 'Cloister auto-starting on dashboard boot' });
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
    console.log(`[panopticon] Pruned ${removed} stale review-status entr${removed === 1 ? 'y' : 'ies'} for closed issues`);
  }
}

const main = runServer.pipe(Effect.provide(ServerConfigLayer)) as Effect.Effect<never, unknown>;

if (typeof Bun !== 'undefined') {
  const { runMain } = await import('@effect/platform-bun/BunRuntime');
  runMain(main as never);
} else {
  const { runMain } = await import('@effect/platform-node/NodeRuntime');
  runMain(main as never);
}
