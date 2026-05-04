import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ForkModal } from './ForkModal';
import { ConversationRow } from './ConversationRow';
import { useConversationMutations } from './useConversationMutations';
import styles from './styles/command-deck.module.css';

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
  isWorking?: boolean;
  /** Tool name currently executing (e.g. "Bash", "Read"). Null when idle or not in a tool call. */
  currentTool?: string | null;
  isFavorited?: boolean;
  /** Absolute path to the Claude Code JSONL session file. Null until discovered. Legacy fallback. */
  sessionFile?: string | null;
  /** Claude Code session UUID. Immutable for the lifetime of the conversation. */
  claudeSessionId?: string | null;
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
  /** Async fork provisioning status. Null = not a fork or completed. */
  forkStatus?: string | null;
  /** Error message when forkStatus='failed'. */
  forkError?: string | null;
  /** True when a Panopticon-native compaction is actively running for this conversation. */
  compacting?: boolean;
}

// ─── Sort types ───────────────────────────────────────────────────────────────

export type SortOption = 'lastActivity' | 'lastAccessed' | 'created' | 'alphabetical';
type ListTab = 'all' | 'favorites';

const SORT_LABELS: Record<SortOption, string> = {
  lastActivity: 'Last activity',
  lastAccessed: 'Last accessed',
  created: 'Created',
  alphabetical: 'Alphabetical',
};

const SORT_STORAGE_KEY = 'mc-conv-sort';
const TAB_STORAGE_KEY = 'mc-conv-tab';

function loadSort(): SortOption {
  try {
    const v = localStorage.getItem(SORT_STORAGE_KEY);
    if (v === 'lastActivity' || v === 'lastAccessed' || v === 'created' || v === 'alphabetical') {
      return v;
    }
  } catch {
    // ignore
  }
  return 'lastActivity';
}

function loadTab(): ListTab {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY);
    if (v === 'favorites') return 'favorites';
  } catch {
    // ignore
  }
  return 'all';
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch('/api/conversations');
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

export async function updateConversationTitle(name: string, title: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error('Failed to update conversation title');
}

// ─── Sorting helpers ──────────────────────────────────────────────────────────

export function getSortKey(conv: Conversation, sort: SortOption): string | number {
  switch (sort) {
    case 'lastActivity':
      return conv.lastAttachedAt ?? conv.createdAt;
    case 'lastAccessed':
      return conv.lastAttachedAt ?? '';
    case 'created':
      return conv.createdAt;
    case 'alphabetical':
      return (conv.title ?? conv.name).toLowerCase();
  }
}

export function sortConversations(convs: Conversation[], sort: SortOption): Conversation[] {
  return [...convs].sort((a, b) => {
    const ka = getSortKey(a, sort);
    const kb = getSortKey(b, sort);
    if (sort === 'alphabetical') {
      return (ka as string).localeCompare(kb as string);
    }
    if (!ka && !kb) return 0;
    if (!ka) return 1;
    if (!kb) return -1;
    return (kb as string).localeCompare(ka as string);
  });
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ConversationListProps {
  selectedConversation: string | null;
  onSelectConversation: (name: string | null) => void;
  excludeIds?: Set<number>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationList({ selectedConversation, onSelectConversation, excludeIds }: ConversationListProps) {
  const [sort, setSort] = useState<SortOption>(loadSort);
  const [tab, setTab] = useState<ListTab>(loadTab);

  const mutations = useConversationMutations(selectedConversation, onSelectConversation);

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      const pending = data.some((c: Conversation) => c.forkStatus && c.forkStatus !== 'failed');
      return pending ? 2000 : 10000;
    },
  });

  const handleSortChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value as SortOption;
    setSort(v);
    try { localStorage.setItem(SORT_STORAGE_KEY, v); } catch { /* ignore */ }
  }, []);

  const handleTabChange = useCallback((t: ListTab) => {
    setTab(t);
    try { localStorage.setItem(TAB_STORAGE_KEY, t); } catch { /* ignore */ }
  }, []);

  // ── Sorted + grouped list ────────────────────────────────────────────────────
  const displayConversations = useMemo(() => {
    let filtered = conversations;

    if (excludeIds && excludeIds.size > 0) {
      filtered = filtered.filter((c) => !excludeIds.has(c.id));
    }

    if (tab === 'favorites') {
      filtered = filtered.filter((c) => c.isFavorited);
    }

    const isActive = (c: Conversation) => c.sessionAlive || (c.forkStatus && c.forkStatus !== 'failed');
    const active = sortConversations(
      filtered.filter((c) => isActive(c)),
      sort,
    );
    const inactive = sortConversations(
      filtered.filter((c) => !isActive(c)),
      sort,
    );

    return [...active, ...inactive];
  }, [conversations, sort, tab, excludeIds]);

  if (isLoading) {
    return (
      <div className={styles.skeletonList}>
        <div className={styles.skeletonItem} />
        <div className={styles.skeletonItem} />
      </div>
    );
  }

  const favCount = conversations.filter((c) => c.isFavorited).length;

  return (
    <div className={styles.conversationListWrapper}>
      {/* Controls bar: All/Favorites tabs + sort */}
      <div className={styles.conversationControls}>
        <div className={styles.convTabBar}>
          <button
            className={`${styles.convTab} ${tab === 'all' ? styles.convTabActive : ''}`}
            onClick={() => handleTabChange('all')}
          >
            All
          </button>
          <button
            className={`${styles.convTab} ${tab === 'favorites' ? styles.convTabActive : ''}`}
            onClick={() => handleTabChange('favorites')}
          >
            Favorites
            {favCount > 0 && <span className={styles.convTabCount}>{favCount}</span>}
          </button>
        </div>
        <select
          className={styles.convSortSelect}
          value={sort}
          onChange={handleSortChange}
          aria-label="Sort conversations"
          title="Sort conversations"
        >
          {(Object.keys(SORT_LABELS) as SortOption[]).map((opt) => (
            <option key={opt} value={opt}>{SORT_LABELS[opt]}</option>
          ))}
        </select>
      </div>

      {/* List */}
      {displayConversations.length === 0 ? (
        <div className={styles.conversationEmpty}>
          {tab === 'favorites'
            ? 'No favorites yet — hover a conversation and click ★ to star it.'
            : 'No conversations yet'}
        </div>
      ) : (
        <div className={styles.conversationList}>
          <AnimatePresence initial={false}>
            {displayConversations.map((conv) => (
              <motion.div
                key={conv.id}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                <ConversationRow
                  conv={conv}
                  isSelected={selectedConversation === conv.name}
                  onSelect={(name) => onSelectConversation(name)}
                  mutations={mutations}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {mutations.forkTarget && (
        <ForkModal
          conversation={mutations.forkTarget}
          isPending={mutations.isForkPending}
          onClose={mutations.closeForkModal}
          onConfirm={(conv, launchModel, summaryModel, plainFork, localSummaryOnly, includeThinkingInSummary, title) => {
            mutations.submitFork(conv, launchModel, summaryModel, plainFork, localSummaryOnly, includeThinkingInSummary, title);
          }}
        />
      )}
    </div>
  );
}
