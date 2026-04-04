/**
 * Dashboard server entry point — dual-runtime (Bun dev, Node prod) (PAN-428 B5)
 *
 * Usage (dev):   bun run src/dashboard/server/main.ts
 * Usage (prod):  node dist/dashboard/server.js
 */

import { Effect } from 'effect';
import { readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ServerConfigLayer } from './config.js';
import { runServer } from './server.js';
import { startSharedIssueService } from './services/issue-service-singleton.js';
import { startAgentEnrichmentService, stopAgentEnrichmentService } from './services/agent-enrichment-service.js';

declare const Bun: unknown;

// Start the shared IssueDataService before the server
// This ensures issue data is available when the read model bootstraps
await startSharedIssueService();
console.log('[panopticon] IssueDataService started');

// Start background enrichment poller — emits agent.enrichment_changed events
// for agentPhase, hasPendingQuestion, pendingQuestionCount, resolution, resolutionCount
startAgentEnrichmentService();
console.log('[panopticon] AgentEnrichmentService started');

// Clean up enrichment poller on graceful shutdown
process.once('SIGTERM', () => stopAgentEnrichmentService());
process.once('SIGINT', () => stopAgentEnrichmentService());

// --- Pending post-merge lifecycle hook (PAN-444) ---
// After a merge-triggered rebuild+restart, the old server writes a pending file before dying.
// We pick it up here in the fresh process — all dynamic imports resolve to new chunk hashes.
const PENDING_FILE = join(homedir(), '.panopticon', 'pending-post-merge.json');
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const LIFECYCLE_DELAY_MS = 3000; // 3s — let server become ready first

if (existsSync(PENDING_FILE)) {
  (async () => {
    try {
      const raw = await readFile(PENDING_FILE, 'utf-8');
      await unlink(PENDING_FILE);

      const pending = JSON.parse(raw) as {
        issueId: string;
        projectPath: string;
        sourceBranch: string;
        timestamp: number;
      };

      const age = Date.now() - (pending.timestamp ?? 0);
      if (age > STALE_THRESHOLD_MS) {
        console.warn(`[panopticon] Ignoring stale pending-post-merge.json (age: ${Math.round(age / 60000)}min) for ${pending.issueId}`);
        return;
      }

      console.log(`[panopticon] Found pending post-merge lifecycle for ${pending.issueId} — scheduling in ${LIFECYCLE_DELAY_MS}ms`);

      setTimeout(async () => {
        try {
          const { postMergeLifecycle, notifyTldrDaemon } = await import('../../lib/cloister/merge-agent.js');
          await postMergeLifecycle(pending.issueId, pending.projectPath, pending.sourceBranch);
          if (pending.sourceBranch) {
            await notifyTldrDaemon(pending.projectPath, pending.sourceBranch);
          }
        } catch (err: any) {
          console.error(`[panopticon] Post-merge lifecycle failed for ${pending.issueId}: ${err.message}`);
        }
      }, LIFECYCLE_DELAY_MS);

    } catch (err: any) {
      console.warn(`[panopticon] Failed to process pending-post-merge.json: ${err.message}`);
    }
  })();
}
// --- end pending post-merge lifecycle hook ---

const main = runServer.pipe(Effect.provide(ServerConfigLayer)) as Effect.Effect<never, unknown>;

if (typeof Bun !== 'undefined') {
  const { runMain } = await import('@effect/platform-bun/BunRuntime');
  runMain(main as never);
} else {
  const { runMain } = await import('@effect/platform-node/NodeRuntime');
  runMain(main as never);
}
