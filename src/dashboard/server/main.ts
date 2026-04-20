/**
 * Dashboard server entry point — dual-runtime (Bun dev, Node prod) (PAN-428 B5)
 *
 * Usage (dev):   bun run src/dashboard/server/main.ts
 * Usage (prod):  node dist/dashboard/server.js
 */

import { Effect } from 'effect';
import { ServerConfigLayer } from './config.js';
import { runServer } from './server.js';
import { startSharedIssueService } from './services/issue-service-singleton.js';
import { startAgentEnrichmentService, stopAgentEnrichmentService } from './services/agent-enrichment-service.js';
import { startConversationLifecycleService, stopConversationLifecycleService } from './services/conversation-lifecycle.js';
import { startTtsSummarizer, stopTtsSummarizer } from './services/tts-summarizer.js';
import { initTrackerConfigCache } from './services/tracker-config.js';
import { processPendingLifecycle } from './pending-lifecycle.js';
import { setPipelineHandler } from '../../lib/pipeline-notifier.js';
import { clearStuckMergeStatuses, fixStuckReadyForMerge, getReviewStatus } from '../../lib/review-status.js';
import { clearStuckForks } from '../../lib/database/conversations-db.js';
import { getEventStore } from './event-store.js';
import { emitActivityEntry, emitActivityTts } from '../../lib/activity-logger.js';
import { getCloisterService } from '../../lib/cloister/service.js';
import { shouldAutoStart } from '../../lib/cloister/config.js';
import { setAgentStoppedNotifier, setMergeReadyNotifier } from '../../lib/cloister/deacon.js';
import { getAgentState } from '../../lib/agents.js';
import { resumeQueuedMerges } from './services/merge-queue-service.js';
import { mkdir } from 'node:fs/promises';
import { getPanopticonHome } from '../../lib/paths.js';
import { ensureManagedTmuxContextOnce } from '../../lib/tmux.js';

declare const Bun: unknown;

// Ensure PANOPTICON_HOME exists before any service that needs it (e.g. CacheService opening cache.db)
await mkdir(getPanopticonHome(), { recursive: true });

// Prepare the managed tmux context exactly once, before any code path can spawn
// tmux. After this call `buildTmuxArgs`, `buildTmuxCommandString`, and
// `tmuxExecAsync` are effectively free — no per-call file writes, no per-call
// `start-server`/`source-file` round-trips. Critical for terminal attach latency
// and agent message delivery (PAN-785).
await ensureManagedTmuxContextOnce();

// Cache .panopticon.env content at startup to avoid blocking FS reads during request handling (PAN-70)
void initTrackerConfigCache().catch(err => {
  console.log('[tracker-config] Warning: failed to cache .panopticon.env:', err.message);
});

// Start the shared IssueDataService — fire and forget.
// It loads SQLite-cached data instantly and pushes an initial snapshot,
// then fetches fresh data from APIs in the background.
void startSharedIssueService().then(() => {
  console.log('[panopticon] IssueDataService background fetch complete');
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
  if (event.type === 'status_changed') {
    try {
      const es = getEventStore();
      es.append({
        type: 'review.status_changed',
        timestamp: new Date().toISOString(),
        payload: { issueId: event.issueId, status: event.status },
      } as any);
    } catch { /* non-fatal — event store may not be ready during early boot */ }
  }
});
console.log('[panopticon] Pipeline notifier → domain events wired');

// Wire up deacon → domain events for orphaned agent recovery.
// When deacon detects a running agent with no tmux session, it resets to stopped.
// This notifier emits agent.stopped so the read model and frontend update immediately.
setAgentStoppedNotifier((agentId) => {
  try {
    const es = getEventStore();
    es.append({
      type: 'agent.stopped',
      timestamp: new Date().toISOString(),
      payload: { agentId },
    } as any);
  } catch { /* non-fatal — event store may not be ready during early boot */ }
});
console.log('[panopticon] Agent stopped notifier → domain events wired');

// Wire deacon merge-ready reminder → domain events so the frontend re-reads the
// Awaiting Merge list when deacon fires its 1h staleness reminder.
setMergeReadyNotifier((issueId) => {
  try {
    const status = getReviewStatus(issueId);
    if (!status) return;
    const es = getEventStore();
    es.append({
      type: 'review.status_changed',
      timestamp: new Date().toISOString(),
      payload: { issueId, status },
    } as any);
  } catch { /* non-fatal */ }
});
console.log('[panopticon] Merge-ready notifier → domain events wired');

// Start background conversation lifecycle polling (10s interval)
startConversationLifecycleService();
console.log('[panopticon] ConversationLifecycleService started');

// Start TTS summarizer (off by default — only starts if tts.summarizer.enabled=true)
startTtsSummarizer();

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
process.once('SIGTERM', () => {
  emitShutdownActivity();
  stopAgentEnrichmentService();
  stopConversationLifecycleService();
  stopTtsSummarizer();
});
process.once('SIGINT', () => {
  emitShutdownActivity();
  stopAgentEnrichmentService();
  stopConversationLifecycleService();
  stopTtsSummarizer();
});

// Clear any mergeStatus stuck at 'merging'/'verifying' from before the restart (PAN-490).
clearStuckMergeStatuses();
// Mark any in-progress forks as failed — they were interrupted by the restart.
{ const n = clearStuckForks(); if (n) console.log(`[panopticon] Marked ${n} stuck fork(s) as failed`); }
// Restore readyForMerge for issues where review+test passed but readyForMerge is stuck false.
fixStuckReadyForMerge();
// Repair workflow labels for any GitHub issue that merged but still has in-review label (PAN-676).
// Also detect PRs already merged on GitHub with incorrect internal state (PAN-670 pattern).
import('../../lib/lifecycle/label-cleanup.js').then(({ repairMergedLabels, repairAlreadyMergedPRs, repairIncompletePostMergeLifecycle, repairClosedWontfixIssues, repairClosedPRs }) => {
  repairMergedLabels().catch(err => console.warn('[panopticon] repairMergedLabels failed:', err));
  repairAlreadyMergedPRs().catch(err => console.warn('[panopticon] repairAlreadyMergedPRs failed:', err));
  repairIncompletePostMergeLifecycle().catch(err => console.warn('[panopticon] repairIncompletePostMergeLifecycle failed:', err));
  repairClosedWontfixIssues().catch(err => console.warn('[panopticon] repairClosedWontfixIssues failed:', err));
  repairClosedPRs().catch(err => console.warn('[panopticon] repairClosedPRs failed:', err));
});

// Reset stuck merge queue entries (PAN-632): any 'processing' entries were
// in-flight when the server died — reset to 'queued' so they resume.
try {
  const { resetProcessingToQueued } = await import('../../lib/database/merge-queue-db.js');
  const resetCount = resetProcessingToQueued();
  if (resetCount > 0) {
    console.log(`[panopticon] Reset ${resetCount} stuck merge queue entries to queued`);
  }
  await resumeQueuedMerges();
} catch (err: any) {
  console.warn(`[panopticon] Failed to reset merge queue: ${err.message}`);
}

// Pending post-merge lifecycle hook (PAN-444) — see pending-lifecycle.ts for details
await processPendingLifecycle();

// Auto-start Cloister if configured (startup.auto_start = true in cloister config).
// Without this, Cloister had to be manually started after every dashboard restart.
if (shouldAutoStart()) {
  getCloisterService().start().catch((err) => {
    console.error('[panopticon] Cloister auto-start failed:', err);
  });
  console.log('[panopticon] Cloister auto-starting (startup.auto_start=true)');
}

const main = runServer.pipe(Effect.provide(ServerConfigLayer)) as Effect.Effect<never, unknown>;

if (typeof Bun !== 'undefined') {
  const { runMain } = await import('@effect/platform-bun/BunRuntime');
  runMain(main as never);
} else {
  const { runMain } = await import('@effect/platform-node/NodeRuntime');
  runMain(main as never);
}
