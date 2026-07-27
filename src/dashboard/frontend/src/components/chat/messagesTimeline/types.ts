import type { WorkingPhase } from '../../../lib/workingPhase';
import type { ChatMessage, CompactBoundary, ProposedPlan, SubagentSummary, TurnDiffSummary, WorkLogEntry } from '../chat-types';
import type { FailedMessage } from '../ConversationPanel';
import type { RoundVerdict } from '../../CommandDeck/RoundCard';
import type { AnsweredPaneChoice, PendingPaneChoice } from '../../../lib/paneChoice';

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
  onConfirmCommand?: (messageId: string, typedText?: string) => Promise<void>;
  proposedPlan?: ProposedPlan;
  /** PAN-3113 — live blocking choice menu parsed from this conversation's pane. */
  paneChoice?: PendingPaneChoice | null;
  /** PAN-3113 — choices the operator answered from the dashboard this mount. */
  answeredPaneChoices?: ReadonlyArray<AnsweredPaneChoice>;
  /** PAN-3113 — record a dashboard-answered pane choice (signature + label). */
  onPaneChoiceAnswered?: (signature: string, label: string) => void;
  /** PAN-3113 — switch the panel to terminal mode ("Open terminal" on the card). */
  onOpenTerminal?: () => void;
  compactBoundaries?: CompactBoundary[];
  compacting?: boolean;
  conversationName?: string;
  cwd?: string;
  issueId?: string | null;
  subagentByToolUseId?: ReadonlyMap<string, SubagentSummary>;
  onOpenSubagent?: (toolUseId: string) => void;
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
