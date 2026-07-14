/** Cloister completion marker fallback seam. */
import { existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { AGENTS_DIR } from '../paths.js';

export interface CompletionHost {
  processedCompletions: Map<string, number>;
  getDashboardApiUrl(): string;
}

/** Fallback scan for completion markers when `pan done` did not reach the dashboard. */
export async function checkCompletionMarkers(host: CompletionHost): Promise<void> {
  try {
    if (!existsSync(AGENTS_DIR)) return;

    const agentDirs = readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('agent-'));

    for (const dir of agentDirs) {
      const completedFile = join(AGENTS_DIR, dir.name, 'completed');
      const processedFile = join(AGENTS_DIR, dir.name, 'completed.processed');

      // Skip if no completion marker.
      if (!existsSync(completedFile)) continue;

      // A stale `.processed` from a prior round must not block a fresh completion.
      if (existsSync(processedFile)) {
        try {
          const completedMtime = statSync(completedFile).mtimeMs;
          const processedMtime = statSync(processedFile).mtimeMs;
          if (completedMtime > processedMtime) {
            try { unlinkSync(processedFile); } catch {}
            host.processedCompletions.delete(dir.name);
            console.log(`🔔 Cloister: Detected re-completion for ${dir.name} (completed newer than .processed) — clearing stale marker`);
          } else {
            continue;
          }
        } catch {
          continue;
        }
      }

      // Skip stale completion markers (older than 24h) — just mark as processed
      try {
        const content = JSON.parse(readFileSync(completedFile, 'utf-8'));
        const ageMs = Date.now() - new Date(content.timestamp).getTime();
        if (ageMs > 24 * 60 * 60 * 1000) {
          console.log(`🔔 Cloister: Skipping stale completion marker for ${dir.name} (${Math.floor(ageMs / 3600000)}h old)`);
          host.processedCompletions.set(dir.name, Infinity);
          try { renameSync(completedFile, processedFile); } catch {}
          continue;
        }
      } catch (parseErr) {
        console.warn(`  ⚠ Cloister: Could not parse completion marker for ${dir.name}, skipping`);
        continue;
      }

      // Check retry count; reset stale in-memory counters for fresh completions.
      const retryCount = host.processedCompletions.get(dir.name) || 0;
      if (retryCount === Infinity) {
        host.processedCompletions.delete(dir.name);
      } else if (retryCount >= 3) continue;

      // Extract issue ID from agent dir name (e.g. "agent-pan-123" → "PAN-123")
      const issueId = dir.name.replace('agent-', '').toUpperCase();

      // Skip if `pan done` already triggered review.
      const { getReviewStatusSync } = await import('../review-status.js');
      const existingReview = getReviewStatusSync(issueId);
      if (existingReview && ['reviewing', 'passed'].includes(existingReview.reviewStatus || '')) {
        console.log(`🔔 Cloister: Completion marker for ${issueId} — review already ${existingReview.reviewStatus}, marking processed`);
        try { renameSync(completedFile, processedFile); } catch {}
        host.processedCompletions.set(dir.name, Infinity);
        continue;
      }

      console.log(`🔔 Cloister: Found completion marker for ${issueId}, triggering review...${retryCount > 0 ? ` (retry ${retryCount}/3)` : ''}`);

      try {
        // Use fetch() so https dashboard URLs work.
        const result = await (async (): Promise<{ success: boolean; error?: string; alreadyReviewed?: boolean; alreadyMerged?: boolean }> => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          try {
            const res = await fetch(`${host.getDashboardApiUrl()}/api/review/${issueId}/trigger`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
              signal: controller.signal,
            });
            clearTimeout(timer);
            try {
              return (await res.json()) as { success: boolean; error?: string; alreadyReviewed?: boolean; alreadyMerged?: boolean };
            } catch {
              return { success: false, error: `Invalid response (HTTP ${res.status})` };
            }
          } catch (e: unknown) {
            clearTimeout(timer);
            if (e instanceof Error && e.name === 'AbortError') return { success: false, error: 'Timeout (5s)' };
            return { success: false, error: e instanceof Error ? e.message : String(e) };
          }
        })();

        if (result.success) {
          console.log(`  ✓ Review triggered for ${issueId}`);
          renameSync(completedFile, processedFile);
          host.processedCompletions.set(dir.name, Infinity);
        } else if (result.alreadyReviewed || result.alreadyMerged) {
          // Terminal state — already handled, mark as processed
          console.log(`  ✓ ${issueId} already ${result.alreadyMerged ? 'merged' : 'reviewed'}, marking processed`);
          renameSync(completedFile, processedFile);
          host.processedCompletions.set(dir.name, Infinity);
        } else {
          // Transient failure — increment retry count, will retry on next cycle
          host.processedCompletions.set(dir.name, retryCount + 1);
          console.log(`  ⚠ Review trigger failed for ${issueId}: ${result.error || 'unknown'} (will retry, ${2 - retryCount} attempts left)`);
        }
      } catch (err: unknown) {
        host.processedCompletions.set(dir.name, retryCount + 1);
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ Failed to trigger review for ${issueId}: ${message} (will retry, ${2 - retryCount} attempts left)`);
      }
    }
  } catch (error) {
    // Non-fatal - just skip this check
  }
}
