import { GitMerge, ExternalLink, ScrollText, DollarSign } from 'lucide-react';

export interface MergedSummaryCardProps {
  /** ISO timestamp when the merge completed (from reviewStatus.updatedAt) */
  mergedAt: string;
  /** PR / MR URL — workspace.mrUrl */
  prUrl?: string | null;
  /** Total cost in USD — from /api/issues/:id/costs */
  totalCost?: number | null;
  /** Callback to switch to the last specialist log tab. Only present if a session exists. */
  onViewLastLog?: (() => void) | null;
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${(cost * 100).toFixed(2)}¢`;
  return `$${cost.toFixed(2)}`;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const bgCard = '#0d1117';
const bgInner = '#161b26';
const borderColor = '#232f48';
const textPrimary = '#e2e8f0';
const textSecondary = '#92a4c9';
const accentGreen = '#34d399';

export function MergedSummaryCard({ mergedAt, prUrl, totalCost, onViewLastLog }: MergedSummaryCardProps) {
  return (
    <div
      className="flex flex-col items-center justify-center h-full gap-4 p-6"
      style={{ backgroundColor: bgCard }}
    >
      {/* Merged badge */}
      <div className="flex flex-col items-center gap-2">
        <div
          className="flex items-center justify-center w-12 h-12 rounded-full"
          style={{ backgroundColor: '#1a3a2d', border: `1.5px solid ${accentGreen}` }}
        >
          <GitMerge className="w-6 h-6" style={{ color: accentGreen }} />
        </div>
        <span className="text-lg font-semibold" style={{ color: accentGreen }}>
          Merged
        </span>
        <span className="text-xs" style={{ color: textSecondary }}>
          {formatTimestamp(mergedAt)}
        </span>
      </div>

      {/* Detail pills */}
      <div
        className="flex flex-col gap-2 w-full max-w-xs rounded-lg p-3"
        style={{ backgroundColor: bgInner, border: `1px solid ${borderColor}` }}
      >
        {/* Cost row */}
        {totalCost != null && totalCost > 0 && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5" style={{ color: textSecondary }} />
              <span className="text-xs" style={{ color: textSecondary }}>
                Total cost
              </span>
            </div>
            <span className="text-xs font-medium" style={{ color: textPrimary }}>
              {formatCost(totalCost)}
            </span>
          </div>
        )}

        {/* PR link */}
        {prUrl && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <ExternalLink className="w-3.5 h-3.5" style={{ color: textSecondary }} />
              <span className="text-xs" style={{ color: textSecondary }}>
                Pull request
              </span>
            </div>
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium hover:underline"
              style={{ color: '#60a5fa' }}
            >
              View PR
            </a>
          </div>
        )}
      </div>

      {/* View last log button */}
      {onViewLastLog && (
        <button
          onClick={onViewLastLog}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition-colors"
          style={{
            color: textSecondary,
            backgroundColor: bgInner,
            border: `1px solid ${borderColor}`,
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#3a4a6a';
            (e.currentTarget as HTMLButtonElement).style.color = textPrimary;
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = borderColor;
            (e.currentTarget as HTMLButtonElement).style.color = textSecondary;
          }}
        >
          <ScrollText className="w-3.5 h-3.5" />
          View last specialist log
        </button>
      )}
    </div>
  );
}
