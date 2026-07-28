import { ArrowLeft, Loader2 } from 'lucide-react';
import type { Conversation } from '../CommandDeck/ConversationList';
import { MessagesTimeline } from './MessagesTimeline';
import type { SubagentSummary } from './chat-types';
import { useSubagentTranscript } from './useConversationMessagesStream';
import styles from '../CommandDeck/styles/command-deck.module.css';

interface SubagentTranscriptProps {
  conversation: Conversation;
  subagent: SubagentSummary;
  resolvedTheme?: 'light' | 'dark';
  /** Return to the parent conversation (the rail's "Main agent" row does the same). */
  onBack: () => void;
}

/**
 * Full-width transcript for one subagent. Rendered in place of the parent
 * conversation body while a rail row is selected — no composer, because a
 * subagent has no input channel of its own.
 */
export function SubagentTranscript({ conversation, subagent, resolvedTheme, onBack }: SubagentTranscriptProps) {
  const transcript = useSubagentTranscript(conversation, subagent.agentId);

  return (
    <div className={`${styles.subagentTranscript} flex min-h-0 min-w-0 flex-1 flex-col`}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <button
          type="button"
          aria-label="Back to main agent"
          className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft size={16} />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {subagent.agentType} <span className="text-muted-foreground">· {subagent.description}</span>
        </span>
      </header>
      {/* MessagesTimeline sizes itself with `flex: 1`, so this wrapper must be a
          flex column — a plain block gives it no height and it renders clipped
          instead of scrollable (no scrolling, no auto-scroll, no Bottom button). */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {transcript.isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin text-primary" />
            Loading transcript…
          </div>
        ) : transcript.isError ? (
          <div className="flex h-full items-center justify-center px-4 text-sm text-destructive-foreground">
            Couldn&apos;t load this subagent transcript.
          </div>
        ) : (
          <MessagesTimeline
            messages={transcript.data?.messages ?? []}
            workLog={transcript.data?.workLog ?? []}
            streaming={transcript.data?.streaming ?? subagent.status === 'running'}
            conversationName={`${conversation.name}:${subagent.agentId}`}
            cwd={conversation.cwd}
            issueId={conversation.issueId}
            resolvedTheme={resolvedTheme}
          />
        )}
      </div>
    </div>
  );
}
