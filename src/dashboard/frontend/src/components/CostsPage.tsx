/**
 * Costs Page - Detailed cost tracking and analysis
 *
 * Shows costs by issue with per-model/stage breakdown, trend charts, and budget tracking.
 */

import { useQuery } from '@tanstack/react-query';
import { DollarSign, AlertTriangle, TrendingUp, Zap, X, BarChart3, FlaskConical } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Filler,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, Filler, Tooltip);

// ============== Types ==============

interface ModelStats {
  cost: number;
  calls: number;
  tokens: number;
}

interface StageStats {
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
  byModel?: Record<string, { cost: number; tokens: number }>;
  byStage?: Record<string, { cost: number; tokens: number }>;
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

interface DailyTrend {
  date: string;
  totalCost: number;
  eventCount: number;
  totalTokens: number;
}

interface TrendsResponse {
  trends: DailyTrend[];
  days: number;
  issueId: string | null;
}

interface IssueDetail {
  issueId: string;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  models: Record<string, ModelStats>;
  stages: Record<string, StageStats>;
}

// ============== API ==============

async function fetchCosts(): Promise<CostsResponse> {
  const res = await fetch('/api/costs/by-issue');
  if (!res.ok) throw new Error('Failed to fetch costs');
  return res.json();
}

async function fetchTrends(days = 30, issueId?: string): Promise<TrendsResponse> {
  const params = new URLSearchParams({ days: String(days) });
  if (issueId) params.set('issueId', issueId);
  const res = await fetch(`/api/costs/trends?${params}`);
  if (!res.ok) throw new Error('Failed to fetch trends');
  return res.json();
}

async function fetchIssueDetail(issueId: string): Promise<IssueDetail> {
  const res = await fetch(`/api/costs/issue/${issueId}`);
  if (!res.ok) throw new Error('Failed to fetch issue detail');
  return res.json();
}

interface CavemanExperimentRow {
  variant: string;
  eventCount: number;
  avgOutputTokens: number;
  totalOutputTokens: number;
  avgInputTokens: number;
  avgCost: number;
  totalCost: number;
}

interface ExperimentsResponse {
  experiments: CavemanExperimentRow[];
}

async function fetchExperiments(): Promise<ExperimentsResponse> {
  const res = await fetch('/api/costs/experiments');
  if (!res.ok) throw new Error('Failed to fetch experiments');
  return res.json();
}

// ============== Trend Chart ==============

function TrendChart({ trends }: { trends: DailyTrend[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartJS | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const labels = trends.map(t => t.date.slice(5)); // MM-DD
    const data = trends.map(t => t.totalCost);

    const chartData: ChartData<'line'> = {
      labels,
      datasets: [{
        label: 'Daily Cost ($)',
        data,
        borderColor: 'rgba(52, 211, 153, 0.9)',
        borderWidth: 2,
        fill: true,
        backgroundColor: 'rgba(52, 211, 153, 0.1)',
        pointRadius: 3,
        pointBackgroundColor: 'rgba(52, 211, 153, 0.9)',
        tension: 0.3,
      }],
    };

    const options: ChartOptions<'line'> = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `$${(ctx.raw as number).toFixed(4)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 11 }, maxRotation: 45 },
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            color: 'rgba(255,255,255,0.4)',
            font: { size: 11 },
            callback: (v) => `$${Number(v).toFixed(3)}`,
          },
        },
      },
    };

    chartRef.current = new ChartJS(canvas, { type: 'line', data: chartData, options });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [trends]);

  return <canvas ref={canvasRef} />;
}

// ============== Issue Detail Modal ==============

function IssueDetailModal({ issueId, onClose }: { issueId: string; onClose: () => void }) {
  const { data: detail, isLoading } = useQuery({
    queryKey: ['cost-issue-detail', issueId],
    queryFn: () => fetchIssueDetail(issueId),
  });

  const { data: trends } = useQuery({
    queryKey: ['cost-trends-issue', issueId],
    queryFn: () => fetchTrends(30, issueId),
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[85vh] overflow-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-bold text-foreground font-mono">{issueId}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {isLoading ? (
            <div className="text-muted-foreground text-center py-8">Loading...</div>
          ) : detail ? (
            <>
              {/* Summary */}
              <div>
                <div className="text-3xl font-bold text-success mb-1">${detail.totalCost.toFixed(4)}</div>
                <div className="text-sm text-muted-foreground">
                  {(detail.inputTokens + detail.outputTokens + detail.cacheReadTokens + detail.cacheWriteTokens).toLocaleString()} total tokens
                </div>
              </div>

              {/* Token Breakdown */}
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Token Usage</h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Input', value: detail.inputTokens },
                    { label: 'Output', value: detail.outputTokens },
                    { label: 'Cache Read', value: detail.cacheReadTokens },
                    { label: 'Cache Write', value: detail.cacheWriteTokens },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-card/50 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="text-lg font-semibold text-foreground">{value.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* By Model */}
              {Object.keys(detail.models).length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">By Model</h3>
                  <div className="space-y-2">
                    {Object.entries(detail.models)
                      .sort(([, a], [, b]) => b.cost - a.cost)
                      .map(([model, stats]) => (
                        <div key={model} className="bg-card/50 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm text-foreground font-mono truncate mr-2">{model}</span>
                            <span className="text-sm text-success font-semibold shrink-0">${stats.cost.toFixed(4)}</span>
                          </div>
                          <div className="flex gap-4 text-xs text-muted-foreground">
                            <span>{stats.calls} calls</span>
                            <span>{stats.tokens.toLocaleString()} tokens</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* By Stage */}
              {Object.keys(detail.stages).length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">By Stage</h3>
                  <div className="space-y-2">
                    {Object.entries(detail.stages)
                      .sort(([, a], [, b]) => b.cost - a.cost)
                      .map(([stage, stats]) => (
                        <div key={stage} className="bg-card/50 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm text-foreground capitalize">{stage}</span>
                            <span className="text-sm text-success font-semibold">${stats.cost.toFixed(4)}</span>
                          </div>
                          <div className="flex gap-4 text-xs text-muted-foreground">
                            <span>{stats.calls} calls</span>
                            <span>{stats.tokens.toLocaleString()} tokens</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-muted-foreground text-center py-8">No data available</div>
          )}

          {/* Trend Chart */}
          {trends && trends.trends.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                30-Day Trend
              </h3>
              <div className="h-36 bg-card/30 rounded-lg p-2">
                <TrendChart trends={trends.trends} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============== Experiments View ==============

function ExperimentsView({ experiments }: { experiments: CavemanExperimentRow[] }) {
  if (experiments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <FlaskConical className="w-12 h-12 mb-4 opacity-30" />
        <p className="text-lg font-medium mb-2">No experiment data yet</p>
        <p className="text-sm text-center max-w-md">
          Enable caveman in your <code className="text-primary">~/.panopticon/config.yaml</code> with{' '}
          <code className="text-primary">agents.caveman.enabled: true</code> to start tracking output token reduction.
        </p>
      </div>
    );
  }

  const enabledRow = experiments.find(e => e.variant === 'enabled');
  const disabledRow = experiments.find(e => e.variant === 'disabled');
  const reductionPct = enabledRow && disabledRow && disabledRow.avgOutputTokens > 0
    ? ((disabledRow.avgOutputTokens - enabledRow.avgOutputTokens) / disabledRow.avgOutputTokens) * 100
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <FlaskConical className="w-5 h-5 text-primary" />
        <h2 className="text-xl font-semibold text-foreground">Caveman A/B Experiment</h2>
        <span className="text-xs px-2 py-0.5 rounded badge-bg-primary text-primary">Output Token Reduction</span>
      </div>

      {reductionPct !== null && (
        <div className="bg-card border border-border rounded-lg p-6 flex items-center gap-6">
          <div className="text-center">
            <div className={`text-4xl font-bold ${reductionPct > 0 ? 'text-success' : 'text-destructive'}`}>
              {reductionPct > 0 ? '-' : '+'}{Math.abs(reductionPct).toFixed(1)}%
            </div>
            <div className="text-sm text-muted-foreground mt-1">output token reduction</div>
          </div>
          <div className="text-sm text-muted-foreground">
            Caveman-enabled agents produce <strong className="text-foreground">{enabledRow!.avgOutputTokens.toLocaleString()}</strong> avg output tokens
            vs <strong className="text-foreground">{disabledRow!.avgOutputTokens.toLocaleString()}</strong> without caveman.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {experiments.map(row => (
          <div key={row.variant} className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <span className={`text-sm font-semibold px-2 py-0.5 rounded ${
                row.variant === 'enabled' ? 'badge-bg-success text-success' :
                row.variant === 'disabled' ? 'badge-bg-destructive text-destructive' :
                'badge-bg-card text-muted-foreground'
              }`}>
                caveman: {row.variant}
              </span>
              <span className="text-xs text-muted-foreground">{row.eventCount.toLocaleString()} events</span>
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Avg Output Tokens</div>
                <div className="text-2xl font-bold text-foreground">{row.avgOutputTokens.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Avg Input Tokens</div>
                <div className="text-lg font-semibold text-foreground">{row.avgInputTokens.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Avg Cost per Request</div>
                <div className="text-lg font-semibold text-success">${row.avgCost.toFixed(5)}</div>
              </div>
              <div className="pt-2 border-t border-border flex justify-between text-xs text-muted-foreground">
                <span>Total output: {row.totalOutputTokens.toLocaleString()}</span>
                <span>Total: ${row.totalCost.toFixed(2)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============== Issues Tab Content ==============

function IssuesTabContent({ costs, globalTrends }: { costs: CostsResponse; globalTrends: TrendsResponse | undefined }) {
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);
  const [modalIssue, setModalIssue] = useState<string | null>(null);

  const totalCost = costs.issues.reduce((sum, issue) => sum + issue.totalCost, 0);
  const issuesWithBudget = costs.issues.filter(i => i.budget);
  const overBudget = issuesWithBudget.filter(i => i.totalCost > (i.budget || 0));
  const selectedIssueData = selectedIssue ? costs.issues.find(i => i.issueId === selectedIssue) : null;

  return (
    <>
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <DollarSign className="w-6 h-6 text-success" />
            <h3 className="text-lg font-semibold text-foreground">Total Cost</h3>
          </div>
          <div className="text-3xl font-bold text-foreground mb-2">${totalCost.toFixed(2)}</div>
          <div className="text-sm text-muted-foreground">{costs.issues.length} issues tracked</div>
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <TrendingUp className="w-6 h-6 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">Event Count</h3>
          </div>
          <div className="text-3xl font-bold text-foreground mb-2">{costs.eventCount.toLocaleString()}</div>
          <div className="text-sm text-muted-foreground">Total events logged</div>
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="w-6 h-6 text-warning" />
            <h3 className="text-lg font-semibold text-foreground">Budget Warnings</h3>
          </div>
          <div className="text-3xl font-bold text-foreground mb-2">
            {costs.issues.filter(i => i.budgetWarning).length}
          </div>
          <div className="text-sm text-muted-foreground">{issuesWithBudget.length} with budgets</div>
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <Zap className="w-6 h-6 text-signal-review" />
            <h3 className="text-lg font-semibold text-foreground">Over Budget</h3>
          </div>
          <div className="text-3xl font-bold text-foreground mb-2">{overBudget.length}</div>
          <div className="text-sm text-muted-foreground">Exceeded limit</div>
        </div>
      </div>

      {/* Global Trend Chart */}
      {globalTrends && globalTrends.trends.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-6 mb-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">30-Day Cost Trend</h3>
          <div className="h-40">
            <TrendChart trends={globalTrends.trends} />
          </div>
        </div>
      )}

      {/* Issues List + Detail Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Issues Table */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-xl font-semibold text-foreground mb-4">Costs by Issue</h3>
          <div className="space-y-2 max-h-[600px] overflow-auto">
            {costs.issues.map((issue) => {
              const budgetPercent = issue.budget ? (issue.totalCost / issue.budget) * 100 : 0;

              return (
                <div
                  key={issue.issueId}
                  onClick={() => setSelectedIssue(issue.issueId)}
                  className={`p-4 rounded-lg cursor-pointer transition-colors ${
                    selectedIssue === issue.issueId
                      ? 'badge-bg-primary border border-primary'
                      : 'bg-card/50 hover:bg-card'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground font-mono font-semibold">{issue.issueId}</span>
                      {issue.budgetWarning && <AlertTriangle className="w-4 h-4 text-warning" />}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-success font-bold">${issue.totalCost.toFixed(2)}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setModalIssue(issue.issueId); }}
                        className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        title="View details"
                      >
                        <BarChart3 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {issue.budget && (
                    <div className="mb-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span>Budget: ${issue.budget.toFixed(2)}</span>
                        <span>{budgetPercent.toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-popover rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            budgetPercent >= 100 ? 'bg-destructive' :
                            budgetPercent >= 80 ? 'bg-warning' : 'bg-success'
                          }`}
                          style={{ width: `${Math.min(budgetPercent, 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{issue.tokenCount.toLocaleString()} tokens</span>
                    <span>{Object.keys(issue.models).length} models</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Inline Detail Panel */}
        <div className="bg-card border border-border rounded-lg p-6">
          {selectedIssueData ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold text-foreground">{selectedIssueData.issueId} Details</h3>
                <button
                  onClick={() => setModalIssue(selectedIssueData.issueId)}
                  className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                >
                  <BarChart3 className="w-3 h-3" />
                  Full detail
                </button>
              </div>

              {/* Token Breakdown */}
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-muted-foreground mb-3">Token Usage</h4>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Input', value: selectedIssueData.inputTokens },
                    { label: 'Output', value: selectedIssueData.outputTokens },
                    { label: 'Cache Read', value: selectedIssueData.cacheReadTokens },
                    { label: 'Cache Write', value: selectedIssueData.cacheWriteTokens },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-card/50 rounded p-3">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="text-lg font-semibold text-foreground">{value.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Models */}
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-muted-foreground mb-3">By Model</h4>
                <div className="space-y-2">
                  {Object.entries(selectedIssueData.models)
                    .sort(([, a], [, b]) => b.cost - a.cost)
                    .map(([model, stats]) => (
                      <div key={model} className="bg-card/50 rounded p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-foreground font-mono truncate mr-2">{model}</span>
                          <span className="text-sm text-success font-semibold shrink-0">${stats.cost.toFixed(4)}</span>
                        </div>
                        <div className="flex gap-4 text-xs text-muted-foreground">
                          <span>{stats.calls} calls</span>
                          <span>{stats.tokens.toLocaleString()} tokens</span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Stage Breakdown (from byStage if available) */}
              {selectedIssueData.byStage && Object.keys(selectedIssueData.byStage).length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground mb-3">By Stage</h4>
                  <div className="space-y-2">
                    {Object.entries(selectedIssueData.byStage)
                      .sort(([, a], [, b]) => b.cost - a.cost)
                      .map(([stage, stats]) => (
                        <div key={stage} className="bg-card/50 rounded p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-foreground capitalize">{stage}</span>
                            <span className="text-sm text-success font-semibold">${stats.cost.toFixed(4)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">{stats.tokens.toLocaleString()} tokens</div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              Select an issue to view details
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {modalIssue && (
        <IssueDetailModal issueId={modalIssue} onClose={() => setModalIssue(null)} />
      )}
    </>
  );
}

// ============== Main Page ==============

export function CostsPage() {
  const [activeTab, setActiveTab] = useState<'issues' | 'experiments'>('issues');

  const { data: costs, isLoading } = useQuery({
    queryKey: ['costs-by-issue'],
    queryFn: fetchCosts,
    refetchInterval: 30000,
  });

  const { data: globalTrends } = useQuery({
    queryKey: ['cost-trends-global'],
    queryFn: () => fetchTrends(30),
    refetchInterval: 60000,
  });

  const { data: experiments } = useQuery({
    queryKey: ['cost-experiments'],
    queryFn: fetchExperiments,
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="p-6 h-full flex items-center justify-center">
        <div className="text-muted-foreground">Loading costs...</div>
      </div>
    );
  }

  if (!costs) {
    return (
      <div className="p-6 h-full flex items-center justify-center">
        <div className="text-destructive">Failed to load costs</div>
      </div>
    );
  }

  return (
    <div className="p-6 overflow-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-foreground">Cost Tracking</h1>
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1 rounded text-sm ${
            costs.status === 'live' ? 'badge-bg-success text-success' :
            costs.status === 'migrating' ? 'badge-bg-warning text-warning' :
            'badge-bg-destructive text-destructive'
          }`}>
            {costs.status === 'live' ? '● Live' :
             costs.status === 'migrating' ? '⟳ Migrating' : '⚠ Stale'}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        <button
          onClick={() => setActiveTab('issues')}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'issues'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Issues
          </div>
        </button>
        <button
          onClick={() => setActiveTab('experiments')}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'experiments'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4" />
            Experiments
          </div>
        </button>
      </div>

      {/* Experiments Tab */}
      {activeTab === 'experiments' && (
        <ExperimentsView experiments={experiments?.experiments ?? []} />
      )}

      {/* Issues Tab */}
      {activeTab === 'issues' && (
        <IssuesTabContent costs={costs} globalTrends={globalTrends} />
      )}
    </div>
  );
}
