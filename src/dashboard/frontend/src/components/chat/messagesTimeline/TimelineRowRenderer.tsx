import { memo } from 'react';
import type { WorkingPhase } from '../../../lib/workingPhase';
import type { TurnDiffSummary } from '../chat-types';
import type { MessagesTimelineRow } from '../MessagesTimeline.logic';
import { PlanCard } from '../PlanCard';
import { AssistantMessageRow, UserMessageRow } from './messageRows';
import { WorkLogGroup } from './workLogRows';
import {
  CompactBoundaryDivider,
  CompactingIndicator,
  SessionPermissionsRow,
  WorkingIndicator,
} from './dividers';

interface RowProps {
  row: MessagesTimelineRow;
  isStreaming: boolean;
  conversationName?: string;
  cwd?: string;
  issueId?: string | null;
  turnDiffSummary?: TurnDiffSummary;
  onOpenTurnDiff?: (turnId: string, filePath?: string) => void;
  resolvedTheme?: 'light' | 'dark';
  hideToolCalls?: boolean;
  workingPhase?: WorkingPhase;
}

export const TimelineRowRenderer = memo(function TimelineRowRenderer({ row, isStreaming, conversationName, cwd, issueId, turnDiffSummary, onOpenTurnDiff, resolvedTheme, hideToolCalls, workingPhase }: RowProps) {
  if (row.kind === 'working') {
    return <WorkingIndicator startedAt={row.createdAt} phase={workingPhase} />;
  }
  if (row.kind === 'work') {
    return <WorkLogGroup entries={row.groupedEntries} hideToolCalls={hideToolCalls} cwd={cwd} issueId={issueId} />;
  }
  if (row.kind === 'proposed-plan') {
    return <PlanCard plan={row.plan} conversationName={conversationName ?? ''} />;
  }
  if (row.kind === 'compact-boundary') {
    return <CompactBoundaryDivider boundary={row.boundary} />;
  }
  if (row.kind === 'compacting') {
    return <CompactingIndicator />;
  }
  if (row.message.role === 'system') {
    return <SessionPermissionsRow message={row.message} />;
  }
  if (row.message.role === 'user') {
    return <UserMessageRow message={row.message} cwd={cwd} issueId={issueId} />;
  }
  return (
    <AssistantMessageRow
      message={row.message}
      durationStart={row.durationStart}
      isStreaming={isStreaming}
      cwd={cwd}
      issueId={issueId}
      turnDiffSummary={turnDiffSummary}
      onOpenTurnDiff={onOpenTurnDiff}
      resolvedTheme={resolvedTheme}
    />
  );
});
