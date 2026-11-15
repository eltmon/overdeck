/**
 * The "Blocked by" list of an expanded car or strike (PAN-4753 WI-10, FR-15):
 * one row per blocker, a red badge with the pre-Cut `blockerIcon` and the
 * blocker label, then its details (or summary).
 */
import type { ComponentType } from 'react';
import { AlertTriangle, FilePenLine, GitPullRequest, MessageSquare, PenLine, XCircle } from 'lucide-react';
import type { BlockerType, CarBlocker } from './boardTypes';
import { BLOCKER_LABEL } from './trainCopy';
import { TONE_CLASS } from './CarStatusPill';

const BLOCKER_ICON: Record<BlockerType, ComponentType<{ className?: string }>> = {
  failing_checks: XCircle,
  merge_conflict: GitPullRequest,
  unresolved_conversations: MessageSquare,
  changes_requested: FilePenLine,
  draft_pr: PenLine,
  not_mergeable: AlertTriangle,
};

export function BlockerList({ blockers }: { blockers: readonly CarBlocker[] }) {
  if (blockers.length === 0) return null;
  return (
    <ul data-testid="blocker-list" className="space-y-1">
      {blockers.map((blocker, i) => {
        const Icon = BLOCKER_ICON[blocker.type];
        return (
          <li key={`${blocker.type}-${i}`} data-blocker={blocker.type} className="flex items-start gap-2 text-[11px]">
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium ${TONE_CLASS.destructive}`}>
              <Icon className="h-3 w-3" />
              {BLOCKER_LABEL[blocker.type]}
            </span>
            <span className="min-w-0 break-words leading-snug text-muted-foreground">{blocker.details ?? blocker.summary}</span>
          </li>
        );
      })}
    </ul>
  );
}
