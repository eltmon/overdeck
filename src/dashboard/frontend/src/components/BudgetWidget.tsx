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
      barClass: 'bg-red-500',
      textClass: 'text-red-400',
      bgClass: 'bg-red-900/20 border-red-800',
    },
    warning: {
      color: 'yellow',
      icon: AlertTriangle,
      message: 'Approaching limit',
      barClass: 'bg-yellow-500',
      textClass: 'text-yellow-400',
      bgClass: 'bg-yellow-900/20 border-yellow-800',
    },
    good: {
      color: 'green',
      icon: percent > 50 ? TrendingUp : CheckCircle,
      message: 'On track',
      barClass: 'bg-green-500',
      textClass: 'text-green-400',
      bgClass: 'bg-green-900/20 border-green-800',
    },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={`bg-gray-800 border ${config.bgClass} rounded-lg p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${config.textClass}`} />
          <span className="text-sm font-semibold text-white">{issueId} Budget</span>
        </div>
        <span className={`text-xs font-semibold ${config.textClass}`}>
          {config.message}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="mb-3">
        <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
          <div
            className={`h-3 rounded-full transition-all duration-500 ${config.barClass}`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-sm">
        <div>
          <div className="text-gray-400">Spent</div>
          <div className="font-semibold text-white">${spent.toFixed(2)}</div>
        </div>
        <div className="text-center">
          <div className="text-gray-400">Budget</div>
          <div className="font-semibold text-white">${budget.toFixed(2)}</div>
        </div>
        <div className="text-right">
          <div className="text-gray-400">Remaining</div>
          <div className={`font-semibold ${remaining < 0 ? 'text-red-400' : config.textClass}`}>
            ${remaining < 0 ? '0.00' : remaining.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Percentage */}
      <div className="mt-3 text-center">
        <span className={`text-2xl font-bold ${config.textClass}`}>
          {percent.toFixed(1)}%
        </span>
        <span className="text-sm text-gray-400 ml-2">of budget used</span>
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
    percent >= 100 ? 'bg-red-500' :
    percent >= 80 ? 'bg-yellow-500' :
    'bg-green-500';

  return (
    <div className={className}>
      {showLabel && (
        <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
          <span>Budget: ${budget.toFixed(2)}</span>
          <span>{percent.toFixed(0)}%</span>
        </div>
      )}
      <div className="w-full bg-gray-700 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${barClass}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}
