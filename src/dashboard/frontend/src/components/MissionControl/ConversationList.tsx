import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Circle, Archive, Copy, Check, X } from 'lucide-react';
import styles from './styles/mission-control.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Conversation {
  id: number;
  name: string;
  tmuxSession: string;
  status: 'active' | 'ended';
  cwd: string;
  issueId: string | null;
  createdAt: string;
  endedAt: string | null;
  lastAttachedAt: string | null;
  sessionAlive: boolean;
  /** Absolute path to the Claude Code JSONL session file. Null until discovered. */
  sessionFile?: string | null;
  /** Human-readable title, auto-set from first message. Null until first message sent. */
  title?: string | null;
  /** How the title was set: 'auto', 'ai', or 'manual'. */
  titleSource?: 'auto' | 'ai' | 'manual' | null;
  /** Original auto-generated title seed. */
  titleSeed?: string | null;
  /** Cached total cost in USD. */
  totalCost?: number;
  /** Model used for this conversation. Null until backfilled from session file. */
  model?: string | null;
  /** Effort level used when spawning this conversation. */
  effort?: string | null;
}

/** Marker that we're in draft mode — no session spawned yet. */
export type DraftSession = true;

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch('/api/conversations');
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

// No spawn API call — draft mode just shows the composer. Session is spawned on first message.

async function archiveConversation(name: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/archive`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to archive conversation');
}

async function stopConversation(name: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/stop`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to stop conversation');
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ConversationListProps {
  selectedConversation: string | null;
  onSelectConversation: (name: string | null) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationList({ selectedConversation, onSelectConversation }: ConversationListProps) {
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  });

  const archiveMutation = useMutation({
    mutationFn: archiveConversation,
    onSuccess: (_data, name) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (selectedConversation === name) {
        onSelectConversation(null);
      }
    },
  });

  const stopMutation = useMutation({
    mutationFn: stopConversation,
    onSuccess: (_data, name) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (selectedConversation === name) {
        onSelectConversation(null);
      }
    },
  });

  const handleCopyLink = useCallback((convId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/conv/${convId}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedId(convId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  if (isLoading) {
    return (
      <div className={styles.skeletonList}>
        <div className={styles.skeletonItem} />
        <div className={styles.skeletonItem} />
      </div>
    );
  }

  if (conversations.length === 0) {
    return <div className={styles.conversationEmpty}>No conversations yet</div>;
  }

  return (
    <div className={styles.conversationList}>
      {conversations.map(conv => (
        <button
          key={conv.id}
          className={`${styles.conversationItem} ${selectedConversation === conv.name ? styles.conversationItemSelected : ''}`}
          onClick={() => onSelectConversation(conv.name)}
          title={conv.name}
        >
          {conv.sessionAlive && (
            <span
              role="button"
              tabIndex={0}
              className={styles.conversationStopBtn}
              onClick={e => { e.stopPropagation(); if (!stopMutation.isPending) stopMutation.mutate(conv.name); }}
              onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !stopMutation.isPending) { e.stopPropagation(); stopMutation.mutate(conv.name); } }}
              title="Stop agent"
              aria-label={`Stop agent for ${conv.name}`}
            >
              <X size={11} />
            </span>
          )}
          <Circle
            size={7}
            className={styles.conversationDot}
            style={{
              fill: conv.sessionAlive ? 'var(--mc-success)' : 'var(--mc-text-muted)',
              color: conv.sessionAlive ? 'var(--mc-success)' : 'var(--mc-text-muted)',
            }}
          />
          <span className={styles.conversationName}>{conv.title ?? conv.name}</span>
          {conv.totalCost !== undefined && conv.totalCost > 0 && (
            <span className={styles.featureCost}>
              {conv.totalCost < 0.01 ? '<$0.01' : `$${conv.totalCost.toFixed(2)}`}
            </span>
          )}
          <span
            role="button"
            tabIndex={0}
            className={styles.conversationArchiveBtn}
            onClick={e => { e.stopPropagation(); archiveMutation.mutate(conv.name); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); archiveMutation.mutate(conv.name); } }}
            title="Archive conversation"
            aria-label={`Archive ${conv.name}`}
          >
            <Archive size={11} />
          </span>
          <span
            role="button"
            tabIndex={0}
            className={styles.conversationCopyBtn}
            onClick={e => handleCopyLink(conv.id, e)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); handleCopyLink(conv.id, e as unknown as React.MouseEvent); } }}
            title="Copy link to conversation"
            aria-label={`Copy link to ${conv.name}`}
          >
            {copiedId === conv.id ? <Check size={11} /> : <Copy size={11} />}
          </span>
        </button>
      ))}
    </div>
  );
}
