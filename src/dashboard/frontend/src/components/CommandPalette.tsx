/**
 * Cmd+K command palette for Overdeck.
 *
 * Opens on Cmd+K (macOS) / Ctrl+K (Linux/Windows).
 * Also opened from the desktop app via overdeckBridge.onMenuAction.
 *
 * Sections (in display order):
 *   - Actions / Orchestration / Navigation  — built-in dashboard actions
 *   - Commands                              — curated `pan <verb>` catalog (click to copy)
 *   - Active Workspaces / Issues / Running Agents
 *   - Conversations                         — semantic search with a newest-first toggle persisted at `overdeck.ui.paletteConversationsNewestFirst`
 *   - Memory / Observations                 — FTS over ~/.overdeck/memory
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Command } from 'cmdk';
import { toast } from 'sonner';
import {
  Play,
  Square,
  AlertTriangle,
  Settings,
  Terminal,
  FileText,
  FolderOpen,
  User,
  Zap,
  Bot,
  RefreshCw,
  ChevronRight,
  Brain,
  Sparkles,
  Eye,
  Loader2,
  MessageCircle,
  Clock,
} from 'lucide-react';
import { rememberRunSession } from './workspace/WorkspaceActionBand';
import { isAgentRunningStatus } from '../lib/pipeline-state';
import { useDashboardStore, selectAgents, selectIssues } from '../lib/store';
import {
  isUserFacingWorkspace,
  sortWorkspaces,
  WORKSPACES_PIPELINE_EXPANDED_KEY,
  type WorkspaceRegistryRow,
} from './Sidebar';
import type { Issue, Agent } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaletteAction {
  id: string;
  label: string;
  description?: string;
  icon: React.ElementType;
  group: string;
  keywords?: string[];
  onSelect: () => void;
  destructive?: boolean;
  // Optional rich excerpt rendering (memory/observation results).
  excerptSegments?: ExcerptSegment[];
  // Optional structured metadata chips (rendered instead of `description`).
  meta?: Array<{ icon?: React.ElementType; text: string; pill?: boolean }>;
  // Sort hint within group: lower = earlier.
  rank?: number;
  sortTs?: string | null;
  /**
   * Run the action without closing the palette. For in-palette affordances that
   * change what is listed rather than navigating away — e.g. expanding the
   * pipeline-worktrees row (PAN-3286 FR-13).
   */
  keepOpen?: boolean;
  /**
   * Scope chips this action appears under in addition to the one its `group`
   * implies. "New workspace…" belongs in Actions but is also what an operator
   * filtered to Workspaces is looking for (PAN-3330 FR-6b); listing it twice
   * in All would read as a duplicate, so it stays one row that answers to two
   * chips.
   */
  alsoScopes?: Array<Exclude<PaletteScope, 'all'>>;
}

export interface ConversationPaletteOpenRequest {
  sessionId: string;
  conversationId: string;
  projectId: string;
  /** Resolved dashboard project key (name ?? key), or null when under no registered project. */
  projectKey: string | null;
  byteOffset: number;
  label: string;
  sourceLabel?: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: string, issueId?: string) => void;
  onOpenConversationHit?: (hit: ConversationPaletteOpenRequest) => void | Promise<void>;
  /** PAN-2908 C-CONVO: preset scope on open (⌘J jumps to conversations). */
  initialScope?: PaletteScope;
  /** PAN-1990: activate a workspace-registry row and open its Workspace view. */
  onSelectWorkspace?: (workspaceId: string) => void;
  /** PAN-3330 FR-6b: open the New Workspace dialog. */
  onNewWorkspace?: () => void;
}

interface PanCommandEntry {
  name: string;
  description: string;
  group: string;
  keywords?: string[];
}

type ExcerptSegment = { kind: 'text' | 'match'; value: string };

interface PaletteSearchHit {
  kind: 'memory' | 'observation' | 'summary';
  id: string;
  projectId: string;
  workspaceId: string;
  issueId: string;
  timestamp: string;
  displayContent: string;
  excerpt: string;
  excerptSegments: ExcerptSegment[];
  tags: string[];
  docType: string;
  rank: number;
}

interface PaletteConversationHit {
  sessionId: string;
  conversationId: string;
  projectId: string;
  projectKey: string | null;
  role: string;
  ts: string | null;
  byteOffset: number;
  displayContent: string;
  excerpt: string;
  excerptSegments: Array<{ text: string; match: boolean }>;
  rank: number;
}

interface PaletteSearchResponse {
  memory: PaletteSearchHit[];
  observations: PaletteSearchHit[];
  summaries: PaletteSearchHit[];
  conversations: PaletteConversationHit[];
}

const EMPTY_AGENTS: Agent[] = [];
const EMPTY_ISSUES: Issue[] = [];
const EMPTY_SEARCH: PaletteSearchResponse = { memory: [], observations: [], summaries: [], conversations: [] };
export const PALETTE_CONVERSATIONS_NEWEST_FIRST_KEY = 'overdeck.ui.paletteConversationsNewestFirst';

// ─── Display helpers ────────────────────────────────────────────────────────────

/**
 * Turn a Claude project-dir id (the cwd with '/' encoded as '-', e.g.
 * `-home-eltmon-Projects-overdeck`) into a human label like
 * `overdeck`, or `overdeck · feature-pan-1053` for a workspace.
 * The encoding is lossy (a real '-' is indistinguishable from a path separator),
 * so we anchor on the `Projects` segment and fall back to the trailing segment.
 */
function friendlyProjectLabel(projectId: string): string {
  if (!projectId) return '';
  const segs = projectId.replace(/^-+/, '').split('-').filter(Boolean);
  if (segs.length === 0) return projectId;
  const projectsIdx = segs.lastIndexOf('Projects');
  const after = projectsIdx >= 0 ? segs.slice(projectsIdx + 1) : segs;
  const wsIdx = after.indexOf('workspaces');
  if (wsIdx >= 0) {
    const base = after.slice(0, wsIdx).join('-') || segs[segs.length - 1] || projectId;
    const ws = after.slice(wsIdx + 1).join('-');
    return ws ? `${base} · ${ws}` : base;
  }
  if (projectsIdx >= 0) return after.join('-') || projectId;
  // No `Projects` anchor — best effort: the cwd basename (last segment).
  return after[after.length - 1] || projectId;
}

function issueIdFromProjectLabel(label: string): string | null {
  const match = label.match(/\bfeature-([a-z]+)-(\d+)\b/i);
  if (!match) return null;
  return `${match[1]!.toUpperCase()}-${match[2]}`;
}

/** Compact, human-friendly timestamp: "Today 18:30", "Yesterday 09:12", "Jun 9", "Jun 9, 2025". */
function formatHitDate(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return `Today ${hhmm}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${hhmm}`;
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
}

/** Order conversation actions newest first while preserving search rank for timestamp ties (PAN-3704). */
export function compareConversationActionsNewestFirst(a: PaletteAction, b: PaletteAction): number {
  const aTs = a.sortTs ? Date.parse(a.sortTs) : Number.NaN;
  const bTs = b.sortTs ? Date.parse(b.sortTs) : Number.NaN;
  const aValid = !Number.isNaN(aTs);
  const bValid = !Number.isNaN(bTs);

  if (aValid && bValid && aTs !== bTs) return bTs - aTs;
  if (aValid !== bValid) return aValid ? -1 : 1;
  return (a.rank ?? 0) - (b.rank ?? 0);
}

// ─── Result-type scoping (filter chips) ─────────────────────────────────────────

type PaletteScope = 'all' | 'actions' | 'commands' | 'issues' | 'workspaces' | 'conversations' | 'memory';

const SCOPE_LABEL: Record<PaletteScope, string> = {
  all: 'All',
  actions: 'Actions',
  commands: 'Commands',
  issues: 'Issues',
  workspaces: 'Workspaces',
  conversations: 'Conversations',
  memory: 'Memory',
};

/** Map a result group heading to the scope chip it belongs under. */
function groupScope(group: string): Exclude<PaletteScope, 'all'> {
  if (group === 'Conversations') return 'conversations';
  if (group.startsWith('Commands · ')) return 'commands';
  // PAN-1990: the workspaces-registry rail, distinct from the legacy "Active
  // Workspaces" group (running-agent issue worktrees) below.
  if (group === 'Workspaces') return 'workspaces';
  if (group === 'Issues' || group === 'Active Workspaces' || group === 'Running Agents') return 'issues';
  if (group === 'Memory' || group === 'Memory · Summaries' || group === 'Observations') return 'memory';
  return 'actions';
}

/** Subtle accent (icon-chip fill + icon color) per result type, so rows read as
 *  intentional icon chips rather than empty checkboxes. */
function accentForGroup(group: string): { box: string; icon: string } {
  switch (groupScope(group)) {
    case 'conversations': return { box: 'bg-indigo-500/15', icon: 'text-indigo-400' };
    case 'memory':        return { box: 'bg-amber-500/15',  icon: 'text-amber-400' };
    case 'issues':        return { box: 'bg-sky-500/15',    icon: 'text-sky-400' };
    case 'workspaces':    return { box: 'bg-violet-500/15', icon: 'text-violet-400' };
    case 'commands':      return { box: 'bg-emerald-500/15', icon: 'text-emerald-400' };
    default:              return { box: 'bg-muted',          icon: 'text-muted-foreground' };
  }
}

// ─── Server API ───────────────────────────────────────────────────────────────

async function callApi(path: string, method = 'POST'): Promise<void> {
  try {
    await fetch(path, { method });
  } catch {
    console.error(`[command-palette] API call failed: ${method} ${path}`);
  }
}

async function fetchPanCommands(): Promise<PanCommandEntry[]> {
  try {
    const res = await fetch('/api/palette/commands');
    if (!res.ok) return [];
    const data = await res.json() as { commands?: PanCommandEntry[] };
    return Array.isArray(data.commands) ? data.commands : [];
  } catch {
    return [];
  }
}

/** PAN-1990: workspace-registry rows for the Workspaces switcher section. */
async function fetchWorkspaceRegistry(): Promise<WorkspaceRegistryRow[]> {
  try {
    const res = await fetch('/api/workspace-registry');
    if (!res.ok) return [];
    const data = await res.json() as { workspaces?: WorkspaceRegistryRow[] };
    return Array.isArray(data.workspaces) ? data.workspaces : [];
  } catch {
    return [];
  }
}

async function fetchPaletteSearch(query: string, signal: AbortSignal): Promise<PaletteSearchResponse> {
  try {
    const res = await fetch(`/api/palette/search?q=${encodeURIComponent(query)}&limit=15`, { signal });
    if (!res.ok) return EMPTY_SEARCH;
    const data = await res.json() as PaletteSearchResponse;
    return {
      memory: data.memory ?? [],
      observations: data.observations ?? [],
      summaries: data.summaries ?? [],
      conversations: data.conversations ?? [],
    };
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') return EMPTY_SEARCH;
    return EMPTY_SEARCH;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ─── Highlighted text ─────────────────────────────────────────────────────────
//
// Wraps every case-insensitive occurrence of any query term in `text` with a
// <mark>. Used for label + description on every palette row so the matched
// substring is visually obvious. Memory excerpts keep their server-driven
// FTS5 snippet highlighting (which understands stemming).

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractHighlightTerms(query: string): string[] {
  const matches = query.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const dedup = new Set<string>();
  for (const term of matches) {
    if (term.length === 0) continue;
    dedup.add(term);
  }
  // Match longer terms first so a query like "pan plan" highlights "plan"
  // inside "planning" before "pan" greedily consumes part of "planning".
  return [...dedup].sort((a, b) => b.length - a.length);
}

interface HighlightedProps {
  text: string;
  terms: string[];
}

// Spans (not <mark>) avoid the browser's bright-yellow default style.
// Background-only highlight: the parent's text color carries through, and
// only the backdrop signals "this matched". GitHub-search style — quieter
// than swapping the text color, and the same single rule reads well in
// both light and dark themes.
const HIGHLIGHT_CLASS = 'rounded-sm px-px text-inherit bg-amber-300/40 dark:bg-amber-400/20';

function Highlighted({ text, terms }: HighlightedProps) {
  if (!text) return null;
  if (terms.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi');
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className={HIGHLIGHT_CLASS}>{part}</span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CommandPalette({ isOpen, onClose, onNavigate, onOpenConversationHit, initialScope = 'all', onSelectWorkspace, onNewWorkspace }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 120);
  const agents = useDashboardStore((state) => isOpen ? selectAgents(state) : EMPTY_AGENTS) as unknown as Agent[];
  const issues = useDashboardStore((state) => isOpen ? selectIssues(state) : EMPTY_ISSUES) as Issue[];
  const openIssue = useDashboardStore((state) => state.openIssue);

  const [panCommands, setPanCommands] = useState<PanCommandEntry[]>([]);
  const [workspaceRows, setWorkspaceRows] = useState<WorkspaceRegistryRow[]>([]);
  // Shares the sidebar rail's persisted flag (PAN-3286 FR-13); re-read on open
  // so expanding in the rail is reflected here without a reload.
  const [pipelineWorkspacesExpanded, setPipelineWorkspacesExpanded] = useState(
    () => localStorage.getItem(WORKSPACES_PIPELINE_EXPANDED_KEY) === 'true',
  );
  const [searchResults, setSearchResults] = useState<PaletteSearchResponse>(EMPTY_SEARCH);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [scope, setScope] = useState<PaletteScope>(initialScope);
  const [conversationsNewestFirst, setConversationsNewestFirst] = useState(
    () => localStorage.getItem(PALETTE_CONVERSATIONS_NEWEST_FIRST_KEY) !== 'false',
  );
  const toggleConversationsNewestFirst = useCallback(() => {
    setConversationsNewestFirst((prev) => {
      const next = !prev;
      try { localStorage.setItem(PALETTE_CONVERSATIONS_NEWEST_FIRST_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Reset query when opened, and lazy-load the pan command catalog the first
  // time the palette is shown. Workspaces are re-fetched every open — most-
  // recent-first ordering depends on lastAccessedAt, which changes often.
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setSearchResults(EMPTY_SEARCH);
    setScope(initialScope);
    // Re-read the shared expansion flag so a rail toggle is picked up here.
    setPipelineWorkspacesExpanded(localStorage.getItem(WORKSPACES_PIPELINE_EXPANDED_KEY) === 'true');
    if (panCommands.length === 0) {
      void fetchPanCommands().then(setPanCommands);
    }
    void fetchWorkspaceRegistry().then(setWorkspaceRows);
  }, [isOpen, initialScope, panCommands.length]);

  // Fan out to the unified search endpoint as the user types.
  useEffect(() => {
    if (!isOpen) return;
    const trimmed = debouncedQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults(EMPTY_SEARCH);
      setIsSearchLoading(false);
      return;
    }
    const controller = new AbortController();
    setIsSearchLoading(true);
    void fetchPaletteSearch(trimmed, controller.signal)
      .then((data) => setSearchResults(data))
      .finally(() => setIsSearchLoading(false));
    return () => controller.abort();
  }, [isOpen, debouncedQuery]);

  // Keyboard: Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const handleSelect = useCallback((action: PaletteAction) => {
    // keepOpen actions re-list the palette instead of navigating, so closing
    // would defeat them (PAN-3286 FR-13).
    if (action.keepOpen) {
      action.onSelect();
      return;
    }
    onClose();
    // Small delay so modal closes before action side effects
    setTimeout(action.onSelect, 50);
  }, [onClose]);

  // ─── Action builders (stable wrt query — filtered later) ────────────────────

  const staticActions = useMemo<PaletteAction[]>(() => [
    {
      id: 'pan-flywheel',
      label: 'Run flywheel',
      description: 'Start the autonomous pipeline run on all In Progress / In Review issues',
      icon: Zap,
      group: 'Actions',
      keywords: ['flywheel', 'all-up', 'orchestrator', 'fixall', 'autonomous'],
      onSelect: () => onNavigate('flywheel'),
    },
    ...(onNewWorkspace ? [{
      id: 'new-workspace',
      label: 'New workspace…',
      description: 'Create a workspace by intent — name, project, target directory',
      icon: FolderOpen,
      group: 'Actions',
      keywords: ['workspace', 'create', 'scratch', 'worktree', 'new'],
      alsoScopes: ['workspaces' as const],
      onSelect: onNewWorkspace,
    }] : []),
    {
      id: 'start-cloister',
      label: 'Start Cloister',
      description: 'Enable autonomous agent orchestration',
      icon: Play,
      group: 'Orchestration',
      keywords: ['run', 'enable', 'activate'],
      onSelect: () => void callApi('/api/cloister/start'),
    },
    {
      id: 'stop-cloister',
      label: 'Stop Cloister',
      description: 'Disable autonomous agent orchestration',
      icon: Square,
      group: 'Orchestration',
      keywords: ['pause', 'disable', 'halt'],
      onSelect: () => void callApi('/api/cloister/stop'),
    },
    {
      id: 'emergency-stop',
      label: 'Emergency Stop All Agents',
      description: 'Immediately stop all running agents',
      icon: AlertTriangle,
      group: 'Orchestration',
      keywords: ['kill', 'abort', 'stop all', 'halt'],
      destructive: true,
      onSelect: () => void callApi('/api/agents/emergency-stop'),
    },
    {
      id: 'restart-conversations',
      label: 'Restart All Conversations',
      description: 'Re-spawn all active conversations with their stored model',
      icon: RefreshCw,
      group: 'Orchestration',
      keywords: ['restart', 'respawn', 'conversations', 'model', 'refresh'],
      onSelect: () => void callApi('/api/conversations/restart-all'),
    },
    {
      id: 'restart-agents',
      label: 'Restart All Workspace Agents',
      description: 'Stop and re-start all running workspace agents',
      icon: RefreshCw,
      group: 'Orchestration',
      keywords: ['restart', 'respawn', 'agents', 'workspace', 'refresh'],
      onSelect: () => void callApi('/api/agents/restart-all'),
    },
    {
      id: 'open-settings',
      label: 'Open Settings',
      description: 'Configure models, providers, and agent behavior',
      icon: Settings,
      group: 'Navigation',
      keywords: ['preferences', 'config', 'configure'],
      onSelect: () => onNavigate('settings'),
    },
    {
      id: 'open-context',
      label: 'Open Context',
      description: 'Edit layered context and preview harness output',
      icon: FileText,
      group: 'Navigation',
      keywords: ['context', 'claude', 'pi', 'prompt', 'sync'],
      onSelect: () => onNavigate('context'),
    },
    {
      id: 'open-kanban',
      label: 'Go to Kanban Board',
      description: 'View issues and agent status',
      icon: FolderOpen,
      group: 'Navigation',
      keywords: ['board', 'issues', 'home'],
      onSelect: () => onNavigate('kanban'),
    },
    {
      id: 'open-terminal',
      label: 'Open Terminal',
      description: 'Access the Overdeck terminal',
      icon: Terminal,
      group: 'Navigation',
      keywords: ['shell', 'console'],
      onSelect: () => onNavigate('command-deck'),
    },
    {
      id: 'open-agents',
      label: 'View Agents',
      description: 'See all running and completed agents',
      icon: Bot,
      group: 'Navigation',
      keywords: ['agents', 'workers'],
      onSelect: () => onNavigate('agents'),
    },
  ], [onNavigate, onNewWorkspace]);

  // ─── Dynamic: issues + agents ─────────────────────────────────────────────

  const { issueActions, agentActions } = useMemo(() => {
    const activeAgents = agents.filter((agent) => isAgentRunningStatus(agent.status));
    const activeIssueIds = new Set(activeAgents.map((a) => a.issueId?.toLowerCase()).filter(Boolean));
    const branchByIssueId = new Map(
      activeAgents
        .filter((agent) => agent.issueId && agent.git?.branch)
        .map((agent) => [agent.issueId!.toLowerCase(), agent.git!.branch]),
    );

    const issueActs: PaletteAction[] = issues.map((issue) => {
      const issueKey = issue.identifier.toLowerCase();
      const branch = branchByIssueId.get(issueKey);
      const active = activeIssueIds.has(issueKey);
      return {
        id: `issue-${issue.identifier}`,
        label: issue.identifier,
        description: branch ? `${issue.title} · ${branch}` : issue.title,
        icon: FolderOpen,
        group: active ? 'Active Workspaces' : 'Issues',
        keywords: [issue.id, issue.identifier, issue.title, branch ?? '', issue.workspacePath ?? ''].filter(Boolean),
        onSelect: () => {
          openIssue(issue.identifier);
        },
      };
    });

    const agentActs: PaletteAction[] = activeAgents.map((agent) => ({
      id: `agent-${agent.id}`,
      label: agent.issueId ?? agent.id,
      description: agent.issueId ? `Working on ${agent.issueId}` : agent.status,
      icon: User,
      group: 'Running Agents',
      keywords: [agent.id, agent.issueId ?? '', agent.git?.branch ?? '', agent.status],
      onSelect: () => {
        if (agent.issueId) openIssue(agent.issueId);
        else onNavigate('agents');
      },
    }));

    return { issueActions: issueActs, agentActions: agentActs };
  }, [agents, issues, openIssue, onNavigate]);

  // ─── Dynamic: workspaces (PAN-1990) ─────────────────────────────────────────
  // Favorites first, then most-recent-first (same ordering as the Sidebar rail).
  // PAN-3286 FR-13: and the same default filter — non-favorited pipeline
  // worktrees collapse behind a count row that expands them, mirroring the rail
  // rather than hiding them outright (review fix). Expansion shares the rail's
  // localStorage key, so it is one operator preference across both surfaces.

  const hiddenPipelineWorkspaces = useMemo(
    () => sortWorkspaces(workspaceRows.filter((ws) => !isUserFacingWorkspace(ws))),
    [workspaceRows],
  );

  const visibleWorkspaceRows = useMemo(
    () => sortWorkspaces(
      pipelineWorkspacesExpanded ? workspaceRows : workspaceRows.filter(isUserFacingWorkspace),
    ),
    [workspaceRows, pipelineWorkspacesExpanded],
  );

  // PAN-3331 FR-8: start the most recently used workspace's run command without
  // leaving the keyboard. Derived from ALL non-archived rows by lastAccessedAt,
  // NOT from the visible list — that one sorts favorites first and hides
  // collapsed issue worktrees, so an older favorite could win over the
  // workspace the operator actually just used, and the action would vanish
  // whenever every row was a collapsed worktree.
  const runTargetWorkspace = useMemo(() => {
    let newest: WorkspaceRegistryRow | null = null;
    for (const ws of workspaceRows) {
      if (ws.isArchived) continue;
      if (!newest || (ws.lastAccessedAt ?? 0) > (newest.lastAccessedAt ?? 0)) newest = ws;
    }
    return newest;
  }, [workspaceRows]);

  const runWorkspaceCommand = useCallback(async (workspaceId: string) => {
    try {
      const res = await fetch(`/api/workspace-registry/${workspaceId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = await res.json().catch(() => ({})) as { sessionName?: string; error?: string };
      if (body.sessionName) rememberRunSession(workspaceId, body.sessionName);
      // 409 means one was already live — that is a success for "show me the run".
      else if (!res.ok) toast.error(body.error ?? 'Could not start the run command');
    } catch (error) {
      // A transport failure must surface, not become an unhandled rejection.
      toast.error(error instanceof Error ? error.message : 'Could not reach the dashboard API');
    }
    onSelectWorkspace?.(workspaceId);
  }, [onSelectWorkspace]);

  const workspaceActions = useMemo<PaletteAction[]>(() => {
    const actions: PaletteAction[] = visibleWorkspaceRows.map((ws) => ({
      id: `workspace-${ws.id}`,
      label: ws.title ?? ws.name,
      description: ws.issueId ?? ws.kind,
      icon: Clock,
      group: 'Workspaces',
      keywords: [ws.name, ws.issueId ?? '', ws.title ?? '', ws.kind],
      onSelect: () => {
        void fetch(`/api/workspace-registry/${ws.id}/activate`, { method: 'POST' });
        onSelectWorkspace?.(ws.id);
      },
    }));

    // PAN-3331 D-10 — ONE visible row. The group is what maps a row to a scope
    // chip, so the action normally lives under Actions and moves to Workspaces
    // only while that scope is the filter. Emitting both unconditionally put two
    // identical rows in the default `all` view.
    if (runTargetWorkspace) {
      const runLabel = runTargetWorkspace.title ?? runTargetWorkspace.name;
      const group = scope === 'workspaces' ? 'Workspaces' : 'Actions';
      actions.push({
        id: `run-workspace-command-${group.toLowerCase()}`,
        label: 'Run workspace command',
        description: `Start the run command for ${runLabel}`,
        icon: Play,
        group,
        keywords: ['run', 'start', 'dev server', 'command', runTargetWorkspace.name],
        onSelect: () => void runWorkspaceCommand(runTargetWorkspace.id),
      });
    }

    if (!pipelineWorkspacesExpanded && hiddenPipelineWorkspaces.length > 0) {
      actions.push({
        id: 'workspace-pipeline-expand',
        label: `${hiddenPipelineWorkspaces.length} pipeline ${hiddenPipelineWorkspaces.length === 1 ? 'worktree' : 'worktrees'}`,
        description: 'Show worktrees Overdeck created for issues',
        icon: ChevronRight,
        group: 'Workspaces',
        // The hidden rows' own names are keywords, so typing one surfaces this
        // row — otherwise a hidden workspace would be undiscoverable by search.
        keywords: [
          'pipeline',
          'worktrees',
          'issue workspaces',
          ...hiddenPipelineWorkspaces.flatMap((ws) => [ws.name, ws.issueId ?? '']),
        ].filter(Boolean),
        onSelect: () => {
          setPipelineWorkspacesExpanded(true);
          try { localStorage.setItem(WORKSPACES_PIPELINE_EXPANDED_KEY, 'true'); } catch { /* ignore */ }
        },
        // Expanding is not a navigation — keep the palette open so the revealed
        // rows can be picked immediately.
        keepOpen: true,
      });
    }

    return actions;
  }, [visibleWorkspaceRows, hiddenPipelineWorkspaces, pipelineWorkspacesExpanded, onSelectWorkspace, runTargetWorkspace, runWorkspaceCommand, scope]);

  // ─── Dynamic: pan commands ────────────────────────────────────────────────

  const commandActions = useMemo<PaletteAction[]>(() => panCommands.map((cmd, index) => ({
    id: `cmd-${index}-${cmd.name}`,
    label: cmd.name,
    description: cmd.description,
    icon: ChevronRight,
    group: `Commands · ${cmd.group}`,
    // `pan` is canonical; `overdeck`/`ovr` are brand aliases so typing either surfaces the catalog.
    keywords: ['pan', 'overdeck', 'ovr', cmd.group, ...(cmd.keywords ?? [])],
    onSelect: () => {
      void copyToClipboard(cmd.name).then((ok) => {
        if (ok) toast.success(`Copied: ${cmd.name}`);
        else toast.error('Clipboard unavailable — copy manually');
      });
    },
  })), [panCommands]);

  // ─── Dynamic: conversations + memory + observations + summaries ────────────

  const memoryActions = useMemo<PaletteAction[]>(() => {
    const out: PaletteAction[] = [];
    const push = (hits: PaletteSearchHit[], group: string, icon: React.ElementType) => {
      for (const hit of hits) {
        const label = hit.displayContent || hit.docType || hit.id;
        const issueOrProject = hit.issueId || hit.projectId || '';
        const when = hit.timestamp ? hit.timestamp.slice(0, 16).replace('T', ' ') : '';
        const meta = [issueOrProject, when].filter(Boolean).join(' · ');
        out.push({
          id: `mem-${hit.kind}-${hit.id}`,
          label: label.length > 80 ? `${label.slice(0, 77)}…` : label,
          description: meta,
          icon,
          group,
          rank: hit.rank,
          excerptSegments: hit.excerptSegments,
          keywords: [hit.kind, hit.docType, hit.projectId, hit.issueId, ...hit.tags],
          onSelect: () => {
            if (hit.issueId && /^[A-Z]+-\d+$/i.test(hit.issueId)) {
              openIssue(hit.issueId);
            } else {
              toast.message(label, { description: hit.excerpt || meta || undefined });
            }
          },
        });
      }
    };
    push(searchResults.observations, 'Observations', Eye);
    for (const hit of searchResults.conversations) {
      const label = hit.displayContent || hit.conversationId || hit.sessionId;
      const project = friendlyProjectLabel(hit.projectId);
      const issueId = issueIdFromProjectLabel(project);
      const isDashboardConversation = hit.conversationId !== hit.sessionId;
      const sourceLabel = isDashboardConversation
        ? `Conversation ${hit.conversationId}`
        : `Claude session ${hit.sessionId.slice(0, 8)}`;
      const date = formatHitDate(hit.ts);
      const metaChips: PaletteAction['meta'] = [];
      if (project) metaChips.push({ icon: FolderOpen, text: project, pill: true });
      if (issueId) metaChips.push({ text: issueId, pill: true });
      metaChips.push({ text: sourceLabel });
      if (date) metaChips.push({ icon: Clock, text: date });
      if (hit.role) metaChips.push({ text: hit.role });
      out.push({
        id: `conv-${hit.sessionId}-${hit.byteOffset}`,
        label: label.length > 80 ? `${label.slice(0, 77)}…` : label,
        meta: metaChips,
        icon: MessageCircle,
        group: 'Conversations',
        rank: hit.rank,
        sortTs: hit.ts,
        excerptSegments: hit.excerptSegments.map((seg) => ({
          kind: seg.match ? 'match' : 'text',
          value: seg.text,
        })),
        keywords: ['conversation', hit.sessionId, hit.conversationId, hit.projectId, hit.role],
        onSelect: () => {
          if (onOpenConversationHit) {
            void onOpenConversationHit({
              sessionId: hit.sessionId,
              conversationId: hit.conversationId,
              projectId: hit.projectId,
              projectKey: hit.projectKey,
              byteOffset: hit.byteOffset,
              label,
              sourceLabel,
            });
            return;
          }
          toast.message(label, { description: hit.excerpt || [project, date].filter(Boolean).join(' · ') || undefined });
        },
      });
    }
    push(searchResults.memory, 'Memory', Brain);
    push(searchResults.summaries, 'Memory · Summaries', Sparkles);
    return out;
  }, [searchResults, openIssue, onOpenConversationHit]);

  // ─── Filter + group ───────────────────────────────────────────────────────

  const allActions = useMemo(() => [
    ...staticActions,
    ...commandActions,
    ...workspaceActions,
    ...issueActions,
    ...agentActions,
    ...memoryActions,
  ], [staticActions, commandActions, workspaceActions, issueActions, agentActions, memoryActions]);

  const filtered = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      // Default view: only show built-in actions + issues + agents. Don't
      // dump the entire pan command catalog or empty memory section.
      return allActions.filter((a) => !a.group.startsWith('Commands · '));
    }
    const q = trimmed.toLowerCase();
    return allActions.filter((action) => {
      // Server-side search results are pre-matched against the query, so
      // include them unconditionally (sort handles ranking).
      if (action.group === 'Conversations' || action.group === 'Memory' || action.group === 'Observations' || action.group === 'Memory · Summaries') {
        return true;
      }
      return (
        action.label.toLowerCase().includes(q) ||
        (action.description?.toLowerCase().includes(q) ?? false) ||
        (action.keywords?.some((k) => k.toLowerCase().includes(q)) ?? false)
      );
    });
  }, [query, allActions]);

  // Terms used to highlight every matched substring in label + description.
  const highlightTerms = useMemo(() => extractHighlightTerms(query), [query]);

  // Display group ordering: Actions/Orchestration/Navigation first, then
  // Active Workspaces, Issues, Running Agents, Commands, Memory/Observations.
  const groupOrder = useMemo(() => {
    const seen = new Set(filtered.map((a) => a.group));
    const ordered: string[] = [];
    const preferred = ['Actions', 'Orchestration', 'Navigation', 'Workspaces', 'Active Workspaces', 'Issues', 'Running Agents'];
    for (const g of preferred) if (seen.has(g)) { ordered.push(g); seen.delete(g); }
    const commandGroups = [...seen].filter((g) => g.startsWith('Commands · ')).sort();
    for (const g of commandGroups) { ordered.push(g); seen.delete(g); }
    for (const g of ['Observations', 'Conversations', 'Memory', 'Memory · Summaries']) if (seen.has(g)) { ordered.push(g); seen.delete(g); }
    ordered.push(...seen);
    return ordered;
  }, [filtered]);

  // Scope chips reflect the result types actually present (plus All). Only shown
  // when there's more than one type to choose between.
  const availableScopes = useMemo<PaletteScope[]>(() => {
    const present = new Set<PaletteScope>();
    for (const g of groupOrder) present.add(groupScope(g));
    // An action may answer to a chip its group does not imply, so the chip has
    // to be offered even when nothing else of that type is listed.
    for (const action of filtered) for (const s of action.alsoScopes ?? []) present.add(s);
    const ordered = (['actions', 'commands', 'workspaces', 'issues', 'conversations', 'memory'] as const).filter((s) => present.has(s));
    return ordered.length > 1 ? ['all', ...ordered] : [];
  }, [groupOrder, filtered]);

  // If the active scope drops out of the results (e.g. the query changed), reset.
  useEffect(() => {
    if (scope !== 'all' && !availableScopes.includes(scope)) setScope('all');
  }, [scope, availableScopes]);

  /** True when this action belongs under the active chip. */
  const inScope = useCallback(
    (action: PaletteAction) =>
      scope === 'all' || groupScope(action.group) === scope || (action.alsoScopes?.includes(scope) ?? false),
    [scope],
  );

  const visibleGroups = useMemo(
    () => (scope === 'all'
      ? groupOrder
      : groupOrder.filter((g) => filtered.some((a) => a.group === g && inScope(a)))),
    [groupOrder, filtered, scope, inScope],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-full max-w-xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false} className="[&_[cmdk-input-wrapper]]:border-b [&_[cmdk-input-wrapper]]:border-border">
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <Zap className="w-4 h-4 text-primary shrink-0" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search commands, issues, conversations, memory…"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
              autoFocus
            />
            {isSearchLoading && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
                <Loader2 className="w-3 h-3 animate-spin" />
                searching…
              </span>
            )}
            <kbd className="text-[10px] text-muted-foreground bg-card px-1.5 py-0.5 rounded border border-border">ESC</kbd>
          </div>

          {/* Scope filter chips — only when there's more than one result type */}
          {availableScopes.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border overflow-x-auto">
              {availableScopes.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border whitespace-nowrap transition-colors ${
                    scope === s
                      ? 'bg-primary/15 border-primary/40 text-primary font-medium'
                      : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
                  }`}
                >
                  {SCOPE_LABEL[s]}
                </button>
              ))}
            </div>
          )}

          {/* Results */}
          <Command.List className="max-h-[480px] overflow-y-auto py-2">
            {isSearchLoading && query.trim().length >= 2 && (
              <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Searching conversations & memory…
              </div>
            )}
            {visibleGroups.length === 0 ? (
              isSearchLoading && query.trim().length >= 2 ? null : (
                <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
                  {query.trim().length === 0 ? 'Start typing…' : `No results for "${query}"`}
                </Command.Empty>
              )
            ) : (
              visibleGroups.map((group) => (
                <Command.Group
                  key={group}
                  heading={group}
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {filtered
                    .filter((a) => a.group === group && inScope(a))
                    .sort(group === 'Conversations' && conversationsNewestFirst
                      ? compareConversationActionsNewestFirst
                      : (a, b) => (a.rank ?? 0) - (b.rank ?? 0))
                    .map((action) => {
                      const accent = accentForGroup(action.group);
                      return (
                      <Command.Item
                        key={action.id}
                        value={action.id}
                        onSelect={() => handleSelect(action)}
                        className="flex items-start gap-3 px-3 py-2.5 mx-1 rounded-lg cursor-pointer data-[selected=true]:bg-popover transition-colors group"
                      >
                        <div className={`size-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                          action.destructive ? 'bg-destructive/10 text-destructive' : `${accent.box} ${accent.icon}`
                        }`}>
                          <action.icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${
                            action.destructive ? 'text-destructive' : 'text-foreground'
                          }`}>
                            <Highlighted text={action.label} terms={highlightTerms} />
                          </p>
                          {action.meta && action.meta.length > 0 ? (
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {action.meta.map((m, i) => (
                                <span
                                  key={i}
                                  className={`inline-flex items-center gap-1 text-[11px] ${
                                    m.pill
                                      ? 'px-1.5 py-0.5 rounded-md bg-muted text-foreground/75 font-medium'
                                      : 'text-muted-foreground'
                                  }`}
                                >
                                  {m.icon && <m.icon className="w-3 h-3 opacity-60" />}
                                  {m.text}
                                </span>
                              ))}
                            </div>
                          ) : action.description ? (
                            <p className="text-xs text-muted-foreground truncate">
                              <Highlighted text={action.description} terms={highlightTerms} />
                            </p>
                          ) : null}
                          {action.excerptSegments && action.excerptSegments.length > 0 && (
                            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 leading-snug">
                              {action.excerptSegments.map((seg, i) =>
                                seg.kind === 'match' ? (
                                  <span key={i} className={HIGHLIGHT_CLASS}>{seg.value}</span>
                                ) : (
                                  <span key={i}>{seg.value}</span>
                                ),
                              )}
                            </p>
                          )}
                        </div>
                      </Command.Item>
                      );
                    })}
                </Command.Group>
              ))
            )}
          </Command.List>

          {/* Footer */}
          <div className="flex items-center gap-4 px-4 py-2 border-t border-border bg-card">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-card border border-border rounded text-[9px]">↑↓</kbd>
              navigate
            </span>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-card border border-border rounded text-[9px]">↵</kbd>
              select
            </span>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-card border border-border rounded text-[9px]">Esc</kbd>
              close
            </span>
            <button
              type="button"
              aria-pressed={conversationsNewestFirst}
              onClick={toggleConversationsNewestFirst}
              className={`ml-auto text-[11px] px-2.5 py-1 rounded-full border whitespace-nowrap transition-colors ${
                conversationsNewestFirst
                  ? 'bg-primary/15 border-primary/40 text-primary font-medium'
                  : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
              }`}
            >
              Newest first
            </button>
          </div>
        </Command>
      </div>
    </div>
  );
}
