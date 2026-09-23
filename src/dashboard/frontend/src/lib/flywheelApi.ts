/**
 * Flywheel page data (PAN-3964). Every read is the server's derived view —
 * `GET /api/flywheel/status` is the same `deriveFlywheelStatus()` that
 * `pan flywheel status` prints — and every action is a POST to the routes
 * that wrap the CLI's own action functions.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FlywheelDerivedStatus } from '@overdeck/contracts';

import { dashboardMutationJsonHeaders } from './wsTransport';

export { useMergeTrainConfig, useMergeTrainConfigMutation } from '../components/merge-train/config';

export const FLYWHEEL_CONVERSATION_NAME = 'conv-flywheel';
export const FLYWHEEL_STATUS_QUERY_KEY = ['flywheel', 'status'] as const;
export const FLYWHEEL_CONVERSATION_QUERY_KEY = ['conversation', FLYWHEEL_CONVERSATION_NAME] as const;

export type FlywheelAction = 'start' | 'pause' | 'resume' | 'stop' | 'abort' | 'report';

async function fetchFlywheelStatus(): Promise<FlywheelDerivedStatus> {
  const res = await fetch('/api/flywheel/status');
  // A failed read is "can't reach the server", never "idle".
  if (!res.ok) throw new Error(`GET /api/flywheel/status → ${res.status}`);
  return res.json() as Promise<FlywheelDerivedStatus>;
}

export function useFlywheelStatus(opts: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: FLYWHEEL_STATUS_QUERY_KEY,
    queryFn: fetchFlywheelStatus,
    refetchInterval: opts.refetchInterval ?? 5_000,
  });
}

/**
 * The sidebar's `live` marker: true only when the derived run is `running`.
 * The sidebar is on every page, so it polls every 30 s; the Flywheel page's
 * own 5 s observer takes over while the page is open.
 */
export function useFlywheelRunning(): boolean {
  const { data } = useFlywheelStatus({ refetchInterval: 30_000 });
  return data?.run === 'running';
}

export async function postFlywheelAction<T = unknown>(action: FlywheelAction, body: unknown = {}): Promise<T> {
  const res = await fetch(`/api/flywheel/${action}`, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (!res.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `POST /api/flywheel/${action} → ${res.status}`);
  }
  return payload as T;
}

export function useFlywheelAction(action: FlywheelAction) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body?: unknown) => postFlywheelAction(action, body ?? {}),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: FLYWHEEL_STATUS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: FLYWHEEL_CONVERSATION_QUERY_KEY }),
      ]);
    },
  });
}

/** Relative age for tick/journal timestamps: `42s ago`, `7m ago`, `3h ago`. */
export function formatAge(iso: string, nowMs: number): string {
  const ms = nowMs - Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
