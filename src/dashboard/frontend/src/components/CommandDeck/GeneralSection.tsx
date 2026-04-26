import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, MessageSquare, Loader2, Trash2, X } from 'lucide-react';
import styles from './styles/command-deck.module.css';

interface GeneralConversation {
  id: string;
  name: string;
  tmuxSession: string;
  createdAt: string;
  cwd: string;
  status: 'running' | 'stopped';
}

interface GeneralSectionProps {
  selectedConversation: string | null;
  onSelectConversation: (tmuxSession: string, name: string) => void;
}

async function fetchConversations(): Promise<{ conversations: GeneralConversation[] }> {
  const res = await fetch('/api/general/conversations');
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

export function GeneralSection({ selectedConversation, onSelectConversation }: GeneralSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['general-conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  });

  const conversations = data?.conversations || [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/general/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Failed to create conversation');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['general-conversations'] });
      // Auto-select the new conversation
      const convo = data.conversation;
      onSelectConversation(convo.tmuxSession, convo.name);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/general/conversations/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete conversation');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['general-conversations'] });
      setConfirmDelete(null);
    },
  });

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirmDelete === id) {
      deleteMutation.mutate(id);
    } else {
      setConfirmDelete(id);
    }
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(null);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <div className={styles.generalSection}>
      <div className={styles.generalHeader}>
        <button
          className={styles.projectHeader}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRight
            className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
            size={14}
          />
          <span className={styles.projectName}>General</span>
          <span className={styles.featureCount}>{conversations.length}</span>
        </button>
        <button
          className={styles.newThreadButton}
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          title="New conversation"
        >
          {createMutation.isPending ? (
            <Loader2 size={14} className={styles.spinning} />
          ) : (
            <Plus size={14} />
          )}
        </button>
      </div>

      {expanded && (
        conversations.length > 0 ? (
          conversations.map(convo => (
            <button
              key={convo.id}
              className={`${styles.featureItem} ${selectedConversation === convo.tmuxSession ? styles.featureItemSelected : ''}`}
              onClick={() => onSelectConversation(convo.tmuxSession, convo.name)}
            >
              <span className={styles.featureStatus}>
                {convo.status === 'running' ? (
                  <MessageSquare size={14} style={{ color: 'var(--mc-success)' }} />
                ) : (
                  <MessageSquare size={14} style={{ color: 'var(--mc-text-muted)' }} />
                )}
              </span>
              <span className={styles.featureLabel}>{convo.name}</span>
              <span className={styles.featureState}>{formatTime(convo.createdAt)}</span>
              {confirmDelete === convo.id ? (
                <>
                  <button
                    className={styles.deleteConfirmButton}
                    onClick={(e) => handleDelete(e, convo.id)}
                    title="Confirm delete"
                  >
                    <Trash2 size={12} />
                  </button>
                  <button
                    className={styles.deleteCancelButton}
                    onClick={handleCancelDelete}
                    title="Cancel"
                  >
                    <X size={12} />
                  </button>
                </>
              ) : (
                <button
                  className={styles.deleteButton}
                  onClick={(e) => handleDelete(e, convo.id)}
                  title="Delete conversation"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </button>
          ))
        ) : (
          <div className={styles.emptyProject}>No conversations yet</div>
        )
      )}
    </div>
  );
}
