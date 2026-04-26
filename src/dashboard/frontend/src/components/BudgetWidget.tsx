/**
 * Budget Widget - Visual budget tracking component
 *
 * Shows budget progress with color-coded indicators
 */

import { AlertTriangle, TrendingUp, CheckCircle } from 'lucide-react';

export interface BudgetWidgetProps {
  issueId: string;
  spent: number;
  budget: number;
  className?: string;
}

export function BudgetWidget({ issueId, spent, budget, className = '' }: BudgetWidgetProps) {
  const percent = (spent / budget) * 100;
  const remaining = budget - spent;

  // Determine status
  const status =
    percent >= 100 ? 'over' :
    percent >= 80 ? 'warning' :
    'good';

  const statusConfig = {
    over: {
      color: 'red',
      icon: AlertTriangle,
      message: 'Over budget',
      barClass: 'bg-destructive',
      textClass: 'text-destructive',
      bgClass: 'badge-bg-destructive border-destructive/40',
    },
    warning: {
      color: 'yellow',
      icon: AlertTriangle,
      message: 'Approaching limit',
      barClass: 'bg-warning',
      textClass: 'text-warning',
      bgClass: 'badge-bg-warning border-warning/40',
    },
    good: {
      color: 'green',
      icon: percent > 50 ? TrendingUp : CheckCircle,
      message: 'On track',
      barClass: 'bg-success',
      textClass: 'text-success',
      bgClass: 'badge-bg-success border-success/40',
    },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={`bg-card border ${config.bgClass} rounded-lg p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${config.textClass}`} />
          <span className="text-sm font-semibold text-foreground">{issueId} Budget</span>
        </div>
        <span className={`text-xs font-semibold ${config.textClass}`}>
          {config.message}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="mb-3">
        <div className="w-full bg-popover rounded-full h-3 overflow-hidden">
          <div
            className={`h-3 rounded-full transition-all duration-500 ${config.barClass}`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-sm">
        <div>
          <div className="text-muted-foreground">Spent</div>
          <div className="font-semibold text-foreground">${spent.toFixed(2)}</div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground">Budget</div>
          <div className="font-semibold text-foreground">${budget.toFixed(2)}</div>
        </div>
        <div className="text-right">
          <div className="text-muted-foreground">Remaining</div>
          <div className={`font-semibold ${remaining < 0 ? 'text-destructive' : config.textClass}`}>
            ${remaining < 0 ? '0.00' : remaining.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Percentage */}
      <div className="mt-3 text-center">
        <span className={`text-2xl font-bold ${config.textClass}`}>
          {percent.toFixed(1)}%
        </span>
        <span className="text-sm text-muted-foreground ml-2">of budget used</span>
      </div>
    </div>
  );
}

/**
 * Compact Budget Bar - For inline use in tables/lists
 */
export interface BudgetBarProps {
  spent: number;
  budget: number;
  className?: string;
  showLabel?: boolean;
}

export function BudgetBar({ spent, budget, className = '', showLabel = true }: BudgetBarProps) {
  const percent = (spent / budget) * 100;

  const barClass =
    percent >= 100 ? 'bg-destructive' :
    percent >= 80 ? 'bg-warning' :
    'bg-success';

  return (
    <div className={className}>
      {showLabel && (
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>Budget: ${budget.toFixed(2)}</span>
          <span>{percent.toFixed(0)}%</span>
        </div>
      )}
      <div className="w-full bg-popover rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${barClass}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}
