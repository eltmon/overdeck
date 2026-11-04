import { memo, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ForkModal } from './ForkModal';
import { ConversationRow } from './ConversationRow';
import { HiddenMachinesFooter } from './LinkedConversationRow';
import { buildConversationTree, groupSummary, isConversationActive, type ConversationTreeNode } from './conversation-tree';
import { partitionConversationSections, SECTION_ORDER, snoozePresets, type ConversationSectionId } from './conversation-triage';
import { useConversationMutations, type ConversationMutations } from './useConversationMutations';
import { useDashboardStore } from '../../lib/store';
import { useNow } from '../../hooks/useNow';
import type { ContextUsage } from '../chat/chat-types';
import styles from './styles/command-deck.module.css';
import { fetchWithTimeout } from '../../lib/apiFetch';
import { fetchRegisteredProjects } from './UnknownProjectState';
import { MenuItemButton, MenuOverlay, MenuSurface } from '../shared/ContextMenu';
import type { LinkedConversationFields, PullRequestLink } from '@overdeck/contracts';

// ─── Types ────────────────────────────────────────────────────────────────────

/** PAN-4650 D-4650-3: the fields a linked row (owned by another machine) carries. */
type LinkedRowFields = Partial<Omit<LinkedConversationFields, 'origin'>> & {
  gitOrigin?: string | null;
  pullable?: boolean;
  /** When the saved copy of a linked row was last settled. */
  savedCopyAt?: string | null;
  /** Where the owner pulled this conversation from (finds a released copy's continuation). */
  pulledFrom?: { environmentId: string; nativeSessionId: string } | null;
};

export interface Conversation extends LinkedRowFields {
  id: number;
  name: string;
  tmuxSession: string;
  status: 'active' | 'ended';
  cwd: string;
  issueId: string | null;
  createdAt: string;
  endedAt: string | null;
  lastAttachedAt: string | null;
  /** Transcript mtime from the list enrichment. Null until a transcript exists. */
  lastActivityAt?: string | null;
  sessionAlive: boolean;
  /** PAN-4268: where Claude Code sends typed input, read from its agent selector. Absent when not checked. */
  inputTarget?: 'main' | { subagent: string } | 'unknown';
  isWorking?: boolean;
  /** Tool name currently executing (e.g. "Bash", "Read"). Null when idle or not in a tool call. */
  currentTool?: string | null;
  /** Transcript mtime when an ACP turn has remained open without activity for five minutes. */
  stalledSince?: string | null;
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
  /** Cached total cost in USD (cache-discount aware). */
  totalCost?: number;
  /** Cached total token throughput (input + output + cache read/write). */
  totalTokens?: number;
  /** Model used for this conversation. Null until backfilled from session file. */
  model?: string | null;
  /** Harness used to spawn this conversation. */
  harness?: 'claude-code' | 'pi' | 'ohmypi' | 'codex' | 'acp' | 'kimi-code' | 'opencode' | 'muse' | 'prime-agent' | null;
  /** Effort level used when spawning this conversation. */
  effort?: string | null;
  /** Async fork provisioning status. Null = not a fork or completed. */
  forkStatus?: string | null;
  /** Error message when forkStatus='failed'. */
  forkError?: string | null;
  /** Error message when background spawn failed (quota, auth, etc.). Null = spawned OK. */
  spawnError?: string | null;
  /** True when a Overdeck-native compaction is actively running for this conversation. */
  compacting?: boolean;
  /** Delivery method: auto (try channels, fallback tmux), channels (strict), tmux (always tmux). */
  deliveryMethod?: 'auto' | 'channels' | 'tmux' | 'supervisor' | null;
  contextUsage?: ContextUsage | null;
  /** Agent-authored handoff document path for handoff-fork targets. */
  handoffDocPath?: string | null;
  /** Target conversation id created from this source's handoff. */
  handoffTargetConvId?: number | null;
  /** Reason a requested handoff fork downgraded to summary mode. */
  forkFallbackReason?: string | null;
  /** PAN-1458: if this conv was cleared via Claude Code's /clear, the sibling conv that continues it. */
  clearedToConvId?: number | null;
  /** PAN-1523: current git branch at cwd, null when cwd is not a git repo. */
  branch?: string | null;
  /** PAN-1523: true when cwd is a secondary git worktree (not the primary checkout). */
  isWorktree?: boolean;
  /** PAN-3822: the effective linked pull request (explicit before branch-detected), from its stored snapshot. */
  pullRequest?: PullRequestLink | null;
  /** PAN-3822: number of live (non-dismissed) pull-request links. */
  pullRequestCount?: number;
  /** PAN-4657: the earliest nextRunAt among this conversation's enabled schedules, null if none. */
  nextScheduledRunAt?: string | null;
  /** PAN-4657: number of enabled schedules on this conversation. */
  scheduleCount?: number;
  /** PAN-4639: operator triage state. Null/absent = not settled / not snoozed. */
  settledAt?: string | null;
  settleReason?: 'manual' | 'merge' | 'idle' | null;
  snoozedUntil?: string | null;
  /** PAN-4653: per-conversation auto-settle-on-merge override. Absent = inherit. */
  autoSettleOverride?: 'on' | 'off' | 'inherit';
  /** PAN-1520 — unified pending-input surfaces (same shape as AgentSnapshot). */
  pendingInputCount?: number;
  pendingInputKinds?: ReadonlyArray<string>;
  pendingAskUserQuestion?: {
    toolUseId: string;
    askedAt: string;
    questions: ReadonlyArray<{
      question: string;
      header?: string;
      multiSelect?: boolean;
      options: ReadonlyArray<{ label: string; description?: string }>;
    }>;
  };
  /** True when this conversation had activity but its transcript file no longer
   *  exists on disk — its history was lost (e.g. 2026-07-05 conv-* dir cleanup). */
  transcriptMissing?: boolean;
  /** True when the live session is parked on a boot-blocking TUI screen (Claude
   *  first-run onboarding, trust dialog) that only the terminal can answer. */
  needsTerminal?: boolean;
  /** PAN-4223: legacy id of the launching (lane) or source (successor) conversation. Null = root. */
  parentConversationId?: number | null;
  parentConversationName?: string | null;
  /** PAN-4223: gauntlet lane facts; null unless the row is a lane. */
  gauntletRun?: string | null;
  laneKey?: string | null;
  laneRole?: 'builder' | 'critic' | 'verifier' | 'play' | 'orchestrator' | null;
  laneIteration?: number | null;
  laneReport?: { seq: number; at: string; status: 'done' | 'blocked' | 'failed'; verdict?: string | null } | null;
  /** PAN-4223 D26: legacy id of the builder row a critic or verifier lane judges. */
  criticOfConversationId?: number | null;
  /** Critic and verifier lanes: the verdict, or `pending` before a done report. */
  laneVerdict?: { value: string; defects: number | null } | null;
  /** Builder lanes: the newest critic verdict for this iteration. */
  laneLatestVerdict?: { value: string; defects: number | null; criticId: number | null; criticRoute: string } | null;
  /** PAN-1990: the projects/workspaces registry row this conversation belongs to. Null for pre-migration rows. */
  workspaceId?: string | null;
  /** PAN-1577: explicit project assignment override. Null = fall back to deriving the project from cwd. */
  projectKey?: string | null;
  /** PAN-4436: 'vault' = a read-only Session Vault browse copy owned by another machine; PAN-4650: 'linked' = a live row another machine owns. */
  origin?: 'local' | 'vault' | 'linked';
  /** PAN-4436: the owning machine's label for a browse copy. */
  vaultOwnerLabel?: string | null;
  /** PAN-4447: this row's native file moved to another machine, or saved a local P-6 fork of a record another machine now owns. Null for a vault browse row or when neither applies. */
  vaultContinuity?:
    | { kind: 'continued-elsewhere'; vaultId: string; ownerLabel: string }
    | { kind: 'forked-locally'; forkVaultId: string; parentVaultId: string; parentOwnerLabel: string }
    | null;
}

export type VaultContinuity = NonNullable<Conversation['vaultContinuity']>;

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

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetchWithTimeout('/api/conversations');
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
      return conv.lastActivityAt ?? conv.lastAttachedAt ?? conv.createdAt;
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
  /** When provided, show only conversations whose id is in this set (PAN-1561
   * project scope). Applied after `excludeIds`. */
  includeIds?: Set<number>;
}

// ─── Component ────────────────────────────────────────────────────────────────

/** Stable fallback so the memoized list items keep equal props before projects load. */
const EMPTY_PROJECTS: Awaited<ReturnType<typeof fetchRegisteredProjects>> = [];

/** PAN-4223 D18: localStorage key holding the top-level names the viewer collapsed. */
export const GROUPS_COLLAPSED_STORAGE_KEY = 'commandDeck.groups.collapsed';

function readCollapsedGroups(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(GROUPS_COLLAPSED_STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeCollapsedGroups(names: ReadonlySet<string>): void {
  try {
    localStorage.setItem(GROUPS_COLLAPSED_STORAGE_KEY, JSON.stringify([...names]));
  } catch {
    // Storage unavailable (private window, blocked site data): collapse still works for this view.
  }
}

// ─── Sections (PAN-4639 D6, D9, D10) ───────────────────────────────────────────

const SECTION_LABELS: Record<ConversationSectionId, string> = {
  needsYou: 'Needs you',
  inbox: 'Inbox',
  snoozed: 'Snoozed',
  settled: 'Settled',
};

/** D10: only Snoozed and Settled have a collapse toggle. */
const COLLAPSIBLE_SECTIONS: ReadonlySet<ConversationSectionId> = new Set(['snoozed', 'settled']);

/** D10: the names the viewer expanded, against the collapsed-by-default state of Snoozed/Settled. */
const SECTIONS_EXPANDED_STORAGE_KEY = 'commandDeck.sections.expanded';

function readExpandedSections(): Set<ConversationSectionId> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SECTIONS_EXPANDED_STORAGE_KEY) ?? '[]');
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is ConversationSectionId => id === 'snoozed' || id === 'settled')
        : [],
    );
  } catch {
    return new Set();
  }
}

function writeExpandedSections(ids: ReadonlySet<ConversationSectionId>): void {
  try {
    localStorage.setItem(SECTIONS_EXPANDED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage unavailable (private window, blocked site data): collapse still works for this view.
  }
}

// ─── List item (PAN-4560) ─────────────────────────────────────────────────────
//
// One top-level entry: the row, its group toggle and its nested rows.
// `buildConversationTree` rebuilds every node on each list poll, but the query
// cache keeps unchanged conversation objects identical. `itemPropsEqual`
// compares what the item renders (the conversations by reference, the tree
// markers and each row's selected state), so a poll in which one conversation
// changed re-renders only that conversation's item. It lives in this file
// because ConversationRow and useConversationMutations import from here, and a
// separate module would add import cycles.

type RegisteredProject = React.ComponentProps<typeof ConversationRow>['registeredProjects'];

interface ConversationListItemProps {
  node: ConversationTreeNode<Conversation>;
  /** PAN-4639: which section this top-level row renders in (D6). */
  section: ConversationSectionId;
  collapsed: boolean;
  selectedConversation: string | null;
  onSelectConversation: (name: string) => void;
  /** PAN-4639 D14: multi-select click handling for the top-level row. */
  onRowClick: (event: React.MouseEvent, name: string) => void;
  /** PAN-4639 D14: whether the top-level row is part of the current multi-selection. */
  isMultiSelected: boolean;
  onToggleGroup: (node: ConversationTreeNode<Conversation>) => void;
  mutations: ConversationMutations;
  registeredProjects: RegisteredProject;
}

/** The non-zero group counts, in the order the PRD fixes (WI-10 step 3). */
function groupSummaryText(node: ConversationTreeNode<Conversation>): string {
  const summary = groupSummary(node);
  const parts: string[] = [];
  if (summary.successors > 0) parts.push(`${summary.successors} ${summary.successors === 1 ? 'successor' : 'successors'}`);
  if (summary.lanes > 0) parts.push(`${summary.lanes} ${summary.lanes === 1 ? 'lane' : 'lanes'}`);
  if (summary.working > 0) parts.push(`${summary.working} working`);
  if (summary.needsYou > 0) parts.push(`${summary.needsYou} needs you`);
  if (summary.reported > 0) parts.push(`${summary.reported} reported`);
  return parts.join(' · ');
}

function ConversationListItemImpl({
  node,
  section,
  collapsed,
  selectedConversation,
  onSelectConversation,
  onRowClick,
  isMultiSelected,
  onToggleGroup,
  mutations,
  registeredProjects,
}: ConversationListItemProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      data-section={section}
    >
      <ConversationRow
        conv={node.conv}
        isSelected={selectedConversation === node.conv.name}
        onSelect={onSelectConversation}
        onRowClick={onRowClick}
        isMultiSelected={isMultiSelected}
        mutations={mutations}
        registeredProjects={registeredProjects}
        orphanOf={node.orphanOf}
      />
      {node.descendants.length > 0 && (
        <button
          type="button"
          className={styles.convGroupToggle}
          aria-expanded={!collapsed}
          onClick={() => onToggleGroup(node)}
        >
          {`${collapsed ? '▸' : '▾'} ${groupSummaryText(node)}`}
        </button>
      )}
      {!collapsed && node.descendants.map((child) => (
        <div
          key={child.conv.id}
          className={child.depth === 2 ? styles.convTreeDepth2 : styles.convTreeDepth1}
        >
          <ConversationRow
            conv={child.conv}
            variant="nested"
            isSelected={selectedConversation === child.conv.name}
            onSelect={onSelectConversation}
            mutations={mutations}
            registeredProjects={registeredProjects}
            flattenedFrom={child.flattenedFrom}
            criticOf={child.criticOf}
          />
        </div>
      ))}
    </motion.div>
  );
}

function itemPropsEqual(a: ConversationListItemProps, b: ConversationListItemProps): boolean {
  if (a.node.conv !== b.node.conv || a.node.orphanOf !== b.node.orphanOf) return false;
  if (a.section !== b.section) return false;
  if (a.collapsed !== b.collapsed) return false;
  if (a.isMultiSelected !== b.isMultiSelected) return false;
  if ((a.selectedConversation === a.node.conv.name) !== (b.selectedConversation === b.node.conv.name)) return false;
  if (a.node.descendants.length !== b.node.descendants.length) return false;
  for (let i = 0; i < a.node.descendants.length; i += 1) {
    const prev = a.node.descendants[i]!;
    const next = b.node.descendants[i]!;
    if (prev.conv !== next.conv || prev.depth !== next.depth) return false;
    if (prev.flattenedFrom !== next.flattenedFrom || prev.criticOf !== next.criticOf) return false;
    if ((a.selectedConversation === prev.conv.name) !== (b.selectedConversation === next.conv.name)) return false;
  }
  return (
    Object.is(a.onSelectConversation, b.onSelectConversation)
    && Object.is(a.onRowClick, b.onRowClick)
    && Object.is(a.onToggleGroup, b.onToggleGroup)
    && Object.is(a.mutations, b.mutations)
    && Object.is(a.registeredProjects, b.registeredProjects)
  );
}

const ConversationListItem = memo(ConversationListItemImpl, itemPropsEqual);

export function ConversationList({ selectedConversation, onSelectConversation, excludeIds, includeIds }: ConversationListProps) {
  const [sort, setSort] = useState<SortOption>(loadSort);
  const [tab, setTab] = useState<ListTab>(loadTab);

  const mutations = useConversationMutations(selectedConversation, onSelectConversation);
  const queryClient = useQueryClient();

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      const pendingFork = data.some((c: Conversation) => c.forkStatus && c.forkStatus !== 'failed');
      const pendingSpawn = data.some((c: Conversation) => !c.sessionAlive && !c.endedAt && !c.spawnError);
      return (pendingFork || pendingSpawn) ? 2000 : 10000;
    },
  });

  // Registered projects for each row's Move submenu (PAN-1577) — one shared
  // query for the whole list, same key the Sidebar/CommandDeck use.
  const { data: registeredProjects = EMPTY_PROJECTS } = useQuery({
    queryKey: ['registered-projects'],
    queryFn: fetchRegisteredProjects,
    staleTime: 60000,
  });

  // Refresh the list the instant a conversation is created (server emits a
  // `conversation.created` domain event that bumps this revision), instead of
  // waiting up to 10s for the next poll tick.
  const conversationsListRevision = useDashboardStore((s) => s.conversationsListRevision);
  useEffect(() => {
    if (conversationsListRevision > 0) {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    }
  }, [conversationsListRevision, queryClient]);

  const handleSortChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value as SortOption;
    setSort(v);
    try { localStorage.setItem(SORT_STORAGE_KEY, v); } catch { /* ignore */ }
  }, []);

  const handleTabChange = useCallback((t: ListTab) => {
    setTab(t);
    try { localStorage.setItem(TAB_STORAGE_KEY, t); } catch { /* ignore */ }
  }, []);

  // PAN-4639 D5: snooze wake is decided client-side on every render; no
  // timer, no server job, no write.
  const now = useNow(30_000);

  // ── Sorted, grouped, sectioned list ──────────────────────────────────────────
  const sections = useMemo(() => {
    let filtered = conversations;

    if (excludeIds && excludeIds.size > 0) {
      filtered = filtered.filter((c) => !excludeIds.has(c.id));
    }

    if (includeIds) {
      filtered = filtered.filter((c) => includeIds.has(c.id));
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

    const tree = buildConversationTree([...active, ...inactive]);
    return partitionConversationSections(tree, now.getTime());
  }, [conversations, sort, tab, excludeIds, includeIds, now]);

  // PAN-4223 D18: per-viewer group collapse. Persisted: names the viewer
  // collapsed. Session-only: names the viewer expanded against the default.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(readCollapsedGroups);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const isGroupCollapsed = useCallback((node: ConversationTreeNode<Conversation>) => {
    if (collapsedGroups.has(node.conv.name)) return true;
    if (expandedGroups.has(node.conv.name)) return false;
    return !node.descendants.some((child) => isConversationActive(child.conv));
  }, [collapsedGroups, expandedGroups]);
  const toggleGroup = useCallback((node: ConversationTreeNode<Conversation>) => {
    const name = node.conv.name;
    const collapse = !isGroupCollapsed(node);
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (collapse) next.add(name);
      else next.delete(name);
      writeCollapsedGroups(next);
      return next;
    });
    setExpandedGroups((previous) => {
      const next = new Set(previous);
      if (collapse) next.delete(name);
      else next.add(name);
      return next;
    });
  }, [isGroupCollapsed]);

  // PAN-4639 D10: Snoozed and Settled are collapsed by default; expansion is
  // persisted per viewer.
  const [expandedSections, setExpandedSections] = useState<Set<ConversationSectionId>>(readExpandedSections);
  const toggleSection = useCallback((id: ConversationSectionId) => {
    setExpandedSections((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeExpandedSections(next);
      return next;
    });
  }, []);

  // PAN-4639 WI-9 (D11): Cmd/Ctrl+Z undoes the last triage change while the
  // list has focus, unless the user is typing (rename input, etc.).
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const isEditable = !!target.closest('input, textarea, select, [contenteditable="true"]');
    if (e.key === 'Escape') {
      setSelected((previous) => (previous.size > 0 ? new Set() : previous));
      anchorRef.current = null;
      return;
    }
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
    if (isEditable) return;
    if (mutations.undoLastTriage()) e.preventDefault();
  }, [mutations]);

  // PAN-4639 WI-10 (D14): Cmd/Ctrl-click toggles one row and sets the anchor;
  // Shift-click ranges from the anchor over the visible top-level rows in
  // render order (collapsed sections excluded); a plain click clears the
  // selection and opens the row. `anchor` lives in a ref, not state, because
  // it never renders — keeping it out of state keeps handleRowClick's
  // identity stable across unrelated polls (NFR-4).
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);
  const visibleTopLevelNamesRef = useRef<string[]>([]);
  const [bulkSnoozeOpen, setBulkSnoozeOpen] = useState(false);

  const handleRowClick = useCallback((e: React.MouseEvent, name: string) => {
    const names = visibleTopLevelNamesRef.current;
    if (e.shiftKey && anchorRef.current !== null) {
      const anchorIndex = names.indexOf(anchorRef.current);
      const clickedIndex = names.indexOf(name);
      if (anchorIndex !== -1 && clickedIndex !== -1) {
        const [start, end] = anchorIndex <= clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex];
        const range = names.slice(start, end + 1);
        setSelected((previous) => new Set([...previous, ...range]));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
      anchorRef.current = name;
      return;
    }
    setSelected(new Set());
    anchorRef.current = null;
    onSelectConversation(name);
  }, [onSelectConversation]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  const bulkLabel = useCallback((verb: string, count: number) => `${verb} ${count} conversation${count === 1 ? '' : 's'}`, []);

  const bulkSettle = useCallback(() => {
    const names = [...selected];
    if (names.length === 0) return;
    mutations.triage({ updates: names.map((name) => ({ name, settled: true })), label: bulkLabel('Settled', names.length) });
    clearSelection();
  }, [selected, mutations, bulkLabel, clearSelection]);

  const bulkUnsettle = useCallback(() => {
    const names = [...selected];
    if (names.length === 0) return;
    mutations.triage({ updates: names.map((name) => ({ name, settled: false })), label: `Moved ${names.length} conversation${names.length === 1 ? '' : 's'} to Inbox` });
    clearSelection();
  }, [selected, mutations, clearSelection]);

  const bulkSnooze = useCallback((until: Date) => {
    const names = [...selected];
    if (names.length === 0) return;
    mutations.triage({ updates: names.map((name) => ({ name, snoozedUntil: until.toISOString() })), label: bulkLabel('Snoozed', names.length) });
    setBulkSnoozeOpen(false);
    clearSelection();
  }, [selected, mutations, bulkLabel, clearSelection]);

  if (isLoading) {
    return (
      <div className={styles.skeletonList}>
        <div className={styles.skeletonItem} />
        <div className={styles.skeletonItem} />
      </div>
    );
  }

  const favCount = conversations.filter((c) => c.isFavorited).length;

  const sectionsById = new Map(sections.map((section) => [section.id, section]));
  const needsYouCount = sectionsById.get('needsYou')?.nodes.length ?? 0;
  const inboxCount = sectionsById.get('inbox')?.nodes.length ?? 0;
  const snoozedCount = sectionsById.get('snoozed')?.nodes.length ?? 0;
  const settledCount = sectionsById.get('settled')?.nodes.length ?? 0;
  const totalCount = needsYouCount + inboxCount + snoozedCount + settledCount;
  // D10: Needs you and Inbox both quiet, but something is parked — say so instead
  // of the generic "No conversations yet" message, which would be misleading.
  const showInboxClear = needsYouCount === 0 && inboxCount === 0 && (snoozedCount > 0 || settledCount > 0);

  // D14: the visible top-level rows in render order, collapsed sections
  // excluded — Shift-click ranges over exactly this list.
  visibleTopLevelNamesRef.current = SECTION_ORDER.flatMap((id) => {
    if (COLLAPSIBLE_SECTIONS.has(id) && !expandedSections.has(id)) return [];
    return (sectionsById.get(id)?.nodes ?? []).map((node) => node.conv.name);
  });

  return (
    <div className={styles.conversationListWrapper} onKeyDown={handleKeyDown}>
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

      {/* Bulk bar (PAN-4639 D15) */}
      {selected.size > 0 && (
        <div role="toolbar" aria-label="Selected conversations" className={styles.convBulkBar}>
          <span>{selected.size} selected</span>
          <button type="button" onClick={bulkSettle}>Settle</button>
          <button type="button" onClick={bulkUnsettle}>Unsettle</button>
          <span style={{ position: 'relative', display: 'inline-block' }}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={bulkSnoozeOpen}
              onClick={() => setBulkSnoozeOpen((open) => !open)}
            >
              Snooze
            </button>
            {bulkSnoozeOpen && (
              <>
                <MenuOverlay onClick={() => setBulkSnoozeOpen(false)} />
                <MenuSurface
                  aria-label="Snooze selected conversations"
                  onClose={() => setBulkSnoozeOpen(false)}
                  className="absolute left-0 top-full z-[1001] mt-1 min-w-[160px]"
                >
                  {snoozePresets(new Date()).map((preset) => (
                    <MenuItemButton key={preset.id} onClick={() => bulkSnooze(preset.until)}>
                      {preset.label}
                    </MenuItemButton>
                  ))}
                </MenuSurface>
              </>
            )}
          </span>
          <button type="button" onClick={clearSelection}>Clear</button>
        </div>
      )}

      {/* List */}
      {totalCount === 0 ? (
        <div className={styles.conversationEmpty}>
          {tab === 'favorites'
            ? 'No favorites yet — hover a conversation and click ★ to star it.'
            : 'No conversations yet'}
        </div>
      ) : (
        <div className={styles.conversationList}>
          <AnimatePresence initial={false}>
            {SECTION_ORDER.flatMap((id) => {
              const nodes = sectionsById.get(id)?.nodes ?? [];
              const rendered: React.ReactNode[] = [];

              if (id === 'needsYou' && nodes.length > 0) {
                rendered.push(
                  <div
                    key="section-header-needsYou"
                    className={`${styles.convSectionHeader} text-state-needs-you`}
                    role="heading"
                    aria-level={3}
                    data-section="needsYou"
                  >
                    {SECTION_LABELS.needsYou}
                    <span className={styles.convSectionCount}> · {nodes.length}</span>
                  </div>,
                );
              }

              if (id === 'inbox' && showInboxClear) {
                rendered.push(
                  <div key="section-inbox-clear" className={styles.conversationEmpty} data-section="inbox">
                    Inbox clear
                  </div>,
                );
              }

              if (COLLAPSIBLE_SECTIONS.has(id) && nodes.length > 0) {
                const expanded = expandedSections.has(id);
                rendered.push(
                  <button
                    key={`section-header-${id}`}
                    type="button"
                    className={styles.convSectionHeader}
                    aria-expanded={expanded}
                    data-section={id}
                    onClick={() => toggleSection(id)}
                  >
                    {`${expanded ? '▾' : '▸'} ${SECTION_LABELS[id]}`}
                    <span className={styles.convSectionCount}> · {nodes.length}</span>
                  </button>,
                );
                if (!expanded) return rendered;
              }

              for (const node of nodes) {
                rendered.push(
                  <ConversationListItem
                    key={node.conv.id}
                    node={node}
                    section={id}
                    collapsed={node.descendants.length > 0 && isGroupCollapsed(node)}
                    selectedConversation={selectedConversation}
                    onSelectConversation={onSelectConversation}
                    onRowClick={handleRowClick}
                    isMultiSelected={selected.has(node.conv.name)}
                    onToggleGroup={toggleGroup}
                    mutations={mutations}
                    registeredProjects={registeredProjects}
                  />,
                );
              }
              return rendered;
            })}
          </AnimatePresence>
        </div>
      )}
      <HiddenMachinesFooter />

      {mutations.forkTarget && (
        <ForkModal
          conversation={mutations.forkTarget}
          initialMode={mutations.forkTargetMode}
          initialFocus={mutations.forkTargetFocus}
          isPending={mutations.isForkPending}
          onClose={mutations.closeForkModal}
          onConfirm={(conv, launchModel, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, title, launchHarness, summaryHarness, focus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness, projectKey, handoffExtras) => {
            mutations.submitFork(conv, launchModel, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, title, launchHarness, summaryHarness, focus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness, projectKey, handoffExtras);
          }}
        />
      )}
    </div>
  );
}
