import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, Circle, Archive } from 'lucide-react';
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

// ─── Props ────────────────────────────────────────────────────────────────────

interface ConversationListProps {
  selectedConversation: string | null;
  onSelectConversation: (name: string | null) => void;
  onDraftCreated: (draft: DraftSession) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationList({ selectedConversation, onSelectConversation, onDraftCreated }: ConversationListProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const queryClient = useQueryClient();

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  });

  // No mutation needed — draft mode is just local state

  const archiveMutation = useMutation({
    mutationFn: archiveConversation,
    onSuccess: (_data, name) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (selectedConversation === name) {
        onSelectConversation(null);
      }
    },
  });

  const handleAddClick = useCallback(() => {
    onDraftCreated(true);
  }, [onDraftCreated]);

  return (
    <div className={styles.conversationSection}>
      {/* Section header */}
      <div className={styles.conversationHeader}>
        <button
          className={styles.conversationToggle}
          onClick={() => setIsExpanded(prev => !prev)}
          aria-expanded={isExpanded}
        >
          <ChevronRight
            size={12}
            className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ''}`}
          />
          <span className={styles.conversationTitle}>Conversations</span>
          <span className={styles.featureCount}>{conversations.length}</span>
        </button>
        <button
          className={styles.conversationAddBtn}
          onClick={handleAddClick}
          title="New conversation"
          aria-label="New conversation"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* Collapsed or expanded content */}
      {isExpanded && (
        <div className={styles.conversationList}>
          {/* Session list */}
          {isLoading ? (
            <div className={styles.skeletonList}>
              <div className={styles.skeletonItem} />
              <div className={styles.skeletonItem} />
            </div>
          ) : conversations.length === 0 ? (
            <div className={styles.conversationEmpty}>No conversations yet</div>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.id}
                className={`${styles.conversationItem} ${selectedConversation === conv.name ? styles.conversationItemSelected : ''}`}
                onClick={() => onSelectConversation(conv.name)}
                title={conv.name}
              >
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
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
