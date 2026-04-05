import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, Circle } from 'lucide-react';
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
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch('/api/conversations');
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

async function createConversation(name: string): Promise<Conversation> {
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error((err as { error?: string }).error || 'Failed to create conversation');
  }
  return res.json();
}

async function deleteConversation(name: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete conversation');
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ConversationListProps {
  selectedConversation: string | null;
  onSelectConversation: (name: string | null) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationList({ selectedConversation, onSelectConversation }: ConversationListProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const queryClient = useQueryClient();

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  });

  const createMutation = useMutation({
    mutationFn: createConversation,
    onSuccess: (conv) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      onSelectConversation(conv.name);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_data, name) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (selectedConversation === name) {
        onSelectConversation(null);
      }
    },
  });

  const handleAddClick = useCallback(() => {
    createMutation.mutate(''); // server auto-generates name
  }, [createMutation]);

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
          {conversations.length === 0 ? (
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
                <span
                  role="button"
                  tabIndex={0}
                  className={styles.conversationDeleteBtn}
                  onClick={e => { e.stopPropagation(); deleteMutation.mutate(conv.name); }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); deleteMutation.mutate(conv.name); } }}
                  title="Stop session"
                  aria-label={`Stop ${conv.name}`}
                >
                  ×
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
