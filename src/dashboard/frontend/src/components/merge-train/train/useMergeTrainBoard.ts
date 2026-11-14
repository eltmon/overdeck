/**
 * Data hooks for the `MergeTrain` component (PAN-4753 WI-10).
 *
 * `useMergeTrainBoard` reads `GET /api/merge-train/board` (WI-7), one query
 * per placement (`all` or one project key), polled every 15 s while the
 * surface is on screen. The board's batch part runs one UAT stack probe per
 * batch, so it never polls faster. Every mutation invalidates the
 * `['merge-train','board']` prefix so every placement refreshes.
 *
 * `useMergeRuns` polls `GET /api/merge-queue` every 3 s, and only while a car
 * or strike is merging, so the step tracker advances between board polls.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport';
import { MergeTrainRequestError, fetchJson } from '../mergeTrainApi';
import type { MergeStepKey, MergeTrainBoard, UatGenerationPayload } from './boardTypes';

/** Prefix every board query shares; invalidate it after a mutation. */
export const MERGE_TRAIN_BOARD_KEY = ['merge-train', 'board'] as const;

export function boardQueryKey(projectKey?: string): readonly string[] {
  return [...MERGE_TRAIN_BOARD_KEY, projectKey ?? 'all'];
}

export function boardUrl(projectKey?: string): string {
  return projectKey
    ? `/api/merge-train/board?project=${encodeURIComponent(projectKey)}`
    : '/api/merge-train/board';
}

export function useMergeTrainBoard({ projectKey, active }: { projectKey?: string; active: boolean }) {
  return useQuery({
    queryKey: boardQueryKey(projectKey),
    queryFn: () => fetchJson<MergeTrainBoard>(boardUrl(projectKey)),
    refetchInterval: active ? 15_000 : false,
  });
}

/** A DELETE with the dashboard's CSRF headers; throws the server's error text. */
export async function deleteJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE', headers: await dashboardMutationJsonHeaders() });
  const payload = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new MergeTrainRequestError(payload.error ?? `${url} → ${res.status}`, res.status);
  return payload;
}

/** Invalidates every board query (all placements). */
export function useInvalidateBoard(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: MERGE_TRAIN_BOARD_KEY });
  };
}

/** A live batch whose members render inside the hero batch, not as cars. */
export function isHeroLiveStatus(status: UatGenerationPayload['status']): boolean {
  return status === 'ready' || status === 'assembling';
}

/** True when the car's `liveBatch` names a `ready`/`assembling` batch of the project. */
export function inLiveHeroBatch(
  car: { liveBatch: string | null },
  batches: readonly Pick<UatGenerationPayload, 'name' | 'status'>[],
): boolean {
  if (!car.liveBatch) return false;
  return batches.some((b) => b.name === car.liveBatch && isHeroLiveStatus(b.status));
}

/**
 * Totals across the board for a host's one-line summary: cars not inside a
 * live `ready`/`assembling` batch, batches ready to test, and strike PRs.
 */
export function trainTotals(board: MergeTrainBoard | undefined | null): { waiting: number; batchesReady: number; strikes: number } {
  let waiting = 0;
  let batchesReady = 0;
  let strikes = 0;
  for (const project of board?.projects ?? []) {
    waiting += project.cars.filter((car) => !inLiveHeroBatch(car, project.batches)).length;
    batchesReady += project.batches.filter((b) => b.status === 'ready').length;
    strikes += project.strikes.length;
  }
  return { waiting, batchesReady, strikes };
}

/** True when any car or strike on the board is merging. */
export function boardHasMerging(board: MergeTrainBoard | undefined | null): boolean {
  return (board?.projects ?? []).some((p) =>
    p.cars.some((c) => c.state === 'merging') || p.strikes.some((s) => s.state === 'merging'));
}

interface MergeRunEntry { issueId: string; phase: string; step?: string; notes?: string }

export interface LiveMergeRun { step: MergeStepKey | null; notes: string | null; failed: boolean }

const MERGE_STEP_KEYS = new Set<string>([
  'queued', 'validating-pr', 'preparing-work-agent', 'rebasing', 'stripping-planning',
  'verifying', 'reporting-statuses', 'squash-merging', 'post-merge-cleanup',
]);

/** Merge runs by upper-cased issue id; polls only while `active`. */
export function useMergeRuns(active: boolean): ReadonlyMap<string, LiveMergeRun> {
  const { data } = useQuery({
    queryKey: ['merge-train', 'merge-runs'],
    queryFn: () => fetchJson<{ runs?: MergeRunEntry[] }>('/api/merge-queue'),
    enabled: active,
    refetchInterval: active ? 3_000 : false,
  });
  const runs = new Map<string, LiveMergeRun>();
  if (!active) return runs;
  for (const run of data?.runs ?? []) {
    runs.set(run.issueId.toUpperCase(), {
      step: run.step && MERGE_STEP_KEYS.has(run.step) ? (run.step as MergeStepKey) : null,
      notes: run.notes ?? null,
      failed: run.phase === 'failed',
    });
  }
  return runs;
}

/** A clock that re-renders every `intervalMs` while `enabled`. */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}

/**
 * Whether no merge backend (GitHub App or `gh` CLI) is configured, from
 * `GET /api/merge-train/merge-backend`. Carried over from the retired view so
 * the operator still learns why nothing merges.
 */
export function useMergeBackendUnavailable(active: boolean): boolean {
  const query = useQuery({
    queryKey: ['merge-train-merge-backend'],
    queryFn: () => fetchJson<{ available?: boolean }>('/api/merge-train/merge-backend'),
    refetchInterval: active ? 60_000 : false,
    retry: false,
  });
  return query.data?.available === false;
}
