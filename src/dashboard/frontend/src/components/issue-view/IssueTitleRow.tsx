/**
 * PAN-5246 · the one issue title row, shared by both shells.
 *
 * Issue id, title, derived state badge, spend, the action strip and shell
 * trailing chrome, in that order. The drawer renders it in its header (h2,
 * never wraps, title truncates); the Stage tab renders it as the page's
 * subject (h1, wraps in a narrow pane, title wraps to at most 3 lines,
 * breadcrumb in `leading`).
 */
import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';
import type { SessionAgent } from '../../lib/agentConversation';
import { IssueHeaderTitle } from './IssueHeaderTitle';
import { IssueCostChip, IssueStateBadge } from './IssueHeaderFacts';
import type { IssueRecordStatus } from './useIssueRecord';

export interface IssueTitleRowProps {
  issueId: string;
  /** The title the shell resolved; null shows IssueHeaderTitle's skeleton or hint. */
  title: string | null;
  titleStatus: IssueRecordStatus;
  agents: readonly SessionAgent[];
  trackerStatus?: string | null;
  /** The drawer is a dialog section (h2); the Stage tab is the page's subject (h1). */
  heading?: 'h1' | 'h2';
  /** Let the row wrap (the Stage pane can be narrow). The drawer never wraps. */
  wrap?: boolean;
  /** Before the id: the Stage breadcrumb. */
  leading?: ReactNode;
  /** The issue action strip. */
  actions: ReactNode;
  /** After the actions: the tracker link, and the drawer's close button. */
  trailing?: ReactNode;
}

export function IssueTitleRow({ issueId, title, titleStatus, agents, trackerStatus, heading: Heading = 'h2', wrap = false, leading, actions, trailing }: IssueTitleRowProps) {
  return (
    <div data-component="issue-title-row" className={cn(
      'flex items-center gap-x-[10px] pl-[20px] pr-[16px]',
      wrap ? 'min-h-[46px] flex-wrap gap-y-[6px] py-[6px]' : 'h-[46px]',
    )}>
      {leading}
      <span className="shrink-0 font-mono-ui text-[12px] text-muted-foreground">{issueId}</span>
      <Heading title={title ?? undefined} className={cn(
        'font-display text-[15px] font-semibold leading-[1.3] tracking-[-0.012em] text-foreground',
        // PAN-5279: the Stage title wraps (up to 3 lines); the fixed-height drawer row truncates.
        wrap ? 'line-clamp-3 min-w-[200px] flex-1 break-words' : 'min-w-0 flex-initial truncate',
      )}>
        <IssueHeaderTitle issueId={issueId} title={title} status={titleStatus} />
      </Heading>
      <IssueStateBadge issueId={issueId} agents={agents} trackerStatus={trackerStatus} />
      {wrap ? null : <span className="flex-1" />}
      <IssueCostChip issueId={issueId} />
      {actions}
      {trailing}
    </div>
  );
}
