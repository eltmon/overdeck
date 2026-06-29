import { ExternalLink, Eye } from 'lucide-react';
import type { Issue } from '../../../types';

// Tracker vs Shadow state badges — shows when Rally state differs from Overdeck shadow state
export function TrackerShadowBadges({ issue, compact = false }: { issue: Issue; compact?: boolean }) {
  const trackerState = issue.rawTrackerState || issue.shadowTrackerStatus;
  const shadowState = issue.shadowStatus || issue.targetCanonicalState;

  // Only show when states diverge
  if (!trackerState || !shadowState) return null;

  // Map shadow canonical states to display names
  const shadowLabel = shadowState === 'in_progress' ? 'In Progress' :
                      shadowState === 'closed' ? 'Done' :
                      shadowState === 'done' ? 'Done' :
                      shadowState === 'in_review' ? 'In Review' :
                      shadowState;

  // Check if they're actually different
  const trackerLower = trackerState.toLowerCase().replace(/[-_\s]/g, '');
  const shadowLower = shadowLabel.toLowerCase().replace(/[-_\s]/g, '');
  if (trackerLower === shadowLower) return null;

  if (compact) {
    return (
      <span
        className="w-2 h-2 rounded-full badge-bg-signal-review shrink-0"
        title={`Rally: ${trackerState} → Pan: ${shadowLabel}`}
      />
    );
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted text-foreground">
        <ExternalLink className="w-2.5 h-2.5" />
        {trackerState}
      </span>
      <span className="text-muted-foreground">→</span>
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded badge-bg-signal-review text-signal-review-foreground">
        <Eye className="w-2.5 h-2.5" />
        {shadowLabel}
      </span>
    </div>
  );
}
