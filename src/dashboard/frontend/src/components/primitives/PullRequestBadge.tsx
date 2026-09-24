import type { PullRequestLink } from '@overdeck/contracts';
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react';
import { cn } from '../../lib/utils';

export type PullRequestBadgeTone = 'muted' | 'info' | 'warning' | 'success' | 'destructive';

/**
 * PAN-3822 tone law: blue = open (a machine is working), amber = a human must
 * act on review, emerald = merged, destructive = closed unmerged, muted = draft
 * or not yet synced. Failing checks never change the tone (one colored signal
 * per row); they show as a glyph and in the tooltip.
 */
export function pullRequestBadgeTone(link: PullRequestLink): PullRequestBadgeTone {
  const snapshot = link.snapshot;
  if (!snapshot) return 'muted';
  if (snapshot.state === 'merged') return 'success';
  if (snapshot.state === 'closed') return 'destructive';
  if (snapshot.isDraft) return 'muted';
  if (snapshot.reviewState === 'changes-requested' || snapshot.reviewState === 'review-requested') return 'warning';
  return 'info';
}

export function pullRequestBadgeLabel(link: PullRequestLink): string {
  const snapshot = link.snapshot;
  const parts = [`${link.repository} #${link.number}`, snapshot ? snapshot.state : 'not synced yet'];
  if (snapshot?.isDraft) parts.push('draft');
  if (snapshot?.checks === 'red') parts.push('checks failing');
  if (snapshot?.reviewState === 'changes-requested') parts.push('changes requested');
  if (snapshot?.title) parts.push(snapshot.title);
  return parts.join(' · ');
}

const TONE_CLASSES: Record<PullRequestBadgeTone, string> = {
  muted: 'badge-bg-muted badge-border-muted text-muted-foreground',
  info: 'badge-bg-info badge-border-info text-info-foreground',
  warning: 'badge-bg-warning badge-border-warning text-warning-foreground',
  success: 'badge-bg-success badge-border-success text-success-foreground',
  destructive: 'badge-bg-destructive badge-border-destructive text-destructive-foreground',
};

function StateIcon({ link }: { link: PullRequestLink }) {
  const state = link.snapshot?.state;
  if (state === 'merged') return <GitMerge size={10} aria-hidden />;
  if (state === 'closed') return <GitPullRequestClosed size={10} aria-hidden />;
  if (link.snapshot?.isDraft) return <GitPullRequestDraft size={10} aria-hidden />;
  return <GitPullRequest size={10} aria-hidden />;
}

/**
 * The effective pull request of a conversation, rendered from its stored
 * snapshot (no live forge read). Clicking opens the PR and never selects the
 * surrounding row. `extraCount` appends `+N` for additional live links.
 */
export function PullRequestBadge({ link, extraCount = 0, className }: {
  link: PullRequestLink;
  extraCount?: number;
  className?: string;
}) {
  const tone = pullRequestBadgeTone(link);
  const label = pullRequestBadgeLabel(link);
  const open = () => { window.open(link.url, '_blank', 'noopener,noreferrer'); };
  // A span with role="link", not an <a>: conversation rows are <button>s, and
  // interactive content may not nest inside a button (same as the row's stop control).
  return (
    <span
      role="link"
      tabIndex={0}
      title={label}
      aria-label={label}
      data-href={link.url}
      data-tone={tone}
      onClick={(event) => { event.stopPropagation(); open(); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          open();
        }
      }}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center gap-[3px] rounded-[4px] border px-1.5 text-[10px] leading-4 hover:underline',
        TONE_CLASSES[tone],
        className,
      )}
    >
      <StateIcon link={link} />
      <span>#{link.number}</span>
      {link.snapshot?.checks === 'red' && <span aria-hidden>×</span>}
      {extraCount > 0 && <span className="text-muted-foreground">+{extraCount}</span>}
    </span>
  );
}
