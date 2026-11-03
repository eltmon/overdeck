/**
 * Prompt suggestions in a Shared Session (PAN-4476 WI-11, FR-3, FR-4): each participant's live draft
 * as a row with their avatar, `@login` and text. `view` mode is read-only (viewers see the others'
 * drafts). `controller` mode adds **Use**, which opens an inline editor prefilled with the text;
 * **Send** hands the edited text to `onSend`. A rejected send keeps the editor open with its message.
 */
import { sharedPromptRefusal } from '@overdeck/contracts';
import { useState } from 'react';

export interface SuggestionItem {
  githubId: number;
  login: string;
  avatarUrl: string | null;
  text: string;
}

export interface SuggestionListProps {
  items: readonly SuggestionItem[];
  mode: 'view' | 'controller';
  onSend?: (item: SuggestionItem, text: string) => Promise<void>;
}

/** The queue line both the viewer page and the share dialog show (FR-10); null when there is nothing to say. */
export function queueStatusText(status: { agentWorking?: boolean; queued?: number } | undefined): string | null {
  const working = status?.agentWorking === true;
  const queued = status?.queued ?? 0;
  if (working && queued > 0) return `Agent is working · ${queued} queued`;
  if (working) return 'Agent is working';
  if (queued > 0) return `${queued} queued`;
  return null;
}

const NEUTRAL_BUTTON =
  'rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50';

interface Editing {
  githubId: number;
  text: string;
  pending: boolean;
  error: string | null;
}

export function SuggestionList({ items, mode, onSend }: SuggestionListProps) {
  const [editing, setEditing] = useState<Editing | null>(null);
  if (items.length === 0) return null;

  const send = async (item: SuggestionItem, text: string) => {
    if (!onSend) return;
    setEditing({ githubId: item.githubId, text, pending: true, error: null });
    try {
      await onSend(item, text);
      setEditing(null);
    } catch (error) {
      setEditing({ githubId: item.githubId, text, pending: false, error: error instanceof Error ? error.message : 'The suggestion was not sent.' });
    }
  };

  return (
    <section data-component="suggestion-list">
      <h3 className="text-xs font-medium text-muted-foreground">Suggestions ({items.length})</h3>
      <ul className="mt-1 space-y-1.5">
        {items.map((item) => {
          const open = mode === 'controller' && editing?.githubId === item.githubId ? editing : null;
          return (
            <li key={item.githubId} aria-label={`Suggestion from @${item.login}`} className="flex items-start gap-2 py-1">
              {item.avatarUrl ? (
                <img src={item.avatarUrl} alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-sm" />
              ) : (
                <span className="h-5 w-5 shrink-0 rounded-sm border border-border" />
              )}
              <div className="min-w-0 flex-1">
                <span className="font-mono text-xs">@{item.login}</span>
                {open ? (
                  <div className="mt-1 space-y-1">
                    <textarea
                      aria-label={`Edit suggestion from @${item.login}`}
                      className="w-full resize-y rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                      rows={3}
                      maxLength={8000}
                      value={open.text}
                      disabled={open.pending}
                      onChange={(event) => setEditing({ ...open, text: event.target.value, error: null })}
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className={NEUTRAL_BUTTON}
                        aria-label={`Send suggestion from @${item.login}`}
                        disabled={open.pending || sharedPromptRefusal(open.text) !== null}
                        onClick={() => void send(item, open.text)}
                      >
                        Send
                      </button>
                      <button type="button" className={NEUTRAL_BUTTON} disabled={open.pending} onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                    {open.error && <p role="alert" className="text-xs text-destructive">{open.error}</p>}
                  </div>
                ) : (
                  <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs text-foreground">{item.text}</p>
                )}
              </div>
              {mode === 'controller' && !open && (
                <button
                  type="button"
                  className={`${NEUTRAL_BUTTON} shrink-0`}
                  aria-label={`Use suggestion from @${item.login}`}
                  onClick={() => setEditing({ githubId: item.githubId, text: item.text, pending: false, error: null })}
                >
                  Use
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
