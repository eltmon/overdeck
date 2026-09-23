/**
 * Dashboard server entry point — dual-runtime (Bun dev, Node prod) (PAN-428 B5)
 *
 * Usage (dev):   bun run src/dashboard/server/main.ts
 * Usage (prod):  node dist/dashboard/server.js
 */

// PAN-2593: MUST stay the first import — fixes child PATH before anything spawns.
import './path-env.js';
import { Effect } from 'effect';
import { initDashboardLogFile } from './server-log-file.js';
import { ServerConfigLayer } from './config.js';
import { runServer } from './server.js';
import { startSharedIssueService, getSharedIssueService } from './services/issue-service-singleton.js';
import { startAgentEnrichmentService, stopAgentEnrichmentService } from './services/agent-enrichment-service.js';
import { startResourceRefreshTriggers } from './services/resource-refresh-triggers.js';
import {
  enqueueProjectsResourceRefresh,
  getProjectResourceRefreshQueueState,
  startProjectResourceConvergence,
  stopProjectResourceRefreshQueue,
  whenProjectResourceRefreshIdle,
} from './services/project-resource-refresh-queue.js';
import { whenDashboardListening } from './dashboard-listening.js';
import { startAgentOutputService, stopAgentOutputService } from './services/agent-output-service.js';
import { startConversationLifecycleService, stopConversationLifecycleService } from './services/conversation-lifecycle.js';
import { startCodexPluginImporter, stopCodexPluginImporter } from './services/codex-plugin-importer.js';
import { startRestartAnnouncer, stopRestartAnnouncer } from './services/restart-announcer.js';
import { startUatTrainReconciler, stopUatTrainReconciler } from './services/uat-train.js';
import { startTtsSummarizer, stopTtsSummarizer } from './services/tts-summarizer.js';
import { startTtsPlayback, stopTtsPlayback } from './services/tts-playback.js';
import { refreshTtsRuntimeConfig } from './services/tts-runtime-config.js';
import { initTrackerConfigCache } from './services/tracker-config.js';
import { processPendingLifecycle } from './pending-lifecycle.js';
import { processPendingFeedbackDeliveries } from './pending-feedback.js';
import { initRestartGate } from './services/restart-gate.js';
import { setPipelineHandlerSync } from '../../lib/pipeline-notifier.js';
import { ensureInternalTokenSync } from '../../lib/internal-token.js';
import { recoverStuckForks, waitForInFlightForkPipelines } from '../../lib/overdeck/conversation-forks.js';
import { getEventStore, initEventStore } from './event-store.js';
import { emitActivityEntrySync, emitActivityTtsSync } from '../../lib/activity-logger.js';
import { shouldAutoStart } from '../../lib/cloister/config.js';
import { setAgentStoppedNotifier, setAgentStatusChangedNotifier } from '../../lib/cloister/deacon-lite.js';
import { getAgentState, type AgentState } from '../../lib/agents.js';
import { saveAgentStateAndEmitEvent } from './services/agent-projection.js';
import { resumeQueuedMerges } from './services/merge-queue-service.js';
import { mkdir } from 'node:fs/promises';
import { getOverdeckHome } from '../../lib/paths.js';
import { startCliproxyWatchdogForDashboard } from './routes/cliproxy.js';
import { startResourcesSnapshotService } from './routes/resources/snapshot.js';
import { cleanupOrphanedConversationAttachments } from './services/conversation-attachments.js';
import { closeMemoryFtsDatabases } from '../../lib/memory/fts-db.js';
import { startTranscriptPoller, stopTranscriptPoller, syncTranscriptPollerRegistry } from '../../lib/memory/poller.js';
import { reconcileAgentMemory, reconcileStaleTranscriptCheckpoints } from '../../lib/memory/reconciliation.js';
import { clearQueryExpansionCache } from '../../lib/memory/query-expansion.js';
import { cleanupClosedIssueAgentDirectories } from '../../lib/agent-directory-cleanup.js';
import { startAutoMergeExecutor, stopAutoMergeExecutor } from './services/auto-merge-executor.js';
import { warnIfAutonomousMergeBackendUnavailable } from './services/merge-backend-health.js';
import { warnIfAppCannotMerge } from './services/merge-app-scopes-health.js';
import { startConversationSearchWatcher, stopConversationSearchWatcher } from './services/conversation-search-watcher.js';
import { startConversationRescanScheduler, stopConversationRescanScheduler } from './services/conversation-rescan-scheduler.js';
import { closeConversationSearchService } from './services/conversation-search-service.js';
import { startCostReconcileService, stopCostReconcileService } from './services/cost-reconcile-service.js';
import { startEventLoopMonitor, stopEventLoopMonitor } from './services/event-loop-monitor.js';
import { formatBootGateState, resolveBootGates } from '../../lib/boot-gates.js';
import { setLastCleanShutdownAt } from '../../lib/overdeck/control-settings.js';
import { startDeaconChild, stopDeaconChild } from './services/deacon-supervisor.js';
import { stopAllKnowledgeViewers } from './services/knowledge-viewer.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Layer } from 'effect';
import { createOverdeckDatabase } from '../../../scripts/create-overdeck-db.js';
import { getOverdeckDatabasePath } from '../../lib/overdeck/paths.js';
import { startProjectCiRefillAfterProjectionReady } from './services/project-ci-refill-startup.js';
import { ProjectsLive } from '../../lib/overdeck/config.js';
import { RecordsLive, TmuxLive, dropPipelineStateMirrorTablesSync, dropDeadIssuesForeignKeysSync } from '../../lib/overdeck/infra.js';
import { startServerBootTelemetry } from './telemetry.js';
import { isPeerDashboardProcess } from '../../lib/boot-gates.js';
import { isSmeeConfiguredSync, startSmeeProcessSync } from '../../lib/smee.js';
import { listProjectsSync } from '../../lib/projects.js';
import { backfillIssueWorkspaces, migrateMemoryHomesToWorkspacesOnce, seedProjectsFromYaml } from '../../lib/workspaces/rebuild.js';
import { broadcastServerRestarting } from './ws-terminal.js';

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
// PAN-3956: name the terminal backend once, and say loudly when the default
// cannot serve — a tmux fallback used to happen here in silence.
void (async () => {
  try {
    const { selectTerminalBackend, probeHerdrAvailability, describeTerminalBackendBoot } =
      await import('../../lib/terminal-backends/select.js');
    const { loadConfigSync } = await import('../../lib/config-yaml.js');
    const selection = await selectTerminalBackend(loadConfigSync().config);
    const probe = selection.backend === 'herdr' ? await probeHerdrAvailability() : null;
    const { level, line } = describeTerminalBackendBoot(selection, probe);
    console[level](line);
  } catch (err) {
    console.warn('[terminal] backend selection could not be logged:', err instanceof Error ? err.message : String(err));
  }
})();

// Ensure OVERDECK_HOME exists before any service that needs it (e.g. CacheService opening cache.db)
await mkdir(getOverdeckHome(), { recursive: true });

// Ensure the internal token exists before any in-process CLI sender resolves it (PAN-891).
// Generates and persists a random token at <OVERDECK_HOME>/internal-token (mode 0600)
// on first start; reused on subsequent starts. Used by /api/internal/pipeline/notify.
ensureInternalTokenSync();

// PAN-785 prepared the managed tmux context here, before any code path could spawn
// tmux. Since PAN-1379 made `ensureManagedTmuxContextOnce` an Effect, the
// `await` here returned the unrun Effect and prepared nothing: the context has
// been prepared lazily by the first `tmuxExecAsync` call instead. PAN-3958 CH-3
// removed the dead call rather than start running it. Running it would start a
// persistent (`exit-empty off`) managed tmux server at boot on Herdr hosts,
// through a sync `execFileSync` path. Restoring it is an operator decision.
// Cache .overdeck.env content at startup to avoid blocking FS reads during request handling (PAN-70)
await initTrackerConfigCache().catch(err => {
  console.log('[tracker-config] Warning: failed to cache .overdeck.env:', err.message);
});

// A normal boot creates an EMPTY overdeck.db (fresh-install semantics). There is
// NO legacy seed / db↔db migration — overdeck state is JSON/git-backed (PAN-1983).
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

// PAN-3917 fix10: the pipeline-state mirror drop is a DESTRUCTIVE migration, so
// it runs here — once, and only in a primary dashboard. A peer shares another
// dashboard's overdeck.db; running it there dropped `agents` out from under the
// live 0.51.0 server, which then crash-looped. See infra.ts for both gates.
try {
  const drop = dropPipelineStateMirrorTablesSync();
  if (drop.dropped) {
    console.log('[overdeck] Dropped the pipeline-state mirror tables (once; marker written)');
  } else if (drop.skipped === 'peer') {
    console.log('[overdeck] Pipeline-state mirror drop SKIPPED — peer dashboard runs no destructive migration');
  }
} catch (err) {
  console.warn('[overdeck] Pipeline-state mirror drop failed (non-fatal):', err);
}

// PAN-3963: rebuild the live tables whose `issue_id → issues(id)` FK rejects
// every post-cut issue id (nothing writes `issues` since the Cut). Same gates
// as the mirror drop above: once, and only in a primary dashboard.
try {
  const fkDrop = dropDeadIssuesForeignKeysSync();
  if (fkDrop.dropped) {
    console.log(`[overdeck] Dropped the dead issues FKs (once; marker written) — rebuilt: ${fkDrop.tables.join(', ') || 'none (already clean)'}`);
  } else if (fkDrop.skipped === 'peer') {
    console.log('[overdeck] Dead-issues-FK rebuild SKIPPED — peer dashboard runs no destructive migration');
  }
} catch (err) {
  console.warn('[overdeck] Dead-issues-FK rebuild failed (non-fatal):', err);
}

// Bind the HTTP socket before starting any background service or the Deacon.
// A bind failure is retried by server.ts and then terminates this process through
// Effect's Node runtime; no headless orchestrator is allowed to survive it.
const main = runServer.pipe(Effect.provide(ServerConfigLayer)) as Effect.Effect<never, unknown>;
if (typeof Bun !== 'undefined') {
  const { runMain } = await import('@effect/platform-bun/BunRuntime');
  runMain(main as never);
} else {
  const { runMain } = await import('@effect/platform-node/NodeRuntime');
  runMain(main as never);
}
await whenDashboardListening();
startServerBootTelemetry();

startEventLoopMonitor();
console.log('[overdeck] Event loop delay monitor started');
void warnIfAutonomousMergeBackendUnavailable();
void warnIfAppCannotMerge();

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
const isPeerDashboard = isPeerDashboardProcess();
if (isPeerDashboard) {
  void startSharedIssueService({ skipPolling: true });
  console.log('[overdeck] IssueDataService started in CACHE-ONLY mode — peer dashboard (OVERDECK_DISABLE_DEACON=1) does not poll trackers (PAN-1817)');
} else {
  void startSharedIssueService().then(() => {
    console.log('[overdeck] IssueDataService background fetch complete');
    // PAN-3917: there are no review-status rows to prune. A manually-closed
    // issue derives to `closed` on the next read, so nothing stale survives it.
    void cleanupClosedIssueAgentDirectories({
      issues: getSharedIssueService().getIssues({ cycle: 'all', includeCompleted: true }),
      force: true,
    }).then((result) => {
      if (result.removed.length > 0) {
        console.log(`[overdeck] Pruned ${result.removed.length} old closed-issue agent dir${result.removed.length === 1 ? '' : 's'} (state and transcripts kept): ${result.removed.join(', ')}`);
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

// Enable demand-driven agent output capture. The poller starts only while an
// RPC or public SSE subscriber has expressed output interest.
startAgentOutputService();
console.log('[overdeck] AgentOutputService started');

// PAN-3917: the merge-blocker, review-status, and stale-check reconcilers are
// gone. Mergeability, review state, and check state are read from the forge at
// request time through services/derived-issue-state.ts — there is no stored
// copy left for a poller to reconcile.

// Desktop installs never run `pan install`, so provision the Claude Code hook
// bundle (auto-approve, heartbeat, cost, lifecycle) at boot (PAN-2595).
// Idempotent + delta-only; skips (with a logged reason) rather than failing
// the boot, and never overwrites an unparseable settings.json (PAN-1137).
if (process.env.OVERDECK_MODE === 'desktop') {
  void (async () => {
    try {
      const { provisionClaudeHooks } = await import('../../lib/claude-hooks-provision.js');
      const result = await provisionClaudeHooks();
      if (!result.ok) {
        console.warn(`[overdeck] Claude hook provisioning skipped: ${result.reason}`);
      } else if (result.changed) {
        console.log(`[overdeck] Claude hooks provisioned: ${result.binariesSynced} scripts, registered ${result.registered.length} hook(s)${result.pruned.length ? `, pruned ${result.pruned.length} stale` : ''}`);
      } else {
        console.log('[overdeck] Claude hooks already provisioned (no settings change)');
      }
    } catch (err) {
      console.warn('[overdeck] Claude hook provisioning failed:', err instanceof Error ? err.message : String(err));
    }
  })();
}

// Wire up pipeline notifier → domain events, so the frontend Zustand store
// updates on review and test outcomes. PAN-3917: there is no `status_changed`
// variant — nothing stores a status to change.
setPipelineHandlerSync((event) => {
  switch (event.type) {
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

    // The append-only pipeline journal (cloister/pipeline-journal.ts). The
    // entry is already durable in the workspace; this projects it into the
    // event stream so a live reader sees the action at the moment it happened.
    case 'pipeline.entry': {
      try {
        const es = getEventStore();
        es.append({
          type: 'pipeline.journal',
          timestamp: new Date().toISOString(),
          payload: { issueId: event.issueId, entry: event.entry },
        } as any);
      } catch (err) {
        console.error('[pipeline] Failed to append pipeline.journal event:', err);
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
        // PAN-2633: heartbeat_dead means the deacon has determined the tmux
        // session is gone, so assert hasLiveTmuxSession: false explicitly.
        saveAgentStateAndEmitEvent(state, {
          type: 'agent.status_changed',
          timestamp: new Date().toISOString(),
          payload: buildAgentStatusChangedPayload(state, undefined, false),
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

// PAN-3917: the deacon's 1h merge-ready staleness reminder is gone — deacon-lite
// runs four routines (FR-11) and this is not one of them. The Awaiting Merge
// list is derived on read, so it has nothing to be reminded about.

// Start background conversation lifecycle polling (10s interval)
startConversationLifecycleService();
console.log('[overdeck] ConversationLifecycleService started');

// PAN-3920 W20: register Codex-plugin jobs as external agents the first time
// they are seen (the plugin deletes its job records when the parent session
// ends). Read-only over the plugin's files; a peer dashboard registers nothing.
if (!isPeerDashboard && startCodexPluginImporter()) {
  console.log('[overdeck] Codex-plugin job importer started');
}

// PAN-1737 UAT batch trains: keep one assembled, testable batch ready at all
// times. Gated per-tick on the merge-train setting; there is no flywheel run
// to wait for (PAN-3917 D12).
if (startUatTrainReconciler()) {
  console.log('[overdeck] UAT batch-train reconciler started');
} else {
  console.log('[overdeck] UAT batch-train reconciler skipped — non-primary dashboard process');
}

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

// PAN-1990: seed the projects/workspaces runtime tables from projects.yaml +
// existing feature-* worktrees. Idempotent; never removes or modifies rows.
seedProjectsFromYaml();
console.log('[overdeck] Workspaces boot seeding started');

// PAN-1990 WI-6 review fix: migration reads issue-workspace rows that
// backfillIssueWorkspaces() creates, so it must not start until backfill has
// SUCCEEDED — a `.catch().then()` chain (cycle 2's version of this) still
// starts migration after a backfill rejection, causing an avoidable partial
// scan against issue rows that were never created this boot. A skipped
// migration here is still retried on the next boot: migrateMemoryHomesToWorkspacesOnce's
// marker is only written once every scanned legacy home resolves, so no boot
// can silently strand one.
void (async () => {
  try {
    await backfillIssueWorkspaces();
  } catch (err) {
    console.warn('[workspaces] issue-worktree backfill failed:', (err as Error)?.message ?? err);
    return;
  }
  try {
    const result = await migrateMemoryHomesToWorkspacesOnce();
    if (result) console.log(`[memory-migration] migrated ${result.migrated}/${result.scanned} legacy memory home(s), ${result.unresolvable.length} unresolvable`);
  } catch (err) {
    console.warn('[memory-migration] boot migration failed:', (err as Error)?.message ?? err);
  }
})();

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

startConversationRescanScheduler();
console.log('[overdeck] Conversation rescan scheduler started (boot pass + 6h interval)');

let stopResourceRefreshServices = () => undefined;

void (async () => {
  const store = await initEventStore();
  // Request serving comes first. Resource convergence starts only after the
  // Node 22 server has bound its socket, then all boot/event/periodic work flows
  // through the same non-overlapping project queue.
  void whenDashboardListening().then(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const stopTriggers = startResourceRefreshTriggers();
    const stopConvergence = startProjectResourceConvergence();
    const stopResourcesSnapshot = startResourcesSnapshotService();
    stopResourceRefreshServices = () => {
      stopTriggers();
      stopConvergence();
      stopResourcesSnapshot();
      stopProjectResourceRefreshQueue();
    };
    console.log('[overdeck] Project resource refresh queue and resources snapshot service started');

    const warmStart = Date.now();
    enqueueProjectsResourceRefresh(
      listProjectsSync().map((entry) => entry.config),
      'boot-warm',
    );
    await whenProjectResourceRefreshIdle();
    const queueState = getProjectResourceRefreshQueueState();
    if (queueState.lastError) {
      console.warn('[overdeck] Boot cache warm completed with errors:', queueState.lastError);
    } else {
      console.log(`[overdeck] Boot cache warm complete in ${Math.round((Date.now() - warmStart) / 1000)}s`);
    }
  }).catch((err) => {
    console.warn('[overdeck] Resource refresh startup failed:', err instanceof Error ? err.message : String(err));
  });
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
if (startCliproxyWatchdogForDashboard(isPeerDashboard)) {
  console.log('[overdeck] CLIProxy watchdog started (30s interval)');
} else {
  console.log('[overdeck] CLIProxy watchdog skipped — peer dashboard (OVERDECK_DISABLE_DEACON=1)');
}

if (isPeerDashboard) {
  console.log('[overdeck] smee-client webhook relay skipped — peer dashboard (OVERDECK_DISABLE_DEACON=1)');
} else if (isSmeeConfiguredSync()) {
  try {
    startSmeeProcessSync();
    console.log('[overdeck] smee-client webhook relay ensured');
  } catch (err) {
    console.warn('[overdeck] Failed to ensure smee-client webhook relay:', err instanceof Error ? err.message : String(err));
    emitActivityEntrySync({ source: 'dashboard', level: 'warn', message: `Failed to ensure smee-client webhook relay: ${err instanceof Error ? err.message : String(err)}` });
  }
} else {
  console.log('[overdeck] smee-client webhook relay not configured');
}

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
  try {
    setLastCleanShutdownAt(new Date().toISOString());
  } catch (err) {
    console.warn('[overdeck] failed to record clean shutdown marker:', err);
  }
  console.log(`[overdeck] received ${signal} (pid=${process.pid} ppid=${process.ppid}) — shutting down`);
  try {
    const notifiedClients = broadcastServerRestarting();
    console.log(`[overdeck] notified ${notifiedClients} terminal client(s) of restart`);
  } catch (err) {
    console.warn('[overdeck] failed to notify terminal clients of restart:', err);
  }
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
  stopResourceRefreshServices();
  stopAgentEnrichmentService();
  stopAgentOutputService();
  stopConversationLifecycleService();
  stopCodexPluginImporter();
  stopUatTrainReconciler();
  stopTtsSummarizer();
  stopTtsPlayback();
  stopAutoMergeExecutor();
  stopEventLoopMonitor();
  stopTranscriptPoller();
  stopCostReconcileService();
  stopRestartAnnouncer();
  await stopAllKnowledgeViewers().catch((err) => console.warn('[knowledge-viewer] shutdown failed:', err?.message ?? err));
  await stopDeaconChild().catch((err) => console.warn('[deacon-supervisor] child shutdown failed:', err?.message ?? err));
  try {
    // Reap only quality-gate trees owned by this dashboard process. Normal
    // verification runs in a detached supervised worker, whose process-local
    // registry is intentionally outside this shutdown boundary.
    const { killAllGateProcessGroups } = await import('../../lib/cloister/validation.js');
    const reaped = killAllGateProcessGroups();
    if (reaped > 0) console.log(`[overdeck] reaped ${reaped} in-flight gate process group(s)`);
  } catch (err) {
    console.warn('[overdeck] gate process reap failed:', err);
  }
  await stopConversationSearchWatcher().catch((err) => console.warn('[conversation-search] watcher shutdown failed:', err));
  await stopConversationRescanScheduler();
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

// PAN-3917: the four boot repairs that lived here — clearing a stuck merge
// status (PAN-490), restoring merge readiness, restoring a review status
// mis-marked from a COMMENTED review (PAN-869), and re-deriving GitHub-native
// blockers after missed webhooks (PAN-1771) — all repaired a stored copy of a
// fact the forge owns. There is no copy left to repair.
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
// PAN-3537: seed the per-project CI chip before the first webhook arrives, and
// repair it every 15 minutes so a dropped webhook delivery cannot leave a
// long-running dashboard showing an indefinitely stale CI state. The Effect
// layer marks readiness only after event-store events can reach the read model;
// starting earlier can persist the fill while silently missing its projection.
await startProjectCiRefillAfterProjectionReady(15 * 60 * 1000);

// Reset stuck merge queue entries (PAN-632): any 'processing' entries were
// in-flight when the server died — reset to 'queued' so they resume.
//
// fix10: every step below writes to state the primary owns or sets work going
// that spawns agents (resumeQueuedMerges → merge → post-merge lifecycle →
// `pan knowledge --retro`; processPendingLifecycle does the same directly;
// processPendingFeedbackDeliveries writes into the primary's live agent panes).
// A peer dashboard is a read/UI peer and starts none of it.
if (isPeerDashboard) {
  console.log('[overdeck] Merge-queue repair, post-merge lifecycle and feedback replay SKIPPED — peer dashboard spawns nothing');
} else {
  try {
    const { resetProcessingToQueued, requeueOrphanedMergingAutoMerges } = await import('../../lib/overdeck/merge-sync.js');
    const resetCount = resetProcessingToQueued();
    if (resetCount > 0) {
      console.log(`[overdeck] Reset ${resetCount} stuck merge queue entries to queued`);
      emitActivityEntrySync({ source: 'dashboard', level: 'warn', message: `Reset ${resetCount} stuck merge queue entries to queued on startup` });
    }
    // PAN-3328: an auto-merge row left in 'merging' by a crash is invisible to the
    // problems endpoint and to the deacon reconciler — requeue it so it is retried.
    const requeuedAutoMerges = requeueOrphanedMergingAutoMerges();
    if (requeuedAutoMerges > 0) {
      console.log(`[overdeck] Requeued ${requeuedAutoMerges} orphaned auto-merge row(s) from merging to pending`);
      emitActivityEntrySync({ source: 'dashboard', level: 'warn', message: `Requeued ${requeuedAutoMerges} orphaned auto-merge row(s) stuck in merging on startup` });
    }
    await resumeQueuedMerges();
  } catch (err: any) {
    console.warn(`[overdeck] Failed to reset merge queue: ${err.message}`);
  }

  // Pending post-merge lifecycle hook (PAN-444) — see pending-lifecycle.ts for details
  await processPendingLifecycle();
  await processPendingFeedbackDeliveries();
}

// Restart gate (PAN-3729): if the previous server died to perform an approved
// restart, this boot IS that restart completing — mark the epoch's requesters
// satisfied so they stop waiting. Also starts the sweep that expires stale
// requests so the approval banner clears itself.
await initRestartGate().catch((err: unknown) => {
  console.warn(`[overdeck] Restart gate init failed: ${err instanceof Error ? err.message : String(err)}`);
});

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
if (startAutoMergeExecutor()) {
  console.log('[overdeck] Auto-merge executor started');
} else if (isPeerDashboard) {
  console.log('[overdeck] Auto-merge executor SKIPPED — peer dashboard spawns nothing');
} else {
  console.log('[overdeck] Auto-merge executor SKIPPED (OVERDECK_DISABLE_AUTO_MERGE=1)');
}

// PAN-3917: boot used to reset verification runs left `running` by a worker
// that died. A verification result IS its artifact — an interrupted run simply
// left none, so the next gate run re-verifies. There is no stored status to
// reconcile.

if (isPeerDashboard) {
  console.log('[overdeck] Cloister auto-start SKIPPED (OVERDECK_DISABLE_DEACON=1)');
  emitActivityEntrySync({ source: 'dashboard', level: 'warn', message: 'Cloister auto-start skipped via OVERDECK_DISABLE_DEACON — deacon is not running' });
} else if (shouldAutoStart()) {
  // PAN-3917: there is no state plane left to migrate, so nothing gates the
  // Deacon's boot any more — deacon-lite reads the forge and the terminal
  // backend and writes no status.
  startDeaconChild().catch((err) => {
    console.error('[overdeck] Cloister auto-start failed:', err);
    emitActivityEntrySync({ source: 'dashboard', level: 'error', message: `Cloister auto-start failed: ${err instanceof Error ? err.message : String(err)}` });
  });
  console.log('[overdeck] Cloister auto-starting (startup.auto_start=true)');
  emitActivityEntrySync({ source: 'dashboard', level: 'info', message: 'Cloister auto-starting on dashboard boot' });
}
