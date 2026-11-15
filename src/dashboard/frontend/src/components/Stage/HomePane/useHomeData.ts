/**
 * PAN-5294 G-D13 — the two server reads behind the project Home. One changes
 * query (7 days of first-parent commits on the default branch) feeds the
 * Landed fact, the metadata line's branch and Recent changes; the spend
 * query feeds the Spend fact. Neither polls faster than 60 s (NFR-1).
 */
import { useQuery } from '@tanstack/react-query'
import type { ProjectChanges } from '@overdeck/contracts'

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
      return res.json()
    },
    enabled: !!projectKey,
    refetchInterval: 60_000,
  })
}

export function useProjectSpend(prefix?: string | null) {
  return useQuery({
    queryKey: ['project-recent-spend', prefix],
    queryFn: async (): Promise<CostSummary> => {
      const res = await fetch(`/api/costs/summary?project=${encodeURIComponent(prefix!)}`)
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
