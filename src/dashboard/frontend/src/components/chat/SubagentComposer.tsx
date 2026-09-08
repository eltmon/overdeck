import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { $getRoot, type LexicalEditor } from 'lexical';
import { SendHorizontal } from 'lucide-react';
import { ComposerPromptEditor, loadDraft } from './ComposerPromptEditor';
import type { Conversation } from '../CommandDeck/ConversationList';
import type { SubagentSummary } from './chat-types';
import styles from '../CommandDeck/styles/command-deck.module.css';

/** Mount with a child-specific key: sends and drafts must never cross recipients. */
export function SubagentComposer({ conversation, subagent }: { conversation: Conversation; subagent: SubagentSummary }) {
  const queryClient = useQueryClient();
  const draftKey = `${conversation.name}:subagent:${subagent.agentId}`;
  const endpoint = `/api/conversations/${encodeURIComponent(conversation.name)}/subagents/${encodeURIComponent(subagent.agentId)}/input`;
  const editorRef = useRef<LexicalEditor | null>(null);
  const sendingRef = useRef(false);
  const [text, setText] = useState(() => loadDraft(draftKey));
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [failed, setFailed] = useState(false);
  const capability = useQuery({
    queryKey: ['subagent-input', conversation.name, subagent.agentId],
    enabled: conversation.harness === 'codex' && conversation.sessionAlive && !conversation.endedAt,
    queryFn: async () => {
      const response = await fetch(endpoint);
      if (!response.ok) return false;
      const body = await response.json();
      return body.direct === true;
    },
    retry: false,
    refetchInterval: 5_000,
    staleTime: 0,
  });

  async function send() {
    if (!text.trim() || sendingRef.current || capability.data !== true) return;
    sendingRef.current = true;
    setSending(true);
    setFeedback('');
    setFailed(false);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }),
      });
      const body = await response.json();
      if (!response.ok || body.ok !== true || body.threadId !== subagent.agentId) {
        throw new Error(body.error || 'Could not confirm delivery. Check the child transcript before retrying.');
      }
      editorRef.current?.update(() => { $getRoot().clear(); });
      setText('');
      setFeedback(`Sent to ${subagent.agentType}.`);
      void queryClient.invalidateQueries({ queryKey: ['conversation-messages', conversation.name, 'subagent', subagent.agentId] });
    } catch (error) {
      setFailed(true);
      setFeedback(error instanceof Error ? error.message : 'Could not confirm delivery. Check the child transcript before retrying.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  // No placeholder composer for unsupported harnesses, old hosts, or unloaded children.
  if (!conversation.sessionAlive || conversation.endedAt || conversation.harness !== 'codex' || capability.isError || capability.data !== true) return null;
  return (
    <div className={styles.composerFooter}>
      <div className="px-3 pt-2 text-xs text-muted-foreground">Message {subagent.agentType} directly</div>
      <ComposerPromptEditor conversationName={draftKey} harness="codex" slashCommandsEnabled={false}
        editorRef={editorRef} disabled={sending} onChange={setText} onCommandKeyDown={() => void send()}
        placeholder={`Message ${subagent.agentType}…`} />
      <div className="flex items-center justify-end gap-2 px-3 pb-2">
        {feedback && <span role={failed ? 'alert' : 'status'} className="mr-auto text-xs">{feedback}</span>}
        <button type="button" aria-label={`Send to ${subagent.agentType}`} disabled={sending || !text.trim()}
          className="rounded-md bg-primary p-2 text-primary-foreground disabled:opacity-50" onClick={() => void send()}>
          <SendHorizontal size={16} />
        </button>
      </div>
    </div>
  );
}
