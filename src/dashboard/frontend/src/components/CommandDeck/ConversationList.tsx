import { useState, useCallback, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Circle, Archive, Copy, Check, X, Pencil, Star, Loader2, Terminal, FileCode, Search, Globe, Wrench, Zap, GitBranchPlus, AlertCircle } from 'lucide-react';
import { ForkModal } from './ForkModal';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { useNow } from '../../hooks/useNow';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { toolNameToPhase, getPhaseLabel, isSpinnerPhase } from '../../lib/workingPhase';
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
}

/** Marker that we're in draft mode — no session spawned yet. */
export type DraftSession = true;

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

async function archiveConversation(name: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/archive`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to archive conversation');
}

async function stopConversation(name: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/stop`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to stop conversation');
}

export async function updateConversationTitle(name: string, title: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error('Failed to update conversation title');
}

async function favoriteConversation(name: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/favorite`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to favorite conversation');
}

async function unfavoriteConversation(name: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/favorite`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to unfavorite conversation');
}

async function summaryForkConversation(opts: { conv: Conversation; model: string; summaryModel: string; plain?: boolean; localSummaryOnly?: boolean; includeThinkingInSummary?: boolean }): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(opts.conv.name)}/summary-fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      summaryModel: opts.summaryModel,
      plain: opts.plain,
      localSummaryOnly: opts.localSummaryOnly,
      includeThinkingInSummary: opts.includeThinkingInSummary,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || 'Failed to create summary fork');
  }
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
    // Descending for dates (newest first), empty string sorts to end
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
}

// ─── WorkingSpinner ───────────────────────────────────────────────────────────

const PHASE_ICONS = {
  init:       Zap,
  thinking:   Loader2,
  bash:       Terminal,
  file:       FileCode,
  search:     Search,
  web:        Globe,
  agent:      Loader2,
  tool:       Wrench,
  processing: Loader2,
} as const;

function WorkingSpinner({
  size,
  currentTool,
  'aria-label': ariaLabel,
}: {
  size: number;
  currentTool: string | null;
  'aria-label'?: string;
}) {
  const phase = currentTool ? toolNameToPhase(currentTool) : 'thinking';
  const Icon = PHASE_ICONS[phase];
  const label = getPhaseLabel(phase);
  const iconClass = isSpinnerPhase(phase)
    ? styles.conversationWorkingSpinner
    : styles.conversationWorkingPulse;
  return (
    <span title={label} style={{ display: 'contents' }}>
      <Icon
        size={size}
        className={iconClass}
        aria-label={ariaLabel ?? label}
      />
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationList({ selectedConversation, onSelectConversation }: ConversationListProps) {
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const draftTitleRef = useRef('');
  const committingRef = useRef(false);
  const [sort, setSort] = useState<SortOption>(loadSort);
  const [tab, setTab] = useState<ListTab>(loadTab);
  const [forkTarget, setForkTarget] = useState<Conversation | null>(null);
  const queryClient = useQueryClient();
  const now = useNow(60_000);

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      const pending = data.some((c: Conversation) => c.forkStatus && c.forkStatus !== 'failed');
      return pending ? 2000 : 10000;
    },
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

  const renameMutation = useMutation({
    mutationFn: ({ name, title }: { name: string; title: string }) => updateConversationTitle(name, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: ({ name, favorited }: { name: string; favorited: boolean }) =>
      favorited ? unfavoriteConversation(name) : favoriteConversation(name),
    onMutate: async ({ name, favorited }) => {
      await queryClient.cancelQueries({ queryKey: ['conversations'] });
      const prev = queryClient.getQueryData<Conversation[]>(['conversations']);
      queryClient.setQueryData<Conversation[]>(['conversations'], (old) =>
        old?.map((c) => (c.name === name ? { ...c, isFavorited: !favorited } : c)) ?? [],
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['conversations'], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const summaryForkMutation = useMutation({
    mutationFn: summaryForkConversation,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      const msg = variables.plain
        ? 'Plain fork started — copying conversation history...'
        : 'Fork started — summarizing conversation...';
      toast.success(msg, { duration: 4000 });
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 8000 });
      console.error('Summary fork failed:', err);
    },
  });

  const startEditing = useCallback((conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    committingRef.current = false;
    const initial = conv.title ?? conv.name;
    draftTitleRef.current = initial;
    setEditingName(conv.name);
    setDraftTitle(initial);
    setTimeout(() => {
      editInputRef.current?.select();
    }, 0);
  }, []);

  const commitRename = useCallback((name: string, originalTitle: string) => {
    if (committingRef.current) return;
    committingRef.current = true;
    const trimmed = draftTitleRef.current.trim();
    setEditingName(null);
    if (trimmed && trimmed !== originalTitle) {
      renameMutation.mutate({ name, title: trimmed });
    }
  }, [renameMutation]);

  const cancelEditing = useCallback(() => {
    setEditingName(null);
    setDraftTitle('');
  }, []);


  const handleCopyLink = useCallback((convId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/conv/${convId}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedId(convId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

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

    // Favorites tab filter
    if (tab === 'favorites') {
      filtered = filtered.filter((c) => c.isFavorited);
    }

    // Sort within each group — forking conversations count as active
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
  }, [conversations, sort, tab]);

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
              <motion.button
                key={conv.id}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
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
                {conv.forkStatus && conv.forkStatus !== 'failed' ? (
                  <Loader2
                    size={12}
                    className={styles.conversationWorkingSpinner}
                    style={{ color: 'var(--mc-warning)' }}
                    aria-label={`Forking ${conv.name}`}
                  />
                ) : conv.isWorking ? (
                  <WorkingSpinner
                    size={12}
                    currentTool={conv.currentTool ?? null}
                    aria-label={`Agent working in ${conv.name}`}
                  />
                ) : (
                  <Circle
                    size={7}
                    className={styles.conversationDot}
                    style={{
                      fill: conv.sessionAlive ? 'var(--mc-success)' : 'var(--mc-text-muted)',
                      color: conv.sessionAlive ? 'var(--mc-success)' : 'var(--mc-text-muted)',
                    }}
                  />
                )}
                {editingName === conv.name ? (
                  <input
                    ref={editInputRef}
                    className={styles.conversationNameInput}
                    value={draftTitle}
                    onChange={e => { setDraftTitle(e.target.value); draftTitleRef.current = e.target.value; }}
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => {
                      e.stopPropagation();
                      if (e.key === 'Enter') commitRename(conv.name, conv.title ?? conv.name);
                      if (e.key === 'Escape') cancelEditing();
                    }}
                    onBlur={() => commitRename(conv.name, conv.title ?? conv.name)}
                    aria-label={`Rename ${conv.name}`}
                  />
                ) : (
                  <span className={styles.conversationName}>{conv.title ?? conv.name}</span>
                )}
                {conv.forkStatus && conv.forkStatus !== 'failed' && (
                  <span className={styles.conversationForkStatus} title={`Fork: ${conv.forkStatus}`}>
                    <Loader2 size={10} className={styles.conversationWorkingSpinner} />
                    <span>{conv.forkStatus === 'summarizing' ? 'Summarizing...' : conv.forkStatus === 'spawning' ? 'Spawning...' : 'Injecting...'}</span>
                  </span>
                )}
                {conv.forkStatus === 'failed' && (
                  <span className={styles.conversationForkFailed} title={conv.forkError || 'Fork failed'}>
                    <AlertCircle size={10} />
                    <span>Failed</span>
                  </span>
                )}
                {conv.lastAttachedAt && (
                  <time
                    className={styles.conversationTime}
                    dateTime={conv.lastAttachedAt}
                    title={new Date(conv.lastAttachedAt).toLocaleString()}
                    aria-label={`Last accessed ${formatRelativeTime(conv.lastAttachedAt, now)}`}
                  >
                    {formatRelativeTime(conv.lastAttachedAt, now)}
                  </time>
                )}
                {conv.totalCost !== undefined && conv.totalCost > 0 && (
                  <span className={styles.featureCost}>
                    {conv.totalCost < 0.01 ? '<$0.01' : `$${conv.totalCost.toFixed(2)}`}
                  </span>
                )}
                {/* Persistent favorited star — visible in both hover and non-hover states */}
                {conv.isFavorited && (
                  <span
                    role="button"
                    tabIndex={0}
                    className={styles.conversationStarPersistent}
                    onClick={e => {
                      e.stopPropagation();
                      favoriteMutation.mutate({ name: conv.name, favorited: true });
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ' || e.key === 'f') {
                        e.stopPropagation();
                        favoriteMutation.mutate({ name: conv.name, favorited: true });
                      }
                    }}
                    title="Remove from favorites"
                    aria-label={`Unfavorite ${conv.title ?? conv.name}`}
                    aria-pressed={true}
                  >
                    <Star size={11} style={{ fill: 'currentColor' }} />
                  </span>
                )}
                {/* Hover-only action group — collapses when row is not hovered */}
                <span className={styles.conversationActions}>
                  {/* Rename button */}
                  <span
                    role="button"
                    tabIndex={0}
                    className={styles.conversationEditBtn}
                    onClick={e => startEditing(conv, e)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') startEditing(conv, e as unknown as React.MouseEvent); }}
                    title="Rename conversation"
                    aria-label={`Rename ${conv.name}`}
                  >
                    <Pencil size={11} />
                  </span>
                  {/* Star / favorite button (only when NOT favorited; favorited state shown by persistent star above) */}
                  {!conv.isFavorited && (
                    <span
                      role="button"
                      tabIndex={0}
                      className={styles.conversationStarBtn}
                      onClick={e => {
                        e.stopPropagation();
                        favoriteMutation.mutate({ name: conv.name, favorited: false });
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ' || e.key === 'f') {
                          e.stopPropagation();
                          favoriteMutation.mutate({ name: conv.name, favorited: false });
                        }
                      }}
                      title="Add to favorites"
                      aria-label={`Favorite ${conv.title ?? conv.name}`}
                      aria-pressed={false}
                    >
                      <Star size={11} style={{ fill: 'none' }} />
                    </span>
                  )}
                  {(conv.sessionFile || conv.claudeSessionId) && !conv.forkStatus && (
                    <span
                      role="button"
                      tabIndex={0}
                      className={styles.conversationSummaryForkBtn}
                      onClick={e => {
                        e.stopPropagation();
                        if (!summaryForkMutation.isPending) {
                          setForkTarget(conv);
                        }
                      }}
                      onKeyDown={e => {
                        if ((e.key === 'Enter' || e.key === ' ') && !summaryForkMutation.isPending) {
                          e.stopPropagation();
                          setForkTarget(conv);
                        }
                      }}
                      title="Create summary fork"
                      aria-label={`Create summary fork of ${conv.title ?? conv.name}`}
                    >
                      <GitBranchPlus size={11} />
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
                </span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}

      {forkTarget && (
        <ForkModal
          conversation={forkTarget}
          isPending={summaryForkMutation.isPending}
          onClose={() => setForkTarget(null)}
          onConfirm={(conv, launchModel, summaryModel, plainFork, localSummaryOnly, includeThinkingInSummary) => {
            summaryForkMutation.mutate({
              conv,
              model: launchModel,
              summaryModel,
              plain: plainFork,
              localSummaryOnly,
              includeThinkingInSummary,
            });
            setForkTarget(null);
          }}
        />
      )}
    </div>
  );
}
