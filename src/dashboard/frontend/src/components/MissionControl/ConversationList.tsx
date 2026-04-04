import { useState, useRef, useEffect, useCallback } from 'react';
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
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
      setIsAdding(false);
      setNewName('');
      setError(null);
      onSelectConversation(conv.name);
    },
    onError: (err: Error) => {
      setError(err.message);
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

  // Focus input when showing the add form
  useEffect(() => {
    if (isAdding) {
      inputRef.current?.focus();
    }
  }, [isAdding]);

  const handleAddClick = useCallback(() => {
    setIsAdding(true);
    setNewName('');
    setError(null);
  }, []);

  const handleSubmit = useCallback(() => {
    const name = newName.trim();
    createMutation.mutate(name); // empty string → server auto-generates
  }, [newName, createMutation]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setIsAdding(false);
      setNewName('');
      setError(null);
    }
  }, [handleSubmit]);

  const handleDelete = useCallback((e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    deleteMutation.mutate(name);
  }, [deleteMutation]);

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
          {/* Inline add form */}
          {isAdding && (
            <div className={styles.conversationAddForm}>
              <input
                ref={inputRef}
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Name (leave blank for auto)"
                className={styles.conversationInput}
                disabled={createMutation.isPending}
              />
              {error && <div className={styles.conversationError}>{error}</div>}
            </div>
          )}

          {/* Session list */}
          {conversations.length === 0 && !isAdding ? (
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
                <span className={styles.conversationName}>{conv.name}</span>
                <button
                  className={styles.conversationDeleteBtn}
                  onClick={e => handleDelete(e, conv.name)}
                  title="Stop session"
                  aria-label={`Stop ${conv.name}`}
                >
                  ×
                </button>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
