/**
 * Costs Page - Detailed cost tracking and analysis
 *
 * Shows costs by issue with per-model breakdown, provider costs, and budget tracking
 */

import { useQuery } from '@tanstack/react-query';
import { DollarSign, AlertTriangle, TrendingUp, Zap } from 'lucide-react';
import { useState } from 'react';

interface ModelStats {
  cost: number;
  calls: number;
  tokens: number;
}

interface IssueCost {
  issueId: string;
  totalCost: number;
  tokenCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  models: Record<string, ModelStats>;
  providers: Record<string, number>;
  budget?: number;
  budgetWarning: boolean;
  lastUpdated: string;
}

interface CostsResponse {
  status: 'live' | 'migrating' | 'stale';
  lastEventTs: string | null;
  eventCount: number;
  issues: IssueCost[];
}

async function fetchCosts(): Promise<CostsResponse> {
  const res = await fetch('/api/costs/by-issue');
  if (!res.ok) throw new Error('Failed to fetch costs');
  return res.json();
}

export function CostsPage() {
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);

  const { data: costs, isLoading } = useQuery({
    queryKey: ['costs-by-issue'],
    queryFn: fetchCosts,
    refetchInterval: 10000, // Poll every 10 seconds for real-time updates
  });

  if (isLoading) {
    return (
      <div className="p-6 h-full flex items-center justify-center">
        <div className="text-gray-400">Loading costs...</div>
      </div>
    );
  }

  if (!costs) {
    return (
      <div className="p-6 h-full flex items-center justify-center">
        <div className="text-red-400">Failed to load costs</div>
      </div>
    );
  }

  const totalCost = costs.issues.reduce((sum, issue) => sum + issue.totalCost, 0);
  const issuesWithBudget = costs.issues.filter(i => i.budget);
  const overBudget = issuesWithBudget.filter(i => i.totalCost > (i.budget || 0));

  const selectedIssueData = selectedIssue
    ? costs.issues.find(i => i.issueId === selectedIssue)
    : null;

  return (
    <div className="p-6 overflow-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-white">Cost Tracking</h1>
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1 rounded text-sm ${
            costs.status === 'live' ? 'bg-green-900/30 text-green-400' :
            costs.status === 'migrating' ? 'bg-yellow-900/30 text-yellow-400' :
            'bg-red-900/30 text-red-400'
          }`}>
            {costs.status === 'live' ? '● Live' :
             costs.status === 'migrating' ? '⟳ Migrating' :
             '⚠ Stale'}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <DollarSign className="w-6 h-6 text-green-400" />
            <h3 className="text-lg font-semibold text-white">Total Cost</h3>
          </div>
          <div className="text-3xl font-bold text-white mb-2">
            ${totalCost.toFixed(2)}
          </div>
          <div className="text-sm text-gray-400">{costs.issues.length} issues tracked</div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <TrendingUp className="w-6 h-6 text-blue-400" />
            <h3 className="text-lg font-semibold text-white">Event Count</h3>
          </div>
          <div className="text-3xl font-bold text-white mb-2">
            {costs.eventCount.toLocaleString()}
          </div>
          <div className="text-sm text-gray-400">Total events logged</div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="w-6 h-6 text-yellow-400" />
            <h3 className="text-lg font-semibold text-white">Budget Warnings</h3>
          </div>
          <div className="text-3xl font-bold text-white mb-2">
            {costs.issues.filter(i => i.budgetWarning).length}
          </div>
          <div className="text-sm text-gray-400">
            {issuesWithBudget.length} with budgets
          </div>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <Zap className="w-6 h-6 text-purple-400" />
            <h3 className="text-lg font-semibold text-white">Over Budget</h3>
          </div>
          <div className="text-3xl font-bold text-white mb-2">
            {overBudget.length}
          </div>
          <div className="text-sm text-gray-400">Exceeded limit</div>
        </div>
      </div>

      {/* Issues List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Issues Table */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
          <h3 className="text-xl font-semibold text-white mb-4">Costs by Issue</h3>
          <div className="space-y-2 max-h-[600px] overflow-auto">
            {costs.issues.map((issue) => {
              const budgetPercent = issue.budget
                ? (issue.totalCost / issue.budget) * 100
                : 0;

              return (
                <div
                  key={issue.issueId}
                  onClick={() => setSelectedIssue(issue.issueId)}
                  className={`p-4 rounded-lg cursor-pointer transition-colors ${
                    selectedIssue === issue.issueId
                      ? 'bg-blue-900/30 border border-blue-500'
                      : 'bg-gray-900/50 hover:bg-gray-900'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-mono font-semibold">
                        {issue.issueId}
                      </span>
                      {issue.budgetWarning && (
                        <AlertTriangle className="w-4 h-4 text-yellow-400" />
                      )}
                    </div>
                    <span className="text-green-400 font-bold">
                      ${issue.totalCost.toFixed(2)}
                    </span>
                  </div>

                  {/* Budget Bar */}
                  {issue.budget && (
                    <div className="mb-2">
                      <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                        <span>Budget: ${issue.budget.toFixed(2)}</span>
                        <span>{budgetPercent.toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            budgetPercent >= 100 ? 'bg-red-500' :
                            budgetPercent >= 80 ? 'bg-yellow-500' :
                            'bg-green-500'
                          }`}
                          style={{ width: `${Math.min(budgetPercent, 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span>{issue.tokenCount.toLocaleString()} tokens</span>
                    <span>{Object.keys(issue.models).length} models</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Issue Detail Panel */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
          {selectedIssueData ? (
            <>
              <h3 className="text-xl font-semibold text-white mb-4">
                {selectedIssueData.issueId} Details
              </h3>

              {/* Token Breakdown */}
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-gray-400 mb-3">Token Usage</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-900/50 rounded p-3">
                    <div className="text-xs text-gray-400">Input</div>
                    <div className="text-lg font-semibold text-white">
                      {selectedIssueData.inputTokens.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-gray-900/50 rounded p-3">
                    <div className="text-xs text-gray-400">Output</div>
                    <div className="text-lg font-semibold text-white">
                      {selectedIssueData.outputTokens.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-gray-900/50 rounded p-3">
                    <div className="text-xs text-gray-400">Cache Read</div>
                    <div className="text-lg font-semibold text-white">
                      {selectedIssueData.cacheReadTokens.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-gray-900/50 rounded p-3">
                    <div className="text-xs text-gray-400">Cache Write</div>
                    <div className="text-lg font-semibold text-white">
                      {selectedIssueData.cacheWriteTokens.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Models Breakdown */}
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-gray-400 mb-3">By Model</h4>
                <div className="space-y-2">
                  {Object.entries(selectedIssueData.models).map(([model, stats]) => (
                    <div key={model} className="bg-gray-900/50 rounded p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-white font-mono">{model}</span>
                        <span className="text-sm text-green-400 font-semibold">
                          ${stats.cost.toFixed(4)}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-400">
                        <span>{stats.calls} calls</span>
                        <span>{stats.tokens.toLocaleString()} tokens</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Providers Breakdown */}
              <div>
                <h4 className="text-sm font-semibold text-gray-400 mb-3">By Provider</h4>
                <div className="space-y-2">
                  {Object.entries(selectedIssueData.providers)
                    .filter(([_, cost]) => cost > 0)
                    .map(([provider, cost]) => (
                      <div key={provider} className="bg-gray-900/50 rounded p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-white capitalize">{provider}</span>
                          <span className="text-sm text-green-400 font-semibold">
                            ${cost.toFixed(4)}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500">
              Select an issue to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
