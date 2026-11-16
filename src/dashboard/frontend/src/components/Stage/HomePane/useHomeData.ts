/**
 * PAN-5294 G-D13 — the two server reads behind the project Home. One changes
 * query (7 days of first-parent commits on the default branch) feeds the
 * Landed fact, the metadata line's branch and Recent changes; the spend
 * query feeds the Spend fact. Neither polls faster than 60 s (NFR-1). The
 * spend read gives up after 20 s (PAN-5370).
 */
import { useQuery } from '@tanstack/react-query'
import type { ProjectChanges } from '@overdeck/contracts'
import { fetchWithTimeout } from '../../../lib/apiFetch'

interface CostSummary {
  today?: { totalCost?: number }
  week?: { totalCost?: number }
}

export interface ProjectSpend {
  week: number
  today: number
}

export function useProjectChanges(projectKey?: string) {
  return useQuery({
    queryKey: ['project-changes', projectKey, '7d'],
    queryFn: async (): Promise<ProjectChanges> => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectKey!)}/changes?since=7d`)
      if (!res.ok) throw new Error(`Failed to load recent changes (HTTP ${res.status})`)
      const body = await res.json() as Partial<ProjectChanges> | null
      // A body without a commit list is an error state, never a render crash:
      // the Landed fact and Recent changes read `commits` directly.
      if (!body || !Array.isArray(body.commits)) throw new Error('Recent changes response has no commit list')
      return body as ProjectChanges
    },
    enabled: !!projectKey,
    refetchInterval: 60_000,
  })
}

/** PAN-5370: the Spend fact gives up after this long and shows "unavailable". */
export const SPEND_TIMEOUT_MS = 20_000

export function useProjectSpend(prefix?: string | null) {
  return useQuery({
    queryKey: ['project-recent-spend', prefix],
    queryFn: async ({ signal }): Promise<CostSummary> => {
      const res = await fetchWithTimeout(`/api/costs/summary?project=${encodeURIComponent(prefix!)}`, { signal, timeoutMs: SPEND_TIMEOUT_MS })
      if (!res.ok) throw new Error('Failed to fetch project spend')
      return res.json()
    },
    select: (summary): ProjectSpend => ({
      week: summary.week?.totalCost ?? 0,
      today: summary.today?.totalCost ?? 0,
    }),
    enabled: !!prefix,
    refetchInterval: 60_000,
  })
}
