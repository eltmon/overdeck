/**
 * PAN-4641 WI-12: a message the server holds until the conversation's usage
 * limit resets, shown at the end of the timeline as a dimmed user bubble with
 * its expected send time. A pending row can be edited or cancelled; a failed
 * or unconfirmed row can only be dismissed; a row being sent has no actions.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import type { ChatMessage, ScheduledMessage } from '../chat-types';
import { ChatMarkdown } from '../ChatMarkdown';
import { scheduledSendLabel, useScheduledMessages } from '../scheduledMessages';
import styles from '../../CommandDeck/styles/command-deck.module.css';
import { MessageRoleIcon } from '../bookmarks/MessageRoleIcon';

const LINK_BUTTON_STYLE = { border: 'none', background: 'transparent', padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer' } as const;

function LinkButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={LINK_BUTTON_STYLE}>
      {label}
    </button>
  );
}

export function ScheduledMessageRow({ message, scheduled, cwd, issueId }: {
  message: ChatMessage;
  scheduled: ScheduledMessage;
  cwd?: string;
  issueId?: string | null;
}) {
  const { edit, cancel } = useScheduledMessages(scheduled.conversationName, true);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    try {
      await action();
      after?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const pending = scheduled.status === 'pending';
  const dismissable = scheduled.status === 'failed' || scheduled.status === 'unknown';

  return (
    <div className={styles.userMessageRow}>
      <div className={styles.userMessageBubble} style={{ opacity: 0.6 }} title="Queued on the server: sends when the usage limit resets.">
        {draft === null ? (
          <div className={styles.userMessageText}><ChatMarkdown text={message.text} cwd={cwd} issueId={issueId} /></div>
        ) : (
          <textarea
            aria-label="Edit queued message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={Math.min(10, Math.max(3, draft.split('\n').length))}
            style={{ width: '100%', resize: 'vertical', font: 'inherit' }}
          />
        )}
        <span className={styles.messageTimestamp}>
          {scheduledSendLabel(scheduled, new Date())}
          {draft !== null ? (
            <>
              {' · '}
              <LinkButton label="Save" disabled={busy} onClick={() => void run(() => edit(scheduled.id, draft), () => setDraft(null))} />
              {' · '}
              <LinkButton label="Discard" disabled={busy} onClick={() => setDraft(null)} />
            </>
          ) : pending ? (
            <>
              {' · '}
              <LinkButton label="Edit" disabled={busy} onClick={() => setDraft(scheduled.text)} />
              {' · '}
              <LinkButton label="Cancel" disabled={busy} onClick={() => void run(() => cancel(scheduled.id))} />
            </>
          ) : dismissable ? (
            <>
              {' · '}
              <LinkButton label="Dismiss" disabled={busy} onClick={() => void run(() => cancel(scheduled.id))} />
            </>
          ) : null}
        </span>
      </div>
      <MessageRoleIcon message={message} role="user" bookmarkable={false} className="ml-2 mt-3 shrink-0 text-muted-foreground opacity-70" />
    </div>
  );
}
