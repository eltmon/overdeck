import { useState } from 'react';
import { Bot, ChevronDown, ChevronRight, ClipboardList, GitBranchPlus } from 'lucide-react';
import type { ChatMessage, TurnDiffSummary } from '../chat-types';
import { ChatMarkdown } from '../ChatMarkdown';
import { ChangedFilesTree } from '../ChangedFilesTree';
import { DiffStatLabel } from '../DiffStatLabel';
import { summarizeTurnDiffStats } from '../../../lib/turnDiffTree';
import styles from '../../CommandDeck/styles/command-deck.module.css';
import { formatElapsed, formatTimestamp } from './helpers';
import { SlashCommandDivider } from './dividers';

function isSummaryForkMessage(text: string): boolean {
  return text.startsWith('## Conversation Summary Fork') ||
    text.includes('**Do not take any action.** This is context from a prior conversation fork');
}

function isReviewerContextMessage(text: string): boolean {
  return text.startsWith('# Review Context\n');
}

// PAN-1458: Detect a Claude Code slash-command user message (the literal token Claude
// Code writes when the user types /clear, /compact, /resume, etc.). Returned object
// carries the command name (e.g. '/clear') so the divider can label itself.
function parseSlashCommandMessage(text: string): { command: string } | null {
  const match = text.trimStart().match(/^<command-name>([^<]+)<\/command-name>/);
  return match ? { command: match[1] } : null;
}

export function UserMessageRow({ message, cwd, issueId }: { message: ChatMessage; cwd?: string; issueId?: string | null }) {
  const slashCommand = parseSlashCommandMessage(message.text);
  if (slashCommand) {
    return <SlashCommandDivider command={slashCommand.command} createdAt={message.createdAt} />;
  }
  if (isSummaryForkMessage(message.text)) {
    return <ContextMessageBlock message={message} cwd={cwd} issueId={issueId} />;
  }
  if (isReviewerContextMessage(message.text)) {
    return <ReviewerContextBlock message={message} cwd={cwd} issueId={issueId} />;
  }

  const isPending = message.id.startsWith('optimistic-') && !message.acknowledged;
  return (
    <div className={styles.userMessageRow}>
      <div
        className={styles.userMessageBubble}
        style={isPending ? { opacity: 0.6 } : undefined}
        title={isPending ? 'Pending — waiting for agent to process' : undefined}
      >
        <div className={styles.userMessageText}><ChatMarkdown text={message.text} cwd={cwd} issueId={issueId} /></div>
        <span className={styles.messageTimestamp}>
          {isPending ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              <svg style={{ width: '10px', height: '10px', animation: 'spin 1s linear infinite', color: 'var(--primary)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
              Sending…
            </span>
          ) : (
            formatTimestamp(message.createdAt)
          )}
        </span>
      </div>
    </div>
  );
}

function ContextMessageBlock({ message, cwd, issueId }: { message: ChatMessage; cwd?: string; issueId?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const cleanText = message.text
    .replace(/\n---\n\n\*\*Do not take any action\.\*\*.*$/s, '')
    .trim();

  return (
    <div className={styles.contextMessageRow}>
      <div className={styles.contextMessageBlock}>
        <button
          type="button"
          className={styles.contextMessageToggle}
          onClick={() => setExpanded((v) => !v)}
        >
          <GitBranchPlus size={14} className={styles.contextMessageIcon} />
          <span className={styles.contextMessageLabel}>Conversation Fork Summary</span>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {expanded && (
          <div className={styles.contextMessageContent}>
            <ChatMarkdown text={cleanText} cwd={cwd} issueId={issueId} />
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewerContextBlock({ message, cwd, issueId }: { message: ChatMessage; cwd?: string; issueId?: string | null }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.contextMessageRow}>
      <div className={styles.contextMessageBlock}>
        <button
          type="button"
          className={styles.contextMessageToggle}
          onClick={() => setExpanded((v) => !v)}
        >
          <ClipboardList size={14} className={styles.contextMessageIcon} />
          <span className={styles.contextMessageLabel}>Review Context</span>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {expanded && (
          <div className={styles.contextMessageContent}>
            <ChatMarkdown text={message.text} cwd={cwd} issueId={issueId} />
          </div>
        )}
      </div>
    </div>
  );
}

export function AssistantMessageRow({
  message,
  durationStart,
  isStreaming,
  turnDiffSummary,
  onOpenTurnDiff,
  resolvedTheme,
  cwd,
  issueId,
}: {
  message: ChatMessage;
  durationStart: string;
  isStreaming: boolean;
  cwd?: string;
  issueId?: string | null;
  turnDiffSummary?: TurnDiffSummary;
  onOpenTurnDiff?: (turnId: string, filePath?: string) => void;
  resolvedTheme?: 'light' | 'dark';
}) {
  const duration = message.completedAt
    ? formatElapsed(durationStart, message.completedAt)
    : null;

  const [allExpanded, setAllExpanded] = useState(false);

  return (
    <div className={styles.assistantMessageRow}>
      <Bot size={14} className={styles.assistantMessageAvatar} aria-hidden="true" />
      <div className={styles.assistantMessageContent}>
        <ChatMarkdown text={message.text} isStreaming={isStreaming && !message.completedAt} cwd={cwd} issueId={issueId} />
        {turnDiffSummary && turnDiffSummary.files.length > 0 && (
          <div className="mt-2 rounded-md border border-border/50 bg-muted/30 p-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Changed files ({turnDiffSummary.files.length})
                {' '}
                <DiffStatLabel
                  additions={summarizeTurnDiffStats(turnDiffSummary.files).additions}
                  deletions={summarizeTurnDiffStats(turnDiffSummary.files).deletions}
                  showParentheses
                />
              </span>
              <div className="flex items-center gap-2">
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => setAllExpanded((v) => !v)}
                >
                  {allExpanded ? 'Collapse all' : 'Expand all'}
                </button>
                {onOpenTurnDiff && (
                  <button
                    className="text-[10px] text-primary hover:underline"
                    onClick={() => onOpenTurnDiff(turnDiffSummary.turnId)}
                  >
                    View diff
                  </button>
                )}
              </div>
            </div>
            <ChangedFilesTree
              turnId={turnDiffSummary.turnId}
              files={turnDiffSummary.files}
              allDirectoriesExpanded={allExpanded}
              resolvedTheme={resolvedTheme ?? 'dark'}
              onOpenTurnDiff={onOpenTurnDiff ?? (() => {})}
            />
          </div>
        )}
        <div className={styles.messageMetadata}>
          <span className={styles.messageTimestamp}>
            {formatTimestamp(message.createdAt)}
          </span>
          {duration && (
            <>
              <span className={styles.messageSeparator}>&middot;</span>
              <span className={styles.messageTimestamp}>{duration}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
