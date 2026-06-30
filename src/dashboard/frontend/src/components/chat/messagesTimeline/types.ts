import type { WorkingPhase } from '../../../lib/workingPhase';
import type { ChatMessage, CompactBoundary, ProposedPlan, TurnDiffSummary, WorkLogEntry } from '../chat-types';
import type { FailedMessage } from '../ConversationPanel';
import type { RoundVerdict } from '../../CommandDeck/RoundCard';

/**
 * Visual divider injected into the timeline between review rounds.
 *
 * The divider renders immediately after the row whose id matches
 * `afterMessageId`. It is rendered inside the matching row's wrapper so
 * `useVirtualizer.measureElement` accounts for its height automatically;
 * no separate row index is needed and no row is hidden behind virtualization.
 */
export interface RoundMarker {
  /** Insert the divider after the row with this id (any row.id, message or work). */
  afterMessageId: string;
  round: number;
  verdict: RoundVerdict;
  /** Optional extra label suffix (e.g. "synthesis", "round-2"). */
  label?: string;
}

export interface MessagesTimelineProps {
  messages: ChatMessage[];
  workLog: WorkLogEntry[];
  streaming: boolean;
  roundMarkers?: ReadonlyArray<RoundMarker>;
  failedMessages?: FailedMessage[];
  onRetryFailed?: (failedId: string, text: string) => void;
  onDiscardFailed?: (failedId: string) => void;
  proposedPlan?: ProposedPlan;
  compactBoundaries?: CompactBoundary[];
  compacting?: boolean;
  conversationName?: string;
  cwd?: string;
  issueId?: string | null;
  turnDiffSummaryByAssistantMessageId?: Map<string, TurnDiffSummary>;
  onOpenTurnDiff?: (turnId: string, filePath?: string) => void;
  resolvedTheme?: 'light' | 'dark';
  /** When true, pure tool-call work groups are collapsed to a single muted line. */
  hideToolCalls?: boolean;
  /** Current working phase — drives the working indicator icon. */
  workingPhase?: WorkingPhase;
  /** Message target requested by palette conversation search. */
  targetMessageId?: string;
  targetMessageIndex?: number;
  targetMessageNonce?: number;
  /** Called after a requested target message has been scrolled into view. */
  onTargetMessageHandled?: () => void;
}
