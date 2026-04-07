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
import { processPendingLifecycle } from './pending-lifecycle.js';
import { setPipelineHandler } from '../../lib/pipeline-notifier.js';
import { clearStuckMergeStatuses } from '../../lib/review-status.js';
import { getEventStore } from './event-store.js';
import { getCloisterService } from '../../lib/cloister/service.js';
import { shouldAutoStart } from '../../lib/cloister/config.js';

declare const Bun: unknown;

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

// Start background conversation lifecycle polling (10s interval)
startConversationLifecycleService();
console.log('[panopticon] ConversationLifecycleService started');

// Clean up pollers on graceful shutdown
process.once('SIGTERM', () => {
  stopAgentEnrichmentService();
  stopConversationLifecycleService();
});
process.once('SIGINT', () => {
  stopAgentEnrichmentService();
  stopConversationLifecycleService();
});

// Clear any mergeStatus stuck at 'merging' from before the restart (PAN-490).
// Pending merges are in-memory only — they don't survive restarts.
clearStuckMergeStatuses();

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
