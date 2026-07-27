import { memo } from 'react';
import type { WorkingPhase } from '../../../lib/workingPhase';
import type { SubagentSummary, TurnDiffSummary } from '../chat-types';
import type { MessagesTimelineRow } from '../MessagesTimeline.logic';
import { PlanCard } from '../PlanCard';
import { AssistantMessageRow, UserMessageRow } from './messageRows';
import { WorkLogGroup } from './workLogRows';
import { CommandResultRow } from './CommandResultRow';
import { PaneChoiceAnsweredRow, PaneChoiceCard } from './PaneChoiceCard';
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
  subagentByToolUseId?: ReadonlyMap<string, SubagentSummary>;
  onOpenSubagent?: (toolUseId: string) => void;
  turnDiffSummary?: TurnDiffSummary;
  onOpenTurnDiff?: (turnId: string, filePath?: string) => void;
  resolvedTheme?: 'light' | 'dark';
  hideToolCalls?: boolean;
  workingPhase?: WorkingPhase;
  onConfirmCommand?: (messageId: string, typedText?: string) => Promise<void>;
  /** PAN-3113 — switch the panel to terminal mode ("Open terminal" on the card). */
  onOpenTerminal?: () => void;
  /** PAN-3113 — record a dashboard-answered pane choice. */
  onPaneChoiceAnswered?: (signature: string, label: string) => void;
}

export const TimelineRowRenderer = memo(function TimelineRowRenderer({ row, isStreaming, conversationName, cwd, issueId, subagentByToolUseId, onOpenSubagent, turnDiffSummary, onOpenTurnDiff, resolvedTheme, hideToolCalls, workingPhase, onConfirmCommand, onOpenTerminal, onPaneChoiceAnswered }: RowProps) {
  if (row.kind === 'working') {
    return <WorkingIndicator startedAt={row.createdAt} phase={workingPhase} />;
  }
  if (row.kind === 'work') {
    return <WorkLogGroup entries={row.groupedEntries} hideToolCalls={hideToolCalls} cwd={cwd} issueId={issueId} subagentByToolUseId={subagentByToolUseId} onOpenSubagent={onOpenSubagent} />;
  }
  if (row.kind === 'proposed-plan') {
    return <PlanCard plan={row.plan} conversationName={conversationName ?? ''} />;
  }
  if (row.kind === 'pending-choice') {
    return (
      <PaneChoiceCard
        key={row.choice.signature}
        choice={row.choice}
        conversationName={conversationName}
        onOpenTerminal={onOpenTerminal}
        onAnswered={onPaneChoiceAnswered}
      />
    );
  }
  if (row.kind === 'answered-choice') {
    return <PaneChoiceAnsweredRow answered={row.answered} />;
  }
  if (row.kind === 'compact-boundary') {
    return <CompactBoundaryDivider boundary={row.boundary} />;
  }
  if (row.kind === 'compacting') {
    return <CompactingIndicator />;
  }
  if (row.message.commandResult) {
    return <CommandResultRow message={row.message} onConfirm={onConfirmCommand} />;
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
