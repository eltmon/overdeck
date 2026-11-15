/**
 * useIssueCosts — aggregated cost per issue for the issue tree and project
 * overview (PAN-5293 §6.1, moved from CommandDeck/index.tsx). Keys are stored
 * both as given and lowercased.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { IssueCostBreakdown } from '../../CommandDeck/ProjectOverview';

interface IssueCostEntry {
  issueId: string;
  totalCost: number;
  byModel: IssueCostBreakdown['byModel'];
  byStage: IssueCostBreakdown['byStage'];
}

async function fetchCostsByIssue(): Promise<{ issues: IssueCostEntry[] }> {
  const res = await fetch('/api/costs/by-issue');
  if (!res.ok) throw new Error('Failed to fetch costs');
  return res.json();
}

export interface IssueCosts {
  issueCosts: Record<string, number>;
  issueCostDetails: Record<string, IssueCostBreakdown>;
}

export function useIssueCosts(): IssueCosts {
  const { data: costData } = useQuery({
    queryKey: ['costs-by-issue'],
    queryFn: fetchCostsByIssue,
    refetchInterval: 15000,
  });

  // Map aggregated costs per issue for the project tree sidebar and project overview.
  return useMemo(() => {
    const costs: Record<string, number> = {};
    const detailsByIssue: Record<string, IssueCostBreakdown> = {};

    for (const entry of costData?.issues || []) {
      costs[entry.issueId] = entry.totalCost;
      costs[entry.issueId.toLowerCase()] = entry.totalCost;

      const details: IssueCostBreakdown = {
        byModel: entry.byModel ?? {},
        byStage: entry.byStage ?? {},
      };
      detailsByIssue[entry.issueId] = details;
      detailsByIssue[entry.issueId.toLowerCase()] = details;
    }

    return { issueCosts: costs, issueCostDetails: detailsByIssue };
  }, [costData]);
}
