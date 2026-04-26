import { useQuery } from '@tanstack/react-query';
import { X, DollarSign, Loader2, Cpu, Layers } from 'lucide-react';

interface CostBreakdownModalProps {
  issueId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface ModelBreakdown {
  cost: number;
  calls: number;
  tokens: number;
}

interface StageBreakdown {
  cost: number;
  calls: number;
  tokens: number;
}

interface CostBreakdownData {
  issueId: string;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  lastUpdated: string;
  models: Record<string, ModelBreakdown>;
  stages: Record<string, StageBreakdown>;
}

// Stage display config: label, color
const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  planning: { label: 'Planning', color: 'text-signal-review' },
  implementation: { label: 'Implementation', color: 'text-primary' },
  review: { label: 'Review', color: 'text-amber-400' },
  test: { label: 'Testing', color: 'text-success' },
  merge: { label: 'Merge', color: 'text-emerald-400' },
  interactive: { label: 'Interactive', color: 'text-cyan-400' },
  unknown: { label: 'Other', color: 'text-muted-foreground' },
};

function formatCost(cost: number): string {
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  if (cost > 0) return `$${cost.toFixed(4)}`;
  return '$0';
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

function friendlyModelName(model: string): string {
  return model
    .replace('claude-', '')
    .replace(/-20\d{6}$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export function CostBreakdownModal({ issueId, isOpen, onClose }: CostBreakdownModalProps) {
  const { data, isLoading, error } = useQuery<CostBreakdownData>({
    queryKey: ['costBreakdown', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/costs/issue/${issueId}`);
      if (!res.ok) throw new Error('Failed to fetch cost breakdown');
      return res.json();
    },
    enabled: isOpen,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  if (!isOpen) return null;

  // Sort stages and models by cost descending
  const stages = data?.stages
    ? Object.entries(data.stages).sort(([, a], [, b]) => b.cost - a.cost)
    : [];
  const models = data?.models
    ? Object.entries(data.models).sort(([, a], [, b]) => b.cost - a.cost)
    : [];

  const totalCost = data?.totalCost || 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[70vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-400" />
            <h2 className="font-semibold text-foreground">Cost Breakdown: {issueId}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-popover rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 bg-popover/50 rounded animate-pulse" />
              ))}
              <div className="flex items-center justify-center py-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Loading cost data...
              </div>
            </div>
          )}

          {error && (
            <div className="text-destructive text-sm p-3 badge-bg-destructive rounded">
              Failed to load cost data: {(error as Error).message}
            </div>
          )}

          {data && (
            <>
              {/* Total */}
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground text-sm">Total Cost</span>
                <span className="text-2xl font-bold text-emerald-400">{formatCost(totalCost)}</span>
              </div>

              {/* Token summary */}
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div className="bg-popover/40 rounded p-2 text-center">
                  <div className="text-muted-foreground">Input</div>
                  <div className="text-foreground font-medium">{formatTokens(data.inputTokens)}</div>
                </div>
                <div className="bg-popover/40 rounded p-2 text-center">
                  <div className="text-muted-foreground">Output</div>
                  <div className="text-foreground font-medium">{formatTokens(data.outputTokens)}</div>
                </div>
                <div className="bg-popover/40 rounded p-2 text-center">
                  <div className="text-muted-foreground">Cache Read</div>
                  <div className="text-foreground font-medium">{formatTokens(data.cacheReadTokens)}</div>
                </div>
                <div className="bg-popover/40 rounded p-2 text-center">
                  <div className="text-muted-foreground">Cache Write</div>
                  <div className="text-foreground font-medium">{formatTokens(data.cacheWriteTokens)}</div>
                </div>
              </div>

              {/* By Stage */}
              {stages.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-foreground mb-2">
                    <Layers className="w-4 h-4 text-muted-foreground" />
                    By Stage
                  </div>
                  <div className="space-y-1">
                    {stages.map(([stage, info]) => {
                      const config = STAGE_CONFIG[stage] || STAGE_CONFIG.unknown;
                      const pct = totalCost > 0 ? (info.cost / totalCost) * 100 : 0;
                      return (
                        <div key={stage} className="group">
                          <div className="flex items-center justify-between text-sm py-1">
                            <span className={`font-medium ${config.color}`}>{config.label}</span>
                            <div className="flex items-center gap-3 text-muted-foreground text-xs">
                              <span>{formatTokens(info.tokens)} tokens</span>
                              <span>{info.calls} calls</span>
                              <span className="text-foreground font-medium w-16 text-right">{formatCost(info.cost)}</span>
                            </div>
                          </div>
                          <div className="h-1 bg-popover rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500/60 rounded-full transition-all"
                              style={{ width: `${Math.max(pct, 1)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* By Model */}
              {models.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-foreground mb-2">
                    <Cpu className="w-4 h-4 text-muted-foreground" />
                    By Model
                  </div>
                  <div className="space-y-1">
                    {models.map(([model, info]) => {
                      const pct = totalCost > 0 ? (info.cost / totalCost) * 100 : 0;
                      return (
                        <div key={model} className="group">
                          <div className="flex items-center justify-between text-sm py-1">
                            <span className="text-foreground">{friendlyModelName(model)}</span>
                            <div className="flex items-center gap-3 text-muted-foreground text-xs">
                              <span>{formatTokens(info.tokens)} tokens</span>
                              <span>{info.calls} calls</span>
                              <span className="text-foreground font-medium w-16 text-right">{formatCost(info.cost)}</span>
                            </div>
                          </div>
                          <div className="h-1 bg-popover rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary/60 rounded-full transition-all"
                              style={{ width: `${Math.max(pct, 1)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Last updated */}
              {data.lastUpdated && (
                <div className="text-xs text-muted-foreground text-right pt-1 border-t border-border">
                  Last cost event: {new Date(data.lastUpdated).toLocaleString()}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
