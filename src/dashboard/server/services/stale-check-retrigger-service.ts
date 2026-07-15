import { Effect } from 'effect';
import { getMergeBlockerReconcileCandidates } from '../../../lib/overdeck/review-status-sync.js';
import { computeRedWindows, selectRerunCandidates, type RedWindow } from '../../../lib/cloister/stale-check-classifier.js';
import {
  getPrHead,
  listPrHeadFailingRuns,
  listRecentMainRuns,
  rerunFailedRun,
} from '../../../lib/cloister/stale-check-github.js';

interface PrRef { repo: string; number: number }
interface CachedWindows { probedAt: number; windows: Map<string, RedWindow[]> }
interface ServiceState {
  timer: ReturnType<typeof setInterval> | null;
  repoWindows: Map<string, CachedWindows>;
  lastEvaluated: Map<string, number>;
  attemptedRunIds: Map<number, number>;
  loggedSkips: Map<number, number>;
  inFlight: boolean;
}

const POLL_INTERVAL_MS = 60_000;
const MAIN_PROBE_INTERVAL_MS = 3 * 60_000;
const EVAL_INTERVAL_MS = 10 * 60_000;
const MAX_RERUNS_PER_TICK = 5;
const RUN_STATE_RETENTION_MS = 24 * 60 * 60_000;

const serviceState: ServiceState = {
  timer: null,
  repoWindows: new Map(),
  lastEvaluated: new Map(),
  attemptedRunIds: new Map(),
  loggedSkips: new Map(),
  inFlight: false,
};

function pruneState(state: ServiceState, issueIds: Set<string>, repos: Set<string>, now: number): void {
  for (const issueId of state.lastEvaluated.keys()) {
    if (!issueIds.has(issueId)) state.lastEvaluated.delete(issueId);
  }
  for (const repo of state.repoWindows.keys()) {
    if (!repos.has(repo)) state.repoWindows.delete(repo);
  }
  for (const [runId, recordedAt] of state.attemptedRunIds) {
    if (now - recordedAt >= RUN_STATE_RETENTION_MS) state.attemptedRunIds.delete(runId);
  }
  for (const [runId, recordedAt] of state.loggedSkips) {
    if (now - recordedAt >= RUN_STATE_RETENTION_MS) state.loggedSkips.delete(runId);
  }
}

function parsePrUrl(url: string | undefined | null): PrRef | null {
  if (!url) return null;
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  return match ? { repo: `${match[1]}/${match[2]}`, number: Number(match[3]) } : null;
}

async function windowsForRepo(state: ServiceState, repo: string, now: number): Promise<Map<string, RedWindow[]>> {
  const cached = state.repoWindows.get(repo);
  if (cached && now - cached.probedAt < MAIN_PROBE_INTERVAL_MS) return cached.windows;
  const windows = computeRedWindows(await listRecentMainRuns(repo));
  state.repoWindows.set(repo, { probedAt: now, windows });
  return windows;
}

async function tickOnce(state: ServiceState): Promise<void> {
  try {
    const allCandidates = await Effect.runPromise(getMergeBlockerReconcileCandidates());
    const candidates = allCandidates.flatMap((candidate) => {
      const ref = parsePrUrl(candidate.prUrl);
      const failing = candidate.blockerReasons?.some((blocker) => blocker.type === 'failing_checks');
      return ref && failing ? [{ candidate, ref }] : [];
    });
    const now = Date.now();
    pruneState(
      state,
      new Set(candidates.map(({ candidate }) => candidate.issueId)),
      new Set(candidates.map(({ ref }) => ref.repo)),
      now,
    );
    if (candidates.length === 0) return;

    let retriggered = 0;
    let skipped = 0;

    for (const { candidate, ref } of candidates) {
      if (retriggered >= MAX_RERUNS_PER_TICK) break;
      const last = state.lastEvaluated.get(candidate.issueId) ?? 0;
      if (now - last < EVAL_INTERVAL_MS) continue;

      const windows = await windowsForRepo(state, ref.repo, now);
      const head = await getPrHead(ref.repo, ref.number);
      if (!head) {
        state.lastEvaluated.set(candidate.issueId, now);
        continue;
      }
      const runs = await listPrHeadFailingRuns(ref.repo, head.headRefName, head.headRefOid);
      const selection = selectRerunCandidates(runs, windows);

      for (const entry of selection.skipped) {
        skipped++;
        if (!state.loggedSkips.has(entry.run.databaseId)) {
          state.loggedSkips.set(entry.run.databaseId, now);
          console.log(`[stale-check-retrigger] skipping run ${entry.run.databaseId} for ${candidate.issueId}: ${entry.reason}`);
        }
      }

      let deferred = false;
      for (const run of selection.rerun) {
        if (state.attemptedRunIds.has(run.databaseId)) continue;
        if (retriggered >= MAX_RERUNS_PER_TICK) {
          deferred = true;
          break;
        }
        const window = windows.get(run.workflowName)?.find(({ start, end }) =>
          end !== null && start <= run.createdAt && run.createdAt < end);
        state.attemptedRunIds.set(run.databaseId, now);
        const succeeded = await rerunFailedRun(ref.repo, run.databaseId);
        if (succeeded && window?.end) {
          retriggered++;
          console.log(`[stale-check-retrigger] re-ran run ${run.databaseId} (${run.workflowName}) for ${candidate.issueId} PR #${ref.number}: failed at ${run.createdAt} inside main red window ${window.start} → ${window.end}`);
        } else {
          skipped++;
        }
      }
      if (!deferred) state.lastEvaluated.set(candidate.issueId, now);
    }

    console.log(`[stale-check-retrigger] ${candidates.length} candidate PR(s) with failing_checks; ${retriggered} re-triggered, ${skipped} skipped`);
  } catch (error) {
    console.warn('[stale-check-retrigger] tick failed:', error instanceof Error ? error.message : String(error));
  }
}

async function runTickIfIdle(state: ServiceState): Promise<void> {
  if (state.inFlight) return;
  state.inFlight = true;
  try {
    await tickOnce(state);
  } finally {
    state.inFlight = false;
  }
}

export function startStaleCheckRetriggerService(): void {
  if (serviceState.timer !== null) return;
  serviceState.timer = setInterval(() => void runTickIfIdle(serviceState), POLL_INTERVAL_MS);
  serviceState.timer.unref?.();
}

export function stopStaleCheckRetriggerService(): void {
  if (serviceState.timer !== null) clearInterval(serviceState.timer);
  serviceState.timer = null;
  serviceState.repoWindows.clear();
  serviceState.lastEvaluated.clear();
  serviceState.attemptedRunIds.clear();
  serviceState.loggedSkips.clear();
}

export async function __tickOnceForTests(): Promise<void> {
  await runTickIfIdle(serviceState);
}
